# EC Factory Explainer

A single isometric explorable explainer for the Smarsh Enterprise Conduct
microservices platform, built with the `isometric-explainer` skill.

The build is **done and lives in `src/`**. Edit it in place — do not re-copy the
skill template over it. `README.md` at the repo root is the reader-facing
document; keep it in step with the code.

## Standing instructions

These hold for every session on this repo unless the user says otherwise.

**Refactor freely for modularity and reuse.** If a new `.js` or `.css` file, a
new function, or a new shared helper would make the code more modular or more
reusable, create it — do not ask first, and do not wait for a second caller to
justify it. `js/kit.js` was split out of `render.js` on exactly this basis. The
need does not have to be obvious yet: if it looks like the right shape, take it.
When you do split something out, say so in the Layout section below and in
Progress.

**No before/after screenshots for refactors** unless the user asks for them.
Verify with `node --check`, the smoke test and your own look at a screenshot;
report in prose. (This replaces the earlier per-phase screenshot checkpoint.)

**Keep this file current.** New conventions, new modules and finished work all
land here — Layout, Building a machine, and Progress.

**`FLOOR-TOPOLOGY.md` is the standing design record for the floor's *shape*,**
as this file is for how a single machine is built. It holds the decisions taken
about the records precinct — the belt becoming a U, audit and reporting coming
off the line, the tower, the trench-and-tube relay, where window tokens belong —
plus the depth-sort and height numbers that constrain all of it, and a work-item
checklist.

**Read it before moving any station, and keep it current**: tick its work items
as they are finished and note what the doing of them taught. Amend a decision
rather than deleting it. That file is the reason a new session does not have to
re-derive any of this.

## Context

All architecture, simulation spec, narration, and fidelity ledger inputs are in:
  knowledge/system-explainer-input.md

Read the relevant sections before changing any code. It is the sole source of
truth for what each service does, what `model.js` computes, and what the
narration says. It is ~2300 lines: Sections 2a–2g cover the Kafka/REST channel
tables and the connectivity audit, then one `##` section per repository, then
Flows A–H (A/B are the main surveillance path the belt follows; C–H are the
side flows the off-belt structures illustrate).

## The subject, as staged

One communication rides a conveyor belt through the surveillance data path.
All 21 repositories appear: **8 as belt stations**, **2 off the belt** inside
the loop it makes, **11 as side structures**.

The belt is a **U** — a top run west to east, a turn south, a middle run back
east to west. Order: `gateway → qualifier → filter → evaluator → quota →
alerting → echo → indexer`. The quota manager is the one station on the turn.

`ec-centralised-audit` and `ec-reporting` are **not on the belt**: they consume
events *about* the communication, so the communication does not travel to them.
They stand inside the U, in `World.OFFBELT`, and the line runs around them.

**Four forks leave the line early**, in `src/js/sim.js`: no pipeline claims it
(qualifier), nothing qualifies (filter — which does send the record on to the
quota manager, for accounting only), every content verdict ages out
(evaluator), and not sampled (quota). Three of the four **end the journey where
they happen** — the saving is meant to be seen as a shorter journey, and a
record that stops earlier is exactly that. The receipt still reaches the record
keeper, by a route the carrier never takes.

## Layout

```
index.html          markup, About modal with the fidelity ledger. The dock is
                    an empty <footer id="dock"> — it builds itself.
css/styles.css      UI chrome (topbar, hud, zoomer, inspector, modal, tokens)
css/dock.css        the dock's own styles — see js/dock.js
js/dock.js          the dock as a reusable component: builds transport,
                    fields, sliders, selects, toggles and the mobile gear
                    drawer from a spec. Knows nothing about EC
js/iso.js           isometric projection + primitives — ENGINE, keep unchanged
js/model.js         the lesson: chunking, queue depth, KEDA scaling, latency
js/world.js         belt route, 10 stations, 11 side structures, props, districts
js/factory.js       floor palette + ground/hazard/slab drawing (project-specific)
js/kit.js           the machine kit: materials, cam timing, primitives,
                    instruments, sub-assemblies. The vocabulary every station
                    drawer is built from
js/sim.js           state machine walking one communication along the belt
js/render.js        painter's-algorithm renderer: the SCENE — what stands
                    where, depth order, and one drawer per station
js/ui.js            panels, narration, sliders, HUD
js/main.js          camera, input, frame loop — ENGINE, near-unchanged
```

