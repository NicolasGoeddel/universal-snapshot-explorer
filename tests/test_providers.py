from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from goeddel.use.mounts import MountInfo
from goeddel.use.providers.base import ProviderRegistry


class TestProviders(unittest.TestCase):
    def test_provider_registry_get(self) -> None:
        zfs_provider = ProviderRegistry.get("zfs")
        self.assertEqual(zfs_provider.name, "zfs")

        btrfs_provider = ProviderRegistry.get("btrfs")
        self.assertEqual(btrfs_provider.name, "btrfs")

        generic_provider = ProviderRegistry.get("unknown")
        self.assertEqual(generic_provider.name, "generic")

    @patch("os.path.isdir")
    def test_zfs_provider_detection(self, mock_isdir: MagicMock) -> None:
        # Mock os.path.isdir to return True only for .zfs
        def side_effect(path: str) -> bool:
            return path.endswith(".zfs") or path.endswith(".zfs/snapshot")

        # In python 3.14 patch we should use side_effect
        mock_isdir.side_effect = side_effect

        zfs_provider = ProviderRegistry.detect_filesystem("/mnt/data", None)
        self.assertEqual(zfs_provider.name, "zfs")

    @patch("os.path.isdir")
    def test_btrfs_provider_detection(self, mock_isdir: MagicMock) -> None:
        # Mock os.path.isdir to return True only for .snapshots
        def side_effect(path: str) -> bool:
            return path.endswith(".snapshots")

        mock_isdir.side_effect = side_effect

        btrfs_provider = ProviderRegistry.detect_filesystem("/mnt/data", None)
        self.assertEqual(btrfs_provider.name, "btrfs")

    @patch("os.path.isdir")
    def test_generic_provider_detection(self, mock_isdir: MagicMock) -> None:
        mock_isdir.return_value = False

        generic_provider = ProviderRegistry.detect_filesystem("/mnt/data", None)
        self.assertEqual(generic_provider.name, "generic")

    def test_generic_provider_display_name(self) -> None:
        generic_provider = ProviderRegistry.get("unknown")

        # Test sub dataset generic display name
        self.assertEqual(generic_provider.get_display_name(None, is_sub_dataset=True), "Snapshot Root")

        # Test mount generic display name
        mount_info = MountInfo(mountpoint="/mnt", fstype="cifs")
        self.assertEqual(generic_provider.get_display_name(mount_info, is_sub_dataset=False), "CIFS/SMB Mount")

        mount_info_nfs = MountInfo(mountpoint="/mnt", fstype="nfs4")
        self.assertEqual(generic_provider.get_display_name(mount_info_nfs, is_sub_dataset=False), "NFS Mount (nfs4)")
