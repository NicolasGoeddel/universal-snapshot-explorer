# File: src/goeddel/use/logger.py Line: 10
def setup_logging(level: ?) -> ?:
    "Configures the unified logging setup for the application."

# File: src/goeddel/use/dependencies.py Line: 20
def get_base_url(request: Request) -> str:

# File: src/goeddel/use/dependencies.py Line: 28
def quote_path_filter(path: str) -> str:

# File: src/goeddel/use/dependencies.py Line: 32
def render_lucide(name: str, **kwargs) -> str:

# File: src/goeddel/use/dependencies.py Line: 39
def static_url(path: str) -> str:

# File: src/goeddel/use/dependencies.py Line: 48
def make_route_url(module: str, root_name: str, sub_path: str="", snapshot: ?) -> str:

# File: src/goeddel/use/dependencies.py Line: 70
def get_app_config(request: Request) -> AppConfig:

# File: src/goeddel/use/enums.py Line: 6
class FilesystemType(StrEnum):
    "Filesystem types supported by Universal Snapshot Explorer."

# File: src/goeddel/use/enums.py Line: 15
class ProviderType(StrEnum):
    "Snapshot provider resolution strategy."

# File: src/goeddel/use/enums.py Line: 23
class RootGroupType(StrEnum):
    "Origin/grouping classification for root folders in the overview."

# File: src/goeddel/use/enums.py Line: 32
class StructureMode(StrEnum):
    "Folder packaging layout in downloaded ZIP archives."

# File: src/goeddel/use/enums.py Line: 40
class CompressionMode(StrEnum):
    "Compression algorithm for ZIP archives."

# File: src/goeddel/use/enums.py Line: 47
class ChangedAttribute(StrEnum):
    "File metadata attributes that can change between snapshot versions."

# File: src/goeddel/use/enums.py Line: 60
class LogLevel(StrEnum):
    "Application logging severity levels."

# File: src/goeddel/use/enums.py Line: 70
class Language(StrEnum):
    "Supported user interface languages."

# File: src/goeddel/use/enums.py Line: 77
class DiffLineType(StrEnum):
    "Classification of lines in diff comparison."

# File: src/goeddel/use/zip_streamer.py Line: 17
class ChunkedZipStreamer:
    """In-memory streaming sink for zipfile.ZipFile.
    Buffers emitted zip bytes and yields them in chunks to a generator,
    enabling low constant RAM footprint and zero disk temporary files."""

# File: src/goeddel/use/zip_streamer.py Line: 53
def deduplicate_paths(paths: list[str]) -> list[str]:
    """Normalizes and deduplicates a list of paths.
    If a parent directory is already present, its children are excluded to prevent duplicate files."""

# File: src/goeddel/use/zip_streamer.py Line: 73
def resolve_zip_selection(root_folder: RootFolder, snapshot: ?, paths: list[str]) -> tuple[(list[tuple[(str, str)]], list[str], list[str])]:
    """Walks the requested selection exactly as `stream_zip_archive` below will,
    without reading any file content.

    Returns `(included, empty_dirs, skipped)`:
      - `included`: `(node_path, real_path)` for every file that will actually
        be written into the archive.
      - `empty_dirs`: node paths that need an explicit empty-folder record in
        the archive (genuinely empty, or every entry inside was ACL-skipped).
      - `skipped`: node paths (files or whole subtrees, whichever is the
        highest point at which access was denied) excluded by the current
        user's ACL restrictions. A denied subdirectory is reported once,
        not descended into."""

# File: src/goeddel/use/zip_streamer.py Line: 153
def stream_zip_archive(root_folder: RootFolder, snapshot: ?, paths: list[str], base_folder_path: str="", structure_mode: StructureMode=..., compression: CompressionMode=...) -> Generator[(bytes, ?, ?)]:
    """Generates a streaming ZIP archive from selected paths within a root folder snapshot.
    Yields chunks of bytes directly to the caller."""

