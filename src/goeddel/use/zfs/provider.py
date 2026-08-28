from __future__ import annotations

import datetime
import os
from collections.abc import Sequence
from typing import TYPE_CHECKING

from ..logger import logger
from ..models.snapshot import OriginalSnapshot, Snapshot
from ..models.snapshot_provider import FilesystemSnapshotProvider, ISnapshotProvider

if TYPE_CHECKING:
    from .client import ZfsClient


class ZfsCliSnapshotProvider:
    """
    Discovers snapshots directly via OpenZFS CLI (`zfs list -t snapshot`) with exact
    creation timestamps from ZFS metadata. Automatically falls back to FilesystemSnapshotProvider
    if ZFS CLI is not available or the path is not a ZFS dataset.
    """

    def __init__(
        self,
        dataset_name: str | None = None,
        zfs_client: ZfsClient | None = None,
        fallback_provider: ISnapshotProvider | None = None,
    ) -> None:
        from .client import ZfsClient as ZClient

        self._dataset_name: str | None = dataset_name
        self._zfs_client: ZfsClient = zfs_client or ZClient()
        self._fallback: ISnapshotProvider = fallback_provider or FilesystemSnapshotProvider()
        self._fallback_mounts: dict[str, str] = {}

    def get_snapshots(
        self,
        snapshot_dir: str,
        patterns: Sequence[str],
        original_snapshot: OriginalSnapshot,
    ) -> list[Snapshot]:
        if not self._zfs_client.is_available():
            logger.info("ZFS CLI not available. Falling back to FilesystemSnapshotProvider for snapshot path '%s'", snapshot_dir)
            return self._fallback.get_snapshots(snapshot_dir, patterns, original_snapshot)

        ds_name = self._dataset_name
        if not ds_name:
            # Try to resolve dataset from the directory path (e.g. stripping .zfs/snapshot)
            base_dir = os.path.dirname(os.path.dirname(snapshot_dir)) if ".zfs" in snapshot_dir else snapshot_dir
            ds = self._zfs_client.find_dataset_by_path(base_dir)
            if ds:
                ds_name = ds.name

        if not ds_name:
            logger.info("No ZFS dataset name found for path '%s'. Falling back to FilesystemSnapshotProvider", snapshot_dir)
            return self._fallback.get_snapshots(snapshot_dir, patterns, original_snapshot)

        zfs_snaps = self._zfs_client.list_snapshots(ds_name)
        if not zfs_snaps:
            # Fall back to filesystem scan in case dataset has no ZFS CLI snapshots visible or permissions issue
            logger.info("No snapshots found via ZFS CLI for dataset '%s'. Falling back to FilesystemSnapshotProvider", ds_name)
            return self._fallback.get_snapshots(snapshot_dir, patterns, original_snapshot)

        discovered: list[Snapshot] = []
        for s in zfs_snaps:
            discovered.append(
                Snapshot(
                    name=s.snapshot_name,
                    timestamp=s.creation_time if s.creation_time != datetime.datetime.min else None,
                )
            )

        logger.info("Discovered %d snapshots via ZFS CLI for dataset '%s'", len(discovered), ds_name)

        def sort_key_desc(s: Snapshot) -> tuple[int, datetime.datetime, str]:
            if isinstance(s, OriginalSnapshot):
                return (2, datetime.datetime.max, "")
            if s.timestamp is not None:
                return (1, s.timestamp, s.name)
            return (0, datetime.datetime.min, s.name)

        sorted_snapshots = sorted(discovered, key=sort_key_desc, reverse=True)
        return [original_snapshot, *sorted_snapshots]

    def warmup_snapshots(self, root_path: str, snapshot_path: str) -> None:
        """
        Warms up the ZFS .zfs/snapshot automount directory by unconditionally triggering
        VFS lookup and opendir on .zfs and .zfs/snapshot.
        In OpenZFS on Linux, .zfs is hidden by default (snapdir=hidden). We must NOT
        guard with os.path.exists(), because accessing the path unconditionally is what
        triggers the OpenZFS VFS automount kernel hook!
        """
        zfs_dir = os.path.dirname(snapshot_path)

        logger.debug("Warming up ZFS snapshot directories for root path: %s", root_path)
        try:
            _ = os.stat(zfs_dir)
        except OSError as e:
            logger.debug("Failed to stat ZFS control directory %s: %s", zfs_dir, e)

        try:
            _ = os.stat(snapshot_path)
            entries = os.listdir(snapshot_path)
            # Touch each snapshot directory to trigger kernel automount
            for name in entries:
                try:
                    _ = os.stat(os.path.join(snapshot_path, name))
                except OSError:
                    pass
        except OSError as e:
            logger.debug("Failed to list ZFS snapshot directory %s: %s", snapshot_path, e)

    def _mount_snapshot_fallback(self, snapshot: Snapshot) -> str | None:
        """
        Manually mounts a ZFS snapshot to a temporary directory if the kernel VFS
        automounter fails (common in Docker cross-namespace bind mounts).
        """
        if not self._dataset_name:
            logger.warning("Cannot run manual fallback mount: no dataset name configured")
            return None

        import subprocess

        safe_dataset = self._dataset_name.replace("/", "_")
        fallback_dir = f"/tmp/zfs_snapshots/{safe_dataset}/{snapshot.id}"

        if os.path.ismount(fallback_dir):
            logger.debug("ZFS snapshot %s@%s is already mounted at fallback path %s", self._dataset_name, snapshot.id, fallback_dir)
            return fallback_dir

        logger.info("Executing ZFS fallback mount inside container namespace: mount -t zfs %s@%s %s", self._dataset_name, snapshot.id, fallback_dir)
        os.makedirs(fallback_dir, exist_ok=True)
        dataset_snap = f"{self._dataset_name}@{snapshot.id}"

        try:
            res = subprocess.run(["mount", "-t", "zfs", dataset_snap, fallback_dir], capture_output=True, text=True, check=False)
            if res.returncode == 0 or os.path.ismount(fallback_dir):
                logger.info("Successfully mounted ZFS fallback snapshot inside container: %s", fallback_dir)
                return fallback_dir
            else:
                logger.error("Failed to run manual ZFS fallback mount (exit code: %d): %s", res.returncode, res.stderr.strip())
        except OSError:
            logger.exception("Exception running manual ZFS fallback mount command")

        return None

    def ensure_snapshot_accessible(self, snapshot: Snapshot, root_path: str, snapshot_path: str) -> bool:
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

        snap_dir = os.path.join(snapshot_path, snapshot.id)

        # 1. Warm up parent .zfs/snapshot directory unconditionally
        self.warmup_snapshots(root_path, snapshot_path)

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

    def get_snapshot_path(self, snapshot: Snapshot, snapshot_path: str) -> str:
        if isinstance(snapshot, OriginalSnapshot):
            return ""
        if snapshot.id in self._fallback_mounts:
            return self._fallback_mounts[snapshot.id]
        return os.path.join(snapshot_path, snapshot.id)
