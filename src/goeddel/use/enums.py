from __future__ import annotations

from enum import StrEnum


class FilesystemType(StrEnum):
    """Filesystem types supported by Universal Snapshot Explorer."""

    ZFS = "zfs"
    BTRFS = "btrfs"
    CEPHFS = "cephfs"
    GENERIC = "generic"


class ProviderType(StrEnum):
    """Snapshot provider resolution strategy."""

    AUTO = "auto"
    CLI = "cli"
    FILESYSTEM = "filesystem"


class RootGroupType(StrEnum):
    """Origin/grouping classification for root folders in the overview."""

    ZFS = "zfs"
    BTRFS = "btrfs"
    CUSTOM = "custom"
    GROUP_HEADER = "group_header"


class StructureMode(StrEnum):
    """Folder packaging layout in downloaded ZIP archives."""

    RELATIVE = "relative"
    ABSOLUTE = "absolute"
    FLAT = "flat"


class CompressionMode(StrEnum):
    """Compression algorithm for ZIP archives."""

    DEFLATE = "deflate"
    STORE = "store"


class ChangedAttribute(StrEnum):
    """File metadata attributes that can change between snapshot versions."""

    NAME = "name"
    UID = "uid"
    GID = "gid"
    MODE = "mode"
    CTIME = "ctime"
    MTIME = "mtime"
    SIZE = "size"
    DOES_EXIST = "does_exist"


class LogLevel(StrEnum):
    """Application logging severity levels."""

    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class Language(StrEnum):
    """Supported user interface languages."""

    EN = "en"
    DE = "de"
