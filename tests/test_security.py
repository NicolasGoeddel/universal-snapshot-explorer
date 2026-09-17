from __future__ import annotations

import os
import struct
import tempfile
import unittest
from typing import override
from unittest.mock import patch

from goeddel.use import security
from goeddel.use.app import app
from goeddel.use.config import AppConfig, RootConfig, SecurityConfig
from goeddel.use.models.root_folder import RootFolder


def _acl_xattr(*entries: tuple[int, int, int]) -> bytes:
    """
    Builds a raw `system.posix_acl_access` xattr blob, in the kernel's binary
    ACL_EA format, from `(tag, perm_bits, id)` triples.
    """
    header = struct.pack("<I", 0x0002)
    body = b"".join(struct.pack("<HHI", tag, perm, entry_id) for tag, perm, entry_id in entries)
    return header + body


_UNDEFINED_ID = 0xFFFFFFFF


class TestAclParsing(unittest.TestCase):
    def test_parses_plain_mode_bits(self) -> None:
        raw = _acl_xattr(
            (security._ACL_TAG_USER_OBJ, 0o7, _UNDEFINED_ID),
            (security._ACL_TAG_GROUP_OBJ, 0o5, _UNDEFINED_ID),
            (security._ACL_TAG_OTHER, 0o0, _UNDEFINED_ID),
        )
        entries = security.AclClient._parse(raw)
        tags = {e.tag: e for e in entries}
        self.assertEqual(set(tags), {"user_obj", "group_obj", "other"})
        self.assertTrue(tags["user_obj"].read)
        self.assertFalse(tags["other"].read)

    def test_parses_named_group_entries(self) -> None:
        raw = _acl_xattr(
            (security._ACL_TAG_USER_OBJ, 0o7, _UNDEFINED_ID),
            (security._ACL_TAG_GROUP_OBJ, 0o5, _UNDEFINED_ID),
            (security._ACL_TAG_GROUP, 0o7, 1000),
            (security._ACL_TAG_MASK, 0o7, _UNDEFINED_ID),
            (security._ACL_TAG_OTHER, 0o0, _UNDEFINED_ID),
        )
        with patch.object(security, "_get_group_name", side_effect=lambda gid: "finance" if gid == 1000 else None):
            entries = security.AclClient._parse(raw)
        named = {e.qualifier: e for e in entries if e.tag == "group" and e.qualifier}
        self.assertIn("finance", named)
        self.assertTrue(named["finance"].read)
        mask = next(e for e in entries if e.tag == "mask")
        self.assertTrue(mask.read)

    def test_ignores_unresolvable_named_entries(self) -> None:
        # An id with no NSS entry resolves to `qualifier=None` and is filtered
        # out by `_check_permission`'s own dict comprehensions.
        raw = _acl_xattr((security._ACL_TAG_USER, 0o7, 99999))
        with patch.object(security, "_get_username", return_value=None):
            entries = security.AclClient._parse(raw)
        self.assertEqual(entries, [security.AclEntry(tag="user", qualifier=None, perm="rwx")])

    def test_unknown_tag_bits_are_skipped(self) -> None:
        raw = _acl_xattr((0x40, 0o7, _UNDEFINED_ID), (security._ACL_TAG_OTHER, 0o0, _UNDEFINED_ID))
        entries = security.AclClient._parse(raw)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].tag, "other")

    def test_rejects_unsupported_version(self) -> None:
        raw = struct.pack("<I", 0x0001)
        with self.assertRaises(struct.error):
            security.AclClient._parse(raw)


