import { providers, getProvider, DEFAULT_PROVIDER } from "./providers/index.js";
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

const STORAGE_KEY = "tempmail:inbox:v1";
const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");

const state = {
  inbox: null, // { provider, address, session, createdAt }
  messages: [],
  seen: new Set(),
  activeId: null,
  activeMessage: null,
  tab: "inbox",
  pollTimer: null,
  clockTimer: null,
  loading: false,
  status: { key: "status.starting", vars: null, busy: false },
};

/* ---------- persistence ---------- */
function saveInbox() {
  if (state.inbox) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.inbox));
    } catch {}
  }
}
function loadStoredInbox() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearStoredInbox() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/* ---------- status ---------- */
function setStatus(key, vars = null, busy = false) {
  state.status = { key, vars, busy };
  renderStatus();
}
function renderStatus() {
  $("#status").textContent = t(state.status.key, state.status.vars);
  $("#status-dot").classList.toggle("busy", state.status.busy);
}

/* ---------- inbox lifecycle ---------- */
async function createInbox(providerId) {
  stopPolling();
  setStatus("status.generating", null, true);
  state.messages = [];
  state.seen = new Set();
  state.activeId = null;
  state.activeMessage = null;
  renderList();
  renderReader();
  renderHeader();
  try {
    const provider = getProvider(providerId || DEFAULT_PROVIDER);
    const inbox = await provider.createInbox();
    state.inbox = { ...inbox, createdAt: Date.now() };
    saveInbox();
    renderHeader();
    startClock();
    await pollOnce();
    startPolling();
  } catch (err) {
    setStatus("status.createFail", { error: err.message });
    renderHeader();
    renderList();
  }
}

async function resumeInbox(stored) {
  state.inbox = stored;
  renderHeader();
  try {
    await getProvider(stored.provider).listMessages(stored.session);
    startClock();
    await pollOnce();
    startPolling();
    return true;
  } catch {
    clearStoredInbox();
    state.inbox = null;
    return false;
  }
}

function burnInbox() {
  if (!state.inbox) return;
  getProvider(state.inbox.provider).destroy(state.inbox.session).catch(() => {});
  clearStoredInbox();
  state.inbox = null;
  createInbox($("#provider").value);
}

/* ---------- polling + clock ---------- */
function startPolling() {
  stopPolling();
  if (!state.inbox) return;
  const provider = getProvider(state.inbox.provider);
  state.pollTimer = setInterval(() => {
    if (!document.hidden) pollOnce();
  }, provider.pollInterval || 5000);
}
function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}
function startClock() {
  if (state.clockTimer) clearInterval(state.clockTimer);
  renderClock();
  state.clockTimer = setInterval(renderClock, 1000);
}

