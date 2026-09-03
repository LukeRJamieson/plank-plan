# CLAUDE.md

Context for Claude Code working on this repo.

## What this is

Plank Plan works out how many laminate planks a room needs. It does not divide
floor area by plank area — it simulates the actual laying sequence, piece by
piece, so the answer accounts for where the cuts genuinely fall and which
offcuts get reused.

The room is a **union of axis-aligned rectangles**, which is how L-shapes,
T-shapes and alcoves are expressed. Rectangles may overlap; overlaps are counted
once.

Two patterns are supported: **straight rows** and **herringbone**. They share
the material accounting and the pricing, but the piece geometry is worked out in
completely different ways — see below.

## Layout of the repo

```
index.html                 the entire application — markup, styles, logic
tests/engine.test.mjs      Node tests for the geometry, layout maths and file loading
package.json               scripts only; there are no dependencies
app/                       the Android and iOS builds — a shell around index.html
```

`app/` is a Capacitor wrapper, not a second copy of the app. It has its own
dependencies and its own README; nothing in it is needed to work on the web
version, and the web version is still the primary one. See **The app builds**
below before touching it.

## Levels, materials and the flight

A plan is a **stack of levels**, each with its own areas, and every area
carries a **material** — `laminate` or `carpet`. A flight of **stairs** belongs
to the building rather than to any level, because a flight is the hole between
two floors and not part of either one's footprint. Marked **nosings** are edges
of an area, stored as `{level, rect, side}`.

`state.rects` is the current level's rectangles, reached through an accessor
rather than copied. Everything that draws or edits works on one storey at a
time and can go on saying `state.rects`; `bindLevel` changes which array that
is. Reading *and* writing both go through, so `state.rects = [...]` cannot
leave a stale array behind — a plain alias would, silently.

The engines never see each other's areas: `computeLevel` hands the plank
engine only the laminate rectangles and the carpet sweep only the carpet ones,
so neither needed to learn the other exists. `computeBuilding` runs every
level and totals them, and the totals are what get the extra allowance and the
pack rounding — you buy for the job, not per storey. Two levels of one plank
each is one pack, and there is a test on it.

`computeCarpet` is deliberately the same shape as `computeStraight`: bands of
roll width across the room, then the covered intervals within each band. Each
interval is one drop, because a drop is cut as a single piece. Roll length is
simply every drop laid end to end — you buy the full width whatever the drop
needs — which is also how a carpet shop quotes it.

Nosing edges are indices, so anything that removes or reorders an area or a
level has to fix them up: `dropNoseFor`, `shiftNoseLevels`, and a filter in
`sanitisePlan` that drops any edge naming an area that is no longer there.

## Areas with an angled corner

An area is a rectangle with, at most, **one** corner sliced off by a straight
line — `cut: {corner, dx, dy}`. That covers a chamfered corner, an angled bay
and a triangular room, and unions of them cover the rest, which is the same
trick the app already plays with L-shapes. Two corners off one room is two
areas.

One cut, deliberately: it keeps the removed region a single triangle, and that
is what lets the floor be decomposed **exactly** rather than approximately.

`floorCells()` is the piece everything else hangs off. It slices a full grid on
every rect edge and, for each cell, asks which areas reach it. A point is floor
unless *every* owner has sliced it away, so the cell's `hole` is the
intersection of the owners' triangles — and an intersection of convex shapes is
convex, which is what keeps `clipToPoly` able to compute it. Both `unionArea`
and the herringbone clipper read `floorCells`, so the two can never disagree
about how much floor there is.

Do **not** build cells from `disjointRects`: it merges the y-intervals of
*different* areas, so two rooms stacked one above the other come back as a
single cell that neither contains, leaving no owner to ask about the cut. That
bug lost a whole cell's floor and only a weak assertion caught it.

`spanAt` / `spanAcross` give the *envelope* of an area within a band, not its
guaranteed depth: where a cut slopes through a row the planks still run out to
the furthest point, and the rip check is what notices the band is not full
depth. Both clip the area's polygon rather than working four corners out by
hand.

