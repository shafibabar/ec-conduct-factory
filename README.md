# EC Factory Tour

An isometric factory that surveils one electronic communication, station by
station, and proves it did.

A carrier rides a conveyor through eight surveillance machines. It enters as a
notification that something landed in the archive; it is downloaded from S3 and
stripped of its body, matched against the populations under surveillance, run
through ignore and flag policies, split into metadata questions answered locally
and content questions sent to an external analytics platform, and then counted
against a sampling quota by a single atomic Redis increment. That counter is the
sorting gate: sampled communications continue to alerting, echo suppression and
the search indexer.

Four times along the way the journey can end early — nothing claimed it, nothing
qualified, the content verdict never came back, it wasn't sampled — and when it
does, the carrier simply **stops where it was stopped**. It does not travel on to
a record keeper, because the record keeper never receives the communication: it
receives *events about* it. So `ec-centralised-audit` and `ec-reporting` are not
on the belt at all. They stand inside the loop the belt makes, and the line runs
around them, because the platform's real product is not the alert — it is the
ability to prove, months later and to a regulator, exactly what it did with every
message it was given.

16 Smarsh Enterprise Conduct repositories are on the floor: eight as belt
machines, two off the belt inside its loop, six as side structures around it —
the control room that freezes configuration, and the reviewer portal and
actioning tier that closes each record's life. Five more repositories exist in
the real platform — a reporting-corner trio that reads the same audit trail
the tower already shows, a library with no floor presence of its own, and one
read-path detail too fine-grained for a structure — and are documented in
`knowledge/system-explainer-input.md` without being drawn.

No build step, no dependencies, no framework. Open `src/index.html`.

## What is actually being computed

The numbers on the panel are worked out rather than looked up, and the constants
they are worked out from are read out of the repositories themselves — KEDA
`ScaledObject` manifests, retry backoff properties, chunk sizes, batch sizes.
Move a slider and the platform's behaviour changes.

**Computed live, in the browser:**

- **The S3 download**, as a port of `FileChunkingStrategy.maxAllowedChunkSizeBytes`:
  a document is cut into 5 MB byte-range chunks fetched over at most 25 concurrent
  streams, and past that ceiling it comes back for a second wave. A ranged GET
  only asks for the bytes that exist, so below 5 MB the cost tracks the document
  size; above it, doubling the size costs nothing until the 25 streams are full.
  The **Doc** slider is logarithmic and runs from 1 KB to 128 MB, which is 26
  chunks over two waves — the whole curve is reachable, and the gateway's
  25-lamp matrix is that concurrency ceiling, lamp for stream.
- **Kafka consumer lag and KEDA replica counts**, per service, from that service's
  own `lagThreshold` and `maxReplicas`. The thresholds are not uniform and the
  difference is the point: `ec-alerting-service` tolerates 1000 messages of lag,
  `ec-surveillance-quota-manager` 50, and `ec-centralised-audit` and
  `ec-reporting` only 40, because several audit events arrive per communication.
  One replica of `ec-gateway` is modelled at around 700 records a second, so the
  **Ingest** slider is logarithmic and runs to 20 000/s: below a few thousand
  nothing queues anywhere and every service sits at its three-replica floor.
  Push it up and the floor sorts itself into the order the thresholds dictate —
  quota, audit and reporting hit the 32-replica cap while alerting is still at
  three, because alerting is allowed to fall 1000 messages behind and they are
  not.
- **Queue time**, from lag divided by the throughput the scaled replica count
  actually delivers — which is why turning **KEDA** off pins every service at
  three replicas and lets the queues run away.
- **The bottleneck**, as whichever service is furthest over its own threshold.
  It moves as you drag, and it is rarely the station you would guess.
- **The retry ladder**, from each service's measured first and second backoff
  delays weighted by the failure rate.
- **The quota decision** — an incrementing counter against the sampling limit,
  which is what actually routes the carrier at the gate.
