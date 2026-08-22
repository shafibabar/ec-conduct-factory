# Task: rebuild the carrier depiction — belt-aligned motion, per-station transformation, and a pulsating ground halo

## Read this first

This is a **replacement**, not an addition. The carrier depiction that exists
in `src/js/render.js` and `src/js/sim.js` today is to be **removed and rewritten**
against the specification below. Do not preserve the current heading maths, the
current halo, or the `packageState` / `packageT` scaffolding. Where this document
conflicts with what is already in the repo, this document wins.

Before writing any code, read:

- `CLAUDE.md` — the house style for this repo. Follow it. In particular: no build
  step, no dependencies, IIFE modules on `window`, comments that explain *why*.
- `FLOOR-TOPOLOGY.md` — the depth-sorting rules. The carrier is the one object on
  the floor that everything else must not paint over, so anything you add near it
  (the halo especially) has to obey the same draw-order discipline.
- `README.md` — the domain. You cannot write the transformation spec in Part 3
  without knowing what each of the eight machines actually does to a communication.

The reference implementation for all three parts of this task is the sibling repo
at **`/home/shafi/rocket-engine`** (`js/render.js`, `js/sim.js`, `js/iso.js`). Read
it. It solves all three problems correctly and simply. The instructions below quote
it directly so you do not have to guess at the intent, but read the original anyway
— the surrounding code explains the reasoning.

---

## Part 1 — the carrier must be square to the belt

### What is wrong now

`drawCarrier()` in `src/js/render.js` (currently around line 3262) builds its local
frame like this:

```js
var TW = 30, TH = 15;  /* match iso.js constants */
var dx_iso = (vanPos.dx - vanPos.dy) * TW;
var dy_iso = (vanPos.dx + vanPos.dy) * TH;
var m = Math.hypot(dx_iso, dy_iso) || 1;
var f = { x: vanPos.x, y: vanPos.y,
          hx: dx_iso / m, hy: dy_iso / m };
```

This is a **double projection and it is a bug**. `Iso.orientedBox()`
(`src/js/iso.js:254`) builds its four footprint corners in **world grid space**
from `hx/hy` and only then hands them to `prism()`, which projects. Feeding it a
screen-space heading rotates the box in the world before the world is projected,
so the skid is not square to the belt at all.

Work the numbers to see the size of it. On the top run the belt goes along `+x`,
so `vanPos.dx = 1, vanPos.dy = 0`. Then `dx_iso = 30`, `dy_iso = 15`,
`m = 33.54`, giving `hx = 0.894, hy = 0.447` — a **world** heading 26.6° off the
belt. Every part on the carrier is skewed by that angle, on every straight, and
the error changes as the route turns. The two long edges of the skid are parallel
to nothing.

Also note the hardcoded `TW = 30, TH = 15` with a comment saying "match iso.js
constants". Duplicated constants that must be kept in sync by hand are exactly the
kind of thing `CLAUDE.md` tells you not to do. After this fix they are not needed
here at all.

### What to do

Use the **raw world-space heading**, exactly as rocket-engine does
(`js/render.js:1331`):

```js
var f = { x: vanPos.x, y: vanPos.y, hx: vanPos.dx || 1, hy: vanPos.dy || 0 };
```

That is the whole fix. `Iso.smoothAt()` (`src/js/iso.js:429`) already returns a
normalised world-space `dx/dy`, already averages a sample either side so the
heading swings through a corner instead of snapping, and already falls back to the
segment direction when both samples collapse. Nothing else is required.

Delete the `TW`/`TH` locals and the `dx_iso`/`dy_iso` computation.

### The invariant this establishes

Every part of the carrier is placed through the existing `carrierPart(f, u, v, …)`
helper, where **`u` runs along the direction of travel and `v` across it**, and is
drawn by `Iso.orientedBox` with `len` along the heading and `wid` across it. Once
`f.hx/f.hy` is the world heading, this gives the property the rework is for:

> The carrier's two long edges are parallel to the belt's direction of travel —
> not merely its motion along the belt, but the physical edges of the object.

Keep every part on the carrier inside that frame. Do not place anything with bare
world `x/y` and do not call `Iso.box()` (axis-aligned) for anything that rides the
carrier — `Iso.box` ignores heading and will sit square to the world while the
skid turns under it. The terminal-chute code near the end of `drawCarrier()`
currently makes exactly this mistake, drawing the sliding package with `Iso.box`;
convert it to `carrierPart` / `Iso.orientedBox` as part of this work.

**Acceptance:** on the `[6,8]→[60,8]` run and again on the `[54,28]→[28,28]` run,
the skid's long edges are visually parallel to the belt rails. Through the two
corners at `[60,8]` and `[60,28]` the carrier rotates smoothly and is briefly
parallel to neither leg — that is correct and intended, it is the `smoothAt` look.

---

## Part 2 — the pulsating halo that follows the carrier

### What is wrong now

The block currently commented `/* ---- PULSATING HALO RING around the carrier ----`
draws three concentric `ctx.arc()` calls whose radii breathe on `Math.sin(clk * 3.2)`.
Two things are wrong with it:

