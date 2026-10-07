from __future__ import annotations

import json
import threading

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.store import RateLimiter


class FakeMailTm:
    """Just enough of the mail.tm / mail.gw API to drive the backend."""

    def __init__(self) -> None:
        self.accounts: dict[str, dict] = {}  # address -> {id, password}
        self.tokens: dict[str, str] = {}  # token -> address
        self.messages: dict[str, list[dict]] = {}  # address -> list
        self.calls: list[str] = []

    def deliver(self, address: str, msg_id: str, subject: str, attachment: bytes | None = None):
        msg = {
            "id": msg_id,
            "from": {"address": "noreply@acme.example", "name": "Acme"},
            "subject": subject,
            "intro": "hello",
            "createdAt": "2026-10-07T12:00:00+00:00",
            "text": "Your code is 482913",
            "html": ["<p>Your code is <b>482913</b></p>"],
            "hasAttachments": attachment is not None,
            "attachments": [],
        }
        if attachment is not None:
            msg["attachments"] = [
                {
                    "id": "att1",
                    "filename": "report ä.pdf",
                    "contentType": "application/pdf",
                    "size": len(attachment),
                    "downloadUrl": f"/messages/{msg_id}/attachment/att1",
                }
            ]
            msg["_blob"] = attachment
        self.messages.setdefault(address, []).insert(0, msg)

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append(f"{request.method} {path}")
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        owner = self.tokens.get(token)
        if owner not in self.accounts:
            owner = None

        if request.method == "GET" and path == "/domains":
            return httpx.Response(
                200,
                json={
                    "hydra:member": [{"domain": "mock.tm", "isActive": True, "isPrivate": False}]
                },
            )
        if request.method == "POST" and path == "/accounts":
            body = json.loads(request.content)
            if body["address"] in self.accounts:
                return httpx.Response(
                    422, json={"hydra:description": "address: This value is already used."}
                )
            acc_id = f"acc{len(self.accounts) + 1}"
            self.accounts[body["address"]] = {"id": acc_id, "password": body["password"]}
            return httpx.Response(201, json={"id": acc_id, "address": body["address"]})
        if request.method == "POST" and path == "/token":
            body = json.loads(request.content)
            acc = self.accounts.get(body["address"])
            if not acc or acc["password"] != body["password"]:
                return httpx.Response(401, json={"message": "Invalid credentials."})
            tok = f"tok{len(self.tokens)}"
            self.tokens[tok] = body["address"]
            return httpx.Response(200, json={"id": acc["id"], "token": tok})
        if owner is None:
            return httpx.Response(401, json={"message": "JWT Token not found"})
        msgs = self.messages.get(owner, [])
        if request.method == "GET" and path == "/messages":
            listed = [
                {k: v for k, v in m.items() if k not in ("text", "html", "_blob")} for m in msgs
            ]
            return httpx.Response(200, json={"hydra:member": listed})
        parts = path.strip("/").split("/")
        if parts[0] == "messages":
            msg = next((m for m in msgs if m["id"] == parts[1]), None)
            if msg is None:
                return httpx.Response(404, json={"message": "Not Found"})
            if len(parts) == 4 and parts[2] == "attachment":
                return httpx.Response(200, content=msg["_blob"])
            if request.method == "DELETE":
                msgs.remove(msg)
                return httpx.Response(204)
            return httpx.Response(200, json={k: v for k, v in msg.items() if k != "_blob"})
        if request.method == "DELETE" and parts[0] == "accounts":
            self.accounts.pop(owner, None)
            return httpx.Response(204)
        return httpx.Response(404, json={"message": "unmocked"})


@pytest.fixture
def fake() -> FakeMailTm:
    return FakeMailTm()


def make_client(fake: FakeMailTm, **settings) -> TestClient:
    cfg = Settings(enabled_providers=["mailtm"], **settings)
    app = create_app(cfg, transport=httpx.MockTransport(fake.handler), serve_frontend=False)
    return TestClient(app)


@pytest.fixture
def client(fake: FakeMailTm):
    with make_client(fake) as c:
        yield c


def test_providers_report_retention_and_public_flag(client):
    assert client.get("/api/providers").json() == [
        {"name": "mailtm", "label": "Mail.tm", "retention_seconds": 604800, "public_inboxes": False}
    ]
    assert client.get("/api/providers/mailtm/domains").json() == ["mock.tm"]
    assert client.get("/api/providers/nope/domains").status_code == 404


