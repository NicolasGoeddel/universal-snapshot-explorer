"""Text differ plugin for universal snapshot explorer."""

from __future__ import annotations

import difflib
import html
import logging
import os
from collections.abc import Sequence
from typing import cast, override

from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexer import Lexer
from pygments.lexers import (
    TextLexer,  # pyright: ignore[reportUnknownVariableType] # External library lacks type stubs
    get_lexer_for_filename,  # pyright: ignore[reportUnknownVariableType] # External library lacks type stubs
    get_lexer_for_mimetype,  # pyright: ignore[reportUnknownVariableType] # External library lacks type stubs
    guess_lexer,  # pyright: ignore[reportUnknownVariableType] # External library lacks type stubs
)
from pygments.util import ClassNotFound

from goeddel.use.enums import DiffLineType
from goeddel.use.models.diff import DEFAULT_MAX_TEXT_DIFF_SIZE, DiffLine, FileDiffResult
from goeddel.use.models.snapshot import Snapshot

from .base import DiffPlugin

logger = logging.getLogger(__name__)


class TextDifferPlugin(DiffPlugin):
    """A plugin that provides text file diffing capabilities."""

    plugin_id: str = "text-differ"
    min_snapshots: int = 2
    max_snapshots: int | None = 2

    @staticmethod
    def is_binary_file(path: str | None) -> bool:
        if not path or not os.path.isfile(path):
            return False
        try:
            with open(path, "rb") as f:
                chunk = f.read(8192)
                return b"\x00" in chunk
        except OSError:
            return False

    @staticmethod
    def read_text_file(path: str | None, max_size: int = DEFAULT_MAX_TEXT_DIFF_SIZE) -> tuple[str, bool]:
        if not path or not os.path.isfile(path):
            return "", False

        try:
            size = os.path.getsize(path)
            if size > max_size:
                return "", True

            with open(path, "rb") as f:
                raw = f.read()
                if b"\x00" in raw:
                    return "", True
                try:
                    return raw.decode("utf-8"), False
                except UnicodeDecodeError:
                    return raw.decode("latin-1", errors="replace"), False
        except OSError:
            return "", False

    @staticmethod
    def get_lexer(filename: str, content: str = "", mime_type: str | None = None) -> Lexer:
        if mime_type:
            lookup_mime = "text/x-markdown" if mime_type == "text/markdown" else mime_type
            try:
                lexer = get_lexer_for_mimetype(lookup_mime)
                logger.info("Selected Pygments lexer '%s' via mime-type '%s' for '%s'", lexer.name, mime_type, filename)
                return lexer
            except ClassNotFound:
                logger.debug("No Pygments lexer found for mime-type '%s' ('%s')", mime_type, filename)

        if filename:
            try:
                lexer = get_lexer_for_filename(filename, content)
                logger.info("Selected Pygments lexer '%s' via filename '%s'", lexer.name, filename)
                return lexer
            except ClassNotFound:
                logger.debug("No Pygments lexer found for filename '%s'", filename)

        if content and len(content) < 50000:
            try:
                lexer = guess_lexer(content)
                logger.info("Guessed Pygments lexer '%s' from content for '%s'", lexer.name, filename)
                return lexer
            except ClassNotFound:
                logger.debug("Failed to guess Pygments lexer from content for '%s'", filename)

        logger.warning(
            "No Pygments lexer found for filename '%s' (mime: %s); falling back to TextLexer",
            filename,
            mime_type,
        )
        return cast(Lexer, TextLexer())

    @classmethod
    def highlight_code(
        cls,
        text: str,
        mime_type: str | None = None,
        filename: str = "",
        lexer: Lexer | None = None,
    ) -> str:
        if not text:
            return ""

        if lexer is None:
            lexer = cls.get_lexer(filename=filename, content=text, mime_type=mime_type)

        formatter: HtmlFormatter[str] = cast(HtmlFormatter[str], HtmlFormatter(nowrap=True))
        return highlight(text, lexer, formatter)

    @classmethod
    def highlight_segment(cls, text: str, lexer: Lexer, formatter: HtmlFormatter[str]) -> str:
        if not text:
            return ""
        return highlight(text, lexer, formatter).rstrip("\n")

    @classmethod
    def build_intra_line_diff(
        cls,
        line_a: str,
        line_b: str,
        lexer: Lexer,
        formatter: HtmlFormatter[str],
    ) -> tuple[str, str]:
        sm = difflib.SequenceMatcher(None, line_a, line_b)
        out_a: list[str] = []
        out_b: list[str] = []

        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            seg_a = line_a[i1:i2]
            seg_b = line_b[j1:j2]
            if tag == "equal":
                hl_a = cls.highlight_segment(seg_a, lexer, formatter)
                hl_b = cls.highlight_segment(seg_b, lexer, formatter)
                out_a.append(hl_a)
                out_b.append(hl_b)
            elif tag == "replace":
                hl_a = cls.highlight_segment(seg_a, lexer, formatter)
                hl_b = cls.highlight_segment(seg_b, lexer, formatter)
                out_a.append(f'<mark class="diff-char-del">{hl_a}</mark>')
                out_b.append(f'<mark class="diff-char-add">{hl_b}</mark>')
            elif tag == "delete":
                hl_a = cls.highlight_segment(seg_a, lexer, formatter)
                out_a.append(f'<mark class="diff-char-del">{hl_a}</mark>')
            elif tag == "insert":
                hl_b = cls.highlight_segment(seg_b, lexer, formatter)
                out_b.append(f'<mark class="diff-char-add">{hl_b}</mark>')

        return "".join(out_a), "".join(out_b)

    @override
    def compute(
        self,
        snapshots: Sequence[Snapshot | None],
        paths: Sequence[str | None],
        **kwargs: object,
    ) -> FileDiffResult:
        """
        Compute a two-way text diff between snapshots.
        """
        left_snap = snapshots[0]
        right_snap = snapshots[1]
        left_real_path = paths[0]
        right_real_path = paths[1]

        file_path = str(kwargs.get("file_path", ""))
        mime_type = str(kwargs.get("mime_type", "text/plain"))
        left_is_newer = bool(kwargs.get("left_is_newer", False))
        max_file_size_val = kwargs.get("max_file_size", DEFAULT_MAX_TEXT_DIFF_SIZE)
        max_file_size = int(max_file_size_val) if isinstance(max_file_size_val, (int, float, str)) else DEFAULT_MAX_TEXT_DIFF_SIZE

        left_exists = bool(left_real_path and os.path.isfile(left_real_path))
        right_exists = bool(right_real_path and os.path.isfile(right_real_path))

        left_snap_id = left_snap.id if left_snap else "Original"
        left_snap_name = left_snap.name if left_snap else "Original"
        left_snap_time = str(left_snap.timestamp.isoformat()) if left_snap and left_snap.timestamp else ""
        right_snap_id = right_snap.id if right_snap else "Original"
        right_snap_name = right_snap.name if right_snap else "Original"
        right_snap_time = str(right_snap.timestamp.isoformat()) if right_snap and right_snap.timestamp else ""

        if self.is_binary_file(left_real_path) or self.is_binary_file(right_real_path):
            return FileDiffResult(
                left_snapshot_id=left_snap_id,
                left_snapshot_name=left_snap_name,
                left_snapshot_time=left_snap_time,
                right_snapshot_id=right_snap_id,
                right_snapshot_name=right_snap_name,
                right_snapshot_time=right_snap_time,
                is_binary=True,
                left_exists=left_exists,
                right_exists=right_exists,
                mime_type=mime_type,
                language="binary",
                lines=[],
                stats={"additions": 0, "deletions": 0, "modifications": 0, "total_left": 0, "total_right": 0},
                left_is_newer=left_is_newer,
            )

        left_text, is_bin_l = self.read_text_file(left_real_path, max_size=max_file_size)
        right_text, is_bin_r = self.read_text_file(right_real_path, max_size=max_file_size)

        if is_bin_l or is_bin_r:
            return FileDiffResult(
                left_snapshot_id=left_snap_id,
                left_snapshot_name=left_snap_name,
                left_snapshot_time=left_snap_time,
                right_snapshot_id=right_snap_id,
                right_snapshot_name=right_snap_name,
                right_snapshot_time=right_snap_time,
                is_binary=True,
                left_exists=left_exists,
                right_exists=right_exists,
                mime_type=mime_type,
                language="binary",
                lines=[],
                stats={"additions": 0, "deletions": 0, "modifications": 0, "total_left": 0, "total_right": 0},
                left_is_newer=left_is_newer,
            )

        filename = os.path.basename(file_path)
        lexer = self.get_lexer(filename, right_text or left_text, mime_type=mime_type)
        language = lexer.name.lower()
        formatter: HtmlFormatter[str] = cast(HtmlFormatter[str], HtmlFormatter(nowrap=True))

        left_lines = left_text.splitlines()
        right_lines = right_text.splitlines()

        diff_lines: list[DiffLine] = []
        additions = 0
        deletions = 0
        modifications = 0

        hl_left_lines = self.highlight_code("\n".join(left_lines), lexer=lexer).splitlines()
        hl_right_lines = self.highlight_code("\n".join(right_lines), lexer=lexer).splitlines()

        if left_is_newer:
            base_lines, target_lines = right_lines, left_lines
            hl_base_lines, hl_target_lines = hl_right_lines, hl_left_lines
        else:
            base_lines, target_lines = left_lines, right_lines
            hl_base_lines, hl_target_lines = hl_left_lines, hl_right_lines

        sm = difflib.SequenceMatcher(None, base_lines, target_lines)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal":
                for idx_base, idx_target in zip(range(i1, i2), range(j1, j2)):
                    raw_base = base_lines[idx_base]
                    raw_target = target_lines[idx_target]
                    hl_base = hl_base_lines[idx_base] if idx_base < len(hl_base_lines) else html.escape(raw_base)
                    hl_target = hl_target_lines[idx_target] if idx_target < len(hl_target_lines) else html.escape(raw_target)

                    if left_is_newer:
                        idx_l, idx_r = idx_target, idx_base
                        raw_l, raw_r = raw_target, raw_base
                        hl_l, hl_r = hl_target, hl_base
                    else:
                        idx_l, idx_r = idx_base, idx_target
                        raw_l, raw_r = raw_base, raw_target
                        hl_l, hl_r = hl_base, hl_target

                    diff_lines.append(
                        DiffLine(
                            left_line_num=idx_l + 1,
                            right_line_num=idx_r + 1,
                            type=DiffLineType.EQUAL,
                            left_html=hl_l,
                            right_html=hl_r,
                            left_text=raw_l,
                            right_text=raw_r,
                        )
                    )
            elif tag == "replace":
                len_b = i2 - i1
                len_t = j2 - j1
                min_len = min(len_b, len_t)

                for k in range(min_len):
                    idx_b = i1 + k
                    idx_t = j1 + k
                    raw_b = base_lines[idx_b]
                    raw_t = target_lines[idx_t]

                    hl_b, hl_t = self.build_intra_line_diff(raw_b, raw_t, lexer, formatter)

                    if left_is_newer:
                        idx_l, idx_r = idx_t, idx_b
                        raw_l, raw_r = raw_t, raw_b
                        hl_l, hl_r = hl_t, hl_b
                    else:
                        idx_l, idx_r = idx_b, idx_t
                        raw_l, raw_r = raw_b, raw_t
                        hl_l, hl_r = hl_b, hl_t

                    diff_lines.append(
                        DiffLine(
                            left_line_num=idx_l + 1,
                            right_line_num=idx_r + 1,
                            type=DiffLineType.MODIFY,
                            left_html=hl_l,
                            right_html=hl_r,
                            left_text=raw_l,
                            right_text=raw_r,
                        )
                    )
                    modifications += 1

                if len_b > len_t:
                    for idx_b in range(i1 + min_len, i2):
                        raw_b = base_lines[idx_b]
                        hl_b = hl_base_lines[idx_b] if idx_b < len(hl_base_lines) else html.escape(raw_b)
                        if left_is_newer:
                            diff_lines.append(
                                DiffLine(
                                    left_line_num=None,
                                    right_line_num=idx_b + 1,
                                    type=DiffLineType.DELETE,
                                    left_html="",
                                    right_html=hl_b,
                                    left_text="",
                                    right_text=raw_b,
                                )
                            )
                        else:
                            diff_lines.append(
                                DiffLine(
                                    left_line_num=idx_b + 1,
                                    right_line_num=None,
                                    type=DiffLineType.DELETE,
                                    left_html=hl_b,
                                    right_html="",
                                    left_text=raw_b,
                                    right_text="",
                                )
                            )
                        deletions += 1
                elif len_t > len_b:
                    for idx_t in range(j1 + min_len, j2):
                        raw_t = target_lines[idx_t]
                        hl_t = hl_target_lines[idx_t] if idx_t < len(hl_target_lines) else html.escape(raw_t)
                        if left_is_newer:
                            diff_lines.append(
                                DiffLine(
                                    left_line_num=idx_t + 1,
                                    right_line_num=None,
                                    type=DiffLineType.INSERT,
                                    left_html=hl_t,
                                    right_html="",
                                    left_text=raw_t,
                                    right_text="",
                                )
                            )
                        else:
                            diff_lines.append(
                                DiffLine(
                                    left_line_num=None,
                                    right_line_num=idx_t + 1,
                                    type=DiffLineType.INSERT,
                                    left_html="",
                                    right_html=hl_t,
                                    left_text="",
                                    right_text=raw_t,
                                )
                            )
                        additions += 1
            elif tag == "delete":
                for idx_base in range(i1, i2):
                    raw_base = base_lines[idx_base]
                    hl_base = hl_base_lines[idx_base] if idx_base < len(hl_base_lines) else html.escape(raw_base)
                    if left_is_newer:
                        diff_lines.append(
                            DiffLine(
                                left_line_num=None,
                                right_line_num=idx_base + 1,
                                type=DiffLineType.DELETE,
                                left_html="",
                                right_html=hl_base,
                                left_text="",
                                right_text=raw_base,
                            )
                        )
                    else:
                        diff_lines.append(
                            DiffLine(
                                left_line_num=idx_base + 1,
                                right_line_num=None,
                                type=DiffLineType.DELETE,
                                left_html=hl_base,
                                right_html="",
                                left_text=raw_base,
                                right_text="",
                            )
                        )
                    deletions += 1
            elif tag == "insert":
                for idx_target in range(j1, j2):
                    raw_target = target_lines[idx_target]
                    hl_target = hl_target_lines[idx_target] if idx_target < len(hl_target_lines) else html.escape(raw_target)
                    if left_is_newer:
                        diff_lines.append(
                            DiffLine(
                                left_line_num=idx_target + 1,
                                right_line_num=None,
                                type=DiffLineType.INSERT,
                                left_html=hl_target,
                                right_html="",
                                left_text=raw_target,
                                right_text="",
                            )
                        )
                    else:
                        diff_lines.append(
                            DiffLine(
                                left_line_num=None,
                                right_line_num=idx_target + 1,
                                type=DiffLineType.INSERT,
                                left_html="",
                                right_html=hl_target,
                                left_text="",
                                right_text=raw_target,
                            )
                        )
                    additions += 1

        stats = {
            "additions": additions,
            "deletions": deletions,
            "modifications": modifications,
            "total_left": len(left_lines),
            "total_right": len(right_lines),
        }

        return FileDiffResult(
            left_snapshot_id=left_snap_id,
            left_snapshot_name=left_snap_name,
            left_snapshot_time=left_snap_time,
            right_snapshot_id=right_snap_id,
            right_snapshot_name=right_snap_name,
            right_snapshot_time=right_snap_time,
            is_binary=False,
            left_exists=left_exists,
            right_exists=right_exists,
            mime_type=mime_type,
            language=language,
            lines=diff_lines,
            stats=stats,
            left_is_newer=left_is_newer,
        )