# File: src/goeddel/use/differ.py Line: 21
class DiffEngine:
    "Manager and executor for diff plugins."

# File: src/goeddel/use/app.py Line: 49
async def lifespan(app: FastAPI) -> AsyncGenerator[(?, ?)]:

# File: src/goeddel/use/app.py Line: 70
async def security_middleware(request: Request, call_next: Callable[(?, Awaitable[Response])]) -> Response:
    """Single policy-enforcement point for every filesystem-exposing route (see
    security.py and SecurityConfig for the full reasoning). Disabled by default:
    with `security.enabled = False`, this only sets an empty current_username
    context."""

# File: src/goeddel/use/app.py Line: 127
async def value_error_handler(request: Request, exc: ValueError) -> Response:

# File: src/goeddel/use/app.py Line: 136
async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException) -> Response:

# File: src/goeddel/use/server.py Line: 12
class ServerArgs:

# File: src/goeddel/use/server.py Line: 19
def parse_args() -> ServerArgs:

# File: src/goeddel/use/server.py Line: 28
def start() -> ?:

# File: src/goeddel/use/i18n.py Line: 333
def get_language(request: Request) -> str:
    "Extracts the language from the request, either via cookie, query param, or Accept-Language."

# File: src/goeddel/use/i18n.py Line: 352
def get_translator(lang: str) -> Callable[(?, str)]:
    "Returns a translation function for the given language."

# File: src/goeddel/use/i18n.py Line: 368
def get_client_translations(lang: str) -> str:
    "Returns a JSON string of translations for the client side."

# File: src/goeddel/use/config.py Line: 19
class RootConfig(BaseModel):
    "Configuration for a single filesystem root folder."

# File: src/goeddel/use/config.py Line: 72
class ZfsConfig(BaseModel):
    "Configuration for global ZFS options and dataset auto-discovery."

# File: src/goeddel/use/config.py Line: 86
class BtrfsConfig(BaseModel):
    "Configuration for global Btrfs options and mountpoint auto-discovery."

# File: src/goeddel/use/config.py Line: 99
class SecurityConfig(BaseModel):
    """Configuration for authenticated access and POSIX ACL enforcement.

    USE has no built-in login of its own: `trusted_user_header` names an HTTP
    header a fronting reverse proxy is trusted to set after authenticating the
    request (e.g. oauth2-proxy's `X-Forwarded-User`, or `Remote-User` from an
    OIDC-aware proxy) -- USE never terminates auth itself. When `enabled` is
    True, every browse/download/diff request is checked against the real POSIX
    ACLs already present on the underlying filesystem (read from the
    `system.posix_acl_access` xattr), using the header's value as the Unix
    username and that user's NSS-resolved group
    membership -- the exact same permission model the filesystem itself already
    enforces for that user elsewhere (e.g. over Samba/NFS), so access here can
    never be wider than what the user could already reach directly.

    Defaults to disabled, matching this project's pre-existing unauthenticated
    behavior -- this is strictly opt-in.

    `impersonate_users` supports running as a standalone instance with no
    fronting auth proxy at all, while still enforcing real POSIX ACLs rather
    than opening everything up: when `enabled` is True but a request carries
    no `trusted_user_header` value, it's normally denied outright (there is no
    identity to check ACLs against). If this list is non-empty instead, the
    request is treated as a *union* of every listed user's identity: a path
    is accessible if ANY of them could read/traverse it as themselves.
    This is deliberately more permissive than any single one of those users,
    so only list users whose combined access is acceptable to expose without
    per-request authentication."""

# File: src/goeddel/use/config.py Line: 137
class AppConfig(BaseModel):
    "Main application configuration."

# File: src/goeddel/use/config.py Line: 147
def load_config(file_path: str, zfs_client: ?, btrfs_client: ?) -> AppConfig:
    "Loads configuration from a YAML file, runs filesystem auto-discovery if enabled, and validates it."

