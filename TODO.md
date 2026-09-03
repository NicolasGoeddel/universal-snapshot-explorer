# Universal Snapshot Explorer (USE) - Feature Roadmap & TODOs

## Pre-Release / Maintenance
- [x] **Release Tagging & Changelog:** Released `v2.0.0` with full `RELEASES.md` changelog and automated GHCR Docker build workflow.
- [x] **Path Traversal Protection:** Secure paths strictly in `resolve_root_and_subpath` and `real_path` to prevent requests from escaping the dataset root directory.
- [x] **Docstrings & Modern Type Annotations:** Clean typing with `from __future__ import annotations`, complete `basedpyright` strict typing across all files (0 errors / 0 warnings), and protocol abstractions.
- [x] **Automated HTTP/Route Tests:** Implement integration tests using FastAPI's `TestClient` to ensure stability of HTML and API endpoints under error and multi-filesystem scenarios.
- [x] **Project Rebranding / Renaming:** Renamed to Universal Snapshot Explorer (USE) with package `goeddel.use`, CLI `use` / `snapshot-explorer`, docs, and Docker container.

---

## 1. Backend, Storage & Snapshot Provider
- [x] Configurable roots via YAML configuration (`config.yaml`)
- [x] MVC architecture refactoring (`models/`, `templates/`, `app.py`, `config.py`)
- [x] Asynchronous MIME type detection & intelligent extension fallback
- [x] Snapshot pattern parser (`auto-{year}-{month}-{day}...`) & `ISnapshotProvider` abstraction
- [x] **Pluggable Multi-Filesystem Architecture:** Provider registry supporting OpenZFS (`ZfsProvider`), Btrfs (`BtrfsProvider`), and generic mount fallbacks (`GenericProvider`).
- [x] **Btrfs & Snapper Subvolume Support:** Auto-detection of `.snapshots` boundaries, Snapper XML metadata parsing (`info.xml`), and physical snapshot subvolume mapping (`.snapshots/<id>/snapshot`).
- [x] **Nested Mount & Sub-Dataset Detection:** Automatic detection of nested mount boundaries via `/proc/mounts`, rendering dedicated per-dataset snapshot bars in folder rows.
- [x] **ZFS-CLI Snapshot Provider:** Execute `zfs list -t snapshot` directly to retrieve exact Unix epoch creation timestamps from ZFS metadata & support automatic dataset auto-discovery
- [x] **ZIP Batch Download:** Stream selected files or entire folders as a `.zip` archive on-the-fly (without temporary disk storage)
- [x] **Multi-Selection:** Checkbox multi-selection for batch actions (similar to Nextcloud)
- [x] **Modern 404 & Error Page:** Styled error view with smart navigation helpers (nearest existing parent directory), snapshot timeline bar with hover tooltips & i18n
- [ ] **Btrfs Subvolume CLI Auto-Discovery (`btrfs subvolume list`):**
  - Parse output of `btrfs subvolume list` to auto-discover all live subvolumes on the system (e.g. `@`, `@home`, `@root`, `@srv`).
  - Distinguish live subvolumes from snapshot subvolumes by evaluating `top level` ID hierarchies and path patterns (e.g. filter out `.snapshots`, `.snapshots/*/snapshot`, `_btrbk_snapshots/*`).
  - Associate discovered snapshot subvolumes with their corresponding parent live subvolumes and register each live subvolume as an independent root in the Roots Overview dashboard (identical to ZFS dataset discovery).
- [ ] **Folder-Scoped Inode Rename Tracking & Hash Navigation:** Detect renamed/moved files within the current folder by tracking persistent Inodes (`st_ino`) across snapshots. If a focused `#filename` is missing in a target snapshot, automatically refocus or link to the entry with the matching Inode.
- [x] **Automatic & On-Demand Cache Invalidation:**
  - *Mtime-based auto-detection:* Check `os.stat` on snapshot control directory (`.zfs/snapshot` or `.snapshots`) to auto-invalidate cache when snapshots are created/pruned in 24/7 server environments.
  - *UI Refresh Button & Shortcut (<kbd>Shift+R</kbd>):* Dedicated rotate icon in toolbar and keyboard shortcut to force cache invalidation with spinning micro-animation and smooth page reload via `/api/invalidate`.
  - *Centralized `RootFolder.invalidate_all()`:* Flushes all root folder instances, shadow instances, path caches, and LRU caches.
- [ ] **Shadow Config Exporter:** Option in the Root Overview dashboard to export all dynamically discovered Delegated Roots as a ready-to-use `config.yaml`.
- [ ] **Multi-Snapshot Version Export (`.tar.gz`):** Export all versions of selected files across all snapshots utilizing native POSIX hardlink deduplication (unchanged files are only transferred once in the stream)
- [ ] **On-Demand Folder Size Calculation:** Recursively calculate the actual folder size on-demand (button/shortcut) with caching at the `Folder` object to avoid unnecessary I/O load
- [x] **TrueNAS Scale Deployment & Compose:** Docker Compose stack with `/dev/zfs` device passthrough, host `/etc/passwd` mounts, and a fast SSH deploy script