class TestCheckPermission(unittest.TestCase):
    """
    Exercises `_check_permission`'s POSIX.1e algorithm directly, ACL xattr parsing
    and NSS lookups mocked out -- this is pure permission-resolution logic, not
    an integration test of the real tools.
    """

    def setUp(self) -> None:
        self.tmp = tempfile.NamedTemporaryFile(delete=False)
        self.tmp.close()
        self.addCleanup(lambda: os.unlink(self.tmp.name))

    @staticmethod
    def _entries(
        *,
        user_obj: str = "rwx",
        group_obj: str = "r-x",
        other: str = "---",
        mask: str | None = None,
        named_group: tuple[str, str] | None = None,
    ) -> list[security.AclEntry]:
        """
        Builds an `AclEntry` list directly, bypassing `AclClient._parse`: these
        tests exercise `_check_permission`'s POSIX.1e resolution algorithm, which
        operates purely on already-decoded entries regardless of whether they
        came from the xattr parser or (in tests) straight from the fixture.
        """
        entries = [
            security.AclEntry(tag="user_obj", qualifier=None, perm=user_obj),
            security.AclEntry(tag="group_obj", qualifier=None, perm=group_obj),
        ]
        if named_group is not None:
            name, perm = named_group
            entries.append(security.AclEntry(tag="group", qualifier=name, perm=perm))
        if mask is not None:
            entries.append(security.AclEntry(tag="mask", qualifier=None, perm=mask))
        entries.append(security.AclEntry(tag="other", qualifier=None, perm=other))
        return entries

    @patch.object(security, "_grp", object())
    @patch.object(security, "_pwd", object())
    @patch.object(security, "_get_uid")
    def test_owner_gets_owner_permission(self, mock_uid: object) -> None:
        st = os.stat(self.tmp.name)
        mock_uid.return_value = st.st_uid  # pyright: ignore[reportAttributeAccessIssue]
        with patch.object(security._acl_client, "get_acl_entries", return_value=self._entries()):
            self.assertTrue(security._check_permission(self.tmp.name, "alice", "r"))

    @patch.object(security, "_grp", object())
    @patch.object(security, "_pwd", object())
    @patch.object(security, "_get_uid", return_value=-1)
    @patch.object(security, "get_user_groups", return_value=frozenset({"finance"}))
    @patch.object(security, "_get_group_name", return_value="other-group")
    def test_matching_named_group_grants_access(self, *_mocks: object) -> None:
        entries = self._entries(named_group=("finance", "rwx"), mask="rwx")
        with patch.object(security._acl_client, "get_acl_entries", return_value=entries):
            self.assertTrue(security._check_permission(self.tmp.name, "bob", "r"))

    @patch.object(security, "_grp", object())
    @patch.object(security, "_pwd", object())
    @patch.object(security, "_get_uid", return_value=-1)
    @patch.object(security, "get_user_groups", return_value=frozenset({"nobody-team"}))
    @patch.object(security, "_get_group_name", return_value="other-group")
    def test_non_matching_group_falls_back_to_other(self, *_mocks: object) -> None:
        entries = self._entries(named_group=("finance", "rwx"), mask="rwx")
        with patch.object(security._acl_client, "get_acl_entries", return_value=entries):
            self.assertFalse(security._check_permission(self.tmp.name, "carol", "r"))

    @patch.object(security, "_grp", object())
    @patch.object(security, "_pwd", object())
    @patch.object(security, "_get_uid", return_value=-1)
    @patch.object(security, "get_user_groups", return_value=frozenset({"finance"}))
    @patch.object(security, "_get_group_name", return_value="other-group")
    def test_mask_caps_group_permission(self, *_mocks: object) -> None:
        # `finance` has rwx, but the ACL mask caps it down to r-x -> write should
        # be denied even though the named group entry itself grants it.
        entries = self._entries(named_group=("finance", "rwx"), mask="r-x")
        with patch.object(security._acl_client, "get_acl_entries", return_value=entries):
            self.assertTrue(security._check_permission(self.tmp.name, "dave", "r"))

    @patch.object(security, "_grp", object())
    @patch.object(security, "_pwd", object())
    @patch.object(security, "_get_uid", return_value=-1)
    @patch.object(security, "_get_group_name", return_value="other-group")
    def test_prefetched_groups_context_var_skips_nss_lookup(self, *_mocks: object) -> None:
        # When the security middleware has already resolved the requesting
        # user's groups for this request (`current_user_groups`), `_check_permission`
        # must use that instead of calling the (expensive, full-database-scanning)
        # `get_user_groups` again for every single file being checked.
        entries = self._entries(named_group=("finance", "rwx"), mask="rwx")
        token = security.current_user_groups.set({"bob": frozenset({"finance"})})
        try:
            with patch.object(security, "get_user_groups") as mock_get_user_groups:
                with patch.object(security._acl_client, "get_acl_entries", return_value=entries):
                    self.assertTrue(security._check_permission(self.tmp.name, "bob", "r"))
                mock_get_user_groups.assert_not_called()
        finally:
            security.current_user_groups.reset(token)

    def test_unreadable_acl_fails_closed(self) -> None:
        with patch.object(security._acl_client, "get_acl_entries", return_value=None):
            self.assertFalse(security._check_permission(self.tmp.name, "anyone", "r"))

    @patch.object(security, "_grp", None)
    @patch.object(security, "_pwd", None)
    def test_missing_nss_support_fails_closed(self) -> None:
        with patch.object(security._acl_client, "get_acl_entries", return_value=self._entries()):
            self.assertFalse(security._check_permission(self.tmp.name, "anyone", "r"))

    def test_none_username_always_allowed(self) -> None:
        self.assertTrue(security.can_read_real_path(self.tmp.name, None))
        self.assertTrue(security.can_traverse_real_path(self.tmp.name, None))


