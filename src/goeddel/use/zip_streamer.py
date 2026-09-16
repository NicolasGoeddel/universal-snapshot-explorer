from __future__ import annotations

import os
import stat
import zipfile
from collections.abc import Generator
from typing import TYPE_CHECKING

from .enums import CompressionMode, StructureMode
from .security import can_access, can_read_real_path, can_traverse_real_path, get_current_username

if TYPE_CHECKING:
    from .models.root_folder import RootFolder
    from .models.snapshot import Snapshot


class ChunkedZipStreamer:
    """
    In-memory streaming sink for zipfile.ZipFile.
    Buffers emitted zip bytes and yields them in chunks to a generator,
    enabling low constant RAM footprint and zero disk temporary files.
    """

    def __init__(self) -> None:
        self._buffer: bytearray = bytearray()
        self._offset: int = 0

    def write(self, b: bytes) -> int:
        self._buffer.extend(b)
        self._offset += len(b)
        return len(b)

    def flush(self) -> None:
        pass

    def close(self) -> None:
        pass

    def seekable(self) -> bool:
        return False

    def tell(self) -> int:
        return self._offset

    def pop_chunks(self) -> bytes:
        if self._buffer:
            out = bytes(self._buffer)
            self._buffer.clear()
            return out
        return b""


def deduplicate_paths(paths: list[str]) -> list[str]:
    """
    Normalizes and deduplicates a list of paths.
    If a parent directory is already present, its children are excluded to prevent duplicate files.
    """
    normalized = sorted(
        {p.strip("/").replace("\\", "/") for p in paths if p and p.strip("/")},
        key=lambda x: (x.count("/"), len(x)),
    )
    selected_set: set[str] = set()

    for path in normalized:
        parts = path.split("/")
        is_child = any("/".join(parts[:i]) in selected_set for i in range(1, len(parts)))
        if not is_child:
            selected_set.add(path)

    return sorted(selected_set)


def resolve_zip_selection(
    root_folder: RootFolder,
    snapshot: str | Snapshot | None,
    paths: list[str],
) -> tuple[list[tuple[str, str]], list[str], list[str]]:
    """
    Walks the requested selection exactly as `stream_zip_archive` below will,
    without reading any file content.

    Returns `(included, empty_dirs, skipped)`:
      - `included`: `(node_path, real_path)` for every file that will actually
        be written into the archive.
      - `empty_dirs`: node paths that need an explicit empty-folder record in
        the archive (genuinely empty, or every entry inside was ACL-skipped).
      - `skipped`: node paths (files or whole subtrees, whichever is the
        highest point at which access was denied) excluded by the current
        user's ACL restrictions. A denied subdirectory is reported once,
        not descended into.
    """
    target_snapshot = root_folder.get_snapshot(snapshot)
    clean_paths = deduplicate_paths(paths)
    username = get_current_username()

    included: list[tuple[str, str]] = []
    empty_dirs: list[str] = []
    skipped: list[str] = []

    for p in clean_paths:
        node = root_folder.get_file(path=p, snapshot=target_snapshot)
        if not node.does_exist:
            continue
        if not can_access(root_folder, p, target_snapshot, username):
            skipped.append(p)
            continue

        real_path = node.symlink_final_real_path or root_folder.real_path(node.path, target_snapshot)
        if not os.path.exists(real_path):
            continue

        try:
            st = os.stat(real_path, follow_symlinks=True)
        except OSError, PermissionError:
            continue

        if stat.S_ISDIR(st.st_mode):
            for dirpath, dirnames, filenames in os.walk(real_path, followlinks=False):
                rel_from_dir = os.path.relpath(dirpath, real_path).replace("\\", "/")
                current_node_path = p if rel_from_dir == "." else f"{p.rstrip('/')}/{rel_from_dir}"

                # Prune subdirectories the current user can't even traverse, 
                # BEFORE os.walk descends into them, each entry
                # is checked independently to avoid unnecessary processing.
                kept_dirnames: list[str] = []
                for d in sorted(dirnames):
                    if can_traverse_real_path(os.path.join(dirpath, d), username):
                        kept_dirnames.append(d)
                    else:
                        skipped.append(f"{current_node_path.rstrip('/')}/{d}")
                dirnames[:] = kept_dirnames

                # Prune files the current user can't read,
                # and record the ones that can be included.
                kept_filenames: list[str] = []
                for fname in sorted(filenames):
                    file_real_path = os.path.join(dirpath, fname)
                    file_node_path = f"{current_node_path.rstrip('/')}/{fname}"
                    if can_read_real_path(file_real_path, username):
                        included.append((file_node_path, file_real_path))
                        kept_filenames.append(fname)
                    else:
                        skipped.append(file_node_path)

                if not kept_filenames and not kept_dirnames:
                    empty_dirs.append(current_node_path)
        else:
            included.append((p, real_path))

    return included, empty_dirs, skipped


