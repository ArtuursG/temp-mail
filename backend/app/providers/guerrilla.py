from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

import httpx

from ..models import MessageFull, MessageSummary
from .base import Provider, ProviderError, normalize_local_part, random_local_part

_API = "https://api.guerrillamail.com/ajax.php"
_UA = "Mozilla/5.0 (compatible; temp-mail/0.2)"
_DOMAIN = "guerrillamailblock.com"

# Guerrilla's content_type is unreliable (its welcome mail is "text" but wrapped
# in <pre> with entities) - decide from the body itself.
_HTML_TAG = re.compile(
    r"<(?:pre|a|p|div|br|table|tbody|tr|td|img|h[1-6]|ul|ol|li|span|strong|b|i|em"
    r"|blockquote|font|hr|body|html)[\s/>]",
    re.I,
)


def _ts(value: Any) -> datetime | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return datetime.fromtimestamp(n, tz=UTC)


class GuerrillaProvider(Provider):
    """Guerrilla Mail - keyless. Session = ``sid_token`` (+ the server's IP).

    The API no longer lets you change the domain (always ``guerrillamailblock.com``);
    the name before the @ can be chosen. Inboxes have no password: anyone who
    types the same name reads the same mail.
    """

    name = "guerrilla"
    label = "Guerrilla Mail"
    retention_seconds = 3600
    public_inboxes = True

    async def _call(self, params: dict[str, Any]) -> dict:
        try:
            resp = await self.client.get(_API, params=params, headers={"User-Agent": _UA})
        except httpx.HTTPError as exc:
            raise ProviderError(f"{self.label}: network error ({exc})") from exc
        if resp.status_code != 200:
            raise ProviderError(f"{self.label}: HTTP {resp.status_code}")
        try:
            data = resp.json()
        except ValueError:
            raise ProviderError(f"{self.label}: unexpected response (rate limited?)") from None
        if not data:
            raise ProviderError(f"{self.label}: empty response ({params.get('f')})")
        return data

    async def domains(self) -> list[str]:
        return [_DOMAIN]

    async def create_inbox(
        self, local_part: str | None = None, domain: str | None = None
    ) -> tuple[str, dict[str, Any]]:
        init = await self._call({"f": "get_email_address"})
        sid = init["sid_token"]
        user = normalize_local_part(local_part) or random_local_part(8, 12)
        try:
            setr = await self._call({"f": "set_email_user", "email_user": user, "sid_token": sid})
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
        return [
            MessageSummary(
                id=str(m["mail_id"]),
                from_addr=m.get("mail_from", ""),
                to_addr=session["address"],
                subject=m.get("mail_subject", ""),
                intro=(m.get("mail_excerpt") or "").strip(),
                received_at=_ts(m.get("mail_timestamp")),
                has_attachments=bool(m.get("att")),
            )
            for m in data.get("list", [])
        ]

    async def get_message(self, session: dict[str, Any], message_id: str) -> MessageFull:
        data = await self._call(
            {"f": "fetch_email", "email_id": message_id, "sid_token": session["sid_token"]}
        )
        if not data.get("mail_id"):
            raise ProviderError(f"{self.label}: message not found")
        body = data.get("mail_body", "") or ""
        is_html = data.get("content_type") == "html" or bool(_HTML_TAG.search(body))
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

    async def delete_message(self, session: dict[str, Any], message_id: str) -> None:
        await self._call(
            {"f": "del_email", "email_ids[]": message_id, "sid_token": session["sid_token"]}
        )
