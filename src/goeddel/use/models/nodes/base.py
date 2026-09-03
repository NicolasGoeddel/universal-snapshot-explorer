from __future__ import annotations

import datetime
import os
from collections.abc import Generator
from dataclasses import dataclass
from typing import Protocol, override

from ...config import RootConfig
from ...enums import ChangedAttribute
from ..snapshot import Snapshot
from ..types import (
    FileName,
    FilePath,
    GroupId,
    GroupName,
    SnapshotBarItem,
    UserId,
    UserName,
)


@dataclass(frozen=True)
class SnapshotVersionDetail:
    """Represents the diff state of a file in a single snapshot relative to its chronological predecessor."""

    entry: FSNode
    prev_entry: FSNode | None
    color: str
    is_created: bool
    is_deleted: bool
    is_missing: bool
    changed_attributes: set[ChangedAttribute]


class RootFolderProtocol(Protocol):
    """Structural protocol for root folder interactions needed by nodes."""

    @property
    def logical_base_name(self) -> str | None: ...
    @property
    def logical_sub_path(self) -> str | None: ...
    @property
    def root_path(self) -> str: ...
    @property
    def config(self) -> RootConfig: ...
    @property
    def control_dir_name(self) -> str: ...

    def get_instance_by_name(self, name: str) -> RootFolderProtocol | None: ...
    def get_shadow_instance(
        self,
        base_root_name: str,
        boundary_path: str,
        physical_path: str,
        fstype: str,
        is_network: bool = False,
    ) -> RootFolderProtocol: ...
    def real_path(self, path: FilePath | None = None, snapshot: Snapshot | None = None) -> str: ...
    def get_username(self, uid: UserId, snapshot: str | Snapshot | None = None) -> UserName: ...
    def get_groupname(self, gid: GroupId, snapshot: str | Snapshot | None = None) -> GroupName: ...
    def get_mime_type(self, real_path: str) -> str: ...
    def snapshots(self) -> list[Snapshot]: ...
    def snapshots_chronological(self) -> list[Snapshot]: ...
    def list_dir_names(self, path: FilePath, snapshot: str | Snapshot | None = None) -> set[FileName]: ...
    def get_snapshot(self, snapshot: str | Snapshot | None = None) -> Snapshot: ...
    def get_root_name_for_path(self, path: str) -> str | None: ...
    def has_root_name_for_path(self, path: str) -> bool: ...
    def get_file(
        self,
        *,
        path: FilePath,
        stat_info: os.stat_result | None = None,
        snapshot: str | Snapshot | None = None,
    ) -> FSNode: ...


