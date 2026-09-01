from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


def _split(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


class Settings:
    inbox_ttl_seconds: int = int(os.getenv("INBOX_TTL_SECONDS", "3600"))
    poll_interval_seconds: float = float(os.getenv("POLL_INTERVAL_SECONDS", "5"))
    enabled_providers: list[str] = _split(os.getenv("ENABLED_PROVIDERS", ""))
    cors_origins: list[str] = _split(os.getenv("CORS_ORIGINS", ""))


@lru_cache
def get_settings() -> Settings:
    return Settings()