A cut travels with its area through the plank transform and the carpet swap.
`swapAxes` is shared by both for exactly that reason — an earlier draft had
`computeCarpet` swapping with its own helper, which silently dropped the cut
and made a sloping wall cost full-length drops.

## Undo

`remember()` is called **before** a change and records the state the edit
started from, so after an edit the live room is one step *ahead* of the stack
tip. `undo()` is what parks the current state as a redo target before stepping
back — which is the only way redo has anything to return to. Getting this
wrong is easy: an earlier draft de-duplicated the pre-change snapshot against
the tip, which meant the very first edit recorded nothing and undo did nothing.

Only the shape of the building is remembered — levels, areas, the flight,
the nosings. Plank length and the like are settings rather than drawing, and
snapshotting them would put an entry on the stack for every keystroke in a
number field. Typed figures land on the stack on `change`, not on `input`.

`histHold` stops the redraw inside `applySnapshot` pushing back what it has
just restored.

## The plan view

The drawing is a camera on the room, not a fixed picture of it. `view` holds
where it points (`cx`, `cy` in room coordinates) and how far back it sits:
`upp` is **room units per screen pixel**, so a smaller `upp` is further in.

The viewBox is built to the *stage's* aspect ratio rather than the room's,
which is why the stage has an explicit height. Get that wrong and zooming
reflows the page under the pointer. `toWorld` and `toScreen` are the exact
inverses of that mapping, and are what every gesture is expressed in.

Anything that is furniture rather than floor — labels, handles, dimension
lines, the corner marker — is sized through `px()`, which converts screen
pixels into room units at the current zoom. That is what keeps it legible when
you are 20x in. Planks are *not* sized that way; they are real.

`fitToRoom()` deliberately leaves an asymmetric margin: the dimension lines
hang off the left and top, so those two sides get `FIT_GUTTER` and the other
two get `FIT_PAD`, and the camera is nudged by half the difference. A symmetric
margin either crops the figures or wastes half the stage.

The view is **not** part of a saved plan. It is where the user happens to be
looking, not something about the floor — so it lives on `view`, outside
`defaultPlan()`, in the same way as `focusRect`.

## Editing on the plan

Areas are dragged, resized and drawn directly on the drawing. Two things about
how that is wired are load-bearing:

**Hit testing is done in JS, not by SVG event targets.** The edit overlay is
drawn on top of the planks, so if it took pointer events it would swallow every
plank tooltip. Instead `g.edit`, `line` and `text` are all `pointer-events:none`
and `hitTest()` walks `state.rects` in room coordinates. The selected area is
tested first, so its handles and chips stay reachable where areas overlap. If
you add anything to the overlay, add it to `hitTest` too — drawing it is only
half the job.

**Redrawing is throttled to a frame, and panning does not recompute.**
`scheduleDraw` takes a flag saying whether the *room* changed; panning and
zooming reuse `lastLayout` and only redraw. During a drag the results and the
cut list are left alone entirely — they are the expensive half — and catch up
on drop.

Snapping lives in the engine block because it is geometry, and therefore
testable: `snapCandidates` / `snapOne` / `snapMoved` / `normRect`. The tolerance
is passed in as room units worked out from a fixed number of screen pixels, so a
snap feels the same under the finger at any zoom. A neighbouring edge always
beats the grid; a drag that catches nothing rounds to `GRID` (10 mm).
`snapMoved` offers both edges of the dragged rectangle on each axis and takes
the nearer — and never changes its size, which has a test on it.

`MIN_SIDE` stops a resize being dragged inside out: only the edges the grabbed
handle owns move, and each stops a minimum side short of its opposite.

## Layout and touch

Above 760 px the page stops being a page and becomes a two-pane app: the body
does not scroll, the panel and the drawing each scroll on their own, and the
plan takes the height of the screen. The breakpoint sits *below* an iPad in
portrait on purpose, so a tablet gets both panes whichever way it is held.
Under it, one column with the drawing first.

