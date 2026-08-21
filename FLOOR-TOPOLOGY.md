# Floor topology — the records precinct

The standing design record for the *shape* of this floor, as distinct from
`CLAUDE.md`, which covers how an individual machine is built.

This file exists because the reasoning here is expensive to rediscover and easy
to lose between sessions. **Keep it current**: when a work item in §4 is
finished, tick it and note anything the doing of it taught. When a decision in
§2 is revisited, amend it and say why rather than deleting it.

Everything named below already appears in `README.md` and in the channel tables
of `knowledge/system-explainer-input.md`.

---

## 1. The problem

The belt is Flow A and Flow B: a line, and a true one — it is the path one
communication takes.

The platform is not a line. Three classes of connection exist in the
architecture and appear nowhere on the floor.

### 1a. Terminal-event fan-in

Every service performs one decision and emits one receipt, and the platform is
built so those receipts can be counted back against the number of
communications ingested. **The receipts are the product.** The belt shows none
of them.

`ec.centralized.{tenant}.audit` has five producers — `ec-queue-qualifier`,
`ec-surveillance-filter`, `ec-surveillance-policy-evaluator`,
`ec-surveillance-quota-manager`, `ec-echo-engine`. `ec-indexer` adds
`…audit.indexer.event`. `ec-gateway`'s `…ingestedCommunication` outbox is
consumed by audit, and audit calls the gateway's watermark REST endpoint *back*.
`ec-centralised-audit` also consumes "roughly 25 audit and DLT topic patterns",
including the `-dlt` families of four services.

Count it exactly, because the relay network is built from this: of the ten belt
stations, `ec-centralised-audit` and `ec-reporting` are the *consumers*. Of the
eight upstream of them, **seven feed audit and `ec-alerting-service` does not** —
it produces `alertedCommunication`, `echoCommunication` and its own outboxes, and
no audit event at all. Its accounting arrives second-hand, via echo and the
indexer.

Seven relay lines and one machine conspicuously without one is truer and more
interesting than eight uniform lines, and it is checkable against the tables.

### 1b. CDC outboxes

Several services never publish to a topic directly. They write a row and
Debezium publishes it:

| Service | Outbox topic |
| --- | --- |
| `ec-gateway` | `…outbox.{tenant}.ingestedCommunication`, `…qualifiedCommunication` — drawn, single-track ledger |
| `ec-surveillance-quota-manager` | `…surveilled-communication-outbox`, `…metadata-outbox`, `…quota-windows` — drawn, three-track ledger |
| `ec-alerting-service` | supervised item written with its outbox row |
| `ec-centralised-audit` | `…outbox.{tenant}.windowReconciliation` |
| `ec-queue-qualifier` | `ec.surveillance-config.outbox.{tenant}.surveillancePipeline` |

**Standard: direct publish and CDC look different.** A service that publishes
straight to a topic gets an outfeed inserter on its transfer bay. A service that
writes an outbox row gets a ledger and a pickup head. Established on
`ec-gateway` and `ec-surveillance-quota-manager`; apply it to
`ec-alerting-service` and `ec-centralised-audit` when they are rebuilt.

### 1c. Configuration broadcast and back-references

`ec.config-curator.{tenant}.freeze-window` fans out to four services — evaluator,
qualifier, quota-manager, centralised-audit. `…quota-windows` fans out from the
quota manager to gateway, audit, reporting and manual-runs.
`ec.echo-engine.{tenant}.echoAction` runs *backwards*, from echo to alerting.

---

## 2. Decisions taken

### D1 — The belt becomes a U, and the interior becomes the records precinct

The belt loses its third run:

```
(6,8)      → (corner,8)     top run,    west→east
(corner,8) → (corner,28)    the turn,   north→south
(corner,28)→ (14,28)        middle run, east→west
```

All ten machines sit **outside** the U — the top row north of its run, the
middle row south of its run — and the enclosed interior belongs to
`ec-centralised-audit` and `ec-reporting`. The line runs *around* the record
keeper, which is the actual relationship.

