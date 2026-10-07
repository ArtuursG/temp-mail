// Pure helpers that pull the useful bit out of a verification mail: the
// one-time code and the confirmation link. No DOM access, so they run (and are
// unit-tested) in Node too.

// Words that tend to sit next to a one-time code (en / lv / de / es).
const CODE_KW =
  /verif|confirm|one[- ]?time|\botp\b|\bpin\b|\bcodes?\b|passcode|2fa|two.?factor|\bkod[sau]?\b|apstiprin|bestätig|einmal|c[oó]digo/gi;

// Candidate shapes, most specific first: "123 456" / "1234-5678", 4-8 digits,
// or 6-8 upper-case letters + digits (must contain both).
const CANDIDATE =
  /(?<![\w#+$€£.,/-])(\d{3}[ -]\d{3}|\d{4}[ -]\d{4}|\d{4,8}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8})(?![\w])(?![.,:]\d)(?![-/]\d)/g;

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/**
 * Best guess at the one-time code in a message, or null.
 * Candidates are scored: closeness to a code keyword, a line of their own, and
 * the classic 6-digit shape count for; years, prices, dates, order numbers and
 * anything inside a URL are skipped. Without any keyword only a 6-digit (or
 * grouped) number standing on its own line is accepted.
 */
export function findCode(subject, text) {
  const subj = String(subject || "");
  // URLs carry ids and tracking numbers, never the code - blank them out
  // (keeping offsets stable is not needed, only line structure).
  const body = String(text || "").replace(URL_RE, " ");
  const hay = `${subj}\n${body}`;

  const kws = [...hay.matchAll(CODE_KW)].map((m) => [m.index, m.index + m[0].length]);
  const hasKw = kws.length > 0;

  let best = null;
  for (const m of hay.matchAll(CANDIDATE)) {
    const value = m[1];
    const start = m.index;
    const end = start + value.length;
    const digitsOnly = /^\d+$/.test(value);
    const grouped = /^\d+[ -]\d+$/.test(value);
    const alnum = !digitsOnly && !grouped;

    if (digitsOnly && value.length === 4 && /^(19|20)\d\d$/.test(value)) continue; // a year

    const lineStart = hay.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = hay.indexOf("\n", end);
    if (lineEnd < 0) lineEnd = hay.length;
    const standalone = hay.slice(lineStart, lineEnd).trim() === value;

    const kwBefore = kws.some(([, e]) => e <= start && start - e <= 160);
    const kwAfter = kws.some(([s]) => s >= end && s - end <= 40);
    const near = kwBefore || kwAfter;

    if (!hasKw && !(standalone && (grouped || value.length === 6))) continue;
    if (alnum && !near) continue;

    let score = 0;
    if (digitsOnly) score += value.length === 6 ? 3 : 1;
    if (grouped) score += 2;
    if (kwBefore) score += 4;
    else if (kwAfter) score += 3;
    if (standalone) score += 3;
    if (start < subj.length) score += 2;

    if (score >= 4 && (!best || score > best.score)) best = { value, score };
  }
  return best ? best.value : null;
}

/** Links written out in a plain-text body, with the text of their line. */
export function extractTextLinks(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    for (const m of line.matchAll(URL_RE)) {
      const href = m[0].replace(/[.,;:!?)\]}>]+$/, "");
      out.push({ href, text: line.replace(m[0], " ").trim() });
    }
  }
  return out;
}

const LINK_KW =
  /verif|confirm|activat|validat|magic|sign[ _-]?in|log[ _-]?in|reset|password|bestätig|aktivier|apstiprin|aktivizē|verificar|confirmar|activar|\btoken\b|\bauth/i;
const LINK_SKIP =
  /unsubscribe|abmelden|darse de baja|atteikties|preferences|privacy|datenschutz|privacidad|\bterms\b|help|support|facebook|twitter|instagram|linkedin|youtube|view (?:it )?in (?:your )?browser/i;

/**
 * Picks the link a verification mail wants you to click, or null.
 * `links` is [{ href, text }]. Only absolute http(s) URLs are considered.
 * Returns { href, host }.
 */
export function pickActionLink(links) {
  let best = null;
  for (const { href, text } of links || []) {
    let url;
    try {
      url = new URL(String(href).trim());
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const label = String(text || "");
    let target = `${url.pathname}${url.search}`;
    try {
      target = decodeURIComponent(target);
    } catch {
      /* malformed escape - score the raw form */
    }
    if (LINK_SKIP.test(label) || LINK_SKIP.test(target)) continue;

    let score = 0;
    if (LINK_KW.test(label)) score += 3;
    if (LINK_KW.test(target)) score += 2;
    if (/[A-Za-z0-9_-]{20,}/.test(url.search || url.pathname)) score += 1;
    if (score >= 2 && (!best || score > best.score)) {
      best = { href: url.href, host: url.host, score };
    }
  }
  return best ? { href: best.href, host: best.host } : null;
}
