from __future__ import annotations

import errno
import os
import struct
import threading
from contextvars import ContextVar
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol, cast

from .logger import logger


class _RootFolderLike(Protocol):
    """
    Minimal structural stand-in for `models.nodes.RootFolderProtocol` -- this
    file only ever calls `real_path()` on a root_folder, so a full import isn't
    needed (and would create a real, basedpyright-flagged import cycle:
    `models/nodes/base.py`'s `is_accessible` property needs `can_access_child`/
    `get_current_username` from here, imported lazily inside that property
    precisely to avoid it, but `models/nodes/__init__.py` still statically
    re-exports `base.py`, so even a TYPE_CHECKING-only import of the real
    Protocol from `.models.nodes` closes the cycle at the type-checker level).
    Protocols are structural, so any real RootFolder/shadow instance already
    satisfies this without needing to know it exists.
    """

    def real_path(self, path: str, snapshot: Any) -> str: ...  # pyright: ignore[reportExplicitAny, reportAny] # deliberately opaque -- see class docstring, this file never inspects `snapshot`


# Used as a type hint only
if TYPE_CHECKING:
    from .models.snapshot import Snapshot
    from .models.types import FilePath, GroupName, UserName

# `grp`/`pwd` are POSIX-only -- absent on Windows. This project only ever runs for
# real inside the Linux Docker image (Dockerfile), but importing them unconditionally
# at module load time would break even just IMPORTING this module (and therefore the
# whole app) on any non-POSIX host, including a contributor's local Windows dev
# machine running the test suite outside Docker. Guarded so the module always loads;
# `get_user_groups`/ownership checks degrade to fail-closed (see `_check_permission`)
# on a platform where they're unavailable, same posture as ACL tooling being missing.
# Bound to None (not a separate boolean flag) so every call site's `is None` check
# lets the type checker narrow `_pwd`/`_grp` themselves, rather than needing it to
# trust an unrelated variable stayed in sync with what actually got imported.
try:
    import grp as _grp
    import pwd as _pwd
except ImportError:
    _grp = None
    _pwd = None

# Populated by the security middleware (app.py) for the lifetime of a single request.
# A ContextVar, not a parameter threaded through every call, because the folder/file
# node construction that needs it (models/folder.py's directory listing) happens many
# layers below the router -- changing every signature in between just to plumb through
# "who is asking" would touch far more of the codebase than the check itself needs.
# This is safe under FastAPI/Starlette: each request runs in its own asyncio Task, and
# sync route handlers are dispatched via `run_in_threadpool`, which copies the current
# context into the worker thread -- concurrent requests never see each other's username.
current_username: ContextVar[UserName | None] = ContextVar("current_username", default=None)

# Set alongside `current_username` by the security middleware, once per request,
# so `_check_permission` doesn't re-resolve the same user's group membership via
# NSS (`grp.getgrall()` parses the entire group database) for every single file
# in a listing -- a large directory previously triggered that lookup thousands
# of times over. `None` (not an empty frozenset) means "not resolved yet for
# this context", so callers outside the middleware (tests, direct `_check_permission`
# use) still fall back to resolving it themselves rather than getting an empty
# group set by mistake.
current_user_groups: ContextVar[frozenset[GroupName] | None] = ContextVar("current_user_groups", default=None)


def get_current_username() -> UserName | None:
    return current_username.get()


# Guards against flooding the log with the same warning on every single request
# once one of the platform-level enforcement gaps below is hit -- these are
# environment-wide conditions (missing NSS modules, no xattr support), not
# per-file transient errors, so one warning per process is enough to alert an
# operator without drowning out everything else.
_warned: set[str] = set()
_warned_lock = threading.Lock()


def _warn_once(key: str, message: str, *args: object) -> None:
    with _warned_lock:
        if key in _warned:
            return
        _warned.add(key)
    logger.warning(message, *args)


def describe_enforcement_gaps() -> list[str]:
    """
    Returns human-readable reasons POSIX ACL enforcement cannot actually run in
    this process, or an empty list if it can. Meant to be checked once at startup
    when `security.enabled` is True: without this, an operator running a
    misconfigured deployment (eg. on a filesystem without xattr support) would
    only discover that every access check is failing closed (denied) the first
    time a user hits it. This surfaces the root cause immediately instead.
    """
    gaps: list[str] = []
    if _pwd is None or _grp is None:
        gaps.append("the `pwd`/`grp` modules are unavailable on this platform, so user/group lookups cannot be performed")
    if not _acl_client.is_available():
        gaps.append("extended attributes are unavailable on this platform (`os.getxattr` is missing), so ACLs cannot be read")
    return gaps


