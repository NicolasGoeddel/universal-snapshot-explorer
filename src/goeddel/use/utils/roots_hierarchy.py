from __future__ import annotations

import os
from typing import TYPE_CHECKING

from ..enums import FilesystemType, RootGroupType

if TYPE_CHECKING:
    from ..config import RootConfig
    from ..models.types import RootViewItem


def build_root_hierarchy(
    roots_or_configs: list[RootViewItem] | dict[str, RootConfig],
    root_configs: dict[str, RootConfig] | None = None,
) -> list[RootViewItem]:
    """
    Organizes roots into a hierarchical tree grouped by filesystem origin:
    - Auto-discovered ZFS datasets grouped by pool (e.g. 'ZFS: tank').
    - Auto-discovered Btrfs subvolumes grouped under 'Btrfs'.
    - Manually configured roots grouped under 'Custom' (Configured Roots).

    Resolves parent-child relationships within each group:
    - ZFS: Hierarchical slash-separated dataset names.
    - Btrfs & Custom: Longest ancestor mountpoint/directory path prefix.

    Returns a topologically sorted list in depth-first order with levels,
    parent references, and group headers.
    """
    if isinstance(roots_or_configs, dict):
        configs = roots_or_configs
        from ..models.root_folder import RootFolder

        roots_info: list[RootViewItem] = []
        for r_name, r_cfg in configs.items():
            folder = RootFolder.get(r_cfg)
            mounted = folder.is_mounted()
            snap_count = folder.active_snapshot_count()
            roots_info.append(
                {
                    "name": r_name,
                    "root_path": r_cfg.root_path,
                    "sub_path": r_cfg.sub_path,
                    "snapshots_count": snap_count,
                    "is_mounted": mounted,
                    "parent_name": None,
                    "level": 0,
                    "has_children": False,
                    "display_name": r_name,
                    "group_type": RootGroupType.CUSTOM,
                    "is_group_header": False,
                    "dataset_name": r_cfg.dataset_name,
                    "filesystem_type": r_cfg.filesystem_type,
                }
            )
        active_configs = configs
    else:
        roots_info = roots_or_configs
        active_configs = root_configs or {}

    if not roots_info:
        return []

    # Group roots by origin
    # Group key -> list of RootViewItem
    groups: dict[str, list[RootViewItem]] = {}
    group_metadata: dict[str, tuple[str, RootGroupType]] = {}

    for item in roots_info:
        r_name = item["name"]
        r_cfg = active_configs.get(r_name)
        is_auto = r_cfg.is_auto_discovered if r_cfg else False
        fs_type = r_cfg.filesystem_type if r_cfg else FilesystemType.GENERIC

        if is_auto and fs_type == FilesystemType.ZFS:
            ds_name = r_cfg.dataset_name if (r_cfg and r_cfg.dataset_name) else r_name
            pool_name = ds_name.split("/")[0] if "/" in ds_name else ds_name
            g_id = f"group:zfs:{pool_name}"
            g_label = f"ZFS: {pool_name}"
            g_type = RootGroupType.ZFS
        elif is_auto and fs_type == FilesystemType.BTRFS:
            g_id = "group:btrfs"
            g_label = "Btrfs"
            g_type = RootGroupType.BTRFS
        else:
            g_id = "group:custom"
            g_label = "Custom"
            g_type = RootGroupType.CUSTOM

        if g_id not in groups:
            groups[g_id] = []
            group_metadata[g_id] = (g_label, g_type)

        item["group_type"] = g_type
        item["dataset_name"] = r_cfg.dataset_name if r_cfg else None
        item["filesystem_type"] = fs_type
        groups[g_id].append(item)

    final_result: list[RootViewItem] = []

    # Process each group independently
    for g_id, g_items in groups.items():
        g_label, g_type = group_metadata[g_id]

        # Map within this group: name -> item
        group_item_map = {item["name"]: item for item in g_items}

        # Determine parent for each item in the group
        parent_map: dict[str, str | None] = {}
        display_names: dict[str, str] = {}

        for item in g_items:
            name = item["name"]
            ds_name = item.get("dataset_name") or name

            parent_name: str | None = None

            if g_type == RootGroupType.ZFS:
                # Walk up ZFS dataset ancestry: tank/home/alice -> tank/home -> tank
                target = ds_name if "/" in ds_name else name
                cand = target
                while "/" in cand:
                    cand = cand.rsplit("/", 1)[0]
                    for other in g_items:
                        other_ds = other.get("dataset_name") or other["name"]
                        if other_ds == cand or other["name"] == cand:
                            parent_name = other["name"]
                            break
                    if parent_name:
                        break
            elif g_type == RootGroupType.BTRFS and "@" in group_item_map and name != "@" and not name.startswith("@"):
                # Nested subvolume inside top-level @ subvolume (e.g. var/lib/machines)
                parent_name = "@"
            else:
                # Path-based hierarchy: check longest ancestor mount path
                cur_path = os.path.abspath(item["root_path"]).rstrip("/")
                best_match: str | None = None
                best_len = -1
                for other in g_items:
                    if other["name"] == name:
                        continue
                    other_path = os.path.abspath(other["root_path"]).rstrip("/")
                    if cur_path.startswith(other_path + "/"):
                        if len(other_path) > best_len:
                            best_len = len(other_path)
                            best_match = other["name"]
                if best_match:
                    parent_name = best_match
                elif "/" in name:
                    # Fallback to name slash hierarchy
                    cand_name = name.rsplit("/", 1)[0]
                    if cand_name in group_item_map:
                        parent_name = cand_name

            # Cycle detection
            curr = parent_name
            visited: set[str] = {name}
            has_cycle = False
            while curr:
                if curr in visited:
                    has_cycle = True
                    break
                visited.add(curr)
                curr = parent_map.get(curr)

            if has_cycle or parent_name is None:
                parent_name = g_id  # Direct child of group header

            parent_map[name] = parent_name

            # Compute display_name
            if g_type == RootGroupType.ZFS:
                pool_prefix = g_label.replace("ZFS: ", "").strip()
                if parent_name == g_id:
                    # Direct child under ZFS: <pool_name>
                    if name.startswith(pool_prefix + "/"):
                        display_names[name] = name[len(pool_prefix) + 1 :]
                    elif name == pool_prefix:
                        display_names[name] = name
                    else:
                        display_names[name] = name
                else:
                    parent_item = group_item_map.get(parent_name)
                    if parent_item and name.startswith(parent_item["name"] + "/"):
                        display_names[name] = name[len(parent_item["name"]) + 1 :]
                    elif "/" in name:
                        display_names[name] = name.split("/")[-1]
                    else:
                        display_names[name] = name
            elif g_type == RootGroupType.BTRFS:
                # For Btrfs, keep the subvolume name (e.g. @, @home, @root, var/lib/machines)
                display_names[name] = name
            else:
                if parent_name == g_id:
                    display_names[name] = name
                else:
                    parent_item = group_item_map.get(parent_name)
                    if parent_item:
                        parent_p = os.path.abspath(parent_item["root_path"]).rstrip("/")
                        child_p = os.path.abspath(item["root_path"]).rstrip("/")
                        try:
                            rel = os.path.relpath(child_p, parent_p)
                            display_names[name] = rel if rel and not rel.startswith(".") else name
                        except ValueError:
                            display_names[name] = name
                    else:
                        display_names[name] = name

        # Build children map within group
        # parent_id -> list of child names
        children_map: dict[str, list[str]] = {g_id: []}
        for item in g_items:
            children_map[item["name"]] = []

        for item in g_items:
            p = parent_map[item["name"]]
            if p and p in children_map:
                children_map[p].append(item["name"])
            else:
                children_map[g_id].append(item["name"])

        # Calculate levels and has_children
        for item in g_items:
            name = item["name"]
            item["parent_name"] = parent_map[name]
            item["display_name"] = display_names[name]
            item["has_children"] = len(children_map[name]) > 0
            item["is_group_header"] = False

        # Calculate depths starting from children of g_id
        def assign_level(node_name: str, current_level: int) -> None:
            if node_name in group_item_map:
                group_item_map[node_name]["level"] = current_level
            for ch in children_map.get(node_name, []):
                assign_level(ch, current_level + 1)

        for top_child in children_map[g_id]:
            assign_level(top_child, 1)

        # Create Group Header RootViewItem
        total_snaps = sum(r["snapshots_count"] for r in g_items)
        any_mounted = any(r["is_mounted"] for r in g_items)
        header_fs = (
            FilesystemType.ZFS if g_type == RootGroupType.ZFS else (FilesystemType.BTRFS if g_type == RootGroupType.BTRFS else FilesystemType.GENERIC)
        )
        group_header: RootViewItem = {
            "name": g_id,
            "root_path": "",
            "sub_path": "",
            "snapshots_count": total_snaps,
            "is_mounted": any_mounted,
            "parent_name": None,
            "level": 0,
            "has_children": len(children_map[g_id]) > 0,
            "display_name": g_label,
            "group_type": g_type,
            "is_group_header": True,
            "dataset_name": None,
            "filesystem_type": header_fs,
        }

        final_result.append(group_header)

        # Depth-first topological output for children
        def add_subtree(node_name: str) -> None:
            # Sort direct children alphabetically by name
            direct_children = sorted(children_map.get(node_name, []), key=lambda n: group_item_map[n]["name"])
            for child_name in direct_children:
                child_item = group_item_map[child_name]
                final_result.append(child_item)
                add_subtree(child_name)

        add_subtree(g_id)

    return final_result
