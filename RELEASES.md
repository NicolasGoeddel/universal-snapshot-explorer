# Releases & Changelog

All notable changes to **Universal Snapshot Explorer (USE)** are documented in this file in reverse chronological order.

This project adheres to [Semantic Versioning (SemVer)](https://semver.org/).

---

## [2.1.0] - 2026-09-03

> **Minor Release: Hierarchical Roots & Subvolume Overview, Modular Architecture, Performance Engineering & UI Polish**

### 🚀 Highlights & New Features

* **Hierarchical Roots Overview:**
  * Added collapsible tree view in the Roots dashboard, grouping datasets by ZFS pool and subvolumes by Btrfs root alongside custom manual roots.
  * Displays aggregate snapshot counts, mount status badges, official vector SVG logos, and integrates with the Typeahead search filter.
* **Accurate Btrfs Subvolume Discovery:**
  * Parses `/proc/mounts` options (`subvol`, `subvolid`) to determine exact active mountpoints.
  * Accurately detects foreign mounts on standard paths (e.g. ext4 on `/home`) via `get_subvolume_info()` and filters internal container mounts.
* **Interactive Table Column Resizing:**
  * Added drag handles with two-stage accordion physics, double-click auto-fit reset, vector bar scaling, and `localStorage` persistence.
* **On-Demand Cache Invalidation:**
  * Added server-side cache flush button (`#refresh-btn`), global `Shift+R` keyboard shortcut, and snapshot directory `mtime` change detection.
* **Categorical Color-Coding in DetailView:**
  * Subtle background tints dynamically identify matching attribute values across snapshots for altered columns.

### ⚡ Performance & Frontend Architecture

* **Modular Frontend Architecture:**
  * Extracted monolithic frontend scripts into standalone, decoupled components: `TreeTable`, `FilterManager`, `SelectionManager`, `TableSorter`, and `KeyboardNavigator`.
* **Pre-Indexed DOM Tree Hierarchy:**
  * Introduced `TreeTable` maintaining $O(1)$ lookups and direct parent/child pointers, dropping filter operation counts from ~7.4M down to ~4k in large directories.
* **Snapshot Bar Fast-Path & Fluid Loading UX:**
  * Accelerated backend folder scanning (~12x faster) by bypassing mount checks for regular files.
  * Added glassmorphic loading overlay with animated 6-color ring, blurred backdrop, and chunked rAF ingestion.
* **Tri-State Checkboxes & Multi-Selection:**
  * Implemented hierarchical folder checkboxes (checked, indeterminate, unchecked), `Shift+Space` range selection with live preview, smart reveal, and a dynamic batch action dropdown.

### 🛠️ Refactoring & Type Safety

* **Domain `StrEnum` Architecture:**
  * Created `src/goeddel/use/enums.py` with standard library `StrEnum`s (`FilesystemType`, `ProviderType`, `RootGroupType`, `StructureMode`, etc.) replacing magic strings across models, configs, and providers with strict static type validation.
* **Backend Separation of Concerns:**
  * Encapsulated mount status and snapshot counting directly in `RootFolder`; streamlined the `read_root` router.
* **Code Quality & Tooling:**
  * Integrated Biome (`biome.json`) for JavaScript and CSS formatting and linting alongside strict `basedpyright` and `ruff`.

### 🐛 Bug Fixes

* **ExplorerView Icon Alignment:**
  * Removed inline HTML whitespace gap between folder spacers and Lucide icons for pixel-perfect vertical alignment.
* **Sub-Dataset Snapshot Routing & Inode Neutrality:**
  * Fixed detail view routing for sub-datasets and ignored cross-mount `st_ino` variations during snapshot comparison.
* **Typeahead Segment Matching:**
  * Fixed prefix-match dropping when navigating hierarchical sub-dataset paths.

### 📚 Documentation

* **Performance Engineering Guide:**
  * Added comprehensive architecture documentation in [`docs/performance-engineering.md`](docs/performance-engineering.md).
* **Component Guides:**
  * Added dedicated guides for filtering ([`docs/table-filtering-guide.md`](docs/table-filtering-guide.md)), selection ([`docs/table-selection-guide.md`](docs/table-selection-guide.md)), and keyboard navigation ([`docs/keyboard-navigation-guide.md`](docs/keyboard-navigation-guide.md)).
* **Security Documentation:**
  * Documented kernel VFS read-only safety guarantees when running with `--cap-add=SYS_ADMIN`.

---

## [2.0.1] - 2026-08-29

> **Bugfix Release: OpenZFS CLI Snapshot Discovery, Root Dataset Resolution & Configuration Guide**

### 🐛 Bug Fixes & Stability

* **OpenZFS Provider Initialisation & Snapshot Timestamps:**
  * Fixed an issue in `RootFolder` where `ProviderRegistry` was erroneously queried with `provider_type` (`"cli"`) instead of `filesystem_type` (`"zfs"`), which caused auto-discovered ZFS roots to silently fall back to `GenericProvider` / `FilesystemSnapshotProvider`.
  * Ensured `ZfsProvider.create_snapshot_provider` properly forwards `config.dataset_name` to `ZfsCliSnapshotProvider`.
* **Root-on-ZFS Path Resolution (`/` & Container Mount Prefixes):**
  * Fixed dataset matching in `ZfsClient.find_dataset_by_path` when the root filesystem dataset is mounted at `/` and passed into the container via `/host` (`mount_prefix: "/host"`).

### 📚 Documentation

* **Comprehensive Configuration & Architecture Guide:**
  * Created [`docs/configuration-guide.md`](docs/configuration-guide.md) with deep-dives into path resolution formulas, provider use-cases (`btrbk`, Snapper, OpenZFS), and dynamic snapshot-specific UID/GID mappings.

---

## [2.0.0] - 2026-08-28

> **Major Release: Universal Snapshot Engine, Btrfs & Snapper Support, Sub-Dataset Boundaries & Strict Type Safety**

Version 2.0.0 marks the evolution of *ZFS Snapshot Explorer* into the **Universal Snapshot Explorer (USE)**. This release introduces a modular, pluggable multi-filesystem engine capable of browsing OpenZFS, Btrfs (including Snapper layouts), and POSIX snapshot directories with full type safety, comprehensive integration testing, and automatic mountpoint boundary discovery.

### 🚀 Highlights & New Features

* **🗂️ Universal Multi-Filesystem Engine:**
  * Introduced the `FilesystemProvider` interface and `ProviderRegistry` allowing modular support for any snapshot-capable filesystem.
  * Added **Btrfs & Snapper Support (`BtrfsProvider`):**
    * Automatically discovers active Btrfs subvolumes and `.snapshots` hierarchies.
    * Parses Snapper XML metadata (`info.xml`) to extract exact snapshot descriptions, user context, and timestamps.
    * Dynamically resolves snapshot physical paths (`.snapshots/<id>/snapshot`).
  * Added **OpenZFS Provider (`ZfsProvider`):**
    * Native ZFS CLI integration via `zfs list -t snapshot` for Unix epoch timestamps and dataset autodiscovery.
    * Zero-dependency filesystem fallback mode for unprivileged containers.
  * Added **Generic Provider (`GenericProvider`):**
    * Fallback provider supporting NFS, CIFS/SMB, and standard POSIX mounts.

* **🌐 Smarter Mount & Boundary Detection:**
  * Integrated `/proc/mounts` parsing (`MountsManager`, `MountInfo`) to identify nested filesystem boundaries and network mounts.
  * **Per-Dataset Snapshot Timelines:** Directories that represent independent datasets or mount boundaries (e.g. `/root` or `/data/backups`) now render their own dedicated snapshot timeline bars in folder rows and breadcrumbs, rather than incorrectly inheriting the parent dataset's timeline.

* **📂 Dynamic Relative UID/GID Mapping:**
  * Relative `user_map` and `group_map` paths (e.g. `etc/passwd`) are now dynamically resolved from the *currently active snapshot* and cached per snapshot, accurately reflecting historical users and groups.

### 🛠️ Architecture & Under the Hood

* **Python 3.14 Future Annotations & Protocol Modernization:**
  * Enforced `from __future__ import annotations` across all 22 source modules.
  * Completely eliminated dynamic `getattr(...)` calls in favor of typed `RootFolderProtocol` properties and methods.
* **Strict Type Checking with `basedpyright`:**
  * Entire codebase runs at **`0 errors, 0 warnings, 0 notes`** under strict `basedpyright` analysis.
* **FastAPI Integration Test Suite:**
  * 38 comprehensive unit & integration tests covering routing, error handling, ZFS/Btrfs parsing, mount discovery, permissions, and streaming.
  * Reached **74% total test code coverage**.
* **GitHub Actions CI/CD Pipeline:**
  * Added `.github/workflows/ci.yml` running `ruff`, `basedpyright`, and `coverage` checks on Python 3.14.

### ⚠️ Breaking Changes & Migration Guide

* **Package & CLI Rename:**
  * Python package renamed from `goeddel.zfs_snapshot_explorer` to **`goeddel.use`**.
  * Executable command renamed from `zfsse` to **`use`** (or **`snapshot-explorer`**).
  * *To run locally:* `uv run use --config-file config.yaml`.
* **Docker Image Name:**
  * Published to `ghcr.io/nicolasgoeddel/universal-snapshot-explorer:latest`.
* **Configuration Enhancements:**
  * `config.yaml` now supports `btrfs:` global auto-discovery blocks alongside `zfs:`.
  * Manual roots support explicit `filesystem_type: zfs | btrfs | generic`.

---

## [1.0.1] - 2026-08-16

### 📝 Documentation & Fixes
* Integrated high-resolution screenshots for Roots Dashboard, Explorer View, and File Details into the README documentation.
* Resolved responsive layout scaling on mobile emulation and fixed MIME type resolution in deep file details view.

---

## [1.0.0] - 2026-08-16

> **Initial Release: ZFS Snapshot Explorer**

The initial stable release of ZFS Snapshot Explorer, featuring multi-snapshot timeline visualization and self-service file recovery for OpenZFS systems.

### ✨ Initial Features
* **Multi-Snapshot Timeline Visualization:** Color-coded SVG bars displaying file creation, modification, deletion, and static states across snapshots.
* **⚡ Flicker-Free Snapshot Navigation & UI Performance:**
  * Switching snapshots performs targeted in-place DOM updates without recalculating or redrawing SVG timeline bars.
  * GPU-accelerated flat vector graphics and `IntersectionObserver` lazy rendering for smooth 60 FPS scrolling in large directories.
* **⌨️ Full Keyboard Navigation & Quick Search:**
  * Live typeahead search HUD: jump instantly to matching files and folders by typing starting characters (A-Z, 0-9).
  * Comprehensive shortcuts: row navigation (<kbd>↑</kbd>/<kbd>↓</kbd>), expanding/collapsing folders (<kbd>→</kbd>/<kbd>←</kbd>), opening details (<kbd>i</kbd>), address bar focus (<kbd>Ctrl+L</kbd>), and help cheat sheet (<kbd>h</kbd> / <kbd>?</kbd>).
* **🌍 Internationalization (i18n):**
  * Full native bilingual support for English (`en`) and German (`de`) with persistent language selection.
* **🛡️ Security & Error Handling:**
  * Strict path traversal prevention across hierarchical dataset routes.
  * Redesigned modern 404 & error page with nearest existing parent navigation and snapshot switcher.
* **ZFS CLI Metadata Provider:** Extracting exact snapshot creation epoch timestamps via `zfs list -t snapshot`.
* **Filesystem Fallback Provider:** Fallback `.zfs/snapshot` directory scanner with customizable regex timestamp patterns (`auto-%Y-%m-%d-%H%M%S`).
* **On-the-Fly Streaming ZIP Downloads:** Stream multiple selected files or folders as a `.zip` archive without disk spooling.
* **Audit Filters:** Quick-toggle filters for "Changed files only", "Missing files", and "Hidden dotfiles".
* **UID/GID Mapping:** Host `/etc/passwd` and `/etc/group` mapping for file ownership resolution.
* **Theme Support:** Dark and light mode themes with `prefers-color-scheme` auto-detection.
* **Docker Deployment:** Container images for Docker Compose and TrueNAS Scale with `/dev/zfs` passthrough.