class FSNode:
    """Base class for all filesystem entries (files, directories, missing paths)."""

    does_exist: bool = True

    @property
    def is_file(self) -> bool:
        return False

    @property
    def is_folder(self) -> bool:
        return False

    @property
    def has_independent_snapshots(self) -> bool:
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
        ctime: datetime.datetime | None = None,
        mtime: datetime.datetime | None = None,
        inode: int | None = None,
    ) -> None:
        self._root_folder: RootFolderProtocol = root_folder
        self.path: FilePath = path
        self.snapshot: Snapshot = snapshot

        self.name: FileName = name
        self.uid: UserId | None = uid
        self.gid: GroupId | None = gid
        self.mode: int | None = mode
        self._filetype: str | None = filetype
        self.ctime: datetime.datetime | None = ctime
        self.mtime: datetime.datetime | None = mtime
        self.inode: int | None = inode

    @property
    def root_folder(self) -> RootFolderProtocol:
        return self._root_folder

    @property
    def logical_path(self) -> str:
        """Returns the full logical path including the shadow root's base if applicable."""
        sub = self._root_folder.logical_sub_path
        if sub:
            return f"{sub}/{self.path}".strip("/")
        return self.path

    @property
    def is_symlink(self) -> bool:
        return False

    @property
    def symlink_target(self) -> str | None:
        return None

    @property
    def symlink_is_broken(self) -> bool:
        return False

    @property
    def symlink_target_is_dir(self) -> bool:
        return False

    @property
    def symlink_resolved_subpath(self) -> str | None:
        return None

    @property
    def symlink_resolved_parent_subpath(self) -> str | None:
        return None

    @property
    def symlink_target_filename(self) -> str | None:
        return None

    @property
    def symlink_final_real_path(self) -> str | None:
        return None

    @property
    def is_hidden(self) -> bool:
        """Returns True if this filesystem entry is hidden (starts with a dot)."""
        return self.name.startswith(".") and self.name not in (".", "..")

    @property
    def is_sub_dataset(self) -> bool:
        """Returns True if this directory is a sub-dataset, subvolume, or mountpoint."""
        return False

    @property
    def sub_dataset_root_name(self) -> str | None:
        """Returns the configured root name of the sub-dataset if available."""
        return None

    @property
    def is_mount(self) -> bool:
        """Returns True if this node is a filesystem mountpoint."""
        return False

    @property
    def is_kernel_fs(self) -> bool:
        """Returns True if this node is a kernel pseudo-filesystem (e.g. proc, sysfs)."""
        return False

    @property
    def display_type(self) -> str | None:
        """Returns the human-readable type description (e.g. 'ZFS Dataset', 'Kernel Mount (procfs)')."""
        return self._filetype

    @property
    def icon_name(self) -> str:
        return self._get_icon_info()[0]

    @property
    def icon_class(self) -> str:
        return self._get_icon_info()[1]

    def _get_icon_info(self) -> tuple[str, str]:
        if self.sub_dataset_root_name is not None:
            return ("database", "icon-sub-dataset")
        if self.is_kernel_fs:
            return ("cpu", "icon-kernel-mount")
        if self.is_mount:
            return ("hard-drive", "icon-mount")

        from .utils import get_icon_info

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

    @property
    def filetype(self) -> str | None:
        return self._filetype

    @property
    def parent_path(self) -> str:
        return os.path.dirname(self.path)

    @property
    def snapshots_count(self) -> int:
        return len(self._root_folder.snapshots())

    @property
    def is_accessible(self) -> bool:
        """Returns True if the current process has read permission for this node."""
        if not self.does_exist:
            return True
        try:
            real_path = self._root_folder.real_path(self.path, self.snapshot)
            if self.is_symlink:
                return os.access(real_path, os.R_OK, follow_symlinks=False)
            return os.access(real_path, os.R_OK)
        except OSError:
            return False

    @property
    def size(self) -> int | None:
        return None

    @property
    def size_human(self) -> str | None:
        return None

    def get_sibling(self, snapshot: Snapshot) -> FSNode:
        return self._root_folder.get_file(path=self.path, snapshot=snapshot)

    def siblings(self) -> Generator[FSNode, None, None]:
        for snapshot in self._root_folder.snapshots():
            yield self.get_sibling(snapshot)

    @override
    def __eq__(self, o: object) -> bool:
        if isinstance(o, FSNode):
            return all(
                (
                    self.name == o.name,
                    self.uid == o.uid,
                    self.gid == o.gid,
                    self.mode == o.mode,
                    self.ctime == o.ctime,
                    self.mtime == o.mtime,
                    self.size == o.size,
                    self.does_exist == o.does_exist,
                    self.is_file == o.is_file,
                    self.is_folder == o.is_folder,
                )
            )
        return False

    def compare(self, o: object) -> set[ChangedAttribute]:
        if not isinstance(o, FSNode):
            raise ValueError(f"Cannot compare {o.__class__} with {self.__class__}")
        changed_attributes: set[ChangedAttribute] = set()
        if self.name != o.name:
            changed_attributes.add(ChangedAttribute.NAME)
        if self.uid != o.uid:
            changed_attributes.add(ChangedAttribute.UID)
        if self.gid != o.gid:
            changed_attributes.add(ChangedAttribute.GID)
        if self.mode != o.mode:
            changed_attributes.add(ChangedAttribute.MODE)
        if self.ctime != o.ctime:
            changed_attributes.add(ChangedAttribute.CTIME)
        if self.mtime != o.mtime:
            changed_attributes.add(ChangedAttribute.MTIME)
        if self.size != o.size:
            changed_attributes.add(ChangedAttribute.SIZE)
        if self.does_exist != o.does_exist:
            changed_attributes.add(ChangedAttribute.DOES_EXIST)
        return changed_attributes

    @property
    def owner(self) -> UserName:
        if self.uid is None:
            return ""
        return self._root_folder.get_username(self.uid, self.snapshot)

    @property
    def group(self) -> GroupName:
        if self.gid is None:
            return ""
        return self._root_folder.get_groupname(self.gid, self.snapshot)

    @property
    def mode_human(self) -> str | None:
        if self.mode is None:
            return None
        perms = ["r", "w", "x"]
        result = ""
        for i in range(3):
            triplet = (self.mode >> (6 - 3 * i)) & 0b111
            result += "".join(perms[j] if triplet & (1 << (2 - j)) else "-" for j in range(3))
        return result

    @property
    def mode_octal(self) -> str | None:
        if self.mode is None:
            return None
        return oct(self.mode)[2:].zfill(4)

    @property
    def id(self) -> int:
        return abs(hash(self.path))

    def version_history(self, reverse: bool = True) -> list[SnapshotVersionDetail]:
        """
        Calculates chronological version diffs for this node across all snapshots.
        Returns the list in display order (reverse=True means newest/Original first).
        """
        chronological_snaps = self._root_folder.snapshots_chronological()
        results: list[SnapshotVersionDetail] = []
        color_index = 0
        colors = ["var(--snap-1)", "var(--snap-2)", "var(--snap-3)", "var(--snap-4)", "var(--snap-5)", "var(--snap-6)"]
        prev_node: FSNode | None = None

        for i, snap in enumerate(chronological_snaps):
            curr_node = self._root_folder.get_file(path=self.path, snapshot=snap)
            is_created = False
            is_deleted = False
            changed_attrs: set[ChangedAttribute] = set()

            if prev_node is not None:
                if not prev_node.does_exist and curr_node.does_exist:
                    is_created = True
                    if i > 0:
                        color_index += 1
                elif prev_node.does_exist and not curr_node.does_exist:
                    is_deleted = True
                elif curr_node.does_exist and prev_node.does_exist:
                    changed_attrs = curr_node.compare(prev_node)
                    if changed_attrs:
                        color_index += 1

            color = colors[color_index % len(colors)] if curr_node.does_exist else "var(--snap-missing)"
            results.append(
                SnapshotVersionDetail(
                    entry=curr_node,
                    prev_entry=prev_node,
                    color=color,
                    is_created=is_created,
                    is_deleted=is_deleted,
                    is_missing=not curr_node.does_exist,
                    changed_attributes=changed_attrs,
                )
            )
            prev_node = curr_node

        if reverse:
            return list(reversed(results))
        return results

    @property
    def snapshots_bar(self) -> list[SnapshotBarItem]:
        # TODO Externalize into a view class
        results: list[SnapshotBarItem] = []
        color_index = 0
        colors = ["var(--snap-1)", "var(--snap-2)", "var(--snap-3)", "var(--snap-4)", "var(--snap-5)", "var(--snap-6)"]
        previous_file: FSNode | None = None

        for i, file in enumerate(self.siblings()):
            if not file.does_exist:
                results.append({"color": "var(--snap-missing)", "snapshot": file.snapshot, "missing": True})
                previous_file = file
                continue

            if i > 0:
                if previous_file is not None and not previous_file.does_exist:
                    color_index += 1
                elif file != previous_file:
                    color_index += 1
            results.append({"color": colors[color_index % len(colors)], "snapshot": file.snapshot, "missing": False})
            previous_file = file

        return results
