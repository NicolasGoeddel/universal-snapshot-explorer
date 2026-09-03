from __future__ import annotations

import os
from urllib.parse import unquote_plus

from fastapi import Request
from fastapi.responses import HTMLResponse

from ..dependencies import get_app_config, get_base_url, templates
from ..enums import FilesystemType
from ..i18n import get_client_translations, get_language, get_translator
from ..models.nodes import FSNode
from ..models.root_folder import RootFolder
from ..models.snapshot import Snapshot
from ..models.types import (
    BreadcrumbPath,
    BreadcrumbsData,
    RootName,
    SnapshotBarItem,
)


def get_breadcrumbs(
    root_folder: RootFolder,
    root_name: RootName,
    file: FSNode,
    snapshots: list[Snapshot],
    all_roots: list[RootName],
) -> BreadcrumbsData:
    full_logical_path = file.path
    if root_folder.logical_sub_path:
        if file.path:
            full_logical_path = f"{root_folder.logical_sub_path}/{file.path}"
        else:
            full_logical_path = root_folder.logical_sub_path

    paths: list[BreadcrumbPath] = [
        {
            "name": "/",
            "path": "",
            "separator": bool(full_logical_path),
            "is_current": not bool(full_logical_path),
            "is_boundary": False,
            "icon_name": None,
            "icon_class": None,
        }
    ]
    if full_logical_path:
        path_parts: list[str] = full_logical_path.split(os.sep)
        for i, path_part in enumerate(path_parts):
            is_last = i == len(path_parts) - 1
            current_accumulated = os.path.join(*path_parts[: i + 1])
            is_boundary = False
            icon_name = None
            icon_class = None

            # If this part is part of the logical_sub_path, it might be a boundary
            if root_folder.logical_sub_path and current_accumulated == root_folder.logical_sub_path:
                is_boundary = True

                # Determine icon from the shadow root's filesystem type
                fs_type = root_folder.config.filesystem_type or FilesystemType.GENERIC
                if fs_type == FilesystemType.ZFS:
                    icon_name = "database"
                    icon_class = "icon-implicit-dataset"
                elif fs_type == FilesystemType.BTRFS:
                    icon_name = "hard-drive"
                    icon_class = "icon-mount"
                else:
                    icon_name = "hard-drive"
                    icon_class = "icon-mount"

            paths.append(
                {
                    "name": path_part,
                    "path": current_accumulated,
                    "separator": "/" if not is_last else file.is_folder,
                    "is_current": is_last,
                    "is_boundary": is_boundary,
                    "icon_name": icon_name,
                    "icon_class": icon_class,
                }
            )
    return {
        "root": {"name": root_folder.logical_base_name or root_name, "path": ""},
        "current_path": full_logical_path,
        "snapshot": file.snapshot,
        "snapshots": snapshots,
        "paths": paths,
        "all_roots": all_roots,
    }


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
        },
    )


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
