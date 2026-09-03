from __future__ import annotations

import os
from typing import TYPE_CHECKING, override

from ..enums import FilesystemType, ProviderType
from .base import FilesystemProvider

if TYPE_CHECKING:
    from ..config import RootConfig
    from ..models.snapshot_provider import ISnapshotProvider
    from ..mounts import MountInfo


class ZfsProvider(FilesystemProvider):
    @property
    @override
    def name(self) -> FilesystemType:
        return FilesystemType.ZFS

    @override
    def detect_boundary(self, live_path: str, mount_info: MountInfo | None) -> bool:
        if not live_path:
            return False
        return os.path.isdir(os.path.join(live_path, ".zfs", "snapshot")) or os.path.isdir(os.path.join(live_path, ".zfs"))

    @override
    def get_display_name(self, mount_info: MountInfo | None, is_sub_dataset: bool = False) -> str:
        if mount_info and mount_info.is_network_fs:
            return f"ZFS Dataset ({mount_info.fstype.upper()})"
        return "ZFS Dataset"

    @override
    def get_icon(self) -> tuple[str, str]:
        return ("database", "icon-implicit-dataset")

    @override
    def create_snapshot_provider(self, config: RootConfig) -> ISnapshotProvider:
        # If it's explicitly set to filesystem or if we auto-detected a network mount (which uses filesystem provider type)
        if config.provider_type == ProviderType.FILESYSTEM:
            from ..models.snapshot_provider import FilesystemSnapshotProvider

            return FilesystemSnapshotProvider()

        from ..zfs.provider import ZfsCliSnapshotProvider

        return ZfsCliSnapshotProvider(dataset_name=config.dataset_name)
