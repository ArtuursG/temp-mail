from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings, get_settings
from .models import CreateInboxRequest, InboxPublic, MessageFull, MessageSummary, ProviderInfo
from .providers.base import ProviderError
from .providers.registry import ProviderRegistry
from .store import InboxSession, InboxStore, RateLimiter, StoreFull

# The GitHub Pages client lives in /docs and is fully static. The backend can
# serve it too (handy for local dev), and acts as a proxy for providers that
# don't allow browser origins (mail.tm). The client picks those up from
# /api/providers when it is served from here.
FRONTEND_DIR = Path(__file__).resolve().parents[2] / "docs"
USER_AGENT = "temp-mail/0.2 (+https://github.com/ArtuursG/temp-mail)"

router = APIRouter(prefix="/api")


def _public(inbox: InboxSession) -> InboxPublic:
    return InboxPublic(
        id=inbox.id,
        address=inbox.address,
        provider=inbox.provider.name,
        created_at=datetime.fromtimestamp(inbox.created_at, UTC),
        expires_at=datetime.fromtimestamp(inbox.expires_at, UTC),
    )


async def _require_inbox(request: Request, inbox_id: str) -> InboxSession:
    inbox = await request.app.state.store.get(inbox_id)
    if inbox is None:
        raise HTTPException(404, "Inbox not found or expired")
    return inbox


@router.get("/providers", response_model=list[ProviderInfo])
async def providers(request: Request) -> list[ProviderInfo]:
    return request.app.state.registry.info()


@router.get("/providers/{name}/domains", response_model=list[str])
async def provider_domains(request: Request, name: str) -> list[str]:
    try:
        provider = request.app.state.registry.get(name)
    except KeyError:
        raise HTTPException(404, f"Unknown provider: {name}") from None
    return await provider.domains()


@router.post("/inboxes", response_model=InboxPublic)
async def create_inbox(request: Request, body: CreateInboxRequest | None = None) -> InboxPublic:
    registry: ProviderRegistry = request.app.state.registry
    body = body or CreateInboxRequest()
    if body.provider:
        try:
            provider = registry.get(body.provider)
        except KeyError:
            raise HTTPException(400, f"Unknown provider: {body.provider}") from None
    else:
        provider = registry.random()

    # Every inbox costs an upstream account made from this server's IP: cap it.
    client_ip = request.client.host if request.client else "unknown"
    if not request.app.state.create_limiter.hit(client_ip):
        raise HTTPException(429, "Too many new inboxes - try again in a minute")
    if not await request.app.state.store.has_room():
        raise HTTPException(503, "Server is at its inbox limit - try again later")

    address, session = await provider.create_inbox(body.local_part, body.domain)
    try:
        inbox = await request.app.state.store.create(address, provider, session)
    except StoreFull:
        await provider.delete_inbox(session)
        raise HTTPException(503, "Server is at its inbox limit - try again later") from None
    return _public(inbox)


@router.get("/inboxes/{inbox_id}", response_model=InboxPublic)
async def get_inbox(request: Request, inbox_id: str) -> InboxPublic:
    return _public(await _require_inbox(request, inbox_id))


@router.get("/inboxes/{inbox_id}/messages", response_model=list[MessageSummary])
async def list_messages(request: Request, inbox_id: str) -> list[MessageSummary]:
    inbox = await _require_inbox(request, inbox_id)
    async with inbox.lock:
        return await inbox.provider.list_messages(inbox.session)


@router.get("/inboxes/{inbox_id}/messages/{message_id}", response_model=MessageFull)
async def get_message(request: Request, inbox_id: str, message_id: str) -> MessageFull:
    inbox = await _require_inbox(request, inbox_id)
    async with inbox.lock:
        return await inbox.provider.get_message(inbox.session, message_id)


@router.delete("/inboxes/{inbox_id}/messages/{message_id}")
async def delete_message(request: Request, inbox_id: str, message_id: str) -> dict[str, bool]:
    inbox = await _require_inbox(request, inbox_id)
    async with inbox.lock:
        await inbox.provider.delete_message(inbox.session, message_id)
    return {"ok": True}