- **All three suppression exits**, each reachable from the controls and each
  visibly a *shorter journey* rather than a smaller number: **People 0** and no
  pipeline claims the communication, so it leaves the qualifier for audit;
  **Ignore% 100** and nothing qualifies, so it skips evaluation and is counted at
  the gate; **Sample% 1** and the quota is exhausted, so it skips alerting, echo
  and the indexer. Every one of them is still counted and still audited. A
  fourth exit belongs to Flow C rather than Flow B: **Content% 100** with
  **Cognition** past the 9 000 000 ms ceiling and every content verdict ages
  out, so nothing reaches `…surveilled` and the record leaves the evaluator for
  audit without ever being offered for sampling.
- **The Elasticsearch bulk flush**, which fires only when the batch reaches 50
  records, so most communications cost nothing to index and every fiftieth one
  pays for all of them.
- **End-to-end latency**, the sum of per-station work and queue time.

**Controlled, not assumed:** the Cognition round trip. It defaults to 45 000 ms,
but it is the one latency EC's own code does not bound, so it is a slider that
reaches past the 9 000 000 ms COMS ceiling — and end-to-end latency climbs with
it until the ceiling stops it.

**Assumed:** the storage and database constants — S3 first-byte 25 ms and
60 KB/ms, Mongo reads 4 ms and writes 8 ms, Redis increment 1 ms, Elasticsearch
bulk 40 ms plus 200 KB/ms, policy evaluation 0.5 ms, a body-strip that leaves
12% of the original, 80% of a document's participants being in the monitored
population, a flag policy matching on 75% of the pipelines an ignore policy did
not suppress, four policies per pipeline, and 90% of surveilled communications
passing the sampling profile's own participant filters. These are plausible numbers of the right order; they are not
measurements from production. The two opaque identifiers on display — the window
token and the echo fingerprint — are plausible shapes, not real values.

**Scaled:** the wait for Cognition. The evaluator's real timeout is 9,000,000 ms
— about two and a half hours — and the panel says so, but the carrier cannot
stand still for two and a half hours, so on screen it is compressed to a few
seconds. It is the one number where what you see is deliberately not to scale.

**Scaled, too:** a machine's work cycle. `ec-gateway` really does its ranged
GETs, its body strip and its outbox insert in a couple of hundred milliseconds;
the press on the floor takes two and a half seconds a stroke, because a stroke
you cannot see teaches nothing. The figures on its readout are the real ones.

**Scenery:** the factory floor, the belt texture, the machine livery, the hazard
banding, the conduit trunks and spurs, the stanchion line, the crates, drums and
cable drums, and the ground cover outside the slab. The machines are there so
the mechanism has somewhere to happen. Treat the floor as an illustration and
the panel as the lesson.

## What the floor shows you without reading anything

Every machine carries the one mechanism that makes it recognisable, driven by the
same state the panel reads — so the plant is legible at a glance:

- **ec-gateway** — an intake press, and the one machine so far rebuilt to the
  standard the rest are heading for. A lattice mast off the west end is the
  archive, which is off-platform and so is the only structure on the floor rather
  than a machine. Four intake lines run from it into a manifold, and a 25-lamp
  matrix on the casing is `max-allowed-concurrency: 25` — lamps light as byte
  ranges go on the wire, fill, and go round again for a second wave on a document
  over 125 MB. The chunks stack on the anvil as a laminated billet whose height
  is the document's size, the ram comes down, and what survives is a wafer 12% as
  thick: the body and attachments go down a chute into a bin labelled as such, in
  front of the machine, because throwing away 88% of the mass *is* the station.
  The wafer is tagged and dropped through a floor hatch — the put into the
  Conduct bucket — while a ledger printer lays down one row per communication and
  a pickup head over the strip reads the newest one off it, which is Debezium.
  The standpipe at the east end holds the ingest watermark `ec-centralised-audit`
  later reconciles against. Everything on the readout is `model.js` output: drag
  **Doc** and the chunk plan, the billet and the numbers all change together.
