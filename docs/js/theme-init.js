// Runs before first paint so the page never flashes the wrong theme.
// Kept as a separate file (not inline) so the page CSP can be script-src 'self'.
try {
  var m = localStorage.getItem("tempmail:theme");
  if (m !== "light" && m !== "dark") {
    m = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", m);
} catch (e) {
  /* localStorage blocked - fall back to the CSS default */
}
