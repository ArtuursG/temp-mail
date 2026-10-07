import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  fetchWithTimeout,
  httpError,
  isRateLimit,
  isSessionLost,
  jfetch,
  looksLikeHtml,
  normalizeLocalPart,
} from "../../docs/js/providers/common.js";
import { esc, escSrcdoc, fmtSize } from "../../docs/js/lib/format.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("jfetch: returns parsed JSON", async () => {
  globalThis.fetch = async () => new Response('{"a":1}', { status: 200 });
  assert.deepEqual(await jfetch("https://x.example"), { a: 1 });
});

test("jfetch: error carries status and API detail", async () => {
  globalThis.fetch = async () =>
    new Response('{"hydra:description":"address: This value is already used."}', { status: 422 });
  await assert.rejects(jfetch("https://x.example"), (err) => {
    assert.equal(err.status, 422);
    assert.match(err.message, /already used/);
    return true;
  });
});

test("jfetch: FastAPI-style {detail} errors", async () => {
  globalThis.fetch = async () => new Response('{"detail":"Inbox not found"}', { status: 404 });
  await assert.rejects(jfetch("https://x.example"), { status: 404, message: "Inbox not found" });
});

test("fetchWithTimeout: a hung request fails instead of hanging", async () => {
  globalThis.fetch = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });
  // AbortSignal.timeout() timers don't keep Node's event loop alive on their own
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await assert.rejects(fetchWithTimeout("https://x.example", {}, 50), /timed out/);
  } finally {
    clearTimeout(keepAlive);
  }
});

test("isSessionLost / isRateLimit", () => {
  assert.equal(isSessionLost(httpError(401, "Unauthorized")), true);
  assert.equal(isSessionLost(httpError(403, "Forbidden")), true);
  assert.equal(isSessionLost(Object.assign(new Error("gone"), { sessionLost: true })), true);
  assert.equal(isSessionLost(httpError(500, "boom")), false);
  assert.equal(isSessionLost(new TypeError("Failed to fetch")), false);
  assert.equal(isRateLimit(httpError(429, "Too Many Requests")), true);
  assert.equal(isRateLimit(new Error("Guerrilla Mail: unexpected response (rate limited?)")), true);
  assert.equal(isRateLimit(httpError(500, "boom")), false);
});

test("normalizeLocalPart", () => {
  assert.equal(normalizeLocalPart("  John.Doe+tag!  "), "john.doetag");
  assert.equal(normalizeLocalPart("x".repeat(40)).length, 32);
  assert.equal(normalizeLocalPart(null), "");
});

test("looksLikeHtml", () => {
  assert.equal(looksLikeHtml("<pre>Welcome &amp; hi</pre>"), true);
  assert.equal(looksLikeHtml("Hello <b>there</b>"), true);
  assert.equal(looksLikeHtml("a < b and c > d"), false);
  assert.equal(looksLikeHtml(""), false);
});

test("esc / escSrcdoc / fmtSize", () => {
  assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(esc(null), "");
  assert.equal(escSrcdoc(`<p title="a&b">`), "<p title=&quot;a&amp;b&quot;>");
  assert.equal(fmtSize(512), "512 B");
  assert.equal(fmtSize(2048), "2 KB");
  assert.equal(fmtSize(5 * 1024 * 1024), "5.0 MB");
});
