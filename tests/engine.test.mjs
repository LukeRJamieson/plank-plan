/**
 * Tests for the layout engine.
 *
 * The app is deliberately a single HTML file, so there is nothing to import.
 * Instead we slice the block between the ENGINE:START / ENGINE:END markers out
 * of index.html and evaluate it. No build step, no dependencies.
 *
 *   node --test tests/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

const start = html.indexOf("/* ENGINE:START");
const end = html.indexOf("/* ENGINE:END */");
assert.ok(start > -1 && end > start, "ENGINE markers missing from index.html");

const source = html.slice(html.indexOf("*/", start) + 2, end);
const { EPS, PRESETS, unionIntervals, unionArea, bboxOf, makeTransform, computeLayout } =
  new Function(
    source +
    "\nreturn { EPS, PRESETS, unionIntervals, unionArea, bboxOf, makeTransform, computeLayout };"
  )();

/** Standard settings; individual tests override what they care about. */
const base = {
  plankL: 1285, plankW: 192, perPack: 8,
  dir: "h", corner: "tl",
  stagger: 300, reuse: true, minOff: 300, extra: 10
};
const cfg = (over = {}) => ({ ...base, rects: PRESETS.l.map(r => ({ ...r })), ...over });

/* ---------------------------------------------------------------- */
/* Geometry primitives                                              */
/* ---------------------------------------------------------------- */

test("unionIntervals merges overlapping and touching spans", () => {
  assert.deepEqual(unionIntervals([[0, 10], [5, 20], [30, 40]]), [[0, 20], [30, 40]]);
  assert.deepEqual(unionIntervals([[10, 20], [0, 10]]), [[0, 20]]);
  assert.deepEqual(unionIntervals([]), []);
});

test("unionArea counts overlapping rectangles once", () => {
  const plain = [{ x: 0, y: 0, w: 1000, h: 1000 }];
  assert.equal(unionArea(plain), 1e6);

  // Two 1000x1000 squares sharing a 500x1000 overlap => 1.5 squares, not 2.
  const lapped = [{ x: 0, y: 0, w: 1000, h: 1000 }, { x: 500, y: 0, w: 1000, h: 1000 }];
  assert.equal(unionArea(lapped), 1.5e6);
});

test("bboxOf spans every rectangle", () => {
  const bb = bboxOf(PRESETS.l);
  assert.equal(bb.x, 0);
  assert.equal(bb.y, 0);
  assert.equal(bb.w, 5000);
  assert.equal(bb.h, 4700);
});

/* ---------------------------------------------------------------- */
/* The plank-space transform                                        */
/* ---------------------------------------------------------------- */

test("toReal undoes toPlank for every direction and corner", () => {
  const rects = PRESETS.t;
  for (const dir of ["h", "v"]) {
    for (const corner of ["tl", "tr", "bl", "br"]) {
      const T = makeTransform(rects, dir, corner);
      for (const r of rects) {
        const back = T.toReal(T.toPlank(r));
        for (const k of ["x", "y", "w", "h"]) {
          assert.ok(Math.abs(back[k] - r[k]) < EPS, `${dir}/${corner} round trip failed on ${k}`);
        }
      }
    }
  }
});

test("the chosen corner ends up at the origin of plank space", () => {
  const rects = PRESETS.l;
  for (const dir of ["h", "v"]) {
    for (const corner of ["tl", "tr", "bl", "br"]) {
      const T = makeTransform(rects, dir, corner);
      const bb = bboxOf(rects.map(T.toPlank));
      assert.ok(Math.abs(bb.x - T.bb.x) < EPS && Math.abs(bb.y - T.bb.y) < EPS,
        `${dir}/${corner} did not land on the bounding box origin`);
    }
  }
});

/* ---------------------------------------------------------------- */
/* Layout invariants                                                */
/* ---------------------------------------------------------------- */

test("pieces within a row never overlap", () => {
  const L = computeLayout(cfg());
  for (const row of L.rows) {
    const sorted = row.pieces.slice().sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].x >= sorted[i - 1].x + sorted[i - 1].w - EPS,
        `row ${row.index}: piece overlap`);
    }
  }
});

test("pieces cover the whole floor and nothing is longer than a plank", () => {
  const L = computeLayout(cfg({ rects: PRESETS.alcove.map(r => ({ ...r })) }));
  const covered = L.pieces.reduce((s, p) => s + p.w * p.h, 0) / 1e6;
  assert.ok(covered >= L.floorArea - EPS, "planks do not reach every part of the floor");
  // Overhang is only ever the last row plus edge bands, so it stays modest.
  assert.ok(covered < L.floorArea * 1.25, "suspiciously large overhang");
  for (const p of L.pieces) {
    assert.ok(p.w > 0 && p.w <= base.plankL + EPS, `piece of ${p.w} mm exceeds a plank`);
  }
});

