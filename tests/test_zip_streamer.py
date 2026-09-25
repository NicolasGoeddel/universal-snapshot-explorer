from __future__ import annotations

import io
import os
import tempfile
import unittest
import zipfile
from typing import override

from goeddel.use.config import RootConfig
from goeddel.use.enums import CompressionMode, FilesystemType, StructureMode
from goeddel.use.models.root_folder import RootFolder
from goeddel.use.zip_streamer import stream_zip_archive


class TestZipStreamer(unittest.TestCase):
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    root_path: str
    mock_root: RootFolder

    def __init__(self, methodName: str = "runTest") -> None:
        super().__init__(methodName)
        self.root_path = ""
        # Initialize with dummy data; setUp will override it
        self.mock_root = RootFolder(RootConfig(root_path=""))

    @override
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root_path = self.temp_dir.name

        # Create live files
        with open(os.path.join(self.root_path, "file1.txt"), "w") as f:
            f.write("hello world")

        os.makedirs(os.path.join(self.root_path, "folder1"))
        with open(os.path.join(self.root_path, "folder1", "file2.txt"), "w") as f:
            f.write("folder1-file2")

        # Set up a mock root folder
        config = RootConfig(root_path=self.root_path, filesystem_type=FilesystemType.GENERIC)
        self.mock_root = RootFolder(config)
        RootFolder.set_root_configs({"mock-root": config})

    @override
    def tearDown(self) -> None:
        RootFolder._root_folder_instances.clear()
        if self.temp_dir:
            self.temp_dir.cleanup()

    def test_stream_zip_creates_valid_archive(self) -> None:
        # Collect generated zip bytes
        chunks: list[bytes] = []
        for chunk in stream_zip_archive(
            self.mock_root,
            snapshot=None,
            paths=["file1.txt", "folder1"],
            compression=CompressionMode.STORE,
            structure_mode=StructureMode.RELATIVE,
        ):
            chunks.append(chunk)

        zip_data = b"".join(chunks)
        self.assertGreater(len(zip_data), 0)

        # Load zip from bytes and verify contents
        with zipfile.ZipFile(io.BytesIO(zip_data), "r") as zf:
            file_names = zf.namelist()
            self.assertIn("file1.txt", file_names)
            self.assertIn("folder1/file2.txt", file_names)

            # Check content of file1.txt
            with zf.open("file1.txt") as f1:
                self.assertEqual(f1.read().decode("utf-8"), "hello world")

            # Check content of file2.txt
            with zf.open("folder1/file2.txt") as f2:
                self.assertEqual(f2.read().decode("utf-8"), "folder1-file2")