# File: src/goeddel/use/mounts.py Line: 12
class MountInfo:
    "Represents an active mount point on the system."

# File: src/goeddel/use/mounts.py Line: 33
class MountsManager:
    "Discovers and resolves mount point information from /proc/mounts."

# File: src/goeddel/use/security.py Line: 15
class _RootFolderLike(Protocol):
    """Minimal structural stand-in for `models.nodes.RootFolderProtocol` -- this
    file only ever calls `real_path()` on a root_folder, so a full import isn't
    needed (and would create a real, basedpyright-flagged import cycle:
    `models/nodes/base.py`'s `is_accessible` property needs `can_access_child`/
    `get_current_username` from here, imported lazily inside that property
    precisely to avoid it, but `models/nodes/__init__.py` still statically
    re-exports `base.py`, so even a TYPE_CHECKING-only import of the real
    Protocol from `.models.nodes` closes the cycle at the type-checker level).
    Protocols are structural, so any real RootFolder/shadow instance already
    satisfies this without needing to know it exists."""

# File: src/goeddel/use/security.py Line: 114
def get_current_username() -> ?:

# File: src/goeddel/use/security.py Line: 127
def _warn_once(key: str, message: str, *args) -> ?:

# File: src/goeddel/use/security.py Line: 135
def describe_enforcement_gaps() -> list[str]:
    """Returns human-readable reasons POSIX ACL enforcement cannot actually run in
    this process, or an empty list if it can. Meant to be checked once at startup
    when `security.enabled` is True: without this, an operator running a
    misconfigured deployment (eg. on a filesystem without xattr support) would
    only discover that every access check is failing closed (denied) the first
    time a user hits it. This surfaces the root cause immediately instead."""

# File: src/goeddel/use/security.py Line: 156
class AclEntry:
    "A single decoded entry from the `system.posix_acl_access` xattr."

# File: src/goeddel/use/security.py Line: 172
def get_user_groups(username: UserName) -> frozenset[GroupName]:
    """Resolves a user's full group membership (primary + supplementary) via the
    system's NSS configuration."""

# File: src/goeddel/use/security.py Line: 193
def _get_uid(username: UserName) -> ?:
    """Split out from `_check_permission` purely so tests can patch NSS lookups
    without needing real `pwd`/`grp` modules (absent on non-POSIX test runners)."""

# File: src/goeddel/use/security.py Line: 206
def _get_group_name(gid: int) -> ?:
    "Same reasoning as `_get_uid` -- an isolated, easily-patched NSS lookup seam."

# File: src/goeddel/use/security.py Line: 216
def _get_username(uid: int) -> ?:
    "Reverse of `_get_uid`: resolves a numeric uid to a named ACL_USER entry."

# File: src/goeddel/use/security.py Line: 260
def _perm_str(perm_bits: int) -> str:

# File: src/goeddel/use/security.py Line: 264
class AclClient:
    """Reads POSIX ACLs directly from the `system.posix_acl_access` extended
    attribute via `os.getxattr` and unpacks the kernel's binary ACL_EA format
    with `struct`, instead of shelling out to `getfacl` per file."""

# File: src/goeddel/use/security.py Line: 334
def _check_permission(real_path: str, username: UserName, want: Literal[(?, ?)]) -> bool:
    """Replicates the kernel's POSIX.1e ACL access-check algorithm for a specific
    user against a specific path. This is a read-only, out-of-band re-derivation
    of the same permission the filesystem itself would enforce for that user.

    `want` is a single permission character, "r" (read/list) or "x" (traverse)."""

# File: src/goeddel/use/security.py Line: 410
def _normalize_identities(identity: ?) -> tuple[(UserName, ?)]:
    "Normalizes a single username or an impersonation union into a tuple to loop over."

