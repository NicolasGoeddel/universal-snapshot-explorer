from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass
from functools import cache
from importlib.resources import files
from urllib.parse import quote
from zipfile import ZipFile

from lucide.jinja import lucide as lucide_jinja
from markupsafe import Markup, escape

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Icon names appear as quoted strings, in the templates, the scripts and the code that picks icons
_QUOTED_NAME = re.compile(r"""["']([a-z0-9]+(?:-[a-z0-9]+)*)["']""")
SIZES = range(8, 49)
# File and folder icons are drawn with a lighter stroke than Lucide's
_FILE_ICON_STROKE = "1.8"
# An icon is a box painted in the text color through the icon's drawing; any author rule on its size wins
_BASE_RULES = (
    ":where(.ico){display:inline-block;width:24px;height:24px;background-color:currentColor;"
    "mask-position:center;mask-size:100% 100%;mask-repeat:no-repeat}"
)


@dataclass(frozen=True)
class IconStylesheet:
    css: str
    names: frozenset[str]
    version: str


@cache
def icon_stylesheet() -> IconStylesheet:
    """
    Every Lucide icon the app names, as one stylesheet that draws each icon as a mask, so pages hold
    one empty element per icon instead of its shapes.
    """
    candidates: set[str] = set()
    for directory, _, filenames in os.walk(_APP_DIR):
        for filename in filenames:
            if filename.endswith((".py", ".j2", ".js")):
                with open(os.path.join(directory, filename), encoding="utf-8") as f:
                    candidates.update(_QUOTED_NAME.findall(f.read()))
    with (files("lucide") / "lucide.zip").open("rb") as data, ZipFile(data) as icons:
        available = {name.removesuffix(".svg") for name in icons.namelist()}
    names = sorted(candidates & available)
    rules = [_BASE_RULES]
    rules += [f":where(.s{size}){{width:{size}px;height:{size}px}}" for size in SIZES]
    # Each drawing in its own rule, rather than in a variable, is parsed once rather than for every icon
    for name in names:
        rules.append(f".i-{name}{{mask-image:{_image(name)}}}")
        rules.append(f".file-icon.i-{name}{{mask-image:{_image(name, stroke_width=_FILE_ICON_STROKE)}}}")
    css = "\n".join(rules)
    return IconStylesheet(css=css, names=frozenset(names), version=hashlib.sha256(css.encode()).hexdigest()[:12])


def _image(name: str, **attributes: str) -> str:
    drawn = str(lucide_jinja(name, size=None, **{key.replace("_", "-"): value for key, value in attributes.items()}))
    svg = re.sub(r"\s*\n\s*", "", drawn).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ', 1)
    return f'url("data:image/svg+xml,{quote(svg, safe=" =:/,;.-")}")'


def icon_stylesheet_url() -> str:
    return f"/icons.css?v={icon_stylesheet().version}"


def render_icon(name: str, size: int | None = 24, **attributes: object) -> Markup:
    """A Lucide icon, as an element the icon stylesheet draws."""
    if name not in icon_stylesheet().names:
        raise ValueError(f"Icon {name!r} is not in the icon stylesheet: name it in a quoted string")
    size = 24 if size is None else size
    if size not in SIZES:
        raise ValueError(f"Icon size {size} is not one the icon stylesheet provides")
    classes = f"ico i-{name} s{size}"
    rendered = ""
    for raw, value in attributes.items():
        key = raw.replace("_", "-")
        if key == "class":
            classes += f" {value}"
        else:
            rendered += f' {key}="{escape(str(value))}"'
    return Markup(f'<i class="{escape(classes)}"{rendered}></i>')