@router.get("/inboxes/{inbox_id}/messages/{message_id}/attachments/{attachment_id}")
async def download_attachment(
    request: Request, inbox_id: str, message_id: str, attachment_id: str
) -> Response:
    inbox = await _require_inbox(request, inbox_id)
    async with inbox.lock:
        content, content_type, filename = await inbox.provider.download_attachment(
            inbox.session, message_id, attachment_id
        )
    return Response(
        content,
        media_type=content_type,
        headers={
            # always a download, never rendered on our origin
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/inboxes/{inbox_id}")
async def delete_inbox(request: Request, inbox_id: str) -> dict[str, bool]:
    inbox = await request.app.state.store.delete(inbox_id)
    if inbox is not None:
        try:
            await inbox.provider.delete_inbox(inbox.session)
        except Exception:  # noqa: BLE001 - best effort upstream cleanup
            pass
    return {"ok": True}


@router.get("/inboxes/{inbox_id}/events")
async def events(request: Request, inbox_id: str) -> StreamingResponse:
    """SSE: a `message` event per new mail, plus a periodic `ping`.

    The stream ends when the client disconnects or the inbox is deleted / expires.
    """
    inbox = await _require_inbox(request, inbox_id)
    store: InboxStore = request.app.state.store
    interval = request.app.state.settings.poll_interval_seconds

    async def stream():
        seen: set[str] = set()
        first = True  # first round only records what is already there
        while True:
            if await request.is_disconnected():
                break
            # also refreshes the TTL while someone is listening
            if await store.get(inbox_id) is None:
                yield f"event: gone\ndata: {json.dumps({'detail': 'Inbox deleted or expired'})}\n\n"
                break
            try:
                async with inbox.lock:
                    msgs = await inbox.provider.list_messages(inbox.session)
            except (ProviderError, httpx.HTTPError) as exc:
                yield f"event: error\ndata: {json.dumps({'detail': str(exc)})}\n\n"
                await asyncio.sleep(interval)
                continue

            if first:
                seen.update(m.id for m in msgs)
                yield f"event: ready\ndata: {json.dumps({'count': len(msgs)})}\n\n"
                first = False
            else:
                for m in reversed([m for m in msgs if m.id not in seen]):
                    seen.add(m.id)
                    yield f"event: message\ndata: {m.model_dump_json()}\n\n"
                yield f"event: ping\ndata: {json.dumps({'ts': time.time()})}\n\n"
            await asyncio.sleep(interval)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _provider_error(request: Request, exc: ProviderError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=exc.status_code)


async def _network_error(request: Request, exc: httpx.HTTPError) -> JSONResponse:
    return JSONResponse({"detail": f"Upstream network error ({exc})"}, status_code=502)


def create_app(
    settings: Settings | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    serve_frontend: bool = True,
) -> FastAPI:
    """Build the app. Tests pass `transport` to fake the upstream APIs."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0),
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
            transport=transport,
        )
        app.state.http = client
        app.state.registry = ProviderRegistry(client, settings.enabled_providers or None)
        app.state.store = InboxStore(settings.inbox_ttl_seconds, settings.max_inboxes)
        app.state.create_limiter = RateLimiter(settings.create_limit_per_minute)
        sweeper = asyncio.create_task(app.state.store.run_sweeper())
        try:
            yield
        finally:
            sweeper.cancel()
            await client.aclose()

    app = FastAPI(title="temp-mail", version="0.2.0", lifespan=lifespan)
    app.state.settings = settings
    app.add_exception_handler(ProviderError, _provider_error)
    app.add_exception_handler(httpx.HTTPError, _network_error)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    app.include_router(router)
    # Static frontend (the /docs client) at the web root, after the API routes.
    if serve_frontend and FRONTEND_DIR.is_dir():
        app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="site")
    return app


app = create_app()
