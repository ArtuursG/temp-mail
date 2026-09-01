// Shared bootstrap for the Terms / Privacy pages: language selector + theme
// toggle, reusing the app's i18n and theme modules.
import {
  LANGUAGES,
  applyStaticTranslations,
  getLang,
  initLang,
  onLangChange,
  setLang,
} from "./i18n.js";
import { initTheme } from "./theme.js";

const sel = document.getElementById("lang");
if (sel) {
  sel.innerHTML = LANGUAGES.map(
    (l) => `<option value="${l.code}">${l.label}</option>`
  ).join("");
}

initLang();
applyStaticTranslations();

if (sel) {
  sel.value = getLang();
  sel.addEventListener("change", (e) => setLang(e.target.value));
  onLangChange(() => {
    sel.value = getLang();
  });
}

initTheme();
