from __future__ import annotations

import datetime
from typing import override


class Snapshot:
    id: str
    name: str
    timestamp: datetime.datetime | None

    def __init__(self, name: str, timestamp: datetime.datetime | None = None) -> None:
        self.id = name
        self.name = name
        self.timestamp = timestamp

    @property
    def is_original(self) -> bool:
        return False

    @property
    def has_timestamp(self) -> bool:
        return self.timestamp is not None and not self.is_original

    @property
    def timestamp_formatted(self) -> str | None:
        if self.timestamp is None:
            return None
        return self.timestamp.strftime("%d.%m.%Y %H:%M:%S")

    @override
    def __eq__(self, other: object) -> bool:
        if isinstance(other, Snapshot):
            return self.id == other.id
        return False

    @override
    def __hash__(self) -> int:
        return hash(self.id)

    @override
    def __str__(self) -> str:
        return f'<Snapshot id="{self.id}">'

    @override
    def __repr__(self) -> str:
        return self.__str__()


class OriginalSnapshot(Snapshot):
    """ A special version of a snapshot which indicates no snapshot at all
        but instead the original filesystem.
    """

    def __init__(self) -> None:
        super().__init__(
            name="Original",
            timestamp=datetime.datetime.max
        )

    @property
    @override
    def is_original(self) -> bool:
        return True

    @property
    @override
    def timestamp_formatted(self) -> str:
        return "Live (Aktuell)"
