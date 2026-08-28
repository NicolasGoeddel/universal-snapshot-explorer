from __future__ import annotations

import os
from typing import TYPE_CHECKING, ClassVar, cast

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

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
    provider_type: str = "auto"  # "auto", "cli", "filesystem"
    filesystem_type: str = "zfs"  # "zfs", "btrfs", "cephfs", "generic"
    control_dir_name: str | None = None
    snapshot_dir_name: str | None = None

    @model_validator(mode="before")
    @classmethod
    def set_default_dirs(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data

        dict_data: dict[str, object] = dict(data)  # pyright: ignore[reportUnknownArgumentType]
        fs_type = str(dict_data.get("filesystem_type", "zfs"))

        if dict_data.get("control_dir_name") is None:
            if fs_type == "zfs":
                dict_data["control_dir_name"] = ".zfs"
            elif fs_type == "btrfs":
                dict_data["control_dir_name"] = ".snapshots"
            elif fs_type == "cephfs":
                dict_data["control_dir_name"] = ".snap"
            else:
                dict_data["control_dir_name"] = ""

        if dict_data.get("snapshot_dir_name") is None:
            if fs_type == "zfs":
                dict_data["snapshot_dir_name"] = ".zfs/snapshot"
            elif fs_type == "btrfs":
                dict_data["snapshot_dir_name"] = ".snapshots"
            elif fs_type == "cephfs":
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
    loglevel: str = "info"


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
                    filesystem_type="zfs",
                    provider_type="cli",
                )

    # 2. Btrfs auto-discovery
    if app_cfg.btrfs.auto_discover:
        from .btrfs.client import BtrfsClient

        b_client = btrfs_client or BtrfsClient()
        prefix = app_cfg.btrfs.mount_prefix.rstrip("/")
        mountpoints = b_client.list_mountpoints()

        # If running in container with mount_prefix, check prefix itself or discovered mountpoints
        candidate_paths: list[tuple[str, str]] = []
        for mp in mountpoints:
            cont_path = f"{prefix}/{mp.lstrip('/')}" if prefix else mp
            candidate_paths.append((mp, cont_path))

        if prefix and (prefix, prefix) not in candidate_paths:
            candidate_paths.append((prefix, prefix))

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

            # Check for snapshot directory (e.g. .snapshots)
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
                    filesystem_type="btrfs",
                    provider_type="auto",
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
