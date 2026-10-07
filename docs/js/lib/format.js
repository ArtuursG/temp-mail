// Small string helpers shared by the UI. No DOM access.

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape text for use inside HTML markup or a quoted attribute. */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** srcdoc value is un-escaped then parsed as HTML: only & and " must be encoded. */
export function escSrcdoc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
