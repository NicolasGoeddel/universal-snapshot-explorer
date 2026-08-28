from __future__ import annotations

import datetime
from dataclasses import dataclass


@dataclass(frozen=True)
class BtrfsSubvolume:
    """Represents metadata for a Btrfs subvolume or snapshot."""

    subvolume_id: int
    path: str
    parent_id: int | None = None
    uuid: str | None = None
    parent_uuid: str | None = None
    creation_time: datetime.datetime | None = None
    is_snapshot: bool = False
    is_readonly: bool = False

    @property
    def short_name(self) -> str:
        """Returns the base name of the subvolume/snapshot."""
        return self.path.rstrip("/").split("/")[-1]
