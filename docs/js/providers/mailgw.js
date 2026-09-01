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
  retentionSeconds: 7 * 24 * 3600,

  async createInbox() {
    const domainsResp = await jfetch(`${BASE}/domains?page=1`);
    const domains = (domainsResp["hydra:member"] || []).filter(
      (d) => d.isActive && !d.isPrivate
    );
    if (!domains.length) throw new Error("Mail.gw: no active domains");
    const domain = pick(domains).domain;

    const password = randomString(16, 20);
    let address = `${randomString()}@${domain}`;

    let created = await tryCreate(address, password);
    if (created === "taken") {
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