test("a room that divides exactly needs no cuts at all", () => {
  const L = computeLayout(cfg({
    rects: [{ x: 0, y: 0, w: 1285 * 3, h: 192 * 5 }],
    stagger: 0
  }));
  assert.equal(L.rowCount, 5);
  assert.equal(L.pieces.length, 15);
  assert.equal(L.cutCount, 0);
  assert.equal(L.planksUsed, 15);
  assert.ok(L.pieces.every(p => p.full));
  assert.ok(Math.abs(L.wastePct) < EPS);
});

test("all four corners give the same count on a plain rectangle", () => {
  const rects = [{ x: 0, y: 0, w: 4800, h: 3600 }];
  const counts = ["tl", "tr", "bl", "br"].map(corner =>
    computeLayout(cfg({ rects, corner })).planksUsed);
  assert.equal(new Set(counts).size, 1, `corner symmetry broken: ${counts}`);
});

test("turning the planks changes the layout but keeps the floor area", () => {
  const across = computeLayout(cfg({ dir: "h" }));
  const down = computeLayout(cfg({ dir: "v" }));
  assert.equal(across.floorArea, down.floorArea);
  assert.notEqual(across.rowCount, down.rowCount);
});

test("reusing offcuts never costs more planks", () => {
  for (const key of Object.keys(PRESETS)) {
    const rects = PRESETS[key].map(r => ({ ...r }));
    const on = computeLayout(cfg({ rects, reuse: true })).planksUsed;
    const off = computeLayout(cfg({ rects, reuse: false })).planksUsed;
    assert.ok(on <= off, `${key}: reuse made things worse (${on} vs ${off})`);
  }
});

test("every piece is accounted for as a full plank or a cut", () => {
  const L = computeLayout(cfg());
  const full = L.pieces.filter(p => p.full).length;
  assert.equal(full + L.cutCount, L.pieces.length);
  assert.equal(L.planksUsed, full + L.cutCount - L.offcutSaves);
});

test("the extra allowance rounds up and packs follow it", () => {
  const L = computeLayout(cfg({ extra: 10, perPack: 8 }));
  assert.equal(L.withExtra, Math.ceil(L.planksUsed * 1.1));
  assert.equal(L.packs, Math.ceil(L.withExtra / 8));
});

/* ---------------------------------------------------------------- */
/* Guard rails                                                      */
/* ---------------------------------------------------------------- */

test("absurd dimensions bail out instead of hanging", () => {
  // 5000 metres typed into a millimetre field.
  const L = computeLayout(cfg({ rects: [{ x: 0, y: 0, w: 5e6, h: 5e6 }] }));
  assert.equal(L.overflow, true);
});

test("an empty room returns nothing to draw", () => {
  assert.equal(computeLayout(cfg({ rects: [] })), null);
  assert.equal(computeLayout(cfg({ plankL: 0 })), null);
});

test("a stagger larger than a plank wraps instead of breaking", () => {
  const wrapped = computeLayout(cfg({ stagger: 1285 + 300 }));
  const plain = computeLayout(cfg({ stagger: 300 }));
  assert.equal(wrapped.planksUsed, plain.planksUsed);
});

/* ---------------------------------------------------------------- */
/* Herringbone                                                      */
/* ---------------------------------------------------------------- */

const hb = (over = {}) => cfg({
  pattern: "herringbone", hbAngle: 45, plankL: 600, plankW: 120, ...over
});

test("the herringbone lattice tiles the floor exactly", () => {
  // Every piece is the plank clipped to the room, so the areas must add
  // up to the floor area. Gaps or overlaps in the lattice would show here.
  for (const angle of [45, 135, 0, 90]) {
    for (const key of Object.keys(PRESETS)) {
      const L = computeLayout(hb({ rects: PRESETS[key].map(r => ({ ...r })), hbAngle: angle }));
      const covered = (L.pieces.reduce((s, p) => s + p.area, 0) + L.sliverArea) / 1e6;
      assert.ok(Math.abs(covered - L.floorArea) < 1e-9,
        `${key} at ${angle}°: pieces cover ${covered} m² of a ${L.floorArea} m² floor`);
      // Discarded slivers must stay negligible, or the threshold is too blunt.
      assert.ok(L.sliverArea / 1e6 < L.floorArea * 1e-4, "too much floor lost to slivers");
    }
  }
});

