# temp-mail

Disposable / temporary email addresses - like [mail.cx](https://mail.cx),
[temp-mail.org](https://temp-mail.org), [temp-mail.io](https://temp-mail.io).

The shipping product is a **static client** in [`docs/`](docs/) that runs on GitHub
Pages with no server. The [`backend/`](backend/) folder is an optional FastAPI app,
kept for local dev and for a future self-hosted mail server.

---

## How disposable-mail services work

1. **Own domain + `MX` DNS record** pointing at the service's mail server.
2. **Catch-all SMTP** - accepts mail for *any* address `@domain`, without
   checking whether that "mailbox" exists.
3. **Lazy mailbox** - the mailbox is created the moment the first mail arrives.
4. **Storage with TTL** - mail kept in a DB / memory, auto-deleted by a cron or
   TTL job (mail.cx ~1 h, mail.tm 7 days - it's a policy choice, not a limit).
5. **Real-time delivery** - SSE / WebSocket push, or short polling.
6. **Domain rotation** - several public domains so other services' spam filters
   don't block them all at once.

`mail.cx` runs its own SMTP gateway + SSE. `temp-mail.org` / `temp-mail.io` are
commercial and closed; their APIs are paid.

---

## This project's approach

No mail server of our own - instead the client calls **free public disposable-mail
APIs directly from the browser**. Only APIs that send `Access-Control-Allow-Origin: *`
can be used from a static site:

| Provider | API | CORS | Message retention | Notes |
|----------|-----|------|-------------------|-------|
| **Mail.gw** | `api.mail.gw` (REST) | `*` ✅ | **7 days** | primary; multiple rotating domains; mailbox lives until deleted |
| **Guerrilla Mail** | `api.guerrillamail.com` | `*` ✅ | **1 hour** | fallback; single domain `guerrillamailblock.com` |
| ~~Mail.tm~~ | `api.mail.tm` | only `*.mail.tm` ❌ | 7 days | same API as Mail.gw but browser-blocked; usable only through the backend proxy |

Retention is set by each upstream, not by us - we don't run the mail server. Real
services (mail.cx = 1 h, temp-mail.org, etc.) just run a cron / TTL job on their
own database. To control retention yourself you need a self-hosted catch-all SMTP
server (see below). Each provider module declares its `retention` string, shown in
the UI.

Real-time is short polling (Mail.gw every 4 s, Guerrilla every 8 s), paused while
the tab is hidden. The inbox (address + session token) is kept in `localStorage`
so a refresh keeps your mail.

Adding a provider = one file in [`docs/js/providers/`](docs/js/providers/) exporting
`{ id, label, pollInterval, retention, createInbox, listMessages, getMessage, destroy }`,
then listing it in `providers/index.js`.

---

## Design

"Disposable mail terminal" look: Inter + Geist Mono, 1px lines, boxy, purple
accent, uppercase mono labels. Layout: header (wordmark / status / theme / lang /
alerts), two tabs, address strip with a live expiry countdown + bar, toolbar,
then a message-list / reader split.

* **Theme** ([`docs/js/theme.js`](docs/js/theme.js)) - two buttons, **Light** /
  **Dark**. First visit follows the OS setting; the choice is then stored and
  applied as `data-theme` on `<html>` before first paint. Both palettes are full
  token sets under `:root[data-theme="..."]` in [`docs/css/style.css`](docs/css/style.css).
* **Languages** ([`docs/js/i18n.js`](docs/js/i18n.js)) - `en`, `lv`, `de`, `es`
  (93 keys each). Static text uses `data-i18n` / `data-i18n-title`; dynamic
  strings go through `t(key, vars)`. Add a language = one dictionary + a
  `LANGUAGES` entry.
* **Tabs**: **Inbox** and **What is temp mail** (about + FAQ accordion).
* **Extras**: verification-code detection (shows the OTP in a copy box),
  attachment chips with download (Mail.gw), sandboxed HTML rendering, desktop
  notifications, expiry countdown from `provider.retentionSeconds`.

---

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. **Settings -> Pages -> Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **`/docs`**
3. Save. The site publishes at `https://<user>.github.io/<repo>/`.

No build step, no GitHub Actions. `docs/.nojekyll` disables Jekyll processing.

---

## Local development

The static client uses ES modules, so it needs to be served over HTTP (not
`file://`). Either:

```bash
# plain static server
cd docs && python -m http.server 8000
```

or run the backend, which serves `docs/` at the web root **and** exposes a proxy
API (so Mail.tm works locally too):

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open <http://localhost:8000>.

---

## Structure

```
docs/                     <- GitHub Pages site (the product)
  index.html
  css/style.css           design tokens in :root - iterate here
  js/
    app.js                state, polling, rendering, OTP + attachments
    i18n.js               translations (en / lv / de / es)
    theme.js              light / dark toggle
    providers/
      common.js           shared helpers
      mailgw.js            Mail.gw
      guerrilla.js         Guerrilla Mail
      index.js             provider registry
  .nojekyll

backend/                  <- optional FastAPI app (local dev / future SMTP host)
  app/
    main.py               REST + SSE proxy, serves docs/
    providers/            server-side provider impls (incl. mail.tm)
    store.py              in-memory inbox store with TTL
  requirements.txt
```

---

## Backend API (optional)

| Method | Path | Purpose |
|--------|------|---------|
| `GET`    | `/api/providers` | available providers |
| `POST`   | `/api/inboxes` | create address; body: `{"provider": "mailtm"}` (optional) |
| `GET`    | `/api/inboxes/{id}/messages` | list messages |
| `GET`    | `/api/inboxes/{id}/messages/{mid}` | full message |
| `GET`    | `/api/inboxes/{id}/events` | SSE stream |
| `DELETE` | `/api/inboxes/{id}` | delete inbox |

---

## Self-hosting on Cloudflare (planned)

For a *real* disposable service - your own domain, your own retention - without
running a VPS:

1. **Domain on Cloudflare** + enable **Email Routing** (free). Cloudflare adds the
   `MX` records for you.
2. **Catch-all rule -> "Send to a Worker"** (an *Email Worker*). The Worker gets
   every incoming message, parses it (`PostalMime`), and stores it.
3. **Storage:**
   * **Workers KV** with `expirationTtl` - native per-key expiry, so retention is
     automatic and there is no cron. Best for personal use.
   * **D1** (SQLite) if you want to browse history; delete old rows with a
     **Cron Trigger** Worker.
4. **API Worker** (or Pages Functions) reads storage and returns JSON; you set the
   CORS header yourself, so a real-time SSE endpoint is possible too.
5. Frontend: add `docs/js/providers/selfhosted.js` pointing at the API Worker -
   the rest of the app is unchanged.

Everything above fits Cloudflare's free tier at personal volume. Only requirement:
a domain whose nameservers are on Cloudflare.

---

## Limitations / TODO

* No attachment download.
* Free upstreams are rate-limited (Mail.gw ~30 req/min per IP).
* Guerrilla API no longer allows domain switching.
* `localStorage` inbox is per-browser; nothing is synced.
* Design.
