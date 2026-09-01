// Mail.gw provider - talks directly to the public REST API from the browser.
// Mail.gw sends `Access-Control-Allow-Origin: *`, so it works from GitHub Pages.
// (Its twin mail.tm only allows *.mail.tm origins, so it cannot be used here.)

import { jfetch, pick, randomString } from "./common.js";

const BASE = "https://api.mail.gw";
const JSON_HEADERS = { "Content-Type": "application/json" };

export const mailgw = {
  id: "mailgw",
  label: "Mail.gw",
  pollInterval: 4000,
  retention: "7 days", // mail.tm/mail.gw: "We store messages for 7 days only"
  retentionKey: "dur.7d",
  retentionSeconds: 7 * 24 * 3600,

  async domains() {
    const resp = await jfetch(`${BASE}/domains?page=1`);
    return (resp["hydra:member"] || [])
      .filter((d) => d.isActive && !d.isPrivate)
      .map((d) => d.domain);
  },

  async createInbox(opts = {}) {
    const domains = await this.domains();
    if (!domains.length) throw new Error("Mail.gw: no active domains");
    const domain = domains.includes(opts.domain) ? opts.domain : pick(domains);

    const wanted = normalizeLocalPart(opts.localPart);
    const password = randomString(16, 20);
    let address = `${wanted || randomString()}@${domain}`;

    let created = await tryCreate(address, password);
    if (created === "taken") {
      if (wanted) throw new Error("Mail.gw: that address is already taken");
      address = `${randomString()}@${domain}`;
      created = await tryCreate(address, password);
    }
    if (created !== "ok") throw new Error("Mail.gw: could not create account");

    const token = await jfetch(`${BASE}/token`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ address, password }),
    });

    return {
      provider: "mailgw",
      address,
      session: { token: token.token, accountId: token.id, address, password },
    };
  },

  async listMessages(session) {
    const data = await jfetch(`${BASE}/messages?page=1`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    return (data["hydra:member"] || []).map((m) => ({
      id: m.id,
      from: m.from?.address || "",
      fromName: m.from?.name || "",
      subject: m.subject || "",
      intro: m.intro || "",
      date: m.createdAt || null,
      seen: !!m.seen,
    }));
  },

  async getMessage(session, id) {
    const m = await jfetch(`${BASE}/messages/${id}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    return {
      id: m.id,
      from: m.from?.address || "",
      fromName: m.from?.name || "",
      subject: m.subject || "",
      date: m.createdAt || null,
      text: m.text || "",
      html: Array.isArray(m.html) ? m.html.join("\n") : m.html || "",
      attachments: (m.attachments || []).map((a) => ({
        filename: a.filename || "attachment",
        size: a.size || 0,
        url: a.downloadUrl ? BASE + a.downloadUrl : null,
      })),
    };
  },

  async downloadAttachment(session, att) {
    if (!att.url) return null;
    const res = await fetch(att.url, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) throw new Error(`Mail.gw: attachment ${res.status}`);
    return res.blob();
  },

  async deleteMessage(session, id) {
    const res = await fetch(`${BASE}/messages/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok && res.status !== 404) throw new Error(`Mail.gw: delete ${res.status}`);
  },

  async destroy(session) {
    try {
      await fetch(`${BASE}/accounts/${session.accountId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.token}` },
      });
    } catch {
      /* best effort */
    }
  },
};

// mail.gw local-part rule: ^[a-z0-9._-]+$ (we also cap length)
function normalizeLocalPart(v) {
  if (!v) return "";
  const s = String(v).toLowerCase().trim().replace(/[^a-z0-9._-]/g, "");
  return s.slice(0, 32);
}

async function tryCreate(address, password) {
  try {
    await jfetch(`${BASE}/accounts`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ address, password }),
    });
    return "ok";
  } catch (err) {
    if (String(err.message).includes("already used")) return "taken";
    throw err;
  }
}
