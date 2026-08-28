from __future__ import annotations

import os
from typing import override

from ..snapshot import Snapshot
from ..types import (
    FileName,
    FilePath,
)
from .base import FSNode, RootFolderProtocol


class MissingNode(FSNode):
    """Represents a path that does not exist in a given snapshot."""

    does_exist: bool = False

    def __init__(
        self,
        root_folder: RootFolderProtocol,
        path: FilePath,
        snapshot: Snapshot,
        *,
        name: FileName,
    ) -> None:
        super().__init__(
            root_folder,
            path,
            snapshot,
            name=name,
            uid=None,
            gid=None,
            mode=None,
            filetype=None,
            ctime=None,
            mtime=None,
            inode=None,
        )
        self._is_folder: bool | None = None
        self.success: bool = True
        self.exception: Exception | None = None
        self.message: str = ""

    @property
    @override
    def is_folder(self) -> bool:
        if self._is_folder is not None:
            return self._is_folder
        for snap in self._root_folder.snapshots():
            if snap == self.snapshot:
                continue
            sibling = self._root_folder.get_file(path=self.path, snapshot=snap)
            if sibling.does_exist:
                self._is_folder = sibling.is_folder
                return self._is_folder
        self._is_folder = False
        return False

    @property
    @override
    def is_file(self) -> bool:
        return not self.is_folder

    def content(self) -> list[FileName]:
        """Collects all filenames that exist in other snapshots for this folder path."""
        if not self.is_folder:
            return []
        filenames: set[FileName] = set()
        for snap in self._root_folder.snapshots():
            filenames.update(self._root_folder.list_dir_names(self.path, snap))

        def sort_key(name: FileName) -> tuple[int, str]:
            node = self[name]
            is_dir = node.is_folder
            return (0 if is_dir else 1, name.lower())

        return sorted(filenames, key=sort_key)

    def __getitem__(self, filename: FileName) -> FSNode:
        return self._root_folder.get_file(path=os.path.join(self.path, filename), snapshot=self.snapshot)

    def __contains__(self, filename: FileName) -> bool:
        return filename in self.content()
