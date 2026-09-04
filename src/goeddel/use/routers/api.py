from __future__ import annotations

from fastapi import APIRouter, Request

from ..dependencies import get_app_config
from ..utils.path_resolver import resolve_root_and_subpath

router = APIRouter()


@router.get("/api/snapshot-bars/{full_path:path}")
def get_snapshot_bars_api(
    request: Request,
    full_path: str = "",
    snapshot: str | None = None,
    attributes: str | None = None,
) -> dict[str, object]:
    _ = (request, snapshot)
    config = get_app_config(request)
    _, directory_path, root_folder = resolve_root_and_subpath(full_path, config)
    parsed_attrs = [a.strip() for a in attributes.split(",") if a.strip()] if attributes else None
    return root_folder.get_snapshot_bars_data(directory_path, attributes=parsed_attrs)


@router.get("/api/file-mimetypes/{full_path:path}")
def get_file_mimetypes_api(request: Request, full_path: str = "", snapshot: str | None = None) -> dict[str, str]:
    _ = (request, snapshot)
    config = get_app_config(request)
    _, file_path, root_folder = resolve_root_and_subpath(full_path, config)
    return root_folder.get_file_mimetypes_across_snapshots(file_path)


@router.get("/api/snapshot-state/{full_path:path}")
def get_snapshot_state_api(request: Request, full_path: str = "", snapshot: str | None = None) -> dict[str, object]:
    _ = request
    config = get_app_config(request)
    _, directory_path, root_folder = resolve_root_and_subpath(full_path, config)
    return root_folder.get_snapshot_state(directory_path, snapshot)


@router.post("/api/invalidate")
@router.get("/api/invalidate")
def invalidate_cache_api() -> dict[str, object]:
    from ..models.root_folder import RootFolder

    RootFolder.invalidate_all()
    return {"status": "ok", "message": "All caches successfully invalidated"}
