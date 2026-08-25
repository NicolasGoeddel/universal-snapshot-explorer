from __future__ import annotations

import functools
import os

# ZFS Snaphot Explorer - Open Source Software
# Copyright (C) 2025-2026 Nicolas Göddel
# Licensed under the AGPLv3: https://www.gnu.org/licenses/agpl-3.0.txt
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import cast
from urllib.parse import parse_qs, quote, quote_plus, unquote_plus

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from jinja2 import select_autoescape
from lucide.jinja import lucide as lucide_jinja
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import AppConfig, load_config
from .i18n import get_client_translations, get_language, get_translator
from .logger import logger, setup_logging
from .models import (
    BreadcrumbPath,
    BreadcrumbsData,
    Folder,
    FSNode,
    RootFolder,
    RootName,
    RootViewItem,
    Snapshot,
    SnapshotBarItem,
)
from .zip_streamer import CompressionMode, StructureMode, stream_zip_archive

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")


@functools.lru_cache(maxsize=256)
def _cached_lucide(name: str, size: int = 24, class_name: str | None = None) -> str:
    if class_name:
        return lucide_jinja(name, size=size, **{"class": class_name})
    return lucide_jinja(name, size=size)


def render_lucide(name: str, size: int = 24, **kwargs: object) -> str:
    cls_obj = kwargs.get("class") or kwargs.get("class_")
    cls_str = str(cls_obj) if cls_obj is not None else None
    return _cached_lucide(name, size, cls_str)





@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    config_file = os.environ.get("ZFS_EXPLORER_CONFIG_FILE", "config.yaml")
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

templates = Jinja2Templates(directory=TEMPLATES_DIR)
templates.env.autoescape = select_autoescape(["html", "htm", "xml", "j2", "html.j2", "svg.j2"])


def static_url(path: str) -> str:
    clean_path = path.lstrip("/")
    full_path = os.path.join(static_dir, clean_path)
    try:
        mtime = int(os.path.getmtime(full_path))
        return f"/static/{clean_path}?v={mtime}"
    except OSError:
        return f"/static/{clean_path}"


def quote_path_filter(val: object) -> str:
    if not val:
        return ""
    return quote(str(val), safe="/")


def make_route_url(module: str, root_name: str, path: str = "", snapshot: str | None = None) -> str:
    root_part = quote(root_name, safe="/")
    if path and path.strip("/"):
        clean_path = quote(path.strip("/"), safe="/")
        url = f"/{module}/{root_part}/-/{clean_path}"
    else:
        url = f"/{module}/{root_part}"
    if snapshot:
        url += f"?snapshot={quote_plus(snapshot)}"
    return url


templates.env.globals["static_url"] = cast(object, static_url)  # pyright: ignore[reportArgumentType]
templates.env.globals["route_url"] = cast(object, make_route_url)  # pyright: ignore[reportArgumentType]
templates.env.filters["quote_path"] = quote_path_filter
templates.env.filters['quote_plus'] = lambda x: quote_plus(str(x)) if x else ''
templates.env.globals['lucide'] = cast(object, render_lucide)  # pyright: ignore[reportArgumentType]


def get_app_config(request: Request) -> AppConfig:
    state_config: object = getattr(request.app.state, "loaded_config", None)  # pyright: ignore[reportAny]
    if isinstance(state_config, AppConfig):
        return state_config
    return cast(AppConfig, state_config)


