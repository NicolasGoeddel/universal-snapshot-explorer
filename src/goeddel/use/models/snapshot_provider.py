from __future__ import annotations

import datetime
import os
import re
from collections.abc import Sequence
from typing import Protocol

from ..logger import logger
from .snapshot import OriginalSnapshot, Snapshot


def compile_snapshot_pattern(pattern: str) -> re.Pattern[str]:
    """
    Compiles a snapshot pattern containing strftime tokens (%Y, %m, %d, %H, %M, %S),
    format placeholders ({year}, {month}, {day}, {hour}, {minute}, {second}, {type}),
    or wildcards (*, ?) into a named-group regex.
    """
    tokens = {
        "%Y": r"(?P<year>\d{4})",
        "{year}": r"(?P<year>\d{4})",
        "%m": r"(?P<month>\d{1,2})",
        "{month}": r"(?P<month>\d{1,2})",
        "%d": r"(?P<day>\d{1,2})",
        "{day}": r"(?P<day>\d{1,2})",
        "%H": r"(?P<hour>\d{1,2})",
        "{hour}": r"(?P<hour>\d{1,2})",
        "%M": r"(?P<minute>\d{1,2})",
        "{minute}": r"(?P<minute>\d{1,2})",
        "%S": r"(?P<second>\d{1,2})",
        "{second}": r"(?P<second>\d{1,2})",
    }
    p = re.sub(r"\{[a-zA-Z0-9_]+\}", lambda m: tokens.get(m.group(0), r".*?"), pattern)
    parts: list[str] = []
    i = 0
    while i < len(p):
        matched_token = False
        for tok, rep in tokens.items():
            if p[i : i + len(tok)] == tok:
                parts.append(rep)
                i += len(tok)
                matched_token = True
                break
        if not matched_token:
            if p[i] == "*":
                parts.append(r".*")
            elif p[i] == "?":
                parts.append(r".")
            else:
                parts.append(re.escape(p[i]))
            i += 1

    return re.compile("^" + "".join(parts) + "$")


def parse_snapshot_timestamp(name: str, compiled_patterns: list[re.Pattern[str]]) -> datetime.datetime | None:
    """
    Extracts a datetime from snapshot name against a list of compiled pattern regexes.
    Returns None if no pattern matches.
    """
    for regex in compiled_patterns:
        m = regex.match(name)
        if m:
            gd = m.groupdict()
            try:
                year = int(gd.get("year", 1970))
                month = int(gd.get("month", 1))
                day = int(gd.get("day", 1))
                hour = int(gd.get("hour", 0))
                minute = int(gd.get("minute", 0))
                second = int(gd.get("second", 0))
                return datetime.datetime(year, month, day, hour, minute, second)
            except ValueError:
                continue
    return None


class ISnapshotProvider(Protocol):
    """Protocol for pluggable snapshot discovery (e.g. filesystem-based or direct ZFS CLI)."""

    def get_snapshots(
        self,
        snapshot_dir: str,
        patterns: Sequence[str],
        original_snapshot: OriginalSnapshot,
    ) -> list[Snapshot]: ...

    def warmup_snapshots(self, root_path: str, snapshot_path: str) -> None: ...

    def ensure_snapshot_accessible(self, snapshot: Snapshot, root_path: str, snapshot_path: str) -> bool: ...

    def get_snapshot_path(self, snapshot: Snapshot, snapshot_path: str) -> str: ...


class FilesystemSnapshotProvider:
    """
    Discovers snapshots by scanning the .zfs/snapshot directory and extracting
    timestamps via configured filename patterns.
    """

    def __init__(self) -> None:
        self._compiled_cache: dict[str, re.Pattern[str]] = {}

    def _get_compiled_patterns(self, patterns: Sequence[str]) -> list[re.Pattern[str]]:
        compiled: list[re.Pattern[str]] = []
        for pat in patterns:
            if pat not in self._compiled_cache:
                self._compiled_cache[pat] = compile_snapshot_pattern(pat)
            compiled.append(self._compiled_cache[pat])
        return compiled

    def get_snapshots(
        self,
        snapshot_dir: str,
        patterns: Sequence[str],
        original_snapshot: OriginalSnapshot,
    ) -> list[Snapshot]:
        compiled_patterns = self._get_compiled_patterns(patterns)
        discovered: list[Snapshot] = []

        if os.path.exists(snapshot_dir):
            try:
                for name in os.listdir(snapshot_dir):
                    ts = parse_snapshot_timestamp(name, compiled_patterns)
                    discovered.append(Snapshot(name=name, timestamp=ts))
            except OSError as exc:
                logger.warning("Could not read snapshot directory '%s': %s", snapshot_dir, exc)

        logger.debug("FilesystemSnapshotProvider discovered %d snapshots in '%s'", len(discovered), snapshot_dir)

        # Sorting key for reverse chronological order:
        # 1. Original (newest / live state)
        # 2. Timestamped snapshots (from newest to oldest)
        # 3. Snapshots without timestamps (sorted by name)
        def sort_key_desc(s: Snapshot) -> tuple[int, datetime.datetime, str]:
            if isinstance(s, OriginalSnapshot):
                return (2, datetime.datetime.max, "")
            if s.timestamp is not None:
                return (1, s.timestamp, s.name)
            return (0, datetime.datetime.min, s.name)

        sorted_snapshots = sorted(discovered, key=sort_key_desc, reverse=True)
        return [original_snapshot, *sorted_snapshots]

    def warmup_snapshots(self, root_path: str, snapshot_path: str) -> None:
        _ = (root_path, snapshot_path)

    def ensure_snapshot_accessible(self, snapshot: Snapshot, root_path: str, snapshot_path: str) -> bool:
        _ = root_path
        if isinstance(snapshot, OriginalSnapshot):
            return True
        # For a generic filesystem, just verify the snapshot directory exists
        snap_dir = os.path.join(snapshot_path, snapshot.id)
        return os.path.isdir(snap_dir)

    def get_snapshot_path(self, snapshot: Snapshot, snapshot_path: str) -> str:
        if isinstance(snapshot, OriginalSnapshot):
            return ""  # Original snapshot doesn't have a snapshot path
        return os.path.join(snapshot_path, snapshot.id)
