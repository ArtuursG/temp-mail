# temp-mail

**[Open the app](https://artuursg.github.io/temp-mail/)** - https://artuursg.github.io/temp-mail/

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

Real-time is short polling (Mail.gw every 4 s, Guerrilla every 8 s). A hidden tab
keeps polling (every 15 s or slower) only while alerts are on - that is when someone
is waiting in another tab for the notification. Every request has a 15 s timeout,
and polling backs off to 20 s while a provider answers HTTP 429. The inbox (address
+ session) is kept in `localStorage`, so a refresh keeps your mail; only a session
the provider rejects is thrown away - being offline or rate-limited on reload keeps
the address and retries. A rejected Mail.gw token is renewed with the stored
account password before giving up.

Adding a provider = one file in [`docs/js/providers/`](docs/js/providers/) exporting
`{ id, label, pollInterval, retention, retentionKey, retentionSeconds,
createInbox(opts), listMessages, getMessage, destroy }` plus optional `domains()`,
`deleteMessage(session, id)`, `downloadAttachment(session, att)`, `reauth(session)`
and `publicInboxes: true` (no password - shows a warning when picking a name); then
list it in `providers/index.js`. Throw errors made with `httpError(status, msg)`
from `common.js`, so 401 / 403 (session lost) and 429 (rate limit) are told apart.

---

## Design

"Disposable mail terminal" look: Inter + Geist Mono, 1px lines, boxy, purple
accent, uppercase mono labels. Layout: header (wordmark / status / theme / lang /
alerts), two tabs, address strip with a live expiry countdown + bar, toolbar,
then a message-list / reader split.

* **Fonts** - self-hosted woff2 in [`docs/fonts/`](docs/fonts/) via
  [`docs/css/fonts.css`](docs/css/fonts.css); no request to Google.
* **Theme** ([`docs/js/theme.js`](docs/js/theme.js)) - one toggle button,
  light / dark. First visit follows the OS setting; the choice is then stored and
  applied as `data-theme` on `<html>` before first paint. Both palettes are full
  token sets under `:root[data-theme="..."]` in [`docs/css/style.css`](docs/css/style.css).
* **Languages** ([`docs/js/i18n.js`](docs/js/i18n.js)) - `en`, `lv`, `de`, `es`
  (151 keys each). Static text uses `data-i18n` / `data-i18n-title` /
  `data-i18n-aria`; dynamic strings go through `t(key, vars)`.
* **Tabs**: **Inbox** and **What is temp mail** (about + FAQ accordion).
* **Features**:
  * verification **code** and **confirmation link** detection
    ([`docs/js/lib/detect.js`](docs/js/lib/detect.js)) on plain-text *and* HTML
    bodies. Codes are scored (near a keyword in en / lv / de / es, own line,
    6 digits); years, prices, dates, order numbers, phone numbers and URLs are
    skipped. The link box shows the target host before you open it;
  * attachment download (Mail.gw, backend providers); per-message delete;
  * pick-your-own address name (**Edit**) - a taken name keeps the current
    address and reopens the form;
  * **Recent** - up to five earlier addresses of this browser, switchable while
    their lifetime runs;
  * desktop alerts with an on / off toggle (clicking an alert opens the mail);
    unread count in the tab title; read state survives a reload;
  * **Burn it** asks first when the inbox holds mail.
* **Accessibility**: message rows are buttons (arrow keys / Home / End move
  between them), ARIA tab pattern for the tabs, the `aria-live` status only
  changes when its text does (no announcement on every poll), expiry bar is a
  `progressbar`, the mail frame has a title.
* **Lifetime** - a selector (10 min / 30 min / 1 h / Max, default **1 h**) for the
  current address. The countdown runs to that; at zero the address freezes,
  polling stops and the account is deleted upstream (Mail.gw; Guerrilla mail
  expires on its own after 1 h). An expired address stays expired - a new choice
  then applies to the next address. "Max" = the provider's own retention
  (Mail.gw 7 d, Guerrilla 1 h).
* **Installable**: [`docs/manifest.webmanifest`](docs/manifest.webmanifest) + icons.
* **Security**: page CSP (`script-src 'self'`, `connect-src` limited to the two
  mail APIs and the page's own origin for the optional backend),
  `referrer: no-referrer`, and a per-frame CSP on rendered HTML mail that blocks
  remote images / scripts / fonts. No external requests at all (fonts
  self-hosted).

---

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. **Settings -> Pages -> Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **`/docs`**
3. Save. The site publishes at `https://<user>.github.io/<repo>/`.

No build step: Pages serves `docs/` as is. GitHub Actions only runs the checks
below. `docs/.nojekyll` disables Jekyll processing.

---

## Local development

The static client uses ES modules, so it needs to be served over HTTP (not
`file://`). Either:

```bash
# plain static server (either one)
node scripts/serve.mjs --port 8000
cd docs && python -m http.server 8000
```

or run the backend (Python 3.11+), which serves `docs/` at the web root **and**
exposes a proxy API. The page asks `/api/providers` on load and adds the
providers the browser can't reach directly - so **Mail.tm (proxy)** shows up in
the Source list:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate         # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open <http://localhost:8000>.

---

## Tests

```bash
npm test                  # unit tests (node:test): code / link detection, helpers
npm run check:i18n        # key parity, every referenced key exists, no unused keys
npm ci && npx playwright install chromium
npm run test:e2e          # Playwright, Mail.gw / Guerrilla faked with page.route()

cd backend
pip install -r requirements-dev.txt
pytest -q                 # API tests, upstream faked with httpx.MockTransport
ruff check . && ruff format --check .
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of them. The
e2e tests never call the real mail services.

---

## Structure

```
docs/                     <- GitHub Pages site (the product)
  index.html, terms.html, privacy.html
  manifest.webmanifest, icons/
  css/style.css           design tokens in :root - iterate here
  css/fonts.css, fonts/   self-hosted Inter + Geist Mono
  js/
    app.js                state, polling, rendering, history, alerts
    i18n.js               translations (en / lv / de / es)
    theme.js              light / dark toggle (theme-init.js runs before paint)
    legal.js              bootstrap for the Terms / Privacy pages
    lib/
      detect.js           one-time code + confirmation link detection
      format.js           escaping, sizes
    providers/
      common.js           fetch with timeout, typed errors, shared helpers
      mailgw.js           Mail.gw
      guerrilla.js        Guerrilla Mail
      backend.js          providers proxied by the optional backend (/api)
      index.js            provider registry
  .nojekyll

tests/
  unit/                   node:test unit tests
  e2e/                    Playwright tests + fake mail APIs
scripts/
  check-i18n.mjs          i18n checks (CI)
  serve.mjs               static server for docs/ (dev + e2e)

backend/                  <- optional FastAPI app (local dev / future SMTP host)
  app/
    main.py               REST + SSE proxy, serves docs/
    providers/            server-side provider impls (incl. mail.tm)
    store.py              in-memory inbox store with TTL, rate limiter
  tests/                  pytest
  requirements.txt, requirements-dev.txt
```

---

## Backend API (optional)

| Method | Path | Purpose |
|--------|------|---------|
| `GET`    | `/api/providers` | available providers (name, label, retention, public inboxes) |
| `GET`    | `/api/providers/{name}/domains` | domains you can pick |
| `POST`   | `/api/inboxes` | create address; body (all optional): `{"provider": "mailtm", "local_part": "jane", "domain": "..."}` |
| `GET`    | `/api/inboxes/{id}` | inbox info |
| `GET`    | `/api/inboxes/{id}/messages` | list messages |
| `GET`    | `/api/inboxes/{id}/messages/{mid}` | full message incl. attachment list |
| `DELETE` | `/api/inboxes/{id}/messages/{mid}` | delete a message |
| `GET`    | `/api/inboxes/{id}/messages/{mid}/attachments/{aid}` | download (always `Content-Disposition: attachment`) |
| `GET`    | `/api/inboxes/{id}/events` | SSE stream (`ready`, `message`, `ping`, `error`; `gone` and end when the inbox is deleted / expires) |
| `DELETE` | `/api/inboxes/{id}` | delete inbox |

Errors: `404` unknown / expired inbox, `409` name taken, `410` upstream session
gone, `429` too many new inboxes from one IP (`CREATE_LIMIT_PER_MINUTE`, default
10), `503` inbox limit reached (`MAX_INBOXES`, default 500), `502` upstream
failure. Inboxes live in memory and are forgotten after `INBOX_TTL_SECONDS`
without a request. See [`backend/.env.example`](backend/.env.example).

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

* Free upstreams are rate-limited (Mail.gw ~30 req/min per IP).
* Guerrilla API no longer allows domain switching, and its inboxes are public.
* `localStorage` inboxes are per-browser; nothing is synced.
* No service worker: no offline mode, and browsers that only allow notifications
  from a service worker (Chrome on Android) show no alerts.