@dataclass(frozen=True)
class AclEntry:
    """A single decoded entry from the `system.posix_acl_access` xattr."""

    tag: str  # "user_obj", "group_obj", "mask", "other", "user", "group"
    qualifier: str | None  # username/groupname for named "user"/"group" entries
    perm: str  # e.g. "rwx", "r-x", "---"

    @property
    def read(self) -> bool:
        return "r" in self.perm

    @property
    def execute(self) -> bool:
        return "x" in self.perm


def get_user_groups(username: UserName) -> frozenset[GroupName]:
    """
    Resolves a user's full group membership (primary + supplementary) via the
    system's NSS configuration.
    """
    if _pwd is None or _grp is None:
        return frozenset()

    try:
        pw = _pwd.getpwnam(username)
    except KeyError:
        return frozenset()

    names = {g.gr_name for g in _grp.getgrall() if username in g.gr_mem}
    try:
        names.add(_grp.getgrgid(pw.pw_gid).gr_name)
    except KeyError:
        pass
    return frozenset(names)


def _get_uid(username: UserName) -> int | None:
    """
    Split out from `_check_permission` purely so tests can patch NSS lookups
    without needing real `pwd`/`grp` modules (absent on non-POSIX test runners).
    """
    if _pwd is None:
        return None
    try:
        return _pwd.getpwnam(username).pw_uid
    except KeyError:
        return None


def _get_group_name(gid: int) -> GroupName | None:
    """Same reasoning as `_get_uid` -- an isolated, easily-patched NSS lookup seam."""
    if _grp is None:
        return None
    try:
        return _grp.getgrgid(gid).gr_name
    except KeyError:
        return None


def _get_username(uid: int) -> UserName | None:
    """Reverse of `_get_uid`: resolves a numeric uid to a named ACL_USER entry."""
    if _pwd is None:
        return None
    try:
        return _pwd.getpwuid(uid).pw_name
    except KeyError:
        return None


# Tag values from the kernel's ACL_EA binary format (uapi/linux/posix_acl.h).
_ACL_TAG_USER_OBJ = 0x01
_ACL_TAG_USER = 0x02
_ACL_TAG_GROUP_OBJ = 0x04
_ACL_TAG_GROUP = 0x08
_ACL_TAG_MASK = 0x10
_ACL_TAG_OTHER = 0x20

_ACL_TAG_NAMES = {
    _ACL_TAG_USER_OBJ: "user_obj",
    _ACL_TAG_USER: "user",
    _ACL_TAG_GROUP_OBJ: "group_obj",
    _ACL_TAG_GROUP: "group",
    _ACL_TAG_MASK: "mask",
    _ACL_TAG_OTHER: "other",
}

_ACL_EA_VERSION = 0x0002

# `struct posix_acl_xattr_header { __le32 a_version; }`
_HEADER_STRUCT = struct.Struct("<I")
# `struct posix_acl_xattr_entry { __le16 e_tag; __le16 e_perm; __le32 e_id; }`
_ENTRY_STRUCT = struct.Struct("<HHI")

# Errno values `os.getxattr` raises when a path simply has no extended ACL set
# (the common case -- plain mode bits only) or the filesystem doesn't support
# xattrs at all. Not an error: `_entries_from_mode` synthesizes the equivalent
# base ACL entries from `st_mode`, same as `getfacl -p` used to report for a
# file without a real ACL.
_NO_EXTENDED_ACL_ERRNOS = frozenset(
    e
    for e in (errno.ENODATA, getattr(errno, "ENOATTR", None), errno.ENOTSUP, getattr(errno, "EOPNOTSUPP", None), errno.ENOSYS)
    if e is not None
)


def _perm_str(perm_bits: int) -> str:
    return f"{'r' if perm_bits & 0x4 else '-'}{'w' if perm_bits & 0x2 else '-'}{'x' if perm_bits & 0x1 else '-'}"


