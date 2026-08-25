# ZFS Snapshot Explorer - Feature Roadmap & TODOs

## Pre-Release / Maintenance
- [ ] **Release Tagging & Changelog:** Create the first `v0.1.0` release with a clean GitHub Actions build workflow.
- [x] **Path Traversal Protection:** Secure paths strictly in `resolve_root_and_subpath` and `real_path` to prevent requests from escaping the dataset root directory.
- [ ] **Docstrings & Type Annotations:** Add detailed docstrings for the `zfs` module, caching, and VFS warmup/retry mechanisms.
- [ ] **Automated HTTP/Route Tests:** Implement integration tests using FastAPI's `TestClient` to ensure stability of HTML and API endpoints under ZFS-CLI error scenarios.

---

## 1. Backend, Storage & Snapshot Provider
- [x] Configurable roots via YAML configuration (`snapshotexplorer.yaml`)
- [x] MVC architecture refactoring (`models/`, `templates/`, `app.py`, `config.py`)
- [x] Asynchronous MIME type detection & intelligent extension fallback
- [x] Snapshot pattern parser (`auto-{year}-{month}-{day}...`) & ISnapshotProvider abstraction
- [x] **ZFS-CLI Snapshot Provider:** Execute `zfs list -t snapshot` directly to retrieve exact Unix epoch creation timestamps from ZFS metadata & support automatic dataset auto-discovery
- [x] **ZIP Batch Download:** Stream selected files or entire folders as a `.zip` archive on-the-fly (without temporary disk storage)
- [x] **Multi-Selection:** Checkbox multi-selection for batch actions (similar to Nextcloud)
- [x] **Modern 404 & Error Page:** Styled error view with smart navigation helpers (nearest existing parent directory), snapshot timeline bar with hover tooltips & i18n
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
- [x] **Symlink Resolution & Navigation:** Intelligent handling of symlinks in the web interface: If symlink points to a folder $\rightarrow$ follow link and open ListView of target folder; if it points to a file $\rightarrow$ open target folder with row highlighted (`#filename`); if symlink is invalid/dead (dangling symlink) $\rightarrow$ display special icon (`link-2-off`) & error indicator instead of a download error 404
- [x] **DetailView Button for Current Folder:** Add info button (`i`) on the far right of the table header in ListView to consistently navigate to the DetailView of the currently opened folder
- [x] **Fixed Alignment of Action Icons:** Align icons in the right action column (`.browser-cell-actions`) left-aligned with a fixed grid, so that the info icon (`i`) on folder rows aligns perfectly with the info icons on file rows
- [x] **Performance & High-Density Folder Rendering:** Removed CPU-intensive SVG filters (`feDiffuseLighting`), modernized to GPU-accelerated flat SVG vectors, and introduced `IntersectionObserver`-based lazy rendering for snapshot bars (smooth 60 FPS scrolling and 0% CPU blocking even in huge folders like `/usr/bin` with >6,000 files)
- [x] **Typeahead Quick Search (Jump-to-Prefix):** Jump directly to folders and files by typing starting letters. Features a floating HUD indicator, multi-match cycling (<kbd>↑</kbd>/<kbd>↓</kbd>/<kbd>Tab</kbd>), and full tree-view support for expanded folders
- [x] **Flicker-Free Snapshot Navigation:** When switching snapshots via shortcut (Ctrl+←/→) or click, update the page via in-place DOM update / fetch so that already rendered snapshot bars remain in the DOM and prevent white flickering (only move the active indicator dot and update metadata cells)

---

## 4. Frontend (Detail View, Diffing & Media Previews)
- [x] Visual change highlighting: Highlight attribute changes across snapshots (with tooltips & version badges)
- [x] Sortable snapshot column (Newest first $\downarrow$ vs. Oldest first $\uparrow$) with chronological diff calculation
- [ ] **Text Diff Viewer:** Side-by-Side & Unified diff for text and code files between any two snapshots
- [ ] **Image Diff:** Before/after comparison for image files (slider / overlay)
- [ ] **In-Browser Media Quick-Preview:** Modal lightbox window for images, HTML5 audio/video player, PDF viewer, and code syntax highlighting
