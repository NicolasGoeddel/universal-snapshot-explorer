from __future__ import annotations

from .base import FilesystemProvider, ProviderRegistry
from .btrfs import BtrfsProvider
from .generic import GenericProvider
from .zfs import ZfsProvider

# Register default providers
ProviderRegistry.register(GenericProvider())
ProviderRegistry.register(ZfsProvider())
ProviderRegistry.register(BtrfsProvider())

__all__ = [
    "FilesystemProvider",
    "ProviderRegistry",
    "ZfsProvider",
    "BtrfsProvider",
    "GenericProvider",
]
