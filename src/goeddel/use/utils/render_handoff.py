from __future__ import annotations

import secrets
import threading
import time
from collections.abc import Callable, Hashable
from concurrent.futures import Future, ThreadPoolExecutor
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


def start_render(render: Callable[[], str]) -> Future[str]:
    """
    Runs `render` in the background, in the current context, so it sees the request's user
    and permission caches.
    """
    context = copy_context()
    return _executor.submit(context.run, render)


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
