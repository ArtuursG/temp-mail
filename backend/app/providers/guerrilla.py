from __future__ import annotations

import random
import re
import secrets
import string
from datetime import datetime, timezone
from typing import Any

import httpx

from ..models import MessageFull, MessageSummary
from .base import Provider, ProviderError

_API = "https://api.guerrillamail.com/ajax.php"
_UA = "Mozilla/5.0 (compatible; temp-mail-lv/0.1)"
_ALPHABET = string.ascii_lowercase + string.digits


def _local_part() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(random.randint(8, 12)))


def _ts(value: Any) -> datetime | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return datetime.fromtimestamp(n, tz=timezone.utc)


class GuerrillaProvider(Provider):
    """Guerrilla Mail - bez atslēgas. Sesija = ``sid_token`` (+ servera IP).

    Piezīme: 2026. gadā API vairs neļauj mainīt domēnu (vienmēr atgriež
    ``guerrillamailblock.com``); lietotājvārdu var izvēlēties.
    """

    name = "guerrilla"
    label = "Guerrilla Mail"

    async def _call(self, params: dict[str, Any]) -> dict:
        try:
            resp = await self.client.get(_API, params=params, headers={"User-Agent": _UA})
        except httpx.HTTPError as exc:
            raise ProviderError(f"{self.label}: tīkla kļūda ({exc})") from exc
        if resp.status_code != 200:
            raise ProviderError(f"{self.label}: HTTP {resp.status_code}")
        try:
            data = resp.json()
        except ValueError:
            raise ProviderError(
                f"{self.label}: negaidīta atbilde (iespējams ātruma ierobežojums)"
            ) from None
        if not data:
            raise ProviderError(f"{self.label}: tukša atbilde ({params.get('f')})")
        return data

    async def create_inbox(self) -> tuple[str, dict[str, Any]]:
        init = await self._call({"f": "get_email_address"})
        sid = init["sid_token"]
        try:
            setr = await self._call(
                {"f": "set_email_user", "email_user": _local_part(), "sid_token": sid}
            )
            sid = setr.get("sid_token", sid)
            address = setr.get("email_addr") or init["email_addr"]
        except ProviderError:
            address = init["email_addr"]
        return address, {"sid_token": sid, "address": address}

    async def list_messages(self, session: dict[str, Any]) -> list[MessageSummary]:
        data = await self._call(
            {"f": "get_email_list", "offset": 0, "sid_token": session["sid_token"]}
        )
        session["sid_token"] = data.get("sid_token", session["sid_token"])
        out: list[MessageSummary] = []
        for m in data.get("list", []):
            out.append(
                MessageSummary(
                    id=str(m["mail_id"]),
                    from_addr=m.get("mail_from", ""),
                    to_addr=session["address"],
                    subject=m.get("mail_subject", ""),
                    intro=(m.get("mail_excerpt") or "").strip(),
                    received_at=_ts(m.get("mail_timestamp")),
                    has_attachments=bool(m.get("att")),
                )
            )
        return out

    async def get_message(self, session: dict[str, Any], message_id: str) -> MessageFull:
        data = await self._call(
            {"f": "fetch_email", "email_id": message_id, "sid_token": session["sid_token"]}
        )
        if not data.get("mail_id"):
            raise ProviderError(f"{self.label}: vēstule neatrasta")
        body = data.get("mail_body", "") or ""
        # Guerrilla's content_type is unreliable - decide from the body itself.
        is_html = data.get("content_type") == "html" or bool(
            re.search(
                r"<(?:pre|a|p|div|br|table|img|h[1-6]|ul|ol|li|span|strong|b|i|em|font|hr|body|html)[\s/>]",
                body,
                re.I,
            )
        )
        return MessageFull(
            id=str(data["mail_id"]),
            from_addr=data.get("mail_from", ""),
            to_addr=session["address"],
            subject=data.get("mail_subject", ""),
            intro=(data.get("mail_excerpt") or "").strip(),
            received_at=_ts(data.get("mail_timestamp")),
            has_attachments=bool(data.get("att")),
            text="" if is_html else body,
            html=body if is_html else "",
        )
