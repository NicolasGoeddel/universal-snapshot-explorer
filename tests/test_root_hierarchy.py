from __future__ import annotations

import unittest

from goeddel.use.config import RootConfig
from goeddel.use.enums import FilesystemType, RootGroupType
from goeddel.use.models.types import RootViewItem
from goeddel.use.utils.roots_hierarchy import build_root_hierarchy


class TestRootHierarchy(unittest.TestCase):
    def test_empty_roots(self) -> None:
        self.assertEqual(build_root_hierarchy([], {}), [])

    def test_zfs_pool_and_dataset_hierarchy(self) -> None:
        configs = {
            "tank": RootConfig(root_path="/tank", dataset_name="tank", filesystem_type=FilesystemType.ZFS, is_auto_discovered=True),
            "tank/home": RootConfig(root_path="/tank/home", dataset_name="tank/home", filesystem_type=FilesystemType.ZFS, is_auto_discovered=True),
            "tank/home/alice": RootConfig(
                root_path="/tank/home/alice",
                dataset_name="tank/home/alice",
                filesystem_type=FilesystemType.ZFS,
                is_auto_discovered=True,
            ),
            "tank/data": RootConfig(root_path="/tank/data", dataset_name="tank/data", filesystem_type=FilesystemType.ZFS, is_auto_discovered=True),
            "backup/vms": RootConfig(root_path="/backup/vms", dataset_name="backup/vms", filesystem_type=FilesystemType.ZFS, is_auto_discovered=True),
        }

        roots_info: list[RootViewItem] = [
            {
                "name": name,
                "root_path": cfg.root_path,
                "sub_path": "",
                "snapshots_count": 5,
                "is_mounted": True,
                "parent_name": None,
                "level": 0,
                "has_children": False,
                "display_name": name,
                "group_type": RootGroupType.ZFS,
                "is_group_header": False,
                "dataset_name": cfg.dataset_name,
                "filesystem_type": FilesystemType.ZFS,
            }
            for name, cfg in configs.items()
        ]

        result = build_root_hierarchy(roots_info, configs)

        # There should be two group headers: group:zfs:tank and group:zfs:backup
        group_headers = [r for r in result if r["is_group_header"]]
        self.assertEqual(len(group_headers), 2)
        tank_header = next(r for r in group_headers if r["name"] == "group:zfs:tank")
        backup_header = next(r for r in group_headers if r["name"] == "group:zfs:backup")

        self.assertEqual(tank_header["display_name"], "ZFS: tank")
        self.assertEqual(tank_header["snapshots_count"], 20)  # 4 datasets * 5 snaps
        self.assertEqual(backup_header["display_name"], "ZFS: backup")
        self.assertEqual(backup_header["snapshots_count"], 5)

        # Check tank hierarchy
        items_map = {r["name"]: r for r in result}
        tank_root = items_map["tank"]
        self.assertEqual(tank_root["parent_name"], "group:zfs:tank")
        self.assertEqual(tank_root["level"], 1)
        self.assertTrue(tank_root["has_children"])

        home_item = items_map["tank/home"]
        self.assertEqual(home_item["parent_name"], "tank")
        self.assertEqual(home_item["level"], 2)
        self.assertEqual(home_item["display_name"], "home")
        self.assertTrue(home_item["has_children"])

        alice_item = items_map["tank/home/alice"]
        self.assertEqual(alice_item["parent_name"], "tank/home")
        self.assertEqual(alice_item["level"], 3)
        self.assertEqual(alice_item["display_name"], "alice")
        self.assertFalse(alice_item["has_children"])

        data_item = items_map["tank/data"]
        self.assertEqual(data_item["parent_name"], "tank")
        self.assertEqual(data_item["level"], 2)
        self.assertEqual(data_item["display_name"], "data")
        self.assertFalse(data_item["has_children"])

        # backup/vms dataset is direct child of backup group header, pool prefix "backup/" is stripped
        backup_vms = items_map["backup/vms"]
        self.assertEqual(backup_vms["parent_name"], "group:zfs:backup")
        self.assertEqual(backup_vms["level"], 1)
        self.assertEqual(backup_vms["display_name"], "vms")

    def test_zfs_truenas_boot_pool_prefix_removal(self) -> None:
        configs = {
            "boot-pool/ROOT/24.10.2.4/audit": RootConfig(
                root_path="/", dataset_name="boot-pool/ROOT/24.10.2.4/audit", filesystem_type=FilesystemType.ZFS, is_auto_discovered=True
            ),
            "boot-pool/ROOT/24.10.2.4/conf": RootConfig(
                root_path="/", dataset_name="boot-pool/ROOT/24.10.2.4/conf", filesystem_type=FilesystemType.ZFS, is_auto_discovered=True
            ),
        }

        roots_info: list[RootViewItem] = [
            {
                "name": name,
                "root_path": cfg.root_path,
                "sub_path": "",
                "snapshots_count": 1,
                "is_mounted": True,
                "parent_name": None,
                "level": 0,
                "has_children": False,
                "display_name": name,
                "group_type": RootGroupType.ZFS,
                "is_group_header": False,
                "dataset_name": cfg.dataset_name,
                "filesystem_type": FilesystemType.ZFS,
            }
            for name, cfg in configs.items()
        ]

        result = build_root_hierarchy(roots_info, configs)
        items_map = {r["name"]: r for r in result}
        # In TrueNAS without intermediate unmounted parent datasets, pool name "boot-pool" is cleanly stripped
        audit = items_map["boot-pool/ROOT/24.10.2.4/audit"]
        self.assertEqual(audit["display_name"], "ROOT/24.10.2.4/audit")
        self.assertEqual(audit["parent_name"], "group:zfs:boot-pool")

    def test_custom_roots_mountpoint_hierarchy(self) -> None:
        configs = {
            "storage": RootConfig(root_path="/mnt/storage", filesystem_type=FilesystemType.GENERIC, is_auto_discovered=False),
            "media": RootConfig(root_path="/mnt/storage/media", filesystem_type=FilesystemType.GENERIC, is_auto_discovered=False),
            "deep-app": RootConfig(root_path="/mnt/storage/media/stream/deep/app", filesystem_type=FilesystemType.GENERIC, is_auto_discovered=False),
            "backup-drive": RootConfig(root_path="/mnt/backup", filesystem_type=FilesystemType.GENERIC, is_auto_discovered=False),
        }

        roots_info: list[RootViewItem] = [
            {
                "name": name,
                "root_path": cfg.root_path,
                "sub_path": "",
                "snapshots_count": 2,
                "is_mounted": True,
                "parent_name": None,
                "level": 0,
                "has_children": False,
                "display_name": name,
                "group_type": RootGroupType.CUSTOM,
                "is_group_header": False,
                "dataset_name": None,
                "filesystem_type": FilesystemType.GENERIC,
            }
            for name, cfg in configs.items()
        ]

        result = build_root_hierarchy(roots_info, configs)

        group_headers = [r for r in result if r["is_group_header"]]
        self.assertEqual(len(group_headers), 1)
        self.assertEqual(group_headers[0]["name"], "group:custom")

        items_map = {r["name"]: r for r in result}
        storage = items_map["storage"]
        self.assertEqual(storage["parent_name"], "group:custom")
        self.assertEqual(storage["level"], 1)
        self.assertTrue(storage["has_children"])

        media = items_map["media"]
        self.assertEqual(media["parent_name"], "storage")
        self.assertEqual(media["level"], 2)
        self.assertEqual(media["display_name"], "media")
        self.assertTrue(media["has_children"])

        deep_app = items_map["deep-app"]
        self.assertEqual(deep_app["parent_name"], "media")
        self.assertEqual(deep_app["level"], 3)
        self.assertEqual(deep_app["display_name"], "stream/deep/app")

        backup = items_map["backup-drive"]
        self.assertEqual(backup["parent_name"], "group:custom")
        self.assertEqual(backup["level"], 1)

    def test_btrfs_subvolumes_grouping(self) -> None:
        configs = {
            "@": RootConfig(root_path="/host", filesystem_type=FilesystemType.BTRFS, is_auto_discovered=True),
            "@home": RootConfig(root_path="/host/home", filesystem_type=FilesystemType.BTRFS, is_auto_discovered=True),
            "var/lib/portables": RootConfig(root_path="/host/var/lib/portables", filesystem_type=FilesystemType.BTRFS, is_auto_discovered=True),
        }

        roots_info: list[RootViewItem] = [
            {
                "name": name,
                "root_path": cfg.root_path,
                "sub_path": "",
                "snapshots_count": 10,
                "is_mounted": True,
                "parent_name": None,
                "level": 0,
                "has_children": False,
                "display_name": name,
                "group_type": RootGroupType.BTRFS,
                "is_group_header": False,
                "dataset_name": None,
                "filesystem_type": FilesystemType.BTRFS,
            }
            for name, cfg in configs.items()
        ]

        result = build_root_hierarchy(roots_info, configs)
        btrfs_headers = [r for r in result if r["name"] == "group:btrfs"]
        self.assertEqual(len(btrfs_headers), 1)
        self.assertEqual(btrfs_headers[0]["snapshots_count"], 30)

        items_map = {r["name"]: r for r in result}
        root_at = items_map["@"]
        self.assertEqual(root_at["parent_name"], "group:btrfs")
        self.assertTrue(root_at["has_children"])

        portables = items_map["var/lib/portables"]
        self.assertEqual(portables["parent_name"], "@")
        self.assertEqual(portables["level"], 2)

    def test_build_root_hierarchy_from_config_dict(self) -> None:
        configs = {
            "my_root": RootConfig(root_path="/nonexistent/test/path", filesystem_type=FilesystemType.GENERIC),
        }
        result = build_root_hierarchy(configs)
        self.assertEqual(len(result), 2)  # 1 group header + 1 item
        header = result[0]
        item = result[1]
        self.assertEqual(header["name"], "group:custom")
        self.assertEqual(item["name"], "my_root")
        self.assertFalse(item["is_mounted"])
        self.assertEqual(item["snapshots_count"], 0)


if __name__ == "__main__":
    _ = unittest.main()