# File: src/goeddel/use/security.py Line: 415
def _run_for_each_identity(identity: ?, decide: Callable[(?, bool)]) -> bool:
    """Runs `decide`: a complete single-user access decision (e.g. a whole
    `_check_permission` call), once per username in an impersonation union,
    granting access if ANY of them would get it as themselves.

    Only fit for a `decide` that makes exactly one such decision. A caller
    that needs to combine two decisions per identity (e.g. traverse-then-read)
    should loop over `_normalize_identities` directly instead: calling this twice
    with two different `decide`s would walk the whole `_can_traverse_chain`
    cache a second time for every candidate, since each call is independent
    and neither can short-circuit the other's per-identity work."""

# File: src/goeddel/use/security.py Line: 431
def can_read_real_path(real_path: str, username: ?) -> bool:
    """Checks read permission on an already-resolved real filesystem path, with no
    root_folder/logical-path involved. For callers that walk real paths directly
    (zip_streamer.py's recursive directory export) rather than going through
    root_folder's node abstraction -- ancestor traversal is not re-checked here,
    since callers using this already reached the starting path via `can_access`."""

# File: src/goeddel/use/security.py Line: 444
def can_traverse_real_path(real_path: str, username: ?) -> bool:
    "Same as `can_read_real_path`, but checks traverse (\"x\") rather than read."

# File: src/goeddel/use/security.py Line: 451
def _ancestor_chain(dir_path: FilePath) -> list[str]:
    "Every directory from the share root (\"\") down to and including `dir_path`."

# File: src/goeddel/use/security.py Line: 463
def _can_traverse_chain(root_folder: _RootFolderLike, dir_path: FilePath, snapshot: Snapshot, username: UserName) -> bool:
    """True if `username` may traverse every directory from the share root down to
    and including `dir_path`: the precondition for reaching anything inside it.

    Raises `FileNotFoundError` instead of returning False when a directory in
    the chain doesn't resolve to a real location. Safe because this loop stops
    at the first ancestor the user can't traverse, so anything that fails to
    resolve below that point already has a parent the user can see. Inside a
    locked region we never reach the resolution attempt at all: the "x" check
    on the locked ancestor denies first.

    Walks the chain top-down, consulting and extending `current_traverse_cache`
    (see there for why the prefix structure, not just memoization, is what makes
    this cheap). Every directory it settles on the way is recorded, so the work
    is done once per directory per request no matter how many paths run through
    it."""

# File: src/goeddel/use/security.py Line: 533
def can_view_metadata(root_folder: _RootFolderLike, child_path: FilePath, snapshot: Snapshot, username: ?) -> bool:
    """Checks whether `child_path`'s metadata (size, mtime, mode, ...) may be shown
    to `username` at all, regardless of whether its content is readable."""

# File: src/goeddel/use/security.py Line: 549
def can_access_child(root_folder: _RootFolderLike, child_path: FilePath, snapshot: Snapshot, username: ?) -> bool:
    """Lighter sibling of `can_access()` used by `FSNode.is_accessible`: checks read
    permission on a single already-listed entry, plus traverse on its immediate
    parent (see `can_view_metadata`): content can't be opened if the path to
    it can't even be resolved, regardless of the file's own read bit.

    Under an impersonation union, traverse and read are evaluated together as
    one decision per candidate username in a single pass (which is why this
    walks the parent chain itself instead of delegating to
    `can_view_metadata`, and doesn't use `_run_for_each_identity`, which only
    fits a single per-identity decision). Otherwise one user who can merely
    traverse the parent plus another who can merely read the file, neither of
    whom can do both, would wrongly combine into access neither actually has."""

# File: src/goeddel/use/security.py Line: 587
def can_access(root_folder: _RootFolderLike, path: FilePath, snapshot: Snapshot, username: ?) -> bool:
    """Full access check for `path` within `root_folder` at `snapshot`: requires
    traverse ("x") permission on every ancestor directory (via
    `_can_traverse_chain`, the same primitive the per-entry checks use), plus
    read ("r") permission on the final target itself. `username` of None means
    ACL enforcement is disabled for this request, eg. when security is disabled.

    Under an impersonation union, traverse and read are evaluated together as
    one decision per candidate username in a single pass, for the same reason
    as `can_access_child`.

    Ancestor real paths are resolved via `root_folder.real_path()` rather than
    manual path-boundary math, so this works identically across the ZFS/Btrfs/
    generic snapshot layouts root_folder already abstracts over."""

