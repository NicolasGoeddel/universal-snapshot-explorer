from __future__ import annotations

import datetime
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from goeddel.use.config import load_config
from goeddel.use.models.snapshot import OriginalSnapshot, Snapshot
from goeddel.use.models.snapshot_provider import (
    FilesystemSnapshotProvider,
)
from goeddel.use.zfs import (
    ZfsClient,
    ZfsCliSnapshotProvider,
    ZfsDataset,
    ZfsSnapshotInfo,
)


class TestZfsModule(unittest.TestCase):
    def test_zfs_dataset_models(self) -> None:
        ds = ZfsDataset(
            name="data/backups/pie4",
            pool="data",
            mountpoint="/mnt/data/backups/pie4",
            used_bytes=1000,
            available_bytes=2000,
            referenced_bytes=500,
            is_mounted=True,
        )
        self.assertEqual(ds.short_name, "pie4")
        self.assertEqual(ds.pool, "data")
        self.assertEqual(ds.mountpoint, "/mnt/data/backups/pie4")

    def test_zfs_client_list_datasets_parsing(self) -> None:
        mock_stdout = (
            "boot-pool\t/boot\tyes\t1000000\t5000000\t1000000\n"
            "boot-pool/ROOT/24.04.2.3/conf\t/conf\tno\t500000\t5000000\t500000\n"
            "data\t/mnt/data\tyes\t10737418240\t107374182400\t1048576\n"
            "data/.system\t/var/db/system\tyes\t52428800\t107374182400\t52428800\n"
            "data/docker\t/mnt/data/docker\tyes\t5368709120\t107374182400\t5368709120\n"
            "data/backups\t/mnt/data/backups\tyes\t2147483648\t107374182400\t2147483648\n"
            "data/backups/pie4\t/mnt/data/backups/pie4\tyes\t1073741824\t107374182400\t1073741824\n"
            "data/unmounted\tnone\tno\t0\t107374182400\t0\n"
            "data/inactive\t/mnt/data/inactive\tno\t0\t107374182400\t0\n"
        )

        client = ZfsClient()
        with patch.object(client, "is_available", return_value=True):
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout=mock_stdout)
                datasets = client.list_datasets(exclude_patterns=["*/.system*", "*/docker*", "boot-pool/*"])

        names = [d.name for d in datasets]
        self.assertIn("data", names)
        self.assertIn("data/backups", names)
        self.assertIn("data/backups/pie4", names)
        self.assertNotIn("data/.system", names)
        self.assertNotIn("data/docker", names)
        self.assertNotIn("boot-pool", names)
        self.assertNotIn("boot-pool/ROOT/24.04.2.3/conf", names)

        # Check unmounted flag
        unmounted = [d for d in datasets if d.name == "data/unmounted"]
        self.assertEqual(len(unmounted), 1)
        self.assertIsNone(unmounted[0].mountpoint)
        self.assertFalse(unmounted[0].is_mounted)

        inactive = [d for d in datasets if d.name == "data/inactive"]
        self.assertEqual(len(inactive), 1)
        self.assertFalse(inactive[0].is_mounted)

    def test_zfs_client_list_snapshots_parsing(self) -> None:
        mock_stdout = (
            "data/backups/pie4@auto-2026-08-24_10-00\t1787565600\t1048576\t524288000\n"
            "data/backups/pie4@auto-2026-08-24_12-00\t1787572800\t2097152\t524288000\n"
        )

        client = ZfsClient()
        with patch.object(client, "is_available", return_value=True):
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout=mock_stdout)
                snaps = client.list_snapshots("data/backups/pie4")

        self.assertEqual(len(snaps), 2)
        self.assertEqual(snaps[0].snapshot_name, "auto-2026-08-24_10-00")
        self.assertEqual(snaps[0].creation_time, datetime.datetime.fromtimestamp(1787565600))
        self.assertEqual(snaps[1].snapshot_name, "auto-2026-08-24_12-00")
        self.assertEqual(snaps[1].creation_time, datetime.datetime.fromtimestamp(1787572800))

    def test_zfs_client_find_dataset_by_path(self) -> None:
        ds1 = ZfsDataset(name="data", pool="data", mountpoint="/mnt/data", is_mounted=True)
        ds2 = ZfsDataset(name="data/backups", pool="data", mountpoint="/mnt/data/backups", is_mounted=True)
        ds3 = ZfsDataset(name="data/backups/pie4", pool="data", mountpoint="/mnt/data/backups/pie4", is_mounted=True)

        client = ZfsClient()
        match = client.find_dataset_by_path("/mnt/data/backups/pie4/etc/passwd", datasets=[ds1, ds2, ds3])
        self.assertIsNotNone(match)
        if match is not None:
            self.assertEqual(match.name, "data/backups/pie4")

        match2 = client.find_dataset_by_path("/mnt/data/photos/2026", datasets=[ds1, ds2, ds3])
        self.assertIsNotNone(match2)
        if match2 is not None:
            self.assertEqual(match2.name, "data")

        ds_root = ZfsDataset(name="rpool/ROOT/ubuntu_123", pool="rpool", mountpoint="/", is_mounted=True)
        match_root = client.find_dataset_by_path("/host", datasets=[ds_root])
        self.assertIsNotNone(match_root)
        if match_root is not None:
            self.assertEqual(match_root.name, "rpool/ROOT/ubuntu_123")

        match_root_sub = client.find_dataset_by_path("/host/home/nicolas", datasets=[ds_root])
        self.assertIsNotNone(match_root_sub)
        if match_root_sub is not None:
            self.assertEqual(match_root_sub.name, "rpool/ROOT/ubuntu_123")

    def test_zfs_cli_snapshot_provider(self) -> None:
        mock_client = MagicMock(spec=ZfsClient)
        mock_client.is_available.return_value = True
        mock_client.list_snapshots.return_value = [
            ZfsSnapshotInfo(
                dataset_name="data/backups/pie4",
                snapshot_name="snap1",
                full_name="data/backups/pie4@snap1",
                creation_time=datetime.datetime(2026, 8, 24, 10, 0),
            ),
            ZfsSnapshotInfo(
                dataset_name="data/backups/pie4",
                snapshot_name="snap2",
                full_name="data/backups/pie4@snap2",
                creation_time=datetime.datetime(2026, 8, 24, 12, 0),
            ),
        ]

        provider = ZfsCliSnapshotProvider(dataset_name="data/backups/pie4", zfs_client=mock_client)
        orig = OriginalSnapshot()
        result = provider.get_snapshots("/mnt/data/backups/pie4/.zfs/snapshot", (), orig)

        self.assertEqual(len(result), 3)
        self.assertEqual(result[0], orig)
        # Reverse chronological (newest first)
        self.assertEqual(result[1].name, "snap2")
        self.assertEqual(result[2].name, "snap1")

    def test_zfs_cli_snapshot_provider_fallback(self) -> None:
        mock_client = MagicMock(spec=ZfsClient)
        mock_client.is_available.return_value = False

        mock_fallback = MagicMock(spec=FilesystemSnapshotProvider)
        orig = OriginalSnapshot()
        mock_fallback.get_snapshots.return_value = [orig, Snapshot(name="fallback_snap")]

        provider = ZfsCliSnapshotProvider(
            dataset_name="data/backups/pie4",
            zfs_client=mock_client,
            fallback_provider=mock_fallback,
        )
        result = provider.get_snapshots("/mock/path", (), orig)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[1].name, "fallback_snap")
        mock_fallback.get_snapshots.assert_called_once()

    def test_auto_discovery_merging(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "config.yaml"
            config_content = """
zfs:
  auto_discover: true
  mount_prefix: "/host"
  exclude_datasets:
    - "*/.system*"
  default_user_map: "/host/etc/passwd"
  default_group_map: "/host/etc/group"

roots:
  Manual Root:
    root_path: /host/mnt/data/manual
    sub_path: sub
"""
            config_file.write_text(config_content, encoding="utf-8")

            mock_client = MagicMock(spec=ZfsClient)
            mock_client.is_available.return_value = True
            mock_client.list_datasets.return_value = [
                ZfsDataset(
                    name="data/discovered",
                    pool="data",
                    mountpoint="/mnt/data/discovered",
                    is_mounted=True,
                )
            ]

            with patch("os.path.exists", return_value=True):
                cfg = load_config(str(config_file), zfs_client=mock_client)
                self.assertIn("data/discovered", cfg.roots)
                self.assertIn("Manual Root", cfg.roots)
                self.assertEqual(cfg.roots["data/discovered"].root_path, "/host/mnt/data/discovered")
                self.assertEqual(cfg.roots["data/discovered"].user_map, "/host/etc/passwd")
                self.assertEqual(cfg.roots["Manual Root"].sub_path, "sub")

    def test_resolve_root_and_subpath_hierarchical(self) -> None:
        from goeddel.use.config import AppConfig, RootConfig
        from goeddel.use.utils.path_resolver import resolve_root_and_subpath

        cfg = AppConfig(
            roots={
                "data": RootConfig(root_path="/mnt/data"),
                "data/backups": RootConfig(root_path="/mnt/data/backups"),
                "data/apps/immich/data": RootConfig(root_path="/mnt/data/apps/immich/data"),
                "Backup Rocky": RootConfig(root_path="/mnt/data/backups", sub_path="Rocky"),
            }
        )

        # 1. Access root 'data/backups' directly
        root_name, subpath, _ = resolve_root_and_subpath("data/backups", cfg)
        self.assertEqual(root_name, "data/backups")
        self.assertEqual(subpath, "")

        # 2. Access nested root 'data/apps/immich/data'
        root_name, subpath, _ = resolve_root_and_subpath("data/apps/immich/data", cfg)
        self.assertEqual(root_name, "data/apps/immich/data")
        self.assertEqual(subpath, "")

        # 3. Access file inside nested root using standard /-/ delimiter
        root_name, subpath, _ = resolve_root_and_subpath("data/apps/immich/data/-/photos/2026", cfg)
        self.assertEqual(root_name, "data/apps/immich/data")
        self.assertEqual(subpath, "photos/2026")

        # 4. Access folder with trailing /-/
        root_name, subpath, _ = resolve_root_and_subpath("data/backups/-/", cfg)
        self.assertEqual(root_name, "data/backups")
        self.assertEqual(subpath, "")

        # 5. Access subpath containing additional hyphens with /-/ delimiter
        root_name, subpath, _ = resolve_root_and_subpath("data/backups/-/folder-with-hyphen/-/test.txt", cfg)
        self.assertEqual(root_name, "data/backups")
        self.assertEqual(subpath, "folder-with-hyphen/-/test.txt")

        # 6. Access manual root with spaces and /-/ delimiter
        root_name, subpath, _ = resolve_root_and_subpath("Backup Rocky/-/etc/passwd", cfg)
        self.assertEqual(root_name, "Backup Rocky")
        self.assertEqual(subpath, "etc/passwd")

        # 7. Access folder in base 'data' root with standard /-/ delimiter
        root_name, subpath, _ = resolve_root_and_subpath("data/-/media/movies", cfg)
        self.assertEqual(root_name, "data")
        self.assertEqual(subpath, "media/movies")

        # 8. Unregistered root without /-/ should raise 404
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            resolve_root_and_subpath("invalid/root/path", cfg)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_make_route_url(self) -> None:
        from goeddel.use.dependencies import make_route_url

        self.assertEqual(make_route_url("list", "data/backups"), "/list/data/backups")
        self.assertEqual(
            make_route_url("list", "data/backups", "sub/dir"),
            "/list/data/backups/-/sub/dir",
        )
        self.assertEqual(
            make_route_url("detail", "data/apps/immich/data", "file.txt", "snap1"),
            "/detail/data/apps/immich/data/-/file.txt?snapshot=snap1",
        )
        self.assertEqual(
            make_route_url("download", "Backup Rocky", "etc/passwd"),
            "/download/Backup%20Rocky/-/etc/passwd",
        )

    def test_sub_dataset_detection(self) -> None:
        from unittest.mock import patch

        from goeddel.use.config import RootConfig
        from goeddel.use.models.folder import Folder
        from goeddel.use.models.root_folder import RootFolder
        from goeddel.use.models.snapshot import OriginalSnapshot

        # Set up RootFolder path registry
        RootFolder.set_root_configs(
            {
                "parent-root": RootConfig(root_path="/mnt/pool/parent", sub_path=""),
                "child-root": RootConfig(root_path="/mnt/pool/parent/child", sub_path=""),
            }
        )

        config = RootConfig(root_path="/mnt/pool/parent", sub_path="")
        root_folder = RootFolder(config)

        # Create folder instance for the child dataset
        folder = Folder(root_folder, "child", OriginalSnapshot(), name="child")

        # Mock os.path.ismount to return True for the child dataset path
        with patch("os.path.ismount") as mock_ismount:
            mock_ismount.side_effect = lambda path: path.rstrip("/") == "/mnt/pool/parent/child"

            self.assertTrue(folder.is_sub_dataset)
            self.assertEqual(folder.sub_dataset_root_name, "child-root")

            # Non-dataset folder
            other_folder = Folder(root_folder, "normal_dir", OriginalSnapshot(), name="normal_dir")
            self.assertFalse(other_folder.is_sub_dataset)
            self.assertIsNone(other_folder.sub_dataset_root_name)

    def test_zfs_folder_exclusion(self) -> None:
        from unittest.mock import MagicMock, patch

        from goeddel.use.config import RootConfig
        from goeddel.use.models.folder import Folder
        from goeddel.use.models.root_folder import RootFolder
        from goeddel.use.models.snapshot import OriginalSnapshot

        config = RootConfig(root_path="/mnt/pool/parent", sub_path="")
        root_folder = RootFolder(config)

        # 1. Test list_dir_names
        with patch("os.listdir") as mock_listdir:
            mock_listdir.return_value = ["file1.txt", "folder1", ".zfs"]
            names = root_folder.list_dir_names("")
            self.assertIn("file1.txt", names)
            self.assertIn("folder1", names)
            self.assertNotIn(".zfs", names)

        # 2. Test Folder.update
        folder = Folder(root_folder, "", OriginalSnapshot(), name="")
        mock_entry_zfs = MagicMock()
        mock_entry_zfs.name = ".zfs"
        mock_entry_file = MagicMock()
        mock_entry_file.name = "file1.txt"
        mock_entry_file.stat.return_value = MagicMock()

        class MockScandir:
            def __enter__(self):
                return [mock_entry_zfs, mock_entry_file]

            def __exit__(self, exc_type, exc_val, exc_tb):
                pass

        with patch("os.scandir", return_value=MockScandir()), patch.object(root_folder, "get_file", return_value=MagicMock()):
            folder.update()
            self.assertIsNotNone(folder.children)
            assert folder.children is not None
            self.assertIn("file1.txt", folder.children)
            self.assertNotIn(".zfs", folder.children)

        # 3. Test _scan_dir_live
        with patch("os.scandir", return_value=MockScandir()):
            mock_entry_file.stat.return_value.st_uid = 0
            mock_entry_file.stat.return_value.st_gid = 0
            mock_entry_file.stat.return_value.st_mode = 0o644
            mock_entry_file.stat.return_value.st_mtime_ns = 0
            mock_entry_file.stat.return_value.st_ctime_ns = 0
            mock_entry_file.stat.return_value.st_size = 123
            mock_entry_file.stat.return_value.st_ino = 1

            res = root_folder._scan_dir_live("/mnt/pool/parent", root_folder.control_dir_name)
            self.assertIsNotNone(res)
            assert res is not None
            self.assertIn("file1.txt", res)
            self.assertNotIn(".zfs", res)

    def test_sub_dataset_snapshot_bars(self) -> None:
        from typing import cast
        from unittest.mock import patch

        from goeddel.use.config import RootConfig
        from goeddel.use.models.root_folder import RootFolder

        # Register configs
        parent_cfg = RootConfig(root_path="/mnt/pool/parent", sub_path="")
        child_cfg = RootConfig(root_path="/mnt/pool/parent/child", sub_path="")
        RootFolder.set_root_configs({"parent-root": parent_cfg, "child-root": child_cfg})

        parent_folder = RootFolder.get(parent_cfg)

        # Mock self._scan_dir_live and scan_read_only_dir to return "child" directory in parent
        with (
            patch.object(parent_folder, "_scan_dir_live", return_value={"child": (0, 0, 0, 0, 0, 0, 0)}),
            patch.object(parent_folder, "_scan_read_only_dir", return_value={"child": (0, 0, 0, 0, 0, 0, 0)}),
        ):
            # Request snapshot bar for parent folder, which contains "child"
            data = parent_folder.get_snapshot_bars_data("")
            bars = cast(dict[str, object], data.get("bars", {}))
            self.assertIn("child", bars)
            child_data = cast(dict[str, object], bars["child"])

            # Verify child is returned as a sub-dataset object containing its own snapshots and barStr
            self.assertIsInstance(child_data, dict)
            self.assertTrue(child_data["is_sub_dataset"])
            self.assertIn("barStr", child_data)
            self.assertIn("snapshots", child_data)

    def test_path_traversal_protection(self) -> None:
        from goeddel.use.config import RootConfig
        from goeddel.use.models.root_folder import RootFolder

        config = RootConfig(root_path="/mnt/pool/parent", sub_path="sub")
        root_folder = RootFolder(config)

        # Traversal attempts should raise ValueError
        with self.assertRaises(ValueError):
            root_folder.real_path("../../etc/passwd")

        with self.assertRaises(ValueError):
            root_folder.real_path("/etc/passwd")

        with self.assertRaises(ValueError):
            root_folder.real_path("..")

        # Legitimate paths should not raise ValueError
        try:
            p1 = root_folder.real_path("file.txt")
            self.assertTrue(p1.endswith("/mnt/pool/parent/sub/file.txt"))

            p2 = root_folder.real_path("nested/../file2.txt")
            self.assertTrue(p2.endswith("/mnt/pool/parent/sub/file2.txt"))
        except ValueError:
            self.fail("Legitimate path raised ValueError unexpectedly")

    def test_dynamic_uid_gid_mapping(self) -> None:
        import os
        import tempfile

        from goeddel.use.config import RootConfig
        from goeddel.use.models.root_folder import RootFolder

        # Get current uid/gid
        current_uid = os.getuid()
        current_gid = os.getgid()

        with tempfile.TemporaryDirectory() as temp_dir:
            # 1. Create a dummy file in the temp root
            file_path = os.path.join(temp_dir, "testfile.txt")
            with open(file_path, "w") as f:
                f.write("hello")

            # 2. Write custom passwd and group files
            passwd_path = os.path.join(temp_dir, "passwd")
            group_path = os.path.join(temp_dir, "group")

            with open(passwd_path, "w", encoding="utf-8") as f:
                f.write(f"testuser:x:{current_uid}:0:Test User:/root:/bin/bash\n")
                f.write("otheruser:x:9999:0:Other User:/root:/bin/bash\n")

            with open(group_path, "w", encoding="utf-8") as f:
                f.write(f"testgroup:x:{current_gid}:\n")
                f.write("othergroup:x:9999:\n")

            # Configure root with these custom mapping files
            cfg = RootConfig(root_path=temp_dir, sub_path="", user_map=passwd_path, group_map=group_path)
            root_folder = RootFolder(cfg)

            # Get the File model
            file_node = root_folder.get_file(path="testfile.txt")

            # Verify UID/GID map resolves to testuser and testgroup
            self.assertEqual(file_node.uid, current_uid)
            self.assertEqual(file_node.gid, current_gid)
            self.assertEqual(file_node.owner, "testuser")
            self.assertEqual(file_node.group, "testgroup")

            # Test failure fallback (non-existent UID/GID on another mapping)
            # Create mapping without current_uid/current_gid
            empty_passwd_path = os.path.join(temp_dir, "passwd_empty")
            empty_group_path = os.path.join(temp_dir, "group_empty")
            with open(empty_passwd_path, "w") as f:
                f.write("otheruser:x:9999:0:Other User:/root:/bin/bash\n")
            with open(empty_group_path, "w") as f:
                f.write("othergroup:x:9999:\n")

            cfg_fallback = RootConfig(root_path=temp_dir, sub_path="", user_map=empty_passwd_path, group_map=empty_group_path)
            root_folder_fallback = RootFolder(cfg_fallback)
            file_node_fallback = root_folder_fallback.get_file(path="testfile.txt")

            # Should fallback to numeric string representation
            self.assertEqual(file_node_fallback.owner, str(current_uid))
            self.assertEqual(file_node_fallback.group, str(current_gid))

    def test_permission_formatting(self) -> None:
        import os
        import tempfile

        from goeddel.use.config import RootConfig
        from goeddel.use.models.root_folder import RootFolder

        with tempfile.TemporaryDirectory() as temp_dir:
            file_path = os.path.join(temp_dir, "testfile.txt")
            with open(file_path, "w") as f:
                f.write("hello")

            cfg = RootConfig(root_path=temp_dir, sub_path="")
            root_folder = RootFolder(cfg)

            # Test multiple file modes
            modes = [
                (0o755, "rwxr-xr-x", "0755"),
                (0o644, "rw-r--r--", "0644"),
                (0o700, "rwx------", "0700"),
                (0o777, "rwxrwxrwx", "0777"),
                (0o000, "---------", "0000"),
            ]

            for oct_mode, expected_human, expected_octal in modes:
                os.chmod(file_path, oct_mode)
                root_folder.invalidate()
                file_node = root_folder.get_file(path="testfile.txt")

                # Check formatting
                # Note: os.chmod mode might include other S_IFREG bits, but mode_human
                # and mode_octal extract the permission bits (last 9 bits / 3 octals)
                self.assertEqual(file_node.mode_human, expected_human)
                self.assertEqual(file_node.mode_octal, expected_octal)


if __name__ == "__main__":
    unittest.main()
