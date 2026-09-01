from __future__ import annotations

import random
import secrets
import string
from datetime import datetime
from typing import Any

import httpx

from ..models import MessageFull, MessageSummary
from .base import Provider, ProviderError

_ALPHABET = string.ascii_lowercase + string.digits


def _random_local_part() -> str:
    length = random.randint(9, 14)
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def _parse_dt(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class MailTmProvider(Provider):
    """mail.tm un mail.gw - vienāda API, atšķiras tikai bāzes URL.

    Plūsma: /domains -> POST /accounts -> POST /token -> GET /messages.
    Pieejams bez maksas, bez atslēgas. Limits ~8 pieprasījumi/s uz IP.
    """

    name = "mailtm"
    label = "Mail.tm"
    base_url = "https://api.mail.tm"

    async def _pick_domain(self) -> str:
        resp = await self.client.get(f"{self.base_url}/domains", params={"page": 1})
        if resp.status_code != 200:
            raise ProviderError(f"{self.label}: neizdevās saņemt domēnus ({resp.status_code})")
        data = resp.json()
        members = data.get("hydra:member") or data.get("member") or []
        active = [d["domain"] for d in members if d.get("isActive", True) and not d.get("isPrivate")]
        if not active:
            raise ProviderError(f"{self.label}: nav aktīvu domēnu")
        return random.choice(active)

    async def create_inbox(self) -> tuple[str, dict[str, Any]]:
        domain = await self._pick_domain()
        address = f"{_random_local_part()}@{domain}"
        password = secrets.token_urlsafe(16)

        acc = await self.client.post(
            f"{self.base_url}/accounts",
            json={"address": address, "password": password},
        )
        if acc.status_code == 422:
            # ģenerētā adrese jau aizņemta - mēģinām vēlreiz vienu reizi
            address = f"{_random_local_part()}@{domain}"
            acc = await self.client.post(
                f"{self.base_url}/accounts",
                json={"address": address, "password": password},
            )
        if acc.status_code not in (200, 201):
            raise ProviderError(f"{self.label}: konta izveide neizdevās ({acc.status_code})")

        tok = await self.client.post(
            f"{self.base_url}/token",
            json={"address": address, "password": password},
        )
        if tok.status_code != 200:
            raise ProviderError(f"{self.label}: token neizdevās ({tok.status_code})")

        payload = tok.json()
        session = {
            "address": address,
            "password": password,
            "token": payload["token"],
            "account_id": payload.get("id", ""),
        }
        return address, session

    def _auth(self, session: dict[str, Any]) -> dict[str, str]:
        return {"Authorization": f"Bearer {session['token']}"}

    async def list_messages(self, session: dict[str, Any]) -> list[MessageSummary]:
        resp = await self.client.get(
            f"{self.base_url}/messages",
            params={"page": 1},
            headers=self._auth(session),
        )
        if resp.status_code == 401:
            raise ProviderError(f"{self.label}: sesija beigusies")
        if resp.status_code != 200:
            raise ProviderError(f"{self.label}: vēstuļu saraksts neizdevās ({resp.status_code})")
        members = resp.json().get("hydra:member", [])
        out: list[MessageSummary] = []
        for m in members:
            frm = m.get("from") or {}
            out.append(
                MessageSummary(
                    id=str(m["id"]),
                    from_addr=frm.get("address", ""),
                    from_name=frm.get("name", ""),
                    to_addr=session["address"],
                    subject=m.get("subject", ""),
                    intro=m.get("intro", ""),
                    received_at=_parse_dt(m.get("createdAt")),
                    has_attachments=bool(m.get("hasAttachments")),
                )
            )
        return out

    async def get_message(self, session: dict[str, Any], message_id: str) -> MessageFull:
        resp = await self.client.get(
            f"{self.base_url}/messages/{message_id}",
            headers=self._auth(session),
        )
        if resp.status_code != 200:
            raise ProviderError(f"{self.label}: vēstule neatrasta ({resp.status_code})")
        m = resp.json()
        frm = m.get("from") or {}
        html = m.get("html") or []
        return MessageFull(
            id=str(m["id"]),
            from_addr=frm.get("address", ""),
            from_name=frm.get("name", ""),
            to_addr=session["address"],
            subject=m.get("subject", ""),
            intro=m.get("intro", ""),
            received_at=_parse_dt(m.get("createdAt")),
            has_attachments=bool(m.get("hasAttachments")),
            text=m.get("text", ""),
            html="\n".join(html) if isinstance(html, list) else str(html),
        )

    async def delete_inbox(self, session: dict[str, Any]) -> None:
        account_id = session.get("account_id")
        if not account_id:
            return
        try:
            await self.client.delete(
                f"{self.base_url}/accounts/{account_id}",
                headers=self._auth(session),
            )
        except httpx.HTTPError:
            pass


class MailGwProvider(MailTmProvider):
    name = "mailgw"
    label = "Mail.gw"
    base_url = "https://api.mail.gw"
