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
   - If HTML is requested, a Jinja2 template is rendered with the node context (with template indentation stripped at compile time via `utils/template_whitespace.py`).
   - For folder listings (`/list/...`), the page shell is streamed immediately via `StreamingResponse` while rows render in a background thread (`utils/render_handoff.py` with `copy_context()`). If rendering finishes within `ROWS_BUDGET_SECONDS` (0.1 s), the rows follow in the same stream; otherwise a single-use, owner- and target-bound `handoff` token lets the browser's follow-up `?partial=1&handoff=...` request claim the running render. `/api/snapshot-bars/...` calls `wait_for_render` so bar computation does not compete with the initial row render.
   - If an API diff is requested, the node paths are passed to the `DiffEngine`.
   - If a download is requested, `zip_streamer.py` directly streams the node's contents on-the-fly.

## Asset Bundling, Icons & Compression
- **Bundled & Versioned Assets (`utils/assets.py`, `app.py`)**: Static CSS/JS files are combined and minified on demand via `/bundle.{kind}?files=...&v=...` using `rcssmin`/`rjsmin` (or served unbundled via `/static/...` when `--reload` / `USE_DEBUG_ASSETS=1` is set). `VersionedStaticFiles` and `/bundle.{kind}` emit `immutable` cache headers when `?v=` is present.
- **Mask-Based Icon Stylesheet (`utils/icons.py`)**: All Lucide icon names referenced across `.py`, `.j2`, and `.js` files are collected once and served as `/icons.css?v=...`, drawing icons via CSS `mask-image` on lightweight `<i class="ico ...">` elements instead of embedding inline SVGs per row.
- **Response Compression (`app.py`)**: `PagesGZipMiddleware` compresses HTML, API JSON, bundles, and stylesheets while excluding `/download/` and `/download-zip/` so browsers keep exact `Content-Length` download progress.

## Type Safety
The backend strictly uses Python type hints (`typing.Sequence`, `typing.cast`, `dataclasses.dataclass`). `basedpyright` enforces these rules globally, explicitly forbidding the unchecked use of `Any` to guarantee robust execution boundaries.

## Security (`security.py`)
When `security.enabled` is set (see the configuration guide), a single middleware in `app.py` is the policy enforcement point for every filesystem-exposing route: it resolves the requested root/subpath the same way the route itself would, then checks the user's access via `security.can_access()` before the route ever runs. That function re-derives the POSIX.1e ACL algorithm against the `system.posix_acl_access` xattr (read via `os.getxattr`) and NSS-resolved group membership.

The currently-authenticated identity is threaded into deeper layers (`FSNode.is_accessible`, per-item ZIP export filtering in `zip_streamer.py`) via ContextVars (`current_username`, `current_traverse_cache`, `current_user_groups`) rather than added parameters on every call, since Starlette copies the request's context into whichever thread a sync handler runs on.

**Impersonation Union:** If no header-authenticated user is present, the app can be configured (`impersonate_users`) to act as a *union* of multiple users. In this case, `current_username` carries a `frozenset` of usernames. Access is granted if *any* member of the set would be granted access, evaluating the full traverse-and-read chain independently for each member to prevent privilege escalation.

**Traversal Caching:** Traverse ("x") permission is verified from the root down to the target. To avoid massive overhead during folder listings (where every child has the same parent chain), `current_traverse_cache` caches proven paths per-request. A denial short-circuits the entire subtree beneath it.

**Stat Visibility vs. Accessibility:** The architecture differentiates between `is_stat_visible` (which only requires traverse permission on the parent directory to view metadata like size, mtime, and mode) and `is_accessible` (which additionally requires read permission on the target itself to view its content).

**Cache trap**: `RootFolder` caches `Folder`/file nodes by `(path, snapshot)` only, shared across all users. Never memoize a per-user filtered result (e.g. `Folder.children`) directly on one of these cached objects. This is why per-user access is a computed property (`is_accessible`, `is_stat_visible`), not baked into the cached listing itself.