The exact corner x is an implementation detail to settle against a screenshot;
somewhere around **x 58–60** balances the runs without crowding the evaluator's
reserved footprint, which ends at x 48.5.

### D2 — Audit and reporting come off the belt entirely

The carrier currently ends its journey *at* audit, and three of the four forks
jump it there. But the communication never travels to centralised-audit — audit
consumes *events about* it.

So the belt's last station becomes the **indexer**, and the suppression forks
**end the run where they happen** rather than walking the carrier to a record
keeper. The convergence moves from the conveyor to the relay network: the
document's journey gets shorter, and the receipt always arrives.

Note what this changes in the reading: "the saving is a shorter journey" becomes
*stops earlier* rather than *travels a shorter path to a common end*. That is
more direct, not less.

### D3 — `ec-centralised-audit` is a control tower in the interior

Raised on legs, tube terminus and trench riser at the base, instruments on the
upper deck, beacon above. `ec-reporting` becomes an annex beside it.

It does **not** have to look like the belt machinery, and should not. It is the
second permitted non-machine on this floor, after the archive mast.

### D4 — Window tokens split three ways; the tower gets the *closing*

Three services touch windows and they do genuinely different things. Do not
duplicate the story across them:

| Service | Its part | Status |
| --- | --- | --- |
| `ec-config-curator` | Freezes the **configuration** for a window — the snapshot the qualifier's plate reads. `freeze-window` to four services. | For when config-curator is rebuilt |
| `ec-surveillance-quota-manager` | **Mints and rotates** the token. `…quota-windows` to gateway, audit, reporting, manual-runs. | Done — third track of its CDC ledger |
| `ec-centralised-audit` | **Closes** the window. `ec-audit-events_{windowToken}`, the ShedLock cron, `…windowReconciliation`. | The tower's deck |

So the tower carries a rack of **window ledgers** — the current one open and
filling, older ones closed and stamped reconciled or not — and the **watermark
comparator** reading against the gateway's standpipe. Minting stays where it is.

### D5 — Relay: recessed trench inbound, overhead tube outbound

Paint alone is too quiet. The trench is a **real recessed gutter**: the dark
opening, the inner face of its north wall, and a gutter floor about 0.22 below
grade, with a raised kerb on the near lip and a thin hazard band on the floor
beside it, at floor-banding scale rather than machine-kerb scale.

It costs nothing in occlusion because it lives *below* the ground plane: the
floor goes down first, the trench cuts into it, and every solid is drawn later
and higher. It can therefore pass under the belt freely.

**Direction is encoded in the medium:**

- **Trench — inbound.** Seven receipt runs, machine → tower, underground.
- **Overhead tube — outbound.** The tower's own traffic: the watermark query
  back to the gateway, `windowReconciliation` out to reporting and the quota
  manager. At z ≈ 4.5 a tube projects roughly 170 px *above* the carrier, so it
  crosses the belt without ever touching it.

Both glow when they carry something. **The pulse is gated on the sending
machine's own cam** — it leaves when that machine's receipt duct fires — so
nothing here runs on a free timer.

### D6 — `ec-surveillance-quota-manager` moves to the turn, inner side, unrotated

Four machines on the top run, one on the turn, three on the middle run, instead
of five / nothing / three.

**Inner (west) side**, because on a vertical run the west side has the smaller
`x + y` sort key and so is drawn *before* the carrier — the carrier paints over
it, safe at any size. East of the carrier is drawn after and would paint over
it.

**Unrotated.** Rotating the machine 90° so its flow follows the belt would put
its long side on the east face, and every instrument in the kit — `readout`,
`matrix`, `plate`, `bolts`, `ribs` — is written for the south face. It would
also break the floor's reading direction, where every machine flows left to
right. Instead give `transferBay()` an `axis: 'x'` mode: an east–west roller
table with the arms swinging in the x sense. The intake arm reaches
east-and-north to the upstream segment, the outfeed east-and-south to the
downstream one.

---

## 3. Constraints and numbers

