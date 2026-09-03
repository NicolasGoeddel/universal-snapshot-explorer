from __future__ import annotations

import os
from urllib.parse import unquote_plus

from ..config import AppConfig
from ..enums import FilesystemType
from ..models.root_folder import RootFolder
from ..providers import ProviderRegistry


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

    def _walk_shadow(base_name: str, sub_path: str, base_folder: RootFolder) -> tuple[str, str, RootFolder]:
        from ..models.folder import Folder

        current_base = base_name
        current_sub = sub_path
        current_folder = base_folder

        while current_sub:
            parts = [p for p in current_sub.split("/") if p]
            accumulated = ""
            found_boundary = False

            for i, part in enumerate(parts):
                accumulated = os.path.join(accumulated, part) if accumulated else part
                # Check if this node crosses a boundary
                f = Folder(current_folder, accumulated, current_folder.get_snapshot("Original"), name=part)
                if f.sub_dataset_root_name is not None and f.sub_dataset_root_name in config.roots:
                    # Crossed into an explicitly registered child dataset root
                    remainder = "/".join(parts[i + 1 :])
                    current_base = f.sub_dataset_root_name
                    current_folder = RootFolder.get(config.roots[f.sub_dataset_root_name])
                    current_sub = remainder
                    found_boundary = True
                    break
                elif f.is_sub_dataset and f.sub_dataset_root_name is None:
                    # We crossed an implicit boundary, spawn a shadow root
                    remainder = "/".join(parts[i + 1 :])
                    live_path = ""
                    try:
                        live_path = current_folder.real_path(accumulated, current_folder.get_snapshot("Original"))
                    except Exception:
                        pass

                    is_network = False
                    if f.is_mount and f.mount_info:
                        is_network = f.mount_info.is_network_fs

                    provider = ProviderRegistry.detect_filesystem(live_path, f.mount_info)
                    fstype = provider.name
                    if provider.name == FilesystemType.GENERIC and f.is_mount and f.mount_info:
                        fstype = f.mount_info.fstype

                    # The logical boundary path must include the parent shadow's boundary if any
                    full_logical_boundary = os.path.join(current_folder.logical_sub_path or "", accumulated).strip("/")

                    shadow = RootFolder.get_shadow_instance(
                        base_root_name=base_name, boundary_path=full_logical_boundary, physical_path=live_path, fstype=fstype, is_network=is_network
                    )

                    current_folder = shadow
                    current_sub = remainder
                    found_boundary = True
                    break

            if not found_boundary:
                break

        return current_base, current_sub, current_folder

    # 1. Check for standard /-/ delimiter first
    if "/-/" in raw_path or "/-/" in decoded_path:
        if "/-/" in raw_path:
            r_part, s_part = raw_path.split("/-/", 1)
        else:
            r_part, s_part = decoded_path.split("/-/", 1)
        r_part = unquote_plus(r_part).strip("/")

        # Exact match required for explicitly provided root name
        if r_part in config.roots:
            return _walk_shadow(r_part, s_part.strip("/"), RootFolder.get(config.roots[r_part]))
        # If it doesn't match an exact config root, try to see if it's a Shadow Root
        # (This is a fallback logic in case someone passes a direct path to a shadow root instead of going through base)
        # Note: True Shadow Root URLs should be routed as `<base_root>/-/logical_path_to_shadow_root/sub/folder`

    # 2. Fallback to longest prefix match (Legacy behavior)
    longest_match = ""
    best_root = None

    for root_name, root_folder in config.roots.items():
        if decoded_path == root_name or decoded_path.startswith(f"{root_name}/"):
            if len(root_name) > len(longest_match):
                longest_match = root_name
                best_root = root_folder

    if best_root:
        remaining_subpath = decoded_path[len(longest_match) :].strip("/")
        return _walk_shadow(longest_match, remaining_subpath, RootFolder.get(best_root))

    from fastapi import HTTPException

    raise HTTPException(status_code=404, detail="Root folder not found")
