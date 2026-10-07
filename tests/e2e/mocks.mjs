// In-memory fakes of the Mail.gw and Guerrilla Mail APIs, wired in with
// page.route(), so the e2e tests never touch the real services.

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, DELETE, PATCH, OPTIONS",
};

export async function mockMailGw(page) {
  const st = {
    domains: ["mock.gw"],
    accounts: new Map(), // address -> { id, password }
    tokens: new Map(), // token -> address
    messages: [], // newest first, list shape
    full: new Map(), // id -> full message
    taken: new Set(),
    listStatus: null, // force GET /messages to answer with this status
    down: false, // outage: every call answers 502 without CORS headers, like a real gateway error
    calls: [],
    count(prefix) {
      return this.calls.filter((c) => c.startsWith(prefix)).length;
    },
    deliver({ id, from = "noreply@acme.example", name = "Acme", subject, intro = "", text = "", html = "" }) {
      const createdAt = new Date().toISOString();
      this.messages.unshift({
        id,
        from: { address: from, name },
        subject,
        intro,
        seen: false,
        createdAt,
      });
      this.full.set(id, {
        id,
        from: { address: from, name },
        subject,
        createdAt,
        text,
        html: html ? [html] : [],
        attachments: [],
      });
    },
  };

  await page.route("https://api.mail.gw/**", async (route) => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname;
    const json = (status, body) =>
      route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });
    if (st.down) return route.fulfill({ status: 502, contentType: "text/html", body: "<h1>502 Bad Gateway</h1>" });
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    st.calls.push(`${method} ${path}`);

    const token = (req.headers().authorization || "").replace(/^Bearer /, "");
    const owner = st.tokens.get(token);
    const authed = owner && st.accounts.has(owner);

    if (method === "GET" && path === "/domains") {
      return json(200, {
        "hydra:member": st.domains.map((domain) => ({ domain, isActive: true, isPrivate: false })),
      });
    }
    if (method === "POST" && path === "/accounts") {
      const { address } = req.postDataJSON();
      const password = req.postDataJSON().password;
      if (st.taken.has(address) || st.accounts.has(address)) {
        return json(422, { "hydra:description": "address: This value is already used." });
      }
      const id = `acc${st.accounts.size + 1}`;
      st.accounts.set(address, { id, password });
      return json(201, { id, address });
    }
    if (method === "POST" && path === "/token") {
      const { address, password } = req.postDataJSON();
      const acc = st.accounts.get(address);
      if (!acc || acc.password !== password) return json(401, { message: "Invalid credentials." });
      const tok = `tok-${acc.id}-${st.tokens.size}`;
      st.tokens.set(tok, address);
      return json(200, { id: acc.id, token: tok });
    }
    if (method === "GET" && path === "/messages") {
      if (st.listStatus) return json(st.listStatus, { message: "forced failure" });
      if (!authed) return json(401, { message: "JWT Token not found" });
      return json(200, { "hydra:member": st.messages });
    }
    if (method === "GET" && path.startsWith("/messages/")) {
      const m = st.full.get(decodeURIComponent(path.split("/")[2]));
      return m ? json(200, m) : json(404, { message: "Not Found" });
    }
    if (method === "DELETE" && path.startsWith("/messages/")) {
      const id = decodeURIComponent(path.split("/")[2]);
      st.messages = st.messages.filter((m) => m.id !== id);
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (method === "DELETE" && path.startsWith("/accounts/")) {
      return route.fulfill({ status: 204, headers: CORS });
    }
    return json(404, { message: "unmocked" });
  });
  return st;
}

export async function mockGuerrilla(page) {
  const st = { user: "auto123", sid: 0, calls: [] };
  await page.route("https://api.guerrillamail.com/**", async (route) => {
    const q = new URL(route.request().url()).searchParams;
    const f = q.get("f");
    st.calls.push(f);
    const sid_token = `sid${++st.sid}`;
    const json = (body) =>
      route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });
    if (f === "get_email_address") return json({ email_addr: `${st.user}@guerrillamailblock.com`, sid_token });
    if (f === "set_email_user") {
      st.user = q.get("email_user");
      return json({ email_addr: `${st.user}@guerrillamailblock.com`, sid_token });
    }
    if (f === "get_email_list") return json({ list: [], sid_token });
    return json({});
  });
  return st;
}

/** Replaces window.Notification with a recorder; permission starts as `permission`. */
export async function fakeNotifications(page, permission = "granted") {
  await page.addInitScript((perm) => {
    window.__notes = [];
    class FakeNotification {
      static permission = perm;
      static requestPermission() {
        FakeNotification.permission = "granted";
        return Promise.resolve("granted");
      }
      constructor(title, opts) {
        window.__notes.push({ title, body: opts && opts.body });
      }
      close() {}
    }
    window.Notification = FakeNotification;
  }, permission);
}
