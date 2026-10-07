from __future__ import annotations

import secrets

import httpx

from ..models import ProviderInfo
from .base import Provider
from .guerrilla import GuerrillaProvider
from .mailtm import MailGwProvider, MailTmProvider

_PROVIDER_CLASSES: list[type[Provider]] = [MailTmProvider, MailGwProvider, GuerrillaProvider]


class ProviderRegistry:
    def __init__(self, client: httpx.AsyncClient, enabled: list[str] | None = None) -> None:
        self._providers: dict[str, Provider] = {}
        for cls in _PROVIDER_CLASSES:
            if enabled and cls.name not in enabled:
                continue
            self._providers[cls.name] = cls(client)
        if not self._providers:
            raise RuntimeError("No provider enabled - check ENABLED_PROVIDERS")

    def names(self) -> list[str]:
        return list(self._providers)

    def info(self) -> list[ProviderInfo]:
        return [
            ProviderInfo(
                name=p.name,
                label=p.label,
                retention_seconds=p.retention_seconds,
                public_inboxes=p.public_inboxes,
            )
            for p in self._providers.values()
        ]

    def get(self, name: str) -> Provider:
        if name not in self._providers:
            raise KeyError(name)
        return self._providers[name]

    def random(self) -> Provider:
        return secrets.choice(list(self._providers.values()))
