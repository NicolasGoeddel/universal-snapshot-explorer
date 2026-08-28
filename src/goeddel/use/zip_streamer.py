from __future__ import annotations

import os
import stat
import zipfile
from collections.abc import Generator
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from .models.root_folder import RootFolder
    from .models.snapshot import Snapshot

StructureMode = Literal["relative", "absolute", "flat"]
CompressionMode = Literal["deflate", "store"]


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


def stream_zip_archive(
    root_folder: RootFolder,
    snapshot: str | Snapshot | None,
    paths: list[str],
    base_folder_path: str = "",
    structure_mode: StructureMode = "relative",
    compression: CompressionMode = "deflate",
) -> Generator[bytes, None, None]:
    """
    Generates a streaming ZIP archive from selected paths within a root folder snapshot.
    Yields chunks of bytes directly to the caller.
    """
    target_snapshot = root_folder.get_snapshot(snapshot)
    clean_paths = deduplicate_paths(paths)
    clean_base = base_folder_path.strip("/").replace("\\", "/")

    streamer = ChunkedZipStreamer()
    zip_compression = zipfile.ZIP_DEFLATED if compression == "deflate" else zipfile.ZIP_STORED

    # Use allowZip64=True for archives > 4GB or with > 65k entries
    zf = zipfile.ZipFile(streamer, mode="w", compression=zip_compression, allowZip64=True)

    used_arcnames: set[str] = set()

    def make_arcname(rel_path_from_root: str) -> str:
        clean_rel = rel_path_from_root.strip("/").replace("\\", "/")
        if structure_mode == "absolute":
            return clean_rel
        elif structure_mode == "flat":
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

    try:
        for p in clean_paths:
            node = root_folder.get_file(path=p, snapshot=target_snapshot)
            if not node.does_exist:
                continue

            real_path = node.symlink_final_real_path or root_folder.real_path(node.path, target_snapshot)

            if not os.path.exists(real_path):
                continue

            try:
                st = os.stat(real_path, follow_symlinks=True)
            except OSError, PermissionError:
                continue

            if stat.S_ISDIR(st.st_mode):
                # Recursively walk directory
                for dirpath, dirnames, filenames in os.walk(real_path, followlinks=False):
                    # Sort for deterministic archive layout
                    dirnames.sort()
                    filenames.sort()

                    rel_from_dir = os.path.relpath(dirpath, real_path).replace("\\", "/")
                    if rel_from_dir == ".":
                        current_node_path = p
                    else:
                        current_node_path = f"{p.rstrip('/')}/{rel_from_dir}"

                    # Write empty folder record if directory has no files and no subdirectories
                    if not filenames and not dirnames:
                        folder_arcname = make_arcname(current_node_path).rstrip("/") + "/"
                        if folder_arcname and folder_arcname != "/":
                            zf.writestr(folder_arcname, b"")
                            chunk = streamer.pop_chunks()
                            if chunk:
                                yield chunk

                    for fname in filenames:
                        file_real_path = os.path.join(dirpath, fname)
                        file_node_path = f"{current_node_path.rstrip('/')}/{fname}"
                        file_arcname = make_arcname(file_node_path)

                        try:
                            with open(file_real_path, "rb") as src, zf.open(file_arcname, "w") as dest:
                                while True:
                                    buf = src.read(64 * 1024)
                                    if not buf:
                                        break
                                    _ = dest.write(buf)
                                    chunk = streamer.pop_chunks()
                                    if chunk:
                                        yield chunk
                            # Flush any leftover metadata bytes for this file entry
                            chunk = streamer.pop_chunks()
                            if chunk:
                                yield chunk
                        except OSError, PermissionError:
                            continue
            else:
                # Single regular file
                file_arcname = make_arcname(p)
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

    finally:
        zf.close()
        chunk = streamer.pop_chunks()
        if chunk:
            yield chunk
