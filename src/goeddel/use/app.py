from __future__ import annotations

import os

# Universal Snapshot Explorer (USE) - Open Source Software
# Copyright (C) 2025-2026 Nicolas Göddel
# Licensed under the AGPLv3: https://www.gnu.org/licenses/agpl-3.0.txt
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from urllib.parse import unquote_plus

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import AppConfig, load_config
from .logger import logger, setup_logging
from .models import (
    RootFolder,
)
from .routers import api, differ, explorer
from .security import can_access, current_traverse_ledger, current_user_groups, current_username, describe_enforcement_gaps, get_user_groups
from .utils.path_resolver import resolve_root_and_subpath
from .utils.ui import render_error_response

# Every route below takes a trailing `{full_path:path}` carrying a root name plus an
# in-root subpath (see utils/path_resolver.py). These are the only surfaces that ever
# expose filesystem content, so they're the only ones the security middleware needs to
# intercept. Kept as one list here rather than duplicating a check in each router, per
# this project's own stated "centralize security checks at policy enforcement points"
# architectural principle (docs/ARCHITECTURE.md).
_PROTECTED_PREFIXES: tuple[str, ...] = (
    "list",
    "detail",
    "download-zip",
    "download",
    "ajax",
    "diff",
    "api/diff",
    "api/snapshot-bars",
    "api/file-mimetypes",
    "api/snapshot-state",
    "api/zip-preview",
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    config_file = os.environ.get("USE_CONFIG_FILE") or os.environ.get("ZFS_EXPLORER_CONFIG_FILE", "config.yaml")
    loaded_config = load_config(config_file)
    setup_logging(loaded_config.loglevel)
    logger.info("Application starting up...")
    logger.info("Configuration loaded: %d roots, ZFS auto-discover=%s", len(loaded_config.roots), loaded_config.zfs.auto_discover)
    RootFolder.set_root_configs(loaded_config.roots)
    if loaded_config.security.enabled:
        for gap in describe_enforcement_gaps():
            logger.warning("Security is enabled, but %s -- every access check will fail closed (deny) until this is fixed.", gap)
    app.state.loaded_config = loaded_config
    yield
    logger.info("Application shutting down...")


app = FastAPI(lifespan=lifespan)
static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.middleware("http")
async def security_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    """
    Single policy-enforcement point for every filesystem-exposing route (see
    security.py and SecurityConfig for the full reasoning). Disabled by default:
    with `security.enabled = False`, this only sets an empty current_username
    context.
    """
    config: object = getattr(request.app.state, "loaded_config", None)  # pyright: ignore[reportAny] # FastAPI state getattr returns Any
    if not isinstance(config, AppConfig) or not config.security.enabled:
        return await call_next(request)

    header_username = request.headers.get(config.security.trusted_user_header)
    if header_username is not None: # Authenticated user
        identity: str | frozenset[str] | None = header_username
        resolved_users: tuple[str, ...] = (header_username,)
    elif config.security.impersonate_users: # Anonymous with impersonation enabled
        identity = frozenset(config.security.impersonate_users)
        resolved_users = config.security.impersonate_users
    else: # Anynomous with impersonation disabled
        identity = None
        resolved_users = ()

    user_token = current_username.set(identity)
    # Resolved once per request rather than once per file: `get_user_groups`
    # scans the entire NSS group database (`grp.getgrall()`).
    groups_token = current_user_groups.set({u: get_user_groups(u) for u in resolved_users} if resolved_users else None)
    # Directories proven traversable for this user, carried across the whole
    # request: the middleware's own `can_access` below already walks the chain
    # down to the requested folder, which is exactly the chain every entry in
    # that folder then asks about.
    ledger_token = current_traverse_ledger.set({} if identity is not None else None)
    try:
        url_path = request.url.path.strip("/")
        matched_prefix = next(
            (p for p in _PROTECTED_PREFIXES if url_path == p or url_path.startswith(f"{p}/")),
            None,
        )
        if matched_prefix is not None: # If on a protected route
            if identity is None:
                return await custom_http_exception_handler(request, HTTPException(status_code=403, detail="Access denied"))
            full_path = url_path[len(matched_prefix) :].strip("/")
            _, subpath, root_folder = resolve_root_and_subpath(full_path, config)
            snapshot = root_folder.get_snapshot(request.query_params.get("snapshot"))
            try:
                accessible = can_access(root_folder, subpath, snapshot, identity)
            except FileNotFoundError:
                return await custom_http_exception_handler(request, HTTPException(status_code=404, detail="Not found"))
            if not accessible:
                return await custom_http_exception_handler(request, HTTPException(status_code=403, detail="Access denied"))
        return await call_next(request)
    finally:
        current_traverse_ledger.reset(ledger_token)
        current_user_groups.reset(groups_token)
        current_username.reset(user_token)


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError) -> Response:
    logger.warning("ValueError handled: %s", exc)
    from starlette.exceptions import HTTPException as StarletteHTTPException

    starlette_exc = StarletteHTTPException(status_code=400, detail=str(exc))
    return await custom_http_exception_handler(request, starlette_exc)


@app.exception_handler(StarletteHTTPException)
async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException) -> Response:
    accept = request.headers.get("accept", "")
    if "application/json" in accept or request.url.path.startswith("/api/"):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    url_path = request.url.path.lstrip("/")
    parts = url_path.split("/", 2)
    root_name: str | None = None
    subpath: str = ""
    is_folder_err = False

    if len(parts) >= 2 and parts[0] in ("list", "detail", "download", "ajax"):
        root_name = unquote_plus(parts[1])
        if len(parts) == 3:
            subpath = unquote_plus(parts[2])
        is_folder_err = parts[0] in ("list", "ajax")

    snapshot_id = request.query_params.get("snapshot")

    return render_error_response(
        request=request,
        status_code=exc.status_code,
        message=str(exc.detail) if exc.detail else None,
        root_name=root_name,
        path=subpath,
        snapshot_id=snapshot_id,
        is_folder_error=is_folder_err,
    )


app.include_router(explorer.router)
app.include_router(differ.router)
app.include_router(api.router)
