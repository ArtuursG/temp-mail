// Providers proxied by the optional FastAPI backend (backend/). Some upstreams
// can't be called from a browser (Mail.tm only allows *.mail.tm origins), so
// when this page is served by the backend those are added through /api.
// On GitHub Pages there is no /api and nothing is added.

import { fetchWithTimeout, httpError, jfetch } from "./common.js";

const API = "./api";
const JSON_HEADERS = { "Content-Type": "application/json" };
const RETENTION_KEYS = { 3600: "dur.1h", 604800: "dur.7d" };

// The backend forgets an inbox after its idle TTL; treat that like a revoked token.
async function api(path, opts) {
  try {
    return await jfetch(`${API}${path}`, opts);
  } catch (err) {
    if (err.status === 404 || err.status === 410) err.sessionLost = true;
    throw err;
  }
}

function toSummary(m) {
  return {
    id: m.id,
    from: m.from_addr || "",
    fromName: m.from_name || "",
    subject: m.subject || "",
    intro: m.intro || "",
    date: m.received_at || null,
    seen: false,
  };
}

function backendProvider(info) {
  const id = info.name;
  const inboxPath = (s) => `/inboxes/${encodeURIComponent(s.inboxId)}`;
  const msgPath = (s, mid) => `${inboxPath(s)}/messages/${encodeURIComponent(mid)}`;
  return {
    id,
    label: `${info.label} (proxy)`,
    pollInterval: 5000,
    retention: info.retention_seconds >= 86400 ? `${info.retention_seconds / 86400} days` : "1 hour",
    retentionKey: RETENTION_KEYS[info.retention_seconds],
    retentionSeconds: info.retention_seconds || 3600,
    publicInboxes: !!info.public_inboxes,

    domains() {
      return api(`/providers/${encodeURIComponent(id)}/domains`);
    },

    async createInbox(opts = {}) {
      const r = await api("/inboxes", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          provider: id,
          local_part: opts.localPart || null,
          domain: opts.domain || null,
        }),
      });
      return { provider: id, address: r.address, session: { inboxId: r.id } };
    },

    async listMessages(session) {
      return (await api(`${inboxPath(session)}/messages`)).map(toSummary);
    },

    async getMessage(session, mid) {
      const m = await api(msgPath(session, mid));
      return {
        ...toSummary(m),
        text: m.text || "",
        html: m.html || "",
        attachments: (m.attachments || []).map((a) => ({
          filename: a.filename || "attachment",
          size: a.size || 0,
          url: `${API}${msgPath(session, mid)}/attachments/${encodeURIComponent(a.id)}`,
        })),
      };
    },

    async downloadAttachment(session, att) {
      const res = await fetchWithTimeout(att.url, {}, 60000);
      if (!res.ok) throw httpError(res.status, `attachment HTTP ${res.status}`);
      return res.blob();
    },

    async deleteMessage(session, mid) {
      await api(msgPath(session, mid), { method: "DELETE" });
    },

    async destroy(session) {
      try {
        await fetchWithTimeout(`${API}${inboxPath(session)}`, { method: "DELETE" });
      } catch {
        /* best effort */
      }
    },
  };
}

/** Providers the backend offers, or [] when the page is not served by it. */
export async function discoverBackendProviders() {
  if (location.protocol === "file:" || location.hostname.endsWith(".github.io")) return [];
  try {
    const list = await jfetch(`${API}/providers`, { timeout: 2500 });
    return Array.isArray(list) ? list.filter((p) => p && p.name).map(backendProvider) : [];
  } catch {
    return [];
  }
}
