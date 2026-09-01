from __future__ import annotations

import random

import httpx

from .base import Provider
from .guerrilla import GuerrillaProvider
from .mailtm import MailGwProvider, MailTmProvider

_PROVIDER_CLASSES = [MailTmProvider, MailGwProvider, GuerrillaProvider]


class ProviderRegistry:
    def __init__(self, client: httpx.AsyncClient, enabled: list[str] | None = None) -> None:
        self._providers: dict[str, Provider] = {}
        for cls in _PROVIDER_CLASSES:
            if enabled and cls.name not in enabled:
                continue
            self._providers[cls.name] = cls(client)
        if not self._providers:
            raise RuntimeError("Nav aktivizēts neviens providers")

    def names(self) -> list[str]:
        return list(self._providers)

    def info(self) -> list[dict[str, str]]:
        return [{"name": p.name, "label": p.label} for p in self._providers.values()]

    def get(self, name: str) -> Provider:
        if name not in self._providers:
            raise KeyError(name)
        return self._providers[name]

    def random(self) -> Provider:
        return random.choice(list(self._providers.values()))
