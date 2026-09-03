from __future__ import annotations

import datetime
import os
import re
import shutil
import subprocess
from typing import TypedDict

from ..enums import FilesystemType
from ..logger import logger
from .models import BtrfsSubvolume


class BtrfsMountInfo(TypedDict):
    mountpoint: str
    subvol: str | None
    subvolid: int | None


class BtrfsClient:
    """Wrapper around the btrfs CLI commands."""

    def __init__(self, btrfs_binary: str = "btrfs") -> None:
        self._btrfs_binary: str = btrfs_binary

    def is_available(self) -> bool:
        """Checks if the btrfs binary is installed and executable."""
        return shutil.which(self._btrfs_binary) is not None

    def list_subvolumes(
        self,
        path: str,
        *,
        snapshots_only: bool = True,
        readonly_only: bool = False,
    ) -> list[BtrfsSubvolume]:
        """
        Lists subvolumes/snapshots below or at the given path.
        Executes: `btrfs subvolume list [-s] [-r] -a -p -u -q -c <path>`
        """
        if not self.is_available() or not os.path.exists(path):
            return []

        args = [self._btrfs_binary, "subvolume", "list", "-a", "-p", "-u", "-q", "-c"]
        if snapshots_only:
            args.append("-s")
        if readonly_only:
            args.append("-r")
        args.append(path)

        try:
            res = subprocess.run(args, capture_output=True, text=True, check=False)
            if res.returncode != 0:
                err_msg = res.stderr.strip()
                if "Operation not permitted" in err_msg:
                    msg = (
                        "btrfs subvolume list on '%s' failed: Operation not permitted. "
                        "When running inside Docker, add '--cap-add=SYS_ADMIN' to docker run."
                    )
                    logger.warning(msg, path)
                else:
                    logger.debug(
                        "btrfs subvolume list failed on '%s' (exit %d): %s",
                        path,
                        res.returncode,
                        err_msg,
                    )
                return []
            return self._parse_subvolume_list(res.stdout)
        except (OSError, UnicodeDecodeError) as exc:
            logger.debug("Error running btrfs subvolume list on '%s': %s", path, exc)
            return []

    def get_subvolume_info(self, path: str) -> BtrfsSubvolume | None:
        """
        Retrieves detailed metadata for a single subvolume/snapshot path using `btrfs subvolume show <path>`.
        """
        if not self.is_available() or not os.path.exists(path):
            return None

        args = [self._btrfs_binary, "subvolume", "show", path]
        try:
            res = subprocess.run(args, capture_output=True, text=True, check=False)
            if res.returncode != 0:
                logger.debug("btrfs subvolume show failed on '%s' (exit %d): %s", path, res.returncode, res.stderr.strip())
                return None
            return self._parse_subvolume_show(res.stdout, path)
        except (OSError, UnicodeDecodeError) as exc:
            logger.debug("Error running btrfs subvolume show on '%s': %s", path, exc)
            return None

    @staticmethod
    def _parse_subvolume_list(output: str) -> list[BtrfsSubvolume]:
        """
        Parses output of `btrfs subvolume list -a -p -u -q -c ...`
        Example lines:
        ID 256 gen 1234 top level 5 parent_uuid - uuid 1234-5678-abcd path <FS_TREE>/@
        ID 257 gen 1235 cgen 1234 parent 256 top level 5 parent_uuid 1234-5678-abcd uuid 8765-4321-dcba path <FS_TREE>/@/.snapshots/1/snapshot
        """
        subvolumes: list[BtrfsSubvolume] = []
        for line in output.strip().splitlines():
            line = line.strip()
            if not line:
                continue

            id_match = re.search(r"\bID\s+(\d+)", line)
            if not id_match:
                continue
            subvol_id = int(id_match.group(1))

            parent_match = re.search(r"\bparent\s+(\d+)", line)
            top_level_match = re.search(r"\btop level\s+(\d+)", line)
            if parent_match:
                parent_id = int(parent_match.group(1))
            elif top_level_match:
                parent_id = int(top_level_match.group(1))
            else:
                parent_id = None

            uuid_match = re.search(r"\buuid\s+([a-fA-F0-9\-]+)", line)
            uuid = uuid_match.group(1) if uuid_match and uuid_match.group(1) != "-" else None

            parent_uuid_match = re.search(r"\bparent_uuid\s+([a-fA-F0-9\-]+)", line)
            parent_uuid = parent_uuid_match.group(1) if parent_uuid_match and parent_uuid_match.group(1) != "-" else None

            path_match = re.search(r"\bpath\s+(.+)$", line)
            subvol_path = path_match.group(1).strip() if path_match else ""

            is_snapshot = parent_uuid is not None or ".snapshots/" in subvol_path or subvol_path.endswith("/snapshot")

            subvolumes.append(
                BtrfsSubvolume(
                    subvolume_id=subvol_id,
                    path=subvol_path,
                    parent_id=parent_id,
                    uuid=uuid,
                    parent_uuid=parent_uuid,
                    creation_time=None,
                    is_snapshot=is_snapshot,
                )
            )
        return subvolumes

    @staticmethod
    def _parse_subvolume_show(output: str, path: str) -> BtrfsSubvolume | None:
        """
        Parses output of `btrfs subvolume show <path>`.
        """
        lines = output.strip().splitlines()
        if not lines:
            return None

        subvol_id: int | None = None
        uuid: str | None = None
        parent_uuid: str | None = None
        creation_time: datetime.datetime | None = None
        is_readonly: bool = False

        for line in lines:
            parts = line.split(":", 1)
            if len(parts) != 2:
                continue
            key = parts[0].strip().lower()
            val = parts[1].strip()

            if key == "subvolume id":
                try:
                    subvol_id = int(val)
                except ValueError:
                    pass
            elif key == "uuid":
                uuid = val if val != "-" else None
            elif key == "parent uuid":
                parent_uuid = val if val != "-" else None
            elif key == "flags":
                is_readonly = "readonly" in val.lower()
            elif key == "creation time":
                creation_time = BtrfsClient._parse_timestamp_str(val)

        if subvol_id is None:
            subvol_id = 0

        is_snapshot = parent_uuid is not None or ".snapshots/" in path or path.endswith("/snapshot")

        return BtrfsSubvolume(
            subvolume_id=subvol_id,
            path=path,
            uuid=uuid,
            parent_uuid=parent_uuid,
            creation_time=creation_time,
            is_snapshot=is_snapshot,
            is_readonly=is_readonly,
        )

    @staticmethod
    def _parse_timestamp_str(ts_str: str) -> datetime.datetime | None:
        """Parses btrfs timestamp strings such as '2026-05-30 13:04:39 +0200'."""
        clean_str = ts_str.strip()
        parts = clean_str.split()
        if len(parts) >= 2:
            dt_part = f"{parts[0]} {parts[1]}"
            try:
                return datetime.datetime.strptime(dt_part, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                pass
        try:
            return datetime.datetime.fromisoformat(clean_str)
        except ValueError:
            return None

    @staticmethod
    def list_mounts() -> list[BtrfsMountInfo]:
        """
        Discovers active Btrfs mountpoints and their options (subvol, subvolid)
        from `/proc/mounts`.
        """
        mounts: list[BtrfsMountInfo] = []
        if not os.path.exists("/proc/mounts"):
            return mounts

        try:
            with open("/proc/mounts", "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) >= 4 and parts[2] == FilesystemType.BTRFS:
                        mp = parts[1].encode("utf-8").decode("unicode_escape")
                        if not os.path.isdir(mp) or mp.startswith(("/proc", "/sys", "/dev", "/etc", "/app")):
                            continue
                        subvol: str | None = None
                        subvolid: int | None = None
                        opts = parts[3].split(",")
                        for opt in opts:
                            if opt.startswith("subvol="):
                                subvol = opt.split("=", 1)[1].lstrip("/")
                            elif opt.startswith("subvolid="):
                                try:
                                    subvolid = int(opt.split("=", 1)[1])
                                except ValueError:
                                    pass
                        mounts.append(
                            {
                                "mountpoint": mp,
                                "subvol": subvol,
                                "subvolid": subvolid,
                            }
                        )
        except OSError as exc:
            logger.debug("Could not read /proc/mounts: %s", exc)

        return mounts

    @staticmethod
    def list_mountpoints() -> list[str]:
        """
        Discovers active Btrfs mountpoints on the host by parsing `/proc/mounts`.
        """
        mountpoints: list[str] = []
        for m in BtrfsClient.list_mounts():
            mp = m["mountpoint"]
            if mp not in mountpoints:
                mountpoints.append(mp)
        return mountpoints
