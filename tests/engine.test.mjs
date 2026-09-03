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
const {
  EPS, PRESETS, unionIntervals, unionArea, bboxOf, makeTransform, computeLayout,
  snapCandidates, snapOne, snapMoved, normRect,
  MIN_END, MIN_JOIN, rowEnds, endScore, joinGap, bestStagger
} = new Function(
  source +
  "\nreturn { EPS, PRESETS, unionIntervals, unionArea, bboxOf, makeTransform, computeLayout," +
  "\n         snapCandidates, snapOne, snapMoved, normRect," +
  "\n         MIN_END, MIN_JOIN, rowEnds, endScore, joinGap, bestStagger };"
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
/* Snapping, for dragging areas about on the plan                   */
/* ---------------------------------------------------------------- */

test("snapCandidates offers both edges of everything but the dragged area", () => {
  const rects = [{ x: 0, y: 0, w: 1000, h: 800 }, { x: 2000, y: 500, w: 300, h: 200 }];
  const all = snapCandidates(rects, -1);
  assert.deepEqual(all.xs, [0, 1000, 2000, 2300]);
  assert.deepEqual(all.ys, [0, 800, 500, 700]);
  // The area being moved must not snap to where it already is.
  assert.deepEqual(snapCandidates(rects, 0).xs, [2000, 2300]);
});

test("snapOne takes the nearest edge in range and reports it", () => {
  const edges = [0, 1000, 2400];
  assert.deepEqual(snapOne(1006, edges, 20, 10), { v: 1000, at: 1000 });
  assert.deepEqual(snapOne(994, edges, 20, 10), { v: 1000, at: 1000 });
  // 1044 is out of range of every edge, so it falls back to the grid.
  assert.deepEqual(snapOne(1044, edges, 20, 10), { v: 1040, at: null });
});

test("snapOne prefers the closer of two edges within range", () => {
  assert.equal(snapOne(1012, [1000, 1030], 40, 10).v, 1000);
  assert.equal(snapOne(1022, [1000, 1030], 40, 10).v, 1030);
});

test("a dragged area lines up on whichever of its edges is nearest", () => {
  const rects = [{ x: 0, y: 0, w: 5000, h: 3200 }, { x: 2600, y: 3100, w: 1500, h: 1500 }];
  const cands = snapCandidates(rects, 1);

  // Dropped just below the big rectangle: its top edge should catch 3200.
  const down = snapMoved({ x: 2600, y: 3194, w: 1500, h: 1500 }, cands, 20, 10);
  assert.equal(down.y, 3200);
  assert.equal(down.gy, 3200);

  // Pushed the other way, the far edge catches the right-hand wall instead.
  const across = snapMoved({ x: 3494, y: 1000, w: 1500, h: 1500 }, cands, 20, 10);
  assert.equal(across.x + across.w, 5000);
  assert.equal(across.gx, 5000);
});

test("moving an area never changes its size", () => {
  const rects = [{ x: 0, y: 0, w: 5000, h: 3200 }, { x: 100, y: 100, w: 1234, h: 987 }];
  const cands = snapCandidates(rects, 1);
  for (const x of [0, 4, 96, 1003, 4994, -207]) {
    const s = snapMoved({ x, y: x, w: 1234, h: 987 }, cands, 20, 10);
    assert.equal(s.w, 1234);
    assert.equal(s.h, 987);
  }
});

test("with nothing to catch, a drag lands on the grid", () => {
  const s = snapMoved({ x: 1237, y: 884, w: 500, h: 500 }, { xs: [], ys: [] }, 20, 10);
  assert.deepEqual([s.x, s.y, s.gx, s.gy], [1240, 880, null, null]);
});

test("a rectangle drawn backwards comes out the right way round", () => {
  const a = normRect({ x: 100, y: 200 }, { x: 900, y: 800 });
  const b = normRect({ x: 900, y: 800 }, { x: 100, y: 200 });
  assert.deepEqual(a, { x: 100, y: 200, w: 800, h: 600 });
  assert.deepEqual(a, b);
  // Drawn to a point it is empty rather than negative.
  assert.deepEqual(normRect({ x: 5, y: 5 }, { x: 5, y: 5 }), { x: 5, y: 5, w: 0, h: 0 });
});

test("a snapped drag leaves a room the engine can still lay", () => {
  const rects = PRESETS.l.map(r => ({ ...r }));
  const cands = snapCandidates(rects, 1);
  const s = snapMoved({ ...rects[1], x: 2494, y: 3207 }, cands, 20, 10);
  rects[1] = { x: s.x, y: s.y, w: s.w, h: s.h };
  const L = computeLayout(cfg({ rects }));
  assert.ok(L && !L.overflow);
  assert.ok(L.planksUsed > 0);
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
/* Choosing a stagger                                               */
/* ---------------------------------------------------------------- */

test("joinGap measures the gap, not the setting", () => {
  const L = 1285;
  assert.equal(joinGap(300, L), 300);
  assert.equal(joinGap(642.5, L), 642.5);          // half a plank is the most there is
  // Joins repeat every plank, so almost a whole plank is almost no gap at all.
  assert.equal(joinGap(1185, L), 100);
  assert.equal(joinGap(L, L), 0);
  assert.equal(joinGap(L + 300, L), 300);          // and it wraps
  assert.equal(joinGap(-300, L), 300);
  assert.equal(joinGap(300, 0), 0);
});

test("row ends are the pieces finishing each row, counted once", () => {
  const L = computeLayout(cfg());
  const ends = rowEnds(L);
  for (const row of L.rows) {
    if (!row.pieces.length) continue;
    assert.ok(ends.includes(row.pieces[0]), "first piece of a row is not an end");
    assert.ok(ends.includes(row.pieces[row.pieces.length - 1]), "last piece of a row is not an end");
  }
  // A row of a single piece contributes that piece once, not twice. Without
  // the stagger every row here is one 900 mm piece.
  const single = computeLayout(cfg({ rects: [{ x: 0, y: 0, w: 900, h: 192 * 3 }], stagger: 0 }));
  assert.equal(single.rows.length, 3);
  assert.ok(single.rows.every(r => r.pieces.length === 1));
  assert.equal(rowEnds(single).length, 3);
});

test("a full plank finishing a row is never a short end", () => {
  const L = computeLayout(cfg({
    rects: [{ x: 0, y: 0, w: 1285 * 3, h: 192 * 5 }], stagger: 0
  }));
  const e = endScore(L, base.plankL, MIN_END);
  assert.equal(e.short, 0);
  assert.equal(e.shortest, base.plankL);
});

test("endScore counts the ends the warning warns about", () => {
  const L = computeLayout(cfg({ stagger: 300 }));
  const e = endScore(L, base.plankL, MIN_END);
  const byHand = rowEnds(L).filter(p => !p.full && p.w < MIN_END).length;
  assert.equal(e.short, byHand);
  assert.ok(e.shortest > 0 && e.shortest <= base.plankL);
});

test("the worst row end never comes back worse than it went in", () => {
  // The guarantee: whatever is set, if it clears the joins it is one of the
  // candidates, so the answer can only be at least as good on the measure
  // being optimised.
  for (const key of Object.keys(PRESETS)) {
    for (const stagger of [300, 450, 640, 900]) {
      const st = cfg({ rects: PRESETS[key].map(r => ({ ...r })), stagger });
      const r = bestStagger(st);
      assert.ok(r, `${key} @ ${stagger}: no answer`);
      assert.ok(r.shortest >= r.from.shortest,
        `${key} @ ${stagger}: worst end went ${r.from.shortest} -> ${r.shortest}`);
    }
  }
});

test("a stagger that does not clear the joins gets replaced by one that does", () => {
  // These all leave neighbouring joins closer than 300 mm, 1185 because it is
  // only 100 mm short of a whole plank. None should survive.
  for (const stagger of [0, 60, 120, 1185, 1285]) {
    const r = bestStagger(cfg({ stagger }));
    assert.ok(joinGap(r.stagger, base.plankL) >= MIN_JOIN - EPS,
      `${stagger} -> ${r.stagger}, still only ${joinGap(r.stagger, base.plankL)} mm of clearance`);
  }
});

test("it improves every preset it is handed", () => {
  for (const key of Object.keys(PRESETS)) {
    const st = cfg({ rects: PRESETS[key].map(r => ({ ...r })) });
    const r = bestStagger(st);
    assert.ok(r.shortest > r.from.shortest,
      `${key}: worst end no better, ${r.from.shortest} -> ${r.shortest}`);
    assert.ok(r.short <= r.from.short,
      `${key}: more short ends than before, ${r.from.short} -> ${r.short}`);
  }
});

test("it only ever picks a stagger that clears the joins", () => {
  for (const plankL of [1285, 1200, 900, 600]) {
    const r = bestStagger(cfg({ plankL, stagger: 50 }));
    assert.ok(r, `no answer for a ${plankL} mm plank`);
    const need = Math.min(MIN_JOIN, plankL / 3);
    assert.ok(joinGap(r.stagger, plankL) >= need - EPS,
      `${plankL} mm plank: chose ${r.stagger}, leaving only ${joinGap(r.stagger, plankL)} mm`);
  }
});

test("what it reports is what you get when you apply it", () => {
  const st = cfg({ stagger: 305 });
  const r = bestStagger(st);
  const applied = computeLayout({ ...st, stagger: r.stagger });
  const e = endScore(applied, st.plankL, MIN_END);
  assert.equal(e.short, r.short);
  assert.equal(Math.round(e.shortest), r.shortest);
  assert.equal(applied.planksUsed, r.planksUsed);
});

test("pushing the worst end past the limit leaves nothing to count", () => {
  // The two measures are not independent: no end under the limit is exactly
  // what a shortest end above the limit means.
  const st = cfg({ rects: PRESETS.alcove.map(r => ({ ...r })) });
  const r = bestStagger(st);
  assert.equal(r.short === 0, r.shortest >= MIN_END);
});

test("it finds a clean answer where one exists", () => {
  // A plain rectangle three and a bit planks wide: some staggers finish rows
  // on slivers and some do not, so there is a real choice to be made.
  const st = cfg({ rects: [{ x: 0, y: 0, w: 1285 * 3 + 160, h: 192 * 12 }], stagger: 160 });
  const before = endScore(computeLayout(st), st.plankL, MIN_END);
  assert.ok(before.short > 0, "the setup was supposed to start off badly");
  const r = bestStagger(st);
  assert.ok(r.shortest > before.shortest,
    `no improvement: worst end ${before.shortest} -> ${r.shortest}`);
});

test("a tie is settled without moving the stagger about", () => {
  const st = cfg({ stagger: 300 });
  const a = bestStagger(st), b = bestStagger(st);
  assert.deepEqual(a, b);
  const again = bestStagger(cfg({ stagger: a.stagger }));
  assert.equal(again.stagger, a.stagger, "asked again from its own answer, it moved");
});

test("there is nothing to search on herringbone or an unlayable room", () => {
  assert.equal(bestStagger(cfg({ pattern: "herringbone" })), null);
  assert.equal(bestStagger(cfg({ rects: [] })), null);
  assert.equal(bestStagger(cfg({ plankL: 0 })), null);
  // A room too big to lay has no scores to compare.
  assert.equal(bestStagger(cfg({ rects: [{ x: 0, y: 0, w: 5e6, h: 5e6 }] })), null);
});

test("a short plank asks for a third of itself rather than giving up", () => {
  // 300 mm of clearance either side is impossible on a 300 mm plank, so the
  // clearance asked for drops with the plank instead of the search failing.
  const r = bestStagger(cfg({ plankL: 300, plankW: 100, stagger: 10 }));
  assert.ok(r, "gave up on a short plank");
  assert.ok(joinGap(r.stagger, 300) >= 100 - EPS,
    `chose ${r.stagger}, leaving only ${joinGap(r.stagger, 300)} mm`);
});

test("the search stays bounded on a big floor", () => {
  const r = bestStagger(cfg({ rects: [{ x: 0, y: 0, w: 40000, h: 30000 }] }));
  assert.ok(r, "gave up on a large room");
  assert.ok(r.tried >= 8 && r.tried <= 161, `tried ${r.tried} candidates`);
  assert.ok(r.step >= 5 && r.step % 5 === 0, `step of ${r.step} mm is not a usable figure`);
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
/* Carpet                                                           */
/* ---------------------------------------------------------------- */

test("a room narrower than the roll is one drop and no seam", () => {
  const C = computeCarpet(bld({ rects: [{ x: 0, y: 0, w: 3000, h: 4000 }] }));
  assert.equal(C.drops.length, 1);
  assert.equal(C.seams, 0);
  assert.equal(C.rollLength, 4000);
});

test("a room wider than the roll takes a second drop and a seam", () => {
  // 5 m wide off a 4 m roll: one full drop and a 1 m one beside it.
  const C = computeCarpet(bld({ rects: [{ x: 0, y: 0, w: 5000, h: 3200 }] }));
  assert.equal(C.drops.length, 2);
  assert.equal(C.seams, 1);
  // Both drops run the full depth, so the roll gives up two 3.2 m lengths.
  assert.equal(C.rollLength, 6400);
  assert.ok(Math.abs(C.boughtArea - 6.4 * 4) < 1e-9);
  assert.ok(Math.abs(C.floorArea - 16) < 1e-9);
});

test("turning the drops can change how much carpet it takes", () => {
  const rects = [{ x: 0, y: 0, w: 5000, h: 3200 }];
  const down = computeCarpet(bld({ rects, rollDir: "v" }));
  const across = computeCarpet(bld({ rects, rollDir: "h" }));
  // Across the room, 3.2 m fits inside one 4 m drop of 5 m.
  assert.equal(across.drops.length, 1);
  assert.equal(across.rollLength, 5000);
  assert.ok(across.rollLength < down.rollLength, "turning the roll should have helped here");
});

test("carpet never claims to cover less floor than there is", () => {
  for (const key of Object.keys(PRESETS)) {
    const rects = PRESETS[key].map(r => ({ ...r }));
    const C = computeCarpet(bld({ rects }));
    assert.ok(C.boughtArea >= C.floorArea - 1e-9,
      `${key}: bought ${C.boughtArea} for ${C.floorArea}`);
    assert.ok(C.wastePct >= -1e-9 && C.wastePct < 100);
  }
});

test("an L-shape gives shorter drops where the room is shallower", () => {
  // The L preset is 5000 wide overall but only 2600 wide below y=3200.
  const C = computeCarpet(bld({ rects: PRESETS.l.map(r => ({ ...r })), rollW: 2000 }));
  assert.ok(C.drops.length >= 3);
  const lengths = C.drops.map(d => d.len);
  assert.ok(Math.max(...lengths) > Math.min(...lengths),
    "every drop came out the same length on an L-shape");
});

test("carpet drops come back in room coordinates for drawing", () => {
  const C = computeCarpet(bld({ rects: [{ x: 100, y: 200, w: 5000, h: 3200 }] }));
  for (const d of C.drops) {
    assert.ok(d.rect.x >= 100 - EPS && d.rect.y >= 200 - EPS,
      "a drop landed outside the room it belongs to");
  }
});

/* ---------------------------------------------------------------- */
/* Stairs                                                           */
/* ---------------------------------------------------------------- */

test("no steps means no flight", () => {
  assert.equal(computeStairs(bld()), null);
  assert.equal(computeStairs(bld({ stairs: { steps: 0, width: 900 } })), null);
});

test("a carpeted flight is one length up the whole run", () => {
  const S = computeStairs(bld({
    stairs: { steps: 13, width: 900, tread: 280, riser: 175, mat: "carpet", nosing: true }
  }));
  // 13 steps of 455 mm of material each, in a single drop.
  assert.equal(S.perStep, 455);
  assert.equal(S.run, 13 * 455);
  assert.equal(S.drops, 1);
  assert.equal(S.rollLength, 13 * 455);
  assert.ok(Math.abs(S.area - 13 * 900 * 455 / 1e6) < 1e-9);
});

test("a wide flight needs a drop for every roll width across it", () => {
  const S = computeStairs(bld({
    rollW: 1000,
    stairs: { steps: 10, width: 2500, tread: 250, riser: 180, mat: "carpet", nosing: false }
  }));
  assert.equal(S.drops, 3);                 // 2.5 m across a 1 m roll
  assert.equal(S.rollLength, 3 * 10 * 430);
});

test("a laminate flight is clad in plank widths across each face", () => {
  const S = computeStairs(bld({
    plankW: 192,
    stairs: { steps: 12, width: 900, tread: 280, riser: 175, mat: "laminate", nosing: true }
  }));
  // A 280 mm tread takes two 192 mm widths, a 175 mm riser takes one.
  assert.equal(S.piecesPerStep, 3);
  assert.equal(S.pieceCount, 36);
  assert.equal(S.pieceLen, 900);
});

test("the nosing figure counts one per step, and only when asked for", () => {
  const on = computeStairs(bld({
    stairs: { steps: 13, width: 900, tread: 280, riser: 175, mat: "carpet", nosing: true }
  }));
  const off = computeStairs(bld({
    stairs: { steps: 13, width: 900, tread: 280, riser: 175, mat: "carpet", nosing: false }
  }));
  assert.ok(Math.abs(on.nosing - 13 * 0.9) < 1e-9);
  assert.equal(off.nosing, 0);
});

/* ---------------------------------------------------------------- */
/* Winders and landings                                             */
/* ---------------------------------------------------------------- */

const flight = (over = {}) => bld({
  stairs: { steps: 0, winders: 0, landings: 0, width: 900, tread: 280,
            riser: 175, mat: "carpet", nosing: true, ...over }
});

test("a flight of nothing but a landing still counts", () => {
  const S = computeStairs(flight({ landings: 1 }));
  assert.ok(S, "a landing on its own was ignored");
  assert.equal(S.run, 900);                       // a square of the stair width
  assert.ok(Math.abs(S.area - 0.81) < 1e-9);
});

test("a winder is cut from a square of the stair width", () => {
  // The turning tread is a triangle, but the piece that leaves the roll is the
  // square it is cut from, plus that step's riser.
  const S = computeStairs(flight({ winders: 3 }));
  assert.equal(S.winderRun, 3 * (900 + 175));
  assert.equal(S.run, S.winderRun);
  assert.ok(S.area > 3 * 900 * (280 + 175) / 1e6,
    "a winder should take more than a straight step of the same flight");
});

test("the three kinds of step add up rather than replacing each other", () => {
  const S = computeStairs(flight({ steps: 8, winders: 3, landings: 1 }));
  assert.equal(S.straightRun, 8 * 455);
  assert.equal(S.winderRun, 3 * 1075);
  assert.equal(S.landingRun, 900);
  assert.equal(S.run, 8 * 455 + 3 * 1075 + 900);
  assert.equal(S.rollLength, S.run);              // 900 mm fits one 4 m drop
});

test("an L-shaped flight is a straight run, a landing and another run", () => {
  const straight = computeStairs(flight({ steps: 13 }));
  const turned   = computeStairs(flight({ steps: 13, landings: 1 }));
  assert.ok(turned.run > straight.run, "the landing added nothing");
  assert.equal(turned.run - straight.run, 900);
});

test("a landing has no step, so it gets no nosing", () => {
  const S = computeStairs(flight({ steps: 8, winders: 3, landings: 2 }));
  // Eleven steps to finish, and the landings are floor rather than steps.
  assert.ok(Math.abs(S.nosing - 11 * 0.9) < 1e-9, `got ${S.nosing}`);
});

test("a laminate winder is clad across its full width", () => {
  const S = computeStairs(flight({ steps: 0, winders: 1, mat: "laminate" }));
  // A 900 mm winder takes five 192 mm widths, and its riser takes one.
  assert.equal(S.pieceCount, Math.ceil(900 / 192) + Math.ceil(175 / 192));
  assert.equal(S.pieceLen, 900);
});

test("a laminate landing needs cladding but no riser", () => {
  const S = computeStairs(flight({ landings: 1, mat: "laminate" }));
  assert.equal(S.pieceCount, Math.ceil(900 / 192));
});

test("winders and landings reach the building total", () => {
  const floors = { name: "G", rects: [{ x: 0, y: 0, w: 3000, h: 3000, mat: "laminate" }] };
  const plain = computeBuilding(bld({ levels: [floors] }));
  const turning = computeBuilding(bld({ levels: [floors],
    stairs: { steps: 8, winders: 3, landings: 1, width: 900, tread: 280,
              riser: 175, mat: "carpet", nosing: true } }));
  assert.ok(turning.rollLength > 0);
  assert.ok(turning.carpetArea > plain.carpetArea);
  assert.ok(Math.abs(turning.noseMetres - 11 * 0.9) < 1e-9);
});

test("winders and landings save and reload", () => {
  const plan = { ...defaultPlan(),
    stairs: { steps: 8, winders: 3, landings: 2, width: 860, tread: 275,
              riser: 180, mat: "laminate", nosing: false } };
  const { plan: back, warnings } = sanitisePlan(serialisePlan(plan));
  assert.deepEqual(back.stairs, plan.stairs);
  assert.deepEqual(warnings, []);
  // And nonsense in those fields falls back rather than breaking the flight.
  const junk = sanitisePlan({ stairs: { winders: "three", landings: -5 } }).plan;
  assert.equal(junk.stairs.winders, 0);
  assert.equal(junk.stairs.landings, 0);
});

/* ---------------------------------------------------------------- */
/* Stair nosings                                                    */
/* ---------------------------------------------------------------- */

test("an edge knows how long it is and which way round it faces", () => {
  const e = edgesOf({ x: 100, y: 200, w: 800, h: 600 });
  assert.equal(e.length, 4);
  assert.equal(e.find(x => x.side === "n").len, 800);
  assert.equal(e.find(x => x.side === "e").len, 600);
  assert.equal(e.find(x => x.side === "s").y1, 800);
  assert.equal(e.find(x => x.side === "w").x1, 100);
});

test("a nosing names the material on either side of it", () => {
  const st = bld({
    levels: [{ name: "G", rects: [
      { x: 0, y: 0, w: 3000, h: 3000, mat: "laminate" },
      { x: 3000, y: 0, w: 2000, h: 3000, mat: "carpet" }
    ]}],
    noseEdges: [{ level: 0, rect: 0, side: "e" }]
  });
  const runs = noseRuns(st);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].from, "laminate");
  assert.equal(runs[0].to, "carpet");
  assert.equal(runs[0].metres, 3);
});

test("an edge with nothing beyond it transitions to open", () => {
  const st = bld({
    levels: [{ name: "G", rects: [{ x: 0, y: 0, w: 3000, h: 3000, mat: "carpet" }] }],
    noseEdges: [{ level: 0, rect: 0, side: "w" }]
  });
  assert.equal(noseRuns(st)[0].to, "open");
  assert.equal(beyondEdge(st, 0, 0, "n"), "open");
});

test("a nosing on an area that has gone is dropped, not carried", () => {
  const st = bld({
    levels: [{ name: "G", rects: [{ x: 0, y: 0, w: 1000, h: 1000, mat: "laminate" }] }],
    noseEdges: [{ level: 0, rect: 5, side: "n" }, { level: 9, rect: 0, side: "n" }]
  });
  assert.deepEqual(noseRuns(st), []);
  const { plan } = sanitisePlan(st);
  assert.deepEqual(plan.noseEdges, []);
});

/* ---------------------------------------------------------------- */
/* Levels and the building total                                    */
/* ---------------------------------------------------------------- */

test("a level lays only the areas made of the right stuff", () => {
  const st = bld({ levels: [{ name: "G", rects: [
    { x: 0, y: 0, w: 4000, h: 3000, mat: "laminate" },
    { x: 4000, y: 0, w: 2000, h: 3000, mat: "carpet" }
  ]}]});
  const lv = computeLevel(st, 0);
  assert.ok(lv.planks && lv.planks.planksUsed > 0);
  assert.ok(lv.carpet && lv.carpet.drops.length > 0);
  assert.ok(Math.abs(lv.laminateArea - 12) < 1e-9);
  assert.ok(Math.abs(lv.carpetArea - 6) < 1e-9);
  // Neither engine sees the other's areas.
  assert.ok(Math.abs(lv.planks.floorArea - 12) < 1e-9);
  assert.ok(Math.abs(lv.carpet.floorArea - 6) < 1e-9);
});

test("an area with no material named is laminate", () => {
  assert.equal(matOf({ x: 0, y: 0, w: 1, h: 1 }), "laminate");
  assert.equal(matOf({ mat: "shagpile" }), "laminate");
  assert.equal(matOf({ mat: "carpet" }), "carpet");
  assert.equal(matOf(null), "laminate");
});

test("the building adds its levels up", () => {
  const one = bld();
  const two = bld({ levels: [
    { name: "G", rects: PRESETS.l.map(r => ({ ...r, mat: "laminate" })) },
    { name: "F", rects: PRESETS.l.map(r => ({ ...r, mat: "laminate" })) }
  ]});
  const a = computeBuilding(one), b = computeBuilding(two);
  assert.equal(b.planksUsed, a.planksUsed * 2);
  assert.ok(Math.abs(b.laminateArea - a.laminateArea * 2) < 1e-9);
  assert.equal(b.levels.length, 2);
  // Packs are bought once for the job, not once per storey.
  assert.ok(b.packs <= a.packs * 2);
});

test("planks are bought for the whole job, not rounded up per level", () => {
  // Two levels of one plank each is two planks, and one pack.
  const st = bld({ perPack: 8, extra: 0, levels: [
    { name: "G", rects: [{ x: 0, y: 0, w: 1285, h: 192, mat: "laminate" }] },
    { name: "F", rects: [{ x: 0, y: 0, w: 1285, h: 192, mat: "laminate" }] }
  ]});
  const B = computeBuilding(st);
  assert.equal(B.planksUsed, 2);
  assert.equal(B.packs, 1);
});

test("a carpeted flight is added to the roll, a laminate one to the planks", () => {
  const floors = { name: "G", rects: [{ x: 0, y: 0, w: 3000, h: 3000, mat: "laminate" }] };
  const plain = computeBuilding(bld({ levels: [floors] }));
  const carpeted = computeBuilding(bld({ levels: [floors],
    stairs: { steps: 13, width: 900, tread: 280, riser: 175, mat: "carpet", nosing: true } }));
  const laminated = computeBuilding(bld({ levels: [floors],
    stairs: { steps: 13, width: 900, tread: 280, riser: 175, mat: "laminate", nosing: true } }));

  assert.ok(carpeted.rollLength > 0 && carpeted.carpetArea > 0);
  assert.equal(carpeted.planksUsed, plain.planksUsed, "carpet stairs must not need planks");
  assert.equal(laminated.rollLength, 0, "laminate stairs must not need carpet");
  assert.ok(laminated.planksUsed > plain.planksUsed);
  assert.ok(laminated.stairPlanks > 0);
});

test("the nosing total covers both the marked edges and the flight", () => {
  const st = bld({
    levels: [{ name: "G", rects: [{ x: 0, y: 0, w: 3000, h: 2000, mat: "laminate" }] }],
    noseEdges: [{ level: 0, rect: 0, side: "n" }],      // 3 m
    stairs: { steps: 10, width: 900, tread: 280, riser: 175, mat: "carpet", nosing: true }
  });
  const B = computeBuilding(st);
  assert.ok(Math.abs(B.noseMetres - (3 + 10 * 0.9)) < 1e-9, `got ${B.noseMetres}`);
});

test("an empty level is allowed and contributes nothing", () => {
  const B = computeBuilding(bld({ levels: [
    { name: "G", rects: PRESETS.single.map(r => ({ ...r, mat: "laminate" })) },
    { name: "Loft", rects: [] }
  ]}));
  assert.equal(B.levels.length, 2);
  assert.equal(B.levels[1].planks, null);
  assert.equal(B.levels[1].carpet, null);
  assert.ok(B.planksUsed > 0);
});

test("a level too big to lay stops the whole building rather than half-reporting", () => {
  const B = computeBuilding(bld({ levels: [
    { name: "G", rects: [{ x: 0, y: 0, w: 4000, h: 3000, mat: "laminate" }] },
    { name: "F", rects: [{ x: 0, y: 0, w: 5e6, h: 5e6, mat: "laminate" }] }
  ]}));
  assert.equal(B.overflow, true);
});

test("cost adds the two materials together", () => {
  const st = bld({
    levels: [{ name: "G", rects: [
      { x: 0, y: 0, w: 4000, h: 3000, mat: "laminate" },
      { x: 4000, y: 0, w: 2000, h: 3000, mat: "carpet" }
    ]}],
    priceBasis: "pack", price: 30, carpetPrice: 20
  });
  const B = computeBuilding(st);
  assert.ok(B.plankCost > 0 && B.carpetCost > 0);
  assert.ok(Math.abs(B.cost - (B.plankCost + B.carpetCost)) < 1e-9);
  // Carpet is charged on what comes off the roll, not on the floor it covers.
  assert.ok(Math.abs(B.carpetCost - B.carpetBought * 20) < 1e-9);
  assert.ok(B.carpetBought >= B.carpetArea);
});

/* ---------------------------------------------------------------- */
/* Saving and loading                                               */
/* ---------------------------------------------------------------- */

const {
  defaultPlan, serialisePlan, sanitisePlan, MAX_AREAS, MAX_LEVELS,
  matOf, levelRects, computeCarpet, computeStairs, computeLevel, computeBuilding,
  noseRuns, edgesOf, beyondEdge
} = new Function(source +
  "\nreturn { defaultPlan, serialisePlan, sanitisePlan, MAX_AREAS, MAX_LEVELS," +
  "\n         matOf, levelRects, computeCarpet, computeStairs, computeLevel, computeBuilding," +
  "\n         noseRuns, edgesOf, beyondEdge };")();

/** A single-level building wrapped round some rectangles. */
const bld = (over = {}) => ({
  ...base, rollW: 4000, rollDir: "v", carpetPrice: 0,
  stairs: { steps: 0, width: 900, tread: 280, riser: 175, mat: "carpet", nosing: true },
  noseEdges: [],
  levels: [{ name: "Ground floor", rects: PRESETS.l.map(r => ({ ...r, mat: "laminate" })) }],
  ...over
});

test("a saved plan reloads exactly as it was", () => {
  const plan = {
    ...defaultPlan(),
    name: "Back bedroom",
    units: "m",
    levels: [
      { name: "Ground floor", rects: [{ x: 0, y: 0, w: 3200, h: 2800, mat: "laminate" },
                                      { x: 3200, y: 500, w: 1100, h: 1600, mat: "carpet" }] },
      { name: "Loft", rects: [{ x: 0, y: 0, w: 3000, h: 2400, mat: "carpet" }] }
    ],
    rollW: 3660, rollDir: "h", carpetPrice: 24.5,
    stairs: { steps: 13, winders: 3, landings: 1, width: 860, tread: 275,
              riser: 180, mat: "carpet", nosing: true },
    noseEdges: [{ level: 0, rect: 0, side: "e" }],
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
  const start = { ...defaultPlan(), pattern: "herringbone", plankL: 600, plankW: 120 };
  const before = computeBuilding(start);
  const { plan } = sanitisePlan(serialisePlan(start));
  const after = computeBuilding(plan);
  assert.equal(after.planksUsed, before.planksUsed);
  assert.ok(after.planksUsed > 0);
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
  assert.equal(plan.levels[0].rects.length, 1);
  assert.ok(warnings.some(w => w.includes("skipped")));
});

test("a plan with no usable areas resets the room instead of drawing nothing", () => {
  const { plan } = sanitisePlan({ rects: [] });
  assert.deepEqual(plan.levels, defaultPlan().levels);
  // Areas that were offered and all failed is the case worth saying something about.
  const junk = sanitisePlan({ levels: [{ name: "x", rects: [{ w: -1, h: -1 }] }] });
  assert.deepEqual(junk.plan.levels, defaultPlan().levels);
  assert.ok(junk.warnings.some(w => w.includes("reset")));
  assert.ok(computeBuilding(plan).planksUsed > 0);
});

test("a huge area list is capped", () => {
  const rects = Array.from({ length: MAX_AREAS + 12 },
    (_, i) => ({ x: i * 100, y: 0, w: 100, h: 100 }));
  const { plan, warnings } = sanitisePlan({ rects });
  assert.equal(plan.levels[0].rects.length, MAX_AREAS);
  assert.ok(warnings.some(w => w.includes("first")));

  const levels = Array.from({ length: MAX_LEVELS + 5 },
    (_, i) => ({ name: `L${i}`, rects: [{ x: 0, y: 0, w: 1000, h: 1000 }] }));
  const many = sanitisePlan({ levels });
  assert.equal(many.plan.levels.length, MAX_LEVELS);
  assert.ok(many.warnings.some(w => w.includes("levels")));
});

test("a file from something else loads with a warning, not a crash", () => {
  const { plan, warnings, ok } = sanitisePlan({
    format: "some-other-app", version: 99, plan: { plankL: 900 }
  });
  assert.equal(ok, true);
  assert.equal(plan.plankL, 900);
  assert.equal(warnings.length, 2);      // wrong format, and a newer version
  assert.ok(computeBuilding(plan).planksUsed > 0);
  // Handed a whole plan, the single-floor engine finds no areas rather than
  // throwing: sanitisePlan promises whatever it returns is acceptable here.
  assert.equal(computeLayout(plan), null);
});

test("a bare plan without the file wrapper still loads", () => {
  const { plan, ok } = sanitisePlan({ plankL: 900, plankW: 150, pattern: "herringbone" });
  assert.equal(ok, true);
  assert.equal(plan.plankL, 900);
  assert.equal(plan.pattern, "herringbone");
});

test("defaultPlan hands back a fresh room every time", () => {
  const a = defaultPlan(), b = defaultPlan();
  a.levels[0].rects[0].w = 1;
  assert.notEqual(b.levels[0].rects[0].w, 1, "presets are being shared by reference");
  a.stairs.steps = 99;
  assert.notEqual(b.stairs.steps, 99, "the flight is being shared by reference");
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
