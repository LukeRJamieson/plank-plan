# Plank Plan

A laminate flooring calculator that works out how many planks a room needs by
simulating the actual layout, piece by piece, rather than dividing floor area by
plank area.

Rooms are built from rectangles, so L-shapes, T-shapes and alcoves all work. You
choose which way the planks run, which corner starts with an uncut plank, and
how far each row staggers — and it draws the result, flags the cuts that will
cause trouble, and gives you a cut list.

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
cover the coordinate transform, the piece-packing invariants, the pricing, the
guards against nonsense input, the handling of damaged or foreign save files,
and a proof that the herringbone lattice tiles the floor exactly at every angle. No install step; Node 18 or newer.

## What it accounts for

- Rooms made of any number of rectangles, overlapping or not
- **Straight rows** or **herringbone**, the latter at 45°, 135°, 0° or 90°
- Plank direction and starting corner (all eight combinations)
- A set-out point, so the pattern can start anywhere rather than hard against a
  wall, with one click to balance the two edge rows to the same width
- Row stagger, and the short end pieces a bad stagger produces
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