class AclClient:
    """
    Reads POSIX ACLs directly from the `system.posix_acl_access` extended
    attribute via `os.getxattr` and unpacks the kernel's binary ACL_EA format
    with `struct`, instead of shelling out to `getfacl` per file.
    """

    def is_available(self) -> bool:
        return hasattr(os, "getxattr")

    def get_acl_entries(self, real_path: str) -> list[AclEntry] | None:
        """Returns the parsed ACL entries for a path, or None if unreadable/unavailable."""
        if not self.is_available():
            return None
        try:
            raw = os.getxattr(real_path, "system.posix_acl_access")
        except OSError as exc:
            if exc.errno in _NO_EXTENDED_ACL_ERRNOS:
                return self._entries_from_mode(real_path)
            logger.exception("Error reading ACL xattr for '%s'", real_path)
            return None

        try:
            return self._parse(raw)
        except struct.error:
            logger.exception("Malformed POSIX ACL xattr for '%s'", real_path)
            return None

    @staticmethod
    def _entries_from_mode(real_path: str) -> list[AclEntry] | None:
        """
        Synthesizes the base user/group/other ACL entries from plain `st_mode`
        bits, for the common case of a file with no extended ACL set.
        """
        try:
            mode = os.stat(real_path).st_mode
        except OSError:
            return None
        return [
            AclEntry(tag="user_obj", qualifier=None, perm=_perm_str((mode >> 6) & 0o7)),
            AclEntry(tag="group_obj", qualifier=None, perm=_perm_str((mode >> 3) & 0o7)),
            AclEntry(tag="other", qualifier=None, perm=_perm_str(mode & 0o7)),
        ]

    @staticmethod
    def _parse(raw: bytes) -> list[AclEntry]:
        version: int = cast(int, _HEADER_STRUCT.unpack_from(raw, 0)[0])
        if version != _ACL_EA_VERSION:
            raise struct.error(f"unsupported POSIX ACL xattr version {version}")

        entries: list[AclEntry] = []
        offset = _HEADER_STRUCT.size
        while offset + _ENTRY_STRUCT.size <= len(raw):
            tag, perm, entry_id = cast(tuple[int, int, int], _ENTRY_STRUCT.unpack_from(raw, offset))
            offset += _ENTRY_STRUCT.size
            name = _ACL_TAG_NAMES.get(tag)
            if name is None:
                continue
            qualifier: str | None = None
            if name == "user":
                qualifier = _get_username(entry_id)
            elif name == "group":
                qualifier = _get_group_name(entry_id)
            entries.append(AclEntry(tag=name, qualifier=qualifier, perm=_perm_str(perm)))
        return entries


_acl_client = AclClient()


def _check_permission(real_path: str, username: UserName, want: str) -> bool:
    """
    Replicates the kernel's POSIX.1e ACL access-check algorithm for a specific
    user against a specific path. This is a read-only, out-of-band re-derivation
    of the same permission the filesystem itself would enforce for that user.

    `want` is a single permission character, "r" (read/list) or "x" (traverse).
    """
    entries = _acl_client.get_acl_entries(real_path)
    if entries is None:
        if not _acl_client.is_available():
            _warn_once(
                "no_xattr_support",
                "Security is enabled, but extended attributes are unavailable on this platform (`os.getxattr` is missing) -- POSIX ACLs cannot be read. Denying access (fail closed) until this is fixed.",  # noqa: E501
            )
        else:
            # This specific path was unreadable/malformed (already logged by
            # AclClient.get_acl_entries with the underlying reason).
            logger.warning("Could not determine the ACL for '%s' -- denying access (fail closed).", real_path)
        return False

    try:
        st = os.stat(real_path)
    except OSError:
        logger.warning("Could not stat '%s' to check ownership -- denying access (fail closed).", real_path)
        return False

    named_user = {e.qualifier: e for e in entries if e.tag == "user" and e.qualifier is not None}
    named_group = {e.qualifier: e for e in entries if e.tag == "group" and e.qualifier is not None}
    base = {e.tag: e for e in entries if e.tag in ("user_obj", "group_obj", "mask", "other")}

    if _pwd is None or _grp is None:
        _warn_once(
            "no_nss_support",
            "Security is enabled, but the `pwd`/`grp` modules are unavailable on this platform -- user/group lookups cannot be performed. Denying access (fail closed) until this is fixed.",  # noqa: E501
        )
        return False

    # A named user entry (POSIX ACL_USER) always wins, same precedence as the kernel.
    if username in named_user:
        return want in named_user[username].perm

    uid = _get_uid(username)
    if uid is not None and uid == st.st_uid:
        owner_entry = base.get("user_obj")
        return owner_entry is not None and want in owner_entry.perm

    # If the cache hasn't been populated for this request, heal it (shouldn't
    # happen since it's filled by the middleware, but here just in case).
    groups = current_user_groups.get()
    if groups is None:
        groups = get_user_groups(username)
    matching = [e for name, e in named_group.items() if name in groups]

    file_group = _get_group_name(st.st_gid)
    if file_group is not None and file_group in groups:
        group_obj_entry = base.get("group_obj")
        if group_obj_entry is not None:
            matching.append(group_obj_entry)

    if matching:
        # POSIX ACL semantics: when multiple group entries match, the effective
        # permission is the UNION of their bits, then capped by the ACL mask
        # entry if one is present (the mask limits every group/named-user entry
        # together, not just one of them).
        union = any(want in e.perm for e in matching)
        mask_entry = base.get("mask")
        if mask_entry is not None:
            return union and want in mask_entry.perm
        return union

    other_entry = base.get("other")
    return other_entry is not None and want in other_entry.perm