The stage is `touch-action:none` — the pointer handlers own every gesture on
it, two-finger pinch included. That is only safe because the two-pane layout has
no page scroll to block. If the wide layout is ever allowed to scroll again,
that becomes a trap on a touch screen.

`COARSE` (a `pointer:coarse` media query, read once) drives the script side of
the same idea: handles, hit radius, chips and label sizes all grow for a finger.
The CSS half is the `@media (pointer:coarse)` block. Change one, change both.

Header and panel widths matter more than they look, now that the shell is a
fixed height: anything that wraps the header steals that height from the
drawing. `input[type=text]` is declared after `.plan-name`, so the name field
needs `.topbar input.plan-name` to keep its width — without it the header wrapped
onto three rows and cost the plan 96 px.

## Hard constraints

**Keep it one file.** `index.html` is self-contained by design so it can be
opened straight off a phone, emailed, or dropped on a static host. There is no
bundler, no transpiler, no `node_modules`. Do not split it into modules, add a
framework, or introduce a build step without being asked.

The app builds do not change this. `app/` reads `index.html` and writes a
copy; it never edits the original, and the web version has gained no
dependency from the port existing.

**No dependencies.** The only network request is the Google Fonts stylesheet,
and the page degrades to system fonts without it.

**Do not move the `ENGINE:START` / `ENGINE:END` markers** in the `<script>`
block. `tests/engine.test.mjs` slices the text between them out of the HTML and
evaluates it in Node, which is what makes the maths testable without a build
step. Everything inside that block must stay free of DOM access — no
`document`, no `window`. If you genuinely need to move the markers, update the
slice logic in the test at the same time.

**No `localStorage` or `sessionStorage`.** All state lives in the in-memory
`state` object, and persistence is done with files instead — see below. This
keeps the file portable and lets it run inside sandboxed iframes.

## How the engine works

Everything hinges on one idea: rather than write eight variants for the
direction × starting-corner combinations, the room is transformed into **plank
space** — a coordinate system where planks always run left to right and laying
always begins at the top-left corner.

```
real space  --toPlank-->  plank space  --lay the planks-->  pieces
                                                              |
drawing     <--toReal----------------------------------------+
```

`makeTransform()` composes at most two operations, each of which is its own
inverse:

1. **swap** the axes, when `dir === "v"` (planks running top to bottom)
2. **mirror** in X and/or Y, so the chosen starting corner lands on the origin

`toPlank` is `mirror(swap(r))`; `toReal` is `swap(mirror(r))`. The
`toReal(toPlank(r)) === r` round trip is asserted in the tests for all eight
combinations — if you touch this function, that test is your safety net.

`computeStraight()` then runs these stages:

1. **Rows.** Sweep bands of `plankW` down the bounding box, starting at the
   set-out point. Row indices run *negative* into the strip between that point
   and the wall, so `k` is the position in the pattern and `k - kLo` is the
   display number counting from the wall. Keep those two separate: the stagger
   must key off `k`, or the pattern shifts when the set-out moves.
2. **Coverage.** For each band, take the union of the X-intervals of every
   rectangle that overlaps it. An L-shape's narrow section simply yields shorter
   rows. Disjoint intervals (a room in two parts) fall out for free.
3. **Rip detection.** Compare the band's true floor area against
   `coveredWidth × plankW`. A shortfall means the floor changes depth partway
   along the row, so planks there need a lengthwise cut. This affects labour,
   not plank count.
4. **The plank grid.** Each row uses an infinite repeating grid of `plankL`
   offset by `(rowIndex * stagger) % plankL`. Pieces are that grid clipped to
   the covered intervals. This is what makes staggering, and the short pieces it
   produces at row ends, emerge naturally.
5. **Material accounting.** Walk the pieces in laying order. A full-length piece
   always consumes a fresh plank. A short piece takes the *smallest saved offcut
   that fits*, and failing that a new plank, with the remainder returned to the
   pool if it clears `minOff`. Best-fit rather than first-fit, because it leaves
   longer offcuts available for the longer cuts still to come.