test("herringbone tiles at any length-to-width ratio", () => {
  for (const [plankL, plankW] of [[600, 120], [1285, 192], [500, 111], [900, 150]]) {
    const L = computeLayout(hb({ plankL, plankW }));
    const covered = (L.pieces.reduce((s, p) => s + p.area, 0) + L.sliverArea) / 1e6;
    assert.ok(Math.abs(covered - L.floorArea) < 1e-9, `${plankL}x${plankW} does not tile`);
  }
});

test("full herringbone planks are exactly one plank, borders are less", () => {
  const L = computeLayout(hb());
  const whole = 600 * 120;
  for (const p of L.pieces) {
    assert.ok(p.area <= whole + 1, "a piece is larger than a plank");
    if (p.full) assert.ok(Math.abs(p.area - whole) < 1, "a full plank is not full size");
    else assert.ok(p.area < whole, "a border piece is full size");
  }
  assert.ok(L.pieces.some(p => p.full), "no whole planks in the field");
  assert.ok(L.cutCount > 0, "no border cuts at all");
});

test("herringbone needs at least enough planks to cover the floor", () => {
  const L = computeLayout(hb());
  assert.ok(L.planksUsed >= L.floorArea * 1e6 / (600 * 120));
  assert.equal(L.mode, "herringbone");
  assert.equal(L.rowCount, 0);          // no rows to speak of
});

test("the anchor corner moves the pattern without changing the floor", () => {
  const areas = ["tl", "tr", "bl", "br"].map(corner => {
    const L = computeLayout(hb({ corner }));
    return (L.pieces.reduce((s, p) => s + p.area, 0) + L.sliverArea) / 1e6;
  });
  for (const a of areas) assert.ok(Math.abs(a - areas[0]) < 1e-9);
});

test("herringbone bails out on absurd dimensions too", () => {
  const L = computeLayout(hb({ rects: [{ x: 0, y: 0, w: 5e6, h: 5e6 }] }));
  assert.equal(L.overflow, true);
});

/* ---------------------------------------------------------------- */
/* Pricing                                                          */
/* ---------------------------------------------------------------- */

test("each pricing basis charges for the packs actually bought", () => {
  const perPack = 8, plankArea = 1285 * 192 / 1e6;
  const byPack = computeLayout(cfg({ priceBasis: "pack", price: 60, perPack }));
  const byPlank = computeLayout(cfg({ priceBasis: "plank", price: 7.5, perPack }));
  const byM2 = computeLayout(cfg({ priceBasis: "m2", price: 30, perPack }));

  assert.equal(byPack.planksBought, byPack.packs * perPack);
  assert.equal(byPack.cost, byPack.packs * 60);
  assert.equal(byPlank.cost, byPlank.planksBought * 7.5);
  assert.ok(Math.abs(byM2.cost - byM2.planksBought * plankArea * 30) < 1e-9);
});

test("no price means no cost, not a broken figure", () => {
  const L = computeLayout(cfg({ price: 0 }));
  assert.equal(L.cost, 0);
  assert.equal(L.costPerM2, 0);
});

test("cost per square metre reflects the floor, not the product bought", () => {
  const L = computeLayout(cfg({ priceBasis: "pack", price: 60 }));
  assert.ok(Math.abs(L.costPerM2 - L.cost / L.floorArea) < 1e-9);
  assert.ok(L.costPerM2 > 0);
});

test("a bigger allowance never costs less", () => {
  const cheap = computeLayout(cfg({ priceBasis: "pack", price: 60, extra: 5 }));
  const safe = computeLayout(cfg({ priceBasis: "pack", price: 60, extra: 20 }));
  assert.ok(safe.cost >= cheap.cost);
});

/* ---------------------------------------------------------------- */
/* Saving and loading                                               */
/* ---------------------------------------------------------------- */

const { defaultPlan, serialisePlan, sanitisePlan, MAX_AREAS } =
  new Function(source + "\nreturn { defaultPlan, serialisePlan, sanitisePlan, MAX_AREAS };")();

test("a saved plan reloads exactly as it was", () => {
  const plan = {
    ...defaultPlan(),
    name: "Back bedroom",
    units: "m",
    rects: [{ x: 0, y: 0, w: 3200, h: 2800 }, { x: 3200, y: 500, w: 1100, h: 1600 }],
    plankL: 600, plankW: 120, perPack: 10,
    pattern: "herringbone", hbAngle: 135, corner: "br", dir: "v",
    stagger: 450, reuse: false, minOff: 250, extra: 15,
    priceBasis: "m2", price: 42.5, currency: "AU$"
  };
  const file = JSON.parse(JSON.stringify(serialisePlan(plan)));
  assert.equal(file.format, "plank-plan");
  const { plan: back, warnings } = sanitisePlan(file);
  assert.deepEqual(back, plan);
  assert.deepEqual(warnings, []);
});

