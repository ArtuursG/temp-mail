import {
  providers,
  getProvider,
  hasProvider,
  loadBackendProviders,
  DEFAULT_PROVIDER,
} from "./providers/index.js";
import { isRateLimit, isSessionLost } from "./providers/common.js";
import {
  LANGUAGES,
  applyStaticTranslations,
  getLang,
  initLang,
  onLangChange,
  setLang,
  t,
} from "./i18n.js";
import { initTheme } from "./theme.js";
import { extractTextLinks, findCode, pickActionLink } from "./lib/detect.js";
import { esc, escSrcdoc, fmtSize } from "./lib/format.js";

const STORAGE_KEY = "tempmail:inbox:v1";
const HISTORY_KEY = "tempmail:history:v1";
const LIFETIME_KEY = "tempmail:lifetime";
const NOTIFY_KEY = "tempmail:notify";
const LIFETIMES = ["600", "1800", "3600", "max"];
const HISTORY_MAX = 5;
const SEEN_MAX = 200;
const NOTICE_MS = 8000; // how long an error from a user action stays in the status line
const BASE_TITLE = document.title;

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");

const state = {
  inbox: null, // { provider, address, session, createdAt, lifetime, seen: [] }
  gen: 0, // bumped whenever the inbox changes; async results from an older gen are dropped
  messages: [],
  seen: new Set(),
  deleted: new Set(), // deleted locally; hidden even if the server-side delete failed
  primed: false, // first poll of this inbox done - only mail after that triggers alerts
  activeId: null,
  activeMessage: null,
  pollLoop: null,
  pollTimer: null,
  clockTimer: null,
  pollingGen: -1, // gen of the poll in flight, so a stale request can't block a new inbox
  creating: false,
  rateLimitedUntil: 0,
  expired: false,
  lifetime: readPref(LIFETIME_KEY, LIFETIMES, "3600"),
  notify: false,
  history: [],
  status: { key: "status.starting", vars: null, until: 0 },
  listHtml: "",
};

