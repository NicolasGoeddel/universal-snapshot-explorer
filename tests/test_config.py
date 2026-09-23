from __future__ import annotations

import os
import tempfile
import unittest

from goeddel.use.config import AppConfig, RootConfig, load_config
from goeddel.use.enums import FilesystemType


class TestConfig(unittest.TestCase):
    def test_load_config_preserves_security(self) -> None:
        yaml_content = """
zfs:
  auto_discover: true
btrfs:
  auto_discover: false
security:
  enabled: true
  trusted_user_header: X-Proxy-User
  impersonate_users:
    - admin
roots:
  test-root:
    root_path: /mnt/test
    filesystem_type: generic
"""
        with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".yaml") as f:
            f.write(yaml_content)
            temp_path = f.name

        try:
            # We don't provide clients, so auto_discover will just skip finding new ones, 
            # but the merge logic will still run.
            app_cfg = load_config(temp_path)
            
            self.assertTrue(app_cfg.security.enabled)
            self.assertEqual(app_cfg.security.trusted_user_header, "X-Proxy-User")
            self.assertEqual(app_cfg.security.impersonate_users, ("admin",))
            
            self.assertIn("test-root", app_cfg.roots)
            self.assertEqual(app_cfg.roots["test-root"].filesystem_type, FilesystemType.GENERIC)
        finally:
            os.remove(temp_path)

    def test_load_config_file_not_found(self) -> None:
        with self.assertRaises(FileNotFoundError):
            load_config("/non/existent/path/to/config.yaml")

    def test_root_config_fallbacks(self) -> None:
        # Invalid dict (should return raw)
        raw = RootConfig.set_default_dirs("not-a-dict")
        self.assertEqual(raw, "not-a-dict")

        # Fallback to GENERIC if invalid filesystem_type is provided
        data = RootConfig.set_default_dirs({"filesystem_type": "invalid_fs"})
        self.assertIsInstance(data, dict)
        if isinstance(data, dict):
            self.assertEqual(data.get("control_dir_name"), "")
            self.assertEqual(data.get("snapshot_dir_name"), ".snapshots")

        # CEPHFS fallback
        data_ceph = RootConfig.set_default_dirs({"filesystem_type": "cephfs"})
        self.assertIsInstance(data_ceph, dict)
        if isinstance(data_ceph, dict):
            self.assertEqual(data_ceph.get("control_dir_name"), ".snap")
            self.assertEqual(data_ceph.get("snapshot_dir_name"), ".snap")

        # BTRFS fallback
        data_btrfs = RootConfig.set_default_dirs({"filesystem_type": "btrfs"})
        self.assertIsInstance(data_btrfs, dict)
        if isinstance(data_btrfs, dict):
            self.assertEqual(data_btrfs.get("control_dir_name"), ".snapshots")
            self.assertEqual(data_btrfs.get("snapshot_dir_name"), ".snapshots")
