from __future__ import annotations

import re
from typing import override

from jinja2.ext import Extension

# Elements whose content keeps its whitespace: code, and text shown as typed
_KEPT = re.compile(r"(<(script|style|pre|textarea)\b.*?</\2>)", re.DOTALL | re.IGNORECASE)
# A line break with the indentation around it, which HTML renders as one space anyway
_INDENTED_BREAK = re.compile(r"[ \t]*\n\s*")


class StripIndentation(Extension):
    """
    Removes the templates' indentation when they are compiled, so pages are sent without it while
    the templates stay indented. Line breaks are kept, which HTML renders the same.
    """

    @override
    def preprocess(self, source: str, name: str | None, filename: str | None = None) -> str:
        parts = _KEPT.split(source)
        # split() returns the text, then each kept element followed by its tag name
        for i in range(0, len(parts), 3):
            parts[i] = _INDENTED_BREAK.sub("\n", parts[i])
        return "".join(part for i, part in enumerate(parts) if i % 3 != 2)
