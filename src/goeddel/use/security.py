from __future__ import annotations

import os
import shutil
import subprocess
from contextvars import ContextVar
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

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
# `get_user_groups`/ownership checks degrade to fail-open (see their own docstrings)
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


def get_current_username() -> UserName | None:
    return current_username.get()


@dataclass(frozen=True)
class AclEntry:
    """A single parsed line from `getfacl -p` output."""

    tag: str  # "user_obj", "group_obj", "mask", "other", "user", "group"
    qualifier: str | None  # username/groupname for named "user"/"group" entries
    perm: str  # e.g. "rwx", "r-x", "---"

    @property
    def read(self) -> bool:
        return "r" in self.perm

    @property
    def execute(self) -> bool:
        return "x" in self.perm


class AclClient:
    """
    Subprocess-based client for reading POSIX ACLs via `getfacl`, mirroring this
    project's existing ZfsClient/BtrfsClient convention of shelling out to the
    standard CLI tool rather than binding against a C library. `pylibacl` has no
    prebuilt wheels (would require adding a compiler toolchain to the Docker image
    just to read a handful of permission bits per request), and `getfacl -p` already
    reports both extended ACL entries and plain mode bits through the exact same
    text format, so no separate fallback path is needed for files without a real ACL.
    """

    def __init__(self, executable: str = "getfacl") -> None:
        self._executable: str = executable
        self._is_available_cache: bool | None = None

    def is_available(self) -> bool:
        if self._is_available_cache is not None:
            return self._is_available_cache
        self._is_available_cache = shutil.which(self._executable) is not None
        return self._is_available_cache

    def get_acl_entries(self, real_path: str) -> list[AclEntry] | None:
        """Returns the parsed ACL entries for a path, or None if unreadable/unavailable."""
        if not self.is_available():
            return None
        try:
            res = subprocess.run(
                [self._executable, "-p", "--", real_path],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
        except OSError, subprocess.SubprocessError:
            logger.exception("Error reading ACL for '%s'", real_path)
            return None

        if res.returncode != 0:
            return None

        return self._parse(res.stdout)

    @staticmethod
    def _parse(getfacl_output: str) -> list[AclEntry]:
        entries: list[AclEntry] = []
        for line in getfacl_output.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(":")
            if len(parts) < 3:
                continue
            tag, qualifier, perm = parts[0], parts[1], parts[2]
            if tag == "user" and not qualifier:
                entries.append(AclEntry(tag="user_obj", qualifier=None, perm=perm))
            elif tag == "group" and not qualifier:
                entries.append(AclEntry(tag="group_obj", qualifier=None, perm=perm))
            elif tag in ("user", "group"):
                entries.append(AclEntry(tag=tag, qualifier=qualifier, perm=perm))
            elif tag in ("mask", "other"):
                entries.append(AclEntry(tag=tag, qualifier=None, perm=perm))
        return entries


_acl_client = AclClient()


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


def _check_permission(real_path: str, username: UserName, want: str) -> bool:
    """
    Replicates the kernel's POSIX.1e ACL access-check algorithm for a specific
    user against a specific path. This is a read-only, out-of-band re-derivation
    of the same permission the filesystem itself would enforce for that user.

    `want` is a single permission character, "r" (read/list) or "x" (traverse).
    """
    entries = _acl_client.get_acl_entries(real_path)
    if entries is None:
        # No ACL support / tool unavailable / path unreadable by the app's own
        # process -- fail open rather than break browsing entirely for
        # deployments that haven't opted into POSIX ACLs.
        return True

    try:
        st = os.stat(real_path)
    except OSError:
        return True

    named_user = {e.qualifier: e for e in entries if e.tag == "user" and e.qualifier is not None}
    named_group = {e.qualifier: e for e in entries if e.tag == "group" and e.qualifier is not None}
    base = {e.tag: e for e in entries if e.tag in ("user_obj", "group_obj", "mask", "other")}

    if _pwd is None or _grp is None:
        return True

    # A named user entry (POSIX ACL_USER) always wins, same precedence as the kernel.
    if username in named_user:
        return want in named_user[username].perm

    uid = _get_uid(username)
    if uid is not None and uid == st.st_uid:
        owner_entry = base.get("user_obj")
        return owner_entry is not None and want in owner_entry.perm

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
        return True
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
            # Can't resolve this ancestor -> let normal 404 handling take over
            # rather than mask it as an access-denied.
            return True
        if not _check_permission(ancestor_real, username, "x"):
            return False

    try:
        target_real = root_folder.real_path(path, snapshot)
    except Exception:
        return True
    return _check_permission(target_real, username, "r")
