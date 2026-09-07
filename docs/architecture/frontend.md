# Frontend Architecture

The frontend is built entirely using **Vanilla JavaScript** (ES Modules) without the need for a bundler, NPM dependencies, or build tools. This design choice ensures the application remains lightweight, fast, and easy to audit.

## Directory Structure
- `src/goeddel/use/static/js/`: Core Javascript logic (e.g., `main.js`, `differ.js`).
- `src/goeddel/use/static/js/plugins/`: Frontend plugin handlers (e.g., `text_differ.js`).
- `src/goeddel/use/templates/`: Jinja2 templates (e.g., `diff.html.j2`, `explorer.html.j2`).

## Design Principles
1. **No Node/NPM ecosystem**: The UI interacts with the DOM using native `document.querySelector` and `addEventListener`. No React, Vue, or build steps exist.
2. **Declarative DOM State**: Instead of tracking state tightly in JavaScript objects, state is often maintained within the DOM using `data-*` attributes (e.g., `data-snapshot-id`, `data-min-snapshots`).
3. **Progressive Enhancement**: HTML pages are heavily pre-rendered by Jinja2 templates for fast initial loading. JavaScript is layered on top to provide interactivity, dynamic fetch updates (like loading diff content), and UI state toggling.
4. **Modularity**: Javascript is split into independent ES modules, importing what they need using native `import` statements.

## Key Interactions
- **Timeline & Checkbox Sync**: The user selects or alters snapshots on the timeline. These interactions trigger custom events or DOM updates.
- **DifferHost**: For the diff view, a dynamic `DifferHost` orchestrates N-way snapshot selections by interacting with `Differ` plugins and invoking `fetch()` against the backend API (`/api/diff/...`).
- **Audit Filters**: Toggling "changed only" or "missing files" immediately updates the CSS classes or style states to hide/show DOM rows visually on the client side without backend re-fetching where possible.
- **FilterManager & Strategies**: The `FilterManager` coordinates column-specific filtering using a Strategy Pattern (`FilterStrategies`). Filter expressions are JIT compiled into O(1) evaluator functions to ensure fast filtering over large DOM tables. Node properties are bound to `data-sort` attributes to provide raw bytes/dates to the evaluators without expensive DOM string parsing.
