# File: src/goeddel/use/logger.py Line: 10
def setup_logging(level: ?) -> ?:

# File: src/goeddel/use/dependencies.py Line: 21
def get_base_url(request: Request) -> str:

# File: src/goeddel/use/dependencies.py Line: 29
def quote_path_filter(path: str) -> str:

# File: src/goeddel/use/dependencies.py Line: 33
def render_lucide(name: str, **kwargs) -> str:

# File: src/goeddel/use/dependencies.py Line: 40
def static_url(path: str) -> str:

# File: src/goeddel/use/dependencies.py Line: 49
def make_route_url(module: str, root_name: str, sub_path: str="", snapshot: ?) -> str:

# File: src/goeddel/use/dependencies.py Line: 72
def get_app_config(request: Request) -> AppConfig:

# File: src/goeddel/use/enums.py Line: 6
class FilesystemType(StrEnum):

# File: src/goeddel/use/enums.py Line: 15
class ProviderType(StrEnum):

# File: src/goeddel/use/enums.py Line: 23
class RootGroupType(StrEnum):

# File: src/goeddel/use/enums.py Line: 32
class StructureMode(StrEnum):

# File: src/goeddel/use/enums.py Line: 40
class CompressionMode(StrEnum):

# File: src/goeddel/use/enums.py Line: 47
class ChangedAttribute(StrEnum):

# File: src/goeddel/use/enums.py Line: 60
class LogLevel(StrEnum):

# File: src/goeddel/use/enums.py Line: 70
class Language(StrEnum):

# File: src/goeddel/use/enums.py Line: 78
class DiffLineType(StrEnum):

# File: src/goeddel/use/zip_streamer.py Line: 17
class ChunkedZipStreamer:

# File: src/goeddel/use/zip_streamer.py Line: 53
def deduplicate_paths(paths: list[str]) -> list[str]:

# File: src/goeddel/use/zip_streamer.py Line: 73
def resolve_zip_selection(root_folder: RootFolder, snapshot: ?, paths: list[str]) -> tuple[(list[tuple[(str, str)]], list[str], list[str])]:

# File: src/goeddel/use/zip_streamer.py Line: 153
def stream_zip_archive(root_folder: RootFolder, snapshot: ?, paths: list[str], base_folder_path: str="", structure_mode: StructureMode=..., compression: CompressionMode=...) -> Generator[(bytes, ?, ?)]:

# File: src/goeddel/use/differ.py Line: 21
class DiffEngine:

# File: src/goeddel/use/app.py Line: 49
async def lifespan(app: FastAPI) -> AsyncGenerator[(?, ?)]:

# File: src/goeddel/use/app.py Line: 70
async def security_middleware(request: Request, call_next: Callable[(?, Awaitable[Response])]) -> Response:

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

# File: src/goeddel/use/i18n.py Line: 549
def _parse_accept_language(accept_language: str) -> list[str]:

# File: src/goeddel/use/i18n.py Line: 580
def get_language(request: Request) -> str:

# File: src/goeddel/use/i18n.py Line: 599
def get_translator(lang: str) -> Callable[(?, str)]:

# File: src/goeddel/use/i18n.py Line: 615
def get_client_translations(lang: str) -> str:

# File: src/goeddel/use/config.py Line: 19
class RootConfig(BaseModel):

# File: src/goeddel/use/config.py Line: 72
class ZfsConfig(BaseModel):

# File: src/goeddel/use/config.py Line: 86
class BtrfsConfig(BaseModel):

# File: src/goeddel/use/config.py Line: 99
class SecurityConfig(BaseModel):

# File: src/goeddel/use/config.py Line: 137
class AppConfig(BaseModel):

# File: src/goeddel/use/config.py Line: 147
def load_config(file_path: str, zfs_client: ?, btrfs_client: ?) -> AppConfig:

# File: src/goeddel/use/mounts.py Line: 12
class MountInfo:

# File: src/goeddel/use/mounts.py Line: 33
class MountsManager:

# File: src/goeddel/use/security.py Line: 15
class _RootFolderLike(Protocol):

# File: src/goeddel/use/security.py Line: 114
def get_current_username() -> ?:

# File: src/goeddel/use/security.py Line: 127
def _warn_once(key: str, message: str, *args) -> ?:

# File: src/goeddel/use/security.py Line: 135
def describe_enforcement_gaps() -> list[str]:

# File: src/goeddel/use/security.py Line: 156
class AclEntry:

# File: src/goeddel/use/security.py Line: 172
def get_user_groups(username: UserName) -> frozenset[GroupName]:

