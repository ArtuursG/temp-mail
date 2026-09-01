from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

from .providers.base import Provider


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
    """Vienkāršs atmiņā balstīts inbox-sesiju krājums ar TTL izbeigšanu.

    Pietiek vienam procesam. Vairāku procesu / horizontālai skalēšanai
    šeit vajadzētu Redis.
    """

    def __init__(self, ttl_seconds: int) -> None:
        self._ttl = ttl_seconds
        self._items: dict[str, InboxSession] = {}
        self._lock = asyncio.Lock()

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
            self._items[inbox.id] = inbox
        return inbox

    async def get(self, inbox_id: str) -> InboxSession | None:
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

    async def sweep(self) -> None:
        now = time.time()
        async with self._lock:
            dead = [k for k, v in self._items.items() if v.expires_at < now]
            for k in dead:
                self._items.pop(k, None)

    async def run_sweeper(self, interval: float = 60.0) -> None:
        while True:
            await asyncio.sleep(interval)
            try:
                await self.sweep()
            except Exception:  # noqa: BLE001 - sweeper nedrīkst nokrist
                pass
