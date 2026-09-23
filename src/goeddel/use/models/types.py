from __future__ import annotations

from typing import TYPE_CHECKING, NotRequired, TypedDict

from ..enums import FilesystemType, RootGroupType

if TYPE_CHECKING:
    from .snapshot import Snapshot

# User and group identifiers
type UserId = int
type UserName = str
type GroupId = int
type GroupName = str

type UserMap = dict[UserId, UserName]
type GroupMap = dict[GroupId, GroupName]

# Snapshot and path identifiers
type SnapshotId = str
type SnapshotName = str
type FilePath = str
type FileName = str
type RootName = str

type PathCacheKey = tuple[FilePath, Snapshot]


SNAPSHOT_COLORS: int = 6


# Template view models
class SnapshotBarItem(TypedDict):
    color: int | None
    snapshot: Snapshot
    missing: bool


class BreadcrumbPath(TypedDict):
    name: str
    path: str
    separator: bool | str
    is_current: bool
    is_boundary: bool
    icon_name: str | None
    icon_class: str | None


class BreadcrumbsData(TypedDict):
    root: dict[str, str]
    current_path: str
    snapshot: Snapshot
    snapshots: list[Snapshot]
    paths: list[BreadcrumbPath]
    all_roots: list[RootName]


class SnapshotStateInfo(TypedDict):
    id: str
    name: str
    index: int
    timestamp: str | None


class SymlinkInfo(TypedDict, total=False):
    """The symlink-specific fields of a SnapshotStateEntry. Its own type so it
    can be built independently (e.g. FSNode.symlink_info) and merged in via
    ``**symlink_info`` object-expansion without losing type checking."""

    symlink_target: str | None
    symlink_is_broken: bool
    symlink_target_is_dir: bool
    symlink_resolved_subpath: str | None
    symlink_resolved_parent_subpath: str | None
    symlink_target_filename: str | None


class SnapshotStateEntry(SymlinkInfo):
    """One entry's metadata, as returned by RootFolder.get_snapshot_state() for
    instantaneous frontend updates on snapshot switch (see explorer.js)."""

    does_exist: bool
    is_folder: bool
    is_sub_dataset: bool
    is_symlink: bool
    is_accessible: bool
    icon_name: str
    icon_class: str
    size_human: str
    size: int
    owner: str
    group: str
    mode_human: str
    mode_octal: str
    mtime_fmt: str
    mtime_iso: str
    ctime_fmt: str
    ctime_iso: str
    has_independent_snapshots: NotRequired[bool]
    # Filled in by the /api/snapshot-state route, not by get_snapshot_state() itself.
    icon_svg: NotRequired[str]


class SnapshotStateResponse(TypedDict):
    snapshot: SnapshotStateInfo
    folder_exists: bool
    entries: dict[str, SnapshotStateEntry]


class RootViewItem(TypedDict):
    name: RootName
    root_path: str
    sub_path: str
    snapshots_count: int
    is_mounted: bool
    parent_name: str | None
    level: int
    has_children: bool
    display_name: str
    group_type: RootGroupType
    is_group_header: bool
    dataset_name: str | None
    filesystem_type: FilesystemType
