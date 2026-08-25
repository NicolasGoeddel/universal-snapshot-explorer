from __future__ import annotations

import datetime
import math
import os
import stat
from typing import override

from .node import FSNode, RootFolderProtocol, guess_filetype
from .snapshot import Snapshot
from .types import FileName, FilePath, GroupId, UserId


class File(FSNode):
    """Represents a regular file or symlink in the filesystem."""

    does_exist: bool = True

    @property
    @override
    def is_file(self) -> bool:
        return True

    @property
    @override
    def is_folder(self) -> bool:
        return False

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
        filetype: str | None = None,
        is_symlink: bool = False,
        symlink_target: str | None = None,
        ctime: datetime.datetime | None = None,
        mtime: datetime.datetime | None = None,
        inode: int | None = None,
        size: int | None = None,
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
        self._is_symlink: bool = is_symlink
        self._symlink_target: str | None = symlink_target
        self._filetype: str | None = filetype
        self._size: int | None = size
        self._symlink_checked: bool = False
        self._symlink_is_broken: bool = False
        self._symlink_target_is_dir: bool = False
        self._symlink_resolved_subpath: str | None = None
        self._symlink_resolved_parent_subpath: str | None = None
        self._symlink_target_filename: str | None = None
        self._symlink_final_real_path: str | None = None

    def _check_symlink(self) -> None:
        if self._symlink_checked:
            return
        self._symlink_checked = True
        if not self._is_symlink or not self._symlink_target:
            return

        root_real_path = os.path.abspath(self._root_folder.real_path("", self.snapshot))

        # 1. Determine immediate relative subpath of the symlink target inside the ZFS root
        if self._symlink_target.startswith("/"):
            immediate_subpath = os.path.normpath(self._symlink_target.lstrip("/"))
        else:
            parent_dir = os.path.dirname(self.path)
            immediate_subpath = os.path.normpath(os.path.join(parent_dir, self._symlink_target))

        if not immediate_subpath.startswith(".."):
            self._symlink_resolved_subpath = "" if immediate_subpath == "." else immediate_subpath
            self._symlink_resolved_parent_subpath = os.path.dirname(self._symlink_resolved_subpath)
            self._symlink_target_filename = os.path.basename(self._symlink_resolved_subpath)
        else:
            self._symlink_resolved_subpath = None
            self._symlink_resolved_parent_subpath = None
            self._symlink_target_filename = None

        # 2. Resolve symlink chain within the snapshot root (up to 16 hops to prevent circular symlink loops)
        current_subpath = immediate_subpath
        depth = 0
        max_depth = 16
        final_stat: os.stat_result | None = None
        final_real_path: str | None = None

        while depth < max_depth:
            depth += 1
            if current_subpath.startswith(".."):
                # Escapes outside the snapshot root
                real_target = os.path.normpath(os.path.join(root_real_path, current_subpath))
                try:
                    final_stat = os.stat(real_target)
                    final_real_path = real_target
                except OSError:
                    final_stat = None
                    final_real_path = None
                break

            real_target = os.path.join(root_real_path, current_subpath)
            try:
                st = os.lstat(real_target)
            except OSError:
                final_stat = None
                final_real_path = None
                break

            if stat.S_ISLNK(st.st_mode):
                try:
                    next_target = os.readlink(real_target)
                except OSError:
                    final_stat = None
                    final_real_path = None
                    break

                if next_target.startswith("/"):
                    current_subpath = os.path.normpath(next_target.lstrip("/"))
                else:
                    parent_dir = os.path.dirname(current_subpath)
                    current_subpath = os.path.normpath(os.path.join(parent_dir, next_target))
            else:
                # Reached actual target file or directory
                final_stat = st
                final_real_path = real_target
                break

        if final_stat is not None and final_real_path is not None:
            self._symlink_is_broken = False
            self._symlink_target_is_dir = stat.S_ISDIR(final_stat.st_mode)
            self._symlink_final_real_path = final_real_path
        else:
            self._symlink_is_broken = True
            self._symlink_target_is_dir = False
            self._symlink_final_real_path = None

    @property
    @override
    def is_symlink(self) -> bool:
        return self._is_symlink

    @property
    @override
    def symlink_target(self) -> str | None:
        return self._symlink_target

    @property
    @override
    def symlink_is_broken(self) -> bool:
        self._check_symlink()
        return self._symlink_is_broken

    @property
    @override
    def symlink_target_is_dir(self) -> bool:
        self._check_symlink()
        return self._symlink_target_is_dir

    @property
    @override
    def symlink_resolved_subpath(self) -> str | None:
        self._check_symlink()
        return self._symlink_resolved_subpath

    @property
    @override
    def symlink_resolved_parent_subpath(self) -> str | None:
        self._check_symlink()
        return self._symlink_resolved_parent_subpath

    @property
    @override
    def symlink_target_filename(self) -> str | None:
        self._check_symlink()
        return self._symlink_target_filename

    @property
    @override
    def symlink_final_real_path(self) -> str | None:
        self._check_symlink()
        return self._symlink_final_real_path

    @property
    @override
    def filetype(self) -> str | None:
        if self._filetype is None:
            if self._is_symlink:
                self._filetype = "inode/symlink"
            else:
                self._filetype = guess_filetype(self.name, self.mode)
        return self._filetype

    @property
    @override
    def size(self) -> int | None:
        return self._size

    @property
    @override
    def size_human(self) -> str | None:
        if self._size is None:
            return None
        units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
        magnitude: int = 0
        if self._size > 0:
            magnitude = min(int(math.log2(self._size) / 10), len(units) - 1)
        unit: str = units[magnitude]
        if magnitude == 0:
            return f"{self._size} {unit}"
        return f"{self._size / (1024 ** magnitude):.2f} {unit}"
