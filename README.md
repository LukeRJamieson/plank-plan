# Plank Plan

A laminate flooring calculator that works out how many planks a room needs by
simulating the actual layout, piece by piece, rather than dividing floor area by
plank area.

Rooms are built from rectangles, so L-shapes, T-shapes and alcoves all work.
Draw them straight onto the plan and drag them about — they snap to each other's
edges — or type the figures if you have them. You choose which way the planks
run, which corner starts with an uncut plank, and how far each row staggers, and
it draws the result, flags the cuts that will cause trouble, and gives you a cut
list.

## Running it

Open `index.html` in a browser. That's it — one file, no dependencies, no build
step.

To serve it locally instead:

```bash
npm run serve      # http://localhost:8080
```

## Tests

```bash
npm test
```

The tests slice the layout engine out of `index.html` and run it in Node. They
cover the coordinate transform, the piece-packing invariants, the snapping maths
behind dragging areas about, the pricing, the guards against nonsense input, the
handling of damaged or foreign save files, and a proof that the herringbone
lattice tiles the floor exactly at every angle. No install step; Node 18 or
newer.

## Drawing the room

The plan is a proper drawing surface, not a picture of the answer.

| | Mouse | Touch |
| --- | --- | --- |
| Zoom | Scroll, the **+** / **−** buttons, or the `+` and `−` keys | Pinch |
| Fit the room | **Fit**, or the `0` key | **Fit** |
| Pan | Drag the background, or hold the middle button | Drag the background, or two fingers |
| Select | Click an area, or its letter in the panel | Tap it |
| Move | Drag it — edges snap to the other areas | Drag it |
| Resize | Drag any of the eight handles | Same, drawn larger for a finger |
| Set a size exactly | Click the figure on the selected area and type it | Tap it |
| Draw a new area | **Draw** or `D`, then drag one out | **Draw**, then drag |
| Nudge | Arrow keys, 10 mm, or 100 mm with shift | — |
| Delete | **Delete**, or the `Delete` key | **Delete** |

Snapping works to a fixed distance on screen, so it feels the same however far
in you are zoomed, and a drag that catches nothing rounds to 10 mm. A second
finger landing mid-drag puts the area back and turns the gesture into a pinch,
so a stray thumb cannot move a wall.

On anything wider than a tablet in portrait the page becomes two panes that
scroll separately — settings on the left, the drawing filling the right — so
nothing has to be scrolled to while you work.

## What it accounts for

- Rooms made of any number of rectangles, overlapping or not
- **Straight rows** or **herringbone**, the latter at 45°, 135°, 0° or 90°
- Plank direction and starting corner (all eight combinations)
- A set-out point, so the pattern can start anywhere rather than hard against a
  wall, with one click to balance the two edge rows to the same width
- Row stagger, and the short end pieces a bad stagger produces — with one
  click to search for the stagger whose shortest row end is longest, keeping
  the joins in neighbouring rows a safe distance apart while it does it
- Offcut reuse — starting each row with the tail of the last one, which on a
  typical L-shaped room is the difference between 7% and 26% waste
- Rip cuts along the final row and wherever the floor changes depth
- Packs to buy, with a configurable allowance for damage and mistakes
- Cost, priced per pack, per plank or per square metre, charged on whole packs

Plans save to a `.json` file you can keep with the job, email on, or reload
later. There is no browser storage, so a saved plan is portable and nothing is
left behind on the machine you used. If downloads are blocked where you are
running it, the same plan is available as text at the bottom of the panel.

Lengths are finished sizes on the floor. The 8–10 mm expansion gap is absorbed
by the extra allowance rather than deducted, which errs slightly on the side of
buying enough.

## The phone and tablet apps

`app/` builds the same page for Android and iOS through Capacitor. It is a
shell, not a second copy: `index.html` stays the source of truth and is never
edited for the app's benefit, so a fix to the layout engine ships to the web
and both stores at once.

```bash
cd app
npm install
npm run www        # build the app bundle from ../index.html
npm run check      # verify it before a release
npm run android    # open it in Android Studio
npm run ios        # open it in Xcode (macOS only)
```

The app build is fully offline — the typefaces are vendored, so it makes no
network request at all — and carries an AdMob banner with the GDPR and
App Tracking Transparency prompts wired up. It ships on Google's test ad IDs;
`app/README.md` covers swapping them for real ones.

## Publishing to GitHub Pages

The repo is a static site with `index.html` at the root, so Pages needs no
configuration beyond being switched on.

```bash
git init
git add .
git commit -m "Plank Plan"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/plank-plan.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment**. Set the source to
**Deploy from a branch**, pick `main` and the `/ (root)` folder, and save.

The site appears at `https://YOUR-USERNAME.github.io/plank-plan/` after a minute
or two. Every push to `main` redeploys it.

## Licence

MIT.