# File: src/goeddel/use/security.py Line: 193
def _get_uid(username: UserName) -> ?:

# File: src/goeddel/use/security.py Line: 206
def _get_group_name(gid: int) -> ?:

# File: src/goeddel/use/security.py Line: 216
def _get_username(uid: int) -> ?:

# File: src/goeddel/use/security.py Line: 260
def _perm_str(perm_bits: int) -> str:

# File: src/goeddel/use/security.py Line: 264
class AclClient:

# File: src/goeddel/use/security.py Line: 334
def _check_permission(real_path: str, username: UserName, want: Literal[(?, ?)]) -> bool:

# File: src/goeddel/use/security.py Line: 410
def _normalize_identities(identity: ?) -> tuple[(UserName, ?)]:

# File: src/goeddel/use/security.py Line: 415
def _run_for_each_identity(identity: ?, decide: Callable[(?, bool)]) -> bool:

# File: src/goeddel/use/security.py Line: 431
def can_read_real_path(real_path: str, username: ?) -> bool:

# File: src/goeddel/use/security.py Line: 444
def can_traverse_real_path(real_path: str, username: ?) -> bool:

# File: src/goeddel/use/security.py Line: 451
def _ancestor_chain(dir_path: FilePath) -> list[str]:

# File: src/goeddel/use/security.py Line: 463
def _can_traverse_chain(root_folder: _RootFolderLike, dir_path: FilePath, snapshot: Snapshot, username: UserName) -> bool:

# File: src/goeddel/use/security.py Line: 533
def can_view_metadata(root_folder: _RootFolderLike, child_path: FilePath, snapshot: Snapshot, username: ?) -> bool:

# File: src/goeddel/use/security.py Line: 549
def can_access_child(root_folder: _RootFolderLike, child_path: FilePath, snapshot: Snapshot, username: ?) -> bool:

# File: src/goeddel/use/security.py Line: 587
def can_access(root_folder: _RootFolderLike, path: FilePath, snapshot: Snapshot, username: ?) -> bool:

# File: src/goeddel/use/utils/path_resolver.py Line: 12
def resolve_root_and_subpath(full_path: str, config: AppConfig) -> tuple[(str, str, RootFolder)]:

# File: src/goeddel/use/utils/roots_hierarchy.py Line: 13
def build_root_hierarchy(roots_or_configs: ?, root_configs: ?) -> list[RootViewItem]:

# File: src/goeddel/use/utils/ui.py Line: 23
def get_base_template_context(request: Request, root_folder: RootFolder, root_name: RootName, node: FSNode, module: str, path: str="", all_roots: ?, snapshots: ?) -> dict[(str, object)]:

# File: src/goeddel/use/utils/ui.py Line: 71
def get_breadcrumbs(root_folder: RootFolder, root_name: RootName, file: FSNode, snapshots: list[Snapshot], all_roots: list[RootName]) -> BreadcrumbsData:

# File: src/goeddel/use/utils/ui.py Line: 142
def render_error_response(request: Request, status_code: int, message: ?, root_name: ?, path: str="", snapshot_id: ?, is_folder_error: bool, title: ?) -> HTMLResponse:

# File: src/goeddel/use/utils/ui.py Line: 212
def find_nearest_existing_parent(root_folder: RootFolder, path: str, snapshot: ?) -> ?:

# File: src/goeddel/use/routers/api.py Line: 16
def get_snapshot_bars_api(request: Request, full_path: str="", snapshot: ?, attributes: ?) -> dict[(str, object)]:

# File: src/goeddel/use/routers/api.py Line: 30
def get_file_mimetypes_api(request: Request, full_path: str="", snapshot: ?) -> dict[(str, str)]:

# File: src/goeddel/use/routers/api.py Line: 38
def get_snapshot_state_api(request: Request, full_path: str="", snapshot: ?) -> SnapshotStateResponse:

# File: src/goeddel/use/routers/api.py Line: 52
async def get_zip_preview_api(request: Request, full_path: str="") -> dict[(str, object)]:

# File: src/goeddel/use/routers/api.py Line: 72
def invalidate_cache_api() -> dict[(str, object)]:

# File: src/goeddel/use/routers/differ.py Line: 21
def get_diff_content(request: Request, full_path: str="", snapshots: ?) -> HTMLResponse:

# File: src/goeddel/use/routers/differ.py Line: 88
def get_diff_timeline_segments(request: Request, full_path: str="", attributes: ?) -> HTMLResponse:

