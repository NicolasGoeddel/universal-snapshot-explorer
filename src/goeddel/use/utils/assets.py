from __future__ import annotations

import hashlib
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

import rcssmin  # pyright: ignore[reportMissingTypeStubs] # rcssmin ships without type hints
import rjsmin  # pyright: ignore[reportMissingTypeStubs] # rjsmin ships without type hints
from markupsafe import Markup

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")

type AssetKind = Literal["css", "js"]

_MINIFIERS: dict[AssetKind, Callable[[str], str]] = {
    "css": rcssmin.cssmin,  # pyright: ignore[reportUnknownMemberType] # rcssmin ships without type hints
    "js": rjsmin.jsmin,  # pyright: ignore[reportUnknownMemberType] # rjsmin ships without type hints
}
# Ends every script, so the next one starts a new statement
_SEPARATORS: dict[AssetKind, str] = {"css": "\n", "js": ";\n"}


def debug_assets() -> bool:
    """Whether to serve each file as it is, readable for debugging, rather than bundled and minified."""
    return os.environ.get("USE_DEBUG_ASSETS", "") not in ("", "0")


def static_url(path: str) -> str:
    full_path = os.path.join(STATIC_DIR, path)
    try:
        mtime = int(os.path.getmtime(full_path))
        return f"/static/{path}?v={mtime}"
    except OSError:
        return f"/static/{path}"


@dataclass(frozen=True)
class Bundle:
    content: str
    version: str


def bundle(kind: AssetKind, paths: Sequence[str]) -> Bundle:
    """The minified files, in their order, rebuilt whenever one of them changes."""
    mtimes = tuple(os.path.getmtime(os.path.join(STATIC_DIR, path)) for path in paths)
    return _build(kind, tuple(paths), mtimes)


@lru_cache(maxsize=64)
def _build(kind: AssetKind, paths: tuple[str, ...], _mtimes: tuple[float, ...]) -> Bundle:
    parts: list[str] = []
    for path in paths:
        with open(os.path.join(STATIC_DIR, path), encoding="utf-8") as f:
            parts.append(_MINIFIERS[kind](f.read()))
    content = _SEPARATORS[kind].join(parts)
    return Bundle(content=content, version=hashlib.sha256(content.encode()).hexdigest()[:12])


def bundle_paths(kind: AssetKind, files: str) -> tuple[str, ...] | None:
    """The files a bundle URL names, or None unless each is an existing static file of that kind."""
    paths = tuple(files.split(","))
    for path in paths:
        if os.path.normpath(path) != path or not path.startswith(f"{kind}/") or not path.endswith(f".{kind}"):
            return None
        if not os.path.isfile(os.path.join(STATIC_DIR, path)):
            return None
    return paths


def _urls(kind: AssetKind, paths: Sequence[str]) -> list[str]:
    """Each file's own URL when debugging, otherwise one bundle's."""
    if not paths:
        return []
    if debug_assets():
        return [static_url(path) for path in paths]
    # The file list lets any worker build the bundle; the version changes with its content
    return [f"/bundle.{kind}?files={','.join(paths)}&v={bundle(kind, paths).version}"]


def stylesheet_tags(paths: Sequence[str], deferred: Sequence[str]) -> Markup:
    """Stylesheets; `deferred` ones are loaded without blocking the page's rendering."""
    tags = [Markup('<link rel="stylesheet" href="{0}">').format(url) for url in _urls("css", [p for p in paths if p not in deferred])]
    tags += [
        Markup('<link rel="stylesheet" href="{0}" media="print" onload="this.media=\'all\'">').format(url)
        for url in _urls("css", [p for p in paths if p in deferred])
    ]
    return Markup("\n").join(tags)


def script_tags(paths: Sequence[str], blocking: Sequence[str]) -> Markup:
    """Deferred scripts, except `blocking` ones, which run while the page is still being parsed."""
    tags = [Markup('<script src="{0}"></script>').format(url) for url in _urls("js", [p for p in paths if p in blocking])]
    tags += [Markup('<script src="{0}" defer></script>').format(url) for url in _urls("js", [p for p in paths if p not in blocking])]
    return Markup("\n").join(tags)


_inline_cache: dict[str, tuple[float, bool, Markup]] = {}


def inline_js(path: str) -> Markup:
    """Returns a static script's content in a `script` element, re-read whenever the file changes."""
    full_path = os.path.join(STATIC_DIR, path)
    mtime = os.path.getmtime(full_path)
    debug = debug_assets()
    cached = _inline_cache.get(path)
    if cached is None or cached[0] != mtime or cached[1] != debug:
        with open(full_path, encoding="utf-8") as f:
            content = f.read()
        if not debug:
            content = _MINIFIERS["js"](content)
        cached = (mtime, debug, Markup('<script data-source="{0}">{1}</script>').format(path, Markup(content)))
        _inline_cache[path] = cached
    return cached[2]
