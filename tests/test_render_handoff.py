from __future__ import annotations

import threading
import time
import unittest
from concurrent.futures import Future
from unittest.mock import patch

from goeddel.use.utils import render_handoff
from goeddel.use.utils.render_handoff import hand_off, start_render, take_over, wait_for_render


class TestRenderHandoff(unittest.TestCase):
    def test_claimed_once_by_its_owner_and_target(self) -> None:
        future: Future[str] = Future()
        token = hand_off(future, "alice", ("root", "folder", "Original"))
        self.assertIs(take_over(token, "alice", ("root", "folder", "Original")), future)
        self.assertIsNone(take_over(token, "alice", ("root", "folder", "Original")))

    def test_rejects_other_owner_or_target(self) -> None:
        for owner, target in (("bob", ("root", "folder", "Original")), ("alice", ("root", "other", "Original"))):
            token = hand_off(Future(), "alice", ("root", "folder", "Original"))
            self.assertIsNone(take_over(token, owner, target))
            # A wrong claim uses the token up as well
            self.assertIsNone(take_over(token, "alice", ("root", "folder", "Original")))

    def test_expires(self) -> None:
        token = hand_off(Future(), "alice", "target")
        with patch.object(render_handoff, "HANDOFF_TTL_SECONDS", -1.0):
            expired = hand_off(Future(), "alice", "target")
        self.assertIsNone(take_over(expired, "alice", "target"))
        self.assertIsNotNone(take_over(token, "alice", "target"))

    def test_waits_for_the_render_running_under_a_key(self) -> None:
        release = threading.Event()
        future = start_render(lambda: str(release.wait(timeout=5)), key="rows")
        started = time.monotonic()
        threading.Timer(0.2, release.set).start()
        wait_for_render("rows", timeout=5)
        self.assertTrue(future.done())
        self.assertGreaterEqual(time.monotonic() - started, 0.15)
        # Once done, nothing is left to wait for
        started = time.monotonic()
        wait_for_render("rows", timeout=5)
        wait_for_render("other", timeout=5)
        self.assertLess(time.monotonic() - started, 0.1)

    def test_render_runs_in_the_callers_context(self) -> None:
        from goeddel.use.security import current_username

        reset = current_username.set("alice")
        try:
            self.assertEqual(start_render(lambda: str(current_username.get())).result(timeout=5), "alice")
        finally:
            current_username.reset(reset)