def test_inbox_lifecycle(client, fake):
    r = client.post("/api/inboxes", json={"provider": "mailtm", "local_part": "Jane.Doe"})
    assert r.status_code == 200, r.text
    inbox = r.json()
    assert inbox["address"] == "jane.doe@mock.tm"
    base = f"/api/inboxes/{inbox['id']}"

    assert client.get(f"{base}/messages").json() == []
    fake.deliver("jane.doe@mock.tm", "m1", "Verify", attachment=b"%PDF-1")
    listed = client.get(f"{base}/messages").json()
    assert [m["id"] for m in listed] == ["m1"]
    assert listed[0]["has_attachments"] is True

    full = client.get(f"{base}/messages/m1").json()
    assert full["html"] == "<p>Your code is <b>482913</b></p>"
    assert full["attachments"] == [
        {"id": "att1", "filename": "report ä.pdf", "size": 6, "content_type": "application/pdf"}
    ]

    att = client.get(f"{base}/messages/m1/attachments/att1")
    assert att.status_code == 200
    assert att.content == b"%PDF-1"
    assert att.headers["content-disposition"].startswith("attachment;")
    assert att.headers["x-content-type-options"] == "nosniff"

    assert client.delete(f"{base}/messages/m1").json() == {"ok": True}
    assert client.get(f"{base}/messages").json() == []

    assert client.delete(base).json() == {"ok": True}
    assert "DELETE /accounts/acc1" in fake.calls
    assert client.get(f"{base}/messages").status_code == 404


def test_taken_name_is_409(client, fake):
    fake.accounts["taken@mock.tm"] = {"id": "x", "password": "y"}
    r = client.post("/api/inboxes", json={"provider": "mailtm", "local_part": "taken"})
    assert r.status_code == 409
    assert "already taken" in r.json()["detail"]


def test_random_name_retries_once_when_taken(client, fake, monkeypatch):
    names = iter(["dupe", "fresh"])
    monkeypatch.setattr("app.providers.mailtm.random_local_part", lambda: next(names))
    fake.accounts["dupe@mock.tm"] = {"id": "x", "password": "y"}
    r = client.post("/api/inboxes", json={"provider": "mailtm"})
    assert r.json()["address"] == "fresh@mock.tm"


def test_expired_token_is_renewed_with_the_password(client, fake):
    inbox = client.post("/api/inboxes", json={"provider": "mailtm"}).json()
    fake.tokens.clear()
    r = client.get(f"/api/inboxes/{inbox['id']}/messages")
    assert r.status_code == 200
    assert fake.calls.count("POST /token") == 2


def test_deleted_account_is_410(client, fake):
    inbox = client.post("/api/inboxes", json={"provider": "mailtm"}).json()
    fake.accounts.clear()
    r = client.get(f"/api/inboxes/{inbox['id']}/messages")
    assert r.status_code == 410


def test_unknown_provider_is_400(client):
    assert client.post("/api/inboxes", json={"provider": "nope"}).status_code == 400


def test_create_is_rate_limited_per_ip(fake):
    with make_client(fake, create_limit_per_minute=2) as c:
        codes = [c.post("/api/inboxes", json={"provider": "mailtm"}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_store_capacity(fake):
    with make_client(fake, max_inboxes=1) as c:
        assert c.post("/api/inboxes", json={"provider": "mailtm"}).status_code == 200
        assert c.post("/api/inboxes", json={"provider": "mailtm"}).status_code == 503
    # the second request never created an upstream account
    assert fake.calls.count("POST /accounts") == 1


def test_sse_stream_reports_new_mail_and_ends_when_inbox_is_deleted(fake):
    # TestClient collects the whole body before returning, so the mail arrival
    # and the deletion run on timers; the stream must then end by itself.
    with make_client(fake, poll_interval_seconds=0.02) as c:
        inbox = c.post("/api/inboxes", json={"provider": "mailtm"}).json()
        fake.deliver(inbox["address"], "m0", "Already there")
        store = c.app.state.store
        timers = [
            threading.Timer(0.2, fake.deliver, (inbox["address"], "m1", "Hello")),
            threading.Timer(0.5, lambda: store._items.pop(inbox["id"], None)),
        ]
        for tm in timers:
            tm.start()
        resp = c.get(f"/api/inboxes/{inbox['id']}/events")
        for tm in timers:
            tm.join()
    blocks = [b for b in resp.text.split("\n\n") if b.strip()]
    events = [b.split("\n")[0].removeprefix("event: ") for b in blocks]
    assert events[0] == "ready"
    assert events[-1] == "gone"
    messages = [
        json.loads(b.split("data: ", 1)[1]) for b in blocks if b.startswith("event: message")
    ]
    assert [m["id"] for m in messages] == ["m1"]  # m0 was there before the stream started


def test_rate_limiter_window():
    rl = RateLimiter(limit=2, window=60)
    assert [rl.hit("a"), rl.hit("a"), rl.hit("a"), rl.hit("b")] == [True, True, False, True]
    assert RateLimiter(limit=0).hit("x") is True
