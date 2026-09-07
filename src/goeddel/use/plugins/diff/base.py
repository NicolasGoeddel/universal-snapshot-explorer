"""Base classes for differ plugins."""

from abc import ABC, abstractmethod
from collections.abc import Sequence

from goeddel.use.models.snapshot import Snapshot


class DiffPlugin(ABC):
    """Abstract base class for differ plugins."""

    plugin_id: str
    min_snapshots: int
    max_snapshots: int | None

    @abstractmethod
    def compute(self, snapshots: Sequence[Snapshot | None], paths: Sequence[str | None], **kwargs: object) -> object:
        """
        Compute the diff over a sequence of snapshots and paths.
        """
        pass
