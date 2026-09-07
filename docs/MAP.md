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

# File: src/goeddel/use/zip_streamer.py Line: 16
class ChunkedZipStreamer:
    """In-memory streaming sink for zipfile.ZipFile.
    Buffers emitted zip bytes and yields them in chunks to a generator,
    enabling low constant RAM footprint and zero disk temporary files."""

# File: src/goeddel/use/zip_streamer.py Line: 52
def deduplicate_paths(paths: list[str]) -> list[str]:
    """Normalizes and deduplicates a list of paths.
    If a parent directory is already present, its children are excluded to prevent duplicate files."""

# File: src/goeddel/use/zip_streamer.py Line: 72
def stream_zip_archive(root_folder: RootFolder, snapshot: ?, paths: list[str], base_folder_path: str="", structure_mode: StructureMode=..., compression: CompressionMode=...) -> Generator[(bytes, ?, ?)]:
    """Generates a streaming ZIP archive from selected paths within a root folder snapshot.
    Yields chunks of bytes directly to the caller."""

# File: src/goeddel/use/differ.py Line: 21
class DiffEngine:
    "Manager and executor for diff plugins."

# File: src/goeddel/use/app.py Line: 27
async def lifespan(app: FastAPI) -> AsyncGenerator[(?, ?)]:

# File: src/goeddel/use/app.py Line: 45
async def value_error_handler(request: Request, exc: ValueError) -> Response:

# File: src/goeddel/use/app.py Line: 54
async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException) -> Response:

# File: src/goeddel/use/server.py Line: 12
class ServerArgs:

# File: src/goeddel/use/server.py Line: 19
def parse_args() -> ServerArgs:

# File: src/goeddel/use/server.py Line: 28
def start() -> ?:

# File: src/goeddel/use/i18n.py Line: 323
def get_language(request: Request) -> str:
    "Extracts the language from the request, either via cookie, query param, or Accept-Language."

# File: src/goeddel/use/i18n.py Line: 342
def get_translator(lang: str) -> Callable[(?, str)]:
    "Returns a translation function for the given language."

# File: src/goeddel/use/i18n.py Line: 358
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
class AppConfig(BaseModel):
    "Main application configuration."

# File: src/goeddel/use/config.py Line: 108
def load_config(file_path: str, zfs_client: ?, btrfs_client: ?) -> AppConfig:
    "Loads configuration from a YAML file, runs filesystem auto-discovery if enabled, and validates it."

# File: src/goeddel/use/mounts.py Line: 12
class MountInfo:
    "Represents an active mount point on the system."

# File: src/goeddel/use/mounts.py Line: 33
class MountsManager:
    "Discovers and resolves mount point information from /proc/mounts."

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

# File: src/goeddel/use/routers/api.py Line: 12
def get_snapshot_bars_api(request: Request, full_path: str="", snapshot: ?, attributes: ?) -> dict[(str, object)]:

# File: src/goeddel/use/routers/api.py Line: 26
def get_file_mimetypes_api(request: Request, full_path: str="", snapshot: ?) -> dict[(str, str)]:

# File: src/goeddel/use/routers/api.py Line: 34
def get_snapshot_state_api(request: Request, full_path: str="", snapshot: ?) -> dict[(str, object)]:

# File: src/goeddel/use/routers/api.py Line: 43
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

# File: src/goeddel/use/routers/explorer.py Line: 129
def download_file(request: Request, full_path: str="", snapshot: ?) -> Response:

# File: src/goeddel/use/routers/explorer.py Line: 158
async def download_zip_archive(request: Request, full_path: str="") -> Response:

# File: src/goeddel/use/routers/explorer.py Line: 262
def get_ajax_content(request: Request, full_path: str="", level: int, snapshot: ?) -> HTMLResponse:

# File: src/goeddel/use/routers/explorer.py Line: 291
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

# File: src/goeddel/use/plugins/diff/text_differ.py Line: 32
class TextDifferPlugin(DiffPlugin):
    "A plugin that provides text file diffing capabilities."

# File: src/goeddel/use/plugins/diff/base.py Line: 9
class DiffPlugin(ABC):
    "Abstract base class for differ plugins."

