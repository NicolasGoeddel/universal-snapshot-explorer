# Backend Architecture

The backend is built with **FastAPI** and is responsible for routing HTTP requests, serving static assets, rendering HTML templates via Jinja2, and interacting with the underlying filesystems.

## Directory Structure
- `src/goeddel/use/routers/`: FastAPI route handlers (e.g., `explorer.py`, `differ.py`).
- `src/goeddel/use/models/`: Core domain models and abstractions.
- `src/goeddel/use/zfs/` & `src/goeddel/use/btrfs/`: Filesystem-specific integrations for parsing snapshots, datasets, and subvolumes.

## Filesystem Abstraction (Nodes)
To support multiple filesystems transparently, the backend uses a Node abstraction pattern:
- **`Node` / `FileNode` / `FolderNode`**: Represents a generic filesystem entity. The routing layer interacts strictly with these nodes rather than executing ZFS/Btrfs commands directly.
- **`Snapshot`**: Represents a specific point in time across the filesystem.

When a request arrives for a path, the backend delegates path resolution to `path_resolver.py`, which determines the appropriate filesystem backend and constructs the node tree.

## Data Flow
1. **Request Reception**: FastAPI router (`routers/explorer.py`) receives a path and snapshot parameters.
2. **Context Resolution**: The dependency injector (`dependencies.py`) provides the global app configuration.
3. **Node Instantiation**: The specific file or folder node is instantiated via the root folder abstraction.
4. **Action Execution**:
   - If HTML is requested, a Jinja2 template is rendered with the node context.
   - If an API diff is requested, the node paths are passed to the `DiffEngine`.
   - If a download is requested, `zip_streamer.py` directly streams the node's contents on-the-fly.

## Type Safety
The backend strictly uses Python type hints (`typing.Sequence`, `typing.cast`, `dataclasses.dataclass`). `basedpyright` enforces these rules globally, explicitly forbidding the unchecked use of `Any` to guarantee robust execution boundaries.
