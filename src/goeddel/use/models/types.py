from __future__ import annotations

from typing import TYPE_CHECKING, TypedDict

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


# Template view models
class SnapshotBarItem(TypedDict):
    color: str
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
