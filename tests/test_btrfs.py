from __future__ import annotations

import datetime
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, mock_open, patch

from goeddel.use.btrfs import (
    BtrfsClient,
    BtrfsSnapshotProvider,
    BtrfsSubvolume,
)
from goeddel.use.config import RootConfig, load_config
from goeddel.use.enums import FilesystemType
from goeddel.use.models.root_folder import RootFolder
from goeddel.use.models.snapshot import OriginalSnapshot


class TestBtrfsModule(unittest.TestCase):
    def test_btrfs_subvolume_models(self) -> None:
        subvol = BtrfsSubvolume(
            subvolume_id=256,
            path="@/.snapshots/182/snapshot",
            parent_id=5,
            uuid="49f99238-d6f7-b24a-9efc-97ae0c8680ad",
            creation_time=datetime.datetime(2026, 5, 30, 13, 4, 39),
            is_snapshot=True,
            is_readonly=True,
        )
        self.assertEqual(subvol.subvolume_id, 256)
        self.assertEqual(subvol.short_name, "snapshot")
        self.assertTrue(subvol.is_snapshot)
        self.assertTrue(subvol.is_readonly)

    def test_btrfs_client_parse_subvolume_list(self) -> None:
        mock_output = (
            "ID 256 gen 1234 top level 5 parent_uuid - uuid 1111-2222-3333 path <FS_TREE>/@\n"
            "ID 257 gen 1235 cgen 1234 parent 256 top level 5 parent_uuid 1111-2222-3333 uuid 4444-5555-6666 path <FS_TREE>/@/.snapshots/1/snapshot\n"
            "ID 258 gen 1236 top level 5 parent_uuid - uuid 7777-8888-9999 path <FS_TREE>/@/var\n"
        )
        subvols = BtrfsClient._parse_subvolume_list(mock_output)
        self.assertEqual(len(subvols), 3)

        self.assertEqual(subvols[0].subvolume_id, 256)
        self.assertEqual(subvols[0].path, "<FS_TREE>/@")
        self.assertFalse(subvols[0].is_snapshot)

        self.assertEqual(subvols[1].subvolume_id, 257)
        self.assertEqual(subvols[1].path, "<FS_TREE>/@/.snapshots/1/snapshot")
        self.assertTrue(subvols[1].is_snapshot)
        self.assertEqual(subvols[1].parent_id, 256)
        self.assertEqual(subvols[1].uuid, "4444-5555-6666")
        self.assertEqual(subvols[1].parent_uuid, "1111-2222-3333")

    def test_btrfs_client_parse_subvolume_show(self) -> None:
        mock_output = """
@/.snapshots/182/snapshot
        Name:                   snapshot
        UUID:                   49f99238-d6f7-b24a-9efc-97ae0c8680ad
        Parent UUID:            -
        Creation time:          2026-05-30 13:04:39 +0200
        Subvolume ID:           367
        Generation:             3244
        Gen at creation:        3244
        Parent ID:              5
        Top level ID:           5
        Flags:                  readonly
        Send subvolume:         no
"""
        info = BtrfsClient._parse_subvolume_show(mock_output, "/path/to/182/snapshot")
        self.assertIsNotNone(info)
        assert info is not None
        self.assertEqual(info.subvolume_id, 367)
        self.assertEqual(info.uuid, "49f99238-d6f7-b24a-9efc-97ae0c8680ad")
        self.assertIsNone(info.parent_uuid)
        self.assertTrue(info.is_readonly)
        self.assertEqual(info.creation_time, datetime.datetime(2026, 5, 30, 13, 4, 39))

    def test_btrfs_client_list_mountpoints(self) -> None:
        mock_proc_mounts = """
rootfs / rootfs rw 0 0
sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0
/dev/nvme0n1p2 / btrfs rw,noatime,compress=zstd:3,ssd,space_cache=v2,subvolid=256,subvol=/@ 0 0
/dev/nvme0n1p2 /home btrfs rw,noatime,compress=zstd:3,ssd,space_cache=v2,subvolid=258,subvol=/@home 0 0
tmpfs /tmp tmpfs rw,nosuid,nodev 0 0
"""
        with patch("os.path.exists", return_value=True), patch("builtins.open", mock_open(read_data=mock_proc_mounts)):
            mounts = BtrfsClient.list_mountpoints()
            self.assertEqual(mounts, ["/", "/home"])

    def test_snapper_layout_discovery_and_path_resolution(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            snap_dir = Path(tmpdir) / ".snapshots"
            snap_dir.mkdir()

            # Create Snapper snapshot 182
            snap182 = snap_dir / "182"
            snap182.mkdir()
            (snap182 / "snapshot").mkdir()
            (snap182 / "snapshot" / "testfile.txt").write_text("content", encoding="utf-8")
            (snap182 / "info.xml").write_text(
                """<?xml version="1.0"?>
<snapshot>
  <type>single</type>
  <num>182</num>
  <date>2026-05-30 13:04:39</date>
  <description>timeline snapshot</description>
</snapshot>""",
                encoding="utf-8",
            )

            # Create Snapper snapshot 183
            snap183 = snap_dir / "183"
            snap183.mkdir()
            (snap183 / "snapshot").mkdir()
            (snap183 / "info.xml").write_text(
                """<?xml version="1.0"?>
<snapshot>
  <type>single</type>
  <num>183</num>
  <date>2026-06-01 17:06:40</date>
  <description>after update</description>
</snapshot>""",
                encoding="utf-8",
            )

            provider = BtrfsSnapshotProvider()
            orig = OriginalSnapshot()
            snapshots = provider.get_snapshots(str(snap_dir), (), orig)

            self.assertEqual(len(snapshots), 3)
            self.assertEqual(snapshots[0], orig)
            # Newest snapshot first: 183 (June 1) then 182 (May 30)
            self.assertEqual(snapshots[1].name, "183")
            self.assertEqual(snapshots[1].timestamp, datetime.datetime(2026, 6, 1, 17, 6, 40))
            self.assertEqual(snapshots[2].name, "182")
            self.assertEqual(snapshots[2].timestamp, datetime.datetime(2026, 5, 30, 13, 4, 39))

            # Test get_snapshot_path resolution to the inner /snapshot directory
            resolved_path_182 = provider.get_snapshot_path(snapshots[2], str(snap_dir))
            self.assertEqual(resolved_path_182, str(snap182 / "snapshot"))

            # Test RootFolder navigation with Btrfs Snapper
            cfg = RootConfig(
                root_path=tmpdir,
                sub_path="",
                filesystem_type=FilesystemType.BTRFS,
                snapshot_dir_name=".snapshots",
            )
            root_folder = RootFolder(cfg, snapshot_provider=provider)
            file_node = root_folder.get_file(path="testfile.txt", snapshot="182")
            self.assertTrue(file_node.does_exist)
            self.assertEqual(file_node.name, "testfile.txt")

    def test_btrfs_auto_discovery_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create mock Btrfs mountpoints with .snapshots folder
            root_mount = Path(tmpdir) / "host"
            root_mount.mkdir()
            (root_mount / ".snapshots").mkdir()

            home_mount = Path(tmpdir) / "home"
            home_mount.mkdir()
            (home_mount / ".snapshots").mkdir()

            config_file = Path(tmpdir) / "config.yaml"
            config_content = f"""
btrfs:
  auto_discover: true
  exclude_paths:
    - "{home_mount}"
  default_user_map: /etc/passwd

roots:
  Manual Root:
    root_path: {tmpdir}
    filesystem_type: btrfs
"""
            config_file.write_text(config_content, encoding="utf-8")

            mock_btrfs_client = MagicMock(spec=BtrfsClient)
            mock_btrfs_client.list_mountpoints.return_value = [str(root_mount), str(home_mount)]

            with patch("os.path.exists", return_value=True):
                cfg = load_config(str(config_file), btrfs_client=mock_btrfs_client)

                self.assertIn("Manual Root", cfg.roots)
                self.assertIn(str(root_mount).strip("/"), cfg.roots)
                # home_mount is excluded
                self.assertNotIn(str(home_mount).strip("/"), cfg.roots)

                discovered = cfg.roots[str(root_mount).strip("/")]
                self.assertEqual(discovered.filesystem_type, FilesystemType.BTRFS)
                self.assertEqual(discovered.control_dir_name, ".snapshots")
                self.assertEqual(discovered.user_map, "/etc/passwd")


if __name__ == "__main__":
    unittest.main()
