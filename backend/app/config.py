from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


def _split(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


def _int(name: str, default: int) -> int:
    return int(os.getenv(name, str(default)))


@dataclass
class Settings:
    #: seconds an inbox is kept in memory without any request touching it
    inbox_ttl_seconds: int = 3600
    #: SSE stream: seconds between upstream checks
    poll_interval_seconds: float = 5.0
    #: provider names to enable (empty = all)
    enabled_providers: list[str] = field(default_factory=list)
    #: CORS origins allowed to call the API (empty = same origin only)
    cors_origins: list[str] = field(default_factory=list)
    #: new inboxes per client IP per minute (0 = unlimited)
    create_limit_per_minute: int = 10
    #: inboxes held in memory at once (0 = unlimited)
    max_inboxes: int = 500

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            inbox_ttl_seconds=_int("INBOX_TTL_SECONDS", 3600),
            poll_interval_seconds=float(os.getenv("POLL_INTERVAL_SECONDS", "5")),
            enabled_providers=_split(os.getenv("ENABLED_PROVIDERS", "")),
            cors_origins=_split(os.getenv("CORS_ORIGINS", "")),
            create_limit_per_minute=_int("CREATE_LIMIT_PER_MINUTE", 10),
            max_inboxes=_int("MAX_INBOXES", 500),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings.from_env()
