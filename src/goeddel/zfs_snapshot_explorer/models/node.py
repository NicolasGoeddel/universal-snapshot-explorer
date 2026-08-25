from __future__ import annotations

import datetime
import mimetypes
import os
from collections.abc import Generator
from dataclasses import dataclass
from typing import Protocol, override

from .snapshot import Snapshot
from .types import (
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
    changed_attributes: set[str]


class RootFolderProtocol(Protocol):
    """Structural protocol for root folder interactions needed by nodes."""

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


_EXTRA_EXT_MIMES: dict[str, str] = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".rst": "text/x-rst",
    ".log": "text/plain",
    ".env": "text/plain",
    ".conf": "text/plain",
    ".cfg": "text/plain",
    ".ini": "text/plain",
    ".lock": "text/plain",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".toml": "application/toml",
    ".ts": "application/typescript",
    ".tsx": "application/typescript",
    ".jsx": "text/jsx",
    ".rs": "text/x-rust",
    ".go": "text/x-go",
    ".kt": "text/x-kotlin",
    ".swift": "text/x-swift",
    ".lua": "text/x-lua",
    ".sql": "application/sql",
    ".zst": "application/zstd",
}

_KNOWN_FILENAMES: dict[str, str] = {
    "makefile": "text/x-makefile",
    "dockerfile": "text/x-dockerfile",
    "hosts": "text/plain",
    "fstab": "text/plain",
    "passwd": "text/plain",
    "group": "text/plain",
    "shadow": "text/plain",
    "license": "text/plain",
    "readme": "text/markdown",
    "gemfile": "text/plain",
    "cmakelists.txt": "text/plain",
    ".bashrc": "text/x-shellscript",
    ".zshrc": "text/x-shellscript",
    ".profile": "text/x-shellscript",
    ".gitignore": "text/plain",
}