# File: src/goeddel/use/utils/path_resolver.py Line: 12
def resolve_root_and_subpath(full_path: str, config: AppConfig) -> tuple[(str, str, RootFolder)]:
    """Resolves the exact RootConfig and relative subpath from a URL path.
    Supports the standard /-/ delimiter separating hierarchical root names from subpaths.
    Example: /list/data/apps/immich/pgData/-/sub/folder -> root='data/apps/immich/pgData', path='sub/folder'
    Also falls back to longest registered prefix match when no /-/ delimiter is present."""

# File: src/goeddel/use/utils/roots_hierarchy.py Line: 13
def build_root_hierarchy(roots_or_configs: ?, root_configs: ?) -> list[RootViewItem]:
    """Organizes roots into a hierarchical tree grouped by filesystem origin:
    - Auto-discovered ZFS datasets grouped by pool (e.g. 'ZFS: tank').
    - Auto-discovered Btrfs subvolumes grouped under 'Btrfs'.
    - Manually configured roots grouped under 'Custom' (Configured Roots).

    Resolves parent-child relationships within each group:
    - ZFS: Hierarchical slash-separated dataset names.
    - Btrfs & Custom: Longest ancestor mountpoint/directory path prefix.

    Returns a topologically sorted list in depth-first order with levels,
    parent references, and group headers."""

# File: src/goeddel/use/utils/ui.py Line: 23
def get_base_template_context(request: Request, root_folder: RootFolder, root_name: RootName, node: FSNode, module: str, path: str="", all_roots: ?, snapshots: ?) -> dict[(str, object)]:
    "Prepares the common template context for explorer, detail, and differ views."

# File: src/goeddel/use/utils/ui.py Line: 71
def get_breadcrumbs(root_folder: RootFolder, root_name: RootName, file: FSNode, snapshots: list[Snapshot], all_roots: list[RootName]) -> BreadcrumbsData:

# File: src/goeddel/use/utils/ui.py Line: 142
def render_error_response(request: Request, status_code: int, message: ?, root_name: ?, path: str="", snapshot_id: ?, is_folder_error: bool, title: ?) -> HTMLResponse:

# File: src/goeddel/use/utils/ui.py Line: 212
def find_nearest_existing_parent(root_folder: RootFolder, path: str, snapshot: ?) -> ?:
    "Finds the closest existing parent directory by walking up the path hierarchy."

# File: src/goeddel/use/routers/api.py Line: 15
def get_snapshot_bars_api(request: Request, full_path: str="", snapshot: ?, attributes: ?) -> dict[(str, object)]:

# File: src/goeddel/use/routers/api.py Line: 29
def get_file_mimetypes_api(request: Request, full_path: str="", snapshot: ?) -> dict[(str, str)]:

# File: src/goeddel/use/routers/api.py Line: 37
def get_snapshot_state_api(request: Request, full_path: str="", snapshot: ?) -> dict[(str, object)]:

# File: src/goeddel/use/routers/api.py Line: 45
async def get_zip_preview_api(request: Request, full_path: str="") -> dict[(str, object)]:
    """Reports what a ZIP export of the given selection would skip due to the
    current user's ACL restrictions, WITHOUT generating the archive: lets the
    frontend warn the user before committing to a download."""

# File: src/goeddel/use/routers/api.py Line: 65
def invalidate_cache_api() -> dict[(str, object)]:

# File: src/goeddel/use/routers/differ.py Line: 20
def get_diff_content(request: Request, full_path: str="", snapshots: ?) -> HTMLResponse:
    "Render the HTML view for comparing snapshots of a file."