def stream_zip_archive(
    root_folder: RootFolder,
    snapshot: str | Snapshot | None,
    paths: list[str],
    base_folder_path: str = "",
    structure_mode: StructureMode = StructureMode.RELATIVE,
    compression: CompressionMode = CompressionMode.DEFLATE,
) -> Generator[bytes, None, None]:
    """
    Generates a streaming ZIP archive from selected paths within a root folder snapshot.
    Yields chunks of bytes directly to the caller.
    """
    clean_base = base_folder_path.strip("/").replace("\\", "/")

    streamer = ChunkedZipStreamer()
    zip_compression = zipfile.ZIP_DEFLATED if compression == CompressionMode.DEFLATE else zipfile.ZIP_STORED

    # Use allowZip64=True for archives > 4GB or with > 65k entries
    zf = zipfile.ZipFile(streamer, mode="w", compression=zip_compression, allowZip64=True)

    used_arcnames: set[str] = set()

    def make_arcname(rel_path_from_root: str) -> str:
        clean_rel = rel_path_from_root.strip("/").replace("\\", "/")
        if structure_mode == StructureMode.ABSOLUTE:
            return clean_rel
        elif structure_mode == StructureMode.FLAT:
            base_name = os.path.basename(clean_rel)
            if not base_name:
                base_name = "archive"
            counter = 1
            cand = base_name
            while cand in used_arcnames:
                name, ext = os.path.splitext(base_name)
                cand = f"{name}_{counter}{ext}"
                counter += 1
            used_arcnames.add(cand)
            return cand
        else:  # relative to base_folder_path
            if clean_base and (clean_rel == clean_base or clean_rel.startswith(f"{clean_base}/")):
                sub = clean_rel[len(clean_base) :].lstrip("/")
                return sub if sub else os.path.basename(clean_base)
            return clean_rel

    included, empty_dirs, _skipped = resolve_zip_selection(root_folder, snapshot, paths)

    try:
        # Write files into the archive, yielding chunks as we go
        for node_path, real_path in included:
            file_arcname = make_arcname(node_path)
            try:
                with open(real_path, "rb") as src, zf.open(file_arcname, "w") as dest:
                    while True:
                        buf = src.read(64 * 1024)
                        if not buf:
                            break
                        _ = dest.write(buf)
                        chunk = streamer.pop_chunks()
                        if chunk:
                            yield chunk
                chunk = streamer.pop_chunks()
                if chunk:
                    yield chunk
            except OSError, PermissionError:
                continue

        # Write empty folders's records inside the archive
        for dir_path in empty_dirs:
            folder_arcname = make_arcname(dir_path).rstrip("/") + "/"
            if folder_arcname and folder_arcname != "/":
                zf.writestr(folder_arcname, b"")
                chunk = streamer.pop_chunks()
                if chunk:
                    yield chunk

    finally:
        zf.close()
        chunk = streamer.pop_chunks()
        if chunk:
            yield chunk
