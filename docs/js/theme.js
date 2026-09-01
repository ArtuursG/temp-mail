// Light / Dark, one toggle button. First visit follows the OS setting;
// after that the choice is remembered in localStorage.
import { onLangChange, t } from "./i18n.js";

const KEY = "tempmail:theme";
let mode = "light";

function apply() {
  document.documentElement.setAttribute("data-theme", mode);
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.textContent = mode === "dark" ? "☾" : "☀";
    const label = `${t("theme.toggle")} (${t(mode === "dark" ? "theme.dark" : "theme.light")})`;
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }
}

export function getTheme() {
  return mode;
}

export function setTheme(next) {
  mode = next === "dark" ? "dark" : "light";
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
  apply();
}

export function initTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  if (stored === "light" || stored === "dark") {
    mode = stored;
  } else {
    mode = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  apply();
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.addEventListener("click", () => setTheme(mode === "dark" ? "light" : "dark"));
  onLangChange(apply); // keep the tooltip in sync with the language
}