Script load order in `index.html` matters: `iso → model → world → factory →
kit → dock → sim → render → ui → main`.

`render.js` aliases every kit helper into module scope by name and calls
`Kit.bind(ctx, clock)` once per frame, so a drawer calls `plate(...)` or
`readout(...)` directly and never passes a context around.

`World.BELT` is the belt polyline; every station in `World.STATIONS_FLAT`
anchors to it by `BELT.cum[i]` distance, so moving a waypoint shifts every
station after it. `World.stations` is an alias of the same array under the name
the skill's smoke test looks for — keep it.

All ten belt machines have their own drawer in `render.js`, dispatched through
`BESPOKE` (mirroring rocket-engine's `KIND` map) with `drawQuota` handling the
gate. `drawMachine` and `shell()` remain as the fallback and the shared
plinth/body for any station added later. Floor props come from
`World.buildProps()`, which keeps everything off the belt and out of every
footprint via `blocked()`; `PROP_KIND` in `render.js` maps each kind to a drawer,
and props join the same depth-sorted pass as the machinery.

## Building a machine

Nothing on this floor is a building. It began life as a city and was converted;
when a prompt says "building" it means **a machine on the factory floor**. No
pitched roofs, no roof slabs with overhangs, no lit domestic windows, no
house proportions. Machines get louvres, vents, sight glasses, inspection ports,
status lamps, gauges, hoppers, ducts and cable entries, and they read as chunky
industrial casings on a plinth with visible mechanism on top and on the
viewer-facing face. The reference for the target look is
`/home/shafi/rocket-engine` — read `casing()`, `busy()` and `drawCnc` in its
`js/render.js` before writing a drawer. Copy its construction discipline, not
its subject.

`ec-gateway` (`drawGateway`) is the worked example and the standard the other
nine are heading for. Read it before rebuilding any station.

### The machine kit

The `==== machine kit ====` section of `render.js` is the parts bin every drawer
builds from — `frustum`, `pipe`, `plate`, `quad`, `bolts`, `ribs`, `door`,
`louvres`, `hazardStrip`, `lamp`, `readout`, `stencil`, `matrix`, `lattice`,
`chips`, `replicaStack`, plus the `M` (materials) and `PAPER` palettes and the
`cyc`/`seg`/`segLin` cam helpers. Add to it rather than open-coding a shape a
second time; `js/iso.js` is engine and stays closed, so a genuinely new
primitive (`frustum` was one) goes in the kit.

Five rules, in the order they matter:

1. **Three material values, not one.** A near-black body has no faces. The
   livery body sits mid-tone (`LIVERY`, ~46% lightness) and the mechanism on it
   is brighter steel, so the eye separates casing from moving part.
2. **The plant is cold, the payload is warm.** Anything the reader should read
   as *the communication* — an arriving chunk, the billet, the wafer, a printed
   ledger row, the offcut in a scrap bin — is drawn from `PAPER`. Anything that
   is machinery is drawn from `M`. At the zoom a reader actually uses, warm on
   cold stays legible when detail does not.
3. **Every moving part is on a cam.** `cyc(id, rate)` gives the machine one
   repeating work cycle *while its station is live* and pins to 0 otherwise;
   `seg(p, a, b)` cuts that cycle into named strokes. Nothing animates off a
   free-running timer, and an idle machine shows nothing but a dim red standby
   lamp. `busy(id)` is the gate.
4. **Numbers come from the model.** A `readout` shows what `model.js` computed
   from the current slider values, not from the frozen per-trip state, so
   dragging a slider moves the machinery and not just the panel. `readout` sizes
   its own text to its plate — do not hand-tune a font size against the longest
   string a figure can reach.
5. **Plan the viewer-facing face around what hangs off it.** The camera sees the
   top, the east face and the south face; south is the *darkest* of the three,
   so anything meant to be read there is a self-lit plate, never paint. And
   south is **left** on screen: a chute or an apron overhanging the deck covers
   the casing face to its *west*, not below it. Work out the band it eats before
   placing an instrument.

### Connecting a machine to the line

Machines stand back from the belt, and the gap is not a mistake — it is where
the transfer happens and where the queue stands.

`transferBay()` is the standard connector. A service does not sit on a topic: it
consumes a message from one topic, works, and produces a *different* message to
a *different* topic, so a machine straddling the belt would be a lie. A bay is a
gravity roller table from the machine's face to just short of the belt, with one
inserter at the belt end — an intake bay's arm reaches south-**west** to the
upstream segment, an outfeed bay's south-**east** to the downstream one. Build
the spur as a roller table, never as a second conveyor: the belt is the only
conveyor on this floor and a second one at right angles reads as a junction.

Pass `queue` (consumer lag as a fraction of that service's own `lagThreshold`)
and `over`, and the table carries the queue as physical blocks that go red past
the threshold — the same fact the roof's replica rack is about to react to.

The aisle itself is named: `World.TOPIC_LANES` paints the real Kafka topic on
the floor beside each belt segment, verbatim from the channel table in Section
2b of the knowledge file. Add a lane whenever a segment's topic is not yet
painted.

A station's `w`/`d` in `World.STATIONS_FLAT` is the **reserved floor area** —
what `buildProps()` keeps clear — and need not match the casing. `drawGateway`
draws from explicit coordinates and calls `replicaStack(x, y, z, ph)` itself, so
its ancillaries (archive mast, ledger printer, watermark standpipe) get floor
space without dragging the KEDA stack off the roof. Take the same route when a
rebuilt machine outgrows its box, and set the label anchor explicitly in
`draw()`.

## Progress

**Done**

- Global depth and lighting pass over all 21 structures: face shading
  1.00/0.80/0.58 and a hard dark edge in `iso.js`, the `LIVERY` map lifting
  every body into the 38–56% lightness band, side structures re-cased with flat
  decks instead of gable roofs, and `busy()` gating so exactly one machine
  animates at a time.
- `js/kit.js` split out of `render.js`.
- **`ec-gateway` rebuilt as the intake press** — the worked example. Read it
  before rebuilding anything else.
- **`ec-queue-qualifier` rebuilt as the plate comparator**, with both transfer
  bays and the first `receiptDuct()`. Adds a **second belt branch**: Flow B1,
  the not-qualified exit, jumps the carrier from `qualifier` straight to
  `audit`. Reachable by dragging **People** to zero.
- **`ec-surveillance-filter` rebuilt as the screening line** — two screens in
  series, numbered, with one carrier per claiming pipeline. Adds a **third belt
  branch**: Flow B2, nothing qualified, jumps the carrier from `filter` to
  `quota` (counted at the gate, evaluation skipped). Reachable by dragging
  **Ignore%** to 100. All three documented suppression exits are now reachable.
- **`ec-surveillance-policy-evaluator` rebuilt as the router and timekeeper** —
  splitter, local metadata bench, CIMS mast, and a wait rack filling against a
  hard red `COMS_TIMEOUT_MS` line. Adds a **fourth fork**: Flow C, every content
  verdict aged out, jumps the carrier from `evaluator` to `audit` — those
  communications never reach sampling. Reachable with **Content% 100** and
  **Cognition** past the ceiling.
- **`ec-surveillance-quota-manager` rebuilt as the sorting gate**, and **moved
  north of the belt** with the rest of the upstream row — it used to stand at
  y 12, south of the line, where a solid can occlude the carrier, and it is the
  one station the carrier is diverted *at*. One atomic counter with a drive
  shaft from the replica rack, two latches in series, three outcomes with the
  scope check upstream of the register so an ignored record never spends quota,
  a four-tumbler bucket keyer, and the first **three-track CDC ledger** — this
  service publishes nothing directly.
- **`ec-indexer` rebuilt as the bulk press** — the gateway's chunking matrix
  again (same code, drawn twice on purpose), a collector hopper with a sight
  glass, parent-plus-audio-child, the bulk ram, a retry siding for per-record
  fate, and the empty-object REST bypass. Fixed a second inert mechanism:
  `batchPosition` was 26 on every trip so the flush never fired.
- **`ec-echo-engine` rebuilt as the card-index comparator** — batch of ten
  grouped into thread lanes, hit tags sorted then hashed beside a capped body
  port, a card file that is written **before** the comparison (which is the
  failure mode), and three verdict lamps. Intake bay only: it publishes nothing
  to the line. Fixed a determinism bug — `isEcho` was `Math.random()` recomputed
  every frame — and moved the fingerprint onto the policy hits where it belongs.
- **`ec-alerting-service` rebuilt as the assembly bench** — four parallel
  enrichment feeds coloured by source (three of them REST calls to other
  machines on this floor), an assembly bench, twin presses for the two writes
  that happen in parallel, a finished-item rack, the echo return running against
  the flow, and a two-track CDC ledger. It is the one machine with **no audit
  relay**, and the blanked duct pad says so. `model.js` now splits the
  enrichment cost so the readout can show that the station pays for the
  *slowest* of the four, not their sum — and which one that is flips with
  document size.
- **The relay network is laid.** `World.RELAY`: eleven trench segments carrying
  receipts from seven machines into the tower — a common trench with branches
  and two spines, crossing the belt below grade — and three overhead runs at
  z 4.5 carrying the tower's own traffic back out. Every glow is gated on the
  machine that sent it, staged branch → spine → riser. `ec-alerting-service`
  has no line, visibly, because it produces no audit event. Receipt ducts added
  to `echo` and `indexer`; `ec-gateway` needed none, its CDC pickup head *is*
  its relay. The middle row moved to **y 36** first, so the trenches were laid
  once.
- **Floor surgery done.** The belt is a **U** — `(6,8) → (60,8) → (60,28) →
  (28,28)`, length 106 down from 184 — and what it encloses is the records
  precinct. `ec-surveillance-quota-manager` moved to **the turn**, inside the U,
  unrotated with `axis:'x'` bays. `ec-centralised-audit` and `ec-reporting` came
  **off the belt** into the new `World.OFFBELT` category. The four forks now
  **end the run where they happen** instead of walking the carrier to a record
  keeper. The slab shrank to `GH 48` and the reporting-corner side structures
  moved up into the vacated third. Numbers and lessons in `FLOOR-TOPOLOGY.md` §4.
- **`ec-centralised-audit` rebuilt as the control tower** — the first
  structure on this floor that is not a machine. Nothing passes through it: the
  communication never arrives, only receipts *about* it, so it is built as legs,
  a receiving floor, a ledger hall and an instrument deck rather than a casing on
  a plinth. The three trench risers surface between the legs; beside them the
  header gate and the `ec-audit-ingestion-failed-events` bin, which is a **dead
  end on purpose** (missing headers are non-retryable, so there is no siding).
  The hall holds the ledger books, the version wheel for the optimistic-retry
  write, and a lamp per pipeline with COMPLETE falling only when the last one
  lights. On the deck, the two reconciliation columns — `completed` counted here
  against `ingested` fetched from the gateway's watermark, deliberately in two
  different colours because they are two independently produced numbers — with a
  yoke tying them together and one verdict lamp that goes amber, not red, on
  mismatch, captioned with what a mismatch does *not* tell you.
  It solved both open consequences of the floor surgery: the tour narrates audit
  again (`endTrip()` emits `station: 'audit'`), and the tower is no longer static
  — it has **two cams instead of `busy('audit')`**, which it can never have.
  `towerSrc()` borrows the cam of whichever machine is currently reporting, and
  the reconciliation cron runs off a new `Sim.state.reconT` countdown started at
  `endTrip()`. The three overhead tube runs were re-gated onto that cron as well:
  the watermark line fires when the tower asks for the count, the two
  `windowReconciliation` lines when the verdict is sealed. Dark the rest of the
  time, which is honest — this happens every fifteen minutes, not per receipt.
  New `sim.js` state: `auditEvents`, `auditIngested`, `auditCompleted`,
  `pipesTerminal`, `reconT`, plus `AUDIT_RECEIPTS` (a map of how many receipts
  each station files — `alerting` returns 0) and `terminalAfter()`. Folded away a
  duplicate counter: `auditEventsEmitted` was incremented in `charge()` when the
  carrier reached the audit *station*, which has not existed since the belt
  became a U, so the narration's `{auditEventsEmitted}` had been reading 0.
  `drawAudit` deleted.
- Kit grew `casing()`, `binRow()`, `reel()`, `receiptDuct()`, `floorText()`,
  `gaugeCol()` (moved out of `render.js` when a third machine wanted it),
  `atWorld()` for relocating an authored machine bodily, and the relay network —
  `trench()`, `tubeRun()`, `tubePost()`, `pulse()`, `hazardFloor()`, plus
  `transferBay({axis:'x'})` for a machine beside a vertical belt run.
- `drawTrenches()` pass added between the floor and the belt: a trench is a cut
  into the slab and must go down *before* the conveyor to pass under it.
- `FLOOR-TOPOLOGY.md` written, then rewritten as the standing design record for
  the floor's shape once the records-precinct plan was agreed.
- Transfer bays, inserters, topic lanes on the floor, and the lag queue.
- Model fixes: `s3Plan()`/`s3DownloadMs` (the chunk on the wire is
  `min(size, 5 MB)`, not always 5 MB); Doc and Ingest sliders made logarithmic
  so both mechanisms are reachable at all — below a few thousand records a
  second every service sits at its three-replica floor and KEDA is inert; **the
  Pipes selector never reached `compute()` at all**, which priced every fan-out
  (filter policies, alerts created, the audit bulk write) for two pipelines
  whatever the reader had selected.
- Fixes along the way: the narration panel pinned itself to the first station
  and never advanced; off-slab scenery could sort in front of the plant;
  `interpolate()` in `ui.js` ran string values through `fmtNum`, so the window
  token and the echo fingerprint rendered as `NaN` in the narration; clicking a
  structure only ever flew the camera *halfway* to it, because `takeFlyTo()`
  handed main.js the target for a single 0.5 lerp.

**Next, in order**

The records-precinct plan is agreed and written up in `FLOOR-TOPOLOGY.md` §2;
its §4 is the live checklist. In outline:

1. ~~Kit first~~ — done: `trench()`, `tubeRun()`/`tubePost()`, `pulse()`,
   `hazardFloor()`, and `transferBay({axis:'x'})`. Notes in `FLOOR-TOPOLOGY.md` §4.
2. ~~Floor surgery~~ — done.
3. ~~The relay runs~~ — done. Seven trench runs into the tower, three overhead
   runs out, receipt ducts on `echo` and `indexer`. `World.RELAY` holds the
   network as data.
4. ~~`audit` as the tower~~ — done. **`reporting` as its annex** is the one
   machine left on a first-pass drawer.

Both consequences of the surgery are now **resolved for `audit`**, and the tower
is the pattern for `reporting`:

- The tour narrates it again — `endTrip()` in `sim.js` emits
  `station: 'audit'`, so the record keeper gets the last word on every trip.
- It is not static. `busy('audit')` can never be true, so the tower does not use
  it: `towerSrc()` borrows the cam of whichever machine is currently *reporting*
  to it, and a second cam runs off `Sim.state.reconT`, a countdown `endTrip()`
  starts for the ShedLock cron. Both are pinned at zero while paused, so the
  idle test still reads zero changed pixels. `ec-reporting` should take the same
  route rather than being left frozen.

Every belt station now has its transfer bay. The three that consume without
publishing to the line — `echo`, `indexer` — have intake bays only, and that
absence is labelled rather than left looking unfinished. Every receipt duct
that is going to exist now exists. The upstream row — gateway,
qualifier, filter, evaluator, quota — is done, and the whole records precinct is
plumbed; what is left is the five first-pass drawers.

## The chrome — ported from `/home/shafi/rocket-engine`

The UI is a port of **`/home/shafi/rocket-engine`**'s chrome. `hud-kit.html` at
the repo root is a *summary* of it and is useful as an index, but it is not the
source: read `rocket-engine/css/styles.css`, `js/ui.js` and `index.html`
directly. (Learned the hard way — the kit page's own documentation styling, Big
Shoulders / IBM Plex from Google Fonts, is not what the app uses. The app is
`system-ui` with a mono stack, and copying the doc page's fonts into the app
made it look nothing like the reference.)

`css/styles.css` **starts as a verbatim copy of the reference's** and carries a
comment saying so. Keep it that way: when something is wrong, diff against
`rocket-engine/css/styles.css` first. The dock's rules have since moved to
`css/dock.css` (still verbatim, still diffable — against the `dock` section of
that same file). The EC-specific deltas are marked inline and are only these:

- the `.logo` mark — a conveyor with a machine on it, not a nozzle bell;
- `.carrier-pip` / `.carrier-state` in the dock, because the belt carries one
  communication and whether it is sampled changes what happens to it;
- `.field.pick` / `.field select`, for the Pipelines selector;
- `.bar.over`, so a lag bar past its service's `lagThreshold` takes the ember
  warn colour the same way a `.sheet .row.warn` does;
- the mobile block: this dock carries **eight** sliders where the reference has
  six, so with the tune drawer open it is tall enough that the reference's
  zoomer position lands inside the bottom sheet. The zoomer moves to the
  **top-right** (the HUD owns top-left, the sheet owns the bottom), the sheet's
  `max-height` is clamped against the measured `--dock-h` rather than a bare
  `vh`, and two HUD chips take `.opt` and drop out below 900px.

### The component vocabulary

DOM order matters and matches the reference: canvas → tooltip → topbar → hud →
zoomer → **inspector → dock**. The dock is a *sibling after* the inspector
because `.inspector.hidden ~ .dock { right: 14px }` is what lets "Hide panel"
give the dock the full width. Putting the dock first silently breaks it.

- **topbar** — gradient fade, `pointer-events: none` on the strip, re-enabled
  per child group. `About & accuracy` and `Hide panel`, both relabelled shorter
  under 900px by `applyResponsiveLabels()`.
- **hud** — `hud-item` chips (`label + mono value`) plus one full-width
  `hud-note` line. The note is plain text with a text-shadow, **not** a
  bordered toast.
- **zoomer** — three square buttons, its own component, not part of the topbar.
- **inspector** — `stage-card` (chip + tag + h2 + `.lede` + `.muted` + `.dwell`)
  followed by independent `.sec` blocks. The chip's colour is set **inline in
  JS** from the district's own accent, never a fixed class.
- **dock** — `.dock-row` transport row, then `.dock-tune` which is
  `display: contents` on desktop (sliders flow into the row) and collapses
  behind `#btn-tune` under 900px.
- **modal** — `.modal[hidden]`, the `hidden` **attribute**. EC previously used a
  `.hidden` class against a rule that set `display: flex`, so `main.js`'s Escape
  handler (`about.hidden = true`) had never actually closed it.

### The dock is a component, not markup

`css/dock.css` + `js/dock.js` + a spec. `index.html` carries an empty
`<footer class="dock" id="dock"></footer>` and nothing else.

Adding a control used to be five edits across two files that had to agree on a
string: a `<label class="field slider">` block, an `<input>` with an id, a `<b>`
with that id plus `-val`, a `wireSlider()` call, and — if it was logarithmic —
an entry in a `LOG_SLIDERS` table. It is now **one descriptor in `DOCK_SPEC`**
in `ui.js`, and `Dock.build()` produces the markup, the value readout, the
log-scale mapping and the listener.

```js
{ kind:'slider', id:'ingest-rate', label:'Ingest',
  scale:'log', logMax:20000, value:50,
  fmt: function (v) { return fmtNum(v) + '/s'; },
  hint: 'Records a second arriving at the gateway…' }
```

Kinds: `slider` (linear or `scale:'log'`), `select`, `toggles`, `text`.
`spec.fields` go in row 1 beside the primary action; `spec.controls` go in the
tune pane. The `-val` id convention is kept, so nothing outside the dock had to
learn new ids and the existing test harnesses still drive the raw inputs.

The module knows about rows, fields and the gear drawer; it knows nothing about
what a number means. `onInput(id, value)` is **the only place a dock value meets
`Sim.state`** — one switch in `ui.js`, rather than a listener per control
scattered through `init()`.

Two things this bought beyond tidiness:

- **`dock.sync()`** pushes every control's default back through `onInput` at
  boot, so `Sim.state` starts in step with the dock instead of both carrying
  the same numbers and drifting.
- **`hint`** on a descriptor becomes the field's `title`, so the reasoning that
  used to sit in HTML comments where no reader would ever see it is now a
  tooltip on the control it explains.

`paint()` goes through `dock.setPlaying()` / `dock.setStatus()` rather than
poking `#play-glyph` and `#carrier-pip`; `UI.dock()` exposes
`value/set/sync/setPlaying/setStatus/el`.

Reusability is verified rather than asserted: `scratchpad/reuse.mjs` rebuilds
**rocket-engine's own dock** — serial-number text field, Build primary,
chamber-pressure / mixture-ratio / expansion-ratio sliders — from a spec, in
this page, with no changes to `dock.js`. That is the bar the word has to clear.
`.field.grow` and `input[type="text"]` in `dock.css` exist for exactly that
case; EC itself has no text field.

### The `.sheet` rows — the part that was missing

The reference's most important pattern, and EC had no equivalent at all. A row
is `label + mono value`; **`.calc` marks a figure the model worked out** (amber
tint plus a small `ƒ`) as opposed to one the reader typed in, and **`.warn`
marks one out of range** (ember). `rows()` in `ui.js` is the generic renderer.

`#sheet` now carries twenty rows of what the model computed for this
communication — byte ranges, concurrent streams, waves, bytes on the wire,
matched entities, pipelines claiming, Cognition wait, quota bucket, bulk
position — ending in a `.row.big` for end-to-end latency. `Cognition wait` goes
`.warn` past the COMS ceiling and the section hint says so.

**`paint()` uses `Sim.planNow()`, never `s.plan`.** `s.plan` is frozen at the
start of a trip, so a panel built from it only moves once per trip — drag Ingest
and the lag bars sit still. That is the same failure the machine-readout rule in
*Building a machine* warns about, and the panel is held to it too.

The other `.sec` blocks reuse the reference's patterns directly: `.bars` for
Kafka lag (bar = lag as a share of that service's *own* `lagThreshold`, value =
the KEDA replica count), `.tokens` for the traveller trail, `.output`/`.unit`
for the record keeper's filed ledgers, and `.chips` for the click-to-fly station
picker.

### What did not change

`js/main.js` needed no edits. Every id it looks up — `#stage #tooltip #dock
#inspector #hud .topbar #zoom-in #zoom-out #zoom-fit #follow #labels #about` —
still exists, and `measureLayout()`/`setVar()` already wrote `--hud-top` and
`--dock-h` the way the reference expects.

Note for the test harness: the run button is `#btn-run` (it was `#start-btn`),
and the scratchpad `branch2.mjs` was updated to match.

## Fidelity

## Fidelity

`js/model.js` states the boundary in its header and the About modal repeats it:
computed (the whole ranged-GET plan, Kafka queue depth, KEDA replicas, retry
ladder, quota counter, ES bulk flush, end-to-end latency); assumed (the
latency/throughput constants, `MONITORED_SHARE`, `FLAG_MATCH_SHARE`,
`PROFILE_INCLUDE`);
controlled (the Cognition round trip is a slider, not a constant, because it is
the one latency EC's own code does not bound); scaled (the Cognition wait shown
in seconds against a 9 000 000 ms ceiling, and every machine's work cycle);
faked (floor shapes, belt texture, machine livery, and the two opaque
identifiers on display — the window token and the echo fingerprint are
plausible shapes, not real values). Keep
`js/model.js`, the About modal in `src/index.html` and `README.md` in sync when
the model changes.

## Run it

Open `src/index.html` directly, or:

```
cd src && python -m http.server 8000
```

## Verify idle gating

`main.js` calls `UI.run()` at boot, so the simulation is **already running when
the page loads** — "before pressing START" is not an idle state and a frame diff
taken there proves nothing. The belt also runs continuously with the plant.

To prove a machine is properly gated: pause the sim, stub the conveyor, and diff
two frames. Anything that still moves is a bug.

```js
await page.evaluate(() => { Factory.drawBelt = function () {}; Sim.pause(); });
```

All eight rebuilt machines currently register **exactly zero** changed pixels
under that test, including after the floor surgery.

## Verify a change

```
cd src
# One file at a time: `node --check js/*.js` only checks the first one.
for f in js/*.js; do node --check "$f" || echo "FAIL $f"; done

python -m http.server 8000 &
node ../.claude/skills/isometric-explainer/scripts/smoke.mjs http://localhost:8000/
```

The smoke test fails on any console error, steps the carrier through every
station, and writes a screenshot. Look at the screenshot — occlusion and label
collisions do not raise errors. It needs Playwright
(`npm i -D playwright && npx playwright install chromium`).
