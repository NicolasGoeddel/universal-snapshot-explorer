# Frontend Architecture

The frontend is built entirely using **Vanilla JavaScript** (ES Modules) without the need for a bundler, NPM dependencies, or build tools. This design choice ensures the application remains lightweight, fast, and easy to audit.

## Directory Structure
- `src/goeddel/use/static/js/`: Core Vanilla JS logic (`explorer_boot.js`, `explorer.js`, `table_sort_order.js`, `table_sorter.js`, `icons.js`, `differ.js`, etc.).
- `src/goeddel/use/static/js/plugins/`: Frontend plugin handlers (e.g., `text_differ.js`).
- `src/goeddel/use/static/css/`: Stylesheets including `skeleton.css` for progressive loading placeholders.
- `src/goeddel/use/templates/`: Jinja2 templates (e.g., `explorer.html.j2`, `explorer_partial.html.j2`, `first_folder.html.j2`, `assets.html.j2`, `diff.html.j2`).

## Design Principles
1. **No Node/NPM ecosystem**: The UI interacts with the DOM using native `document.querySelector` and `addEventListener`. No React, Vue, or build steps exist.
2. **Declarative DOM State**: Instead of tracking state tightly in JavaScript objects, state is often maintained within the DOM using `data-*` attributes (e.g., `data-snapshot-id`, `data-min-snapshots`).
3. **Progressive Enhancement**: HTML pages are heavily pre-rendered by Jinja2 templates for fast initial loading. JavaScript is layered on top to provide interactivity, dynamic fetch updates (like loading diff content), and UI state toggling.
4. **Modularity**: Javascript is split into independent ES modules, importing what they need using native `import` statements.

## Key Interactions
- **Pre-Paint Boot & Progressive Slot Loading (`explorer_boot.js`, `table_sort_order.js`)**: An inline boot script (`ExplorerBoot`) sizes columns, applies persisted filter toggles, and waits for the first folder's `data-nav-slot` templates (either streamed inline via `first_folder.html.j2` or fetched via `?partial=1&handoff=...`). Rows are sorted (`TableSortOrder`) and striped immediately while non-essential deferred scripts (`explorer.js`, `snapshot_timeline.js`, `table_sorter.js`) finish loading.
- **In-Place Folder Navigation & Snapshot Bars**: Navigating between folders within the same dataset fetches `?partial=1` and swaps `data-nav-slot` regions via `ExplorerBoot.applySlots`. Snapshot bars are preloaded in `<head>` and populated asynchronously without blocking row interaction; client-side icon updates use `lucideIcon` (`icons.js`) to emit `<i class="ico ...">` elements styled by `/icons.css`.
- **Timeline & Checkbox Sync**: The user selects or alters snapshots on the timeline. These interactions trigger custom events or DOM updates.
- **DifferHost**: For the diff view, a dynamic `DifferHost` orchestrates N-way snapshot selections by interacting with `Differ` plugins and invoking `fetch()` against the backend API (`/api/diff/...`).
- **Audit Filters**: Toggling "changed only" or "missing files" immediately updates the CSS classes or style states to hide/show DOM rows visually on the client side without backend re-fetching where possible.
- **FilterManager & Strategies**: The `FilterManager` coordinates column-specific filtering using a Strategy Pattern (`FilterStrategies`). Filter expressions are JIT compiled into O(1) evaluator functions to ensure fast filtering over large DOM tables. Node properties are bound to `data-sort` attributes to provide raw bytes/dates to the evaluators without expensive DOM string parsing.
