# Releases & Changelog

All notable changes to **Universal Snapshot Explorer (USE)** are documented in this file in reverse chronological order.

This project adheres to [Semantic Versioning (SemVer)](https://semver.org/).

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
