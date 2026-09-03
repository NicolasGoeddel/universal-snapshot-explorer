from __future__ import annotations

import os
from typing import TYPE_CHECKING, override

from ..enums import FilesystemType, ProviderType
from .base import FilesystemProvider

if TYPE_CHECKING:
    from ..config import RootConfig
    from ..models.snapshot_provider import ISnapshotProvider
    from ..mounts import MountInfo


class BtrfsProvider(FilesystemProvider):
    @property
    @override
    def name(self) -> FilesystemType:
        return FilesystemType.BTRFS

    @override
    def detect_boundary(self, live_path: str, mount_info: MountInfo | None) -> bool:
        if not live_path:
            return False
        return os.path.isdir(os.path.join(live_path, ".snapshots"))

    @override
    def get_display_name(self, mount_info: MountInfo | None, is_sub_dataset: bool = False) -> str:
        if is_sub_dataset or mount_info is None:
            return "Btrfs Subvolume"
        return "Btrfs Mount (unconfigured)"

    @override
    def get_icon(self) -> tuple[str, str]:
        # Often btrfs boundaries are also mountpoints (so they might get hard-drive),
        # but implicitly discovered ones get database.
        return ("database", "icon-implicit-dataset")

    @override
    def create_snapshot_provider(self, config: RootConfig) -> ISnapshotProvider:
        if config.provider_type == ProviderType.FILESYSTEM:
            from ..models.snapshot_provider import FilesystemSnapshotProvider

            return FilesystemSnapshotProvider()

        from ..btrfs.provider import BtrfsSnapshotProvider

        return BtrfsSnapshotProvider()
