import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from goeddel.zfs_snapshot_explorer.app import app
from goeddel.zfs_snapshot_explorer.config import AppConfig, RootConfig
from goeddel.zfs_snapshot_explorer.models.root_folder import RootFolder


class TestAppRoutes(unittest.TestCase):
    def setUp(self) -> None:
        # Create a temporary directory structure representing a ZFS dataset
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root_path = self.temp_dir.name

        # Create live files
        with open(os.path.join(self.root_path, "file1.txt"), "w") as f:
            f.write("v3")

        os.makedirs(os.path.join(self.root_path, "folder1"))
        with open(os.path.join(self.root_path, "folder1", "file2.txt"), "w") as f:
            f.write("folder1-file2")

        # Create mock snapshots
        self.snap1_dir = os.path.join(self.root_path, ".zfs", "snapshot", "auto-2026-08-01-120000")
        os.makedirs(self.snap1_dir)
        with open(os.path.join(self.snap1_dir, "file1.txt"), "w") as f:
            f.write("v1")

        self.snap2_dir = os.path.join(self.root_path, ".zfs", "snapshot", "auto-2026-08-02-120000")
        os.makedirs(self.snap2_dir)
        with open(os.path.join(self.snap2_dir, "file1.txt"), "w") as f:
            f.write("v2")

        # Setup mock app config
        self.config = AppConfig(
            roots={
                "mock-root": RootConfig(root_path=self.root_path, sub_path="")
            },
            loglevel="info"
        )
        app.state.loaded_config = self.config
        RootFolder.set_root_configs(self.config.roots)

        self.client = TestClient(app)

    def tearDown(self) -> None:
        # Clear out instances cache to prevent leaking state between tests
        RootFolder._root_folder_instances.clear()
        self.temp_dir.cleanup()

    def test_root_dashboard(self) -> None:
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("mock-root", response.text)

    def test_explorer_view(self) -> None:
        response = self.client.get("/list/mock-root")
        self.assertEqual(response.status_code, 200)
        self.assertIn("file1.txt", response.text)
        self.assertIn("folder1", response.text)
        # Ensure hidden .zfs folder is not rendered in HTML
        self.assertNotIn('href="/list/mock-root/.zfs"', response.text)

    def test_snapshot_state_api(self) -> None:
        response = self.client.get("/api/snapshot-state/mock-root")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["folder_exists"])
        # Verify entries contains files
        self.assertIn("file1.txt", data["entries"])
        self.assertIn("folder1", data["entries"])
        # Verify hidden .zfs folder is NOT in entries
        self.assertNotIn(".zfs", data["entries"])

    def test_snapshot_bars_api(self) -> None:
        response = self.client.get("/api/snapshot-bars/mock-root")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("file1.txt", data["bars"])
        self.assertIn("folder1", data["bars"])
        self.assertEqual(len(data["snapshots"]), 3)  # auto-2026-08-01, auto-2026-08-02, Original

    def test_download_file(self) -> None:
        # Live view download
        response = self.client.get("/download/mock-root/-/file1.txt")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"v3")

        # Snapshot 1 download
        response = self.client.get("/download/mock-root/-/file1.txt?snapshot=auto-2026-08-01-120000")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"v1")

    def test_path_traversal_protection(self) -> None:
        # Request attempting path traversal (URL-encoded to prevent client-side normalization)
        response = self.client.get("/download/mock-root/-%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Path traversal detected", response.text)


if __name__ == "__main__":
    unittest.main()
