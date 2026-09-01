from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .models import CreateInboxRequest, InboxPublic, MessageFull, MessageSummary
from .providers.base import ProviderError
from .providers.registry import ProviderRegistry
from .store import InboxSession, InboxStore

# The GitHub Pages client lives in /docs and is fully static. The backend can
# serve it too (handy for local dev, and as an optional CORS proxy for providers
# that don't allow browser origins, e.g. mail.tm).
FRONTEND_DIR = Path(__file__).resolve().parents[2] / "docs"

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(20.0),
        headers={"User-Agent": "temp-mail-lv/0.1 (+https://github.com/)"},
        follow_redirects=True,
    )
    app.state.http = client
    app.state.registry = ProviderRegistry(client, settings.enabled_providers or None)
    app.state.store = InboxStore(settings.inbox_ttl_seconds)
    sweeper = asyncio.create_task(app.state.store.run_sweeper())
    try:
        yield
    finally:
        sweeper.cancel()
        await client.aclose()


app = FastAPI(title="temp-mail-lv", version="0.1.0", lifespan=lifespan)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def _public(inbox: InboxSession) -> InboxPublic:
    import datetime as _dt

    return InboxPublic(
        id=inbox.id,
        address=inbox.address,
        provider=inbox.provider.name,
        created_at=_dt.datetime.fromtimestamp(inbox.created_at, _dt.timezone.utc),
        expires_at=_dt.datetime.fromtimestamp(inbox.expires_at, _dt.timezone.utc),
    )


async def _require_inbox(request: Request, inbox_id: str) -> InboxSession:
    inbox = await request.app.state.store.get(inbox_id)
    if inbox is None:
        raise HTTPException(404, "Inbox nav atrasts vai ir beidzies")
    return inbox


@app.get("/api/providers")
async def providers(request: Request) -> list[dict[str, str]]:
    return request.app.state.registry.info()


@app.post("/api/inboxes", response_model=InboxPublic)
async def create_inbox(request: Request, body: CreateInboxRequest | None = None) -> InboxPublic:
    registry: ProviderRegistry = request.app.state.registry
    body = body or CreateInboxRequest()
    if body.provider:
        try:
            provider = registry.get(body.provider)
        except KeyError:
            raise HTTPException(400, f"Nezināms providers: {body.provider}")
    else:
        provider = registry.random()

    try:
        address, session = await provider.create_inbox()
    except ProviderError as exc:
        raise HTTPException(502, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"{provider.label}: tīkla kļūda ({exc})")

    inbox = await request.app.state.store.create(address, provider, session)
    return _public(inbox)


@app.get("/api/inboxes/{inbox_id}", response_model=InboxPublic)
async def get_inbox(request: Request, inbox_id: str) -> InboxPublic:
    return _public(await _require_inbox(request, inbox_id))


@app.get("/api/inboxes/{inbox_id}/messages", response_model=list[MessageSummary])
async def list_messages(request: Request, inbox_id: str) -> list[MessageSummary]:
    inbox = await _require_inbox(request, inbox_id)
    async with inbox.lock:
        try:
            return await inbox.provider.list_messages(inbox.session)
        except ProviderError as exc:
            raise HTTPException(502, str(exc))


@app.get("/api/inboxes/{inbox_id}/messages/{message_id}", response_model=MessageFull)
async def get_message(request: Request, inbox_id: str, message_id: str) -> MessageFull:
    inbox = await _require_inbox(request, inbox_id)
    async with inbox.lock:
        try:
            return await inbox.provider.get_message(inbox.session, message_id)
        except ProviderError as exc:
            raise HTTPException(502, str(exc))


@app.delete("/api/inboxes/{inbox_id}")
async def delete_inbox(request: Request, inbox_id: str) -> dict[str, bool]:
    inbox = await request.app.state.store.delete(inbox_id)
    if inbox is not None:
        try:
            await inbox.provider.delete_inbox(inbox.session)
        except Exception:  # noqa: BLE001
            pass
    return {"ok": True}


@app.get("/api/inboxes/{inbox_id}/events")
async def events(request: Request, inbox_id: str) -> StreamingResponse:
    """SSE: sūta 'message' notikumu par katru jaunu vēstuli + periodisku 'ping'."""
    inbox = await _require_inbox(request, inbox_id)
    interval = settings.poll_interval_seconds

    async def stream():
        seen: set[str] = set()
        # pirmajā ciklā tikai iegaumējam esošās vēstules, tālāk sūtām jaunās
        first = True
        while True:
            if await request.is_disconnected():
                break
            try:
                async with inbox.lock:
                    msgs = await inbox.provider.list_messages(inbox.session)
            except (ProviderError, httpx.HTTPError) as exc:
                yield f"event: error\ndata: {json.dumps({'detail': str(exc)})}\n\n"
                await asyncio.sleep(interval)
                continue

            fresh = [m for m in msgs if m.id not in seen]
            for m in reversed(fresh):
                seen.add(m.id)
                if not first:
                    yield f"event: message\ndata: {m.model_dump_json()}\n\n"
            if first:
                seen.update(m.id for m in msgs)
                yield f"event: ready\ndata: {json.dumps({'count': len(msgs)})}\n\n"
                first = False
            else:
                yield f"event: ping\ndata: {json.dumps({'ts': asyncio.get_event_loop().time()})}\n\n"

            # atsvaidzinām TTL
            await request.app.state.store.get(inbox_id)
            await asyncio.sleep(interval)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---- Static frontend (the /docs client, mounted at web root) ---------------
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="site")
