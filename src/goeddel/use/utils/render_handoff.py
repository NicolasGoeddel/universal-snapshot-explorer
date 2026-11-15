from __future__ import annotations

import secrets
import threading
import time
from collections.abc import Callable, Hashable
from concurrent.futures import Future, ThreadPoolExecutor, wait
from contextvars import copy_context
from dataclasses import dataclass

# How long an unclaimed render is kept: its page asks for it as soon as it is loaded
HANDOFF_TTL_SECONDS = 30.0

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="render-handoff")
_lock = threading.Lock()


@dataclass(frozen=True)
class _Handoff:
    owner: Hashable
    target: Hashable
    future: Future[str]
    expires_at: float


_handoffs: dict[str, _Handoff] = {}
# Renders still running, by what they render
_running: dict[Hashable, Future[str]] = {}


def start_render(render: Callable[[], str], key: Hashable = None) -> Future[str]:
    """
    Runs `render` in the background, in the current context, so it sees the request's user
    and permission caches. While it runs, `wait_for_render(key)` waits for it.
    """
    context = copy_context()
    future = _executor.submit(context.run, render)
    if key is not None:
        with _lock:
            _running[key] = future

        def forget(done: Future[str]) -> None:
            with _lock:
                if _running.get(key) is done:
                    del _running[key]

        # Runs at once if the render is already done
        future.add_done_callback(forget)
    return future


def rows_render_key(owner: Hashable, root_name: str, directory_path: str) -> Hashable:
    """What a render of a folder's rows for a user runs under, whichever snapshot it shows."""
    return ("rows", owner, root_name, directory_path)


def wait_for_render(key: Hashable, timeout: float) -> None:
    """Waits for the render running under `key`, if any, so that work which can come later doesn't slow it down."""
    with _lock:
        future = _running.get(key)
    if future is not None:
        _ = wait([future], timeout=timeout)


def hand_off(future: Future[str], owner: Hashable, target: Hashable) -> str:
    """
    Keeps a render that is still running for a later request, and returns the one-time token
    that claims it.
    """
    token = secrets.token_urlsafe(16)
    now = time.monotonic()
    with _lock:
        for expired in [key for key, handoff in _handoffs.items() if handoff.expires_at < now]:
            del _handoffs[expired]
        _handoffs[token] = _Handoff(owner, target, future, now + HANDOFF_TTL_SECONDS)
    return token


def take_over(token: str, owner: Hashable, target: Hashable) -> Future[str] | None:
    """
    Claims the render kept under `token`. A token is used up by its first claim, and only
    claims the render for the user and target it was handed off for.
    """
    with _lock:
        handoff = _handoffs.pop(token, None)
    if handoff is None or handoff.owner != owner or handoff.target != target or handoff.expires_at < time.monotonic():
        return None
    return handoff.future
