// i18n checks, run in CI:
//  1. every language has exactly the English key set;
//  2. every key the pages / scripts reference exists;
//  3. every English key is referenced somewhere (no dead strings).
// Keys are referenced as data-i18n* attributes in the HTML pages, or as string
// literals in docs/js ("status.live", retentionKey: "dur.7d", ...). A literal
// counts as a key reference when its prefix is one of the dictionary namespaces.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DICTS } from "../docs/js/i18n.js";

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(msg);
};

const enKeys = Object.keys(DICTS.en);
const enSet = new Set(enKeys);
const namespaces = new Set(enKeys.map((k) => k.split(".")[0]));

for (const [lang, dict] of Object.entries(DICTS)) {
  const missing = enKeys.filter((k) => !(k in dict));
  const extra = Object.keys(dict).filter((k) => !enSet.has(k));
  const empty = Object.entries(dict).filter(([, v]) => typeof v !== "string" || !v.trim());
  if (missing.length || extra.length || empty.length) {
    fail(`${lang}: missing [${missing}] extra [${extra}] empty [${empty.map(([k]) => k)}]`);
  } else {
    console.log(`${lang}: ${Object.keys(dict).length} keys ok`);
  }
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const used = new Set();
for (const f of walk("docs").filter((p) => p.endsWith(".html"))) {
  const html = readFileSync(f, "utf8");
  for (const m of html.matchAll(/data-i18n(?:-title|-ph|-aria)?="([^"]+)"/g)) used.add(m[1]);
}
for (const f of walk("docs/js").filter((p) => p.endsWith(".js") && !p.endsWith("i18n.js"))) {
  const js = readFileSync(f, "utf8");
  for (const m of js.matchAll(/["'`]([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+)["'`]/g)) {
    if (namespaces.has(m[1].split(".")[0])) used.add(m[1]);
  }
}

const unresolved = [...used].filter((k) => !enSet.has(k));
if (unresolved.length) fail(`unresolved keys: ${unresolved.join(", ")}`);
else console.log(`${used.size} referenced keys all resolve`);

const unused = enKeys.filter((k) => !used.has(k));
if (unused.length) fail(`unused keys: ${unused.join(", ")}`);
else console.log("no unused keys");

process.exit(failed ? 1 : 0);