class TestCanAccessAncestorChain(unittest.TestCase):
    """
    Verify that `can_access` resolves the right permissions by walking
    every ancestor directory looking for traverse ("x")
    permission before checking read on the final target.
    """

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        os.makedirs(os.path.join(self.temp_dir.name, "a", "b"))
        with open(os.path.join(self.temp_dir.name, "a", "b", "secret.txt"), "w") as f:
            _ = f.write("classified")

        self.config = AppConfig(roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")})
        RootFolder.set_root_configs(self.config.roots)
        self.root_folder = RootFolder.get(self.config.roots["root"])
        self.snapshot = self.root_folder.get_snapshot(None)

    def test_denied_ancestor_blocks_access_to_child(self) -> None:
        # The share root is walked as just the first ancestor alongside "a" and
        # "a/b": denying traverse on any one of them, root included, must
        # block access the same way.
        root_real = self.root_folder.real_path("", self.snapshot)
        denied_ancestors = {root_real, self.root_folder.real_path("a", self.snapshot)}

        for denied in denied_ancestors:
            with self.subTest(denied=denied):

                def fake_check(real_path: str, username: str, want: str, denied: str = denied) -> bool:
                    if want == "x" and real_path == denied:
                        return False
                    return True

                with patch.object(security, "_check_permission", side_effect=fake_check):
                    self.assertFalse(security.can_access(self.root_folder, "a/b/secret.txt", self.snapshot, "eve"))

    def test_accessible_ancestor_chain_allows_read_target(self) -> None:
        with patch.object(security, "_check_permission", return_value=True):
            self.assertTrue(security.can_access(self.root_folder, "a/b/secret.txt", self.snapshot, "eve"))

    def test_listing_a_directory_does_not_require_traverse_on_itself(self) -> None:
        # A directory is never its own ancestor: real `readdir()` needs only "r"
        # on it, so listing a readable-but-not-executable directory must work.
        def fake_check(real_path: str, username: str, want: str) -> bool:
            return want != "x"  # nothing is traversable, everything is readable

        with patch.object(security, "_check_permission", side_effect=fake_check):
            self.assertTrue(security.can_access(self.root_folder, "", self.snapshot, "eve"))

    def test_disabled_security_always_allows(self) -> None:
        self.assertTrue(security.can_access(self.root_folder, "a/b/secret.txt", self.snapshot, None))

    def test_settled_ancestors_are_not_rechecked(self) -> None:
        # Proving "a/b" traversable necessarily proved "" and "a" on the way
        # down, so every later path running through it resumes from there,
        # which is what makes a listing cost one chain walk instead of N.
        token = security.current_traverse_ledger.set({})
        try:
            with patch.object(security, "_check_permission", return_value=True) as mock_check:
                self.assertTrue(security.can_access(self.root_folder, "a/b/secret.txt", self.snapshot, "eve"))
                traversals = [c for c in mock_check.call_args_list if c.args[2] == "x"]
                self.assertEqual(len(traversals), 3)  # "", "a" and "a/b"

                mock_check.reset_mock()
                for name in ("one.txt", "two.txt", "three.txt"):
                    self.assertTrue(security.can_access_child(self.root_folder, f"a/b/{name}", self.snapshot, "eve"))
                # The shared chain is settled: only each child's own read check.
                self.assertEqual([c.args[2] for c in mock_check.call_args_list], ["r", "r", "r"])
        finally:
            security.current_traverse_ledger.reset(token)

    def test_denied_ancestor_settles_its_whole_subtree(self) -> None:
        # Nothing under an untraversable directory is reachable, so a denial
        # answers every deeper question without walking into the subtree.
        denied_real = self.root_folder.real_path("a", self.snapshot)

        def fake_check(real_path: str, username: str, want: str) -> bool:
            return not (want == "x" and real_path == denied_real)

        token = security.current_traverse_ledger.set({})
        try:
            with patch.object(security, "_check_permission", side_effect=fake_check) as mock_check:
                self.assertFalse(security.can_access(self.root_folder, "a/b/secret.txt", self.snapshot, "eve"))
                mock_check.reset_mock()

                # Deeper paths under the denied directory need no checks at all.
                self.assertFalse(security.can_access_child(self.root_folder, "a/b/other.txt", self.snapshot, "eve"))
                self.assertFalse(security.can_view_metadata(self.root_folder, "a/b/c/deeper.txt", self.snapshot, "eve"))
                mock_check.assert_not_called()
        finally:
            security.current_traverse_ledger.reset(token)

    def test_chain_is_walked_in_full_without_a_ledger(self) -> None:
        # No ledger (tests, direct calls) means no shortcuts: every chain is
        # verified from the root down, so a verdict never outlives its request.
        self.assertIsNone(security.current_traverse_ledger.get())
        with patch.object(security, "_check_permission", return_value=True) as mock_check:
            for _ in range(3):
                self.assertTrue(security.can_access(self.root_folder, "a/b/secret.txt", self.snapshot, "eve"))
        self.assertEqual(len([c for c in mock_check.call_args_list if c.args[2] == "x"]), 9)  # 3 chain levels x 3 calls

    def test_ledger_is_namespaced_per_snapshot(self) -> None:
        # The same logical directory in another snapshot is a different
        # directory on disk, with its own ACLs, a verdict must not carry over.
        other_snapshot = object()
        seen: list[str] = []

        def fake_check(real_path: str, username: str, want: str) -> bool:
            seen.append(real_path)
            return True

        token = security.current_traverse_ledger.set({})
        try:
            with patch.object(security, "_check_permission", side_effect=fake_check):
                with patch.object(self.root_folder, "real_path", side_effect=lambda path, snapshot: f"/snap-{id(snapshot)}/{path}"):
                    self.assertTrue(security.can_view_metadata(self.root_folder, "a/b/secret.txt", self.snapshot, "eve"))
                    first = list(seen)
                    seen.clear()
                    self.assertTrue(security.can_view_metadata(self.root_folder, "a/b/secret.txt", other_snapshot, "eve"))  # pyright: ignore[reportArgumentType]
        finally:
            security.current_traverse_ledger.reset(token)

        self.assertTrue(first)
        self.assertTrue(seen)  # re-walked rather than reusing the other snapshot's verdict
        self.assertNotEqual(first, seen)

    def test_unresolvable_path_reports_missing_when_parent_is_visible(self) -> None:
        def fake_real_path(path: str, snapshot: object) -> str:
            if path == "a/b/secret.txt":
                raise ValueError("boom")
            return path  # ancestors resolve fine; only the final target fails

        with patch.object(security, "_check_permission", return_value=True):
            with patch.object(self.root_folder, "real_path", side_effect=fake_real_path):
                with self.assertRaises(FileNotFoundError):
                    security.can_access(self.root_folder, "a/b/secret.txt", self.snapshot, "eve")

    def test_unresolvable_path_inside_a_locked_region_is_denied_not_reported_missing(self) -> None:
        # The locked ancestor denies first, so an unresolvable path below it
        # can't be used to probe what's in there.
        def fake_real_path(path: str, snapshot: object) -> str:
            if path == "a/b/secret.txt":
                raise ValueError("boom")
            return path

        def fake_check(real_path: str, username: str, want: str) -> bool:
            return real_path != "a"  # "a" is locked

        with patch.object(security, "_check_permission", side_effect=fake_check):
            with patch.object(self.root_folder, "real_path", side_effect=fake_real_path):
                self.assertFalse(security.can_access(self.root_folder, "a/b/secret.txt", self.snapshot, "eve"))


class TestCanAccessChildParentTraverse(unittest.TestCase):
    """
    `can_access_child` (backing `FSNode.is_accessible` for folder listings) must
    also verify traverse ("x") on the child's immediate parent, not just read
    ("r") on the child itself. Real `readdir()` only needs "r" on a directory to
    enumerate names, so `can_access()`'s check on a folder being listed only
    verifies "r" on it. But `stat()`-ing anything inside that directory (what
    showing a child's metadata amounts to) needs "x" on it regardless of the
    child's own bits. Without this, a readable-but-not-executable directory
    would leak its children's metadata through a listing, which a real `ls` on
    such a directory cannot do.
    """

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        os.makedirs(os.path.join(self.temp_dir.name, "restricted_dir"))
        with open(os.path.join(self.temp_dir.name, "restricted_dir", "secret.txt"), "w") as f:
            _ = f.write("classified")
        with open(os.path.join(self.temp_dir.name, "top_level.txt"), "w") as f:
            _ = f.write("visible")

        self.config = AppConfig(roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")})
        RootFolder.set_root_configs(self.config.roots)
        self.root_folder = RootFolder.get(self.config.roots["root"])
        self.snapshot = self.root_folder.get_snapshot(None)

    def test_denies_child_when_parent_lacks_traverse_even_if_child_is_readable(self) -> None:
        cases = {
            "restricted_dir/secret.txt": self.root_folder.real_path("restricted_dir", self.snapshot),
            "top_level.txt": self.root_folder.real_path("", self.snapshot),
        }
        for child_path, denied_parent_real in cases.items():
            with self.subTest(child_path=child_path):

                def fake_check(real_path: str, username: str, want: str, denied_parent_real: str = denied_parent_real) -> bool:
                    if want == "x" and real_path == denied_parent_real:
                        return False
                    return True  # the child itself is readable

                with patch.object(security, "_check_permission", side_effect=fake_check):
                    self.assertFalse(security.can_access_child(self.root_folder, child_path, self.snapshot, "someone"))

    def test_allows_child_when_parent_has_traverse_and_child_is_readable(self) -> None:
        for child_path in ("restricted_dir/secret.txt", "top_level.txt"):
            with self.subTest(child_path=child_path):
                with patch.object(security, "_check_permission", return_value=True):
                    self.assertTrue(security.can_access_child(self.root_folder, child_path, self.snapshot, "someone"))


class TestFolderListingAccessibility(unittest.TestCase):
    """
    Restricted entries are displayed in the listing, they just report
    `is_accessible = False`, just like a filesystem would. Real content access
    stays fully gated elsewhere.
    """

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        with open(os.path.join(self.temp_dir.name, "visible.txt"), "w") as f:
            _ = f.write("ok")
        with open(os.path.join(self.temp_dir.name, "restricted.txt"), "w") as f:
            _ = f.write("restricted")

        self.config = AppConfig(roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")})
        RootFolder.set_root_configs(self.config.roots)

    def test_restricted_entry_still_listed_but_marked_inaccessible(self) -> None:
        def fake_can_access_child(root_folder: object, child_path: str, snapshot: object, username: str | None) -> bool:
            return not child_path.endswith("restricted.txt")

        token = security.current_username.set("someone")
        try:
            with patch("goeddel.use.security.can_access_child", side_effect=fake_can_access_child):
                root_folder = RootFolder.get(self.config.roots["root"])
                folder = root_folder.get_folder(path="")
                assert folder is not None
                names = folder.content()
                self.assertIn("visible.txt", names)
                self.assertIn("restricted.txt", names)  # still listed, not hidden
                self.assertTrue(folder["visible.txt"].is_accessible)
                self.assertFalse(folder["restricted.txt"].is_accessible)
        finally:
            security.current_username.reset(token)

    def test_no_restriction_when_username_is_none(self) -> None:
        self.assertIsNone(security.get_current_username())
        root_folder = RootFolder.get(self.config.roots["root"])
        folder = root_folder.get_folder(path="")
        assert folder is not None
        self.assertTrue(folder["visible.txt"].is_accessible)
        self.assertTrue(folder["restricted.txt"].is_accessible)


class TestZipSelectionSkipReporting(unittest.TestCase):
    """
    Confirms that the ZIP selection reports skipped files correctly.
    """

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        os.makedirs(os.path.join(self.temp_dir.name, "folder"))
        with open(os.path.join(self.temp_dir.name, "folder", "ok.txt"), "w") as f:
            _ = f.write("ok")
        with open(os.path.join(self.temp_dir.name, "folder", "blocked.txt"), "w") as f:
            _ = f.write("blocked")
        with open(os.path.join(self.temp_dir.name, "top-level-blocked.txt"), "w") as f:
            _ = f.write("blocked")

        self.config = AppConfig(roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")})
        RootFolder.set_root_configs(self.config.roots)

    def test_resolve_zip_selection_reports_skipped_and_included(self) -> None:
        from goeddel.use.zip_streamer import resolve_zip_selection

        def fake_check(real_path: str, username: object, want: str) -> bool:
            return not os.path.basename(real_path).startswith(("blocked", "top-level-blocked"))

        token = security.current_username.set("someone")
        try:
            with patch.object(security, "_check_permission", side_effect=fake_check):
                root_folder = RootFolder.get(self.config.roots["root"])
                included, empty_dirs, skipped = resolve_zip_selection(root_folder, None, ["folder", "top-level-blocked.txt"])
        finally:
            security.current_username.reset(token)

        included_names = {os.path.basename(real_path) for _node_path, real_path in included}
        self.assertIn("ok.txt", included_names)
        self.assertNotIn("blocked.txt", included_names)
        self.assertIn("folder/blocked.txt", skipped)
        self.assertIn("top-level-blocked.txt", skipped)
        self.assertEqual(empty_dirs, [])

    def test_zip_preview_endpoint_matches_resolve_zip_selection(self) -> None:
        from fastapi.testclient import TestClient

        from goeddel.use.zip_streamer import resolve_zip_selection

        def fake_check(real_path: str, username: object, want: str) -> bool:
            return not os.path.basename(real_path).startswith(("blocked", "top-level-blocked"))

        config = AppConfig(
            roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")},
            security=SecurityConfig(enabled=True, trusted_user_header="Remote-User"),
        )
        app.state.loaded_config = config
        RootFolder.set_root_configs(config.roots)
        client = TestClient(app)

        with patch.object(security, "_check_permission", side_effect=fake_check):
            response = client.post(
                "/api/zip-preview/root",
                json={"paths": ["folder", "top-level-blocked.txt"], "snapshot": None},
                headers={"Remote-User": "someone"},
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()

            token = security.current_username.set("someone")
            try:
                root_folder = RootFolder.get(config.roots["root"])
                _included, _empty_dirs, expected_skipped = resolve_zip_selection(root_folder, None, ["folder", "top-level-blocked.txt"])
            finally:
                security.current_username.reset(token)

        self.assertEqual(sorted(body["skipped"]), sorted(expected_skipped))
        self.assertEqual(body["skipped_count"], len(expected_skipped))


class TestImpersonationUnion(unittest.TestCase):
    """
    `SecurityConfig.impersonate_users` lets an unauthenticated request be
    treated as the union of several real users' permissions: `current_username`
    (and every `can_*` function) then carries a `frozenset[str]` instead of a
    single username. Access must be granted if ANY one member could reach the
    resource *as themselves*, but never by combining, e.g., one member's
    traverse permission with a different member's read permission on the same
    check (see `_run_for_each_identity`).
    """

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        os.makedirs(os.path.join(self.temp_dir.name, "restricted_dir"))
        with open(os.path.join(self.temp_dir.name, "restricted_dir", "secret.txt"), "w") as f:
            _ = f.write("classified")

        self.config = AppConfig(roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")})
        RootFolder.set_root_configs(self.config.roots)
        self.root_folder = RootFolder.get(self.config.roots["root"])
        self.snapshot = self.root_folder.get_snapshot(None)

    def test_read_real_path_grants_if_any_member_can_read(self) -> None:
        def fake_check(real_path: str, username: str, want: str) -> bool:
            return username == "alice" and want == "r"

        with patch.object(security, "_check_permission", side_effect=fake_check):
            self.assertTrue(security.can_read_real_path("some/path", frozenset({"alice", "bob"})))
            self.assertFalse(security.can_read_real_path("some/path", frozenset({"bob", "carol"})))

    def test_does_not_combine_different_members_traverse_and_read(self) -> None:
        # alice can traverse the parent but not read the file; bob is the
        # reverse. Neither can actually reach the file on their own, so the
        # union must deny it too, even though "some member can traverse" and
        # "some member can read" are both individually true.
        parent_real = self.root_folder.real_path("restricted_dir", self.snapshot)
        child_real = self.root_folder.real_path("restricted_dir/secret.txt", self.snapshot)

        def fake_check(real_path: str, username: str, want: str) -> bool:
            if username == "alice":
                return want == "x" and real_path == parent_real
            if username == "bob":
                return want == "r" and real_path == child_real
            return False

        with patch.object(security, "_check_permission", side_effect=fake_check):
            self.assertFalse(
                security.can_access_child(self.root_folder, "restricted_dir/secret.txt", self.snapshot, frozenset({"alice", "bob"}))
            )
            self.assertFalse(security.can_access(self.root_folder, "restricted_dir/secret.txt", self.snapshot, frozenset({"alice", "bob"})))

    def test_grants_when_a_single_member_satisfies_the_whole_chain(self) -> None:
        with patch.object(security, "_check_permission", side_effect=lambda real_path, username, want: username == "carol"):
            self.assertTrue(
                security.can_access_child(self.root_folder, "restricted_dir/secret.txt", self.snapshot, frozenset({"alice", "carol"}))
            )
            self.assertTrue(security.can_access(self.root_folder, "restricted_dir/secret.txt", self.snapshot, frozenset({"alice", "carol"})))

    def test_groups_are_resolved_per_member_from_the_prefetched_map(self) -> None:
        entries = [
            security.AclEntry(tag="user_obj", qualifier=None, perm="---"),
            security.AclEntry(tag="group_obj", qualifier=None, perm="---"),
            security.AclEntry(tag="group", qualifier="finance", perm="r--"),
            security.AclEntry(tag="other", qualifier=None, perm="---"),
        ]
        token = security.current_user_groups.set({"alice": frozenset(), "bob": frozenset({"finance"})})
        try:
            with patch.object(security, "_grp", object()), patch.object(security, "_pwd", object()):
                with patch.object(security, "_get_uid", return_value=-1):
                    with patch.object(security, "_acl_client") as mock_acl:
                        mock_acl.get_acl_entries.return_value = entries
                        with patch.object(security, "get_user_groups") as mock_get_user_groups:
                            self.assertTrue(security.can_read_real_path("some/path", frozenset({"alice", "bob"})))
                            mock_get_user_groups.assert_not_called()
        finally:
            security.current_user_groups.reset(token)


class TestSecurityMiddleware(unittest.TestCase):
    """
    Confirms the middleware is a strict no-op when disabled (the default), and
    actually enforces a 403 when enabled and the trusted header points at an
    out-of-permission resource.
    """

    @override
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        with open(os.path.join(self.temp_dir.name, "file.txt"), "w") as f:
            _ = f.write("content")

    def test_disabled_by_default_no_header_check(self) -> None:
        from fastapi.testclient import TestClient

        config = AppConfig(roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")})
        app.state.loaded_config = config
        RootFolder.set_root_configs(config.roots)
        client = TestClient(app)

        response = client.get("/list/root")
        self.assertEqual(response.status_code, 200)

    def test_enabled_denies_when_check_fails(self) -> None:
        from fastapi.testclient import TestClient

        config = AppConfig(
            roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")},
            security=SecurityConfig(enabled=True, trusted_user_header="Remote-User"),
        )
        app.state.loaded_config = config
        RootFolder.set_root_configs(config.roots)
        client = TestClient(app)

        with patch("goeddel.use.app.can_access", return_value=False):
            response = client.get("/list/root", headers={"Remote-User": "denied-user"})
        self.assertEqual(response.status_code, 403)

    def test_enabled_allows_when_check_passes(self) -> None:
        from fastapi.testclient import TestClient

        config = AppConfig(
            roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")},
            security=SecurityConfig(enabled=True, trusted_user_header="Remote-User"),
        )
        app.state.loaded_config = config
        RootFolder.set_root_configs(config.roots)
        client = TestClient(app)

        with patch("goeddel.use.app.can_access", return_value=True):
            response = client.get("/list/root", headers={"Remote-User": "allowed-user"})
        self.assertEqual(response.status_code, 200)

    def test_no_header_denied_when_no_impersonation_configured(self) -> None:
        from fastapi.testclient import TestClient

        config = AppConfig(
            roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")},
            security=SecurityConfig(enabled=True, trusted_user_header="Remote-User"),
        )
        app.state.loaded_config = config
        RootFolder.set_root_configs(config.roots)
        client = TestClient(app)

        with patch("goeddel.use.app.can_access", return_value=True):
            response = client.get("/list/root")  # no Remote-User header at all
        self.assertEqual(response.status_code, 403)

    def test_no_header_falls_back_to_impersonation_union(self) -> None:
        from fastapi.testclient import TestClient

        config = AppConfig(
            roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")},
            security=SecurityConfig(enabled=True, trusted_user_header="Remote-User", impersonate_users=("alice", "bob")),
        )
        app.state.loaded_config = config
        RootFolder.set_root_configs(config.roots)
        client = TestClient(app)

        seen_identity: object = None

        def fake_can_access(root_folder: object, path: object, snapshot: object, username: object) -> bool:
            nonlocal seen_identity
            seen_identity = username
            return True

        with (
            patch.object(security, "get_user_groups", return_value=frozenset()),
            patch("goeddel.use.app.can_access", side_effect=fake_can_access),
        ):
            response = client.get("/list/root")  # still no Remote-User header
        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen_identity, frozenset({"alice", "bob"}))

    def test_header_present_takes_priority_over_impersonation_list(self) -> None:
        from fastapi.testclient import TestClient

        config = AppConfig(
            roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")},
            security=SecurityConfig(enabled=True, trusted_user_header="Remote-User", impersonate_users=("alice", "bob")),
        )
        app.state.loaded_config = config
        RootFolder.set_root_configs(config.roots)
        client = TestClient(app)

        seen_identity: object = None

        def fake_can_access(root_folder: object, path: object, snapshot: object, username: object) -> bool:
            nonlocal seen_identity
            seen_identity = username
            return True

        with patch("goeddel.use.app.can_access", side_effect=fake_can_access):
            response = client.get("/list/root", headers={"Remote-User": "carol"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen_identity, "carol")


class TestDetailRouteAccessibility(unittest.TestCase):
    """
    The `/detail` timeline spans every snapshot a file has ever existed in, but
    only the requested (path, snapshot) pair is checked by the security
    middleware. Per-version ACLs aren't individually re-checked (a known
    limitation): a guessable/known URL must not be able to reveal that a
    restricted file exists, or its metadata, via that gap: the route itself
    must hard-403 based on `FSNode.is_accessible` for the node the URL names.
    """

    @override
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        with open(os.path.join(self.temp_dir.name, "secret.txt"), "w") as f:
            _ = f.write("classified")

        self.config = AppConfig(
            roots={"root": RootConfig(root_path=self.temp_dir.name, sub_path="")},
            security=SecurityConfig(enabled=True, trusted_user_header="Remote-User"),
        )
        app.state.loaded_config = self.config
        RootFolder.set_root_configs(self.config.roots)

    def test_denies_detail_view_when_node_is_not_accessible(self) -> None:
        from fastapi.testclient import TestClient

        client = TestClient(app)
        # The middleware's own check passes (eg. ancestor traversal is fine),
        # but the specific node the route resolves is not readable by this user.
        with patch("goeddel.use.app.can_access", return_value=True), patch.object(security, "can_access_child", return_value=False):
            response = client.get("/detail/root/secret.txt", headers={"Remote-User": "denied-user"})
        self.assertEqual(response.status_code, 403)

    def test_allows_detail_view_when_node_is_accessible(self) -> None:
        from fastapi.testclient import TestClient

        client = TestClient(app)
        with patch("goeddel.use.app.can_access", return_value=True), patch.object(security, "can_access_child", return_value=True):
            response = client.get("/detail/root/secret.txt", headers={"Remote-User": "allowed-user"})
        self.assertEqual(response.status_code, 200)

    def test_missing_file_still_404s_rather_than_403s(self) -> None:
        from fastapi.testclient import TestClient

        client = TestClient(app)
        with patch("goeddel.use.app.can_access", return_value=True), patch.object(security, "can_access_child", return_value=False):
            response = client.get("/detail/root/does-not-exist.txt", headers={"Remote-User": "anyone"})
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