async function pollOnce() {
  if (!state.inbox || state.loading) return;
  state.loading = true;
  const provider = getProvider(state.inbox.provider);
  const wasBusy = state.status.busy;
  if (!wasBusy) setStatus("status.syncing", null, true);
  try {
    const incoming = await provider.listMessages(state.inbox.session);
    saveInbox();
    const known = new Set(state.messages.map((m) => m.id));
    const fresh = incoming.filter((m) => !known.has(m.id));
    state.messages = incoming.sort(
      (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
    );
    renderList();
    if (fresh.length && known.size) notify(fresh[0]);
    renderLiveStatus();
  } catch (err) {
    setStatus("status.error", { error: err.message });
  } finally {
    state.loading = false;
  }
}

function renderLiveStatus() {
  const unread = state.messages.filter((m) => !state.seen.has(m.id)).length;
  if (!state.messages.length) setStatus("status.liveNoMail");
  else if (unread) setStatus("status.liveUnread", { n: unread });
  else setStatus("status.live");
}

function notify(msg) {
  const N = window.Notification;
  if (!N || N.permission !== "granted") return;
  new N(msg.subject || t("reader.noSubject"), {
    body: `${t("reader.from")} ${msg.from}`,
  });
}

/* ---------- rendering: header / clock ---------- */
function renderHeader() {
  const i = state.inbox;
  const addr = i ? i.address : "-";
  $("#address").textContent = state.status.busy && !i ? "· · · · · · · ·" : addr;
  $("#foot-addr").textContent = i ? addr : "";
  $("#provider").value = i ? i.provider : DEFAULT_PROVIDER;
  $("#poll-text").textContent = t("toolbar.poll", {
    n: Math.round((getProvider(i?.provider ?? DEFAULT_PROVIDER).pollInterval || 5000) / 1000),
  });
  $("#meta").textContent = i
    ? t("meta.session", { provider: getProvider(i.provider).label })
    : t("meta.opening");
  $("#cta-note").textContent = t("about.ctaNote", {
    retention: getProvider(i?.provider ?? DEFAULT_PROVIDER).retention || "1h",
  });
}

function renderClock() {
  const i = state.inbox;
  const clock = $("#expiry-clock");
  const bar = $("#expiry-bar");
  const note = $("#expiry-note");
  if (!i) {
    clock.textContent = "--:--";
    bar.style.width = "100%";
    return;
  }
  const total = getProvider(i.provider).retentionSeconds || 3600;
  const left = Math.max(0, total - (Date.now() - i.createdAt) / 1000);
  bar.style.width = `${(left / total) * 100}%`;
  bar.classList.toggle("low", left < 300);
  if (left <= 0) {
    clock.textContent = "00:00";
    note.textContent = t("expiry.expired");
    return;
  }
  note.textContent = t("expiry.note");
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = Math.floor(left % 60);
  clock.textContent = d > 0 ? `${d}d ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
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

  if (!state.messages.length) {
    const gen = state.status.busy;
    el.innerHTML = `
      <div class="list-empty">
        <div class="box"></div>
        <span class="t">${esc(t(gen ? "list.emptyTitleGen" : "list.emptyTitle"))}</span>
        <span class="b">${esc(t(gen ? "list.emptyBodyGen" : "list.emptyBody"))}</span>
      </div>`;
    return;
  }

  el.innerHTML = state.messages
    .map((m) => {
      const unread = !state.seen.has(m.id);
      return `
      <div class="row${m.id === state.activeId ? " active" : ""}${unread ? " unread" : ""}" data-id="${esc(m.id)}">
        <div class="row-dot"><span></span></div>
        <div class="row-body">
          <div class="row-top">
            <span class="row-from">${esc(m.fromName || m.from || "unknown")}</span>
            <span class="row-time">${esc(fmtWhen(m.date))}</span>
          </div>
          <span class="row-subject">${esc(m.subject || t("reader.noSubject"))}</span>
          <span class="row-intro">${esc(m.intro || "")}</span>
        </div>
      </div>`;
    })
    .join("");
  el.querySelectorAll(".row").forEach((r) =>
    r.addEventListener("click", () => openMessage(r.dataset.id))
  );
}

/* ---------- rendering: reader ---------- */
const CODE_KW =
  /(verif|confirm|one[- ]?time|\botp\b|\bpin\b|\bcode\b|2fa|two.?factor|security code|access code|login code)/i;

function findCode(subject, text) {
  const hay = `${subject}\n${text}`;
  const grouped = hay.match(/\b(\d{3}[ -]\d{3}|\d{4}[ -]\d{4})\b/);
  if (CODE_KW.test(hay)) {
    if (grouped) return grouped[1];
    const digits = hay.match(/\b(\d{4,8})\b/);
    if (digits) return digits[1];
    const alnum = hay.match(/\b([A-Z0-9]{6,8})\b/);
    if (alnum && /\d/.test(alnum[1]) && /[A-Z]/.test(alnum[1])) return alnum[1];
  }
  const iso = text.match(/(?:^|\n)\s*(\d{6})\s*(?:\r?\n|$)/);
  return iso ? iso[1] : grouped ? grouped[1] : null;
}

function textToParas(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

async function openMessage(id) {
  state.activeId = id;
  state.seen.add(id);
  renderList();
  renderLiveStatus();
  $("#reader").innerHTML = `<div class="reader-empty"><span>${esc(t("reader.loading"))}</span></div>`;
  try {
    state.activeMessage = await getProvider(state.inbox.provider).getMessage(
      state.inbox.session,
      id
    );
    renderReader();
  } catch (err) {
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

  const code = findCode(m.subject || "", m.text || "");
  const atts = m.attachments || [];

  let body;
  if (m.html) {
    // CSP inside the frame actually blocks remote images/scripts/fonts/beacons
    // (a bare sandbox does not stop image loads, i.e. tracking pixels).
    const framed =
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
      `style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:">` +
      `<base target="_blank">` +
      m.html;
    body = `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc="${escSrcdoc(
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
         <button class="btn-ghost" id="copy-code">${esc(t("code.copy"))}</button>
         <span class="code-label">${esc(t("code.title"))}</span>
       </div>`
    : "";

  const attBox = atts
    .map(
      (a, idx) => `
      <div class="att-chip">
        <div class="ico"></div>
        <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
          <span class="att-name">${esc(a.filename)}</span>
          <span class="att-size">${esc(fmtSize(a.size))}</span>
        </div>
        ${a.url ? `<button class="att-save" data-att="${idx}">${esc(t("att.save"))}</button>` : ""}
      </div>`
    )
    .join("");

  el.innerHTML = `
    <div class="reader-head">
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
        ${body}
        ${codeBox}
        ${attBox}
        <div class="reader-note">${esc(t("reader.blocked"))}</div>
      </div>
    </div>`;

  const cc = $("#copy-code");
  if (cc)
    cc.addEventListener("click", () => {
      navigator.clipboard?.writeText(code.replace(/\s/g, "")).catch(() => {});
      cc.textContent = t("code.copied");
      setTimeout(() => (cc.textContent = t("code.copy")), 1400);
    });
  el.querySelectorAll(".att-save").forEach((b) =>
    b.addEventListener("click", () => saveAttachment(atts[+b.dataset.att]))
  );
}

async function saveAttachment(att) {
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
  } catch {
    /* ignore */
  }
}

