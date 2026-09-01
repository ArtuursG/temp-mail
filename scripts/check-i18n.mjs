// Fails if any language is missing keys, or if a data-i18n / t() key used in the
// app has no entry in the English dictionary.
import { readFileSync } from "node:fs";

const i18n = readFileSync("docs/js/i18n.js", "utf8");
const DICTS = eval(
  "(" + i18n.match(/const DICTS = (\{[\s\S]*?\n\};)/)[1].slice(0, -1) + ")"
);

let failed = false;
const enKeys = Object.keys(DICTS.en);
const enSet = new Set(enKeys);

for (const [lang, dict] of Object.entries(DICTS)) {
  const missing = enKeys.filter((k) => !(k in dict));
  const extra = Object.keys(dict).filter((k) => !enSet.has(k));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`${lang}: missing [${missing}] extra [${extra}]`);
  } else {
    console.log(`${lang}: ${Object.keys(dict).length} keys ok`);
  }
}

const used = new Set();
for (const f of ["docs/index.html", "docs/terms.html", "docs/privacy.html"]) {
  const html = readFileSync(f, "utf8");
  for (const m of html.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)) used.add(m[1]);
}
const app = readFileSync("docs/js/app.js", "utf8");
for (const m of app.matchAll(/\bt\(\s*"([^"]+)"/g)) used.add(m[1]);

const unresolved = [...used].filter((k) => !enSet.has(k));
if (unresolved.length) {
  failed = true;
  console.error(`unresolved keys: ${unresolved.join(", ")}`);
} else {
  console.log(`${used.size} referenced keys all resolve`);
}

process.exit(failed ? 1 : 0);
