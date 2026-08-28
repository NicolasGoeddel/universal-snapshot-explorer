from __future__ import annotations

import datetime
from dataclasses import dataclass


@dataclass(frozen=True)
class ZfsDataset:
    """Represents a ZFS dataset (filesystem or volume)."""

    name: str
    pool: str
    mountpoint: str | None
    used_bytes: int = 0
    available_bytes: int = 0
    referenced_bytes: int = 0
    is_mounted: bool = True

    @property
    def short_name(self) -> str:
        """Returns the dataset's relative leaf name (e.g. 'pie4' for 'data/backups/pie4')."""
        return self.name.split("/")[-1] if "/" in self.name else self.name


@dataclass(frozen=True)
class ZfsSnapshotInfo:
    """Represents a snapshot queried directly from ZFS CLI."""

    dataset_name: str
    snapshot_name: str
    full_name: str
    creation_time: datetime.datetime
    used_bytes: int = 0
    referenced_bytes: int = 0
