from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Request

from ..dependencies import get_app_config
from ..models.types import SnapshotStateResponse
from ..security import current_username
from ..utils.path_resolver import resolve_root_and_subpath
from ..utils.render_handoff import rows_render_key, wait_for_render
from ..zip_streamer import resolve_zip_selection

router = APIRouter()

# The longest the snapshot bars wait for their folder's rows to render
ROWS_WAIT_SECONDS = 30.0


@router.get("/api/snapshot-bars/{full_path:path}")
def get_snapshot_bars_api(
    request: Request,
    full_path: str = "",
    snapshot: str | None = None,
    attributes: str | None = None,
) -> dict[str, object]:
    _ = (request, snapshot)
    config = get_app_config(request)
    root_name, directory_path, root_folder = resolve_root_and_subpath(full_path, config)
    # A page requests its bars while its rows are still rendering: they would compete for the server
    wait_for_render(rows_render_key(current_username.get(), root_name, directory_path), timeout=ROWS_WAIT_SECONDS)
    parsed_attrs = [a.strip() for a in attributes.split(",") if a.strip()] if attributes else None
    return root_folder.get_snapshot_bars_data(directory_path, attributes=parsed_attrs)


@router.get("/api/file-mimetypes/{full_path:path}")
def get_file_mimetypes_api(request: Request, full_path: str = "", snapshot: str | None = None) -> dict[str, str]:
    _ = (request, snapshot)
    config = get_app_config(request)
    _, file_path, root_folder = resolve_root_and_subpath(full_path, config)
    return root_folder.get_file_mimetypes_across_snapshots(file_path)


@router.get("/api/snapshot-state/{full_path:path}")
def get_snapshot_state_api(request: Request, full_path: str = "", snapshot: str | None = None) -> SnapshotStateResponse:
    _ = request
    config = get_app_config(request)
    _, directory_path, root_folder = resolve_root_and_subpath(full_path, config)
    return root_folder.get_snapshot_state(directory_path, snapshot)


@router.post("/api/zip-preview/{full_path:path}")
async def get_zip_preview_api(request: Request, full_path: str = "") -> dict[str, object]:
    """
    Reports what a ZIP export of the given selection would skip due to the
    current user's ACL restrictions, WITHOUT generating the archive: lets the
    frontend warn the user before committing to a download.
    """
    config = get_app_config(request)
    _, _, root_folder = resolve_root_and_subpath(full_path, config)

    body = cast(dict[str, object], await request.json())
    raw_paths = body.get("paths", [])
    paths = [str(p) for p in cast(list[object], raw_paths)] if isinstance(raw_paths, list) else []
    snapshot = cast(str | None, body.get("snapshot"))

    _included, _empty_dirs, skipped = resolve_zip_selection(root_folder, snapshot, paths)
    return {"skipped": skipped, "skipped_count": len(skipped)}


@router.post("/api/invalidate")
@router.get("/api/invalidate")
def invalidate_cache_api() -> dict[str, object]:
    from ..models.root_folder import RootFolder

    RootFolder.invalidate_all()
    return {"status": "ok", "message": "All caches successfully invalidated"}
