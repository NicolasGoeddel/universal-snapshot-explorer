from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import cast
from unittest.mock import patch

from goeddel.use.config import RootConfig
from goeddel.use.enums import FilesystemType
from goeddel.use.models.folder import Folder
from goeddel.use.models.root_folder import RootFolder
from goeddel.use.models.snapshot import OriginalSnapshot
from goeddel.use.mounts import MountInfo, MountsManager


class TestMountsModule(unittest.TestCase):
    def test_mount_info_dataclass(self) -> None:
        proc_mount = MountInfo(mountpoint="/proc", fstype="proc")
        self.assertTrue(proc_mount.is_kernel_pseudo_fs)
        self.assertFalse(proc_mount.is_network_fs)
        self.assertFalse(proc_mount.is_snapshot_capable)

        nfs_mount = MountInfo(mountpoint="/data/backups", fstype="nfs4")
        self.assertFalse(nfs_mount.is_kernel_pseudo_fs)
        self.assertTrue(nfs_mount.is_network_fs)
        self.assertFalse(nfs_mount.is_snapshot_capable)

        zfs_mount = MountInfo(mountpoint="/mnt/pool/data", fstype="zfs")
        self.assertFalse(zfs_mount.is_kernel_pseudo_fs)
        self.assertFalse(zfs_mount.is_network_fs)
        self.assertTrue(zfs_mount.is_snapshot_capable)

    def test_mounts_manager_parsing(self) -> None:
        mock_proc_mounts = """
proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0
sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0
devpts /dev/pts devpts rw,nosuid,noexec,relatime 0 0
tmpfs /run tmpfs rw,nosuid,nodev,noexec,relatime 0 0
/dev/nvme0n1p2 / btrfs rw,noatime,compress=zstd:3 0 0
truenas.local:/mnt/pool/backups /data/backups nfs4 rw,relatime,vers=4.2 0 0
"""
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as f:
            f.write(mock_proc_mounts)
            tmp_path = f.name

        try:
            manager = MountsManager(mounts_file=tmp_path)
            mounts = manager.get_all_mounts()
            self.assertIn("/proc", mounts)
            self.assertEqual(mounts["/proc"].fstype, "proc")
            self.assertIn("/data/backups", mounts)
            self.assertEqual(mounts["/data/backups"].fstype, "nfs4")
            self.assertIn("/", mounts)
            self.assertEqual(mounts["/"].fstype, "btrfs")

            info = manager.get_mount_info("/data/backups")
            self.assertIsNotNone(info)
            assert info is not None
            self.assertTrue(info.is_network_fs)
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    def test_folder_display_type_and_icons(self) -> None:
        # Mock MountsManager with custom mount definitions
        manager = MountsManager.get_instance()
        manager._cache = {
            "/mnt/pool/parent/proc": MountInfo(mountpoint="/mnt/pool/parent/proc", fstype="proc"),
            "/mnt/pool/parent/sys": MountInfo(mountpoint="/mnt/pool/parent/sys", fstype="sysfs"),
            "/mnt/pool/parent/tmp": MountInfo(mountpoint="/mnt/pool/parent/tmp", fstype="tmpfs"),
            "/mnt/pool/parent/nfs_unconfigured": MountInfo(mountpoint="/mnt/pool/parent/nfs_unconfigured", fstype="nfs4"),
            "/mnt/pool/parent/nfs_configured_zfs": MountInfo(mountpoint="/mnt/pool/parent/nfs_configured_zfs", fstype="nfs4"),
            "/mnt/pool/parent/btrfs_child": MountInfo(mountpoint="/mnt/pool/parent/btrfs_child", fstype="btrfs"),
        }

        # Configure RootFolder instances
        parent_cfg = RootConfig(root_path="/mnt/pool/parent", sub_path="", filesystem_type=FilesystemType.ZFS)
        nfs_zfs_cfg = RootConfig(root_path="/mnt/pool/parent/nfs_configured_zfs", sub_path="", filesystem_type=FilesystemType.ZFS)
        btrfs_cfg = RootConfig(root_path="/mnt/pool/parent/btrfs_child", sub_path="", filesystem_type=FilesystemType.BTRFS)

        RootFolder.set_root_configs(
            {
                "parent-root": parent_cfg,
                "nfs-zfs-root": nfs_zfs_cfg,
                "btrfs-root": btrfs_cfg,
            }
        )
        root_folder = RootFolder(parent_cfg)
        orig = OriginalSnapshot()

        with patch("os.path.ismount", return_value=True):
            # 1. Configured NFS mount overridden as ZFS Root in config
            folder_nfs_zfs = Folder(root_folder, "nfs_configured_zfs", orig, name="nfs_configured_zfs")
            self.assertEqual(folder_nfs_zfs.sub_dataset_root_name, "nfs-zfs-root")
            self.assertEqual(folder_nfs_zfs.display_type, "ZFS Dataset (NFS4)")
            self.assertEqual(folder_nfs_zfs.icon_name, "database")

            # 2. Configured Btrfs child subvolume
            folder_btrfs = Folder(root_folder, "btrfs_child", orig, name="btrfs_child")
            self.assertEqual(folder_btrfs.sub_dataset_root_name, "btrfs-root")
            self.assertEqual(folder_btrfs.display_type, "Btrfs Subvolume")
            self.assertEqual(folder_btrfs.icon_name, "database")

            # 3. Unconfigured Kernel mount (/proc)
            folder_proc = Folder(root_folder, "proc", orig, name="proc")
            self.assertIsNone(folder_proc.sub_dataset_root_name)
            self.assertTrue(folder_proc.is_kernel_fs)
            self.assertEqual(folder_proc.display_type, "Kernel Mount (proc)")
            self.assertEqual(folder_proc.icon_name, "cpu")

            # 4. Unconfigured NFS mount
            folder_nfs_unconf = Folder(root_folder, "nfs_unconfigured", orig, name="nfs_unconfigured")
            self.assertIsNone(folder_nfs_unconf.sub_dataset_root_name)
            self.assertFalse(folder_nfs_unconf.is_kernel_fs)
            self.assertTrue(folder_nfs_unconf.is_sub_dataset)
            self.assertEqual(folder_nfs_unconf.display_type, "NFS Mount (nfs4)")
            self.assertEqual(folder_nfs_unconf.icon_name, "hard-drive")

            # 5. Unconfigured tmpfs mount
            folder_tmp = Folder(root_folder, "tmp", orig, name="tmp")
            self.assertIsNone(folder_tmp.sub_dataset_root_name)
            self.assertTrue(folder_tmp.is_sub_dataset)
            self.assertEqual(folder_tmp.display_type, "tmpfs Mount")
            self.assertEqual(folder_tmp.icon_name, "hard-drive")

        # 6. Regular unmounted folder
        with patch("os.path.ismount", return_value=False):
            folder_normal = Folder(root_folder, "normal_folder", orig, name="normal_folder")
            self.assertIsNone(folder_normal.sub_dataset_root_name)
            self.assertFalse(folder_normal.is_mount)
            self.assertEqual(folder_normal.display_type, "directory")
            self.assertEqual(folder_normal.icon_name, "folder")

    def test_mount_boundary_snapshot_bars(self) -> None:
        mounts_map = {
            "/mnt/pool/parent/proc": MountInfo(mountpoint="/mnt/pool/parent/proc", fstype="proc"),
            "/mnt/pool/parent/tmp": MountInfo(mountpoint="/mnt/pool/parent/tmp", fstype="tmpfs"),
        }
        MountsManager.get_instance()._cache = mounts_map

        parent_cfg = RootConfig(root_path="/mnt/pool/parent", sub_path="", filesystem_type=FilesystemType.ZFS)
        RootFolder.set_root_configs({"parent-root": parent_cfg})
        root_folder = RootFolder(parent_cfg)

        with (
            patch.object(root_folder, "snapshots", return_value=[OriginalSnapshot()]),
            patch.object(root_folder, "_scan_dir_live", return_value={"proc": (1, 2, 3, 4, 5, 6, 7), "tmp": (1, 2, 3, 4, 5, 6, 7)}),
            patch("os.path.ismount", return_value=True),
        ):
            bars_data = root_folder.get_snapshot_bars_data("")
            bars_obj = bars_data.get("bars", {})
            self.assertIsInstance(bars_obj, dict)
            bars = cast(dict[str, object], bars_obj)
            self.assertIn("proc", bars)
            self.assertIn("tmp", bars)
            self.assertEqual(bars["proc"], {"is_sub_dataset": True, "barStr": "", "snapshots": []})
            self.assertEqual(bars["tmp"], {"is_sub_dataset": True, "barStr": "", "snapshots": []})

        # Test folder.snapshots_bar returns [] for unconfigured mount boundaries
        orig = OriginalSnapshot()
        with patch("os.path.ismount", return_value=True):
            folder_tmp = Folder(root_folder, "tmp", orig, name="tmp")
            self.assertEqual(folder_tmp.snapshots_bar, [])


if __name__ == "__main__":
    _ = unittest.main()
