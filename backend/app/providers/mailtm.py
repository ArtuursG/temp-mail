from __future__ import annotations

import secrets
from datetime import datetime
from typing import Any

import httpx

from ..models import Attachment, MessageFull, MessageSummary
from .base import (
    AddressTaken,
    Provider,
    ProviderError,
    SessionExpired,
    normalize_local_part,
    random_local_part,
)


def _parse_dt(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return resp.reason_phrase or f"HTTP {resp.status_code}"
    if isinstance(body, dict):
        return str(
            body.get("hydra:description") or body.get("message") or body.get("detail") or body
        )
    return str(body)


class MailTmProvider(Provider):
    """mail.tm and mail.gw - the same API, only the base URL differs.

    Flow: /domains -> POST /accounts -> POST /token -> GET /messages.
    Free and keyless; rate-limited per IP.
    """

    name = "mailtm"
    label = "Mail.tm"
    base_url = "https://api.mail.tm"
    retention_seconds = 7 * 24 * 3600

    async def _request(self, method: str, path: str, **kw: Any) -> httpx.Response:
        try:
            return await self.client.request(method, f"{self.base_url}{path}", **kw)
        except httpx.HTTPError as exc:
            raise ProviderError(f"{self.label}: network error ({exc})") from exc

    async def domains(self) -> list[str]:
        resp = await self._request("GET", "/domains", params={"page": 1})
        if resp.status_code != 200:
            raise ProviderError(f"{self.label}: could not list domains ({resp.status_code})")
        data = resp.json()
        members = data.get("hydra:member") or data.get("member") or []
        return [d["domain"] for d in members if d.get("isActive", True) and not d.get("isPrivate")]

    async def _create_account(self, address: str, password: str) -> str:
        resp = await self._request(
            "POST", "/accounts", json={"address": address, "password": password}
        )
        if resp.status_code in (200, 201):
            return "ok"
        detail = _detail(resp)
        if resp.status_code == 422 and "already used" in detail.lower():
            return "taken"
        raise ProviderError(f"{self.label}: account creation failed ({detail})")

    async def _login(self, address: str, password: str) -> dict[str, Any]:
        resp = await self._request(
            "POST", "/token", json={"address": address, "password": password}
        )
        if resp.status_code == 401:
            raise SessionExpired(f"{self.label}: account no longer exists")
        if resp.status_code != 200:
            raise ProviderError(f"{self.label}: login failed ({_detail(resp)})")
        return resp.json()

    async def create_inbox(
        self, local_part: str | None = None, domain: str | None = None
    ) -> tuple[str, dict[str, Any]]:
        domains = await self.domains()
        if not domains:
            raise ProviderError(f"{self.label}: no active domains")
        if domain not in domains:
            domain = secrets.choice(domains)
        wanted = normalize_local_part(local_part)
        password = secrets.token_urlsafe(16)

        address = f"{wanted or random_local_part()}@{domain}"
        created = await self._create_account(address, password)
        if created == "taken":
            if wanted:
                raise AddressTaken(f"{self.label}: that address is already taken")
            address = f"{random_local_part()}@{domain}"
            created = await self._create_account(address, password)
        if created != "ok":
            raise ProviderError(f"{self.label}: could not create an account")

        token = await self._login(address, password)
        session = {
            "address": address,
            "password": password,
            "token": token["token"],
            "account_id": token.get("id", ""),
        }
        return address, session

    async def _authed(self, session: dict[str, Any], method: str, path: str) -> httpx.Response:
        """Authenticated call; on 401 log in again with the stored password, once."""
        for attempt in (1, 2):
            resp = await self._request(
                method, path, headers={"Authorization": f"Bearer {session['token']}"}
            )
            if resp.status_code != 401 or attempt == 2:
                break
            token = await self._login(session["address"], session["password"])
            session["token"] = token["token"]
        if resp.status_code == 401:
            raise SessionExpired(f"{self.label}: session expired")
        return resp

    async def list_messages(self, session: dict[str, Any]) -> list[MessageSummary]:
        resp = await self._authed(session, "GET", "/messages?page=1")
        if resp.status_code != 200:
            raise ProviderError(f"{self.label}: listing messages failed ({resp.status_code})")
        out: list[MessageSummary] = []
        for m in resp.json().get("hydra:member", []):
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

    async def _raw_message(self, session: dict[str, Any], message_id: str) -> dict[str, Any]:
        resp = await self._authed(session, "GET", f"/messages/{message_id}")
        if resp.status_code != 200:
            raise ProviderError(f"{self.label}: message not found ({resp.status_code})")
        return resp.json()

    async def get_message(self, session: dict[str, Any], message_id: str) -> MessageFull:
        m = await self._raw_message(session, message_id)
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
            attachments=[
                Attachment(
                    id=str(a.get("id")),
                    filename=a.get("filename") or "attachment",
                    size=int(a.get("size") or 0),
                    content_type=a.get("contentType") or "",
                )
                for a in m.get("attachments") or []
                if a.get("id")
            ],
        )

    async def download_attachment(
        self, session: dict[str, Any], message_id: str, attachment_id: str
    ) -> tuple[bytes, str, str]:
        # Use the downloadUrl the API hands out rather than guessing its format.
        m = await self._raw_message(session, message_id)
        att = next(
            (a for a in m.get("attachments") or [] if str(a.get("id")) == attachment_id), None
        )
        if not att or not att.get("downloadUrl"):
            raise ProviderError(f"{self.label}: attachment not found")
        resp = await self._authed(session, "GET", att["downloadUrl"])
        if resp.status_code != 200:
            raise ProviderError(f"{self.label}: attachment download failed ({resp.status_code})")
        content_type = att.get("contentType") or "application/octet-stream"
        return resp.content, content_type, att.get("filename") or "attachment"

    async def delete_message(self, session: dict[str, Any], message_id: str) -> None:
        resp = await self._authed(session, "DELETE", f"/messages/{message_id}")
        if resp.status_code not in (200, 204, 404):
            raise ProviderError(f"{self.label}: delete failed ({resp.status_code})")

    async def delete_inbox(self, session: dict[str, Any]) -> None:
        account_id = session.get("account_id")
        if not account_id:
            return
        try:
            await self._authed(session, "DELETE", f"/accounts/{account_id}")
        except ProviderError:
            pass


class MailGwProvider(MailTmProvider):
    name = "mailgw"
    label = "Mail.gw"
    base_url = "https://api.mail.gw"
