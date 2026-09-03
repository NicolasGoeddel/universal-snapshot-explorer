from __future__ import annotations

import abc
from typing import TYPE_CHECKING

from ..enums import FilesystemType

if TYPE_CHECKING:
    from ..config import RootConfig
    from ..models.snapshot_provider import ISnapshotProvider
    from ..mounts import MountInfo


class FilesystemProvider(abc.ABC):
    """Abstract base class for all filesystem providers."""

    @property
    @abc.abstractmethod
    def name(self) -> FilesystemType:
        """The name/ID of the provider (e.g. FilesystemType.ZFS)."""
        pass

    @abc.abstractmethod
    def detect_boundary(self, live_path: str, mount_info: MountInfo | None) -> bool:
        """Returns True if the given path crosses into this filesystem's implicit boundaries."""
        pass

    @abc.abstractmethod
    def get_display_name(self, mount_info: MountInfo | None, is_sub_dataset: bool = False) -> str:
        """Returns a user-friendly name for this filesystem (e.g. 'ZFS Dataset')."""
        pass

    @abc.abstractmethod
    def get_icon(self) -> tuple[str, str]:
        """Returns a tuple of (lucide_icon_name, css_class) for this filesystem."""
        pass

    @abc.abstractmethod
    def create_snapshot_provider(self, config: RootConfig) -> ISnapshotProvider:
        """Instantiates and returns the SnapshotProvider implementation for this filesystem."""
        pass


class ProviderRegistry:
    """Registry to manage and discover filesystem providers."""

    _providers: dict[FilesystemType | str, FilesystemProvider] = {}
    _default_provider_name: FilesystemType = FilesystemType.GENERIC

    @classmethod
    def register(cls, provider: FilesystemProvider) -> None:
        cls._providers[provider.name] = provider

    @classmethod
    def get(cls, name: FilesystemType | str) -> FilesystemProvider:
        return cls._providers.get(name) or cls._providers[cls._default_provider_name]

    @classmethod
    def detect_filesystem(cls, live_path: str, mount_info: MountInfo | None) -> FilesystemProvider:
        """Iterates through registered providers to see if any detect a boundary at the given path."""
        for provider in cls._providers.values():
            if provider.name == cls._default_provider_name:
                continue
            if provider.detect_boundary(live_path, mount_info):
                return provider
        return cls.get(cls._default_provider_name)

    @classmethod
    def all_providers(cls) -> list[FilesystemProvider]:
        return list(cls._providers.values())
