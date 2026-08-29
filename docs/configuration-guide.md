# Universal Snapshot Explorer (USE) - Configuration Guide & Architecture

This guide covers all configuration options in **Universal Snapshot Explorer (USE)**, explains how different filesystem providers work under the hood, and details how paths and timestamps are resolved across live filesystems and snapshots.

---

## Table of Contents

1. [Architecture & Path Resolution](#1-architecture--path-resolution)
2. [Filesystem Providers & Use Cases](#2-filesystem-providers--use-cases)
   - [OpenZFS Provider (`zfs`)](#openzfs-provider-zfs)
   - [Btrfs & Snapper / btrbk Provider (`btrfs`)](#btrfs--snapper--btrbk-provider-btrfs)
   - [Generic / POSIX / Network Shares Provider (`generic`)](#generic--posix--network-shares-provider-generic)
3. [Configuration Reference](#3-configuration-reference)
   - [Root Configuration (`roots:`)](#root-configuration-roots)
   - [Global ZFS Auto-Discovery (`zfs:`)](#global-zfs-auto-discovery-zfs)
   - [Global Btrfs Auto-Discovery (`btrfs:`)](#global-btrfs-auto-discovery-btrfs)
4. [Dynamic UID / GID Resolution](#4-dynamic-uid--gid-resolution)
5. [Timestamp Parsing Patterns (`snapshot_patterns`)](#5-timestamp-parsing-patterns-snapshot_patterns)

---

## 1. Architecture & Path Resolution

USE operates completely read-only (`:ro`) without maintaining an internal database or mutating files. To present a unified file tree alongside historical versions, USE resolves every file request to a physical path on disk using four parameters:

* `root_path`: The base path to the live filesystem root or subvolume.
* `sub_path`: An optional subfolder inside the root.
* `snapshot_dir_name`: The directory where snapshots are stored (relative or absolute).
* `control_dir_name`: The directory name to automatically hide from directory listings (e.g. `.zfs` or `.snapshots`).

### How Paths are Resolved:

```
                          Live Request ("Original")
                                    │
                                    ▼
       ┌─────────────────────────────────────────────────────────┐
       │ real_path = os.path.join(root_path, sub_path, rel_path) │
       └─────────────────────────────────────────────────────────┘

                       Historical Snapshot Request
                                    │
                                    ▼
       ┌─────────────────────────────────────────────────────────┐
       │ 1. Base Snapshot Path (Provider-dependent)              │
       │    - Snapper:   snapshot_dir / <id> / snapshot          │
       │    - Flat/btrbk: snapshot_dir / <snap_name>             │
       │    - ZFS:       snapshot_dir / <snap_name>              │
       │                                                         │
       │ 2. Target File Path                                     │
       │    real_path = os.path.join(base_snap_dir,              │
       │                             sub_path,                   │
       │                             rel_path)                   │
       └─────────────────────────────────────────────────────────┘
```

#### Path Resolution Example:
Given `root_path: /mnt/pool/home`, `sub_path: user1`, `snapshot_dir_name: _btrbk_snapshots`:
* **Live File:** `/mnt/pool/home/user1/docs/report.pdf`
* **Snapshot `home.20260829`:** `/mnt/pool/home/_btrbk_snapshots/home.20260829/user1/docs/report.pdf`

---

## 2. Filesystem Providers & Use Cases

### OpenZFS Provider (`zfs`)

ZFS exposes snapshots via a hidden `.zfs/snapshot/<snapshot_name>` virtual directory at the dataset root.

#### Features:
* **ZFS CLI Mode (`provider_type: cli` / `auto`):** Calls `zfs list -t snapshot` to read exact Unix epoch creation timestamps and dataset properties. Requires `/dev/zfs` passthrough or host execution.
* **Filesystem Fallback Mode (`provider_type: filesystem`):** Operates in unprivileged containers without `zfs` binaries or `/dev/zfs` by scanning `.zfs/snapshot` directories.
* **Mount Propagation:** Supports `rslave` volume propagation to dynamically mount snapshots on-demand when accessed by the container.

#### Example Configuration:
```yaml
zfs:
  auto_discover: true
  mount_prefix: "/host"
  pools:
    - tank
    - backup_pool
  exclude_datasets:
    - "*/.system*"
    - "*/docker*"
  default_user_map: "/host/etc/passwd"
  default_group_map: "/host/etc/group"

roots:
  # Manual root for a ZFS dataset containing a nested system backup
  Server Backup:
    root_path: /host/mnt/backups/servers
    sub_path: webserver01
    filesystem_type: zfs
    # Dynamically reads etc/passwd from each individual historical snapshot!
    user_map: etc/passwd
    group_map: etc/group
```

---

### Btrfs & Snapper / btrbk Provider (`btrfs`)

In Btrfs, snapshots are read-only subvolumes. USE natively supports both structured **Snapper** layouts and flat **btrbk** / custom snapshot directories.

#### Supported Layouts:
1. **Snapper Layout:** `<snapshot_dir>/<id>/snapshot` with an accompanying `<snapshot_dir>/<id>/info.xml` file. USE parses `info.xml` to extract exact creation timestamps, descriptions, and user context.
2. **Flat / btrbk Layout:** `<snapshot_dir>/<snapshot_name>` (where each entry is a direct read-only subvolume).
3. **Timestamp Resolution Priority:**
   1. `info.xml` metadata (Snapper)
   2. Regex / strftime pattern matching on directory name (`snapshot_patterns`)
   3. `btrfs subvolume show` creation timestamp (if `btrfs` CLI is available)
   4. Directory filesystem `st_mtime` fallback

#### Example 1: Standard Snapper Subvolume
```yaml
roots:
  System Root:
    root_path: /host
    filesystem_type: btrfs
    # Automatically defaults to:
    # snapshot_dir_name: .snapshots
    # control_dir_name: .snapshots
```

#### Example 2: btrbk Snapshot Directory Setup
If you use `btrbk` to create timestamped snapshot subvolumes in a custom directory:
```yaml
roots:
  Home Backups:
    # Path to the live subvolume
    root_path: /mnt/btrfs/home

    filesystem_type: btrfs

    # Directory where btrbk puts snapshot subvolumes (can be relative or absolute)
    snapshot_dir_name: /mnt/btrfs/_btrbk_snapshots

    # Hide the snapshot folder from the live directory browser
    control_dir_name: _btrbk_snapshots

    # Patterns to extract timestamps for chronological sorting
    snapshot_patterns:
      - "home.%Y%m%dT%H%M%S*"
      - "home.%Y%m%d*"
```

---

### Generic / POSIX / Network Shares Provider (`generic`)

The generic provider works with any POSIX-compliant filesystem, including NFS, SMB/CIFS, CephFS (`.snap`), or custom rsync hardlink backup directories.

#### Features:
* Scans any configured snapshot directory for subdirectories representing snapshot points in time.
* Sorts snapshots chronologically using `snapshot_patterns` or directory modification times.

#### Example Configuration:
```yaml
roots:
  NFS Share Backup:
    root_path: /mnt/nfs_shares/data
    filesystem_type: generic
    snapshot_dir_name: /mnt/nfs_shares/backups/daily
    snapshot_patterns:
      - "backup-%Y-%m-%d"
      - "backup-%Y%m%d"
```

---

## 3. Configuration Reference

### Root Configuration (`roots:`)

Each entry in `roots:` represents a browsable filesystem in the Roots Overview dashboard:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `root_path` | `string` | *Required* | Absolute path to the live filesystem root or subvolume. |
| `sub_path` | `string` | `""` | Optional subfolder inside `root_path` to restrict the root view. |
| `filesystem_type` | `string` | `"zfs"` | Filesystem provider: `"zfs"`, `"btrfs"`, `"cephfs"`, or `"generic"`. |
| `provider_type` | `string` | `"auto"` | Provider mode: `"auto"`, `"cli"`, or `"filesystem"`. |
| `snapshot_dir_name` | `string` | *Auto* | Name (relative) or path (absolute) of snapshot directory. Defaults: `.zfs/snapshot` (ZFS), `.snapshots` (Btrfs), `.snap` (CephFS). |
| `control_dir_name` | `string` | *Auto* | Name of the control directory to hide in the live folder view. Defaults: `.zfs` (ZFS), `.snapshots` (Btrfs), `.snap` (CephFS). |
| `snapshot_patterns`| `list[string]` | `[]` | List of strftime/regex patterns to extract timestamps from snapshot names. |
| `user_map` | `string` | `null` | Path to `passwd` file. Relative paths resolve per-snapshot; absolute paths resolve from host. |
| `group_map` | `string` | `null` | Path to `group` file. Relative paths resolve per-snapshot; absolute paths resolve from host. |
| `dataset_name` | `string` | `null` | Specific ZFS dataset identifier (e.g. `tank/data`). |

---

### Global ZFS Auto-Discovery (`zfs:`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `auto_discover` | `bool` | `false` | Automatically discover and register all mounted ZFS datasets. |
| `mount_prefix` | `string` | `""` | Path prefix when the host root is mounted inside a container (e.g. `/host`). |
| `pools` | `list[string]` | `[]` | Limit auto-discovery to specific zpool names (e.g. `["tank", "data"]`). |
| `exclude_datasets` | `list[string]` | `[]` | Glob patterns of dataset names to ignore (e.g. `["*/.system*", "*/docker*"]`). |
| `default_user_map` | `string` | `null` | Default host `/etc/passwd` path applied to all auto-discovered roots. |
| `default_group_map` | `string` | `null` | Default host `/etc/group` path applied to all auto-discovered roots. |
| `snapshot_patterns` | `list[string]` | `[]` | Timestamp patterns applied to auto-discovered roots in filesystem mode. |

---

### Global Btrfs Auto-Discovery (`btrfs:`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `auto_discover` | `bool` | `false` | Automatically discover Btrfs subvolumes containing `.snapshots` directories. |
| `mount_prefix` | `string` | `""` | Path prefix when the host root is mounted inside a container (e.g. `/host`). |
| `exclude_paths` | `list[string]` | `[]` | Glob patterns of paths to exclude (e.g. `["/var/lib/docker/*", "*/tmp*"]`). |
| `default_user_map` | `string` | `null` | Default host `/etc/passwd` path applied to all auto-discovered roots. |
| `default_group_map` | `string` | `null` | Default host `/etc/group` path applied to all auto-discovered roots. |
| `snapshot_patterns` | `list[string]` | `[]` | Timestamp patterns applied to auto-discovered Btrfs roots. |

---

## 4. Dynamic UID / GID Resolution

USE converts numeric POSIX UIDs and GIDs into human-readable usernames and group names using standard `passwd` and `group` files.

### Relative vs. Absolute Mapping Paths:

1. **Relative Paths (`user_map: etc/passwd`):**
   * **Dynamic Per-Snapshot Resolution:** USE resolves the path inside the *currently active snapshot*.
   * **Historical Accuracy:** If UID 1000 was `alice` in 2025 but was renamed to `bob` in 2026, snapshots from 2025 will show `alice` and modern snapshots will show `bob`.
   * Mappings are cached per snapshot in memory.
2. **Absolute Paths (`user_map: /host/etc/passwd`):**
   * **Static Host Resolution:** Always reads the file directly from the specified host path across all snapshot views.

---

## 5. Timestamp Parsing Patterns (`snapshot_patterns`)

When snapshot metadata cannot be queried directly from the filesystem CLI, USE extracts timestamps from snapshot directory names using configurable format directives.

Supported directives include standard `strftime` formats as well as named placeholders:
* `%Y` / `{year}`: 4-digit year (e.g. `2026`)
* `%m` / `{month}`: 2-digit month (`01`-`12`)
* `%d` / `{day}`: 2-digit day (`01`-`31`)
* `%H` / `{hour}`: 2-digit hour (`00`-`23`)
* `%M` / `{minute}`: 2-digit minute (`00`-`59`)
* `%S` / `{second}`: 2-digit second (`00`-`59`)
* `*`: Wildcard matching any character sequence

### Common Pattern Examples:

| Tool / Scheme | Snapshot Name Example | Matching Pattern |
| :--- | :--- | :--- |
| **Sanoid / Syncoid** | `autosnap_2026-08-29_14:00:00_hourly` | `autosnap_%Y-%m-%d_%H:%M:%S_*` |
| **ZFS-Auto-Snapshot**| `zfs-auto-snap_daily-2026-08-29-1400` | `zfs-auto-snap_*-20%y-%m-%d-%H%M` |
| **btrbk Standard**   | `home.20260829T140000+0200` | `*.%Y%m%dT%H%M%S*` |
| **btrbk Date-Only**  | `home.20260829` | `*.%Y%m%d` |
| **Snapper Timestamp**| `backup-2026-08-29` | `backup-%Y-%m-%d` |
