// Mail.gw provider - talks directly to the public REST API from the browser.
// Mail.gw sends `Access-Control-Allow-Origin: *`, so it works from GitHub Pages.
// (Its twin mail.tm only allows *.mail.tm origins, so it cannot be used here.)

import {
  fetchWithTimeout,
  httpError,
  jfetch,
  normalizeLocalPart,
  pick,
  randomString,
} from "./common.js";

const BASE = "https://api.mail.gw";
const JSON_HEADERS = { "Content-Type": "application/json" };
const DOMAIN_TTL = 10 * 60 * 1000;

let domainCache = { at: 0, list: null };

const auth = (session) => ({ Authorization: `Bearer ${session.token}` });

export const mailgw = {
  id: "mailgw",
  label: "Mail.gw",
  pollInterval: 4000,
  retention: "7 days", // mail.tm/mail.gw: "We store messages for 7 days only"
  retentionKey: "dur.7d",
  retentionSeconds: 7 * 24 * 3600,

  async domains() {
    if (domainCache.list && Date.now() - domainCache.at < DOMAIN_TTL) return domainCache.list;
    const resp = await jfetch(`${BASE}/domains?page=1`);
    const list = (resp["hydra:member"] || [])
      .filter((d) => d.isActive && !d.isPrivate)
      .map((d) => d.domain);
    domainCache = { at: Date.now(), list };
    return list;
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

    const token = await login(address, password);
    return {
      provider: "mailgw",
      address,
      session: { token: token.token, accountId: token.id, address, password },
    };
  },

  // Tokens can be rejected later on; the account password is kept in the
  // session, so log in again instead of throwing the address away.
  async reauth(session) {
    if (!session.password) throw httpError(401, "Mail.gw: session expired");
    const token = await login(session.address, session.password);
    session.token = token.token;
    session.accountId = token.id || session.accountId;
  },

  async listMessages(session) {
    const data = await jfetch(`${BASE}/messages?page=1`, { headers: auth(session) });
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
    const m = await jfetch(`${BASE}/messages/${encodeURIComponent(id)}`, { headers: auth(session) });
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
    const res = await fetchWithTimeout(att.url, { headers: auth(session) }, 60000);
    if (!res.ok) throw httpError(res.status, `Mail.gw: attachment HTTP ${res.status}`);
    return res.blob();
  },

  async deleteMessage(session, id) {
    const res = await fetchWithTimeout(`${BASE}/messages/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: auth(session),
    });
    if (!res.ok && res.status !== 404) throw httpError(res.status, `Mail.gw: delete HTTP ${res.status}`);
  },

  async destroy(session) {
    try {
      await fetchWithTimeout(`${BASE}/accounts/${session.accountId}`, {
        method: "DELETE",
        headers: auth(session),
      });
    } catch {
      /* best effort */
    }
  },
};

function login(address, password) {
  return jfetch(`${BASE}/token`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ address, password }),
  });
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
    if (err.status === 422 && /already used/i.test(String(err.message))) return "taken";
    throw err;
  }
}