# File: src/goeddel/use/routers/differ.py Line: 87
def get_diff_api(request: Request, full_path: str="", snapshots: str="", plugin: str="text-differ") -> dict[(str, object)]:
    "Provide JSON data containing the computed diff for the specified snapshots."

# File: src/goeddel/use/routers/explorer.py Line: 24
def get_favicon() -> FileResponse:

# File: src/goeddel/use/routers/explorer.py Line: 31
def read_root(request: Request) -> HTMLResponse:

# File: src/goeddel/use/routers/explorer.py Line: 50
def get_list_content(request: Request, full_path: str="", snapshot: ?) -> HTMLResponse:

# File: src/goeddel/use/routers/explorer.py Line: 90
def get_detail_content(request: Request, full_path: str="", snapshot: ?) -> HTMLResponse:

# File: src/goeddel/use/routers/explorer.py Line: 141
def download_file(request: Request, full_path: str="", snapshot: ?) -> Response:

# File: src/goeddel/use/routers/explorer.py Line: 170
async def download_zip_archive(request: Request, full_path: str="") -> Response:

# File: src/goeddel/use/routers/explorer.py Line: 274
def get_ajax_content(request: Request, full_path: str="", level: int, snapshot: ?) -> HTMLResponse:

# File: src/goeddel/use/routers/explorer.py Line: 303
def set_language(request: Request, lang_code: str) -> RedirectResponse:

# File: src/goeddel/use/zfs/models.py Line: 8
class ZfsDataset:
    "Represents a ZFS dataset (filesystem or volume)."

# File: src/goeddel/use/zfs/models.py Line: 26
class ZfsSnapshotInfo:
    "Represents a snapshot queried directly from ZFS CLI."

# File: src/goeddel/use/zfs/provider.py Line: 16
class ZfsCliSnapshotProvider:
    """Discovers snapshots directly via OpenZFS CLI (`zfs list -t snapshot`) with exact
    creation timestamps from ZFS metadata. Automatically falls back to FilesystemSnapshotProvider
    if ZFS CLI is not available or the path is not a ZFS dataset."""

# File: src/goeddel/use/zfs/client.py Line: 14
class ZfsClient:
    """Subprocess-based client for executing OpenZFS CLI commands (`zfs list`).
    Communicates directly with the host kernel driver via `/dev/zfs`."""

# File: src/goeddel/use/btrfs/models.py Line: 8
class BtrfsSubvolume:
    "Represents metadata for a Btrfs subvolume or snapshot."

# File: src/goeddel/use/btrfs/provider.py Line: 23
class BtrfsSnapshotProvider:
    """Discovers Btrfs snapshots. Supports both Snapper directory layouts
    (<snapshot_dir>/<num>/snapshot + info.xml) and flat snapshot directory structures.
    Extracts timestamps from info.xml, btrfs CLI metadata, directory stat timestamps,
    or configured filename patterns."""

# File: src/goeddel/use/btrfs/client.py Line: 15
class BtrfsMountInfo(TypedDict):

# File: src/goeddel/use/btrfs/client.py Line: 21
class BtrfsClient:
    "Wrapper around the btrfs CLI commands."

# File: src/goeddel/use/providers/zfs.py Line: 15
class ZfsProvider(FilesystemProvider):

# File: src/goeddel/use/providers/btrfs.py Line: 15
class BtrfsProvider(FilesystemProvider):

# File: src/goeddel/use/providers/generic.py Line: 14
class GenericProvider(FilesystemProvider):

# File: src/goeddel/use/providers/base.py Line: 14
class FilesystemProvider:
    "Abstract base class for all filesystem providers."

# File: src/goeddel/use/providers/base.py Line: 44
class ProviderRegistry:
    "Registry to manage and discover filesystem providers."

# File: src/goeddel/use/models/snapshot.py Line: 7
class Snapshot:

