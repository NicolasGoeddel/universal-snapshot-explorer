from __future__ import annotations

import mimetypes

_EXTRA_EXT_MIMES: dict[str, str] = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".rst": "text/x-rst",
    ".log": "text/plain",
    ".env": "text/plain",
    ".conf": "text/plain",
    ".cfg": "text/plain",
    ".ini": "text/plain",
    ".lock": "text/plain",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".toml": "application/toml",
    ".ts": "application/typescript",
    ".tsx": "application/typescript",
    ".jsx": "text/jsx",
    ".rs": "text/x-rust",
    ".go": "text/x-go",
    ".kt": "text/x-kotlin",
    ".swift": "text/x-swift",
    ".lua": "text/x-lua",
    ".sql": "application/sql",
    ".zst": "application/zstd",
}

_KNOWN_FILENAMES: dict[str, str] = {
    "makefile": "text/x-makefile",
    "dockerfile": "text/x-dockerfile",
    "hosts": "text/plain",
    "fstab": "text/plain",
    "passwd": "text/plain",
    "group": "text/plain",
    "shadow": "text/plain",
    "license": "text/plain",
    "readme": "text/markdown",
    "gemfile": "text/plain",
    "cmakelists.txt": "text/plain",
    ".bashrc": "text/x-shellscript",
    ".zshrc": "text/x-shellscript",
    ".profile": "text/x-shellscript",
    ".gitignore": "text/plain",
}

_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff", ".avif")
_VIDEO_EXTS = (".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".flv", ".m4v")
_AUDIO_EXTS = (".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a", ".wma", ".opus")
_ARCHIVE_EXTS = (".zip", ".tar", ".gz", ".tgz", ".bz2", ".tbz2", ".xz", ".txz", ".7z", ".rar", ".iso", ".zst", ".deb", ".rpm")
_SPREADSHEET_EXTS = (".csv", ".tsv", ".xls", ".xlsx", ".ods")
_CODE_EXTS = (
    ".py",
    ".sh",
    ".bash",
    ".zsh",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".rs",
    ".go",
    ".php",
    ".java",
    ".kt",
    ".swift",
    ".rb",
    ".pl",
    ".lua",
    ".sql",
    ".dockerfile",
)
_CONFIG_EXTS = (".yaml", ".yml", ".json", ".toml", ".ini", ".conf", ".cfg", ".xml", ".env", ".properties")
_DOC_EXTS = (".txt", ".md", ".markdown", ".rst", ".doc", ".docx", ".odt", ".rtf", ".tex", ".log")
_BIN_EXTS = (".bin", ".exe", ".elf", ".so", ".dylib", ".dll", ".o", ".a")


def guess_filetype(name: str, mode: int | None = None) -> str:
    """Fast, zero-I/O MIME type determination based on filename, extension, and permissions."""
    lower_name = name.lower()
    if lower_name in _KNOWN_FILENAMES:
        return _KNOWN_FILENAMES[lower_name]

    for ext, mime in _EXTRA_EXT_MIMES.items():
        if lower_name.endswith(ext):
            return mime

    mime, _ = mimetypes.guess_type(name)
    if mime:
        return mime

    if mode is not None and (mode & 0o111 != 0):
        return "application/x-executable"

    return "application/octet-stream"


def get_icon_info(
    name: str,
    is_folder: bool,
    does_exist: bool,
    is_symlink: bool,
    symlink_is_broken: bool = False,
    symlink_target_is_dir: bool = False,
    filetype: str | None = None,
    mode: int | None = None,
) -> tuple[str, str]:
    """Returns a tuple of (lucide_icon_name, css_color_class) based on file attributes."""
    if not does_exist:
        if is_folder:
            return ("folder-x", "icon-missing")
        return ("file-x", "icon-missing")
    if is_symlink:
        if symlink_is_broken:
            return ("link-2-off", "icon-symlink-broken")
        if symlink_target_is_dir:
            return ("folder-symlink", "icon-symlink-folder")
        return ("link-2", "icon-symlink")
    if is_folder:
        return ("folder", "icon-folder")

    lower_name = name.lower()
    ft = (filetype or guess_filetype(name, mode)).lower()

    # Specific common extensions & MIME types
    if "pdf" in ft or lower_name.endswith(".pdf"):
        return ("file-text", "icon-pdf")

    # Images
    if ft.startswith("image/") or any(lower_name.endswith(ext) for ext in _IMAGE_EXTS):
        return ("image", "icon-image")

    # Video
    if ft.startswith("video/") or any(lower_name.endswith(ext) for ext in _VIDEO_EXTS):
        return ("video", "icon-video")

    # Audio
    if ft.startswith("audio/") or any(lower_name.endswith(ext) for ext in _AUDIO_EXTS):
        return ("music", "icon-audio")

    # Archives
    if "archive" in ft or "tar" in ft or "zip" in ft or "compressed" in ft or any(lower_name.endswith(ext) for ext in _ARCHIVE_EXTS):
        return ("file-archive", "icon-archive")

    # Spreadsheets
    if "spreadsheet" in ft or "csv" in ft or any(lower_name.endswith(ext) for ext in _SPREADSHEET_EXTS):
        return ("file-spreadsheet", "icon-spreadsheet")

    # Source code & scripts
    if (
        "javascript" in ft
        or "typescript" in ft
        or "python" in ft
        or "x-sh" in ft
        or "x-shellscript" in ft
        or "x-c" in ft
        or "html" in ft
        or "css" in ft
        or "xml" in ft
        or "json" in ft
        or "yaml" in ft
        or any(lower_name.endswith(ext) for ext in _CODE_EXTS)
        or lower_name in ("dockerfile", "makefile", "cmakelists.txt", "gemfile")
    ):
        return ("file-code", "icon-code")

    # Configurations
    if "toml" in ft or any(lower_name.endswith(ext) for ext in _CONFIG_EXTS):
        return ("settings", "icon-config")

    # Documents & text
    if ft.startswith("text/") or any(lower_name.endswith(ext) for ext in _DOC_EXTS):
        return ("file-text", "icon-document")

    # Executable / binary / shell
    if "executable" in ft or (mode is not None and (mode & 0o111 != 0)):
        return ("terminal", "icon-executable")

    if any(lower_name.endswith(ext) for ext in _BIN_EXTS):
        return ("binary", "icon-binary")

    return ("file", "icon-generic")
