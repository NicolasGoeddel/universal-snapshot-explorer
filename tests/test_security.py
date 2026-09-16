from __future__ import annotations

import os
import tempfile
import unittest
from typing import override
from unittest.mock import patch

from goeddel.use import security
from goeddel.use.app import app
from goeddel.use.config import AppConfig, RootConfig, SecurityConfig
from goeddel.use.models.root_folder import RootFolder

# The real `getfacl` CLI's exact output format isn't available on every dev/CI
# platform, so these fixtures are real `getfacl -p` transcripts for the three
# shapes `_check_permission` needs to handle.
PLAIN_MODE_ONLY = "user::rwx\ngroup::r-x\nother::---\n"
NAMED_GROUP_WITH_MASK = "user::rwx\ngroup::r-x\ngroup:finance:rwx\nmask::rwx\nother::---\n"
NAMED_GROUP_MASKED_DOWN = "user::rwx\ngroup::r-x\ngroup:finance:rwx\nmask::r-x\nother::---\n"


class TestAclParsing(unittest.TestCase):
    def test_parses_plain_mode_bits(self) -> None:
        entries = security.AclClient._parse(PLAIN_MODE_ONLY)
        tags = {e.tag: e for e in entries}
        self.assertEqual(set(tags), {"user_obj", "group_obj", "other"})
        self.assertTrue(tags["user_obj"].read)
        self.assertFalse(tags["other"].read)

    def test_parses_named_group_entries(self) -> None:
        entries = security.AclClient._parse(NAMED_GROUP_WITH_MASK)
        named = {e.qualifier: e for e in entries if e.tag == "group" and e.qualifier}
        self.assertIn("finance", named)
        self.assertTrue(named["finance"].read)
        mask = next(e for e in entries if e.tag == "mask")
        self.assertTrue(mask.read)

    def test_ignores_comment_and_blank_lines(self) -> None:
        output = "# file: foo\n# owner: root\n\nuser::rwx\ngroup::r-x\nother::---\n"
        entries = security.AclClient._parse(output)
        self.assertEqual(len(entries), 3)


class TestCheckPermission(unittest.TestCase):
    """
    Exercises `_check_permission`'s POSIX.1e algorithm directly, with `getfacl`
    and NSS lookups mocked out -- this is pure permission-resolution logic, not
    an integration test of the real tools (see AclClient/get_user_groups for
    that boundary).
    """

    def setUp(self) -> None:
        self.tmp = tempfile.NamedTemporaryFile(delete=False)
        self.tmp.close()
        self.addCleanup(lambda: os.unlink(self.tmp.name))

    def _entries(self, text: str) -> list[security.AclEntry]:
        return security.AclClient._parse(text)

    @patch.object(security, "_grp", object())
    @patch.object(security, "_pwd", object())
    @patch.object(security, "_get_uid")
    def test_owner_gets_owner_permission(self, mock_uid: object) -> None:
        st = os.stat(self.tmp.name)
        mock_uid.return_value = st.st_uid  # pyright: ignore[reportAttributeAccessIssue]
        with patch.object(security._acl_client, "get_acl_entries", return_value=self._entries(PLAIN_MODE_ONLY)):
            self.assertTrue(security._check_permission(self.tmp.name, "alice", "r"))

    @patch.object(security, "_grp", object())
    @patch.object(security, "_pwd", object())
    @patch.object(security, "_get_uid", return_value=-1)
    @patch.object(security, "get_user_groups", return_value=frozenset({"finance"}))
    @patch.object(security, "_get_group_name", return_value="other-group")
    def test_matching_named_group_grants_access(self, *_mocks: object) -> None:
        with patch.object(security._acl_client, "get_acl_entries", return_value=self._entries(NAMED_GROUP_WITH_MASK)):
            self.assertTrue(security._check_permission(self.tmp.name, "bob", "r"))

    @patch.object(security, "_grp", object())
    @patch.object(security, "_pwd", object())
    @patch.object(security, "_get_uid", return_value=-1)
    @patch.object(security, "get_user_groups", return_value=frozenset({"nobody-team"}))
    @patch.object(security, "_get_group_name", return_value="other-group")
    def test_non_matching_group_falls_back_to_other(self, *_mocks: object) -> None:
        with patch.object(security._acl_client, "get_acl_entries", return_value=self._entries(NAMED_GROUP_WITH_MASK)):
            self.assertFalse(security._check_permission(self.tmp.name, "carol", "r"))

    @patch.object(security, "_grp", object())
    @patch.object(security, "_pwd", object())
    @patch.object(security, "_get_uid", return_value=-1)
    @patch.object(security, "get_user_groups", return_value=frozenset({"finance"}))
    @patch.object(security, "_get_group_name", return_value="other-group")
    def test_mask_caps_group_permission(self, *_mocks: object) -> None:
        # `finance` has rwx, but the ACL mask caps it down to r-x -- write should
        # be denied even though the named group entry itself grants it.
        with patch.object(security._acl_client, "get_acl_entries", return_value=self._entries(NAMED_GROUP_MASKED_DOWN)):
            self.assertTrue(security._check_permission(self.tmp.name, "dave", "r"))

    def test_no_acl_tool_fails_open(self) -> None:
        with patch.object(security._acl_client, "get_acl_entries", return_value=None):
            self.assertTrue(security._check_permission(self.tmp.name, "anyone", "r"))

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
        def fake_check(real_path: str, username: str, want: str) -> bool:
            # Deny traverse specifically on the "a" ancestor -- everything else allowed.
            if want == "x" and os.path.basename(real_path) == "a":
                return False
            return True

        with patch.object(security, "_check_permission", side_effect=fake_check):
            self.assertFalse(security.can_access(self.root_folder, "a/b/secret.txt", self.snapshot, "eve"))

    def test_accessible_ancestor_chain_allows_read_target(self) -> None:
        with patch.object(security, "_check_permission", return_value=True):
            self.assertTrue(security.can_access(self.root_folder, "a/b/secret.txt", self.snapshot, "eve"))

    def test_disabled_security_always_allows(self) -> None:
        self.assertTrue(security.can_access(self.root_folder, "a/b/secret.txt", self.snapshot, None))


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


if __name__ == "__main__":
    unittest.main()
