from __future__ import annotations

import datetime
import os
import re
import xml.etree.ElementTree as ET
from collections.abc import Sequence
from typing import TYPE_CHECKING

from ..logger import logger
from ..models.snapshot import OriginalSnapshot, Snapshot
from ..models.snapshot_provider import (
    FilesystemSnapshotProvider,
    ISnapshotProvider,
    compile_snapshot_pattern,
    parse_snapshot_timestamp,
)

if TYPE_CHECKING:
    from .client import BtrfsClient


class BtrfsSnapshotProvider:
    """
    Discovers Btrfs snapshots. Supports both Snapper directory layouts
    (<snapshot_dir>/<num>/snapshot + info.xml) and flat snapshot directory structures.
    Extracts timestamps from info.xml, btrfs CLI metadata, directory stat timestamps,
    or configured filename patterns.
    """

    def __init__(
        self,
        btrfs_client: BtrfsClient | None = None,
        fallback_provider: ISnapshotProvider | None = None,
    ) -> None:
        from .client import BtrfsClient as BClient

        self._btrfs_client: BtrfsClient = btrfs_client or BClient()
        self._fallback: ISnapshotProvider = fallback_provider or FilesystemSnapshotProvider()
        self._compiled_cache: dict[str, re.Pattern[str]] = {}

    def _get_compiled_patterns(self, patterns: Sequence[str]) -> list[re.Pattern[str]]:
        compiled: list[re.Pattern[str]] = []
        for pat in patterns:
            if pat not in self._compiled_cache:
                self._compiled_cache[pat] = compile_snapshot_pattern(pat)
            compiled.append(self._compiled_cache[pat])
        return compiled

    @staticmethod
    def _parse_snapper_info_xml(info_file: str) -> datetime.datetime | None:
        """Parses the timestamp from a Snapper info.xml file."""
        if not os.path.isfile(info_file):
            return None
        try:
            tree = ET.parse(info_file)
            root = tree.getroot()
            date_elem = root.find("date")
            if date_elem is not None and date_elem.text:
                text = date_elem.text.strip()
                # Expected format: '2026-05-30 11:04:39' or ISO format
                try:
                    return datetime.datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
                except ValueError:
                    try:
                        return datetime.datetime.fromisoformat(text)
                    except ValueError:
                        pass
        except (ET.ParseError, OSError) as exc:
            logger.debug("Failed to parse Snapper info.xml at '%s': %s", info_file, exc)
        return None

    def get_snapshots(
        self,
        snapshot_dir: str,
        patterns: Sequence[str],
        original_snapshot: OriginalSnapshot,
    ) -> list[Snapshot]:
        if not os.path.exists(snapshot_dir):
            logger.debug("Btrfs snapshot directory '%s' does not exist", snapshot_dir)
            return [original_snapshot]

        compiled_patterns = self._get_compiled_patterns(patterns)
        discovered: list[Snapshot] = []

        try:
            entries = os.listdir(snapshot_dir)
        except OSError as exc:
            logger.warning("Could not read Btrfs snapshot directory '%s': %s", snapshot_dir, exc)
            return [original_snapshot]

        for entry_name in entries:
            entry_path = os.path.join(snapshot_dir, entry_name)
            if not os.path.isdir(entry_path):
                continue

            snapper_subvol = os.path.join(entry_path, "snapshot")
            is_snapper = os.path.isdir(snapper_subvol)
            target_snap_path = snapper_subvol if is_snapper else entry_path

            ts: datetime.datetime | None = None

            # 1. If Snapper layout, check info.xml
            if is_snapper:
                info_xml = os.path.join(entry_path, "info.xml")
                ts = self._parse_snapper_info_xml(info_xml)

            # 2. Check pattern matching on entry name
            if ts is None and compiled_patterns:
                ts = parse_snapshot_timestamp(entry_name, compiled_patterns)

            # 3. Check btrfs CLI show metadata if available
            if ts is None and self._btrfs_client.is_available():
                info = self._btrfs_client.get_subvolume_info(target_snap_path)
                if info and info.creation_time:
                    ts = info.creation_time

            # 4. Fallback to directory stat mtime/ctime
            if ts is None:
                try:
                    st = os.stat(target_snap_path)
                    # Use directory mtime if valid
                    ts = datetime.datetime.fromtimestamp(st.st_mtime)
                except OSError:
                    pass

            discovered.append(Snapshot(name=entry_name, timestamp=ts))

        logger.debug("BtrfsSnapshotProvider discovered %d snapshots in '%s'", len(discovered), snapshot_dir)

        def sort_key_desc(s: Snapshot) -> tuple[int, datetime.datetime, str]:
            if isinstance(s, OriginalSnapshot):
                return (2, datetime.datetime.max, "")
            if s.timestamp is not None:
                return (1, s.timestamp, s.name)
            return (0, datetime.datetime.min, s.name)

        sorted_snapshots = sorted(discovered, key=sort_key_desc, reverse=True)
        return [original_snapshot, *sorted_snapshots]

    def warmup_snapshots(self, root_path: str, snapshot_path: str) -> None:
        """Btrfs snapshots are regular subvolume directories; no special kernel VFS warmup required."""
        _ = (root_path, snapshot_path)

    def ensure_snapshot_accessible(self, snapshot: Snapshot, root_path: str, snapshot_path: str) -> bool:
        _ = root_path
        if isinstance(snapshot, OriginalSnapshot):
            return True
        snap_path = self.get_snapshot_path(snapshot, snapshot_path)
        return os.path.isdir(snap_path)

    def get_snapshot_path(self, snapshot: Snapshot, snapshot_path: str) -> str:
        if isinstance(snapshot, OriginalSnapshot):
            return ""
        # Check for Snapper layout: <snapshot_path>/<id>/info.xml
        snapper_info = os.path.join(snapshot_path, snapshot.id, "info.xml")
        if os.path.isfile(snapper_info):
            return os.path.join(snapshot_path, snapshot.id, "snapshot")
        return os.path.join(snapshot_path, snapshot.id)
