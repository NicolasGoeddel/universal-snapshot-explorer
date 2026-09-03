from __future__ import annotations

import datetime
import os
from typing import TYPE_CHECKING, override

from ..enums import FilesystemType
from ..logger import logger
from .nodes import FSNode, RootFolderProtocol
from .snapshot import Snapshot
from .types import FileName, FilePath, GroupId, SnapshotBarItem, UserId

if TYPE_CHECKING:
    from ..mounts import MountInfo


class Folder(FSNode):
    """Represents a directory in the filesystem."""

    does_exist: bool = True

    @property
    @override
    def is_file(self) -> bool:
        return False

    @property
    @override
    def is_folder(self) -> bool:
        return True

    @property
    def mount_info(self) -> MountInfo | None:
        if not self.path or self.path in (".", "/"):
            return None
        try:
            live_path = self._root_folder.real_path(self.path, self._root_folder.get_snapshot("Original"))
            from ..mounts import MountsManager

            return MountsManager.get_instance().get_mount_info(live_path)
        except Exception:
            return None

    @property
    @override
    def is_mount(self) -> bool:
        if not self.path or self.path in (".", "/"):
            return False
        try:
            live_path = self._root_folder.real_path(self.path, self._root_folder.get_snapshot("Original"))
            return self.mount_info is not None or os.path.ismount(live_path)
        except Exception:
            return False

    @property
    @override
    def is_kernel_fs(self) -> bool:
        info = self.mount_info
        return info is not None and info.is_kernel_pseudo_fs

    @property
    @override
    def sub_dataset_root_name(self) -> str | None:
        if not self.path or self.path in (".", "/"):
            return None
        try:
            live_path = self._root_folder.real_path(self.path, self._root_folder.get_snapshot("Original"))
            norm_path = os.path.abspath(live_path).rstrip("/")
            return self._root_folder.get_root_name_for_path(norm_path)
        except Exception:
            return None

    @property
    @override
    def is_sub_dataset(self) -> bool:
        if not self.path or self.path in (".", "/"):
            return False

        if self.sub_dataset_root_name is not None or self.is_mount:
            return True

        try:
            live_path = self._root_folder.real_path(self.path, self._root_folder.get_snapshot("Original"))
            from ..providers import ProviderRegistry

            provider = ProviderRegistry.detect_filesystem(live_path, self.mount_info)
            if provider.name != FilesystemType.GENERIC:
                return True
        except Exception:
            pass

        return False

    @property
    @override
    def has_independent_snapshots(self) -> bool:
        """Returns True if this folder is a sub-dataset or boundary with its own independent snapshots."""
        if not self.path or self.path in (".", "/"):
            return False

        if self.sub_dataset_root_name is not None:
            return True

        try:
            live_path = self._root_folder.real_path(self.path, self._root_folder.get_snapshot("Original"))
            from ..providers import ProviderRegistry

            provider = ProviderRegistry.detect_filesystem(live_path, self.mount_info)
            return provider.name != FilesystemType.GENERIC
        except Exception:
            return False

    @property
    @override
    def display_type(self) -> str | None:
        from ..providers import ProviderRegistry

        if self.sub_dataset_root_name is not None:
            child_root = self._root_folder.get_instance_by_name(self.sub_dataset_root_name)
            if child_root:
                provider = ProviderRegistry.get(child_root.config.filesystem_type)
                return provider.get_display_name(self.mount_info, is_sub_dataset=True)
            return "Snapshot Root"

        live_path = ""
        try:
            live_path = self._root_folder.real_path(self.path, self._root_folder.get_snapshot("Original"))
        except Exception:
            pass

        # Check for implicit boundary
        provider = ProviderRegistry.detect_filesystem(live_path, self.mount_info)
        if provider.name != FilesystemType.GENERIC:
            return provider.get_display_name(self.mount_info, is_sub_dataset=True)

        if self.is_mount:
            return provider.get_display_name(self.mount_info, is_sub_dataset=False)

        return self._filetype

    @override
    def _get_icon_info(self) -> tuple[str, str]:
        if self.sub_dataset_root_name is not None:
            return ("database", "icon-sub-dataset")
        if self.is_kernel_fs:
            return ("cpu", "icon-kernel-mount")

        # Check for implicit snapshot directory
        try:
            live_path = self._root_folder.real_path(self.path, self._root_folder.get_snapshot("Original"))
            from ..providers import ProviderRegistry

            provider = ProviderRegistry.detect_filesystem(live_path, self.mount_info)
            if provider.name != FilesystemType.GENERIC:
                return provider.get_icon()
        except Exception:
            pass

        if self.is_mount:
            return ("hard-drive", "icon-mount")

        from .nodes import get_icon_info

        return get_icon_info(
            name=self.name,
            is_folder=self.is_folder,
            does_exist=self.does_exist,
            is_symlink=self.is_symlink,
            symlink_is_broken=self.symlink_is_broken,
            symlink_target_is_dir=self.symlink_target_is_dir,
            filetype=self._filetype,
            mode=self.mode,
        )

    def __init__(
        self,
        root_folder: RootFolderProtocol,
        path: FilePath,
        snapshot: Snapshot,
        *,
        name: FileName,
        uid: UserId | None = None,
        gid: GroupId | None = None,
        mode: int | None = None,
        filetype: str | None = "directory",
        ctime: datetime.datetime | None = None,
        mtime: datetime.datetime | None = None,
        inode: int | None = None,
        item_count: int | None = None,
    ) -> None:
        super().__init__(
            root_folder,
            path,
            snapshot,
            name=name,
            uid=uid,
            gid=gid,
            mode=mode,
            filetype=filetype,
            ctime=ctime,
            mtime=mtime,
            inode=inode,
        )
        self._item_count: int | None = item_count
        self.exception: Exception | None = None
        self.success: bool = False
        self.message: str = ""
        self.children: dict[FileName, FSNode] | None = None
        self.all_filenames: set[FileName] = set()

    @property
    def item_count(self) -> int | None:
        if self._item_count is None:
            try:
                self._item_count = len(self._root_folder.list_dir_names(self.path, self.snapshot))
            except Exception:
                self._item_count = None
        return self._item_count

    @property
    @override
    def size(self) -> int | None:
        """Returns the number of items in this folder (for template compatibility)."""
        if self.has_independent_snapshots:
            return None
        return self.item_count

    @property
    @override
    def snapshots_bar(self) -> list[SnapshotBarItem]:
        if self.is_sub_dataset:
            if self.sub_dataset_root_name is not None:
                child_root = self._root_folder.get_instance_by_name(self.sub_dataset_root_name)
                if child_root:
                    return child_root.get_file(path="").snapshots_bar

            try:
                live_path = self._root_folder.real_path(self.path, self._root_folder.get_snapshot("Original"))
                from ..providers import ProviderRegistry

                provider = ProviderRegistry.detect_filesystem(live_path, self.mount_info)
                if provider.name != FilesystemType.GENERIC:
                    base_name = self._root_folder.logical_base_name or self._root_folder.get_root_name_for_path(self._root_folder.root_path) or ""
                    rel_logical = os.path.join(self._root_folder.logical_sub_path or "", self.logical_path).strip("/")
                    is_net = self.mount_info.is_network_fs if self.mount_info else False
                    shadow_rf = self._root_folder.get_shadow_instance(base_name, rel_logical, live_path, provider.name, is_network=is_net)
                    return shadow_rf.get_file(path="").snapshots_bar
            except Exception:
                pass
            return []

        return super().snapshots_bar

    def __getitem__(self, filename: FileName) -> FSNode:
        if self.children is None:
            _ = self.update()
        if self.children is not None and filename in self.children:
            return self.children[filename]
        return self._root_folder.get_file(path=os.path.join(self.path, filename), snapshot=self.snapshot)

    def __contains__(self, filename: FileName) -> bool:
        if self.children is None:
            _ = self.update()
        return self.children is not None and filename in self.children

    def content(self) -> list[FileName]:
        _ = self.update()

        def sort_key(name: FileName) -> tuple[int, str]:
            node = self[name]
            is_dir = node.is_folder
            return (0 if is_dir else 1, name.lower())

        return sorted(self.all_filenames, key=sort_key)

    def update(self) -> dict[FileName, FSNode] | None:
        """
        Reads directory entries and hydrates the children dictionary.

        This method is used to fully hydrate a single directory view for the current
        active snapshot, constructing rich FSNode objects (carrying permissions, owners,
        MIME types, etc.) to be rendered in the main explorer table.
        The special control directory (e.g. '.zfs' or '.snapshots') is always filtered out.
        """
        if self.children is not None:
            return self.children

        absolute_path = self._root_folder.real_path(self.path, self.snapshot)
        self.children = {}

        try:
            with os.scandir(absolute_path) as it:
                for entry in it:
                    if entry.name == self._root_folder.control_dir_name:
                        continue
                    self.children[entry.name] = self._root_folder.get_file(
                        path=os.path.join(self.path, entry.name),
                        stat_info=entry.stat(follow_symlinks=False),
                        snapshot=self.snapshot,
                    )
            self.success = True
            self.message = f"Successfully read folder '{absolute_path}'."
            self._item_count = len(self.children)
        except FileNotFoundError as exc:
            self.exception = exc
            self.success = False
            self.message = f"Directory '{absolute_path}' not found."
            logger.debug("%s", self.message, exc_info=True)
        except PermissionError as exc:
            self.exception = exc
            self.success = False
            self.message = f"Permission error while accessing '{absolute_path}'."
            logger.warning("%s", self.message, exc_info=True)
        except OSError as exc:
            self.exception = exc
            self.success = False
            self.message = f"I/O error while accessing '{absolute_path}'."
            logger.exception("%s", self.message)

        # Collect all filenames across all snapshots efficiently without scanning/stating siblings
        self.all_filenames = set(self.children.keys())
        for snapshot in self._root_folder.snapshots():
            if snapshot == self.snapshot:
                continue
            self.all_filenames.update(self._root_folder.list_dir_names(self.path, snapshot))

        return self.children