---

## 2. Frontend (General, Theming & i18n)
- [x] Zebra striping coloring for dynamic and filtered table rows
- [x] Sticky Header (Toolbar, Breadcrumbs, table head, filter bar)
- [x] Dark Mode support (`prefers-color-scheme` + manual toggle with anti-FOUC)
- [x] Complete Lucide icons integration
- [x] Internationalization (i18n: DE / EN switcher & language cookie)
- [x] Custom SVG favicon with snapshot/disk symbolism
- [x] WCAG AA contrast optimizations & accessibility (a11y)

---

## 3. Frontend (List View & Navigation)
- [x] Toggle: Show/hide hidden files and folders (dotfiles)
- [x] Toggle: Show/hide missing files in the current snapshot
- [x] Toggle: Filter "Show modified files only" (Audit filter)
- [x] Sortable snapshot activity column (sorted by change frequency)
- [x] Global interactive snapshot selector in the column header
- [x] URL hash navigation (`#<filename>`) with automatic scrolling & highlighting
- [x] Performance: Remove redundant `<a>` links from row SVGs
- [x] **Keyboard Navigation:** Navigate with `↑`/`↓`, expand/collapse folders with `→`/`←`, `Enter` for actions, `i`/`d` for details, `/` for quick search, `Ctrl+L` for path editing, and `h`/`?` for shortcut help
- [x] **Toolbar Indicators:** Dynamic counter badges & filter statistics for hidden, missing, and unchanged files
- [x] **Modernized Root Overview:** Snapshot count per root, keyboard navigation & reusable header widgets (`nav_controls.html.j2`)
- [ ] **Hierarchical Roots Overview / Sub-Dataset Tree View:** Render nested datasets and subvolumes as an indented tree or grouped view with individual snapshot counts in the Roots dashboard.
- [x] **Symlink Resolution & Navigation:** Intelligent handling of symlinks in the web interface: If symlink points to a folder $\rightarrow$ follow link and open ListView of target folder; if it points to a file $\rightarrow$ open target folder with row highlighted (`#filename`); if symlink is invalid/dead (dangling symlink) $\rightarrow$ display special icon (`link-2-off`) & error indicator instead of a download error 404
- [x] **DetailView Button for Current Folder:** Add info button (`i`) on the far right of the table header in ListView to consistently navigate to the DetailView of the currently opened folder
- [x] **Fixed Alignment of Action Icons:** Align icons in the right action column (`.browser-cell-actions`) left-aligned with a fixed grid, so that the info icon (`i`) on folder rows aligns perfectly with the info icons on file rows
- [x] **Performance & High-Density Folder Rendering:** Removed CPU-intensive SVG filters (`feDiffuseLighting`), modernized to GPU-accelerated flat SVG vectors, and introduced `IntersectionObserver`-based lazy rendering for snapshot bars (smooth 60 FPS scrolling and 0% CPU blocking even in huge folders like `/usr/bin` with >6,000 files)
- [x] **Typeahead Quick Search (Jump-to-Prefix):** Jump directly to folders and files by typing starting letters. Features a floating HUD indicator, multi-match cycling (<kbd>↑</kbd>/<kbd>↓</kbd>/<kbd>Tab</kbd>), and full tree-view support for expanded folders
- [x] **Flicker-Free Snapshot Navigation:** When switching snapshots via shortcut (Ctrl+←/→) or click, update the page via in-place DOM update / fetch so that already rendered snapshot bars remain in the DOM and prevent white flickering (only move the active indicator dot and update metadata cells)
- [x] **Resizable Table Columns (with LocalStorage Persistence):**
  - Interactive drag handles on table headers (`.col-resizer`) to adjust column widths manually with two-stage accordion physics.
  - Idempotent, content-aware Auto-Fit Reset on double-click with high-speed length-ranking heuristic.
  - Smooth vector scaling without distortion for snapshot bars and elastic columns.
  - Persist custom column widths proportionally in browser `localStorage`.
  - Standalone, modular architecture via `table_resizer.js` and `table_resizer.css`.

---

## 4. Frontend (Pluggable Differ Engine, Detail View & Media Previews)
- [x] Visual change highlighting: Highlight attribute changes across snapshots (with tooltips & version badges)
- [x] Sortable snapshot column (Newest first $\downarrow$ vs. Oldest first $\uparrow$) with chronological diff calculation
- [x] **Categorical Attribute Value Color-Coding:** Color-code matching attribute values per column in DetailView so identical values across snapshots share subtle, harmonious background tints with high text contrast (columns without changes retain default background).
- [ ] **Modular / Pluggable File Differ Engine (`/diff`):** Dedicated view for inspecting file evolution across snapshots with a rich multi-snapshot selector topbar and pluggable viewer canvas:
  - *MIME-based Plugin Auto-Selection & Override:* Automatically load the right plugin based on file MIME type with manual override selector.
  - *Text & Code Differ Plugin:* 2-Way (Side-by-Side & Unified) diffing as well as multi-version stepping ($V_1 \rightarrow V_2 \rightarrow V_3$) with syntax highlighting.
  - *Image Differ Plugin:* Cross-fade opacity fader, split/wipe curtain slider, and amplified CSS/Canvas difference shaders (`mix-blend-mode: difference` + contrast boost).
  - *Structured Data Differ Plugin:* Semantic key-value and collapsible tree diffing for JSON, YAML, TOML, and XML.
  - *In-Browser Media Quick-Preview / Lightbox:* Modal preview player for audio, video, PDFs, and high-resolution images (`Space` key quick-preview).

