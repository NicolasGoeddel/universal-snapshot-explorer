# Performance Architecture & Engineering Deep-Dive

**Universal Snapshot Explorer (USE)** is built from the ground up to browse massive ZFS and Btrfs filesystems containing 10,000+ files across 50+ snapshots at a locked 60/120 Hz.

Instead of relying on heavyweight client-side frameworks (React, Vue) or accepting sluggish multi-second I/O response times, USE combines a zero-dependency Python backend with a high-performance Vanilla JavaScript frontend.

This document details the architectural decisions, multi-tier scanning strategies, caching layers, and DOM rendering techniques that make this scale possible.

---

## 1. Backend Architecture & I/O Reduction

The core challenge in snapshot exploration is **I/O amplification**: a directory with 7,000 files examined across 50 snapshots theoretically requires 350,000 `stat()` calls and hundreds of mount-point checks. 

To eliminate disk seek bottlenecks, the backend implements three distinct directory scanning tiers and multiple specialized caching layers:

### 1.1 The Three Directory Scanning Tiers
Rather than using a single generic directory reader, [`root_folder.py`](../src/goeddel/use/models/root_folder.py) splits directory access into three specialized tiers:

1. **Full Domain View (`Folder.content()`):**
   - **Role:** Generates the active snapshot view for server-side HTML rendering (Jinja2).
   - **Optimization:** Reads directory entries and resolves user/group mappings for visible entries. Crucially, it **deliberately omits snapshot history calculation**. Timeline diff bars are rendered as lightweight CSS skeletons, allowing the initial HTML response to stream to the browser in milliseconds without waiting for multi-snapshot diff calculations.
2. **Name-Only Aggregation (`list_dir_names()`):**
   - **Role:** Discovers "missing" files (files that exist in other snapshots but were deleted/missing in the active view).
   - **Optimization:** Calls `os.listdir()` without `stat()`. Inodes are not queried; only raw directory entry names are read and cached in memory (`_dir_names_cache[(path, snap)]`). This determines missing file existence across 50+ snapshots without incurring thousands of disk seek operations.
3. **Primitive Batch Signature Scanning (`_scan_dir_live()` & `_scan_read_only_dir()`):**
   - **Role:** Computes the multi-snapshot timeline color bars via `/api/snapshot-bars`.
   - **Optimization:** Uses `os.scandir()` to extract a 6-tuple primitive signature `(uid, gid, mode, mtime_ns, ctime_ns, size)`. It completely bypasses Python domain object allocations (`FSNode`, `File`, `Folder`), comparing thousands of raw integers directly in memory.

### 1.2 Immutable Snapshot Memoization (LRU Cache)
- **Mechanism:** By filesystem design, ZFS and Btrfs snapshots are strictly read-only and immutable.
- **Implementation:** In [`root_folder.py`](../src/goeddel/use/models/root_folder.py), [`_scan_read_only_dir()`](../src/goeddel/use/models/root_folder.py) wraps directory scans in `@functools.lru_cache(maxsize=2048)`. Only the mutable live directory (`OriginalSnapshot`) is scanned dynamically (`_scan_dir_live()`).
- **Architecture Benefit:** Scanning snapshots repeatedly would saturate kernel page caches and disk queues. Because snapshot blocks never change, memoization reduces subsequent directory diffing across past snapshots to zero-I/O memory lookup time.

### 1.3 POSIX Mount Boundary Fast-Path
- **Mechanism:** Subvolume and nested dataset detection checks whether directory paths cross mount boundaries (`/proc/mounts`).
- **Optimization:** In [`get_snapshot_bars_data()`](../src/goeddel/use/models/root_folder.py), regular files immediately short-circuit via `stat.S_ISREG(st_mode)`.
- **Architecture Benefit:** In POSIX filesystems, mount points and ZFS/Btrfs subvolume boundaries can only exist on directories. Evaluating mount point strings or dataset boundary checks on regular files is mathematically redundant.

### 1.4 Dynamic UID/GID Snapshot Mapping Cache
- **Mechanism:** User and group IDs can differ between snapshots or root filesystems.
- **Optimization:** [`_load_id_map()`](../src/goeddel/use/models/root_folder.py) reads and caches `/etc/passwd` and `/etc/group` per snapshot in `_id_map_cache`.
- **Architecture Benefit:** Parsing text files on disk repeatedly during directory walks causes disk thrashing. In-memory caching resolves user/group names with zero disk access.

### 1.5 Deterministic Cache-Busting (`static_url`)
- **Mechanism:** In [`dependencies.py`](../src/goeddel/use/dependencies.py), static asset URLs automatically append `?v={mtime}` based on the physical file's modification time.
- **Architecture Benefit:** Provides instantaneous, 100% reliable cache invalidation across browsers and proxies natively in Python, completely avoiding the need for Node.js, npm, or Webpack build pipelines.

---

## 2. Frontend Architecture & DOM Engineering

Rendering 7,000+ rows creates over **63,000 table cells** and up to **350,000 snapshot indicators**. In standard web applications, this volume typically leads to unresponsive UIs and dropped frames. USE solves this via direct DOM architecture and lazy rendering:

