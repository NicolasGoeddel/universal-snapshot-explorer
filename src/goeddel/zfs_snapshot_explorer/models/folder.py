from __future__ import annotations

import datetime
import os
from typing import override

from ..logger import logger
from .node import FSNode, RootFolderProtocol
from .snapshot import Snapshot
from .types import FileName, FilePath, GroupId, UserId


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
    @override
    def is_sub_dataset(self) -> bool:
        if not self.path or self.path == "." or self.path == "/":
            return False
        try:
            # We check the Original (live) view path to see if it is a mountpoint or a registered sub-dataset root
            live_path = self._root_folder.real_path(self.path, self._root_folder.get_snapshot("Original"))
            if os.path.ismount(live_path):
                return True
            norm_path = os.path.abspath(live_path).rstrip("/")
            return self._root_folder.has_root_name_for_path(norm_path)
        except Exception:
            return False

    @property
    @override
    def sub_dataset_root_name(self) -> str | None:
        if not self.is_sub_dataset:
            return None
        try:
            live_path = self._root_folder.real_path(self.path, self._root_folder.get_snapshot("Original"))
            # Canonicalize path
            norm_path = os.path.abspath(live_path).rstrip("/")
            return self._root_folder.get_root_name_for_path(norm_path)
        except Exception:
            return None

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
            real_path = self._root_folder.real_path(self.path, self.snapshot)
            try:
                self._item_count = len(os.listdir(real_path))
            except (PermissionError, OSError):
                self._item_count = None
        return self._item_count

    @property
    @override
    def size(self) -> int | None:
        """Returns the number of items in this folder (for template compatibility)."""
        return self.item_count

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
        The special '.zfs' system directory is always filtered out.
        """
        if self.children is not None:
            return self.children

        absolute_path = self._root_folder.real_path(self.path, self.snapshot)
        self.children = {}

        try:
            with os.scandir(absolute_path) as it:
                for entry in it:
                    if entry.name == ".zfs":
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