_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff", ".avif")
_VIDEO_EXTS = (".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".flv", ".m4v")
_AUDIO_EXTS = (".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a", ".wma", ".opus")
_ARCHIVE_EXTS = (
    ".zip", ".tar", ".gz", ".tgz", ".bz2", ".tbz2", ".xz", ".txz",
    ".7z", ".rar", ".iso", ".zst", ".deb", ".rpm"
)
_SPREADSHEET_EXTS = (".csv", ".tsv", ".xls", ".xlsx", ".ods")
_CODE_EXTS = (
    ".py", ".sh", ".bash", ".zsh", ".js", ".ts", ".jsx", ".tsx", ".html", ".htm",
    ".css", ".scss", ".sass", ".c", ".cpp", ".h", ".hpp", ".rs", ".go", ".php",
    ".java", ".kt", ".swift", ".rb", ".pl", ".lua", ".sql", ".dockerfile"
)
_CONFIG_EXTS = (".yaml", ".yml", ".json", ".toml", ".ini", ".conf", ".cfg", ".xml", ".env", ".properties")
_DOC_EXTS = (".txt", ".md", ".markdown", ".rst", ".doc", ".docx", ".odt", ".rtf", ".tex", ".log")
_BIN_EXTS = (".bin", ".exe", ".elf", ".so", ".dylib", ".dll", ".o", ".a")


def guess_filetype(name: str, mode: int | None = None) -> str:
    """Fast, zero-I/O MIME type determination based on filename, extension, and permissions."""
    lower_name = name.lower()
    if lower_name in _KNOWN_FILENAMES:
        return _KNOWN_FILENAMES[lower_name]

    for ext, mime in _EXTRA_EXT_MIMES.items():
        if lower_name.endswith(ext):
            return mime

    mime, _ = mimetypes.guess_type(name)
    if mime:
        return mime

    if mode is not None and (mode & 0o111 != 0):
        return "application/x-executable"

    return "application/octet-stream"


def get_icon_info(
    name: str,
    is_folder: bool,
    does_exist: bool,
    is_symlink: bool,
    symlink_is_broken: bool = False,
    symlink_target_is_dir: bool = False,
    filetype: str | None = None,
    mode: int | None = None,
) -> tuple[str, str]:
    """Returns a tuple of (lucide_icon_name, css_color_class) based on file attributes."""
    if not does_exist:
        if is_folder:
            return ("folder-x", "icon-missing")
        return ("file-x", "icon-missing")
    if is_symlink:
        if symlink_is_broken:
            return ("link-2-off", "icon-symlink-broken")
        if symlink_target_is_dir:
            return ("folder-symlink", "icon-symlink-folder")
        return ("link-2", "icon-symlink")
    if is_folder:
        return ("folder", "icon-folder")

    lower_name = name.lower()
    ft = (filetype or guess_filetype(name, mode)).lower()

    # Specific common extensions & MIME types
    if "pdf" in ft or lower_name.endswith(".pdf"):
        return ("file-text", "icon-pdf")

    # Images
    if ft.startswith("image/") or any(lower_name.endswith(ext) for ext in _IMAGE_EXTS):
        return ("image", "icon-image")

    # Video
    if ft.startswith("video/") or any(lower_name.endswith(ext) for ext in _VIDEO_EXTS):
        return ("video", "icon-video")

    # Audio
    if ft.startswith("audio/") or any(lower_name.endswith(ext) for ext in _AUDIO_EXTS):
        return ("music", "icon-audio")

    # Archives
    if "archive" in ft or "tar" in ft or "zip" in ft or "compressed" in ft or any(lower_name.endswith(ext) for ext in _ARCHIVE_EXTS):
        return ("file-archive", "icon-archive")

    # Spreadsheets
    if "spreadsheet" in ft or "csv" in ft or any(lower_name.endswith(ext) for ext in _SPREADSHEET_EXTS):
        return ("file-spreadsheet", "icon-spreadsheet")

    # Source code & scripts
    if (
        "javascript" in ft or "typescript" in ft or "python" in ft or "x-sh" in ft
        or "x-shellscript" in ft or "x-c" in ft or "html" in ft or "css" in ft
        or "xml" in ft or "json" in ft or "yaml" in ft
        or any(lower_name.endswith(ext) for ext in _CODE_EXTS)
        or lower_name in ("dockerfile", "makefile", "cmakelists.txt", "gemfile")
    ):
        return ("file-code", "icon-code")

    # Configurations
    if "toml" in ft or any(lower_name.endswith(ext) for ext in _CONFIG_EXTS):
        return ("settings", "icon-config")

    # Documents & text
    if ft.startswith("text/") or any(lower_name.endswith(ext) for ext in _DOC_EXTS):
        return ("file-text", "icon-document")

    # Executable / binary / shell
    if "executable" in ft or (mode is not None and (mode & 0o111 != 0)):
        return ("terminal", "icon-executable")

    if any(lower_name.endswith(ext) for ext in _BIN_EXTS):
        return ("binary", "icon-binary")

    return ("file", "icon-generic")


class FSNode:
    """Base class for all filesystem entries (files, directories, missing paths)."""

    does_exist: bool = True

    @property
    def is_file(self) -> bool:
        return False

    @property
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
        return self.name.startswith('.') and self.name not in ('.', '..')

    @property
    def is_sub_dataset(self) -> bool:
        """Returns True if this directory is a nested ZFS dataset mountpoint."""
        return False

    @property
    def sub_dataset_root_name(self) -> str | None:
        """Returns the configured root name of the sub-dataset if available."""
        return None

    @property
    def icon_name(self) -> str:
        return self._get_icon_info()[0]

    @property
    def icon_class(self) -> str:
        return self._get_icon_info()[1]

    def _get_icon_info(self) -> tuple[str, str]:
        if self.is_sub_dataset:
            return ("database", "icon-sub-dataset")
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
                    self.inode == o.inode,
                    self.size == o.size,
                    self.does_exist == o.does_exist,
                    self.is_file == o.is_file,
                    self.is_folder == o.is_folder,
                )
            )
        return False

    def compare(self, o: object) -> set[str]:
        if not isinstance(o, FSNode):
            raise ValueError(f"Cannot compare {o.__class__} with {self.__class__}")
        changed_attributes: set[str] = set()
        for attr in ("name", "uid", "gid", "mode", "ctime", "mtime", "inode", "size", "does_exist"):
            if getattr(self, attr) != getattr(o, attr, None):
                changed_attributes.add(attr)
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
            changed_attrs: set[str] = set()

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