def resolve_root_and_subpath(
    full_path: str,
    config: AppConfig,
) -> tuple[str, str, RootFolder]:
    """
    Resolves the exact RootConfig and relative subpath from a URL path.
    Supports the standard /-/ delimiter separating hierarchical root names from subpaths.
    Example: /list/data/apps/immich/pgData/-/sub/folder -> root='data/apps/immich/pgData', path='sub/folder'
    Also falls back to longest registered prefix match when no /-/ delimiter is present.
    """
    raw_path = full_path.strip("/")
    decoded_path = unquote_plus(raw_path).strip("/")

    # Strip trailing /-, /-/ from paths
    if raw_path.endswith("/-"):
        raw_path = raw_path[:-2].rstrip("/")
    if decoded_path.endswith("/-"):
        decoded_path = decoded_path[:-2].rstrip("/")

    # 1. Check for standard /-/ delimiter first
    if "/-/" in raw_path or "/-/" in decoded_path:
        if "/-/" in raw_path:
            r_part, s_part = raw_path.split("/-/", 1)
        else:
            r_part, s_part = decoded_path.split("/-/", 1)

        decoded_root = unquote_plus(r_part).strip("/")
        decoded_sub = unquote_plus(s_part).strip("/")

        if decoded_root in config.roots:
            return decoded_root, decoded_sub, RootFolder.get(config.roots[decoded_root])
        if r_part in config.roots:
            return r_part, decoded_sub, RootFolder.get(config.roots[r_part])
        for r_name in config.roots:
            if r_name.strip("/") == decoded_root or r_name.strip("/") == r_part.strip("/"):
                return r_name, decoded_sub, RootFolder.get(config.roots[r_name])

    # 2. Exact match for root directory (no /-/ present)
    if decoded_path in config.roots:
        return decoded_path, "", RootFolder.get(config.roots[decoded_path])

    if raw_path in config.roots:
        return raw_path, "", RootFolder.get(config.roots[raw_path])

    for r_name in config.roots:
        if r_name.strip("/") == decoded_path or r_name.strip("/") == raw_path:
            return r_name, "", RootFolder.get(config.roots[r_name])

    raise HTTPException(status_code=404, detail=f"Root folder for path '{full_path}' not found.")


def get_current_root_folder(root_name: RootName, request: Request) -> RootFolder:
    config = get_app_config(request)
    decoded_name = unquote_plus(root_name)
    if decoded_name in config.roots:
        return RootFolder.get(config.roots[decoded_name])
    if root_name in config.roots:
        return RootFolder.get(config.roots[root_name])
    raise HTTPException(status_code=404, detail=f"Root folder '{root_name}' not found.")


def get_breadcrumbs(
    root_name: RootName,
    file: FSNode,
    snapshots: list[Snapshot],
    all_roots: list[RootName],
) -> BreadcrumbsData:
    paths: list[BreadcrumbPath] = [
        {
            'name': '/',
            'path': '',
            'separator': bool(file.path),
            'is_current': not bool(file.path),
        }
    ]
    if file.path:
        path_parts: list[str] = file.path.split(os.sep)
        for i, path_part in enumerate(path_parts):
            is_last = (i == len(path_parts) - 1)
            paths.append({
                'name': path_part,
                'path': os.path.join(*path_parts[:i+1]),
                'separator': '/' if not is_last else file.is_folder,
                'is_current': is_last,
            })
    return {
        'root': {
            'name': root_name,
            'path': ''
        },
        'current_path': file.path,
        'snapshot': file.snapshot,
        'snapshots': snapshots,
        'paths': paths,
        'all_roots': all_roots,
    }


def get_base_url(request: Request) -> str:
    """ Returns the base URL as string without trailing slash from a Request instance. """
    base_url = str(request.base_url)
    if base_url.endswith('/'):
        return base_url[:-1]
    return base_url


def find_nearest_existing_parent(
    root_folder: RootFolder,
    path: str,
    snapshot: Snapshot | str | None,
) -> dict[str, str] | None:
    """Finds the closest existing parent directory by walking up the path hierarchy."""
    clean = path.strip("/")
    if not clean:
        return None

    parts = clean.split("/")
    for i in range(len(parts) - 1, 0, -1):
        parent_sub = "/".join(parts[:i])
        node = root_folder.get_file(path=parent_sub, snapshot=snapshot)
        if node.does_exist and node.is_folder:
            return {"path": parent_sub, "display_path": "/" + parent_sub}

    root_node = root_folder.get_file(path="", snapshot=snapshot)
    if root_node.does_exist:
        return {"path": "", "display_path": "/"}
    return None


