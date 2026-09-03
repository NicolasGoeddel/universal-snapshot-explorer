from __future__ import annotations

import os
from typing import cast
from urllib.parse import parse_qs, quote, quote_plus

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, StreamingResponse

from ..dependencies import get_app_config, get_base_url, templates
from ..enums import CompressionMode, StructureMode
from ..i18n import get_client_translations, get_language, get_translator
from ..logger import logger
from ..models.folder import Folder
from ..utils.path_resolver import resolve_root_and_subpath
from ..utils.roots_hierarchy import build_root_hierarchy
from ..utils.ui import get_breadcrumbs, render_error_response
from ..zip_streamer import stream_zip_archive

router = APIRouter()


@router.get("/favicon.ico", include_in_schema=False)
def get_favicon() -> FileResponse:
    import os

    return FileResponse(os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates", "favicon.svg"))


@router.get("/", response_class=HTMLResponse)
def read_root(request: Request) -> HTMLResponse:
    config = get_app_config(request)
    lang = get_language(request)
    hierarchical_roots = build_root_hierarchy(config.roots)

    return templates.TemplateResponse(
        request=request,
        name="root_view.html.j2",
        context={
            "request": request,
            "roots": hierarchical_roots,
            "t": get_translator(lang),
            "lang": lang,
            "client_i18n": get_client_translations(lang),
        },
    )


@router.get("/list/{full_path:path}", response_class=HTMLResponse)
def get_list_content(request: Request, full_path: str = "", snapshot: str | None = None) -> HTMLResponse:
    config = get_app_config(request)
    decoded_root_name, directory_path, root_folder = resolve_root_and_subpath(full_path, config)
    folder = root_folder.get_file(path=directory_path, snapshot=snapshot)

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

        full_logical_path = directory_path
        if root_folder.logical_sub_path:
            full_logical_path = f"{root_folder.logical_sub_path}/{directory_path}".strip("/")

        return templates.TemplateResponse(
            request=request,
            name="explorer.html.j2",
            context={
                "request": request,
                "folder": folder,
                "root_name": decoded_root_name,
                "directory_path": full_logical_path,
                "sub_path": full_logical_path,
                "base_url": get_base_url(request),
                "module": "list",
                "breadcrumbs": get_breadcrumbs(root_folder, decoded_root_name, folder, root_folder.snapshots(), all_roots),
                "parent_path": full_logical_path,
                "t": get_translator(lang),
                "lang": lang,
                "client_i18n": get_client_translations(lang),
            },
        )

    response = render_explorer()
    logger.info("Cache hits/misses for root '%s': %d/%d", decoded_root_name, root_folder.cache_hits, root_folder.cache_misses)
    return response


@router.get("/detail/{full_path:path}", response_class=HTMLResponse)
def get_detail_content(request: Request, full_path: str = "", snapshot: str | None = None) -> HTMLResponse:
    config = get_app_config(request)
    decoded_root_name, file_path, root_folder = resolve_root_and_subpath(full_path, config)
    file = root_folder.get_file(path=file_path, snapshot=snapshot)
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

        full_logical_path = file_path
        if root_folder.logical_sub_path:
            full_logical_path = f"{root_folder.logical_sub_path}/{file_path}".strip("/")

        return templates.TemplateResponse(
            request=request,
            name="details.html.j2",
            context={
                "request": request,
                "file": file,
                "versions": versions,
                "root_name": decoded_root_name,
                "directory_path": full_logical_path,
                "sub_path": full_logical_path,
                "base_url": get_base_url(request),
                "module": "detail",
                "breadcrumbs": get_breadcrumbs(root_folder, decoded_root_name, file, root_folder.snapshots(), all_roots),
                "t": get_translator(lang),
                "lang": lang,
                "client_i18n": get_client_translations(lang),
            },
        )

    return render_details()


@router.get("/download/{full_path:path}")
def download_file(request: Request, full_path: str = "", snapshot: str | None = None) -> Response:
    config = get_app_config(request)
    decoded_root_name, file_path, root_folder = resolve_root_and_subpath(full_path, config)
    file = root_folder.get_file(path=file_path, snapshot=snapshot)
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
        "Downloading file: root='%s', path='%s', snapshot='%s', real_path='%s'", decoded_root_name, file_path, snapshot or "Original", real_path
    )
    return FileResponse(path=real_path, filename=file.name, media_type="application/octet-stream")


@router.post("/download-zip/{full_path:path}")
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
    structure: StructureMode = StructureMode.RELATIVE
    compression: CompressionMode = CompressionMode.DEFLATE

    if "application/json" in content_type:
        body = cast(dict[str, object], await request.json())
        raw_paths = body.get("paths", [])
        if isinstance(raw_paths, list):
            paths = [str(p) for p in cast(list[object], raw_paths)]
        snapshot = cast(str | None, body.get("snapshot"))
        base_path = str(body.get("base_path", ""))
        try:
            structure = StructureMode(str(body.get("structure", StructureMode.RELATIVE)))
        except ValueError:
            structure = StructureMode.RELATIVE
        try:
            compression = CompressionMode(str(body.get("compression", CompressionMode.DEFLATE)))
        except ValueError:
            compression = CompressionMode.DEFLATE
    else:
        raw_bytes = await request.body()
        qs = parse_qs(raw_bytes.decode("utf-8", errors="replace"))

        raw_snapshot = qs.get("snapshot", [None])[0]
        snapshot = raw_snapshot if raw_snapshot else None
        base_path = qs.get("base_path", [""])[0]
        try:
            structure = StructureMode(str(qs.get("structure", [StructureMode.RELATIVE])[0]))
        except ValueError:
            structure = StructureMode.RELATIVE
        try:
            compression = CompressionMode(str(qs.get("compression", [CompressionMode.DEFLATE])[0]))
        except ValueError:
            compression = CompressionMode.DEFLATE

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
        archive_name,
        decoded_root_name,
        snapshot or "Original",
        len(paths),
        structure,
        compression,
    )

    return StreamingResponse(
        generator,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{archive_name}"',
        },
    )


@router.get("/ajax/{full_path:path}", response_class=HTMLResponse)
def get_ajax_content(request: Request, full_path: str = "", level: int = 0, snapshot: str | None = None) -> HTMLResponse:
    config = get_app_config(request)
    decoded_root_name, directory_path, root_folder = resolve_root_and_subpath(full_path, config)
    folder = root_folder.get_folder(path=directory_path, snapshot=snapshot)

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
        },
    )


@router.get("/set-language/{lang_code}")
def set_language(request: Request, lang_code: str) -> RedirectResponse:
    from ..i18n import DEFAULT_LANG, TRANSLATIONS

    referer = request.headers.get("referer", "/")
    response = RedirectResponse(url=referer)
    if lang_code in TRANSLATIONS:
        response.set_cookie("lang", lang_code, max_age=31536000)
    else:
        response.set_cookie("lang", DEFAULT_LANG, max_age=31536000)
    return response