- **ec-queue-qualifier** — a plate comparator, and the second machine rebuilt to
  the standard. The document is *read*, not consumed: it stays in S3, a reel
  pays out a strip and a scanner arch pops the participant ids off it into a tag
  frame. The frame presses against the **frozen plate** —
  `pipeline-entity-mapping_{windowToken}`, a photograph of who was under
  surveillance when the window opened — bolted in and stamped with its token.
  What passes drops into one bin per pipeline; what does not goes to a bin
  marked *not in population*, because those ids are not so much rejected as
  never returned by the single indexed query. **People** drives all of it and
  deliberately does not move the bar chart: one indexed query costs the same
  whatever the length of the `$in` list. Drag People to zero and the plate goes
  dark, the verdict goes amber, and the carrier takes the not-qualified exit
  straight to audit — a documented flow that was previously unreachable.

- **ec-surveillance-filter** — a screening line with two screens in series, and
  the order is the whole point: ignore policies are numbered **1** and bolted in
  front of flag policies numbered **2**, because reordering them silently
  changes results. One carrier per claiming pipeline runs the lane, because this
  is the first station that does N things rather than one. What screen 1 catches
  drops out there and is never offered to screen 2 at all; what screen 2 catches
  continues east on the qualified rail; what neither catches is NOT_QUALIFIED.
  The bin below has two compartments and one topic — FILTERED and NOT_QUALIFIED
  are different reasons that both publish to `…not-qualified`, which the quota
  manager consumes for accounting only. Three cartridges stamped with the window
  token stand in the config bay beside the S3 riser, and both supply lines light
  on the same stroke because the config load and the chunked document fetch run
  concurrently. Drag **Ignore%** to 100 and nothing qualifies: the record skips
  evaluation entirely and is counted at the gate.

- **ec-surveillance-policy-evaluator** — a router and a timekeeper, and it
  never judges content itself. A splitter sends metadata-answerable verdicts
  north to a local bench, where they are decided in milliseconds and stamped
  into Cognition's own response shape — the platform manufactures the reply it
  would otherwise have waited for. Everything needing the message body goes
  south to CIMS dispatch and up the mast to the Cognition island off the north
  edge of the floor. Then the point of the whole station: a **wait rack**, one
  slot per pending content evaluation, each filling against a hard red line at
  `COMS_TIMEOUT_MS` — 9 000 000 ms, about two and a half hours. At the default
  45-second round trip the slots are slivers under a line that looks absurdly
  far away, which is exactly the shape of the problem: everything before this
  station is milliseconds of local work, and this one step is the only latency
  the platform's own code does not bound. Responses come back on their own line
  — `samplingTopic_k8s`, not the belt — through a **V3 gate**, because a non-V3
  run mode is dropped by design. Drag **Cognition** past the ceiling and the
  slots fill through the red line into the `no-coms-timedout` bin: audited, not
  lost, but never sampled.

- **ec-surveillance-quota-manager** — the sorting gate, and now on the north
  side of the belt with the rest of the upstream row: it is the one station the
  carrier is diverted *at*, so it should be the last thing on the floor fighting
  the conveyor for depth. The machine is built around the three facts that make
  the decision what it is. **One counter**: `redis.incr` is atomic, so up to
  thirty-two replicas share a single number instead of each keeping their own —
  the drive shaft running from the replica rack down into the register head is
  that fact, every can on the roof turning the same wheel. **Two conditions**:
  quota room *and* hash admission, as two latches in series, either one shut
  sending the record down the not-sampled chute — the hash is why *this* message
  and not that one at identical settings. **Three outcomes**, and the order
  matters: the sampling profile's participant filters run *before* the counter
  and return early, so an ignored record never spends quota, and its chute is
  upstream of the register for exactly that reason. In between, a bucket keyer
  of four tumblers — pipeline, population, direction, hour — because a quota is
  not global; the key names which of thousands of counters gets incremented.
  This service publishes nothing directly, so it gets a **three-track ledger and
  a pickup head** rather than an outfeed arm: `…surveilled-communication-outbox`,
  `…metadata-outbox` and `…quota-windows`, the last of which is what rotates the
  window token every other machine stamps on its work. Run all three trips at
  the same settings and watch the counter barely move while the hash decides
  differently each time: sampled, then `random.not-sampled`, then `ignored`.
