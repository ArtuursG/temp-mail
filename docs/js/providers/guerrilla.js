// Guerrilla Mail provider - keyless JSON API, sends `Access-Control-Allow-Origin: *`.
// Session is the `sid_token`. Note: the API no longer honours domain switching
// (addresses are always @guerrillamailblock.com).

import { randomString } from "./common.js";

const API = "https://api.guerrillamail.com/ajax.php";

async function call(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Guerrilla Mail: HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Guerrilla Mail: unexpected response (rate limited?)");
  }
}

function toIso(ts) {
  const n = Number(ts);
  return n > 0 ? new Date(n * 1000).toISOString() : null;
}

export const guerrilla = {
  id: "guerrilla",
  label: "Guerrilla Mail",
  pollInterval: 8000,
  retention: "1 hour", // Guerrilla: "All Emails are deleted after 1 hour"
  retentionSeconds: 3600,

  async createInbox() {
    const init = await call({ f: "get_email_address" });
    let sid = init.sid_token;
    let address = init.email_addr;
    try {
      const set = await call({
        f: "set_email_user",
        email_user: randomString(8, 12),
        sid_token: sid,
      });
      sid = set.sid_token || sid;
      address = set.email_addr || address;
    } catch {
      /* keep the auto-assigned address */
    }
    return { provider: "guerrilla", address, session: { sid_token: sid, address } };
  },

  async listMessages(session) {
    const data = await call({
      f: "get_email_list",
      offset: 0,
      sid_token: session.sid_token,
    });
    session.sid_token = data.sid_token || session.sid_token;
    return (data.list || []).map((m) => ({
      id: String(m.mail_id),
      from: m.mail_from || "",
      fromName: "",
      subject: m.mail_subject || "",
      intro: (m.mail_excerpt || "").trim(),
      date: toIso(m.mail_timestamp),
      seen: String(m.mail_read) === "1",
    }));
  },

  async getMessage(session, id) {
    const d = await call({ f: "fetch_email", email_id: id, sid_token: session.sid_token });
    if (!d || !d.mail_id) throw new Error("Guerrilla Mail: message not found");
    const body = d.mail_body || "";
    const isHtml = d.content_type !== "text" && /<[a-z][\s\S]*>/i.test(body);
    return {
      id: String(d.mail_id),
      from: d.mail_from || "",
      fromName: "",
      subject: d.mail_subject || "",
      date: toIso(d.mail_timestamp),
      text: isHtml ? "" : body,
      html: isHtml ? body : "",
    };
  },

  async destroy() {
    /* addresses expire on their own */
  },
};