def render_error_response(
    request: Request,
    status_code: int,
    message: str | None = None,
    root_name: str | None = None,
    path: str = "",
    snapshot_id: str | None = None,
    is_folder_error: bool = False,
    title: str | None = None,
) -> HTMLResponse:
    lang = get_language(request)
    t = get_translator(lang)

    nearest_parent: dict[str, str] | None = None
    node_snapshots_bar: list[SnapshotBarItem] = []
    snap_obj: Snapshot | None = None

    if root_name:
        try:
            config = get_app_config(request)
            decoded_root = unquote_plus(root_name)
            root_cfg = config.roots.get(decoded_root) or config.roots.get(root_name)
            if root_cfg:
                rf = RootFolder.get(root_cfg)
                snap_obj = rf.get_snapshot(snapshot_id)
                if path:
                    nearest_parent = find_nearest_existing_parent(rf, path, snap_obj)
                    node = rf.get_file(path=path, snapshot=snap_obj)
                    node_snapshots_bar = node.snapshots_bar
        except Exception:
            pass

    if not message:
        if status_code == 404:
            if is_folder_error and path:
                snap_name = snap_obj.name if snap_obj else (snapshot_id or "Original")
                message = t("error.404_folder_msg", path=path, snapshot=snap_name)
            elif path:
                snap_name = snap_obj.name if snap_obj else (snapshot_id or "Original")
                message = t("error.404_file_msg", path=path, snapshot=snap_name)
            elif root_name:
                message = t("error.404_root_msg", root=root_name)
            else:
                message = t("error.404_generic_msg")
        else:
            message = t("error.404_generic_msg")

    return templates.TemplateResponse(
        request=request,
        name="error.html.j2",
        status_code=status_code,
        context={
            "request": request,
            "status_code": status_code,
            "title": title or t("error.404_title" if status_code == 404 else "error.500_title"),
            "message": message,
            "root_name": root_name,
            "path": path,
            "snapshot": snap_obj,
            "nearest_parent": nearest_parent,
            "snapshots_bar": node_snapshots_bar,
            "is_folder_error": is_folder_error,
            "base_url": get_base_url(request),
            "t": t,
            "lang": lang,
            "client_i18n": get_client_translations(lang),
        }
    )


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
        is_folder_err = (parts[0] in ("list", "ajax"))

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


@app.get("/favicon.ico", include_in_schema=False)
def get_favicon() -> FileResponse:
    import os
    return FileResponse(os.path.join(os.path.dirname(__file__), "templates", "favicon.svg"))

@app.get("/", response_class=HTMLResponse)
def read_root(request: Request) -> HTMLResponse:
    config = get_app_config(request)
    lang = get_language(request)
    roots_info: list[RootViewItem] = []
    for r_name, r_cfg in config.roots.items():
        root_folder = RootFolder.get(r_cfg)
        is_mounted = os.path.isdir(root_folder.real_path())
        snaps = root_folder.snapshots() if is_mounted else []
        roots_info.append({
            "name": r_name,
            "root_path": r_cfg.root_path,
            "sub_path": r_cfg.sub_path,
            "snapshots_count": len(snaps) if is_mounted else 0,
            "is_mounted": is_mounted,
        })

    return templates.TemplateResponse(
        request=request,
        name="index.html.j2",
        context={
            "request": request,
            "roots": roots_info,
            "t": get_translator(lang),
            "lang": lang,
            "client_i18n": get_client_translations(lang),
        }
    )


@app.get("/list/{full_path:path}", response_class=HTMLResponse)
def get_list_content(
    request: Request,
    full_path: str = "",
    snapshot: str | None = None
) -> HTMLResponse:
    config = get_app_config(request)
    decoded_root_name, directory_path, root_folder = resolve_root_and_subpath(full_path, config)
    folder = root_folder.get_file(
        path=directory_path,
        snapshot=snapshot
    )

    if not isinstance(folder, Folder) or not folder.does_exist:
        return render_error_response(
            request=request,
            status_code=404,
            root_name=decoded_root_name,
            path=directory_path,
            snapshot_id=snapshot,
            is_folder_error=True,
        )

    all_roots = list(config.roots.keys())

    def render_explorer() -> HTMLResponse:
        lang = get_language(request)
        return templates.TemplateResponse(
            request=request,
            name="explorer.html.j2",
            context={
                "request": request,
                "folder": folder,
                "root_name": decoded_root_name,
                "directory_path": directory_path,
                "base_url": get_base_url(request),
                "module": "list",
                "breadcrumbs": get_breadcrumbs(decoded_root_name, folder, root_folder.snapshots(), all_roots),
                "parent_path": directory_path,
                "t": get_translator(lang),
                "lang": lang,
                "client_i18n": get_client_translations(lang),
            }
        )

    response = render_explorer()
    logger.info("Cache hits/misses for root '%s': %d/%d", decoded_root_name, root_folder.cache_hits, root_folder.cache_misses)
    return response