- **ec-alerting-service** — an assembly bench, because an alert is *assembled*
  rather than recorded. Four feeds arrive at once and each is coloured for where
  it comes from: the message body from S3, and three REST calls to other
  machines on this floor — populations from the qualifier, policy detail from
  the filter, scenario hits from EA Storage. Because they run in parallel the
  station pays for the **slowest** of the four rather than their sum, and which
  one that is flips with document size: drag **Doc** and watch the bottleneck
  move from the REST calls to the S3 body. The bench builds one SupervisedItem
  per sampled pipeline, and then **two presses fall together** — the item store
  and the alert outbox, written in parallel, which is exactly why a partial
  failure can leave an item nobody was told about. The outbox is the source of
  truth for publication and it is the press marked as such. Echo verdicts come
  back *against* the flow along the south apron to re-stamp items already on the
  rack. And on its apron is a duct pad with a blanking plate bolted over it:
  this is the one belt machine that emits no audit event at all.
- **ec-echo-engine** — a card-index comparator, and what it *doesn't* do is
  half the point. A batch of ten arrives and is grouped into thread lanes, one
  worker each, so a thread's alerts are handled in order. The policy-hit tags
  are **sorted** and then hashed — sorted, because the same hits in a different
  order must give the same 32 characters — and the body port beside the press is
  **capped**, because this machine never opens the document. The card goes into
  the file **before** the comparison runs, not after, and that ordering *is* the
  failure mode: a crash between the two leaves a candidate with no action, and
  the next alert on the thread still suppresses correctly. Then three lamps,
  not two — nothing earlier and it is new; something earlier and this alert
  closes; something **later** and the alert already published gets reclassified
  instead. It has an intake bay and no outfeed, because it publishes nothing to
  the line: the answer travels back east to alerting against the flow, and the
  receipt goes down the trench.
- **ec-indexer** — a bulk press, and the whole trade is on the front of it. A
  collector hopper fills toward fifty behind a sight glass with a red mark at
  the top, and the ram fires **only** when it is full: most communications cost
  this station nothing and every fiftieth pays for all fifty — watch the bar
  chart jump from 33 ms to 89 ms on the trip that lands on 50. The document is
  fetched from S3 a *second* time here, with the same `FileChunkingStrategy` the
  gateway uses, ported verbatim — which is why the same 25-lamp concurrency
  matrix appears on both machines. Audio calls get a second child document
  beside the parent. And beside the press is a **retry siding**: a poison record
  in a batch of fifty is retried alone, parked on its own rails while the other
  forty-nine go through, because batching buys throughput at the cost of blast
  radius and per-record fate is what limits it. Its replica rack tops out at
  five, the lowest ceiling on the floor — Elasticsearch is the thing you cannot
  scale by adding consumers.
- **ec-centralised-audit** — eight fan-in chutes lighting in turn, a ledger slab
  per receipt, and two reconciliation columns side by side with a lamp that is
  green only while the counts agree.
- **ec-reporting** — four window-token bins with the live one filling, and the
  fifteen-minute ShedLock cron sweeping.

**Every machine reports, and you can watch it.** Each decision produces a
receipt, and the receipts are the platform's real product — the thing that lets
it prove, months later, what it did with every message. They travel *below the
floor*: a receipt drops through a hooded duct on the machine's apron into a
recessed trench, runs along a common spine with the other machines' receipts,
and rises into `ec-centralised-audit` in the middle of the loop. The trench
passes under the belt, which is the only reason a network can reach the middle
of the floor from both sides of the line. Three runs go the other way, overhead
at roof height: the watermark query back to the gateway, and the window
reconciliation out to reporting and the quota manager. Nothing on this network
moves unless a machine is reporting — the floor is dark until a decision is
made, and then you watch the receipt travel.

Seven of the eight belt machines have a line. **`ec-alerting-service` has none**,
because it produces no audit event at all; its accounting arrives second-hand
through echo and the indexer. That absence is meant to be visible.

**The belt is not one pipe.** Every stretch of it between two machines is a
different Kafka topic, and the name is painted on the floor beside it, verbatim
from the channel table: `supBulkIndexingTopic_k8s` into the gateway,
`ec.surveillance-gateway.outbox.{tenant}.ingestedCommunication` out of it, then
`…qualifications`, `…evaluations`, `…surveilled`,
`…surveilled-communication-outbox`, `…alertedCommunication`,
`ec.centralized.{tenant}.audit`. Zoom in and you can read where you are.

