from __future__ import annotations

import asyncio
import logging
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from .providers.base import Provider

log = logging.getLogger(__name__)


class StoreFull(RuntimeError):
    pass


@dataclass
class InboxSession:
    id: str
    address: str
    provider: Provider
    session: dict[str, Any]
    created_at: float
    expires_at: float
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def touch(self, ttl: int) -> None:
        self.expires_at = time.time() + ttl


class InboxStore:
    """In-memory inbox sessions with an idle TTL.

    Good for a single process. Several processes / horizontal scaling would
    need a shared store such as Redis.
    """

    def __init__(self, ttl_seconds: int, max_items: int = 0) -> None:
        self._ttl = ttl_seconds
        self._max = max_items
        self._items: dict[str, InboxSession] = {}
        self._lock = asyncio.Lock()

    def __len__(self) -> int:
        return len(self._items)

    async def create(
        self, address: str, provider: Provider, session: dict[str, Any]
    ) -> InboxSession:
        now = time.time()
        inbox = InboxSession(
            id=secrets.token_urlsafe(16),
            address=address,
            provider=provider,
            session=session,
            created_at=now,
            expires_at=now + self._ttl,
        )
        async with self._lock:
            self._sweep_locked(now)
            if self._max and len(self._items) >= self._max:
                raise StoreFull("inbox store is full")
            self._items[inbox.id] = inbox
        return inbox

    async def has_room(self) -> bool:
        async with self._lock:
            self._sweep_locked(time.time())
            return not self._max or len(self._items) < self._max

    async def get(self, inbox_id: str) -> InboxSession | None:
        """Return the inbox and extend its TTL, or None if unknown / expired."""
        async with self._lock:
            inbox = self._items.get(inbox_id)
            if inbox is None:
                return None
            if inbox.expires_at < time.time():
                self._items.pop(inbox_id, None)
                return None
            inbox.touch(self._ttl)
            return inbox

    async def delete(self, inbox_id: str) -> InboxSession | None:
        async with self._lock:
            return self._items.pop(inbox_id, None)

    def _sweep_locked(self, now: float) -> None:
        for k in [k for k, v in self._items.items() if v.expires_at < now]:
            self._items.pop(k, None)

    async def sweep(self) -> None:
        async with self._lock:
            self._sweep_locked(time.time())

    async def run_sweeper(self, interval: float = 60.0) -> None:
        while True:
            await asyncio.sleep(interval)
            try:
                await self.sweep()
            except Exception:  # noqa: BLE001 - the sweeper must not die
                log.exception("inbox sweep failed")


class RateLimiter:
    """Sliding-window limit of `limit` hits per `window` seconds per key."""

    def __init__(self, limit: int, window: float = 60.0) -> None:
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque[float]] = {}

    def hit(self, key: str) -> bool:
        """Record a hit; False when the key is over its limit (the hit is not counted)."""
        if self.limit <= 0:
            return True
        now = time.monotonic()
        if len(self._hits) > 10_000:  # forget idle keys so the dict can't grow forever
            self._hits = {k: q for k, q in self._hits.items() if q and now - q[-1] < self.window}
        q = self._hits.setdefault(key, deque())
        while q and now - q[0] >= self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True
