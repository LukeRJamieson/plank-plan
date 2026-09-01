/**
 * Check the built www/ before it goes anywhere near a store.
 *
 * These are the things that are silent when they break and expensive when
 * they ship: a font still loading off the network, an ad unit still set to
 * Google's test ID (or, worse, live IDs left on while `testing` is true), an
 * engine that did not survive the copy.
 *
 *   npm run check
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app  = join(here, "..");
const www  = join(app, "www");

const problems = [], notes = [];
const fail = m => problems.push(m);
const note = m => notes.push(m);

if (!existsSync(join(www, "index.html"))) {
  console.error("No www/index.html. Run `npm run www` first.");
  process.exit(1);
}
const html = readFileSync(join(www, "index.html"), "utf8");
const native = readFileSync(join(app, "src", "native.js"), "utf8");

/* ---- the app has to be self-contained ---- */
const remote = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map(m => m[1]);
if (remote.length) fail(`www/index.html still fetches from the network:\n    ${remote.join("\n    ")}`);
if (!/<script src="native.js">/.test(html)) fail("native.js is not wired into www/index.html.");
if (!existsSync(join(www, "native.js"))) fail("www/native.js is missing.");
if (!/viewport-fit=cover/.test(html)) fail("viewport-fit=cover is missing; iOS will letterbox the notch.");
if (!/--ad-inset/.test(html)) fail("the native stylesheet did not make it in.");

/* ---- fonts ---- */
const fontDir = join(www, "fonts");
const fonts = existsSync(fontDir) ? readdirSync(fontDir).filter(f => f.endsWith(".woff2")) : [];
if (!fonts.length) {
  note("No fonts bundled — the app will use the system stack. `node scripts/vendor-fonts.mjs` fixes that.");
} else {
  for (const ref of [...html.matchAll(/url\("fonts\/([^"]+)"\)/g)].map(m => m[1])) {
    if (!fonts.includes(ref)) fail(`www/index.html points at fonts/${ref}, which is not there.`);
  }
}

/* ---- the engine survived the copy ---- */
if (html.indexOf("/* ENGINE:START") < 0 || html.indexOf("/* ENGINE:END */") < 0) {
  fail("the engine markers are gone from the built page.");
}
for (const fn of ["computeLayout", "bestStagger", "sanitisePlan", "snapMoved"]) {
  if (!html.includes(`function ${fn}`)) fail(`${fn}() is missing from the built page.`);
}

/* ---- ads ---- */
const TEST_UNIT = /ca-app-pub-3940256099942544/;
const testing = /testing:\s*true/.test(native);
const unitsAreTest = TEST_UNIT.test(native);

const manifest = join(app, "android", "app", "src", "main", "AndroidManifest.xml");
const plist = join(app, "ios", "App", "App", "Info.plist");
const androidAppId = existsSync(manifest)
  ? (readFileSync(manifest, "utf8").match(/ads\.APPLICATION_ID"\s*\n?\s*android:value="([^"]+)"/) || [])[1]
  : null;
const iosAppId = existsSync(plist)
  ? (readFileSync(plist, "utf8").match(/GADApplicationIdentifier<\/key>\s*\n?\s*<string>([^<]+)</) || [])[1]
  : null;

if (!androidAppId) fail("no AdMob APPLICATION_ID in AndroidManifest.xml — the app crashes on launch without it.");
if (!iosAppId) fail("no GADApplicationIdentifier in Info.plist — the app crashes on launch without it.");

const appIdsAreTest = TEST_UNIT.test(androidAppId || "") || TEST_UNIT.test(iosAppId || "");

if (testing && !unitsAreTest) {
  fail("native.js has testing:true but real ad unit IDs. Live units served as test ads earn nothing;\n" +
       "    worse, tapping your own live ad is what gets AdMob accounts suspended.");
}
if (!testing && unitsAreTest) {
  fail("native.js has testing:false but is still using Google's test ad units. It will show test ads in production.");
}
if (!testing && appIdsAreTest) {
  fail("the app-level AdMob IDs in AndroidManifest.xml / Info.plist are still Google's test IDs.");
}
if (testing || unitsAreTest || appIdsAreTest) {
  note("Ads are in TEST mode. That is right for development and wrong for the store —\n" +
       "      see app/README.md before you build a release.");
}

/* ---- report ---- */
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`www/index.html   ${kb} kB`);
console.log(`www/fonts        ${fonts.length} file${fonts.length === 1 ? "" : "s"}`);
console.log(`ads              ${testing ? "TEST" : "LIVE"}  units=${unitsAreTest ? "test" : "yours"}` +
            `  appId=${appIdsAreTest ? "test" : "yours"}`);
for (const n of notes) console.log(`\n  note  ${n}`);
if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("\nAll checks passed.");