The offcut pool is the single biggest lever in the whole model: on the L-shape
preset, reuse on gives ~6% waste, reuse off gives ~26%.

## How herringbone works

Herringbone does not use plank space at all. The whole pattern is one lattice:

```
base = i*(L, L) + j*(-W, W)
  a plank of L x W sits at base
  a plank of W x L sits at base + (L, 0)
```

The determinant of those lattice vectors is exactly `2*L*W` — the area of the
two planks — so it tiles the plane with no gaps and no overlaps **at any
length-to-width ratio**. Worth knowing before you "fix" it: herringbone does not
require a 2:1 or 4:1 plank, that ratio is only how it looks.

The lattice is generated in its own space, then rotated about the anchor corner
by `hbAngle` (45, 135, 0 or 90 degrees). Because every plank shares one
rotation, the drawing hands that transform straight to SVG as a group transform
rather than rotating each plank itself. The clip path sits on an *untransformed*
parent group — putting it on the rotated group would drag the room outline round
with the pattern.

To decide whether a plank is a whole field plank or a border cut, its rotated
corners are clipped against the room with Sutherland–Hodgman (`clipToRect`) and
the resulting polygon areas summed. The room is decomposed into non-overlapping
rectangles first (`disjointRects`), because clipping against overlapping
rectangles would double-count the overlap.

Pieces under 0.05% of a plank are grazes at a wall rather than flooring, so they
are dropped — but their area accumulates into `sliverArea` so the tiling can
still be verified exactly. The test `the herringbone lattice tiles the floor
exactly` asserts `sum(piece areas) + sliverArea === floorArea` to 1e-9 for every
preset at every angle. **That test is the proof the lattice is correct.** If you
touch the lattice, the rotation or the clipper, it is what will catch you.

Border pieces are paired by *area* rather than length. In herringbone a plank
cut on a wall line yields two pieces that fit opposite walls, so the pairing is
physically real, but optimistic — the cuts are angled and not every pair marries
up. The UI therefore shows both the matched figure and the
fresh-plank-per-border figure and says the answer sits between them. Keep that
honesty if you rework the notes.

## Saving and loading

A plan is exactly the contents of `defaultPlan()` — the user's input, nothing
derived. Results are cheap to recompute and would only go stale in a file, so
they are never saved.

`state` is built as `{...defaultPlan(), focusRect: -1}`. That is the contract:
**anything in `defaultPlan()` is saved and loaded, anything added to `state` on
top of it is transient.** If you add a setting, add it to `defaultPlan()`, to
`sanitisePlan()`, and to `syncInputs()` or a picker — all three, or it will
silently fail to survive a save. This has already been got wrong once: the
set-out point worked perfectly in the UI while quietly not saving, because the
engine reads it as `st.originX || 0` and so never noticed it was missing. The
test `the set-out point saves and reloads` is what caught it, and there is a
test of that shape for every setting.

Saving builds `{format, version, saved, plan}` and downloads it as
`<slug>.plankplan.json`. Loading accepts a file from anywhere, so
**everything read out of one is treated as hostile.** `sanitisePlan()` checks
every field against the defaults rather than trusting it: numbers are clamped to
a range, enums are checked against an allow-list, strings are length-capped,
rectangles with negative or non-finite dimensions are dropped, and the area list
is capped at `MAX_AREAS`. It returns `{plan, warnings, ok}` and never throws —
a truncated or completely unrelated JSON file loads into something usable and
says what it could not read. Only `JSON.parse` failures are caught by the
caller.

One distinction that is easy to get wrong, and has a test on it: a plan with
**no `rects` field at all** is just a missing setting and falls back silently,
while a plan with a `rects` array that yields nothing usable warns that the room
was reset.

`defaultPlan()` returns a fresh object each call, including deep-copied
rectangles. It must stay that way or the presets get mutated through the
returned plan; there is a test for it.