1. **`ctx.arc` draws a circle in screen space.** On an isometric ground plane a
   ring must be an **ellipse** with the tile aspect baked in, or it reads as a
   flat sticker floating in front of the scene rather than a mark on the floor.
2. **Breathing is not the effect asked for.** Three rings sliding in and out
   together is a throb. The effect wanted is a single ring that **expands outward
   and fades as it grows**, then restarts — a radar ping.

Delete all of it.

### What to build instead

Port the pulse from rocket-engine's `drawZones()` (`js/render.js:205-214`), which
is the exact animation being asked for. There it marks the **active station**;
here it must **follow the carrier**. That relocation is the only change to its
character — the timing, the growth, and the fade curve are to be reproduced
exactly:

```js
var pulse = (t * 0.6) % 1;
ctx.strokeStyle = Iso.rgba(color, 0.45 * (1 - pulse));
ctx.lineWidth = 3;
ctx.beginPath();
ctx.ellipse(p.x, p.y,
            r * Iso.TW * 1.414 * (1 + pulse * 0.35),
            r * Iso.TH * 1.414 * (1 + pulse * 0.35),
            0, 0, 6.2832);
ctx.stroke();
```

Reproduce it with these specifics:

- **Phase:** `var pulse = (clk * 0.6) % 1;` — a sawtooth, 0→1 over 1.667 s, using
  this repo's existing `clk`. Not a sine.
- **Radius:** a base radius scaled by `(1 + pulse * 0.35)`, so the ring grows 35%
  across the cycle and then snaps back. Base radius around **1.3 grid units** —
  it should clear the skid's 2.10 × 1.46 footprint without swallowing it.
- **Alpha:** `0.45 * (1 - pulse)` — brightest the instant it is born, invisible at
  full extent. The snap-back is therefore never seen, which is why a sawtooth
  works here.
- **Ellipse, not arc:** semi-axes `r * Iso.TW * 1.414` and `r * Iso.TH * 1.414`.
  Use `Iso.TW`/`Iso.TH`, not local copies.
- **Line width:** 3.
- **Position:** `Iso.project(vanPos.x, vanPos.y, BZ + 0.02)` — pinned to the belt
  deck height `BZ` that `drawCarrier` already computes from `Factory.BELT_H`, so
  it lies on the deck the carrier rides rather than hovering over it.
- **Colour:** tint it with the **current station's colour** from
  `World.STATIONS_FLAT` (`C.gateway`, `C.quota`, …) while the carrier is stopped
  or approaching, so the ping reads as "this machine has it now". Fall back to a
  neutral belt amber in transit. Use `Iso.rgba(color, alpha)` — the helper exists.
- **A static seat under the pulse:** as in rocket-engine, draw a faint filled
  `Iso.disc()` plus a thin steady ellipse outline under the animated ring, so the
  carrier is still marked at the moment the pulse is at its faintest. Alpha around
  0.05–0.16 for the fill, 0.28–0.85 for the steady outline.

**Draw order matters.** The halo is a ground decal: it must be drawn **before** the
carrier body in the same depth-sorted entry, so the skid sits on top of it. Do not
add it as its own sortable item — it would sort against the machines and flicker
in and out from behind them. Emit it at the top of `drawCarrier()`, before the
skid, and read `FLOOR-TOPOLOGY.md` before you place it.

**Acceptance:** the ring lies flat on the deck, tracks the carrier exactly through
straights and both corners, and reads as a ping expanding and dissolving rather
than a ring pumping in and out.

---

## Part 3 — per-station transformation of the thing on the belt

This is the substantial half of the task.

### What is wrong now

`drawCarrier()` and `charge()` are full of TODO prose describing a transformation
system that was never built: a `packageState` string machine
(`RAW → INGESTED → QUALIFIED → EVALUATED → SURVEILLED → SAMPLED → ALERTED →
ECHO_EVALUATED → INDEXED → TERMINATED`), a `packageT` 0→1 dwell lerp, `lerp()` and
`lerpColor()` helpers, and long comment blocks in `src/js/sim.js` (around lines
85-90, 168-175, 231-243, 339-341, 405-411, 565-583) instructing a future
implementer to interpolate geometry during the dwell.

**Rip all of it out.** `packageState`, `packageT`, the string enum, the dwell lerp,
the helpers, and every TODO comment describing them. They are the wrong model, for
two reasons:

1. A string enum cannot express what actually happens. The route **forks** — four
   terminal gates, and the short route skips alerting, echo and the indexer
   entirely. A linear string of stage names has no way to say "the alert crates
   never appeared, and you can see that they didn't".
2. Interpolating geometry over the dwell is animation for its own sake. The
   reference does not do it, deliberately.

### The model to build instead

Copy rocket-engine's, which is three small pieces:

**(a) An integer level, snapped on arrival.** `js/sim.js:22-27` declares a `LEVEL`
map — one integer per station, in build order. `work(id)` (`js/sim.js:206`) sets
`state.level = LEVEL[id]` the moment the carrier reaches the stop, *before* the
dwell begins (`js/sim.js:429-437`). The dwell that follows is reading time; the
geometry is already at its new state and does not animate through it.