# File: src/goeddel/use/routers/differ.py Line: 116
def get_diff_api(request: Request, full_path: str="", snapshots: str="", plugin: str="text-differ") -> dict[(str, object)]:

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

# File: src/goeddel/use/zfs/models.py Line: 26
class ZfsSnapshotInfo:

# File: src/goeddel/use/zfs/provider.py Line: 16
class ZfsCliSnapshotProvider:

# File: src/goeddel/use/zfs/client.py Line: 14
class ZfsClient:

# File: src/goeddel/use/btrfs/models.py Line: 8
class BtrfsSubvolume:

# File: src/goeddel/use/btrfs/provider.py Line: 23
class BtrfsSnapshotProvider:

# File: src/goeddel/use/btrfs/client.py Line: 15
class BtrfsMountInfo(TypedDict):

# File: src/goeddel/use/btrfs/client.py Line: 21
class BtrfsClient:

# File: src/goeddel/use/providers/zfs.py Line: 15
class ZfsProvider(FilesystemProvider):

# File: src/goeddel/use/providers/btrfs.py Line: 15
class BtrfsProvider(FilesystemProvider):

# File: src/goeddel/use/providers/generic.py Line: 14
class GenericProvider(FilesystemProvider):

# File: src/goeddel/use/providers/base.py Line: 14
class FilesystemProvider:

# File: src/goeddel/use/providers/base.py Line: 44
class ProviderRegistry:

# File: src/goeddel/use/models/snapshot.py Line: 7
class Snapshot:

# File: src/goeddel/use/models/snapshot.py Line: 50
class OriginalSnapshot(Snapshot):

# File: src/goeddel/use/models/folder.py Line: 18
class Folder(FSNode):

# File: src/goeddel/use/models/types.py Line: 33
class SnapshotBarItem(TypedDict):

# File: src/goeddel/use/models/types.py Line: 39
class BreadcrumbPath(TypedDict):

# File: src/goeddel/use/models/types.py Line: 49
class BreadcrumbsData(TypedDict):

# File: src/goeddel/use/models/types.py Line: 58
class SnapshotStateInfo(TypedDict):

# File: src/goeddel/use/models/types.py Line: 65
class SymlinkInfo(TypedDict, total=...):

# File: src/goeddel/use/models/types.py Line: 78
class SnapshotStateEntry(SymlinkInfo):

# File: src/goeddel/use/models/types.py Line: 105
class SnapshotStateResponse(TypedDict):

# File: src/goeddel/use/models/types.py Line: 111
class RootViewItem(TypedDict):

# File: src/goeddel/use/models/diff.py Line: 13
class DiffLine:

# File: src/goeddel/use/models/diff.py Line: 26
class FileDiffResult:

# File: src/goeddel/use/models/snapshot_provider.py Line: 13
def compile_snapshot_pattern(pattern: str) -> ?[str]:

# File: src/goeddel/use/models/snapshot_provider.py Line: 56
def parse_snapshot_timestamp(name: str, compiled_patterns: list[?[str]]) -> ?:

# File: src/goeddel/use/models/snapshot_provider.py Line: 78
class ISnapshotProvider(Protocol):

# File: src/goeddel/use/models/snapshot_provider.py Line: 95
class FilesystemSnapshotProvider:

# File: src/goeddel/use/models/file.py Line: 14
class File(FSNode):

# File: src/goeddel/use/models/root_folder.py Line: 37
class RootFolder:

# File: src/goeddel/use/models/nodes/utils.py Line: 88
def guess_filetype(name: str, mode: ?) -> str:

# File: src/goeddel/use/models/nodes/utils.py Line: 108
def get_icon_info(name: str, is_folder: bool, does_exist: bool, is_symlink: bool, symlink_is_broken: bool, symlink_target_is_dir: bool, filetype: ?, mode: ?) -> tuple[(str, str)]:

# File: src/goeddel/use/models/nodes/base.py Line: 26
class SnapshotVersionDetail:

# File: src/goeddel/use/models/nodes/base.py Line: 38
class RootFolderProtocol(Protocol):

# File: src/goeddel/use/models/nodes/base.py Line: 80
class FSNode:

# File: src/goeddel/use/models/nodes/missing.py Line: 14
class MissingNode(FSNode):

# File: src/goeddel/use/plugins/diff/text_differ.py Line: 32
class TextDifferPlugin(DiffPlugin):

# File: src/goeddel/use/plugins/diff/base.py Line: 9
class DiffPlugin(ABC):

