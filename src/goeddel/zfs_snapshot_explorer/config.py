from __future__ import annotations

import os
from typing import ClassVar, cast

import yaml
from pydantic import BaseModel, ConfigDict, Field

from .zfs.client import ZfsClient


class RootConfig(BaseModel):
    """Configuration for a single ZFS root folder."""
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    root_path: str
    sub_path: str = ""
    user_map: str | None = None
    group_map: str | None = None
    snapshot_patterns: tuple[str, ...] = ()
    dataset_name: str | None = None
    provider_type: str = "auto"  # "auto", "cli", "filesystem"


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


class AppConfig(BaseModel):
    """Main application configuration."""
    roots: dict[str, RootConfig] = Field(default_factory=dict)
    zfs: ZfsConfig = Field(default_factory=ZfsConfig)
    loglevel: str = "info"


def load_config(file_path: str, zfs_client: ZfsClient | None = None) -> AppConfig:
    """Loads configuration from a YAML file, runs dataset auto-discovery if enabled, and validates it."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Configuration file '{file_path}' could not be found.")

    with open(file_path, "r", encoding="utf-8") as f:
        loaded = yaml.safe_load(f)  # pyright: ignore[reportAny]
        data: dict[str, object] = cast(dict[str, object], loaded) if isinstance(loaded, dict) else {}

    app_cfg = AppConfig.model_validate(data)

    if app_cfg.zfs.auto_discover:
        client = zfs_client or ZfsClient()
        if client.is_available():
            discovered_roots: dict[str, RootConfig] = {}
            datasets = client.list_datasets(
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
                    provider_type="cli",
                )
            merged_roots = {**discovered_roots, **app_cfg.roots}
            app_cfg = AppConfig(
                roots=merged_roots,
                zfs=app_cfg.zfs,
                loglevel=app_cfg.loglevel,
            )

    return app_cfg