Two escape hatches exist because sandboxed pages can have capabilities removed:
"New" arms and confirms on a second click rather than calling `confirm()`, and
the plan-text box in the rail carries the same JSON for environments where the
download is blocked. `writePlanText()` refuses to overwrite the box while it has
focus, so a paste in progress survives a redraw.

## The set-out point

`originX` / `originY` say where the corner of the first full plank sits,
measured **in from the chosen starting corner, in room coordinates** — the same
axes the user types rectangles in. Zero on both starts hard against the walls,
which is the old behaviour.

Room coordinates rather than plank coordinates is the deliberate choice: it
matches what the user already typed, and the conversion is one swap, because
plank space has already put the chosen corner at the origin and pointed the
planks along +x. So the offset only needs its axes exchanged when the planks run
the other way:

```js
const oAlong  = st.dir === "v" ? st.originY : st.originX;   // along the planks
const oAcross = st.dir === "v" ? st.originX : st.originY;   // across the rows
```

Herringbone applies the same offset directly to its anchor, negating it at a
right or bottom corner so "in from the corner" always means into the room.

`balanceRows()` solves `span = 2d + n*plankW` for the largest `n` leaving `d`
within one plank width, giving `d = (leftover + plankW)/2`. On the default room
that turns a 192/92 mm edge split into an even 142/142 for the same 86 planks. A
room that already divides exactly is left at zero — balancing it would
manufacture two half-width edge rows where none were needed.

## Choosing a stagger

`bestStagger()` sweeps the usable staggers and picks one. Three decisions in it
are worth knowing before changing anything:

**It ranks by the worst row end, not by how many are short.** Counting alone
will happily trade six 45 mm ends for three 5 mm ones, and a 5 mm end is not a
piece of flooring. Maximising the shortest end subsumes the count anyway: push
the worst past `MIN_END` and there is nothing left to count. Ties fall through
to fewest short ends, then fewest planks, then the stagger nearest the one
already set — that last one is what stops the answer jumping about between
equally good options, and it is why asking twice gives the same answer.

**The search is bounded by the join clearance, not by taste.** A stagger only
counts as usable if the joins in neighbouring rows still clear `MIN_JOIN`.
Curing short ends by lining every join up would defeat the point of a stagger,
so those candidates are never offered. On a plank too short for 300 mm either
side, a third of the plank is asked for instead — which is why a 300 mm plank
still gets an answer.

**`joinGap()` measures the gap, not the setting.** Joins repeat every plank
length, so 1185 mm on a 1285 mm plank leaves neighbouring rows 100 mm apart,
not 1185. The old warning compared the raw stagger against 300 and so said
nothing about that case.

The sweep costs one whole `computeStraight` per candidate, so the budget is in
pieces laid rather than candidates tried: a big floor gets a coarser step
instead of a long wait. A 12 x 9 m room lands in about 30 ms.

`endScore()` is shared by the search and the warning in the results panel, so
what the app warns about and what the button optimises cannot drift apart.

## Invariants worth preserving

The tests encode these; break one and something is wrong.

- Pieces within a row never overlap.
- Total piece area is at least the floor area, and not wildly more (the only
  overhang is the final row and edge bands).
- No piece is longer than `plankL`.
- A room that divides exactly into planks produces zero cuts and zero waste.
- All four starting corners give the same plank count on a plain rectangle.
- Enabling offcut reuse never increases the plank count.
- Planks cover the whole floor from any set-out point, and no piece exceeds a
  plank.
- The edge rows plus the whole rows always add back up to the room depth.
- Shifting along the row by exactly one plank length changes nothing, since the
  grid is periodic.
- `planksUsed === fullPieces + cutCount - offcutSaves`.
- Herringbone: no piece exceeds one plank, and the piece areas plus `sliverArea`
  sum exactly to the floor area, at all four angles and any plank ratio.
- Cost is charged on `packs * perPack`, and a larger allowance never costs less.
- `sanitisePlan(serialisePlan(p))` returns `p` unchanged, with no warnings.
- `sanitisePlan` never throws and always returns a plan `computeLayout` accepts,
  whatever it is handed.