def can_read_real_path(real_path: str, username: UserName | None) -> bool:
    """
    Checks read permission on an already-resolved real filesystem path, with no
    root_folder/logical-path involved. For callers that walk real paths directly
    (zip_streamer.py's recursive directory export) rather than going through
    root_folder's node abstraction -- ancestor traversal is not re-checked here,
    since callers using this already reached the starting path via `can_access`.
    """
    if username is None:
        return True
    return _check_permission(real_path, username, "r")


def can_traverse_real_path(real_path: str, username: UserName | None) -> bool:
    """Same as `can_read_real_path`, but checks traverse ("x") rather than read."""
    if username is None:
        return True
    return _check_permission(real_path, username, "x")


def can_access_child(
    root_folder: _RootFolderLike,
    child_path: FilePath,
    snapshot: Snapshot,
    username: UserName | None,
) -> bool:
    """
    Lighter sibling of `can_access()` used by `FSNode.is_accessible`: checks read
    permission on a single already-listed entry, without re-walking the ancestor
    chain. Safe because every route that renders a folder listing is
    itself one of the security middleware's protected prefixes, so the parent's
    own traversal permission was already confirmed before any child of it is
    ever displayed.
    """
    if username is None:
        return True
    try:
        real_path = root_folder.real_path(child_path, snapshot)
    except Exception:
        logger.warning("Could not resolve real path for '%s' -- denying access (fail closed).", child_path)
        return False
    return _check_permission(real_path, username, "r")


def can_access(
    root_folder: _RootFolderLike,
    path: FilePath,
    snapshot: Snapshot,
    username: UserName | None,
) -> bool:
    """
    Full access check for `path` within `root_folder` at `snapshot`: requires
    traverse ("x") permission on every ancestor directory, plus read ("r")
    permission on the final target itself. `username` of None means ACL
    enforcement is disabled for this request, eg. when security is disabled.

    Ancestor real paths are resolved via `root_folder.real_path()` rather than
    manual path-boundary math, so this works identically across the ZFS/Btrfs/
    generic snapshot layouts root_folder already abstracts over.
    """
    if username is None:
        return True

    parts = [p for p in path.strip("/").split("/") if p]
    accumulated = ""
    for part in parts[:-1]:
        accumulated = os.path.join(accumulated, part) if accumulated else part
        try:
            ancestor_real = root_folder.real_path(accumulated, snapshot)
        except Exception:
            # Can't resolve this ancestor -- deny rather than risk masking a
            # denied path as a 404, since security is enabled for this request.
            logger.warning("Could not resolve real path for ancestor '%s' -- denying access (fail closed).", accumulated)
            return False
        if not _check_permission(ancestor_real, username, "x"):
            return False

    try:
        target_real = root_folder.real_path(path, snapshot)
    except Exception:
        logger.warning("Could not resolve real path for '%s' -- denying access (fail closed).", path)
        return False
    return _check_permission(target_real, username, "r")