Cheap to violate, expensive to debug. Keep these to hand.

**Depth sorting.** One painter's pass, sorted on `x + y`, with the carrier among
the objects. A solid with a *smaller* key than the carrier is drawn first and is
safe at any height. A solid with a *larger* key is drawn after and will paint
over the carrier wherever they overlap in screen space.

- North of a horizontal run → safe.
- West of a vertical run → safe.
- South of a horizontal run → only safe if the setback exceeds half the
  footprint, `(w + d) / 2`.

**Tower height budget.** The binding constraint is the *top* belt run, because
anything in the interior is south of it and so drawn after the carrier. No
overlap requires `h < (15·(y_tower − 8) + 12) / 20`:

| Tower centre y | Max height |
| --- | --- |
| 18 | 8.1 |
| 20 | 9.6 |
| 22 | 11.1 |

Siting the tower around **y 20–21** gives a genuine tower — say 8 units to the
deck, beacon above — with margin.

**Middle-row machines will need to move south.** `alerting`, `echo` and
`indexer` sit at y 32 against a belt at y 28. At their current 5 × 3 footprint
they just clear it; rebuilt at 9 × 5.2 the half-footprint is 7.1 against a
setback of 4, and they would occlude the carrier. Push them to about **y 35**
when each is rebuilt.

**Overhead runs** at z ≈ 4.5 clear the carrier by ~170 px in screen space and
may cross the belt freely. Watch only for tall machine parts — the gateway's
archive mast reaches z 5.

**Screen directions**, since they cost two iterations on the press: south is
*left*, so anything overhanging a machine's deck hides the casing face to its
*west*. East is the brighter of the two visible side faces (0.80 vs 0.58).

---

## 4. Work items

Tick as completed and note what it taught.

### Kit

- [x] `trench(x0, y0, x1, y1, opts)` — recessed gutter with kerb and hazard edge
- [x] `tubeRun(x0, y0, x1, y1, z, opts)` / `tubePost()` — overhead capsule run
- [x] `pulse()` — the travelling glow, shared by both, gated on the sender's cam
- [x] `transferBay({ axis: 'x' })` — east–west roller table and arm swing
- [x] `hazardFloor()` — floor-plane striping, which the trench needs and
      `hazardStrip()` (face coordinates) could not provide

**What building them taught.**

*The trench needs its own pass, before the belt.* `drawDecals()` runs **after**
`drawBelt()`, so a trench drawn with the decals paints over the conveyor
instead of passing under it. There is now a `drawTrenches()` call between
`drawCognitionFloor()` and `drawBelt()`; it is empty until the runs are laid,
but the ordering is already correct.