**Machines stand back from the belt, and the gap is doing something.** A service
does not sit on a topic — it consumes a message from one, works, and produces a
different message to a different one. So each machine reaches the line through a
**transfer bay**: a gravity roller table from its casing to just short of the
belt, with an inserter at the end whose arm reaches south-*west* to the upstream
segment on an intake bay and south-*east* to the downstream one on an outfeed
bay. Two arms, two differently named stretches of floor, and the topic change is
something you watch rather than something you read. The table is also where the
**queue** stands: consumer lag against that service's own threshold, as physical
blocks that go red when the threshold is passed — the same fact the replica rack
on the roof is about to react to.

**KEDA replica stacks** sit on the machine roofs: a cylinder per replica, green
at the three-replica floor and red — with a pulsing lamp — once that consumer is
over its own lagThreshold. The phase chart carries the same numbers, but the
stacks tell you *where* the platform is straining without reading a thing. They
are drawn from inside the depth-sorted pass and mounted on the roof rather than
on the apron, because the apron is where the carrier passes.

**The carrier accumulates.** It leaves the gateway having lost most of its mass —
the body is stripped, and the payload block visibly shrinks — and everything
after that is verdicts attaching to a smaller object: a tag per matched pipeline
(grey out of the qualifier, amber once the filter has ruled), a Cognition antenna
while content policies are still out, a green or red sampling stamp, a crate per
alert, an echo badge, an index chip, and the audit receipts. On the short route
the crates and the chip never appear — and you can see that they didn't.

## The stations

| # | Machine | What happens |
|---|---------|--------------|
| 1 | `ec-gateway` | Downloads the full JSON from S3 in parallel byte-range chunks, strips the message body, writes metadata plus one audit ledger row |
| 2 | `ec-queue-qualifier` | Intersects the participant list with a frozen snapshot of who was under surveillance when the window opened |
| 3 | `ec-surveillance-filter` | Ignore policies first, then flag policies — suppression always wins, per pipeline |
| 4 | `ec-surveillance-policy-evaluator` | Metadata questions answered in milliseconds; content questions sent to Cognition and awaited asynchronously |
| 5 | `ec-surveillance-quota-manager` | **The sorting gate**, and the one station on the turn. One atomic Redis INCR decides whether a human will ever read this |
| 6 | `ec-alerting-service` | Four enrichments fetched in parallel, written as a durable `supervised_item` a reviewer will see |
| 7 | `ec-echo-engine` | An MD5 of the sorted policy hits against 14 days of thread history — so a long thread raises one alert, not thirty |
| 8 | `ec-indexer` | Fills a batch of 50 and flushes it to Elasticsearch as a single bulk request |

And two that are **not** stations, standing inside the loop the belt makes,
because the communication never travels to either of them:

| Machine | What happens |
|---------|--------------|
| `ec-centralised-audit` | Stitches every verdict into one record per communication and reconciles the count against the gateway's watermark. Seven of the eight belt machines send it a receipt; `ec-alerting-service` is the exception |
| `ec-reporting` | Counts audit events into window-suffixed collections the monthly regulator report reads |

The six side structures are on the same floor and carry the same write-ups:
`ec-config-curator`, `ec-manual-runs-service`, `ec-review-service`,
`ea-ui-portal`, `ep-conduct-external-api` and `conduct-actioning-service`.

## The two loops worth following

Two write relationships cross service boundaries, and both of them are failure
modes rather than features. `ec-alerting-service` creates the `supervised_item`
document and `ec-indexer` creates the Elasticsearch review document; months
later `conduct-actioning-service` mutates **both** when a reviewer dispositions
the alert. That write is not transactional, so a failure between the two stores
leaves an item closed in MongoDB and open in search — where it ages, forever,
into higher buckets of the monthly compliance CSV, a downstream report this
floor does not depict.