- Snapping a moved rectangle never changes its width or height.
- A rectangle drawn from either corner comes out the same way round.
- The dragged rectangle is never offered as its own snap target.
- `bestStagger` never returns a stagger whose join gap is under the minimum.
- The worst row end never comes back worse than the one it went in with,
  provided what went in cleared the joins itself.
- Asked again from its own answer, `bestStagger` returns that same answer.
- `short === 0` exactly when `shortest >= MIN_END`; they are two views of one
  thing, not two measurements.

## Domain glossary

| Term | Meaning |
| --- | --- |
| Stagger | How far each row's pattern shifts along, so joins don't line up. 300 mm is the usual minimum. |
| Offcut | The tail left after cutting a plank to fit. Normally starts the next row. |
| Rip cut | A cut along the plank's length, narrowing it. Needed on the last row and where the floor changes depth. |
| Expansion gap | The 8–10 mm left at every wall so the floor can move. |
| End piece | The short piece finishing a row. Under `MIN_END` (300 mm) it works loose over time, so the app warns. |
| Join gap | How far apart the joins in neighbouring rows actually fall. Not the stagger: joins repeat every plank length, so it is `min(d, plankL - d)`. |
| Herringbone | Square-ended planks in interlocking perpendicular pairs, usually at 45° to the walls. |
| Field | The main body of the floor away from the borders. A field plank goes down uncut. |
| Drop | One length of carpet cut off the roll. Its width is the roll's; its length is the run it has to cover. |
| Seam | Where two drops are joined. Kept away from doorways and daylight. |
| Pile | The direction carpet fibres lie. It has to match across every drop, which is why a drop cannot be turned round. |
| Tread / riser | The flat of a step and its vertical face. Both need covering. |
| Nosing | The trim finishing the front edge of a step, and where two materials meet. |
| Winder | A turning tread that takes a corner instead of a landing. Counted as a square of the stair width. |
| Going | The horizontal depth of a tread. |

## Deliberate simplifications

Don't "fix" these without asking — they are choices, not oversights.

- **The expansion gap is not deducted.** Counting full room dimensions is
  slightly conservative, which is the safe direction to be wrong in for someone
  buying material.
- **Saw kerf is ignored.** It is under 3 mm and is swallowed by the extra
  allowance.
- **One angled corner per area.** Enough for a chamfer, a bay or a triangular
  room; two corners off one room is two areas. It is what keeps the removed
  region a single triangle and the floor decomposition exact.
- **No curves.** A bay is approximated by angled corners, not by an arc.
- **A single stagger value.** Real installers sometimes randomise the offset;
  a fixed stagger is what manufacturers specify.
- **The stagger search only moves the stagger.** The set-out point along the
  row is the other lever on where the row ends fall, and searching both
  together would be a two-dimensional sweep for a marginal gain. Where the room
  width is what is putting the short pieces there, the notes say so rather than
  pretending the stagger can fix it.
- **Herringbone offcut pairing is area-based**, not real 2D nesting. Solving it
  properly is bin-packing with rotation; the two-figure range is the honest
  presentation of an estimate.
- **No chevron.** Chevron needs planks mitred at the ends — a different product
  and a different cut list. Herringbone uses square-ended planks.
- **Pricing assumes whole packs.** `planksBought = packs * perPack`, so per-plank
  and per-m² prices are charged on what you take home, not what you lay. Set
  planks per pack to 1 for loose planks.
- **The cut list caps at 200 rows** to keep the table readable.
- **Carpet seams are counted as drops − 1.** Every drop after the first has to
  be joined to what is already down. Where the seams actually fall is a fitter's
  decision about traffic and daylight, not a thing to compute.
- **A drop is never turned round.** The pile has to run the same way
  throughout, so an offcut cannot be rotated to save material the way a plank
  offcut can. That is why carpet has no equivalent of the offcut pool.
- **Stair offcuts are kept apart from the floor's.** A flight is a different
  day's work and the short lengths off it rarely find their way back into a
  room.