test("a saved plan still computes after the round trip", () => {
  const before = computeLayout({ ...defaultPlan(), pattern: "herringbone", plankL: 600, plankW: 120 });
  const { plan } = sanitisePlan(serialisePlan({ ...defaultPlan(), pattern: "herringbone", plankL: 600, plankW: 120 }));
  const after = computeLayout(plan);
  assert.equal(after.planksUsed, before.planksUsed);
});

test("junk in place of a plan is refused, not loaded", () => {
  for (const junk of [null, undefined, 42, "a string", [1, 2, 3], true]) {
    const r = sanitisePlan(junk);
    assert.equal(r.ok, false, `${JSON.stringify(junk)} was accepted`);
    assert.ok(r.warnings.length);
    assert.deepEqual(r.plan, defaultPlan());   // caller gets something usable
  }
});

test("an empty object loads as the defaults without complaint", () => {
  const { plan, ok } = sanitisePlan({});
  assert.equal(ok, true);
  assert.deepEqual(plan, defaultPlan());
});

test("out-of-range numbers are clamped, not accepted", () => {
  const { plan } = sanitisePlan({
    plankL: -5, plankW: 1e9, perPack: 0.4, extra: 900, price: -12, stagger: 99999
  });
  assert.ok(plan.plankL >= 100 && plan.plankW <= 2000);
  assert.ok(plan.perPack >= 1 && Number.isInteger(plan.perPack));
  assert.ok(plan.extra <= 100 && plan.price >= 0 && plan.stagger <= 5000);
});

test("nonsense values fall back to the default rather than breaking", () => {
  const d = defaultPlan();
  const { plan } = sanitisePlan({
    units: "furlongs", pattern: "basketweave", corner: "middle",
    hbAngle: 33, dir: "sideways", priceBasis: "per pallet",
    plankL: "not a number", reuse: "yes", currency: "   ", name: ""
  });
  assert.equal(plan.units, d.units);
  assert.equal(plan.pattern, d.pattern);
  assert.equal(plan.corner, d.corner);
  assert.equal(plan.hbAngle, d.hbAngle);
  assert.equal(plan.dir, d.dir);
  assert.equal(plan.priceBasis, d.priceBasis);
  assert.equal(plan.plankL, d.plankL);
  assert.equal(plan.reuse, d.reuse);
  assert.equal(plan.currency, d.currency);
  assert.equal(plan.name, d.name);
});

test("unreadable areas are dropped and reported", () => {
  const { plan, warnings } = sanitisePlan({
    rects: [
      { x: 0, y: 0, w: 3000, h: 3000 },    // fine
      { x: 0, y: 0, w: -50, h: 100 },      // negative
      { x: 0, y: 0, w: 100 },              // missing height
      { x: NaN, y: 0, w: 100, h: 100 },    // not a number
      null
    ]
  });
  assert.equal(plan.rects.length, 1);
  assert.ok(warnings.some(w => w.includes("skipped")));
});

test("a plan with no usable areas resets the room instead of drawing nothing", () => {
  const { plan, warnings } = sanitisePlan({ rects: [] });
  assert.deepEqual(plan.rects, defaultPlan().rects);
  assert.ok(warnings.some(w => w.includes("reset")));
  assert.ok(computeLayout(plan));
});

test("a huge area list is capped", () => {
  const rects = Array.from({ length: MAX_AREAS + 12 },
    (_, i) => ({ x: i * 100, y: 0, w: 100, h: 100 }));
  const { plan, warnings } = sanitisePlan({ rects });
  assert.equal(plan.rects.length, MAX_AREAS);
  assert.ok(warnings.some(w => w.includes("first")));
});

test("a file from something else loads with a warning, not a crash", () => {
  const { plan, warnings, ok } = sanitisePlan({
    format: "some-other-app", version: 99, plan: { plankL: 900 }
  });
  assert.equal(ok, true);
  assert.equal(plan.plankL, 900);
  assert.equal(warnings.length, 2);      // wrong format, and a newer version
  assert.ok(computeLayout(plan));
});

test("a bare plan without the file wrapper still loads", () => {
  const { plan, ok } = sanitisePlan({ plankL: 900, plankW: 150, pattern: "herringbone" });
  assert.equal(ok, true);
  assert.equal(plan.plankL, 900);
  assert.equal(plan.pattern, "herringbone");
});