### 2.1 Lazy SVG Rendering (`IntersectionObserver`)
- **The Concept:** Rendering complex SVG elements for 7,000 files requires creating tens of thousands of DOM nodes. If the backend Jinja template injected all these SVGs directly into the HTML, the document size would explode and the browser's HTML parser would lock up on initial load.
- **The Implementation:** 
  1. The backend server explicitly outputs an empty `<div class="snapshot-skeleton">` placeholder for every file in the timeline column.
  2. The frontend fetches a highly compact JSON payload representing the timeline via `/api/snapshot-bars` (e.g., passing a short string like `"uuuucccm"` to denote file changes).
  3. In [`explorer.js`](../src/goeddel/use/static/js/explorer.js), an `IntersectionObserver` watches the table rows. The JavaScript logic builds the actual SVG nodes *only* for the rows that scroll into the visible viewport.
- **Architecture Benefit:** Eliminates thousands of hidden SVG DOM nodes from the initial render tree, dropping the time-to-interactive metric significantly.

### 2.2 Deferred MIME-Type Deep Inspection
- **The Concept:** Discovering the true MIME type of a file often requires reading its physical binary header using `libmagic`. Performing this deep inspection for 7,000 files during a directory listing would cause devastating disk thrashing and block the backend indefinitely.
- **The Implementation:**
  1. The backend uses a fast, zero-I/O extension guess (`mimetypes.guess_type`) for the primary Explorer table.
  2. For the detailed inspection view ([`details.html.j2`](../src/goeddel/use/templates/details.html.j2)), it immediately renders a `<span class="mime-skeleton">` placeholder.
  3. The frontend triggers an asynchronous fetch to `/api/file-mimetypes/`, which offloads the heavy `libmagic` header inspection. Once returned, [`details.js`](../src/goeddel/use/static/js/details.js) replaces the skeleton.
- **Architecture Benefit:** Keeps the initial page load completely bound to fast metadata (`stat`) rather than slow binary file I/O, ensuring instantaneous directory traversal regardless of file counts.

### 2.3 The O(1) `TreeTable` Component
- **The Concept:** Operations like folder collapsing, multi-selection, and filtering in hierarchical tree tables traditionally scan the DOM using `tbody.querySelectorAll('tr')`. Running query selectors across 7,000 elements repeatedly causes severe layout and GC thrashing.
- **The Implementation:** [`tree_table.js`](../src/goeddel/use/static/js/tree_table.js) indexes all rows on initial load using a two-pass algorithm:
  - *Pass 1:* Registers every row into a `Map<string, HTMLTableRowElement>` keyed by its relative path ($O(1)$ lookups).
  - *Pass 2:* Establishes direct memory pointers for parent/child hierarchies (`row._parent`, `row._children = new Set()`).
- **Architecture Benefit:** Replaces sequential C++ DOM traversal with instant $O(1)$ memory pointer lookups in JavaScript.

### 2.4 Native Sibling Navigation & Instant Keyboard Scrolling
- **The Concept:** Rapid arrow-key navigation in massive tables often stutters. Conventional approaches search `visibleRows.indexOf(currentRow)` ($O(N)$ lookup) and invoke `scrollIntoView({ behavior: 'smooth' })`. With thousands of rows, `smooth` scrolling triggers continuous layout queue thrashing, while holding the down arrow floods the browser with `history.replaceState` calls.
- **The Implementation:** In [`keyboard_nav.js`](../src/goeddel/use/static/js/keyboard_nav.js):
  - Step navigation traverses native DOM pointers directly (`row.nextElementSibling` / `previousElementSibling`) skipping hidden rows in $O(1)$.
  - Row scrolling uses `scrollIntoView({ block: 'nearest', behavior: 'instant' })`.
  - URL hash updates (`history.replaceState`) are debounced to fire only after navigation pauses.
- **Architecture Benefit:** Bypasses array scanning entirely and avoids forcing the rendering engine to smoothly interpolate 64,000 cells while simultaneously executing JavaScript callbacks.

### 2.5 Layout-Throttled Column Resizing
- **The Concept:** Changing a column width in a 7,000-row table forces the browser rendering engine to recalculate cell widths, padding, and text-truncation across all 64,000 cells. High-polling mice (500–1000 Hz) send hundreds of `mousemove` events per second, demanding hundreds of full reflows per second, which freezes the browser.
- **The Implementation:**
  1. In [`table_resizer.js`](../src/goeddel/use/static/js/table_resizer.js), DOM style mutations are throttled via `requestAnimationFrame`. This discards intermediate mouse movements and clamps layout updates to the display's actual refresh rate (e.g., 60 Hz or 120 Hz).
  2. Pointer events are suppressed (`pointer-events: none` on `tbody`) during drag operations to avoid expensive `:hover` hit-testing recalculations while the mouse moves over thousands of cells.
- **Architecture Benefit:** Reduces the CPU budget to the strict minimum required for live table resizing by keeping reflow counts identical to the hardware frame rate.

---

## 3. Architecture Summary

| Architecture Layer | Core Philosophy | Technical Implementation |
| :--- | :--- | :--- |
| **Directory Scanning** | Avoid `stat()` when names suffice | 3-tier scanning (`Folder.content` / `list_dir_names` / `_scan_dir`) |
| **Snapshot History** | Exploit filesystem immutability | `@functools.lru_cache` memoization for all read-only snapshots |
| **SVG Timeline** | Defer DOM generation to the client | `IntersectionObserver` lazily swaps CSS skeletons for JS-rendered SVGs |
| **DOM Hierarchy** | Never walk the DOM tree | Two-pass `TreeTable` indexing for $O(1)$ lookup maps |
| **Keyboard Engine** | Bypass JS Arrays & Smooth Scroll | Direct `nextElementSibling` DOM traversal + `instant` block scrolling |
| **Layout Mutations** | Lock reflows to hardware refresh | `requestAnimationFrame` column width throttling + `:hover` suppression |
