from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, ClassVar, cast

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .enums import FilesystemType, LogLevel, ProviderType

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from .btrfs.client import BtrfsClient
    from .zfs.client import ZfsClient


class RootConfig(BaseModel):
    """Configuration for a single filesystem root folder."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    root_path: str
    sub_path: str = ""
    user_map: str | None = None
    group_map: str | None = None
    snapshot_patterns: tuple[str, ...] = ()
    dataset_name: str | None = None
    provider_type: ProviderType = ProviderType.AUTO
    filesystem_type: FilesystemType = FilesystemType.ZFS
    control_dir_name: str | None = None
    snapshot_dir_name: str | None = None
    is_auto_discovered: bool = False

    @model_validator(mode="before")
    @classmethod
    def set_default_dirs(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data

        dict_data: dict[str, object] = dict(data)  # pyright: ignore[reportUnknownArgumentType]
        raw_fs = dict_data.get("filesystem_type", FilesystemType.ZFS)
        try:
            fs_type = FilesystemType(str(raw_fs))
        except ValueError:
            fs_type = FilesystemType.GENERIC

        if dict_data.get("control_dir_name") is None:
            if fs_type == FilesystemType.ZFS:
                dict_data["control_dir_name"] = ".zfs"
            elif fs_type == FilesystemType.BTRFS:
                dict_data["control_dir_name"] = ".snapshots"
            elif fs_type == FilesystemType.CEPHFS:
                dict_data["control_dir_name"] = ".snap"
            else:
                dict_data["control_dir_name"] = ""

        if dict_data.get("snapshot_dir_name") is None:
            if fs_type == FilesystemType.ZFS:
                dict_data["snapshot_dir_name"] = ".zfs/snapshot"
            elif fs_type == FilesystemType.BTRFS:
                dict_data["snapshot_dir_name"] = ".snapshots"
            elif fs_type == FilesystemType.CEPHFS:
                dict_data["snapshot_dir_name"] = ".snap"
            else:
                dict_data["snapshot_dir_name"] = ".snapshots"

        return dict_data


class ZfsConfig(BaseModel):
    """Configuration for global ZFS options and dataset auto-discovery."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    auto_discover: bool = False
    mount_prefix: str = ""
    pools: tuple[str, ...] = ()
    exclude_datasets: tuple[str, ...] = ()
    default_user_map: str | None = None
    default_group_map: str | None = None
    snapshot_patterns: tuple[str, ...] = ()


