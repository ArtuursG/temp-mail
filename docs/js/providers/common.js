// Shared helpers for provider modules.

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

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

/** fetch + JSON with a useful error message. */
export async function jfetch(url, opts) {
  const res = await fetch(url, opts);
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
    throw new Error(detail);
  }
  return body;
}