@app.get("/detail/{full_path:path}", response_class=HTMLResponse)
def get_detail_content(
    request: Request,
    full_path: str = "",
    snapshot: str | None = None
) -> HTMLResponse:
    config = get_app_config(request)
    decoded_root_name, file_path, root_folder = resolve_root_and_subpath(full_path, config)
    file = root_folder.get_file(
        path=file_path,
        snapshot=snapshot
    )
    versions = file.version_history(reverse=True)

    if not file.does_exist and not any(v.entry.does_exist for v in versions):
        return render_error_response(
            request=request,
            status_code=404,
            root_name=decoded_root_name,
            path=file_path,
            snapshot_id=snapshot,
            is_folder_error=file.is_folder,
        )

    all_roots = list(config.roots.keys())

    def render_details() -> HTMLResponse:
        lang = get_language(request)
        return templates.TemplateResponse(
            request=request,
            name="details.html.j2",
            context={
                "request": request,
                "file": file,
                "versions": versions,
                "root_name": decoded_root_name,
                "directory_path": file_path,
                "base_url": get_base_url(request),
                "module": "detail",
                "breadcrumbs": get_breadcrumbs(decoded_root_name, file, root_folder.snapshots(), all_roots),
                "t": get_translator(lang),
                "lang": lang,
                "client_i18n": get_client_translations(lang),
            }
        )

    return render_details()


@app.get("/download/{full_path:path}")
def download_file(
    request: Request,
    full_path: str = "",
    snapshot: str | None = None
) -> Response:
    config = get_app_config(request)
    decoded_root_name, file_path, root_folder = resolve_root_and_subpath(full_path, config)
    file = root_folder.get_file(
        path=file_path,
        snapshot=snapshot
    )
    if not file.is_file or not file.does_exist:
        raise HTTPException(status_code=404, detail="File not found")

    if file.is_symlink:
        if file.symlink_target_is_dir:
            target_sub = file.symlink_resolved_subpath or ""
            target_url = (
                f"{get_base_url(request)}/list/{quote(decoded_root_name, safe='/')}/"
                f"{quote(target_sub, safe='/')}?snapshot={quote_plus(file.snapshot.id)}"
            )
            return RedirectResponse(url=target_url, status_code=302)
        if file.symlink_is_broken:
            raise HTTPException(status_code=404, detail="Broken symlink: target file does not exist")

    real_path = file.symlink_final_real_path or root_folder.real_path(file.path, file.snapshot)
    if not os.path.isfile(real_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    logger.info(
        "Downloading file: root='%s', path='%s', snapshot='%s', real_path='%s'",
        decoded_root_name, file_path, snapshot or 'Original', real_path
    )
    return FileResponse(
        path=real_path,
        filename=file.name,
        media_type="application/octet-stream"
    )


@app.post("/download-zip/{full_path:path}")
async def download_zip_archive(
    request: Request,
    full_path: str = "",
) -> Response:
    config = get_app_config(request)
    decoded_root_name, _, root_folder = resolve_root_and_subpath(full_path, config)
    content_type = request.headers.get("content-type", "")

    paths: list[str] = []
    snapshot: str | None = None
    base_path: str = ""
    structure: StructureMode = "relative"
    compression: CompressionMode = "deflate"

    if "application/json" in content_type:
        body = cast(dict[str, object], await request.json())
        raw_paths = body.get("paths", [])
        if isinstance(raw_paths, list):
            paths = [str(p) for p in cast(list[object], raw_paths)]
        snapshot = cast(str | None, body.get("snapshot"))
        base_path = str(body.get("base_path", ""))
        structure = cast(StructureMode, body.get("structure", "relative"))
        compression = cast(CompressionMode, body.get("compression", "deflate"))
    else:
        raw_bytes = await request.body()
        qs = parse_qs(raw_bytes.decode("utf-8", errors="replace"))

        raw_snapshot = qs.get("snapshot", [None])[0]
        snapshot = raw_snapshot if raw_snapshot else None
        base_path = qs.get("base_path", [""])[0]
        structure = cast(StructureMode, qs.get("structure", ["relative"])[0])
        compression = cast(CompressionMode, qs.get("compression", ["deflate"])[0])

        form_paths = qs.get("paths", [])
        if form_paths:
            paths = [str(p) for p in form_paths]
        elif "payload" in qs:
            import json
            try:
                raw_json = cast(object, json.loads(qs["payload"][0]))
                if isinstance(raw_json, list):
                    paths = [str(p) for p in cast(list[object], raw_json)]
            except Exception:
                paths = []

    if not paths:
        raise HTTPException(status_code=400, detail="No paths provided for ZIP download")

    snap_obj = root_folder.get_snapshot(snapshot)
    snap_name = snap_obj.name.replace(" ", "_").replace(":", "-")

    if base_path.strip("/"):
        clean_base = base_path.strip("/").replace("/", "_")
        clean_root = decoded_root_name.replace("/", "_")
        archive_name = f"{clean_root}_{clean_base}_{snap_name}.zip"
    elif len(paths) == 1:
        single_name = os.path.basename(paths[0].strip("/")) or decoded_root_name.replace("/", "_")
        archive_name = f"{single_name}_{snap_name}.zip"
    else:
        clean_root = decoded_root_name.replace("/", "_")
        archive_name = f"{clean_root}_{snap_name}.zip"

    generator = stream_zip_archive(
        root_folder=root_folder,
        snapshot=snapshot,
        paths=paths,
        base_folder_path=base_path,
        structure_mode=structure,
        compression=compression,
    )

    logger.info(
        "Streaming ZIP archive: name='%s', root='%s', snapshot='%s', path_count=%d, structure='%s', compression='%s'",
        archive_name, decoded_root_name, snapshot or 'Original', len(paths), structure, compression
    )

    return StreamingResponse(
        generator,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{archive_name}"',
        }
    )