test("defaultPlan hands back a fresh room every time", () => {
  const a = defaultPlan(), b = defaultPlan();
  a.rects[0].w = 1;
  assert.notEqual(b.rects[0].w, 1, "presets are being shared by reference");
});

/* ---------------------------------------------------------------- */
/* The set-out point                                                */
/* ---------------------------------------------------------------- */

test("no set-out offset lays the same floor as before", () => {
  const a = computeLayout(cfg({ originX: 0, originY: 0 }));
  const b = computeLayout(cfg());                 // defaults are 0, 0
  assert.equal(a.planksUsed, b.planksUsed);
  assert.equal(a.rowCount, b.rowCount);
  assert.equal(a.firstRowDepth, base.plankW);     // starts hard against the wall
});

test("an offset across the rows adds a part row at the wall", () => {
  const plain = computeLayout(cfg({ originY: 0 }));
  const moved = computeLayout(cfg({ originY: 90 }));
  assert.equal(moved.rowCount, plain.rowCount + 1);
  assert.ok(Math.abs(moved.firstRowDepth - 90) < 1e-6);
});

test("the rows still add up to the room after a set-out offset", () => {
  const bbH = 4700;                               // the L preset is 5000 x 4700
  for (const originY of [0, 50, 90, 191, 300, 1000]) {
    const L = computeLayout(cfg({ originY }));
    const middle = (L.rowCount - 1) * base.plankW;
    const total = originY === 0 ? middle + L.lastRowDepth
                                : L.firstRowDepth + (L.rowCount - 2) * base.plankW + L.lastRowDepth;
    assert.ok(Math.abs(total - bbH) < 1e-6,
      `originY ${originY}: rows total ${total}, room is ${bbH}`);
  }
});

test("planks still cover the whole floor from any set-out point", () => {
  for (const originX of [0, 200, 640]) {
    for (const originY of [0, 90, 300]) {
      const L = computeLayout(cfg({ originX, originY }));
      const covered = L.pieces.reduce((s, p) => s + p.w * p.h, 0) / 1e6;
      assert.ok(covered >= L.floorArea - 1e-9,
        `set-out ${originX},${originY} leaves floor uncovered`);
      for (const p of L.pieces) assert.ok(p.w <= base.plankL + EPS);
    }
  }
});

test("shifting along the row by a whole plank changes nothing", () => {
  const a = computeLayout(cfg({ originX: 0 }));
  const b = computeLayout(cfg({ originX: base.plankL }));
  assert.equal(a.planksUsed, b.planksUsed);
  assert.equal(a.pieces.length, b.pieces.length);
});

test("the set-out axes follow the plank direction", () => {
  // Running the planks the other way should swap which axis moves the rows.
  const across = computeLayout(cfg({ dir: "h", originY: 90 }));
  const down = computeLayout(cfg({ dir: "v", originX: 90 }));
  assert.ok(Math.abs(across.firstRowDepth - 90) < 1e-6);
  assert.ok(Math.abs(down.firstRowDepth - 90) < 1e-6);
});

test("balancing the edge rows makes both ends equal", () => {
  const W = base.plankW, span = 4700;             // the L preset, across the rows
  const leftover = span - Math.floor(span / W) * W;
  const d = Math.round((leftover + W) / 2);
  const L = computeLayout(cfg({ originY: d }));
  assert.ok(Math.abs(L.firstRowDepth - L.lastRowDepth) < 1,
    `edges are ${L.firstRowDepth} and ${L.lastRowDepth}`);
  assert.ok(L.firstRowDepth > W / 2, "a balanced edge row should be over half a plank");
});

test("herringbone moves its whole lattice with the set-out point", () => {
  const plain = computeLayout(hb({ originX: 0, originY: 0 }));
  const moved = computeLayout(hb({ originX: 137, originY: 61 }));
  // Still an exact tiling, just landing somewhere else.
  const cover = L => (L.pieces.reduce((s, p) => s + p.area, 0) + L.sliverArea) / 1e6;
  assert.ok(Math.abs(cover(moved) - moved.floorArea) < 1e-9);
  assert.notEqual(moved.pieces.length, plain.pieces.length);
});

test("the set-out point saves and reloads", () => {
  const plan = { ...defaultPlan(), originX: 320, originY: 96 };
  const { plan: back } = sanitisePlan(serialisePlan(plan));
  assert.equal(back.originX, 320);
  assert.equal(back.originY, 96);
  assert.equal(sanitisePlan({ originX: "over there", originY: 1e9 }).plan.originX, 0);
});
