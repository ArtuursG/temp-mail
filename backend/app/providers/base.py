from __future__ import annotations

import abc
from typing import Any

import httpx

from ..models import MessageFull, MessageSummary


class ProviderError(RuntimeError):
    """Kļūda, kas nāk no augšup-plūsmas temp-mail servisa."""


class Provider(abc.ABC):
    """Abstrakts temp-mail providers.

    Katrs providers zina, kā:
      * izveidot jaunu vienreizēju adresi (create_inbox),
      * atgriezt vēstuļu sarakstu (list_messages),
      * atgriezt vienu pilnu vēstuli (get_message).

    ``session`` ir provider-specifisks dict, ko glabā serveris un padod atpakaļ
    katrā izsaukumā (piem. mail.tm bearer token, dropmail sesijas id).
    """

    #: īsais identifikators, ko lieto API un konfigurācijā
    name: str
    #: cilvēkam lasāms nosaukums
    label: str

    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    @abc.abstractmethod
    async def create_inbox(self) -> tuple[str, dict[str, Any]]:
        """Atgriež ``(address, session)``."""

    @abc.abstractmethod
    async def list_messages(self, session: dict[str, Any]) -> list[MessageSummary]:
        ...

    @abc.abstractmethod
    async def get_message(self, session: dict[str, Any], message_id: str) -> MessageFull:
        ...

    async def delete_inbox(self, session: dict[str, Any]) -> None:  # noqa: D401
        """Nav obligāti - daudzi servisi izbeidzas paši."""
        return None