@app.get("/ajax/{full_path:path}", response_class=HTMLResponse)
def get_ajax_content(
    request: Request,
    full_path: str = "",
    level: int = 0,
    snapshot: str | None = None
) -> HTMLResponse:
    config = get_app_config(request)
    decoded_root_name, directory_path, root_folder = resolve_root_and_subpath(full_path, config)
    folder = root_folder.get_folder(
        path=directory_path,
        snapshot=snapshot
    )

    if folder is None:
        return HTMLResponse("<tr><td colspan='2'>Folder not found</td></tr>", status_code=404)

    lang = get_language(request)
    return templates.TemplateResponse(
        request=request,
        name="folder_content.html.j2",
        context={
            "request": request,
            "folder": folder,
            "root_name": decoded_root_name,
            "directory_path": directory_path,
            "base_url": get_base_url(request),
            "module": "list",
            "level": level,
            "parent_path": directory_path,
            "t": get_translator(lang),
            "lang": lang,
            "client_i18n": get_client_translations(lang),
        }
    )


@app.get("/api/snapshot-bars/{full_path:path}")
def get_snapshot_bars_api(
    request: Request,
    full_path: str = "",
    snapshot: str | None = None
) -> dict[str, object]:
    _ = (request, snapshot)
    config = get_app_config(request)
    _, directory_path, root_folder = resolve_root_and_subpath(full_path, config)
    return root_folder.get_snapshot_bars_data(directory_path)


@app.get("/api/file-mimetypes/{full_path:path}")
def get_file_mimetypes_api(
    request: Request,
    full_path: str = "",
    snapshot: str | None = None
) -> dict[str, str]:
    _ = (request, snapshot)
    config = get_app_config(request)
    _, file_path, root_folder = resolve_root_and_subpath(full_path, config)
    return root_folder.get_file_mimetypes_across_snapshots(file_path)


@app.get("/api/snapshot-state/{full_path:path}")
def get_snapshot_state_api(
    request: Request,
    full_path: str = "",
    snapshot: str | None = None
) -> dict[str, object]:
    _ = request
    config = get_app_config(request)
    _, directory_path, root_folder = resolve_root_and_subpath(full_path, config)
    return root_folder.get_snapshot_state(directory_path, snapshot)


@app.get("/set-language/{lang_code}")
def set_language(request: Request, lang_code: str) -> RedirectResponse:
    from .i18n import DEFAULT_LANG, TRANSLATIONS
    referer = request.headers.get("referer", "/")
    response = RedirectResponse(url=referer)
    if lang_code in TRANSLATIONS:
        response.set_cookie("lang", lang_code, max_age=31536000)
    else:
        response.set_cookie("lang", DEFAULT_LANG, max_age=31536000)
    return response