*Narrow and deep, or it is not a trench.* At width 0.90 and depth 0.22 the cut
read as a flat black stripe painted on the slab — there was almost no wall to
see into. The defaults are now **width 0.58, depth 0.34**, with a lit top edge
on the far wall. The kerb also has to be **lighter than the slab** (`#807d75`
against the floor's `#5f5d57`): a raised lip the same value as the floor is not
a raised lip.

*The near kerb is load-bearing, not decoration.* Below grade, the bottom of the
cut projects *lower* on screen than its own near lip, so without a kerb wide
enough to cover that offset the floor of the trench appears to spill out past
the edge. At depth 0.34 the kerb needs to be about 0.34 wide, which is where
the default comes from.

*An oriented box is a girder, not a tube.* `tubeRun` draws a second, narrower,
lighter run along the crown to give it a round read.

*`transferBay` had a latent bug, found by generalising it.* The arm splay was
derived from `dir`, which happens to give the right answer on the top run and
the wrong one on the middle run — a bay there would have reached its intake arm
*downstream*. Splay is now computed from an explicit `flow` option, the belt's
direction of travel at that bay, defaulting to `'e'` on a y-spur and `'s'` on an
x-spur. **The middle-row machines must pass `flow: 'w'`.**

*Verified against the real floor* with a temporary harness: a trench run passing
under the belt, a tube run crossing over it at z 4.5 without touching it, pulses
travelling in both, and an axis-`x` bay with its rollers and arms in the right
orientation. The harness has been removed.

### Floor

- [x] Shorten the belt to the U; settle the corner x against a screenshot
- [x] Move `ec-surveillance-quota-manager` to the turn, inner side (D6)
- [x] Move `ec-centralised-audit` off the belt — at (32, 19) for now, still on
      its first-pass drawer; the tower form comes with its rebuild
- [x] Move `ec-reporting` off the belt — at (42, 21.5), same
- [x] `sim.js`: forks end the run where they happen instead of jumping to audit
- [x] Decide what becomes of the vacated bottom third of the slab — the slab
      itself shrank, `GH 54 → 48`, and the three reporting-corner side
      structures moved up into what was left, which is where they belonged
- [x] Receipt ducts on the machines still lacking them — `echo` and `indexer`.
      **Not `ec-gateway`**: its relay to audit *is* the outbox Debezium
      publishes, so its trench branch starts under the CDC pickup head it
      already has, and a second duct would have been redundant hardware.
- [x] Seven trench runs — gateway, qualifier, filter, evaluator, quota, echo,
      indexer — and no line at all for `ec-alerting-service`
- [x] Three overhead outbound runs from the tower
- [x] Middle row moved to **y 36**, computed rather than guessed, so the
      trenches were laid once instead of twice

**The network as built.** `World.RELAY` holds it as data, not drawing. Eleven
trench segments for seven machines, because it is a common trench with branches
rather than point-to-point cabling: four branches drop from the top row onto a
north spine at y 12.5, two rise from the middle row onto a south spine at y
31.5, each spine feeds a riser into a face of the tower, and the quota manager
comes in along the east face. Both spines cross the belt on the way. Three
overhead runs leave at z 4.5 — `GET /watermark` back to the gateway, and
`windowReconciliation` out to reporting and the quota manager.

Each segment carries a `src` list of the machines whose receipts use it, and
glows only while one of them is sending. The cam gate guarantees at most one is,
so a shared segment can simply take the maximum. Timing is staged —
branch `[0.84, 0.92]`, spine `[0.90, 0.96]`, riser `[0.94, 1.00]` — so a receipt
is *seen* to travel machine → spine → tower rather than the whole network
flashing at once.

**What laying it taught.**

*The stanchions and the runs go in different passes.* At z 4.5 nothing on the
floor can occlude a horizontal run, so it is drawn after the sorted pass. A
stanchion reaches the ground and has to sort like any other solid, so
`World.RELAY_POSTS` goes through the sorted pass as its own object kind. Getting
this wrong would put a post in front of a carrier it stands behind.

*Props have to be kept off the trench.* `blocked()` now includes a
`nearTrench()` test, or a crate ends up straddling an open cut. The clearance is
1.3 plus the caller's pad.

*The middle row had to move first.* At y 32 a rebuilt 9 × 5.2 machine would have
occluded the carrier — `h < (15·(northEdge − beltY) + 12) / 20` gives a budget
of under 3 units, which nothing rebuilt so far would meet. y 36 gives 4.6 for a
rebuilt machine and 5.4 for the first-pass ones. Moving them was free because
the first-pass drawers derive everything from `o.x`/`o.y`.

*Verified*: the relay lights only while a machine is sending — green-glow pixels
swing from a 74-pixel floor (other green things on the floor) to 142 across one
cycle at the qualifier, and the paused, belt-stubbed idle diff is still exactly
zero.

**The settled numbers.** Corner at **x 60**. The belt is
`(6,8) → (60,8) → (60,28) → (28,28)`, total length 106, down from 184. Station
distances are `cum[1]` gateway, `[2]` qualifier, `[3]` filter, `[4]` evaluator,
`[6]` quota, `[8]` alerting, `[9]` echo, `[10]` indexer, with a short run-out
past the last machine so the carrier is seen to leave it. The quota manager sits
at (53, 16.3) inside the turn, its east face at x 56.6 against a belt whose west
edge is 58.7, with `axis:'x'` bays spanning the gap. Audit is at (32, 19) and
reporting at (42, 21.5), both inside the U.

**What the surgery taught.**

*Moving an authored machine is a translation, not a rewrite.* `drawQuota` was
authored around a centre of (53.40, 2.00), and moving it by hand would have
meant re-deriving some sixty coordinates. `atWorld(dx, dy, fn)` shifts the whole
assembly instead — a world translation is exactly a screen translation in this
projection — and only the transfer bays were rebuilt, because they had to reach
*east* to a vertical belt rather than *south* to a horizontal one. That split —
body carried by the shift, connections placed against the new surroundings — is
the pattern for any future relocation.

*Off-belt structures need their own category.* `World.OFFBELT` holds them: the
same shape as a station minus `dist`, dispatched through `OFFBELT_DRAW` in
render.js. They are solids in the depth-sorted pass and they block props like
anything else, but the simulation never fires them.

*Three places still said the carrier goes to audit* — the HUD note at the gate,
the quota narration, and the `sim.js` header. Text outlives the behaviour it
describes; grep for the old destination after any change of this kind.

**Consequences recorded rather than fixed:**

- **The tour no longer narrates audit or reporting.** They were the last two
  stations and the run's climax; now the run ends at the indexer and their
  narration is only reachable by clicking them. This is a real regression in
  what the explainer teaches. The likely answer is that the tower earns its own
  turn when the trip completes — the record is, after all, what completes at the
  end of every path — but that is a decision, not an oversight.
- **Both off-belt machines are now permanently static.** Their drawers animate
  through `busy(id)`, which can never be true for something the simulation never
  fires. Correct for the moment, and the tower's own motion should come from a
  relay arriving rather than from a station firing.

### Machines still on their first-pass drawers

One at a time, each with a transfer bay and a receipt duct.

- [x] `ec-alerting-service` — the assembly bench. Four enrichment feeds
      coloured for where each comes from, an assembly bench, twin presses for
      the two parallel writes with the outbox marked as the source of truth, a
      finished-item rack, the echo return running against the flow along the
      south apron, and a two-track CDC ledger. **No audit relay** — the duct pad
      is there with a blanking plate bolted over it, because an absence you can
      see is worth more than one you cannot.

      *Two things it taught.* The middle row must report from its **south**
      apron: north of those machines is behind them from this camera, and the
      receipt ducts I first placed there were invisible. The southern relay was
      rerouted — branches drop away from the belt to a spine at y 40.2 and the
      riser comes back north at x 30, west of the indexer. And a pipe laid south
      of a casing projects **up** over it: the echo return at z 0.62 ran straight
      across the readouts, and had to drop to z 0.30.
- [x] `ec-echo-engine` — the card-index comparator. A batch of ten grouped into
      thread lanes, hit tags **sorted** then hashed beside a **capped body
      port** (it never opens the document), a card file whose drawer takes the
      card **before** the comparison runs, and three verdict lamps rather than
      two: new, earlier, later. **Intake bay only** — it publishes nothing onto
      the belt; its answer goes back east to alerting as an echoAction and its
      receipt goes down the trench.

      *Model fix.* `v.isEcho` was `Math.random() < 0.08`, recomputed on every
      frame, so the outcome was unrepeatable and unexplorable. It is now derived
      from the trip, and the **fingerprint is derived from the policy hits, not
      the trip** — the same scenario on the same thread must produce the same 32
      characters, which is the entire basis of the match. Change **Pipes** and
      the hits change, the fingerprint changes, and nothing suppresses.
- [x] `ec-indexer` — the bulk press. The same FileChunkingStrategy matrix as the
      gateway (ported verbatim, so it appears twice on purpose), a cached index
      name, a collector hopper with a sight glass and a red fifty mark, a parent
      document plus an audio child, the bulk ram, a **retry siding** for the
      per-record fate, and the REST bypass an empty S3 object takes instead.
      Intake bay only.

      *Model fix — a second inert mechanism found.* `batchPosition` incremented
      a counter that started at 25, so it was **26 on every trip and the flush
      never happened** — the one thing this station exists to demonstrate. The
      three trips now take positions 26, 50 and 13, declared as illustrative, so
      the fiftieth arrives inside a short run: station time jumps from 33.5 ms
      to 88.9 ms and the ram fires. **Fail%** now does something here too, as
      the count retried alone.
- [x] `ec-centralised-audit` — as the tower, per D3/D4. Built at
      **x 28.6–35.4, y 17.2–21.2**, centre (32, 19.2), height 6.6 with the
      beacon reaching 6.5 — the tallest thing on the floor, and clear of the
      depth budget (`h < (15·(17.2 − 8) + 12) / 20 = 7.5`). Four storeys, read
      bottom to top because that is the order things happen in: open legs with
      the three trench risers surfacing between them; the header gate and the
      failed-events bin at ground level, west, where the camera sees them; the
      ledger hall; the instrument deck.

      What the doing of it taught:

      1. **The livery cap is the wrong colour for a deck.** The two deck slabs
         are the largest flat surfaces on the floor and `casing('audit').cap` is
         a warm salmon — at any zoom they read as *payload*, which is exactly
         backwards for a building nothing passes through. Decks are now
         `Iso.mix(M.steelD, cs.body, 0.28)` and the accent is spent on a lit
         edge trim and the instruments. Rule 2 bites hardest on large areas.
      2. **A deck's back half is not visible.** The two reconciliation columns
         were first placed at the deck's north-west — the far corner — and
         vanished. Anything on a raised deck that must be read belongs on its
         **south and east thirds**; the north strip is for the things that only
         need to exist (KEDA rack, beacon mast, ShedLock lantern).
      3. **`busy(id)` is not the only honest gate.** The tower can never be
         `busy` — no station fires it — but it is not therefore static. It has
         two cams: `towerSrc()` borrows the cycle of whichever machine is
         currently reporting to it, and `Sim.state.reconT` is a countdown the
         `endTrip()` starts for the ShedLock cron. Both are still zero when the
         sim is paused, so the idle test holds. The same pattern is available to
         `ec-reporting`.
      4. **The overhead runs belong to the cron, not to the machines.** They
         were gated on `relayAt(tb.to, …)` — the *destination* machine being
         live — which is a lie: the watermark GET is a call the tower makes
         during reconciliation. Re-gated onto `reconPhase()`, and dark
         otherwise, which is the truth about a fifteen-minute cron.
      5. **A stale counter hid in plain sight.** `auditEventsEmitted` was
         incremented in `charge()` only when the carrier reached the audit
         *station* — gone since the belt became a U — so the audit narration had
         been interpolating 0 since the surgery. Now fed from `AUDIT_RECEIPTS`.
- [ ] `ec-reporting` — as the annex

### Done

- [x] `receiptDuct()` in the kit — on `qualifier`, `filter`, `evaluator`, `quota`
- [x] CDC ledger standard established — `gateway` single-track,
      `quota-manager` three-track
- [x] The whole upstream row rebuilt and standing north of the belt

---

## 5. Deliberately not represented

Recorded so the omissions are decisions:

- **Retry ladders and DLTs.** Every service has `-retry-0`, `-retry-1` and
  `-dlt` topics, and audit consumes four of those families. The model prices the
  retry ladder into station time; the floor shows no parked records. A
  dead-letter siding per machine would be honest, and is a candidate once the
  trench exists.
- **The freeze-window flow.** The qualifier's plate is stamped with its window
  token and bolted in, but there is no magazine and no swap, because `sim.js`
  has no window-rotation event and inventing one would be motion on a timer.
  See D4 — this belongs to `ec-config-curator`.
- **Multi-tenancy.** Every topic is per-tenant. The floor shows one tenant.
- **The three REST population endpoints** the qualifier serves to review-service
  and reporting. The watermark tap on `ec-gateway` is the only REST call given
  hardware so far — and the tower's outbound tube back to it will be the second.
