from __future__ import annotations

import os

# Universal Snapshot Explorer (USE) - Open Source Software
# Copyright (C) 2025-2026 Nicolas Göddel
# Licensed under the AGPLv3: https://www.gnu.org/licenses/agpl-3.0.txt
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from urllib.parse import unquote_plus

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import load_config
from .logger import logger, setup_logging
from .models import (
    RootFolder,
)
from .routers import api, explorer
from .utils.ui import render_error_response


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    config_file = os.environ.get("USE_CONFIG_FILE") or os.environ.get("ZFS_EXPLORER_CONFIG_FILE", "config.yaml")
    loaded_config = load_config(config_file)
    setup_logging(loaded_config.loglevel)
    logger.info("Application starting up...")
    logger.info("Configuration loaded: %d roots, ZFS auto-discover=%s", len(loaded_config.roots), loaded_config.zfs.auto_discover)
    RootFolder.set_root_configs(loaded_config.roots)
    app.state.loaded_config = loaded_config
    yield
    logger.info("Application shutting down...")


app = FastAPI(lifespan=lifespan)
static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


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
app.include_router(api.router)
