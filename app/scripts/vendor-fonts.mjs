/**
 * Vendor the two typefaces into the app.
 *
 * The web build fetches them from Google Fonts, which an offline app cannot
 * do — and a request to a third party at startup is something both stores
 * make you declare. This pulls the latin subsets down once so the app ships
 * with its own type and makes no network request at all.
 *
 * Run it when the fonts change, not on every build; the result is committed.
 *
 *   node scripts/vendor-fonts.mjs
 *
 * Bricolage Grotesque and IBM Plex are both under the SIL Open Font Licence,
 * which allows exactly this as long as the licence travels with them.
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const out  = join(here, "..", "resources", "fonts");

const CSS = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;" +
            "12..96,800&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600" +
            "&display=swap";
// A modern UA, or Google serves the truetype fallback instead of woff2.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Google splits every face by writing system. An English-language flooring
// calculator needs the latin ones; carrying Cyrillic and Vietnamese would be
// most of the weight for none of the use.
const KEEP = new Set(["latin", "latin-ext"]);

const css = await (await fetch(CSS, { headers: { "User-Agent": UA } })).text();

// Each face arrives as a /* subset */ comment followed by its rule.
const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)];
if (!blocks.length) throw new Error("vendor-fonts: could not parse the Google Fonts CSS");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const seen = new Map();          // remote url -> local filename
const kept = [];
let bytes = 0;

for (const [, subset, rule] of blocks) {
  if (!KEEP.has(subset)) continue;
  const url = (rule.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
  if (!url) continue;

  if (!seen.has(url)) {
    const family = (rule.match(/font-family:\s*'([^']+)'/) || [, "font"])[1];
    const weight = (rule.match(/font-weight:\s*([\d\s]+)/) || [, "x"])[1].trim().replace(/\s+/g, "-");
    const tag = createHash("sha1").update(url).digest("hex").slice(0, 6);
    const name = `${slug(family)}-${weight}-${subset}-${tag}.woff2`;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    writeFileSync(join(out, name), buf);
    bytes += buf.length;
    seen.set(url, name);
  }
  kept.push(rule.replace(/url\(https:[^)]+\.woff2\)/, `url("fonts/${seen.get(url)}")`));
}

writeFileSync(join(out, "fonts.css"),
  "/* Vendored from Google Fonts by scripts/vendor-fonts.mjs. Do not edit by hand.\n" +
  "   Bricolage Grotesque and IBM Plex are both SIL Open Font Licence 1.1. */\n" +
  kept.join("\n") + "\n");

writeFileSync(join(out, "LICENCE.txt"),
  "Bricolage Grotesque — SIL Open Font Licence 1.1\n" +
  "  https://github.com/ateliertriay/bricolage\n\n" +
  "IBM Plex Sans and IBM Plex Mono — SIL Open Font Licence 1.1\n" +
  "  https://github.com/IBM/plex\n\n" +
  "Both licences permit bundling and redistribution inside an application\n" +
  "provided this notice travels with the font files.\n");

console.log(`${seen.size} files, ${(bytes / 1024).toFixed(0)} kB -> resources/fonts/`);
console.log(`${kept.length} @font-face rules -> resources/fonts/fonts.css`);