The other is quieter: `conduct-actioning` resolves its tier topic names from
deployment properties at runtime, and a misconfigured property publishes a
reviewer's decision to a topic nobody consumes. There is no dead-letter topic on
that path. The reviewer sees the action accepted; it is never applied.

## Controls

- **Space** play / pause · **S** advance one station · **R** reset and replay the
  tour · **F** follow camera · **L** labels · **Esc** close the About modal
- Drag to pan, scroll to zoom, click any machine or side structure for its
  write-up. **⊡** pulls back to the whole floor.
- **Ingest** (1–200/s), **Doc** (1 KB–5 MB), **Content%** (share of policies
  needing the message body), **Sample%**, **Fail%** and **Pipes** (1–8
  surveillance pipelines), plus a **KEDA ON/OFF** toggle. All six feed the model.

The first time the carrier reaches a machine it holds long enough to read that
machine's write-up — 9 to 26 seconds, scaled to the length of the text, with a
progress bar under the panel. Once every machine has been explained there is
nothing new to read, so the line runs at a watchable pace instead of a readable
one. Three communications run in a row; **Reset** (↺) replays the slow tour and
**✦** replays the narration alone.

## Layout

```
knowledge/
  system-explainer-input.md   the source of truth: 21 repos, channels, flows
src/
  index.html        markup, controls, the About modal with the fidelity ledger
  css/styles.css    UI chrome (topbar, hud, zoomer, inspector, modal, tokens)
  css/dock.css      the dock's own styles — see js/dock.js
  js/dock.js        the dock as a reusable component, built from a spec
  js/iso.js         isometric projection and solid primitives — engine
  js/model.js       the lesson: chunking, lag, KEDA scaling, retries, latency
  js/world.js       belt route, 8 belt stations, 6 side structures, props
  js/factory.js     floor palette, ground mosaic, hazard banding, slab
  js/kit.js         the machine kit: materials, cam timing, primitives,
                    instruments, sub-assemblies every station drawer uses
  js/sim.js         the state machine walking one communication along the belt
  js/render.js      everything drawn, canvas 2D, painter's algorithm
  js/ui.js          DOM panels, narration, sliders, HUD
  js/main.js        camera, input, frame loop — engine
```

Script order in `src/index.html` matters: `iso → model → world → factory → kit
→ dock → sim → render → ui → main`.

`World.BELT` is the conveyor polyline; every machine in `World.STATIONS_FLAT`
anchors to it by `BELT.cum[i]` distance, so moving a waypoint shifts every
machine after it. Four forks in `src/js/sim.js` leave the line early — no
pipeline claims it, nothing qualifies, every content verdict ages out, not
sampled — and three of the four **end the journey where they happen** rather
than travelling anywhere: the carrier simply stops at the machine that
suppressed it. `ec-centralised-audit` and `ec-reporting` are not on the belt at
all, because they consume events *about* the communication rather than the
communication itself; they stand inside the loop the belt makes, fed by
trenches cut under the floor. That is deliberate: the reader should see the
saving as a shorter journey, not just a smaller number.

One layout rule before moving anything: in this projection a structure at
`(mx, my)` hides the belt point at `(mx, by)` when half its footprint,
`(w + d) / 2`, exceeds its setback `my - by`. Anything closer to the belt
swallows the carrier you are meant to be watching.

## Where the content comes from

Every write-up, constant and flow on this floor traces to
`knowledge/system-explainer-input.md` — the channel tables and connectivity
audit in Sections 2a–2g, one section per repository, and Flows A–H. Flows A and B
are the belt; C through H are what the side structures illustrate. Change the
model and the narration together, and keep the fidelity ledger in the About modal
in step with the header of `src/js/model.js`.

## Verifying a change

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
(`npm i -D playwright && npx playwright install chromium`); without it, open
`src/index.html` and watch a full run.

## Credit

Built with the `isometric-explainer` skill. A companion piece to
[Rocket Engine Works](https://github.com/LaurentiuGabriel/rocket-engine), which
lays out a liquid rocket engine the same way. Visually indebted to Factorio's
industrial iconography — belts, hazard banding, machine palette — but no game
assets are used and none of it is traced.
