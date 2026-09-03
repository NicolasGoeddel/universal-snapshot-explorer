from __future__ import annotations

from typing import TYPE_CHECKING, override

from ..enums import FilesystemType
from .base import FilesystemProvider

if TYPE_CHECKING:
    from ..config import RootConfig
    from ..models.snapshot_provider import ISnapshotProvider
    from ..mounts import MountInfo


class GenericProvider(FilesystemProvider):
    @property
    @override
    def name(self) -> FilesystemType:
        return FilesystemType.GENERIC

    @override
    def detect_boundary(self, live_path: str, mount_info: MountInfo | None) -> bool:
        # The generic provider acts as the fallback and does not dynamically detect boundaries
        return False

    @override
    def get_display_name(self, mount_info: MountInfo | None, is_sub_dataset: bool = False) -> str:
        if mount_info is None:
            return "Snapshot Root"

        fstype = mount_info.fstype if mount_info else "unknown"
        if mount_info and mount_info.is_kernel_pseudo_fs:
            return f"Kernel Mount ({fstype})"
        if fstype in ("nfs", "nfs4"):
            return f"NFS Mount ({fstype})"
        if fstype in ("cifs", "smb3", "smbfs"):
            return "CIFS/SMB Mount"
        if fstype == "tmpfs":
            return "tmpfs Mount"
        if fstype == FilesystemType.ZFS:
            return "ZFS Dataset (unconfigured)"
        if fstype == FilesystemType.BTRFS:
            return "Btrfs Mount (unconfigured)"
        return f"Mount ({fstype})"

    @override
    def get_icon(self) -> tuple[str, str]:
        # Usually generic boundaries are just mounts.
        # But if they aren't mounts (some generic fallback), we use hard-drive.
        return ("hard-drive", "icon-mount")

    @override
    def create_snapshot_provider(self, config: RootConfig) -> ISnapshotProvider:
        from ..models.snapshot_provider import FilesystemSnapshotProvider

        return FilesystemSnapshotProvider()
