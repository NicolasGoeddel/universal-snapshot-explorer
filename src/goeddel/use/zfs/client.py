from __future__ import annotations

import datetime
import fnmatch
import os
import shutil
import subprocess
from collections.abc import Sequence

from ..logger import logger
from .models import ZfsDataset, ZfsSnapshotInfo


class ZfsClient:
    """
    Subprocess-based client for executing OpenZFS CLI commands (`zfs list`).
    Communicates directly with the host kernel driver via `/dev/zfs`.
    """

    def __init__(self, executable: str = "zfs") -> None:
        self._executable: str = executable
        self._is_available_cache: bool | None = None

    def is_available(self) -> bool:
        """Checks whether the zfs CLI tool is installed and can be executed."""
        if self._is_available_cache is not None:
            return self._is_available_cache

        exe = shutil.which(self._executable)
        if not exe:
            self._is_available_cache = False
            return False

        try:
            # Check if zfs command can run (returncode 0 or 1 for usage/version)
            res = subprocess.run(
                [self._executable, "version"],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
            # zfs version prints version even if kernel module returns non-zero in userland
            self._is_available_cache = res.returncode == 0 or "zfs-" in res.stdout or "zfs-" in res.stderr
        except OSError, subprocess.SubprocessError:
            logger.exception("Error checking ZFS availability")
            self._is_available_cache = False

        return self._is_available_cache

    def list_datasets(
        self,
        exclude_patterns: Sequence[str] = (),
        pools: Sequence[str] = (),
    ) -> list[ZfsDataset]:
        """
        Lists all ZFS filesystems along with their mountpoints and space metrics.
        Filters out unmounted filesystems and datasets matching any exclude pattern.
        """
        if not self.is_available():
            return []

        try:
            cmd = [
                self._executable,
                "list",
                "-t",
                "filesystem",
                "-H",
                "-p",
                "-o",
                "name,mountpoint,mounted,used,avail,refer",
            ]
            logger.debug("Executing ZFS command: %s", " ".join(cmd))
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=10, check=False)
            if res.returncode != 0:
                logger.error("ZFS list datasets failed with exit code %d: %s", res.returncode, res.stderr.strip())
                return []
        except OSError, subprocess.SubprocessError:
            logger.exception("Subprocess error running ZFS list datasets")
            return []

        datasets: list[ZfsDataset] = []
        for line in res.stdout.splitlines():
            line = line.strip()
            if not line:
                continue

            parts = line.split("\t")
            if len(parts) < 6:
                continue

            name, mountpoint_raw, mounted_str, used_str, avail_str, refer_str = parts[:6]
            pool = name.split("/")[0] if "/" in name else name

            if pools and pool not in pools:
                continue

            is_mounted = (mounted_str.strip().lower() == "yes") and (mountpoint_raw not in ("-", "none", "legacy"))
            mountpoint = mountpoint_raw if mountpoint_raw not in ("-", "none", "legacy") else None

            # Check exclusion patterns against name and mountpoint
            excluded = False
            for pat in exclude_patterns:
                clean_pat = pat.rstrip("/*")
                if (
                    fnmatch.fnmatch(name, pat)
                    or fnmatch.fnmatch(name, f"{clean_pat}/*")
                    or name == clean_pat
                    or name.startswith(f"{clean_pat}/")
                    or (mountpoint and (fnmatch.fnmatch(mountpoint, pat) or mountpoint.startswith(f"{clean_pat}/")))
                ):
                    excluded = True
                    break

            if excluded:
                continue

            try:
                used_b = int(used_str)
                avail_b = int(avail_str)
                refer_b = int(refer_str)
            except ValueError:
                used_b = avail_b = refer_b = 0

            datasets.append(
                ZfsDataset(
                    name=name,
                    pool=pool,
                    mountpoint=mountpoint,
                    used_bytes=used_b,
                    available_bytes=avail_b,
                    referenced_bytes=refer_b,
                    is_mounted=is_mounted,
                )
            )

        logger.info("Successfully fetched %d datasets via ZFS CLI", len(datasets))
        return datasets

    def list_snapshots(self, dataset: str) -> list[ZfsSnapshotInfo]:
        """
        Lists all snapshots for a given dataset with their exact creation timestamps.
        """
        if not self.is_available() or not dataset:
            return []

        try:
            cmd = [
                self._executable,
                "list",
                "-t",
                "snapshot",
                "-H",
                "-p",
                "-o",
                "name,creation,used,refer",
                "-d",
                "1",
                "-r",
                dataset,
            ]
            logger.debug("Executing ZFS command: %s", " ".join(cmd))
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=10, check=False)
            if res.returncode != 0:
                logger.error("ZFS list snapshots failed for %s with status %d: %s", dataset, res.returncode, res.stderr.strip())
                return []
        except OSError, subprocess.SubprocessError:
            logger.exception("Subprocess error running ZFS list snapshots for dataset %s", dataset)
            return []

        snapshots: list[ZfsSnapshotInfo] = []
        for line in res.stdout.splitlines():
            line = line.strip()
            if not line:
                continue

            parts = line.split("\t")
            if len(parts) < 4:
                continue

            full_name, creation_str, used_str, refer_str = parts[:4]
            if "@" not in full_name:
                continue

            ds_name, snap_name = full_name.split("@", 1)
            # Only include direct snapshots of this dataset
            if ds_name != dataset:
                continue

            try:
                creation_epoch = int(creation_str)
                creation_dt = datetime.datetime.fromtimestamp(creation_epoch)
            except ValueError, OverflowError, OSError:
                creation_dt = datetime.datetime.min

            try:
                used_b = int(used_str)
                refer_b = int(refer_str)
            except ValueError:
                used_b = refer_b = 0

            snapshots.append(
                ZfsSnapshotInfo(
                    dataset_name=ds_name,
                    snapshot_name=snap_name,
                    full_name=full_name,
                    creation_time=creation_dt,
                    used_bytes=used_b,
                    referenced_bytes=refer_b,
                )
            )

        logger.info("Successfully fetched %d snapshots for dataset '%s'", len(snapshots), dataset)
        return snapshots

    def find_dataset_by_path(
        self,
        path: str,
        datasets: Sequence[ZfsDataset] | None = None,
        mount_prefix: str = "",
    ) -> ZfsDataset | None:
        """
        Finds the ZFS dataset corresponding to a directory path based on mountpoints.
        """
        if not path:
            return None

        clean = os.path.abspath(path).rstrip("/")
        if not clean:
            clean = "/"

        candidates: list[str] = [clean]
        if mount_prefix and clean.startswith(mount_prefix.rstrip("/")):
            stripped = clean[len(mount_prefix.rstrip("/")) :]
            cand_path = os.path.abspath(stripped if stripped else "/")
            if cand_path not in candidates:
                candidates.append(cand_path)
        elif clean.startswith("/host"):
            stripped = clean[5:]
            cand_path = os.path.abspath(stripped if stripped else "/")
            if cand_path not in candidates:
                candidates.append(cand_path)

        all_ds = datasets if datasets is not None else self.list_datasets()

        best_match: ZfsDataset | None = None
        best_len = -1

        for ds in all_ds:
            if not ds.mountpoint or not ds.is_mounted:
                continue
            mp = os.path.abspath(ds.mountpoint).rstrip("/")
            if not mp:
                mp = "/"

            for cand in candidates:
                if mp == "/":
                    matches = True
                    match_len = 1
                elif cand == mp or cand.startswith(mp + "/"):
                    matches = True
                    match_len = len(mp)
                else:
                    matches = False
                    match_len = 0

                if matches and match_len > best_len:
                    best_len = match_len
                    best_match = ds

        return best_match
