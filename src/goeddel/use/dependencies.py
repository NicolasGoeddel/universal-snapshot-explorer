from __future__ import annotations

import os
from typing import cast
from urllib.parse import quote, quote_plus

from fastapi import Request
from fastapi.templating import Jinja2Templates
from jinja2 import select_autoescape
from lucide.jinja import lucide as lucide_jinja

from .config import AppConfig

# Set up templates
templates_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
templates = Jinja2Templates(directory=templates_dir)
templates.env.autoescape = select_autoescape(["html", "xml", "j2"])


def get_base_url(request: Request) -> str:
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host")
    if fwd_proto and fwd_host:
        return f"{fwd_proto}://{fwd_host}"
    return str(request.base_url).rstrip("/")


def quote_path_filter(path: str) -> str:
    return "/".join(quote(p) for p in path.split("/"))


def render_lucide(name: str, **kwargs: object) -> str:
    return lucide_jinja(name, **kwargs)  # pyright: ignore[reportArgumentType]


_STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def static_url(path: str) -> str:
    full_path = os.path.join(_STATIC_DIR, path)
    try:
        mtime = int(os.path.getmtime(full_path))
        return f"/static/{path}?v={mtime}"
    except OSError:
        return f"/static/{path}"


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
        "route_url": make_route_url,
        "lucide": render_lucide,
    }
)
templates.env.filters["quote_path"] = quote_path_filter
templates.env.filters["quote_plus"] = lambda x: quote_plus(str(x)) if x else ""


def get_app_config(request: Request) -> AppConfig:
    state_config: object = getattr(request.app.state, "loaded_config", None)  # pyright: ignore[reportAny]
    if isinstance(state_config, AppConfig):
        return state_config
    return cast(AppConfig, state_config)
