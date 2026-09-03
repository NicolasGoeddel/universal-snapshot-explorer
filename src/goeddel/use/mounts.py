from __future__ import annotations

import os
from dataclasses import dataclass
from typing import ClassVar

from .enums import FilesystemType
from .logger import logger


@dataclass(frozen=True)
class MountInfo:
    """Represents an active mount point on the system."""

    mountpoint: str
    fstype: str
    device: str = ""
    options: str = ""

    @property
    def is_kernel_pseudo_fs(self) -> bool:
        return self.fstype in MountsManager.KERNEL_PSEUDO_FS

    @property
    def is_network_fs(self) -> bool:
        return self.fstype in MountsManager.NETWORK_FS

    @property
    def is_snapshot_capable(self) -> bool:
        return self.fstype in MountsManager.SNAPSHOT_CAPABLE_FS


class MountsManager:
    """Discovers and resolves mount point information from /proc/mounts."""

    KERNEL_PSEUDO_FS: ClassVar[set[str]] = {
        "proc",
        "sysfs",
        "devtmpfs",
        "devpts",
        "cgroup",
        "cgroup2",
        "pstore",
        "efivarfs",
        "securityfs",
        "debugfs",
        "tracefs",
        "bpf",
        "autofs",
        "mqueue",
        "hugetlbfs",
        "ramfs",
        "configfs",
        "fusectl",
        "binfmt_misc",
    }

    NETWORK_FS: ClassVar[set[str]] = {
        "nfs",
        "nfs4",
        "cifs",
        "smb3",
        "smbfs",
        "fuse.sshfs",
        "glusterfs",
        "ceph",
        "afs",
    }

    SNAPSHOT_CAPABLE_FS: ClassVar[set[str]] = {
        FilesystemType.ZFS,
        FilesystemType.BTRFS,
        FilesystemType.CEPHFS,
        "ceph",
    }

    _instance: ClassVar[MountsManager | None] = None

    @classmethod
    def get_instance(cls) -> MountsManager:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self, mounts_file: str = "/proc/mounts") -> None:
        self._mounts_file: str = mounts_file
        self._cache: dict[str, MountInfo] | None = None

    def refresh(self) -> None:
        """Clears cached mount table to re-read on next lookup."""
        self._cache = None

    def get_all_mounts(self) -> dict[str, MountInfo]:
        """Returns a mapping of absolute normalized mount path -> MountInfo."""
        if self._cache is not None:
            return self._cache

        mounts: dict[str, MountInfo] = {}
        if not os.path.exists(self._mounts_file):
            self._cache = mounts
            return mounts

        try:
            with open(self._mounts_file, "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) >= 3:
                        device = parts[0]
                        # Handle escaped octal characters (like \040 for spaces)
                        raw_mount = parts[1]
                        try:
                            mountpoint = raw_mount.encode("utf-8").decode("unicode_escape")
                        except Exception:
                            mountpoint = raw_mount
                        norm_mp = os.path.abspath(mountpoint).rstrip("/")
                        if not norm_mp:
                            norm_mp = "/"

                        fstype = parts[2]
                        options = parts[3] if len(parts) > 3 else ""

                        mounts[norm_mp] = MountInfo(
                            mountpoint=norm_mp,
                            fstype=fstype,
                            device=device,
                            options=options,
                        )
        except OSError as exc:
            logger.debug("Failed to read mounts file '%s': %s", self._mounts_file, exc)

        self._cache = mounts
        return mounts

    def get_mount_info(self, path: str) -> MountInfo | None:
        """
        Returns MountInfo if the path is an active mountpoint, or None otherwise.
        """
        norm_path = os.path.abspath(path).rstrip("/")
        if not norm_path:
            norm_path = "/"

        all_mounts = self.get_all_mounts()
        if norm_path in all_mounts:
            return all_mounts[norm_path]

        # Fallback to os.path.ismount check
        try:
            if os.path.ismount(path):
                # If it's a mount according to kernel stat, return best effort MountInfo
                return all_mounts.get(norm_path, MountInfo(mountpoint=norm_path, fstype="unknown"))
        except OSError, ValueError:
            pass

        return None
