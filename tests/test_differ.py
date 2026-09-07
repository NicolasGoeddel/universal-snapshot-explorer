from __future__ import annotations

import os
import tempfile
import unittest

from goeddel.use.differ import DiffEngine
from goeddel.use.models.snapshot import Snapshot
from goeddel.use.plugins.diff.text_differ import TextDifferPlugin


class TestDifferModule(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_text_diff_computation(self) -> None:
        left_path = os.path.join(self.temp_dir.name, "left.py")
        right_path = os.path.join(self.temp_dir.name, "right.py")

        with open(left_path, "w", encoding="utf-8") as f:
            f.write("def hello():\n    print('world')\n    return 42\n")

        with open(right_path, "w", encoding="utf-8") as f:
            f.write("def hello():\n    print('universe')\n    return 42\n    # new comment\n")

        s1 = Snapshot(name="Snapshot 1")
        s1.id = "snap1"
        s2 = Snapshot(name="Snapshot 2")
        s2.id = "snap2"
        result = DiffEngine.compute_diff(
            plugin_id="text-differ",
            root_name="test-root",
            file_path="code.py",
            snapshots=[s1, s2],
            paths=[left_path, right_path],
            mime_type="text/x-python",
        )

        self.assertFalse(result.is_binary)
        self.assertTrue(result.left_exists)
        self.assertTrue(result.right_exists)
        self.assertIn("python", result.language)
        self.assertGreater(len(result.lines), 0)

        # Verify stats
        self.assertEqual(result.stats["modifications"], 1)  # print('world') -> print('universe')
        self.assertEqual(result.stats["additions"], 1)  # new comment
        self.assertEqual(result.stats["deletions"], 0)

        # Verify intra-line diff marks
        modified_lines = [line for line in result.lines if line.type == "modify"]
        self.assertEqual(len(modified_lines), 1)
        self.assertIn('class="diff-char-del"', modified_lines[0].left_html)
        self.assertIn('class="diff-char-add"', modified_lines[0].right_html)

        # Test dictionary conversion
        d = result.to_dict()
        self.assertEqual(d["language"], result.language)
        self.assertEqual(d["stats"], result.stats)

    def test_binary_file_detection(self) -> None:
        bin_path = os.path.join(self.temp_dir.name, "test.bin")
        with open(bin_path, "wb") as f:
            f.write(b"PNG\r\n\x00\x00\x00\x00header")

        self.assertTrue(TextDifferPlugin.is_binary_file(bin_path))

        s1 = Snapshot(name="Snapshot 1")
        s1.id = "snap1"
        s2 = Snapshot(name="Snapshot 2")
        s2.id = "snap2"
        result = DiffEngine.compute_diff(
            plugin_id="text-differ",
            root_name="test-root",
            file_path="test.bin",
            snapshots=[s1, s2],
            paths=[bin_path, bin_path],
            mime_type="application/octet-stream",
        )

        self.assertTrue(result.is_binary)
        self.assertEqual(result.language, "binary")
        self.assertEqual(len(result.lines), 0)

    def test_missing_file_diff(self) -> None:
        existing_path = os.path.join(self.temp_dir.name, "file.txt")
        with open(existing_path, "w", encoding="utf-8") as f:
            f.write("Line 1\nLine 2\n")

        s1 = Snapshot(name="Snapshot 1")
        s1.id = "snap1"
        s2 = Snapshot(name="Snapshot 2")
        s2.id = "snap2"
        result = DiffEngine.compute_diff(
            plugin_id="text-differ",
            root_name="test-root",
            file_path="file.txt",
            snapshots=[s1, s2],
            paths=[None, existing_path],
            mime_type="text/plain",
        )

        self.assertFalse(result.left_exists)
        self.assertTrue(result.right_exists)
        self.assertEqual(result.stats["additions"], 2)
        self.assertEqual(len(result.lines), 2)
        for line in result.lines:
            self.assertEqual(line.type, "insert")
            self.assertIsNone(line.left_line_num)
            self.assertIsNotNone(line.right_line_num)

    def test_disk_caching(self) -> None:
        file1 = os.path.join(self.temp_dir.name, "file1.txt")
        file2 = os.path.join(self.temp_dir.name, "file2.txt")
        with open(file1, "w") as f:
            f.write("test content A")
        with open(file2, "w") as f:
            f.write("test content B")

        s1 = Snapshot(name="S1")
        s1.id = "s1"
        s2 = Snapshot(name="S2")
        s2.id = "s2"
        # First compute
        res1 = DiffEngine.compute_diff(
            plugin_id="text-differ",
            root_name="test-root",
            file_path="file.txt",
            snapshots=[s1, s2],
            paths=[file1, file2],
        )

        # Second compute should hit disk cache
        res2 = DiffEngine.compute_diff(
            plugin_id="text-differ",
            root_name="test-root",
            file_path="file.txt",
            snapshots=[s1, s2],
            paths=[file1, file2],
        )

        self.assertEqual(res1.stats, res2.stats)
        self.assertEqual(len(res1.lines), len(res2.lines))

    def test_differ_enums_and_snapshot_times(self) -> None:
        from goeddel.use.enums import DiffLineType

        self.assertEqual(DiffLineType.EQUAL, "equal")
        self.assertEqual(DiffLineType.INSERT, "insert")
        self.assertEqual(DiffLineType.DELETE, "delete")
        self.assertEqual(DiffLineType.MODIFY, "modify")

        file1 = os.path.join(self.temp_dir.name, "time1.txt")
        file2 = os.path.join(self.temp_dir.name, "time2.txt")
        with open(file1, "w") as f:
            f.write("content 1\n")
        with open(file2, "w") as f:
            f.write("content 2\n")

        import datetime

        s1 = Snapshot(name="S1", timestamp=datetime.datetime(2026, 9, 4, 10, 0))
        s1.id = "s1"
        s2 = Snapshot(name="S2", timestamp=datetime.datetime(2026, 9, 4, 11, 0))
        s2.id = "s2"
        res = DiffEngine.compute_diff(
            plugin_id="text-differ",
            root_name="test-root",
            file_path="time.txt",
            snapshots=[s1, s2],
            paths=[file1, file2],
            max_file_size=1024,
        )

        self.assertEqual(res.left_snapshot_time, "2026-09-04T10:00:00")
        self.assertEqual(res.right_snapshot_time, "2026-09-04T11:00:00")
        d = res.to_dict()
        self.assertEqual(d["left_snapshot_time"], "2026-09-04T10:00:00")
        self.assertEqual(d["right_snapshot_time"], "2026-09-04T11:00:00")

        # Test exceeding custom max_file_size
        res_large = DiffEngine.compute_diff(
            plugin_id="text-differ",
            root_name="test-root",
            file_path="time_large.txt",
            snapshots=[s1, s2],
            paths=[file1, file2],
            max_file_size=5,  # 5 bytes limit, files are > 5 bytes
        )
        self.assertTrue(res_large.is_binary)
        self.assertEqual(res_large.language, "binary")

    def test_markdown_lexer_resolution(self) -> None:
        md_path = os.path.join(self.temp_dir.name, "doc.md")
        with open(md_path, "w") as f:
            f.write("# Heading\n\nParagraph text\n")

        # Test resolution via modern text/markdown mimetype
        lexer_mime = TextDifferPlugin.get_lexer("doc.md", mime_type="text/markdown")
        self.assertIn("markdown", lexer_mime.name.lower())

        # Test resolution via filename alone
        lexer_file = TextDifferPlugin.get_lexer("doc.md")
        self.assertIn("markdown", lexer_file.name.lower())

        s1 = Snapshot(name="S1")
        s1.id = "s1"
        s2 = Snapshot(name="S2")
        s2.id = "s2"
        # Verify compute_diff produces highlighted output for markdown
        res = DiffEngine.compute_diff(
            plugin_id="text-differ",
            root_name="test-root",
            file_path="doc.md",
            snapshots=[s1, s2],
            paths=[md_path, md_path],
            mime_type="text/markdown",
        )
        self.assertIn("markdown", res.language.lower())
        self.assertGreater(len(res.lines), 0)
        # Check that heading is highlighted with a Pygments span
        heading_line = res.lines[0]
        self.assertIn('<span class="', heading_line.left_html)