Do the same here. Add an integer level to `Sim.state`, set it in `charge()` /
`fire()` at the instant of arrival. The change is a discrete pop, per station.
Across the whole line it reads as a gradual transformation; at any one stop it is
instantaneous. **This is intended — do not add easing.**

**(b) Cumulative drawing.** `drawEngine()` (`js/render.js:1152`) is a flat list of
`if (L >= LEVEL.x)` blocks. Every stage that has been passed keeps drawing, so the
object accretes and no station's work is ever thrown away by the next.

Restructure `drawCarrier()` the same way: a sequence of guarded blocks, each one
owning exactly what its station did.

**(c) Guard on what actually fired, not on the level alone.** This repo needs one
thing rocket-engine does not, because rocket-engine's route never forks. Keep the
existing `state.charged` map (stationId → workMs) and gate every fork-dependent
part on `charged[id]`, not on a level comparison. That is what makes the short
route legible: on a not-sampled run the alerting crates and the index chip are
absent, and their absence is the information.

### What each station does to the object

Do not invent this. Derive it from what the repo says the machine does — `README.md`,
`knowledge/system-explainer-input.md`, and the per-machine comments in `render.js`.
The governing idea is already written at `src/js/render.js:3235`, and it is right:

> The analogue here runs the other way: a communication does not grow, it **SHEDS**.
> `ec-gateway` strips the message body, so the payload block loses most of its mass
> at station one, and everything after that is verdicts, stamps and receipts
> attaching to a much smaller object.

Build to that. For each of the eight belt stations, decide and implement which of
these it is — and the mix is the point, they are not all the same kind:

- **Subtraction** — the object physically loses volume. `ec-gateway` is the big one:
  the payload block shrinks hard when the body is stripped. Rocket-engine's analogue
  is the machining station, whose `STATION_ADDS` entry is *negative* on purpose
  (`js/spec.js`: `machine: { mat: { ni: -9, cu: -4 } }`) because a finished part is
  a fraction of the blank.
- **Addition** — new geometry appears and stays: pipeline tags at `ec-qualifier`,
  the alert crates at `ec-alerting-service`, the index chip at the indexer.
- **Shape change** — the same matter, re-formed. The split at `ec-evaluator` into
  metadata answered locally and content sent out to the analytics platform is a
  shape change, not an addition.
- **State change** — no geometry moves; colour, finish or a small marker changes.
  Policy application at `ec-filter` and the sampling verdict at
  `ec-surveillance-quota-manager` are state changes on an unchanged silhouette.

**Do not force all eight into shape changes.** Roughly two-thirds shape changes and
one-third pure state changes is the honest ratio, and it matches the reference:
rocket-engine's `braze` station has `{ parts: 0, mat: {} }` and changes only the
liner colour; `hotfire` flips a `sooty` flag and adds nothing; `ndt` adds one small
seal and a serial label. A station that genuinely does not reshape the object should
not pretend to.

Every part you draw must be placed through `carrierPart(f, u, v, …)` in the
heading-aligned frame from Part 1.

### The terminal forks

When a terminal gate is taken the carrier **stops where it was stopped** — it does
not travel on. That behaviour already exists in `sim.js` and is correct; keep it.
Replace the `pState === 'TERMINATED'` chute block with something keyed off the
existing `s.terminalFork` and the station it happened at, and draw it in the
oriented frame (it currently uses `Iso.box`, see Part 1). The stopped carrier
should read as *stopped and closed out*, not as mid-journey.

---

## Constraints

- No build step, no new dependencies, no framework. The page still opens with
  `src/index.html` straight from disk.
- Follow `CLAUDE.md` for module structure and comment style. Comments explain the
  reasoning, not the syntax.
- Follow `FLOOR-TOPOLOGY.md` for anything you add to the depth-sorted pass.
- Do not duplicate `Iso` constants into `render.js`. Use `Iso.TW`, `Iso.TH`,
  `Iso.rgba`, `Iso.disc`, `Iso.orientedBox`, `Iso.smoothAt`.
- Leave the physics, the KEDA/replica model, the sliders and the panel alone. This
  task is the carrier, its halo, and its transformation — nothing else.
- Remove the dead scaffolding you replace. Do not leave `packageState`, `packageT`,
  the unused lerp helpers, or their TODO comment blocks behind.

## Acceptance checklist

1. The skid's long edges are parallel to the belt on both straight runs, and rotate
   smoothly through both corners.
2. Nothing on the carrier is drawn axis-aligned to the world; every part turns with
   the skid.
3. A single ground-plane ellipse ping expands 35% and fades to nothing over 1.667 s,
   pinned to the carrier at deck height, tinted by the station holding it.
4. The object changes at the instant of arrival at each stop, not during the dwell.
5. The object accretes: no station's visible work is erased by a later one.
6. `ec-gateway` visibly and substantially reduces the payload's volume.
7. At least two stations change state without changing silhouette.
8. On a not-sampled run, the alerting and indexer parts are visibly absent.
9. A terminal fork leaves the carrier stopped at the machine that stopped it,
   drawn in the oriented frame.
