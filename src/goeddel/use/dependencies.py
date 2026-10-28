from __future__ import annotations

import os
from typing import cast
from urllib.parse import quote, quote_plus

from fastapi import Request
from fastapi.templating import Jinja2Templates
from jinja2 import select_autoescape

from .config import AppConfig
from .i18n import LANGUAGES
from .utils.assets import inline_js, script_tags, static_url, stylesheet_tags
from .utils.icons import icon_stylesheet_url, render_icon
from .utils.template_whitespace import StripIndentation

# Set up templates
templates_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
templates = Jinja2Templates(directory=templates_dir)
templates.env.autoescape = select_autoescape(["html", "xml", "j2"])
templates.env.add_extension(StripIndentation)


def get_base_url(request: Request) -> str:
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host")
    if fwd_proto and fwd_host:
        return f"{fwd_proto}://{fwd_host}"
    return str(request.base_url).rstrip("/")


def quote_path_filter(path: str) -> str:
    return "/".join(quote(p) for p in path.split("/"))


def make_route_url(module: str, root_name: str, sub_path: str = "", snapshot: str | None = None) -> str:
    root_part = quote(root_name, safe="/")
    if sub_path:
        url = f"/{module}/{root_part}/-/{quote_path_filter(sub_path)}"
    else:
        url = f"/{module}/{root_part}"
    if snapshot:
        url += f"?snapshot={quote_plus(snapshot)}"
    return url


cast(dict[str, object], templates.env.globals).update(
    {
        "static_url": static_url,
        "inline_js": inline_js,
        "stylesheet_tags": stylesheet_tags,
        "script_tags": script_tags,
        "route_url": make_route_url,
        "lucide": render_icon,
        "icon_stylesheet_url": icon_stylesheet_url,
        "languages": LANGUAGES,
    }
)
templates.env.filters["quote_path"] = quote_path_filter
templates.env.filters["quote_plus"] = lambda x: quote_plus(str(x)) if x else ""


def get_app_config(request: Request) -> AppConfig:
    state_config: object = getattr(request.app.state, "loaded_config", None)  # pyright: ignore[reportAny] # FastAPI state getattr returns Any
    if isinstance(state_config, AppConfig):
        return state_config
    return cast(AppConfig, state_config)
