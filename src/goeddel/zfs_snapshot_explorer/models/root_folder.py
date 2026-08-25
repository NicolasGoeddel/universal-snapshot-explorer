from __future__ import annotations

import datetime
import functools
import os
import stat
import traceback
from collections.abc import Sequence
from typing import ClassVar, Self

import magic

from ..config import RootConfig
from ..logger import logger
from .file import File
from .folder import Folder
from .node import FSNode, MissingNode
from .snapshot import OriginalSnapshot, Snapshot
from .snapshot_provider import FilesystemSnapshotProvider, ISnapshotProvider, ZfsCliSnapshotProvider
from .types import (
    FileName,
    FilePath,
    GroupId,
    GroupMap,
    GroupName,
    PathCacheKey,
    UserId,
    UserMap,
    UserName,
)


class RootFolder:
    _root_folder_instances: ClassVar[dict[RootConfig, RootFolder]] = {}
    _mime: ClassVar[magic.Magic] = magic.Magic(mime=True)
    _root_path_to_name: ClassVar[dict[str, str]] = {}
    _root_configs: ClassVar[dict[str, RootConfig]] = {}

    @classmethod
    def set_root_configs(cls, configs: dict[str, RootConfig]) -> None:
        """Registers all configurations and populates the root path mapping."""
        cls._root_configs = configs
        cls._root_path_to_name = {
            os.path.abspath(os.path.join(cfg.root_path, cfg.sub_path)).rstrip("/"): name
            for name, cfg in configs.items()
        }

    @classmethod
    def get_instance_by_name(cls, name: str) -> RootFolder | None:
        """Returns the RootFolder instance corresponding to a given root name."""
        cfg = cls._root_configs.get(name)
        if cfg:
            return cls.get(cfg)
        return None

    @classmethod
    def get_root_name_by_path(cls, path: str) -> str | None:
        """Returns the root name corresponding to a given absolute root path."""
        norm_path = os.path.abspath(path).rstrip("/")
        return cls._root_path_to_name.get(norm_path)

    def get_root_name_for_path(self, path: str) -> str | None:
        """Instance wrapper to look up a root name by its absolute path."""
        return self.get_root_name_by_path(path)

    def has_root_name_for_path(self, path: str) -> bool:
        """Returns True if the absolute path is registered as a root path."""
        return self.get_root_name_by_path(path) is not None

    def __init__(
        self,
        config: RootConfig,
        *,
        snapshot_path: str | None = None,
        snapshot_provider: ISnapshotProvider | None = None,
    ) -> None:
        self._config: RootConfig = config
        self._root_path: str = config.root_path
        self._sub_path: str = config.sub_path
        self._snapshot_path: str = snapshot_path or os.path.join(config.root_path, '.zfs', 'snapshot')
        self._snapshot_patterns: Sequence[str] = config.snapshot_patterns
        self._snapshot_provider: ISnapshotProvider
        if snapshot_provider is not None:
            self._snapshot_provider = snapshot_provider
        elif config.provider_type == "filesystem":
            self._snapshot_provider = FilesystemSnapshotProvider()
        else:
            self._snapshot_provider = ZfsCliSnapshotProvider(dataset_name=config.dataset_name)
        self._snapshot_cache: dict[str, Snapshot] = {}
        self._snapshot_original: OriginalSnapshot = OriginalSnapshot()
        self._snapshots_list: list[Snapshot] | None = None
        self._snapshots_by_id: dict[str, Snapshot] = {}
        self._user_map: str | None = config.user_map
        self._user_map_cache: dict[Snapshot, UserMap] = {}
        self._group_map: str | None = config.group_map
        self._group_map_cache: dict[Snapshot, GroupMap] = {}

        self._path_cache: dict[PathCacheKey, FSNode] = {}
        self._dir_names_cache: dict[PathCacheKey, set[FileName]] = {}
        self._fallback_mounts: dict[str, str] = {}

        self._cache_hits: int = 0
        self._cache_misses: int = 0

    @property
    def config(self) -> RootConfig:
        return self._config

    @property
    def cache_hits(self) -> int:
        return self._cache_hits

    @property
    def cache_misses(self) -> int:
        return self._cache_misses

    @classmethod
    def get(cls, config: RootConfig) -> Self:
        if config in cls._root_folder_instances:
            return cls._root_folder_instances[config]  # pyright: ignore[reportReturnType]
        instance = cls(config)
        cls._root_folder_instances[config] = instance
        return instance

    def invalidate(self) -> None:
        self._path_cache = {}
        self._dir_names_cache = {}
        self._snapshots_list = None
        self._snapshots_by_id = {}
        self._user_map_cache = {}
        self._group_map_cache = {}
        self._scan_read_only_dir.cache_clear()
        self._get_read_only_mime_type.cache_clear()
        self._cache_hits = 0
    def warmup_snapshots(self) -> None:
        """
        Warms up the ZFS .zfs/snapshot automount directory by unconditionally triggering
        VFS lookup and opendir on .zfs and .zfs/snapshot.
        In OpenZFS on Linux, .zfs is hidden by default (snapdir=hidden). We must NOT
        guard with os.path.exists(), because accessing the path unconditionally is what
        triggers the OpenZFS VFS automount kernel hook!
        """
        zfs_dir = os.path.join(self._root_path, ".zfs")
        snap_dir = os.path.join(zfs_dir, "snapshot")

        logger.debug("Warming up snapshot directories for root path: %s", self._root_path)
        try:
            _ = os.stat(zfs_dir)
        except OSError as e:
            logger.debug("Failed to stat ZFS control directory .zfs: %s", e)

        try:
            _ = os.stat(snap_dir)
            entries = os.listdir(snap_dir)
            # Touch each snapshot directory to trigger kernel automount
            for name in entries:
                try:
                    _ = os.stat(os.path.join(snap_dir, name))
                except OSError:
                    pass
        except OSError as e:
            logger.debug("Failed to list ZFS snapshot directory .zfs/snapshot: %s", e)

    def _mount_snapshot_fallback(self, snapshot: Snapshot) -> str | None:
        """
        Manually mounts a ZFS snapshot to a temporary directory if the kernel VFS
        automounter fails (common in Docker cross-namespace bind mounts).
        """
        if not self._config.dataset_name:
            logger.warning("Cannot run manual fallback mount: no dataset name configured for root '%s'", self._config.root_path)
            return None

        import subprocess
        safe_dataset = self._config.dataset_name.replace("/", "_")
        fallback_dir = f"/tmp/zfs_snapshots/{safe_dataset}/{snapshot.id}"

        if os.path.ismount(fallback_dir):
            logger.debug(
                "ZFS snapshot %s@%s is already mounted at fallback path %s",
                self._config.dataset_name, snapshot.id, fallback_dir
            )
            return fallback_dir

        logger.info(
            "Executing ZFS fallback mount inside container namespace: mount -t zfs %s@%s %s",
            self._config.dataset_name, snapshot.id, fallback_dir
        )
        os.makedirs(fallback_dir, exist_ok=True)
        dataset_snap = f"{self._config.dataset_name}@{snapshot.id}"

        try:
            res = subprocess.run(
                ["mount", "-t", "zfs", dataset_snap, fallback_dir],
                capture_output=True, text=True, check=False
            )
            if res.returncode == 0 or os.path.ismount(fallback_dir):
                logger.info("Successfully mounted ZFS fallback snapshot inside container: %s", fallback_dir)
                return fallback_dir
            else:
                logger.error("Failed to run manual ZFS fallback mount (exit code: %d): %s", res.returncode, res.stderr.strip())
        except OSError:
            logger.exception("Exception running manual ZFS fallback mount command")

        return None

    def ensure_snapshot_accessible(self, snapshot: Snapshot) -> bool:
        """
        Ensures a specific snapshot directory is triggered and mounted by the OpenZFS automounter,
        falling back to a manual container-local mount if the VFS automounter is blocked.
        """
        if isinstance(snapshot, OriginalSnapshot):
            return True

        if snapshot.id in self._fallback_mounts:
            if os.path.ismount(self._fallback_mounts[snapshot.id]):
                logger.debug("Snapshot '%s' already accessible via manual fallback mount: %s", snapshot.id, self._fallback_mounts[snapshot.id])
                return True

        snap_dir = os.path.join(self._snapshot_path, snapshot.id)

        # 1. Warm up parent .zfs/snapshot directory unconditionally
        self.warmup_snapshots()

        # 2. Touch the specific snapshot directory directly (triggering automount)
        is_automounted = False
        try:
            _ = os.stat(snap_dir)
            _ = os.listdir(snap_dir)
            if os.path.ismount(snap_dir):
                is_automounted = True
            # Also consider it accessible if it's not empty, even if ismount is false
            elif len(os.listdir(snap_dir)) > 0:
                is_automounted = True
        except OSError:
            pass

        if is_automounted:
            logger.debug("Snapshot '%s' is accessible via host VFS kernel automount: %s", snapshot.id, snap_dir)
            return True

        # 3. Fallback to explicit manual mount inside the container namespace
        logger.info("Kernel VFS automount for snapshot '%s' failed. Triggering manual fallback mount...", snapshot.id)
        fallback_path = self._mount_snapshot_fallback(snapshot)
        if fallback_path:
            self._fallback_mounts[snapshot.id] = fallback_path
            return True

        logger.error("Failed to make snapshot '%s' accessible (automount and manual mount failed)", snapshot.id)
        return os.path.isdir(snap_dir)

    def real_path(self, path: FilePath | None = None, snapshot: Snapshot | None = None) -> str:
        norm_path = None
        if path:
            norm_path = os.path.normpath(path)
            if norm_path == ".." or norm_path.startswith("../") or os.path.isabs(norm_path):
                raise ValueError("Path traversal detected")

        if (snapshot is None) or isinstance(snapshot, OriginalSnapshot):
            if norm_path is None:
                return os.path.join(self._root_path, self._sub_path)
            return os.path.join(self._root_path, self._sub_path, norm_path)
        else:
            base_snap_dir = self._fallback_mounts.get(snapshot.id, os.path.join(self._snapshot_path, snapshot.id))
            if norm_path is None:
                return os.path.join(base_snap_dir, self._sub_path)
            return os.path.join(base_snap_dir, self._sub_path, norm_path)

    def list_dir_names(self, path: FilePath, snapshot: str | Snapshot | None = None) -> set[FileName]:
        """
        Retrieves directory entry names for a given snapshot, caching the results.

        This method is optimized for fast name listings (via os.listdir) without calling
        stat on each entry. It is primarily used by MissingNode content aggregation
        to determine which filenames exist in other snapshots, avoiding massive I/O overhead.
        The special '.zfs' system directory is always filtered out.
        """
        snap = self.get_snapshot(snapshot)
        cache_key = (path, snap)
        if cache_key in self._dir_names_cache:
            return self._dir_names_cache[cache_key]

        if not isinstance(snap, OriginalSnapshot):
            _ = self.ensure_snapshot_accessible(snap)

        real_path = self.real_path(path, snap)
        names: set[FileName]
        try:
            names = set(os.listdir(real_path))
        except (FileNotFoundError, OSError):
            if not isinstance(snap, OriginalSnapshot):
                # Trigger automount and retry once
                _ = self.ensure_snapshot_accessible(snap)
                try:
                    names = set(os.listdir(real_path))
                except OSError:
                    names = set()
            else:
                names = set()
        if ".zfs" in names:
            names.remove(".zfs")

        self._dir_names_cache[cache_key] = names
        return names

    @staticmethod
    @functools.lru_cache(maxsize=8192)
    def _get_read_only_mime_type(real_path: str) -> str:
        try:
            return str(RootFolder._mime.from_file(real_path))  # pyright: ignore[reportUnknownMemberType]
        except (PermissionError, OSError):
            return "file"

    def get_mime_type(self, real_path: str, snapshot: Snapshot | None = None) -> str:
        if snapshot is None or isinstance(snapshot, OriginalSnapshot):
            try:
                return str(self._mime.from_file(real_path))  # pyright: ignore[reportUnknownMemberType]
            except (PermissionError, OSError):
                return "file"
        return self._get_read_only_mime_type(real_path)

    def get_file_mimetypes_across_snapshots(self, path: FilePath) -> dict[str, str]:
        """
        Returns a mapping of snapshot_id -> MIME type for the given file across all snapshots.
        """
        snapshots = self.snapshots()
        result: dict[str, str] = {}
        for snapshot in snapshots:
            real_path = self.real_path(path, snapshot)
            try:
                if not os.path.exists(real_path) or os.path.isdir(real_path):
                    continue
                if os.path.islink(real_path):
                    result[snapshot.id] = "inode/symlink"
                else:
                    result[snapshot.id] = self.get_mime_type(real_path, snapshot)
            except OSError:
                continue
        return result

    def _load_id_map(self, map_file: str, snapshot: Snapshot) -> dict[int, str]:
        if os.path.isabs(map_file):
            real_path = map_file
        else:
            real_path = self.real_path(map_file, snapshot)
        id_map: dict[int, str] = {}
        if not os.path.isfile(real_path):
            return id_map

        try:
            with open(real_path, mode='r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    parts = line.split(':')
                    if len(parts) >= 3 and parts[2].isdigit():
                        id_map[int(parts[2])] = parts[0]
        except (OSError, UnicodeDecodeError) as exc:
            traceback.print_exception(exc)

        return id_map

    def get_username(self, uid: UserId, snapshot: str | Snapshot | None = None) -> UserName:
        if self._user_map is None:
            return str(uid)
        snap = self.get_snapshot(snapshot)
        if snap not in self._user_map_cache:
            self._user_map_cache[snap] = self._load_id_map(self._user_map, snap)

        return self._user_map_cache[snap].get(uid, str(uid))

    def get_groupname(self, gid: GroupId, snapshot: str | Snapshot | None = None) -> GroupName:
        if self._group_map is None:
            return str(gid)
        snap = self.get_snapshot(snapshot)
        if snap not in self._group_map_cache:
            self._group_map_cache[snap] = self._load_id_map(self._group_map, snap)

        return self._group_map_cache[snap].get(gid, str(gid))

    def get_snapshot(self, snapshot: str | Snapshot | None = None) -> Snapshot:
        if snapshot is None or isinstance(snapshot, OriginalSnapshot):
            return self._snapshot_original

        if isinstance(snapshot, Snapshot):
            if self._snapshots_list is None:
                _ = self.snapshots()
            return self._snapshots_by_id.get(snapshot.id, snapshot)

        if snapshot == "Original":
            return self._snapshot_original
        if self._snapshots_list is None:
            _ = self.snapshots()
        return self._snapshots_by_id.get(snapshot, self._snapshot_original)

    def snapshots(self) -> list[Snapshot]:
        if self._snapshots_list is not None:
            return self._snapshots_list

        self.warmup_snapshots()
        self._snapshots_list = self._snapshot_provider.get_snapshots(
            snapshot_dir=self._snapshot_path,
            patterns=self._snapshot_patterns,
            original_snapshot=self._snapshot_original,
        )
        for snap in self._snapshots_list:
            self._snapshots_by_id[snap.id] = snap
            self._snapshot_cache[snap.id] = snap

        return self._snapshots_list

    def snapshots_chronological(self) -> list[Snapshot]:
        """Returns snapshots in chronological order (oldest to newest / Original)."""
        return list(reversed(self.snapshots()))

    def get_file(
        self,
        *,
        path: FilePath,
        stat_info: os.stat_result | None = None,
        snapshot: str | Snapshot | None = None
    ) -> FSNode:
        snap = self.get_snapshot(snapshot)

        if (path, snap) in self._path_cache:
            self._cache_hits += 1
            return self._path_cache[(path, snap)]

        if not isinstance(snap, OriginalSnapshot):
            _ = self.ensure_snapshot_accessible(snap)

        real_path = self.real_path(path, snap)
        result: FSNode

        if stat_info is None:
            try:
                stat_info = os.stat(real_path, follow_symlinks=False)
            except (FileNotFoundError, OSError):
                if not isinstance(snap, OriginalSnapshot):
                    _ = self.ensure_snapshot_accessible(snap)
                    try:
                        stat_info = os.stat(real_path, follow_symlinks=False)
                    except OSError:
                        stat_info = None
                else:
                    stat_info = None

        if stat_info is None:
            result = MissingNode(
                self,
                path,
                snapshot=snap,
                name=os.path.basename(path) or '/'
            )
        else:
            if stat.S_ISDIR(stat_info.st_mode):
                result = Folder(
                    self,
                    path,
                    snapshot=snap,
                    name=os.path.basename(path) or '/',
                    uid=stat_info.st_uid,
                    gid=stat_info.st_gid,
                    mode=stat.S_IMODE(stat_info.st_mode),
                    filetype="directory",
                    ctime=datetime.datetime.fromtimestamp(stat_info.st_ctime),
                    mtime=datetime.datetime.fromtimestamp(stat_info.st_mtime),
                    inode=stat_info.st_ino,
                    item_count=None,
                )
            else:
                size: int = stat_info.st_size
                is_symlink = stat.S_ISLNK(stat_info.st_mode)
                symlink_target = os.readlink(real_path) if is_symlink else None

                result = File(
                    self,
                    path,
                    snapshot=snap,
                    name=os.path.basename(path) or '/',
                    uid=stat_info.st_uid,
                    gid=stat_info.st_gid,
                    mode=stat.S_IMODE(stat_info.st_mode),
                    is_symlink=is_symlink,
                    symlink_target=symlink_target,
                    ctime=datetime.datetime.fromtimestamp(stat_info.st_ctime),
                    mtime=datetime.datetime.fromtimestamp(stat_info.st_mtime),
                    inode=stat_info.st_ino,
                    size=size,
                )

        self._path_cache[(path, snap)] = result
        self._cache_misses += 1
        return result

    def get_folder(
        self,
        *,
        path: FilePath,
        stat_info: os.stat_result | None = None,
        snapshot: str | Snapshot | None = None
    ) -> Folder | None:
        file = self.get_file(path=path, stat_info=stat_info, snapshot=snapshot)
        if not isinstance(file, Folder):
            return None
        return file

    @staticmethod
    def _scan_dir_live(real_dir: str) -> dict[str, tuple[int, int, int, int, int, int, int]] | None:
        """
        Performs a fast raw metadata batch-scan of a directory, returning a map of filename to signatures.

        This method is the performance engine for calculating multi-snapshot change bars.
        It bypasses heavy FSNode domain model allocations by returning raw primitive metadata tuples,
        allowing lightweight comparison of thousands of entries across snapshots.
        The special '.zfs' system directory is ignored.
        """
        try:
            entries_map: dict[str, tuple[int, int, int, int, int, int, int]] = {}
            with os.scandir(real_dir) as it:
                for entry in it:
                    if entry.name == ".zfs":
                        continue
                    try:
                        stat_info = entry.stat(follow_symlinks=False)
                        sig = (
                            stat_info.st_uid,
                            stat_info.st_gid,
                            stat_info.st_mode,
                            stat_info.st_mtime_ns,
                            stat_info.st_ctime_ns,
                            stat_info.st_size,
                            stat_info.st_ino,
                        )
                        entries_map[entry.name] = sig
                    except OSError:
                        continue
            return entries_map
        except OSError:
            return None

    @staticmethod
    @functools.lru_cache(maxsize=2048)
    def _scan_read_only_dir(real_dir: str) -> dict[str, tuple[int, int, int, int, int, int, int]] | None:
        return RootFolder._scan_dir_live(real_dir)

    def get_snapshot_bars_data(self, path: FilePath) -> dict[str, object]:
        """
        Scans directory entries across all snapshots using fast batch os.scandir
        with LRU-cached read-only snapshots and returns a compact snapshot color map.
        """
        snapshots = self.snapshots()
        snapshot_dir_entries: list[dict[str, tuple[int, int, int, int, int, int, int]] | None] = []
        all_filenames: set[str] = set()

        for snapshot in snapshots:
            real_dir = self.real_path(path, snapshot)
            if isinstance(snapshot, OriginalSnapshot):
                entries_map = self._scan_dir_live(real_dir)
            else:
                entries_map = self._scan_read_only_dir(real_dir)

            snapshot_dir_entries.append(entries_map)
            if entries_map:
                all_filenames.update(entries_map.keys())

        color_chars = ["g", "b", "y", "r", "o", "p"]
        bars: dict[str, object] = {}

        for filename in all_filenames:
            child_rel_path = os.path.join(path, filename)
            child_abs_path = os.path.abspath(os.path.join(self._root_path, self._sub_path, child_rel_path)).rstrip("/")
            child_root_name = self.get_root_name_by_path(child_abs_path)

            if child_root_name:
                try:
                    child_root_folder = self.get_instance_by_name(child_root_name)
                    if child_root_folder:
                        child_root_node = child_root_folder.get_file(path="")
                        child_bar = child_root_node.snapshots_bar
                        color_map = {
                            "var(--snap-1)": "g",
                            "var(--snap-2)": "b",
                            "var(--snap-3)": "y",
                            "var(--snap-4)": "r",
                            "var(--snap-5)": "o",
                            "var(--snap-6)": "p",
                            "var(--snap-missing)": "x"
                        }
                        bar_str = "".join(color_map.get(item["color"], "x") for item in child_bar)
                        bars[filename] = {
                            "is_sub_dataset": True,
                            "barStr": bar_str,
                            "snapshots": [{"id": s.id, "name": s.name} for s in child_root_folder.snapshots()]
                        }
                        continue
                except Exception as e:
                    logger.error("Failed to load snapshot bar for sub-dataset %s: %s", child_root_name, e)

            chars: list[str] = []
            color_index = 0
            previous_sig = None

            for i, snap_entries in enumerate(snapshot_dir_entries):
                if snap_entries is None or filename not in snap_entries:
                    chars.append("x")
                    previous_sig = None
                    continue

                sig = snap_entries[filename]
                if i > 0:
                    if previous_sig is None:
                        color_index += 1
                    elif sig != previous_sig:
                        color_index += 1

                chars.append(color_chars[color_index % len(color_chars)])
                previous_sig = sig

            bars[filename] = "".join(chars)

        return {
            "snapshots": [{"id": s.id, "name": s.name} for s in snapshots],
            "bars": bars,
        }

    def get_snapshot_state(self, path: FilePath, snapshot: str | None) -> dict[str, object]:
        """
        Returns state metadata for all entries in a directory under a specific snapshot
        for instantaneous flicker-free frontend updates.
        """
        target_snap = self.get_snapshot(snapshot)
        snapshots = self.snapshots()
        snap_index = snapshots.index(target_snap) if target_snap in snapshots else 0

        folder = self.get_folder(path=path, snapshot=target_snap)
        if folder is None:
            return {
                "snapshot": {
                    "id": target_snap.id,
                    "name": target_snap.name,
                    "index": snap_index,
                    "timestamp": target_snap.timestamp_formatted if target_snap.has_timestamp else None,
                },
                "folder_exists": False,
                "entries": {},
            }

        entries_data: dict[str, dict[str, object]] = {}
        for filename in folder.content():
            entry = folder[filename]
            if not entry.does_exist:
                entries_data[filename] = {
                    "does_exist": False,
                    "is_folder": entry.is_folder,
                    "is_symlink": False,
                    "is_accessible": False,
                    "size_human": "–",
                    "size": -1,
                    "owner": "–",
                    "group": "–",
                    "mode_human": "–",
                    "mode_octal": "0000",
                    "mtime_fmt": "–",
                    "mtime_iso": "",
                    "ctime_fmt": "–",
                    "ctime_iso": "",
                }
            else:
                mtime_fmt = entry.mtime.strftime("%d.%m.%Y %H:%M:%S") if entry.mtime else "–"
                mtime_iso = entry.mtime.isoformat() if entry.mtime else ""
                ctime_fmt = entry.ctime.strftime("%d.%m.%Y %H:%M:%S") if entry.ctime else "–"
                ctime_iso = entry.ctime.isoformat() if entry.ctime else ""
                size_human = f"{entry.size} files" if entry.is_folder and entry.size is not None else entry.size_human

                symlink_info: dict[str, object] = {}
                if entry.is_symlink:
                    symlink_info = {
                        "symlink_target": entry.symlink_target,
                        "symlink_is_broken": entry.symlink_is_broken,
                        "symlink_target_is_dir": entry.symlink_target_is_dir,
                        "symlink_resolved_subpath": entry.symlink_resolved_subpath,
                        "symlink_resolved_parent_subpath": entry.symlink_resolved_parent_subpath,
                        "symlink_target_filename": entry.symlink_target_filename,
                    }

                entries_data[filename] = {
                    "does_exist": True,
                    "is_folder": entry.is_folder,
                    "is_symlink": entry.is_symlink,
                    "is_accessible": entry.is_accessible,
                    "size_human": size_human or "–",
                    "size": entry.size if entry.size is not None else 0,
                    "owner": f"{entry.owner}:{entry.group}",
                    "group": entry.group,
                    "mode_human": entry.mode_human,
                    "mode_octal": entry.mode_octal or "0000",
                    "mtime_fmt": mtime_fmt,
                    "mtime_iso": mtime_iso,
                    "ctime_fmt": ctime_fmt,
                    "ctime_iso": ctime_iso,
                    **symlink_info,
                }

        return {
            "snapshot": {
                "id": target_snap.id,
                "name": target_snap.name,
                "index": snap_index,
                "timestamp": target_snap.timestamp_formatted if target_snap.has_timestamp else None,
            },
            "folder_exists": True,
            "entries": entries_data,
        }
