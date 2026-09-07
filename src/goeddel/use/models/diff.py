"""Data models for diffing operations."""

from __future__ import annotations

from dataclasses import dataclass

from ..enums import DiffLineType

DEFAULT_MAX_TEXT_DIFF_SIZE = 10 * 1024 * 1024


@dataclass(frozen=True)
class DiffLine:
    """Represents a single line within a text diff."""

    left_line_num: int | None
    right_line_num: int | None
    type: DiffLineType
    left_html: str
    right_html: str
    left_text: str
    right_text: str


@dataclass
class FileDiffResult:
    """Represents the complete result of a file diff computation."""

    left_snapshot_id: str
    left_snapshot_name: str
    left_snapshot_time: str
    right_snapshot_id: str
    right_snapshot_name: str
    right_snapshot_time: str
    is_binary: bool
    left_exists: bool
    right_exists: bool
    mime_type: str
    language: str
    lines: list[DiffLine]
    stats: dict[str, int]
    left_is_newer: bool = False

    def to_dict(self) -> dict[str, object]:
        """Convert the diff result to a JSON-serializable dictionary."""
        return {
            "left_snapshot_id": self.left_snapshot_id,
            "left_snapshot_name": self.left_snapshot_name,
            "left_snapshot_time": self.left_snapshot_time,
            "right_snapshot_id": self.right_snapshot_id,
            "right_snapshot_name": self.right_snapshot_name,
            "right_snapshot_time": self.right_snapshot_time,
            "is_binary": self.is_binary,
            "left_exists": self.left_exists,
            "right_exists": self.right_exists,
            "mime_type": self.mime_type,
            "language": self.language,
            "lines": [line.__dict__ for line in self.lines],
            "stats": self.stats,
            "left_is_newer": self.left_is_newer,
        }