# File: src/goeddel/use/models/snapshot.py Line: 50
class OriginalSnapshot(Snapshot):
    """A special version of a snapshot which indicates no snapshot at all
    but instead the original filesystem."""

# File: src/goeddel/use/models/folder.py Line: 18
class Folder(FSNode):
    "Represents a directory in the filesystem."

# File: src/goeddel/use/models/types.py Line: 33
class SnapshotBarItem(TypedDict):

# File: src/goeddel/use/models/types.py Line: 39
class BreadcrumbPath(TypedDict):

# File: src/goeddel/use/models/types.py Line: 49
class BreadcrumbsData(TypedDict):

# File: src/goeddel/use/models/types.py Line: 58
class RootViewItem(TypedDict):

# File: src/goeddel/use/models/diff.py Line: 13
class DiffLine:
    "Represents a single line within a text diff."

# File: src/goeddel/use/models/diff.py Line: 26
class FileDiffResult:
    "Represents the complete result of a file diff computation."

# File: src/goeddel/use/models/snapshot_provider.py Line: 13
def compile_snapshot_pattern(pattern: str) -> ?[str]:
    """Compiles a snapshot pattern containing strftime tokens (%Y, %m, %d, %H, %M, %S),
    format placeholders ({year}, {month}, {day}, {hour}, {minute}, {second}, {type}),
    or wildcards (*, ?) into a named-group regex."""

# File: src/goeddel/use/models/snapshot_provider.py Line: 56
def parse_snapshot_timestamp(name: str, compiled_patterns: list[?[str]]) -> ?:
    """Extracts a datetime from snapshot name against a list of compiled pattern regexes.
    Returns None if no pattern matches."""

# File: src/goeddel/use/models/snapshot_provider.py Line: 78
class ISnapshotProvider(Protocol):
    "Protocol for pluggable snapshot discovery (e.g. filesystem-based or direct ZFS CLI)."

# File: src/goeddel/use/models/snapshot_provider.py Line: 95
class FilesystemSnapshotProvider:
    """Discovers snapshots by scanning the .zfs/snapshot directory and extracting
    timestamps via configured filename patterns."""

# File: src/goeddel/use/models/file.py Line: 14
class File(FSNode):
    "Represents a regular file or symlink in the filesystem."

# File: src/goeddel/use/models/root_folder.py Line: 35
class RootFolder:

# File: src/goeddel/use/plugins/diff/text_differ.py Line: 32
class TextDifferPlugin(DiffPlugin):
    "A plugin that provides text file diffing capabilities."

# File: src/goeddel/use/plugins/diff/base.py Line: 9
class DiffPlugin(ABC):
    "Abstract base class for differ plugins."

# File: src/goeddel/use/models/nodes/utils.py Line: 88
def guess_filetype(name: str, mode: ?) -> str:
    "Fast, zero-I/O MIME type determination based on filename, extension, and permissions."

# File: src/goeddel/use/models/nodes/utils.py Line: 108
def get_icon_info(name: str, is_folder: bool, does_exist: bool, is_symlink: bool, symlink_is_broken: bool, symlink_target_is_dir: bool, filetype: ?, mode: ?) -> tuple[(str, str)]:
    "Returns a tuple of (lucide_icon_name, css_color_class) based on file attributes."

# File: src/goeddel/use/models/nodes/base.py Line: 25
class SnapshotVersionDetail:
    "Represents the diff state of a file in a single snapshot relative to its chronological predecessor."

# File: src/goeddel/use/models/nodes/base.py Line: 37
class RootFolderProtocol(Protocol):
    "Structural protocol for root folder interactions needed by nodes."

# File: src/goeddel/use/models/nodes/base.py Line: 79
class FSNode:
    "Base class for all filesystem entries (files, directories, missing paths)."

# File: src/goeddel/use/models/nodes/missing.py Line: 14
class MissingNode(FSNode):
    "Represents a path that does not exist in a given snapshot."

