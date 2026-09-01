// Light / Dark, chosen with two buttons (matches the design mockup).
// First visit follows the OS setting; after that the choice is remembered.

const KEY = "tempmail:theme";
let mode = "light";
const listeners = new Set();

function apply() {
  document.documentElement.setAttribute("data-theme", mode);
  document.querySelectorAll("[data-theme-btn]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeBtn === mode);
  });
  listeners.forEach((fn) => fn(mode));
}

export function getTheme() {
  return mode;
}

export function onThemeChange(fn) {
  listeners.add(fn);
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
    mode =
      window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  apply();
  document.querySelectorAll("[data-theme-btn]").forEach((btn) => {
    btn.addEventListener("click", () => setTheme(btn.dataset.themeBtn));
  });
}
