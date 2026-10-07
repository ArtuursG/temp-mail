// Shared helpers for provider modules.

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const DEFAULT_TIMEOUT = 15000;

export function randomString(min = 10, max = 14) {
  const len = min + Math.floor(Math.random() * (max - min + 1));
  let out = "";
  const rnd = crypto.getRandomValues(new Uint32Array(len));
  for (let i = 0; i < len; i++) out += ALPHABET[rnd[i] % ALPHABET.length];
  return out;
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Error carrying the HTTP status, so callers can tell 401 / 429 apart. */
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** The session is gone for good (token rejected, inbox deleted upstream). */
export function isSessionLost(err) {
  return !!err && (err.sessionLost === true || err.status === 401 || err.status === 403);
}

export function isRateLimit(err) {
  return !!err && (err.status === 429 || /\b429\b|rate.?limit|too many/i.test(String(err.message)));
}

/**
 * fetch() with a timeout. A plain fetch can hang for minutes, and while it does
 * the poll loop would skip every tick.
 */
export async function fetchWithTimeout(url, init = {}, timeout = DEFAULT_TIMEOUT) {
  const signal =
    init.signal || (typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeout) : undefined);
  try {
    return await fetch(url, { ...init, signal });
  } catch (err) {
    if (err && err.name === "TimeoutError") {
      throw new Error(`request timed out after ${Math.round(timeout / 1000)}s`);
    }
    throw err;
  }
}

/** fetch + JSON with a useful error message. `opts.timeout` is in ms. */
export async function jfetch(url, opts = {}) {
  const { timeout = DEFAULT_TIMEOUT, ...init } = opts;
  const res = await fetchWithTimeout(url, init, timeout);
  const raw = await res.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const detail =
      (body && (body.message || body["hydra:description"] || body.detail)) ||
      res.statusText ||
      `HTTP ${res.status}`;
    throw httpError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return body;
}

/** Lower-case local part limited to what the providers accept: [a-z0-9._-]. */
export function normalizeLocalPart(v) {
  if (!v) return "";
  return String(v)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 32);
}

// Some providers label HTML bodies as text (Guerrilla wraps its own welcome
// mail in <pre> with entities), so decide from the body itself.
const HTML_TAG =
  /<(?:pre|a|p|div|br|table|tbody|tr|td|img|h[1-6]|ul|ol|li|span|strong|b|i|em|blockquote|font|hr|body|html)[\s/>]/i;

export function looksLikeHtml(body) {
  return HTML_TAG.test(String(body || ""));
}