/* ---------- persistence ---------- */
function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeJSON(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked or full - the app still works for this tab */
  }
}
function readPref(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function saveInbox() {
  if (!state.inbox || state.expired) return;
  state.inbox.seen = [...state.seen].slice(-SEEN_MAX);
  writeJSON(STORAGE_KEY, state.inbox);
}

/* ---------- lifetime ---------- */
function lifetimeSeconds(inbox) {
  const cap = getProvider(inbox.provider).retentionSeconds || 3600;
  const choice = inbox.lifetime || state.lifetime;
  return choice === "max" ? cap : Math.min(Number(choice), cap);
}
function secondsLeft(inbox) {
  return lifetimeSeconds(inbox) - (Date.now() - inbox.createdAt) / 1000;
}

/* ---------- status ---------- */
// The status text is an aria-live region: only touch it when the text really
// changes, or screen readers announce every background poll.
function setStatus(key, vars = null, { notice = false } = {}) {
  state.status = { key, vars, until: notice ? Date.now() + NOTICE_MS : 0 };
  renderStatus();
}
function renderStatus() {
  const text = t(state.status.key, state.status.vars);
  const el = $("#status");
  if (el.textContent !== text) {
    el.textContent = text;
    el.title = text; // the line is truncated on narrow headers
  }
}
function setBusy(on) {
  $("#status-dot").classList.toggle("busy", on);
}
function unreadCount() {
  return state.messages.filter(isUnread).length;
}
function isUnread(m) {
  return !m.seen && !state.seen.has(m.id);
}
function renderLiveStatus() {
  const unread = unreadCount();
  document.title = unread && !state.expired ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
  if (state.expired) return; // keep the expired / session-lost message
  if (state.creating) return; // "Requesting address" until the new one is in
  if (state.status.until > Date.now()) return; // let an error notice be read first
  if (!state.messages.length) setStatus("status.liveNoMail");
  else if (unread) setStatus("status.liveUnread", { n: unread });
  else setStatus("status.live");
}

/* ---------- inbox lifecycle ---------- */
// Make `inbox` the current one: fresh view state, then start its clock.
function adopt(inbox) {
  stopPolling();
  state.gen++;
  if (inbox) {
    // The selector shows (and sets) the current address's lifetime.
    if (!LIFETIMES.includes(inbox.lifetime)) inbox.lifetime = state.lifetime;
    state.lifetime = inbox.lifetime;
    $("#lifetime").value = inbox.lifetime;
    writePref(LIFETIME_KEY, inbox.lifetime);
  }
  state.inbox = inbox;
  state.messages = [];
  state.seen = new Set(inbox?.seen || []);
  state.deleted = new Set();
  state.primed = false;
  state.activeId = null;
  state.activeMessage = null;
  state.rateLimitedUntil = 0;
  state.expired = false;
  $(".app").classList.remove("expired");
  closeAddressEdit();
  saveInbox();
  renderAll();
  if (inbox) startClock();
  else stopClock();
}

// Create a new address. The current one stays live until the new one exists,
// so a failure (name taken, network down) leaves the user where they were.
async function createInbox(providerId, opts = {}) {
  if (state.creating) return false;
  const provider = getProvider(providerId || DEFAULT_PROVIDER);
  state.creating = true;
  setBusy(true);
  setStatus("status.generating");
  renderHeader();
  renderList();
  try {
    const created = await provider.createInbox(opts);
    if (state.inbox && !state.expired) pushHistory(state.inbox);
    adopt({ ...created, createdAt: Date.now(), lifetime: state.lifetime, seen: [] });
    await pollOnce();
    startPolling();
    return true;
  } catch (err) {
    setStatus("status.createFail", { error: err.message }, { notice: true });
    return false;
  } finally {
    state.creating = false;
    setBusy(state.pollingGen !== -1);
    renderHeader();
    renderList();
    if (state.status.key === "status.generating") renderLiveStatus();
  }
}

// Pick up the inbox saved by an earlier visit. Only a rejected session throws
// it away; being offline or rate-limited keeps the address and retries.
async function resumeStored() {
  const stored = readJSON(STORAGE_KEY);
  if (!stored || !stored.session || !stored.address || !hasProvider(stored.provider)) {
    writeJSON(STORAGE_KEY, null);
    return false;
  }
  if (secondsLeft(stored) <= 0) {
    getProvider(stored.provider).destroy(stored.session).catch(() => {});
    writeJSON(STORAGE_KEY, null);
    return false;
  }
  adopt(stored);
  if ((await pollOnce()) === "lost") return false;
  startPolling();
  return true;
}

function burnInbox() {
  if (state.creating) return;
  const n = state.messages.length;
  if (state.inbox && !state.expired && n && !window.confirm(t("confirm.burn", { n }))) return;
  if (state.inbox) getProvider(state.inbox.provider).destroy(state.inbox.session).catch(() => {});
  writeJSON(STORAGE_KEY, null);
  adopt(null);
  createInbox($("#provider").value);
}

// The provider rejected the session for good: freeze like an expired address.
function sessionLost() {
  stopPolling();
  state.expired = true;
  writeJSON(STORAGE_KEY, null);
  $(".app").classList.add("expired");
  document.title = BASE_TITLE;
  setStatus("status.sessionLost");
}

/* ---------- history ---------- */
function loadHistory() {
  const list = readJSON(HISTORY_KEY);
  state.history = Array.isArray(list) ? list : [];
  pruneHistory();
}
// Drop entries past their lifetime (and delete them upstream, like an expiring
// current address), entries for providers this page doesn't have, and overflow.
function pruneHistory() {
  const keep = [];
  for (const h of state.history) {
    if (!h || !h.session || !h.address || !hasProvider(h.provider)) continue;
    if (secondsLeft(h) <= 0 || keep.length >= HISTORY_MAX) {
      getProvider(h.provider).destroy(h.session).catch(() => {});
      continue;
    }
    keep.push(h);
  }
  state.history = keep;
  writeJSON(HISTORY_KEY, keep.length ? keep : null);
}
function pushHistory(inbox) {
  if (inbox === state.inbox) inbox.seen = [...state.seen].slice(-SEEN_MAX);
  state.history = [{ ...inbox }, ...state.history.filter((h) => h.address !== inbox.address)];
  pruneHistory();
  renderHistory();
}
async function switchToHistory(address) {
  const entry = state.history.find((h) => h.address === address);
  if (!entry || state.creating) return;
  const provider = getProvider(entry.provider);
  state.creating = true;
  setBusy(true);
  setStatus("status.syncing");
  let incoming;
  try {
    incoming = await listWithReauth(provider, entry.session); // validate before swapping
  } catch (err) {
    if (isSessionLost(err)) {
      state.history = state.history.filter((h) => h !== entry);
      pruneHistory();
      setStatus("status.sessionLost", null, { notice: true });
    } else {
      setStatus("status.error", { error: err.message }, { notice: true });
    }
    return;
  } finally {
    state.creating = false;
    setBusy(false);
    renderHistory();
  }
  state.history = state.history.filter((h) => h !== entry);
  if (state.inbox && !state.expired) pushHistory(state.inbox);
  else pruneHistory();
  adopt(entry);
  applyMessages(incoming);
  saveInbox();
  startPolling();
}
function renderHistory() {
  const sel = $("#history");
  $("#history-wrap").hidden = !state.history.length;
  sel.innerHTML =
    `<option value="">-</option>` +
    state.history.map((h) => `<option value="${esc(h.address)}">${esc(h.address)}</option>`).join("");
  sel.value = "";
}

/* ---------- polling + clock ---------- */
// Self-scheduling loop so the delay can grow when a provider rate-limits us.
// Each loop has its own token, so a stopped loop can't reschedule itself.
function startPolling() {
  stopPolling();
  if (!state.inbox || state.expired) return;
  const loop = {};
  state.pollLoop = loop;
  scheduleNextPoll(loop);
}
function stopPolling() {
  state.pollLoop = null;
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = null;
}
function scheduleNextPoll(loop) {
  if (loop !== state.pollLoop || !state.inbox || state.expired) return;
  const base = getProvider(state.inbox.provider).pollInterval || 5000;
  let delay = base;
  if (state.rateLimitedUntil > Date.now()) delay = Math.max(base, 20000);
  else if (document.hidden) delay = Math.max(base * 3, 15000);
  state.pollTimer = setTimeout(async () => {
    // A hidden tab keeps polling only when alerts are on - that is the case
    // where someone is waiting in another tab for the notification.
    if (!document.hidden || state.notify) await pollOnce();
    scheduleNextPoll(loop);
  }, delay);
}
function startClock() {
  stopClock();
  renderClock();
  state.clockTimer = setInterval(renderClock, 1000);
}
function stopClock() {
  if (state.clockTimer) clearInterval(state.clockTimer);
  state.clockTimer = null;
}

async function listWithReauth(provider, session) {
  try {
    return await provider.listMessages(session);
  } catch (err) {
    if (!isSessionLost(err) || !provider.reauth) throw err;
    await provider.reauth(session);
    return provider.listMessages(session);
  }
}

// One mailbox check. Returns "ok" | "lost" | "error" | "skip".
async function pollOnce({ manual = false } = {}) {
  const inbox = state.inbox;
  const gen = state.gen;
  if (!inbox || state.expired || state.pollingGen === gen) return "skip";
  state.pollingGen = gen;
  setBusy(true);
  if (manual) setStatus("status.syncing");
  const stale = () => gen !== state.gen || state.expired;
  try {
    const incoming = await listWithReauth(getProvider(inbox.provider), inbox.session);
    if (stale()) return "skip";
    const wasThrottled = state.rateLimitedUntil > 0;
    state.rateLimitedUntil = 0;
    if (wasThrottled) renderHeader();
    applyMessages(incoming);
    saveInbox(); // Guerrilla rotates sid_token, Mail.gw may have re-logged in
    return "ok";
  } catch (err) {
    if (stale()) return "skip";
    if (isSessionLost(err)) {
      sessionLost();
      return "lost";
    }
    if (isRateLimit(err)) {
      state.rateLimitedUntil = Date.now() + 60000;
      setStatus("status.throttled");
      renderHeader();
    } else {
      setStatus("status.error", { error: err.message });
    }
    return "error";
  } finally {
    if (state.pollingGen === gen) state.pollingGen = -1;
    setBusy(state.creating || state.pollingGen !== -1);
  }
}

function applyMessages(incoming) {
  const known = new Set(state.messages.map((m) => m.id));
  const list = incoming
    .filter((m) => !state.deleted.has(m.id))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const fresh = list.filter((m) => !known.has(m.id) && isUnread(m));
  state.messages = list;
  if (state.primed && fresh.length) notify(fresh[0], fresh.length);
  state.primed = true;
  renderList();
  renderLiveStatus();
}

/* ---------- notifications ---------- */
function notificationsSupported() {
  return typeof window.Notification === "function";
}
function initNotify() {
  const btn = $("#notify");
  if (!notificationsSupported()) {
    btn.hidden = true;
    return;
  }
  let pref = null;
  try {
    pref = localStorage.getItem(NOTIFY_KEY);
  } catch {
    /* ignore */
  }
  // No stored choice yet: an already granted permission means "on" (old behaviour).
  state.notify = Notification.permission === "granted" && pref !== "0";
  renderNotify();
}
function renderNotify() {
  const btn = $("#notify");
  if (btn.hidden) return;
  const blocked = Notification.permission === "denied";
  btn.textContent = t(state.notify ? "notify.on" : blocked ? "notify.blocked" : "notify.off");
  btn.classList.toggle("on", state.notify);
  btn.setAttribute("aria-pressed", String(state.notify));
}
async function toggleNotify() {
  if (!notificationsSupported()) return;
  if (state.notify) {
    state.notify = false;
  } else {
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    state.notify = perm === "granted";
  }
  writePref(NOTIFY_KEY, state.notify ? "1" : "0");
  renderNotify();
}
function notify(msg, count) {
  if (!state.notify || !notificationsSupported() || Notification.permission !== "granted") return;
  const from = msg.fromName || msg.from;
  const more = count > 1 ? ` (+${count - 1})` : "";
  try {
    const n = new Notification(msg.subject || t("reader.noSubject"), {
      body: `${t("reader.from")} ${from}${more}`,
      tag: "tempmail",
    });
    const gen = state.gen;
    n.onclick = () => {
      window.focus();
      setTab("inbox");
      if (gen === state.gen) openMessage(msg.id);
      n.close();
    };
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}

/* ---------- rendering: header / clock ---------- */
function renderHeader() {
  const i = state.inbox;
  const prov = getProvider(i?.provider ?? DEFAULT_PROVIDER);
  $("#address").textContent = i ? i.address : state.creating ? "· · · · · · · ·" : "-";
  $("#foot-addr").textContent = i ? i.address : "";
  const sel = $("#provider");
  if (!state.creating && sel.value !== prov.id) sel.value = prov.id;
  $("#poll-text").textContent =
    state.rateLimitedUntil > Date.now()
      ? t("toolbar.throttled")
      : t("toolbar.poll", { n: Math.round((prov.pollInterval || 5000) / 1000) });
  $("#meta").textContent = i ? t("meta.session", { provider: prov.label }) : t("meta.opening");
  const provRetention = prov.retentionKey ? t(prov.retentionKey) : prov.retention || "1h";
  $("#cta-note").textContent = t("about.ctaNote", { retention: provRetention });
  const maxOpt = document.querySelector('#lifetime option[value="max"]');
  if (maxOpt) maxOpt.textContent = `${t("lifetime.max")} (${provRetention})`;
}

function renderClock() {
  const i = state.inbox;
  const clock = $("#expiry-clock");
  const bar = $("#expiry-bar");
  const note = $("#expiry-note");
  const track = $("#expiry-track");
  if (!i) {
    clock.textContent = "--:--";
    bar.style.width = "100%";
    track.setAttribute("aria-valuenow", "100");
    return;
  }
  const total = lifetimeSeconds(i);
  const left = state.expired ? 0 : Math.max(0, secondsLeft(i));
  const pct = Math.round((left / total) * 100);
  bar.style.width = `${(left / total) * 100}%`;
  bar.classList.toggle("low", left < 300);
  track.setAttribute("aria-valuenow", String(pct));
  if (left <= 0) {
    clock.textContent = "00:00";
    note.textContent = t("expiry.expired");
    if (!state.expired) freezeExpired();
    return;
  }
  note.textContent = t("expiry.note");
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = Math.floor(left % 60);
  clock.textContent = d > 0 ? `${d}d ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Address hit its chosen lifetime: stop polling and delete it upstream.
function freezeExpired() {
  state.expired = true;
  stopPolling();
  setStatus("status.expired");
  $(".app").classList.add("expired");
  document.title = BASE_TITLE;
  if (state.inbox) {
    getProvider(state.inbox.provider).destroy(state.inbox.session).catch(() => {});
    writeJSON(STORAGE_KEY, null);
  }
}

/* ---------- rendering: list ---------- */
function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(getLang(), { hour: "2-digit", minute: "2-digit" });
  if (today) return time;
  return `${d.toLocaleDateString(getLang(), { day: "2-digit", month: "short" })} ${time}`;
}
function fmtFull(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(getLang(), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderList() {
  const el = $("#msg-list");
  $("#held-count").textContent = state.messages.length
    ? t("list.held", { n: pad(state.messages.length) })
    : "";

  let html;
  if (!state.messages.length) {
    const gen = state.creating && !state.inbox;
    html = `
      <div class="list-empty">
        <div class="box"></div>
        <span class="t">${esc(t(gen ? "list.emptyTitleGen" : "list.emptyTitle"))}</span>
        <span class="b">${esc(t(gen ? "list.emptyBodyGen" : "list.emptyBody"))}</span>
      </div>`;
  } else {
    html = state.messages
      .map((m) => {
        const unread = isUnread(m);
        const active = m.id === state.activeId;
        return `
      <button type="button" class="row${active ? " active" : ""}${unread ? " unread" : ""}" data-id="${esc(m.id)}"${active ? ' aria-current="true"' : ""}>
        <span class="row-dot"><span></span></span>
        <span class="row-body">
          <span class="row-top">
            <span class="row-from">${esc(m.fromName || m.from || "unknown")}</span>
            <span class="row-time">${esc(fmtWhen(m.date))}</span>
          </span>
          <span class="row-subject">${unread ? `<span class="sr-label">${esc(t("list.unread"))}: </span>` : ""}${esc(m.subject || t("reader.noSubject"))}</span>
          <span class="row-intro">${esc(m.intro || "")}</span>
        </span>
      </button>`;
      })
      .join("");
  }
  // Polls re-render every few seconds; skip the DOM swap when nothing changed
  // so focus and hover survive, and put focus back when something did.
  if (html === state.listHtml) return;
  state.listHtml = html;
  const focused = el.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  el.innerHTML = html;
  if (focused) el.querySelector(`.row[data-id="${CSS.escape(focused)}"]`)?.focus();
}

function onListKey(e) {
  const row = e.target.closest(".row");
  if (!row) return;
  const rows = [...$("#msg-list").querySelectorAll(".row")];
  const i = rows.indexOf(row);
  const next = {
    ArrowDown: rows[i + 1],
    ArrowUp: rows[i - 1],
    Home: rows[0],
    End: rows[rows.length - 1],
  }[e.key];
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

/* ---------- rendering: reader ---------- */
function textToParas(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

// Plain text and links of an HTML body, so code / link detection works on
// HTML-only mail. DOMParser documents are inert: no scripts run, nothing loads.
function parseHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    doc.querySelectorAll("script, style, head, title").forEach((n) => n.remove());
    const links = [...doc.querySelectorAll("a[href]")].map((a) => ({
      href: a.getAttribute("href") || "",
      text: a.textContent || "",
    }));
    doc.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
    doc
      .querySelectorAll("p, div, tr, td, th, li, h1, h2, h3, h4, h5, h6, table, blockquote, pre")
      .forEach((n) => n.append("\n"));
    const text = (doc.body?.textContent || "")
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { text, links };
  } catch {
    return { text: "", links: [] };
  }
}

// Code + action link, computed once per opened message.
function analyse(m) {
  const parsed = m.html ? parseHtml(m.html) : { text: "", links: [] };
  const text = m.text || parsed.text;
  return {
    code: findCode(m.subject || "", text),
    link: pickActionLink([...parsed.links, ...extractTextLinks(text)]),
  };
}

async function openMessage(id) {
  if (!state.inbox) return;
  const gen = state.gen;
  state.activeId = id;
  state.activeMessage = null;
  if (!state.seen.has(id)) {
    state.seen.add(id);
    saveInbox();
  }
  renderList();
  renderLiveStatus();
  $("#reader").innerHTML = `<div class="reader-empty"><span>${esc(t("reader.loading"))}</span></div>`;
  if (window.matchMedia?.("(max-width: 1080px)").matches) {
    $("#reader").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  try {
    const msg = await getProvider(state.inbox.provider).getMessage(state.inbox.session, id);
    if (gen !== state.gen || state.activeId !== id) return; // user moved on meanwhile
    state.activeMessage = { ...msg, ...analyse(msg) };
    renderReader();
  } catch (err) {
    if (gen !== state.gen || state.activeId !== id) return;
    $("#reader").innerHTML = `<div class="reader-empty"><span>${esc(
      t("reader.error", { error: err.message })
    )}</span></div>`;
  }
}

function renderReader() {
  const el = $("#reader");
  const m = state.activeMessage;
  if (!m || state.activeId == null) {
    const key = state.messages.length ? "reader.placeholder" : "reader.placeholderEmpty";
    el.innerHTML = `<div class="reader-empty"><div class="hr"></div><span>${esc(
      t(key)
    )}</span><div class="hr"></div></div>`;
    return;
  }

  const { code, link } = m;
  const atts = m.attachments || [];

  let body;
  if (m.html) {
    // CSP inside the frame actually blocks remote images/scripts/fonts/beacons
    // (a bare sandbox does not stop image loads, i.e. tracking pixels).
    const framed =
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
      `style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:">` +
      `<meta name="referrer" content="no-referrer">` +
      `<base target="_blank">` +
      m.html;
    body = `<iframe title="${esc(t("reader.frameTitle"))}" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc="${escSrcdoc(
      framed
    )}"></iframe>`;
  } else {
    const paras = textToParas(m.text);
    body = (paras.length ? paras : [t("reader.emptyBody")])
      .map((p) => `<p>${esc(p)}</p>`)
      .join("");
  }

  const codeBox = code
    ? `<div class="code-box">
         <span class="code">${esc(code)}</span>
         <button class="btn-ghost" type="button" id="copy-code">${esc(t("code.copy"))}</button>
         <span class="code-label">${esc(t("code.title"))}</span>
       </div>`
    : "";

  const linkBox = link
    ? `<div class="code-box link-box">
         <span class="link-host mono">${esc(link.host)}</span>
         <a class="btn-ghost" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(t("link.open"))}</a>
         <span class="code-label">${esc(t("link.title"))}</span>
       </div>`
    : "";

  const attBox = atts
    .map(
      (a, idx) => `
      <div class="att-chip">
        <div class="ico"></div>
        <div class="att-info">
          <span class="att-name">${esc(a.filename)}</span>
          <span class="att-size">${esc(fmtSize(a.size))}</span>
        </div>
        ${a.url ? `<button class="att-save" type="button" data-att="${idx}">${esc(t("att.save"))}</button>` : ""}
      </div>`
    )
    .join("");

  el.innerHTML = `
    <div class="reader-head">
      <div class="reader-actions">
        <button class="btn-ghost only-narrow" type="button" id="back-to-list">${esc(t("reader.backToList"))}</button>
        <button class="btn-ghost" type="button" id="del-msg">${esc(t("reader.delete"))}</button>
      </div>
      <div class="reader-title">
        <h2>${esc(m.subject || t("reader.noSubject"))}</h2>
        <span class="reader-date">${esc(fmtFull(m.date))}</span>
      </div>
      <div class="reader-meta">
        <span class="lbl">${esc(t("reader.from"))}</span>
        <span><strong>${esc(m.fromName || "")}</strong> &lt;${esc(m.from)}&gt;</span>
        <span class="lbl">${esc(t("reader.to"))}</span>
        <span>${esc(state.inbox?.address || "")}</span>
      </div>
    </div>
    <div class="reader-body">
      <div class="reader-body-inner">
        ${codeBox}
        ${linkBox}
        ${body}
        ${attBox}
        <div class="reader-note">${esc(t("reader.blocked"))}</div>
      </div>
    </div>`;

  $("#back-to-list")?.addEventListener("click", () => {
    const row = document.querySelector(`.row[data-id="${CSS.escape(m.id)}"]`);
    document.querySelector(".list-col")?.scrollIntoView({ behavior: "smooth", block: "start" });
    row?.focus({ preventScroll: true });
  });
  $("#del-msg")?.addEventListener("click", () => deleteMessage(m.id));

  const cc = $("#copy-code");
  if (cc) cc.addEventListener("click", () => copyText(code.replace(/\s/g, ""), cc, "code.copy", "code.copied"));
  el.querySelectorAll(".att-save").forEach((b) =>
    b.addEventListener("click", () => saveAttachment(atts[+b.dataset.att]))
  );
}

async function copyText(text, btn, idleKey, doneKey) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    /* no clipboard API (insecure context) or permission denied */
  }
  btn.textContent = t(ok ? doneKey : "addr.copyFail");
  btn.classList.toggle("copied", ok);
  setTimeout(() => {
    btn.textContent = t(idleKey);
    btn.classList.remove("copied");
  }, 1400);
}

