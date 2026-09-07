from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
from collections.abc import Sequence
from typing import cast

from .enums import DiffLineType
from .models.diff import DEFAULT_MAX_TEXT_DIFF_SIZE, DiffLine, FileDiffResult
from .models.snapshot import Snapshot
from .models.types import SnapshotBarItem
from .plugins.diff.base import DiffPlugin
from .plugins.diff.text_differ import TextDifferPlugin

logger = logging.getLogger(__name__)


class DiffEngine:
    """Manager and executor for diff plugins."""

    CACHE_DIR: str = os.path.join(tempfile.gettempdir(), "use-diff-cache")
    _plugins: dict[str, DiffPlugin] = {}

    @classmethod
    def register_plugin(cls, plugin: DiffPlugin) -> None:
        """Register a new diff plugin with the engine."""
        cls._plugins[plugin.plugin_id] = plugin
        logger.info("Registered diff plugin: %s", plugin.plugin_id)

    @classmethod
    def get_plugin(cls, plugin_id: str) -> DiffPlugin:
        """Retrieve a registered diff plugin by its ID."""
        if not cls._plugins:
            cls.register_plugin(TextDifferPlugin())
        if plugin_id not in cls._plugins:
            raise ValueError(f"Unknown diff plugin: {plugin_id}")
        return cls._plugins[plugin_id]

    @classmethod
    def _ensure_cache_dir(cls) -> None:
        """Ensure the diff cache directory exists."""
        try:
            os.makedirs(cls.CACHE_DIR, exist_ok=True)
        except OSError as e:
            logger.debug("Failed to create diff cache dir: %s", e)

    @classmethod
    def _get_cache_path(
        cls,
        root_name: str,
        path: str,
        plugin_id: str,
        snapshot_ids: Sequence[str],
        mtimes: Sequence[float | None],
    ) -> str:
        """Generate a stable cache file path for a diff."""
        key_parts = [root_name, path, plugin_id]
        key_parts.extend(snapshot_ids)
        key_parts.extend(str(m) for m in mtimes)
        key = ":".join(key_parts)
        filename = hashlib.sha256(key.encode("utf-8")).hexdigest() + ".json"
        return os.path.join(cls.CACHE_DIR, filename)

    @classmethod
    def resolve_snapshots(
        cls,
        bar: Sequence[SnapshotBarItem],
        active_snapshot_id: str | None,
        explicit_snapshots: list[str] | None,
    ) -> list[str]:
        """Resolve a sequence of snapshot IDs from request params or the timeline bar."""
        if explicit_snapshots and len(explicit_snapshots) > 0:
            return explicit_snapshots

        active_snap_id = active_snapshot_id or "Original"
        bar_idx = -1
        for idx, item in enumerate(bar):
            snap = item.get("snapshot")
            if snap and getattr(snap, "id", None) == active_snap_id:
                bar_idx = idx
                break

        if bar_idx == -1 and bar:
            bar_idx = 0

        selected_right = None
        selected_left = None

        if bar_idx >= 0:
            item = bar[bar_idx]
            is_missing = bool(item.get("missing", False))
            if not is_missing:
                snap = item.get("snapshot")
                selected_right = getattr(snap, "id", None) if snap else None
                if bar_idx < len(bar) - 1:
                    prev_snap = bar[bar_idx + 1].get("snapshot")
                    selected_left = getattr(prev_snap, "id", None) if prev_snap else None
                elif len(bar) > 1:
                    oldest_snap = bar[len(bar) - 1].get("snapshot")
                    selected_left = getattr(oldest_snap, "id", None) if oldest_snap else None
                else:
                    selected_left = selected_right
            else:
                del_idx = bar_idx
                while del_idx < len(bar) and bool(bar[del_idx].get("missing", False)):
                    del_idx += 1

                if del_idx < len(bar):
                    snap = bar[del_idx].get("snapshot")
                    selected_right = getattr(snap, "id", None) if snap else None
                    if del_idx < len(bar) - 1:
                        prev_snap = bar[del_idx + 1].get("snapshot")
                        selected_left = getattr(prev_snap, "id", None) if prev_snap else None
                    else:
                        selected_left = selected_right
                else:
                    found_trans = False
                    for i in range(len(bar) - 1, -1, -1):
                        if not bool(bar[i].get("missing", False)):
                            snap = bar[i].get("snapshot")
                            selected_right = getattr(snap, "id", None) if snap else None
                            if i < len(bar) - 1:
                                prev_snap = bar[i + 1].get("snapshot")
                                selected_left = getattr(prev_snap, "id", None) if prev_snap else None
                            else:
                                selected_left = selected_right
                            found_trans = True
                            break
                    if not found_trans:
                        snap = item.get("snapshot")
                        selected_right = getattr(snap, "id", None) if snap else None
                        selected_left = selected_right

        if not selected_right:
            selected_right = "Original"
        if not selected_left:
            selected_left = selected_right

        return [selected_left, selected_right]

    @classmethod
    def compute_diff(
        cls,
        plugin_id: str,
        snapshots: list[Snapshot | None],
        paths: list[str | None],
        root_name: str,
        file_path: str,
        mime_type: str | None = None,
        left_is_newer: bool = False,
        max_file_size: int = DEFAULT_MAX_TEXT_DIFF_SIZE,
    ) -> object:
        """Compute the diff by delegating to the appropriate plugin and handling caching."""
        plugin = cls.get_plugin(plugin_id)
        if len(snapshots) < plugin.min_snapshots:
            raise ValueError(f"Plugin {plugin_id} requires at least {plugin.min_snapshots} snapshots")
        if plugin.max_snapshots is not None and len(snapshots) > plugin.max_snapshots:
            raise ValueError(f"Plugin {plugin_id} allows at most {plugin.max_snapshots} snapshots")

        mtimes = [os.path.getmtime(p) if p and os.path.exists(p) else None for p in paths]
        snap_ids = [s.id if s else "Original" for s in snapshots]

        cls._ensure_cache_dir()
        cache_file = cls._get_cache_path(root_name, file_path, plugin_id, snap_ids, mtimes)

        # Check cache
        if os.path.isfile(cache_file):
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    data_raw = cast(object, json.load(f))
                    if plugin_id == "text-differ" and isinstance(data_raw, dict):
                        data_dict = cast(dict[str, object], data_raw)
                        # Special handling for text-differ cache
                        raw_lines = data_dict.get("lines", [])
                        lines: list[DiffLine] = []
                        if isinstance(raw_lines, list):
                            raw_list = cast(list[object], raw_lines)
                            for item in raw_list:
                                if isinstance(item, dict):
                                    item_dict = cast(dict[str, object], item)
                                    left_num = item_dict.get("left_line_num")
                                    right_num = item_dict.get("right_line_num")
                                    line_type_str = str(item_dict.get("type", "equal"))
                                    try:
                                        line_type = DiffLineType(line_type_str)
                                    except ValueError:
                                        line_type = DiffLineType.EQUAL
                                    lines.append(
                                        DiffLine(
                                            left_line_num=left_num if isinstance(left_num, int) else None,
                                            right_line_num=right_num if isinstance(right_num, int) else None,
                                            type=line_type,
                                            left_html=str(item_dict.get("left_html", "")),
                                            right_html=str(item_dict.get("right_html", "")),
                                            left_text=str(item_dict.get("left_text", "")),
                                            right_text=str(item_dict.get("right_text", "")),
                                        )
                                    )
                        raw_stats = data_dict.get("stats", {})
                        stats: dict[str, int] = {}
                        if isinstance(raw_stats, dict):
                            raw_stats_dict = cast(dict[object, object], raw_stats)
                            stats = {str(k): int(str(v)) for k, v in raw_stats_dict.items() if isinstance(v, (int, float))}
                        return FileDiffResult(
                            left_snapshot_id=str(data_dict.get("left_snapshot_id", "")),
                            left_snapshot_name=str(data_dict.get("left_snapshot_name", "")),
                            left_snapshot_time=str(data_dict.get("left_snapshot_time", "")),
                            right_snapshot_id=str(data_dict.get("right_snapshot_id", "")),
                            right_snapshot_name=str(data_dict.get("right_snapshot_name", "")),
                            right_snapshot_time=str(data_dict.get("right_snapshot_time", "")),
                            is_binary=bool(data_dict.get("is_binary", False)),
                            left_exists=bool(data_dict.get("left_exists", False)),
                            right_exists=bool(data_dict.get("right_exists", False)),
                            mime_type=str(data_dict.get("mime_type", "text/plain")),
                            language=str(data_dict.get("language", "text")),
                            lines=lines,
                            stats=stats,
                            left_is_newer=bool(data_dict.get("left_is_newer", left_is_newer)),
                        )
                    else:
                        # Return dict for other plugins if they support it
                        return data_raw
            except Exception as e:
                logger.warning("Failed reading cache %s: %s", cache_file, e)

        result = plugin.compute(
            snapshots=snapshots, paths=paths, file_path=file_path, mime_type=mime_type, left_is_newer=left_is_newer, max_file_size=max_file_size
        )

        # Write cache
        try:
            with open(cache_file, "w", encoding="utf-8") as f:
                if isinstance(result, FileDiffResult):
                    json.dump(result.to_dict(), f)
                else:
                    json.dump(result, f)
            logger.debug("Saved diff cache for '%s' to %s", file_path, cache_file)
        except Exception as e:
            logger.warning("Failed writing diff cache %s: %s", cache_file, e)

        return result
