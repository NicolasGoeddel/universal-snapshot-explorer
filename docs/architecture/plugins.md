# Plugin Architecture

The system utilizes a modular plugin architecture to allow extensible logic without modifying the core routing or filesystem abstraction layers. Currently, this is heavily utilized in the Diff Engine to support different ways of comparing files (e.g., text, binary, images).

## Backend Plugin System

The backend hosts the `DiffEngine` registry in `src/goeddel/use/differ.py`.
- **`DiffPlugin` Protocol**: All backend plugins must inherit from `DiffPlugin` (`src/goeddel/use/plugins/diff/base.py`).
- **Required Metadata**: A plugin declares its `plugin_id`, `min_snapshots`, and optionally `max_snapshots`.
- **Execution**: The `compute` method receives a sequence of `Snapshot` objects and physical file paths. It returns a dynamically constructed `FileDiffResult` representing the differences between those snapshots.
- **Caching**: The `DiffEngine` automatically caches plugin results using a hashed key generated from snapshot IDs, plugin ID, and file modification times.

### Current Backend Plugins
- `TextDifferPlugin` (`text-differ`): Computes line-by-line sequence matching for text files and provides Pygments syntax highlighting. It strictly expects exactly 2 snapshots (`min_snapshots = 2`, `max_snapshots = 2`).

## Frontend Plugin Integration

On the frontend, the UI adapts dynamically based on the selected plugin.
- **`DifferHost`**: The main JavaScript controller (`src/goeddel/use/static/js/differ.js`) manages the timeline.
- **Plugin Lifecycle**:
  - The `DifferHost` discovers the active plugin via DOM data attributes.
  - It loads the corresponding Javascript module from `src/goeddel/use/static/js/plugins/`.
  - It strictly enforces the plugin's `minSnapshots` and `maxSnapshots` properties by locking or unlocking the timeline UI to ensure the correct number of snapshots are selected before firing an API request.
- **Rendering**: The API request returns JSON containing the `FileDiffResult`, which the frontend plugin handler transforms into HTML to update the view.