async function saveAttachment(att) {
  if (!state.inbox || !att) return;
  try {
    const provider = getProvider(state.inbox.provider);
    const blob = await provider.downloadAttachment?.(state.inbox.session, att);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = att.filename || "attachment";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    setStatus("status.attFail", { error: err.message }, { notice: true });
  }
}

async function deleteMessage(id) {
  if (!state.inbox) return;
  const provider = getProvider(state.inbox.provider);
  const rows = [...document.querySelectorAll("#msg-list .row")];
  const nextId = rows[rows.findIndex((r) => r.dataset.id === id) + 1]?.dataset.id;
  state.deleted.add(id);
  state.messages = state.messages.filter((m) => m.id !== id);
  if (state.activeId === id) {
    state.activeId = null;
    state.activeMessage = null;
  }
  renderList();
  renderReader();
  renderLiveStatus();
  // keep keyboard users in the list instead of dropping focus on <body>
  const focusTarget =
    (nextId && document.querySelector(`.row[data-id="${CSS.escape(nextId)}"]`)) ||
    document.querySelector("#msg-list .row");
  focusTarget?.focus();
  try {
    await provider.deleteMessage?.(state.inbox.session, id);
  } catch {
    /* server-side delete is best-effort; the local list is already updated */
  }
}

/* ---------- address editing ---------- */
async function openAddressEdit(prefill = null) {
  if (!state.inbox || state.creating) return;
  const provider = getProvider(state.inbox.provider);
  const [curLocal, curDomain] = state.inbox.address.split("@");
  const sel = $("#addr-domain");
  let domains = [curDomain];
  try {
    domains = (await provider.domains?.()) || domains;
  } catch {
    /* keep current */
  }
  if (!domains.includes(curDomain)) domains = [curDomain, ...domains];
  sel.innerHTML = domains.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");
  sel.value = prefill?.domain && domains.includes(prefill.domain) ? prefill.domain : curDomain;
  $("#addr-local").value = prefill?.local ?? curLocal;
  $("#addr-warn").hidden = !provider.publicInboxes;
  $("#addr-view").hidden = true;
  $("#addr-edit").hidden = false;
  $("#edit").hidden = true;
  $("#edit-set").hidden = false;
  $("#edit-cancel").hidden = false;
  $("#addr-local").focus();
  $("#addr-local").select();
}
function closeAddressEdit() {
  const wasOpen = !$("#addr-edit").hidden;
  $("#addr-view").hidden = false;
  $("#addr-edit").hidden = true;
  $("#edit").hidden = false;
  $("#edit-set").hidden = true;
  $("#edit-cancel").hidden = true;
  if (wasOpen && $("#addr-edit").contains(document.activeElement)) $("#edit").focus();
}
async function submitAddressEdit() {
  if (!state.inbox) return;
  const local = $("#addr-local").value.trim();
  const domain = $("#addr-domain").value;
  if (!local) return;
  if (`${local.toLowerCase()}@${domain}` === state.inbox.address) {
    closeAddressEdit();
    return;
  }
  closeAddressEdit();
  const ok = await createInbox(state.inbox.provider, { localPart: local, domain });
  if (!ok) openAddressEdit({ local, domain }); // let them try another name
}