- **A nosing is a length, not a profile.** The app works out how many metres
  of it you need and what it transitions between; which profile suits both
  depths is a question for the merchant.
- **Dragging snaps to edges and a 10 mm grid, not to a constraint solver.**
  There is no "keep these two areas touching" relationship — move one and the
  other stays where it was put.
- **Undo covers the drawing, not the settings.** The room, the levels, the
  flight and the nosings are on the stack; plank length, stagger and price are
  not.
- `computeLayout` returns `{ overflow: true }` above ~40,000 pieces. That guard
  exists because typing `5000` into a millimetre field while thinking in metres
  would otherwise lock the page up. Keep it.

## The app builds

`app/` wraps the same `index.html` in a WebView for the two stores. Read
`app/README.md` before working in there; the parts worth knowing from out here:

- **`index.html` is never edited for the app's benefit.**
  `app/scripts/build-www.mjs` makes four additive changes on the way into
  `app/www/`: `viewport-fit=cover`, swapping the Google Fonts link for
  vendored faces, a stylesheet for the safe areas and the ad banner, and the
  `native.js` shell. Every one of those **throws if its anchor has moved**, so
  changing the header markup or the viewport meta will break that build
  loudly rather than shipping something wrong.
- **`native.js` stands down when it is not in an app**, so the built page is
  still the same page in a browser. There is no bundler in the app build
  either: Capacitor registers its plugins on `window.Capacitor.Plugins` at
  runtime, which is what lets a plain script call them.
- **The ad banner is a native view under the page, not part of it.** It
  reports its height, `native.js` writes that to `--ad-inset`, and the shell
  and the plan stage both subtract it. If you change how `.plan-stage` is
  sized, change the matching rule in the build script — the stage height is
  spelled out in two places on purpose, because the app one has to subtract
  the banner.
- **`npm run check` is the gate before a release.** It catches an ad unit left
  on Google's test ID with `testing:false`, a font that did not get bundled,
  and an engine that did not survive the copy.

## Style

- Vanilla JS, `"use strict"`, no semicolonless style. Two-space indent.
- Comments explain *why*, not what. The geometry is the part that needs
  explaining; the DOM wiring does not. The gestures are the exception — what a
  pointer event is supposed to mean is not obvious from the code.
- All colours come from CSS custom properties in `:root`. Never hard-code a hex
  value in a rule or in the SVG drawing code — add a token instead.
- The palette references a cutting mat with oak planks laid on it: dark green
  ground, warm timber, amber for anything interactive, sage for pieces that came
  from a saved offcut.
- Two typefaces: Bricolage Grotesque for headings, IBM Plex Sans for UI. IBM
  Plex Mono appears only where millimetre figures need to align in a column.
- User-facing copy is plain and instructional. Warnings say what to do about the
  problem, not just that it exists.

## Commands

```bash
npm test              # node --test — no install needed
python3 -m http.server 8080   # or just open index.html directly
```

There is no lint or build step. `node --check` on the extracted script is a
quick syntax sanity check if you want one.

## Ideas not yet built

- Underlay and trim quantities (perimeter length is already derivable).
- Vinyl and tile, which would each be another material with its own sweep.
- Pattern repeat on carpet, which forces drops to line up and changes the maths.
- Stairs drawn on the plan, so a winder or a half-landing could be described.
- A print stylesheet, so the cut list can go in a pocket.
- Rotating an area, which the whole engine currently assumes cannot happen.
- More than one cut per area, which needs the removed region to stop being a
  single triangle and the cell decomposition to follow it.
- Deduct the expansion gap properly, which needs a real polygon inset rather
  than a per-rectangle one.
- Plans in the URL hash, so one can be shared by link rather than by file.
- Optional `localStorage` autosave for the hosted build, feature-detected so the
  sandboxed preview still works.
- Chevron, which needs mitred ends and a different cut list.
- Double herringbone, where pairs of planks act as one unit.
- A real 2D nesting solver for herringbone borders, replacing the area estimate.
- Labour cost alongside material cost.