---

## 5. Storage Analytics & High-Density Snapshot Scaling
- [ ] **Snapshot Growth & Churn Heatmap (Filelight / Sunburst View):** Interactive radial Sunburst or Treemap chart visualizing directory disk usage and highlighting where the most data was written, modified, or pruned between snapshot intervals.
- [ ] **High-Density Snapshot Timeline Scaling (>100–200 Snapshots):**
  - *Timeframe & Date-Range Filter:* Dropdown or range scrubber to limit timeline to specific timeframes (e.g. "Last 30 days", custom range) when datasets contain hundreds of snapshots.
  - *Level-of-Detail (LOD) Clustering:* Smart clustering of dense hourly snapshots into expandable day/week blocks on low-zoom viewports.

---

## 6. Frontend Modularization & Refactoring
- [x] **Generic TableSorter Component (`table_sorter.js`):**
  - Standalone, generic table sorting engine with pluggable column comparator callbacks (`customComparators`).
  - Multi-type value extraction (numbers, strings, timestamps via `data-sort`).
  - Hierarchical tree sorting support with folder-first priority.
  - Direction toggling (`asc`/`desc`/`none`), header visual indicators, and `localStorage` sort state persistence.
  - Universal reusability across Explorer, DetailView, and Roots Overview.
- [x] **Generic KeyboardNavigator with Action Registry (`keyboard_nav.js`):**
  - Core row-based focus and navigation engine (`↑`, `↓`, `PageUp`, `PageDown`, `Home`, `End`).
  - Dynamic keybinding registry API (`keyboard.register(key, handler)`).
  - Pluggable interceptor chain (`keyboard.addInterceptor(fn)`).
  - Multi-selection Shift+Space keyboard range toggle and live range visual preview.
  - Universal integration across Explorer, Roots Dashboard, and DetailView.
- [x] **TypeaheadHUD Extraction (`typeahead.js`):**
  - Self-contained prefix-jump HUD overlay with match counter, cycling, and event dispatching.
  - Plugs seamlessly into `KeyboardNavigator` interceptor chain.
- [x] **SelectionManager Extraction (`selection_manager.js`):**
  - Checkbox multi-selection, hierarchical Tri-State tree checkboxes, range select, action bar HUD, and on-the-fly ZIP generation form.
- [ ] **SnapshotBars & Lazy Rendering Extraction (`snapshot_bars.js`):**
  - SVG snapshot pill generation, IntersectionObserver batch lazy-loading, and timeline hover tooltips.
- [x] **FilterManager Extraction (`filter_manager.js`):**
  - Filter input search, toggle switches (hidden, missing, changed-only), count badges, and row visibility evaluation.
- [x] **Slim ExplorerView Coordinator (`explorer.js`) & Standalone TreeTable (`tree_table.js`):**
  - Extracted `TreeTable` into standalone pure DOM tree hierarchy component with `Map` path lookup, `row._parent`, and `row._children = new Set()`.
  - Renamed `explorer.js` class to `ExplorerView` acting as orchestrator for modular components (`TreeTable`, `FilterManager`, `SelectionManager`, `TableSorter`, `KeyboardNavigator`).

---

## 7. Performance & Tree Optimization
- [x] **Pre-Indexed DOM Tree Hierarchy ($O(1)$ Lookups & $O(\text{subtree})$ Operations):**
  - Standalone `TreeTable` maintains fast `Map<string, HTMLTableRowElement>` path lookup, direct parent pointers (`row._parent`), and child sets (`row._children = new Set()`).
  - Eliminated repeated $O(N)$ full-table `querySelectorAll` and string `startsWith` scans across `FilterManager`, `SelectionManager`, and `explorer.js`.
  - Instant upward match propagation in `FilterManager.applyFilter()` drops operation count from $\sim 7.4\text{ million}$ down to $\sim 4000$ operations in 3,700-row directories.
- [x] **Input Debouncing for Column Quick-Search (120ms):**
  - 120ms debounce on keystrokes in column filter inputs, with immediate execution on <kbd>Enter</kbd>, <kbd>Escape</kbd>, and <kbd>Tab</kbd> to ensure butter-smooth typing in large directories (e.g. `/usr/bin`).
- [x] **In-Input Match Counter & Reset ("X") Button:**
  - Display isolated per-column match count badge (e.g. `14`) inside active filter inputs, with a click-to-clear ("X") button to reset and refocus immediately.
- [ ] **Generator-Based Row Iteration:**
  - Use generators or direct DOM walker for `getVisibleRows()` to avoid intermediate array allocations during hot loops.