/* ---------- tabs ---------- */
function setTab(name, { focus = false } = {}) {
  document.querySelectorAll(".tab[data-tab]").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  $("#panel-inbox").hidden = name !== "inbox";
  $("#panel-about").hidden = name !== "about";
}
function onTabKey(e) {
  const tabs = [...document.querySelectorAll(".tab[data-tab]")];
  const i = tabs.indexOf(e.target);
  if (i < 0) return;
  const next = { ArrowRight: tabs[i + 1] || tabs[0], ArrowLeft: tabs[i - 1] || tabs[tabs.length - 1] }[
    e.key
  ];
  if (next) {
    e.preventDefault();
    setTab(next.dataset.tab, { focus: true });
  }
}

/* ---------- misc ---------- */
function renderAll() {
  renderStatus();
  renderHeader();
  renderClock();
  renderList();
  renderReader();
  renderHistory();
  renderNotify();
}

/* ---------- wiring ---------- */
function initControls() {
  $("#provider").innerHTML = providers
    .map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`)
    .join("");
  $("#lang").innerHTML = LANGUAGES.map(
    (l) => `<option value="${l.code}">${l.label}</option>`
  ).join("");
  $("#lang").value = getLang();

  $("#lang").addEventListener("change", (e) => setLang(e.target.value));
  $("#provider").addEventListener("change", () => createInbox($("#provider").value));

  $("#lifetime").value = state.lifetime;
  $("#lifetime").addEventListener("change", (e) => {
    state.lifetime = e.target.value;
    writePref(LIFETIME_KEY, state.lifetime);
    // A live address takes the new lifetime. An expired one stays dead (it was
    // already deleted upstream) - the choice then applies to the next address.
    if (state.inbox && !state.expired) {
      state.inbox.lifetime = state.lifetime;
      saveInbox();
    }
    renderClock();
  });

  $("#copy").addEventListener("click", () => {
    if (state.inbox) copyText(state.inbox.address, $("#copy"), "addr.copy", "addr.copied");
  });

  $("#refresh").addEventListener("click", () => pollOnce({ manual: true }));
  $("#new").addEventListener("click", () => createInbox($("#provider").value));
  $("#burn").addEventListener("click", burnInbox);
  $("#history").addEventListener("change", (e) => {
    if (e.target.value) switchToHistory(e.target.value);
  });

  $("#edit").addEventListener("click", () => openAddressEdit());
  $("#edit-cancel").addEventListener("click", closeAddressEdit);
  $("#edit-set").addEventListener("click", submitAddressEdit);
  $("#addr-edit").addEventListener("submit", (e) => {
    e.preventDefault();
    submitAddressEdit();
  });
  $("#addr-edit").addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAddressEdit();
  });

  $("#notify").addEventListener("click", toggleNotify);

  const list = $("#msg-list");
  list.addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (row) openMessage(row.dataset.id);
  });
  list.addEventListener("keydown", onListKey);

  document.querySelectorAll(".tab[data-tab]").forEach((b) => {
    b.addEventListener("click", () => setTab(b.dataset.tab));
    b.addEventListener("keydown", onTabKey);
  });
  document.querySelectorAll("[data-tab-jump]").forEach((b) =>
    b.addEventListener("click", () => setTab(b.dataset.tabJump, { focus: true }))
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.inbox || state.expired) return;
    pollOnce();
    startPolling(); // drop the slower hidden-tab delay
  });

  onLangChange(() => {
    $("#lang").value = getLang();
    state.listHtml = "";
    renderAll();
  });
}

async function main() {
  initLang();
  applyStaticTranslations();
  initTheme();
  await loadBackendProviders();
  initControls();
  initNotify();
  loadHistory();
  renderAll();

  if (await resumeStored()) return;
  await createInbox(DEFAULT_PROVIDER);
}

main();