function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ---------- tabs ---------- */
function setTab(name) {
  state.tab = name;
  document.querySelectorAll(".tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name)
  );
  $("#panel-inbox").hidden = name !== "inbox";
  $("#panel-about").hidden = name !== "about";
}

/* ---------- misc ---------- */
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
// srcdoc value is un-escaped then parsed as HTML: only & and " must be encoded.
function escSrcdoc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function rerenderDynamic() {
  renderStatus();
  renderHeader();
  renderClock();
  renderList();
  renderReader();
}

/* ---------- wiring ---------- */
function initControls() {
  $("#provider").innerHTML = providers
    .map((p) => `<option value="${p.id}">${p.label}</option>`)
    .join("");
  $("#lang").innerHTML = LANGUAGES.map(
    (l) => `<option value="${l.code}">${l.label}</option>`
  ).join("");
  $("#lang").value = getLang();

  $("#lang").addEventListener("change", (e) => setLang(e.target.value));
  $("#provider").addEventListener("change", () => createInbox($("#provider").value));

  $("#copy").addEventListener("click", async () => {
    if (!state.inbox) return;
    await navigator.clipboard.writeText(state.inbox.address).catch(() => {});
    const b = $("#copy");
    b.textContent = t("addr.copied");
    b.classList.add("copied");
    setTimeout(() => {
      b.textContent = t("addr.copy");
      b.classList.remove("copied");
    }, 1400);
  });

  $("#refresh").addEventListener("click", pollOnce);
  $("#new").addEventListener("click", () => createInbox($("#provider").value));
  $("#burn").addEventListener("click", burnInbox);

  $("#notify").addEventListener("click", async () => {
    const N = window.Notification;
    if (!N) return;
    let perm = N.permission;
    if (perm === "default") perm = await N.requestPermission();
    const on = perm === "granted";
    const b = $("#notify");
    b.textContent = t(on ? "notify.on" : "notify.off");
    b.classList.toggle("on", on);
  });

  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => setTab(b.dataset.tab))
  );
  document.querySelectorAll("[data-tab-jump]").forEach((b) =>
    b.addEventListener("click", () => setTab(b.dataset.tabJump))
  );

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.inbox) pollOnce();
  });

  onLangChange(() => {
    $("#lang").value = getLang();
    rerenderDynamic();
  });
}

async function main() {
  initLang();
  applyStaticTranslations();
  initTheme();
  initControls();
  renderHeader();
  renderClock();
  renderList();
  renderReader();

  const stored = loadStoredInbox();
  if (stored && (await resumeInbox(stored))) return;
  await createInbox(DEFAULT_PROVIDER);
}

main();
