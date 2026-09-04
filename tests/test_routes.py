from __future__ import annotations

import os
import tempfile
import unittest
from typing import override

from fastapi.testclient import TestClient

from goeddel.use.app import app
from goeddel.use.config import AppConfig, RootConfig
from goeddel.use.models.root_folder import RootFolder


class TestAppRoutes(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    root_path: str
    snap1_dir: str
    snap2_dir: str
    config: AppConfig
    client: TestClient

    def __init__(self, methodName: str = "runTest") -> None:
        super().__init__(methodName)
        self.root_path = ""
        self.snap1_dir = ""
        self.snap2_dir = ""
        self.config = AppConfig()
        self.client = TestClient(app)

    @override
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
        self.config = AppConfig(roots={"mock-root": RootConfig(root_path=self.root_path, sub_path="")}, loglevel="info")
        app.state.loaded_config = self.config
        RootFolder.set_root_configs(self.config.roots)

        self.client = TestClient(app)

    @override
    def tearDown(self) -> None:
        # Clear out instances cache to prevent leaking state between tests
        RootFolder._root_folder_instances.clear()
        if self.temp_dir:
            self.temp_dir.cleanup()

    def test_root_dashboard(self) -> None:
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("mock-root", response.text)
        self.assertIn("root-group-row", response.text)
        self.assertIn("data-level=", response.text)

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

    def test_set_language_route(self) -> None:
        response = self.client.get("/set-language/de", follow_redirects=False)
        self.assertEqual(response.status_code, 307)
        self.assertIn("lang=de", response.headers.get("set-cookie", ""))

        response_en = self.client.get("/set-language/en", follow_redirects=False)
        self.assertEqual(response_en.status_code, 307)
        self.assertIn("lang=en", response_en.headers.get("set-cookie", ""))

    def test_favicon_route(self) -> None:
        response = self.client.get("/favicon.ico")
        self.assertEqual(response.status_code, 200)
        self.assertIn("svg", response.headers.get("content-type", ""))

    def test_invalidate_cache_api(self) -> None:
        response_post = self.client.post("/api/invalidate")
        self.assertEqual(response_post.status_code, 200)
        self.assertEqual(response_post.json()["status"], "ok")

        response_get = self.client.get("/api/invalidate")
        self.assertEqual(response_get.status_code, 200)
        self.assertEqual(response_get.json()["status"], "ok")

    def test_snapshot_bar_colors_and_template_rendering(self) -> None:
        # 1. Verify /api/snapshot-bars returns numerical color chars (1, 2, 3...) instead of color names
        response = self.client.get("/api/snapshot-bars/mock-root")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["bars"]["file1.txt"], "123")

        # 2. Verify backend node snapshot_bar returns integer colors
        root_cfg = self.config.roots["mock-root"]
        rf = RootFolder.get(root_cfg)
        file_node = rf.get_file(path="file1.txt")
        bar_items = file_node.snapshots_bar
        self.assertEqual(len(bar_items), 3)
        for item in bar_items:
            self.assertIsInstance(item["color"], int)
            self.assertFalse(item["missing"])

        # Verify version_history colors align with snapshots_bar (newest to oldest)
        history = file_node.version_history(reverse=True)
        self.assertEqual(len(history), 3)
        for h_item, b_item in zip(history, bar_items, strict=True):
            self.assertEqual(h_item.color, b_item["color"])

        # 3. Verify explorer view template renders generic snapshot bar macro with pills
        resp_explorer = self.client.get("/list/mock-root")
        self.assertEqual(resp_explorer.status_code, 200)
        self.assertIn('class="snapshotbar header-snapshotbar"', resp_explorer.text)
        self.assertIn('class="header-snap-rect', resp_explorer.text)

        # 4. Verify 404 error page renders generic snapshot bar macro in error timeline
        resp_error = self.client.get("/list/mock-root/-/nonexistent_file.txt")
        self.assertEqual(resp_error.status_code, 404)
        self.assertIn("snapshots-header-timeline error-timeline-bar", resp_error.text)

    def test_snapshot_bar_attribute_criteria(self) -> None:
        # file1.txt has identical size (2 bytes: "v1", "v2", "v3") across all 3 versions,
        # but different timestamps (mtime/ctime).
        # 1. When filtering by size only, all snapshots must have the same color ('111')
        resp_size = self.client.get("/api/snapshot-bars/mock-root?attributes=size")
        self.assertEqual(resp_size.status_code, 200)
        data_size = resp_size.json()
        self.assertEqual(data_size["bars"]["file1.txt"], "111")
        self.assertIn("header_bar", data_size)

        # 2. When filtering by mtime only, colors must change across snapshots ('123')
        resp_mtime = self.client.get("/api/snapshot-bars/mock-root?attributes=mtime")
        self.assertEqual(resp_mtime.status_code, 200)
        data_mtime = resp_mtime.json()
        self.assertEqual(data_mtime["bars"]["file1.txt"], "123")

        # 3. Explorer HTML contains the snapshot-criteria dropdown and script
        resp_explorer = self.client.get("/list/mock-root")
        self.assertEqual(resp_explorer.status_code, 200)
        self.assertIn("criteria_manager.js", resp_explorer.text)
        self.assertIn("criteria_manager.css", resp_explorer.text)


if __name__ == "__main__":
    unittest.main()