class BtrfsConfig(BaseModel):
    """Configuration for global Btrfs options and mountpoint auto-discovery."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    auto_discover: bool = False
    mount_prefix: str = ""
    exclude_paths: tuple[str, ...] = ()
    default_user_map: str | None = None
    default_group_map: str | None = None
    snapshot_patterns: tuple[str, ...] = ()


class AppConfig(BaseModel):
    """Main application configuration."""

    roots: dict[str, RootConfig] = Field(default_factory=dict)
    zfs: ZfsConfig = Field(default_factory=ZfsConfig)
    btrfs: BtrfsConfig = Field(default_factory=BtrfsConfig)
    loglevel: LogLevel = LogLevel.INFO


def load_config(
    file_path: str,
    zfs_client: ZfsClient | None = None,
    btrfs_client: BtrfsClient | None = None,
) -> AppConfig:
    """Loads configuration from a YAML file, runs filesystem auto-discovery if enabled, and validates it."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Configuration file '{file_path}' could not be found.")

    with open(file_path, "r", encoding="utf-8") as f:
        loaded = yaml.safe_load(f)  # pyright: ignore[reportAny]
        data: dict[str, object] = cast(dict[str, object], loaded) if isinstance(loaded, dict) else {}

    app_cfg = AppConfig.model_validate(data)
    discovered_roots: dict[str, RootConfig] = {}

    # 1. ZFS auto-discovery
    if app_cfg.zfs.auto_discover:
        from .zfs.client import ZfsClient

        z_client = zfs_client or ZfsClient()
        if z_client.is_available():
            datasets = z_client.list_datasets(
                exclude_patterns=app_cfg.zfs.exclude_datasets,
                pools=app_cfg.zfs.pools,
            )
            prefix = app_cfg.zfs.mount_prefix.rstrip("/")
            for ds in datasets:
                if not ds.mountpoint or not ds.is_mounted:
                    continue
                container_path = f"{prefix}/{ds.mountpoint.lstrip('/')}" if prefix else ds.mountpoint
                if not os.path.exists(container_path):
                    continue
                root_name = ds.name
                discovered_roots[root_name] = RootConfig(
                    root_path=container_path,
                    sub_path="",
                    user_map=app_cfg.zfs.default_user_map,
                    group_map=app_cfg.zfs.default_group_map,
                    snapshot_patterns=app_cfg.zfs.snapshot_patterns,
                    dataset_name=ds.name,
                    filesystem_type=FilesystemType.ZFS,
                    provider_type=ProviderType.CLI,
                    is_auto_discovered=True,
                )

    # 2. Btrfs auto-discovery
    if app_cfg.btrfs.auto_discover:
        from .btrfs.client import BtrfsClient

        b_client = btrfs_client or BtrfsClient()
        prefix = app_cfg.btrfs.mount_prefix.rstrip("/")
        mountpoints = b_client.list_mountpoints()

        # Filter and normalize candidate paths:
        # Ignore container pseudo-filesystems and files (e.g. /proc, /sys, /dev, /etc, /app)
        raw_candidates: list[tuple[str, str]] = []
        if prefix and os.path.isdir(prefix):
            raw_candidates.append(("/", prefix))

        for mp in mountpoints:
            if not os.path.isdir(mp):
                continue
            if mp.startswith(("/proc", "/sys", "/dev", "/etc", "/app")):
                continue
            if prefix and mp.startswith(prefix):
                if mp.rstrip("/") == prefix.rstrip("/"):
                    continue
                orig = "/" + mp[len(prefix) :].lstrip("/")
                raw_candidates.append((orig, mp))
            elif not prefix:
                raw_candidates.append((mp, mp))

        # Deduplicate candidates by filesystem device ID (st_dev) to avoid scanning the same filesystem repeatedly
        seen_devs: set[int] = set()
        candidate_paths: list[tuple[str, str]] = []
        for orig_mp, cont_path in raw_candidates:
            if not os.path.isdir(cont_path):
                continue
            try:
                st = os.stat(cont_path)
                if st.st_dev in seen_devs:
                    continue
                seen_devs.add(st.st_dev)
                candidate_paths.append((orig_mp, cont_path))
            except OSError:
                continue

        import fnmatch

        for orig_mp, cont_path in candidate_paths:
            if not os.path.exists(cont_path):
                continue

            # Check exclusion patterns
            excluded = False
            for pattern in app_cfg.btrfs.exclude_paths:
                if fnmatch.fnmatch(orig_mp, pattern) or fnmatch.fnmatch(cont_path, pattern):
                    excluded = True
                    break
            if excluded:
                continue

            # 1. Discover full subvolume tree via btrfs CLI if available
            found_subvols = False
            if b_client.is_available():
                try:
                    all_subvols = b_client.list_subvolumes(cont_path, snapshots_only=False)
                    all_mounts = b_client.list_mounts()
                    mount_by_subvolid: dict[int, str] = {}
                    mount_by_subvol_name: dict[str, str] = {}
                    for m in all_mounts:
                        mp = m["mountpoint"]
                        sid = m["subvolid"]
                        sname = m["subvol"]
                        if sid is not None:
                            if sid not in mount_by_subvolid or (prefix and mp.startswith(prefix)):
                                mount_by_subvolid[sid] = mp
                        if sname is not None:
                            if sname not in mount_by_subvol_name or (prefix and mp.startswith(prefix)):
                                mount_by_subvol_name[sname] = mp
                    non_snapshots = [
                        s for s in all_subvols if not s.is_snapshot and not s.path.startswith(".snapshots") and "/.snapshots" not in s.path
                    ]
                    for sv in non_snapshots:
                        clean_p = sv.path
                        if clean_p.startswith("<FS_TREE>/"):
                            clean_p = clean_p[len("<FS_TREE>/") :]
                        if clean_p.startswith("@/"):
                            clean_p = clean_p[2:]
                        if not clean_p or clean_p == ".snapshots":
                            continue

                        # Check exclusion patterns
                        if any(fnmatch.fnmatch(clean_p, pat) for pat in app_cfg.btrfs.exclude_paths):
                            continue

                        if clean_p in discovered_roots:
                            continue

                        # Resolve location on disk using actual mount options or internal subvolume path
                        subvol_dir: str | None = None
                        if clean_p == "@" and prefix and os.path.isdir(prefix):
                            subvol_dir = prefix
                        elif sv.subvolume_id in mount_by_subvolid:
                            subvol_dir = mount_by_subvolid[sv.subvolume_id]
                        elif sv.path in mount_by_subvol_name:
                            subvol_dir = mount_by_subvol_name[sv.path]
                        elif clean_p in mount_by_subvol_name:
                            subvol_dir = mount_by_subvol_name[clean_p]
                        elif f"@{clean_p}" in mount_by_subvol_name:
                            subvol_dir = mount_by_subvol_name[f"@{clean_p}"]
                        else:
                            # Not an explicit mountpoint; check if accessible inside container path
                            cand_root = cont_path if clean_p == "@" else ""
                            cand_direct = os.path.join(cont_path, clean_p)
                            if cand_root and os.path.isdir(cand_root):
                                subvol_dir = cand_root
                            elif cand_direct and os.path.isdir(cand_direct):
                                # Verify this directory actually belongs to this subvolume and is not a foreign mount
                                info = b_client.get_subvolume_info(cand_direct)
                                if info and info.subvolume_id == sv.subvolume_id:
                                    subvol_dir = cand_direct
                                else:
                                    subvol_dir = cand_direct
                            else:
                                subvol_dir = os.path.join(cont_path, clean_p)

                        root_name = clean_p
                        discovered_roots[root_name] = RootConfig(
                            root_path=subvol_dir,
                            sub_path="",
                            user_map=app_cfg.btrfs.default_user_map,
                            group_map=app_cfg.btrfs.default_group_map,
                            snapshot_patterns=app_cfg.btrfs.snapshot_patterns,
                            filesystem_type=FilesystemType.BTRFS,
                            provider_type=ProviderType.CLI,
                            is_auto_discovered=True,
                        )
                        found_subvols = True
                except Exception as exc:
                    logger.debug("btrfs subvolume discovery failed on '%s': %s", cont_path, exc)

            # 2. Fallback: Check for snapshot directory (e.g. .snapshots)
            if not found_subvols:
                snap_dir = os.path.join(cont_path, ".snapshots")
                if os.path.exists(snap_dir) and os.path.isdir(snap_dir):
                    root_name = orig_mp.strip("/") if orig_mp.strip("/") else "root"
                    if root_name in discovered_roots:
                        root_name = f"btrfs-{root_name}"
                    discovered_roots[root_name] = RootConfig(
                        root_path=cont_path,
                        sub_path="",
                        user_map=app_cfg.btrfs.default_user_map,
                        group_map=app_cfg.btrfs.default_group_map,
                        snapshot_patterns=app_cfg.btrfs.snapshot_patterns,
                        filesystem_type=FilesystemType.BTRFS,
                        provider_type=ProviderType.AUTO,
                        is_auto_discovered=True,
                    )

    if discovered_roots:
        merged_roots = {**discovered_roots, **app_cfg.roots}
        app_cfg = AppConfig(
            roots=merged_roots,
            zfs=app_cfg.zfs,
            btrfs=app_cfg.btrfs,
            loglevel=app_cfg.loglevel,
        )

    return app_cfg
