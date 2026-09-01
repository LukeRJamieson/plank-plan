/**
 * Build the app's www/ from the web app.
 *
 * ../index.html stays the single source of truth and is never edited for the
 * app's benefit. This makes the handful of changes a WebView needs, all of
 * them additive, and every one of them fails loudly if its anchor is not
 * found — a silent no-op here would ship a broken app.
 *
 *   node scripts/build-www.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync }
  from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app  = join(here, "..");
const repo = join(app, "..");
const www  = join(app, "www");

let html = readFileSync(join(repo, "index.html"), "utf8");
const steps = [];

/** Replace once, and shout if the anchor has moved. */
function edit(name, find, replace) {
  const before = html;
  html = html.replace(find, replace);
  if (html === before) {
    throw new Error(
      `build-www: "${name}" found nothing to change.\n` +
      `index.html has moved on and this script has not. Fix the anchor before shipping.`
    );
  }
  steps.push(name);
}

/* 1. Safe areas need viewport-fit=cover, or iOS letterboxes the notch. */
edit("viewport-fit",
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');

/* 2. No network at startup. The web build pulls its two typefaces from Google
      Fonts, which in an app means a blank first paint on a bad connection, a
      third-party request to disclose in both stores' privacy forms, and a
      dependency on a host being up. Vendored fonts if we have them, the
      system stack if not. */
const fontDir = join(app, "resources", "fonts");
const faceCss = join(fontDir, "fonts.css");
// scripts/vendor-fonts.mjs writes the @font-face rules alongside the files
// they point at, so nothing here has to infer a weight from a filename. It
// also keeps the unicode-range on each rule, which is what stops the browser
// pulling the latin-ext files down to render plain English.
const faces = existsSync(faceCss) ? readFileSync(faceCss, "utf8") : "";
const fonts = faces ? readdirSync(fontDir).filter(f => f.endsWith(".woff2")) : [];

edit("strip remote fonts",
  /<link rel="preconnect"[\s\S]*?fonts\.googleapis\.com\/css2[^>]*>\n/,
  faces ? `<style>\n${faces}</style>\n` : "");

/* 3. The WebView is the whole screen, so the app has to keep out of the
      status bar, the home indicator and the ad banner itself. --ad-inset is
      set at runtime by native.js from the banner's real measured height,
      because an adaptive banner is not one fixed size. */
edit("native stylesheet", "</head>", `<style>
/* ---------- native shell ---------- */
:root{
  --ad-inset:0px;
  --safe-t:env(safe-area-inset-top,0px);
  --safe-b:env(safe-area-inset-bottom,0px);
  --safe-l:env(safe-area-inset-left,0px);
  --safe-r:env(safe-area-inset-right,0px);
}
html,body{overscroll-behavior:none}
/* Long-press selection all over a drawing tool feels broken; the fields
   still need it. */
body{-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
input,textarea,select{-webkit-user-select:text;user-select:text}

.topbar{
  padding-top:calc(.7rem + var(--safe-t));
  padding-left:calc(1.1rem + var(--safe-l));
  padding-right:calc(1.1rem + var(--safe-r));
}
/* One column: the page scrolls, so the banner just needs room at the end. */
body{padding-bottom:calc(var(--ad-inset) + var(--safe-b))}

@media (min-width:760px){
  /* Two panes: nothing scrolls, so the shell itself has to be shorter. */
  body{
    height:calc(100vh - var(--ad-inset) - var(--safe-b));
    height:calc(100dvh - var(--ad-inset) - var(--safe-b));
    padding-bottom:0;
  }
  .plan-stage{
    height:calc(100vh - 248px - var(--ad-inset) - var(--safe-b));
    height:calc(100dvh - 248px - var(--ad-inset) - var(--safe-b));
  }
  .rail{padding-left:calc(1.1rem + var(--safe-l))}
  .work{padding-right:calc(1.3rem + var(--safe-r))}
}
</style>
</head>`);

/* 4. The shell itself. */
edit("native script", "</body>", '<script src="native.js"></script>\n</body>');

/* ---- write it out ---- */
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
writeFileSync(join(www, "index.html"), html);
copyFileSync(join(app, "src", "native.js"), join(www, "native.js"));
if (fonts.length) {
  mkdirSync(join(www, "fonts"), { recursive: true });
  for (const f of fonts) copyFileSync(join(fontDir, f), join(www, "fonts", f));
}

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`www/index.html  ${kb} kB   [${steps.join(", ")}]`);
console.log(fonts.length
  ? `www/fonts       ${fonts.length} bundled`
  : `www/fonts       none vendored — the app will fall back to system fonts.\n` +
    `                Drop .woff2 files in app/resources/fonts to bundle them.`);
