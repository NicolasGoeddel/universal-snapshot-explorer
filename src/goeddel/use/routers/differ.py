from __future__ import annotations

import os
from typing import cast

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from ..dependencies import get_app_config, templates
from ..differ import DiffEngine
from ..models.nodes.utils import guess_filetype
from ..models.snapshot import Snapshot
from ..utils.path_resolver import resolve_root_and_subpath
from ..utils.ui import get_base_template_context, render_error_response

router = APIRouter()


@router.get("/diff/{full_path:path}", response_class=HTMLResponse)
def get_diff_content(
    request: Request,
    full_path: str = "",
    snapshots: str | None = None,
) -> HTMLResponse:
    """Render the HTML view for comparing snapshots of a file."""
    config = get_app_config(request)
    decoded_root_name, file_path, root_folder = resolve_root_and_subpath(full_path, config)

    # We use the first requested snapshot to find the node context, or fallback to original
    snapshot_ids = snapshots.split(",") if snapshots else []
    base_snapshot = snapshot_ids[0] if snapshot_ids else None

    file = root_folder.get_file(path=file_path, snapshot=base_snapshot)
    versions = file.version_history(reverse=True)

    if not file.does_exist and not any(v.entry.does_exist for v in versions):
        return render_error_response(
            request=request,
            status_code=404,
            root_name=decoded_root_name,
            path=file_path,
            snapshot_id=base_snapshot,
            is_folder_error=file.is_folder,
        )

    all_roots = list(config.roots.keys())
    snapshots_list = root_folder.snapshots()
    chronological = root_folder.snapshots_chronological()
    bar = file.snapshots_bar

    resolved_snapshots = DiffEngine.resolve_snapshots(bar, base_snapshot, snapshot_ids)

    # If file was missing in current snapshot, obtain an existing instance for proper metadata display
    if not file.does_exist:
        for snap_id in resolved_snapshots:
            candidate_node = root_folder.get_file(path=file_path, snapshot=snap_id)
            if candidate_node.does_exist:
                file = candidate_node
                break

    base_context = get_base_template_context(
        request=request,
        root_folder=root_folder,
        root_name=decoded_root_name,
        node=file,
        module="diff",
        path=file_path,
        all_roots=all_roots,
        snapshots=snapshots_list,
    )

    return templates.TemplateResponse(
        request=request,
        name="diff.html.j2",
        context={
            **base_context,
            "file": file,
            "snapshots": snapshots_list,
            "snapshots_chronological": chronological,
            "snapshots_bar": bar,
            "initial_snapshots": ",".join(resolved_snapshots),
        },
    )


@router.get("/api/diff/{full_path:path}")
def get_diff_api(
    request: Request,
    full_path: str = "",
    snapshots: str = "",
    plugin: str = "text-differ",
) -> dict[str, object]:
    """Provide JSON data containing the computed diff for the specified snapshots."""
    config = get_app_config(request)
    root_name, file_path, root_folder = resolve_root_and_subpath(full_path, config)

    snap_ids = snapshots.split(",") if snapshots else []

    snapshot_objs: list[Snapshot | None] = []
    real_paths: list[str | None] = []

    for sid in snap_ids:
        snap = root_folder.get_snapshot(sid if sid and sid != "Original" else None)
        snapshot_objs.append(snap)
        real_paths.append(root_folder.real_path(file_path, snap))

    mime_type = "text/plain"

    # Try to guess mime type from existing files
    for snap, rp in zip(snapshot_objs, real_paths):
        if rp and os.path.isfile(rp):
            found_mime = guess_filetype(os.path.basename(rp)) or (root_folder.get_mime_type(rp, snap) if snap else None)
            if found_mime:
                mime_type = found_mime
            break

    # Determine if left is newer - just compare first two if they exist for text diff
    left_is_newer = False
    if len(snapshot_objs) >= 2:
        snap_left = snapshot_objs[0]
        snap_right = snapshot_objs[1]
        if snap_left and snap_right:
            chronological = root_folder.snapshots_chronological()
            if snap_left.is_original and not snap_right.is_original:
                left_is_newer = True
            elif snap_right.is_original and not snap_left.is_original:
                left_is_newer = False
            else:
                try:
                    left_idx = next(i for i, s in enumerate(chronological) if s.id == snap_left.id)
                    right_idx = next(i for i, s in enumerate(chronological) if s.id == snap_right.id)
                    left_is_newer = left_idx > right_idx
                except StopIteration:
                    pass

    diff_result = DiffEngine.compute_diff(
        plugin_id=plugin,
        snapshots=snapshot_objs,
        paths=real_paths,
        root_name=root_name,
        file_path=file_path,
        mime_type=mime_type,
        left_is_newer=left_is_newer,
    )

    if hasattr(diff_result, "to_dict"):
        return cast(dict[str, object], getattr(diff_result, "to_dict")())
    return cast(dict[str, object], diff_result)
