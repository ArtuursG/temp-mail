from __future__ import annotations

import abc
import re
import secrets
import string
from typing import Any

import httpx

from ..models import MessageFull, MessageSummary

_ALPHABET = string.ascii_lowercase + string.digits


class ProviderError(RuntimeError):
    """An error coming from the upstream disposable-mail service."""

    #: HTTP status the API answers with
    status_code = 502


class AddressTaken(ProviderError):
    status_code = 409


class SessionExpired(ProviderError):
    """The upstream no longer accepts this inbox's credentials."""

    status_code = 410


class NotSupported(ProviderError):
    status_code = 501


def random_local_part(min_len: int = 10, max_len: int = 14) -> str:
    length = min_len + secrets.randbelow(max_len - min_len + 1)
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def normalize_local_part(value: str | None) -> str:
    """Lower-case, only [a-z0-9._-], at most 32 chars (what the upstreams accept)."""
    return re.sub(r"[^a-z0-9._-]", "", (value or "").strip().lower())[:32]


class Provider(abc.ABC):
    """A disposable-mail upstream.

    ``session`` is a provider-specific dict the server keeps and passes back on
    every call (e.g. the mail.tm bearer token, the Guerrilla ``sid_token``).
    """

    #: short id used by the API and configuration
    name: str
    #: human readable name
    label: str
    #: how long the upstream keeps mail
    retention_seconds: int = 3600
    #: anyone who knows the address can read the inbox
    public_inboxes: bool = False

    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    async def domains(self) -> list[str]:
        return []

    @abc.abstractmethod
    async def create_inbox(
        self, local_part: str | None = None, domain: str | None = None
    ) -> tuple[str, dict[str, Any]]:
        """Return ``(address, session)``."""

    @abc.abstractmethod
    async def list_messages(self, session: dict[str, Any]) -> list[MessageSummary]: ...

    @abc.abstractmethod
    async def get_message(self, session: dict[str, Any], message_id: str) -> MessageFull: ...

    async def delete_message(self, session: dict[str, Any], message_id: str) -> None:
        raise NotSupported(f"{self.label}: deleting messages is not supported")

    async def download_attachment(
        self, session: dict[str, Any], message_id: str, attachment_id: str
    ) -> tuple[bytes, str, str]:
        """Return ``(content, content_type, filename)``."""
        raise NotSupported(f"{self.label}: attachments are not supported")

    async def delete_inbox(self, session: dict[str, Any]) -> None:
        """Optional - many services expire inboxes on their own."""
        return None
