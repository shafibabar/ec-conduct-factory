# Phase 1: Inspection Summary — Communication Package Transformation

**Date:** 2026-08-21  
**Status:** Complete (read-only investigation + clarifying comments added)  
**Next Phase:** Phase 2 — Sim.state enrichment and packageState tracking

---

## 1. Current Package Model

### 1.1 State Container: `Sim.state`

**Location:** `src/js/sim.js:26–108`

The package is NOT a separate object. It is the aggregate of fields in `Sim.state`:

```
Sim.state
  ├── Vehicle state (the "package" properties)
  │   ├── bytesDownloaded, bytesAfterMinify       (gateway output)
  │   ├── matchedEntities, pipelineIds            (qualifier output)
  │   ├── filtered, qualified, notQualified       (filter outputs)
  │   ├── sentToCognition, comsRttMs, comsTimedOut (evaluator outputs)
  │   ├── quotaUsed, quotaLimit, sampled          (quota outputs)
  │   ├── alertsCreated                           (alerting output)
  │   ├── fingerprint, isEcho                     (echo outputs)
  │   ├── batchPosition, bulkBytes, bulkFlush     (indexer outputs)
  │   └── ... 50+ vehicle fields tracking the communication's journey
  │
  ├── Audit tracking
  │   ├── auditEvents                  (total receipts filed)
  │   ├── auditIngested                (gateway watermark)
  │   ├── auditCompleted               (reconciliation count)
  │   └── pipesTerminal                (how many pipelines at terminal outcome)
  │
  ├── Control flow
  │   ├── running, paused, finished
  │   ├── station, stationT
  │   └── stepMode
  │
  ├── Timing
  │   ├── reading                      (reading stop active)
  │   ├── dwellLeft, dwellTotal        (dwell countdown)
  │   └── latencyMs                    (end-to-end time)
  │
  └── Computed state
      ├── plan                         (full EC.compute() result)
      └── charged                      (which stations have fired this trip)
```

**Key insight:** The package is **immutable in identity but mutable in properties**. It gains fields as it travels; it never changes identity.

### 1.2 Physical Carrier: `van` object

**Location:** `src/js/sim.js:111–115`

```js
var van = {
  dist: 0,                            // distance along World.BELT
  dwell: 0,                           // counting down during reading stop
  stationIdx: 0                       // index into World.STATIONS_FLAT
};
```

The `van` tracks position on the belt. `Sim.vanPosition()` returns isometric coordinates.

### 1.3 Charging Flow: `charge(id)`

**Location:** `src/js/sim.js:148–209`

When the carrier reaches a station:

1. `fire(st)` calls `charge(st.id)`
2. `charge()` calls `EC.compute()` to get the current plan
3. Based on `id`, it copies vehicle state from `state.plan.vehicle` into `Sim.state`
4. Example: `charge('gateway')` sets `bytesDownloaded` and `bytesAfterMinify`

**Current behavior:** State changes are **instant**. The field is 0, `fire()` happens, the field is now the new value.

**Needed for transformation:** Interpolate between old and new values **during the dwell** (reading stop).

---

## 2. Current Rendering: `drawCarrier(vanPos, s)`

**Location:** `src/js/render.js:3239–3337`

Renders the package as a collection of geometric parts:

| Part | Current Logic | Transformation Needed |
|------|---------------|----------------------|
| **Payload block** | Instant size/color change when `done.gateway` | Lerp dimensions & color over dwell |
| **Pipeline tags** | Instant height/color change when `done.filter` | Lerp height & color over dwell |
| **Cognition pending** | Flashing disc when `done.evaluator && sentToCognition > 0` | Pulsing animation, already good |
| **Sampling stamp** | Instant disc color (green/red) when `done.quota` | Lerp in over dwell |
| **Alert crates** | Instant appearance when `done.alerting` | Lerp in over dwell |
| **Echo verdict** | Instant disc color when `done.echo` | Lerp in over dwell |
| **Index chip** | Instant appearance when `done.indexer` | Lerp in over dwell |
| **Audit receipts** | Stacked boxes when `done.audit` | *Separate from package, not here* |
| **Latency gauge** | Continuous color change (good) | Keep as-is |

**Current state markers:** Only checks `s.charged[id]` (has this station fired?). Binary: yes or no.

**Needed:** `s.packageState` to track which transformation stage the package is in.

---

## 3. Station-to-Package Transformation Mapping

Based on `sim.js` and the system-explainer:

| Station | state.charged key | Fire() calls charge() | Audit receipt(s) | New packageState |
|---------|-------------------|----------------------|------------------|------------------|
| gateway | `'gateway'` | Updates bytesDownloaded, bytesAfterMinify | 1 | INGESTED |
| qualifier | `'qualifier'` | Updates matchedEntities, pipelineIds, windowToken | 1 | QUALIFIED |
| filter | `'filter'` | Updates filtered, qualified, notQualified, allSuppressed | 1 or pipelineIds | EVALUATED |
| evaluator | `'evaluator'` | Updates sentToCognition, comsRttMs, comsTimedOut | 1 | SURVEILLED |
| quota | `'quota'` | Updates quotaUsed, quotaLimit, sampled | 1 | SAMPLED |
| alerting | `'alerting'` | Updates alertsCreated, enrichS3Ms, enrichRestMs | **0 (no audit!)** | ALERTED |
| echo | `'echo'` | Updates fingerprint, isEcho, echoPriors, echoOutcome | 1 | ECHO_EVALUATED |
| indexer | `'indexer'` | Updates batchPosition, bulkBytes, bulkFlush, esIndexName | 1 or 50 (if bulkFlush) | INDEXED |
| — | — | — | — | — |
| **Terminal forks** | — | applyXxxGate() → endRunHere() | ≥1 each | TERMINATED |

**Terminal fork conditions:**
- **B1 (not-qualified):** `pipelineIds === 0` at qualifier → ends there
- **B2 (all-suppressed):** `allSuppressed === true` at filter → jumps to quota
- **C (coms-timedout):** `evaluatorStalled === true` at evaluator → ends there
- **B3 (not-sampled):** `sampled === false` at quota → ends there

---

## 4. Dwell Timing: The Transformation Window

**Location:** `src/js/sim.js:436–481` (update loop)

When a station fires:

```
fire(st)                          // charge() updates state
  ↓
applyXxxGate()                    // check for terminal forks
  ↓
van.dwell = World.readSeconds(st.id)  // ~2–3 seconds on first visit
state.reading = true              // narration panel shows description
state.dwellTotal = van.dwell      // track total dwell
state.dwellLeft = van.dwell       // decrement each frame
  ↓
[dwell loop — van.dwell > 0]      // each frame: van.dwell -= dt * speed
  ↓
paint(drawCarrier, etc.)          // render each frame with current state
  ↓
[dwell expires — van.dwell <= 0]  // transit pauses, resume travel
```

**Key timing values:**
- `World.readSeconds(id)` — dwell duration for first visit (narration pause)
- `van.dwell` — countdown timer
- `state.dwellLeft / state.dwellTotal` — normalized dwell progress (0–1 descending)

**Transformation timing:** Lerp should use `1 - (state.dwellLeft / state.dwellTotal)` to get progress 0→1 over the dwell.

---

## 5. Audit Receipts: Off-Belt Traffic

**Location:** `src/js/sim.js:293–304`

```js
var AUDIT_RECEIPTS = {
  gateway:   1,                         // 1 receipt per trip
  qualifier: 1,
  filter:    pipelineIds,               // 1 per pipeline at this station
  evaluator: 1,
  quota:     1,
  alerting:  0,    ← KEY: no audit event from alerting!
  echo:      1,
  indexer:   bulkFlush ? 50 : 1         // 50 if this is the batch-flush
};
```

**Current:** Receipts are just counters (`state.auditEvents += ...`). They don't render anywhere on the belt.

**Needed (Phase 4):** When a receipt count increments, emit a pulse through `World.RELAY`:
- Seven trench runs carry receipts from gateway, qualifier, filter, evaluator, quota, echo, indexer → tower
- Three overhead tube runs carry reconciliation traffic back out
- Each pulse is a glowing object following the trench/tube path

**Alerting note:** Alerting does NOT file an audit receipt. Its accounting comes second-hand via echo and indexer.

---

## 6. Terminal States and Forks

**Location:** `src/js/sim.js:375–410`

Four forks end the journey early:

```
applyQualifierGate()          // B1: pipelineIds === 0 → endRunHere()
applyFilterGate()             // B2: allSuppressed → jump to quota
applyEvaluatorGate()          // C:  evaluatorStalled → endRunHere()
applyGate()                   // B3: sampled === false → endRunHere()
```

**`endRunHere()` behavior:** Sets `van.stationIdx = World.STATIONS_FLAT.length`, causing the carrier to stop at the current station and end the trip on the next tick.

**Rendering implication:** When a fork is taken, `drawCarrier()` should render a **visual diversion path** at that machine:
- B1 at qualifier: chute or exit portal
- B2 at filter: divert arm to quota (not a visual diversion, just jumps)
- C at evaluator: chute or exit portal
- B3 at quota: chute or exit portal

---

## 7. World.RELAY: Audit Trench and Tube Network

**Location:** `src/js/world.js` and `knowledge/FLOOR-TOPOLOGY.md`

Seven trench runs from machines to tower:
- `gateway` → north spine
- `qualifier` → north spine
- `filter` → north spine
- `evaluator` → north spine
- `quota` → east face of tower
- `echo` → south spine
- `indexer` → south spine

**Alerting:** No trench (no audit receipts).

Three overhead tube runs from tower:
- Watermark query back to gateway
- windowReconciliation to reporting
- windowReconciliation to quota-manager

**Gating:** Pulses fire when `state.auditEvents` increments, gated on the machine's own cam.

---

## 8. Key Code Sections to Modify

### Phase 2: Sim.state enrichment

```
src/js/sim.js
  Line 26–108:  state object definition
  Line 213–268: beginTrip() initialization
  Line 148–209: charge(id) — add packageState update here
  Line 339–357: fire(st) — track which state to transition to
```

### Phase 3: drawCarrier() transformation

```
src/js/render.js
  Line 3239–3337: drawCarrier(vanPos, s)
  Line 3260–3267: payload block — needs lerp
  Line 3270–3279: pipeline tags — needs lerp
  Line 3291–3294: sampling stamp — needs lerp
  Line 3296–3303: alert crates — needs lerp
  Line 3305–3309: echo verdict — needs lerp
  Line 3311–3314: index chip — needs lerp
```

### Phase 4: Audit receipt pulses

```
src/js/kit.js
  pulse() function — already exists, used by trench/tube runs

src/js/render.js
  drawTrenches() — render trench network
  drawTubeRuns() — render overhead tubes
  Both already exist in depth-sorted pass

src/js/sim.js
  fire() — emit pulse when AUDIT_RECEIPTS increments
  Need to call World.RELAY route and Render.pulse()
```

### Phase 5: Machine intake/outtake tweaks

```
src/js/render.js
  Draw functions for individual machines:
  - drawGateway()
  - drawQualifier()
  - drawFilter()
  - drawEvaluator()
  - drawQuota()
  - drawAlerting()
  - drawEcho()
  - drawIndexer()

  Add small mechanical intake/outtake elements to each, synced with cam timing.
```

---

## 9. Clarifying Comments Added

During Phase 1, the following files received explanatory comments (no logic changes):

- `src/js/sim.js`
  - AUDIT_RECEIPTS map (line 291–305)
  - charge() function (line 148)
  - fire() function (line 339)
  - Terminal forks section (line 375)
  - update() dwell logic (line 445)

- `src/js/render.js`
  - drawCarrier() header (line 3239)
  - Payload block transformation (line 3256)
  - Pipeline tags transformation (line 3268)

All comments explain current behavior and flag where transformations need to happen.

---

## 10. Design Constraints & Depth-Sort Rules

From `FLOOR-TOPOLOGY.md §3`:

**Depth sorting:** Painter's algorithm, one pass sorted on `x + y`:
- **North of horizontal belt (y < 8)** → safe to draw, will be painted over
- **West of vertical belt (x < turnpoint)** → safe to draw, will be painted over
- **South of horizontal belt** → only safe if setback > half-footprint; otherwise occludes carrier

**Tower height budget:** At y 20, max height 9.6 units before occlusion.

**Screen directions:**
- South is *left* on screen
- East is *brighter* of the two visible side faces (0.80 vs 0.58)
- Overhangs on south face hide casing to the *west*

---

## 11. Testing & Verification Points

### Smoke test (verify nothing broke)
```bash
cd src && for f in js/*.js; do node --check "$f"; done
node ../.claude/skills/isometric-explainer/scripts/smoke.mjs http://localhost:8000/
```

### Idle diff (verify no animation leaks)
```bash
node scratchpad/idle2.mjs    # 0 changed pixels when paused, belt stubbed
```

### Fork reachability
```bash
node scratchpad/branch2.mjs  # All four forks still reachable
```

### Dwell timing verification
```
1. Open in browser
2. Watch station dwell pauses — should match narration block duration
3. On second trip (fastForward mode), dwells should be ~0.5s
4. Space key should extend reading stop; Y/N should end it
```

---

## 12. Next Steps: Phase 2

Add to `Sim.state`:

```js
packageState: 'RAW',     // one of RAW, INGESTED, QUALIFIED, EVALUATED, 
                         //        SURVEILLED, SAMPLED, ALERTED, 
                         //        ECHO_EVALUATED, INDEXED, TERMINATED
packageT: 0              // elapsed time in current transformation (0-1)
```

Update in `charge()`:

```js
// At the end of charge(id), set packageState based on id:
if (id === 'gateway')   state.packageState = 'INGESTED';
if (id === 'qualifier') state.packageState = 'QUALIFIED';
// ... etc
```

In `drawCarrier()`:

```js
// Compute lerp parameter:
var lerp = s.dwellTotal ? (s.dwellTotal - s.dwellLeft) / s.dwellTotal : 1;

// For each part, interp between old and new values using lerp
```

---

## Appendix: State Field Reference

| Field | Updated by | Meaning | Range |
|-------|-----------|---------|-------|
| `bytesDownloaded` | gateway | S3 chunk size | 0–512000 |
| `bytesAfterMinify` | gateway | After compression | 0–512000 |
| `matchedEntities` | qualifier | Participants in monitored population | 0–500 |
| `pipelineIds` | qualifier, filter | Pipelines claiming this | 0–8 |
| `filtered` | filter | Count of pipelines suppressed by ignore policy | 0–8 |
| `qualified` | filter | Count matched by flag policy | 0–8 |
| `notQualified` | filter | Count unmatched by flag policy | 0–8 |
| `allSuppressed` | filter | All pipelines filtered out? | bool |
| `sentToCognition` | evaluator | Count needing message body | 0–8 |
| `comsRttMs` | evaluator | Cognition round-trip latency | 0–9000000 |
| `comsTimedOut` | evaluator | Cognition timed out? | bool |
| `quotaUsed` | quota | Communications in current quota bucket | 0–quota |
| `quotaLimit` | quota | Quota window size | 100–10000 |
| `sampled` | quota | Passed sampling decision? | bool |
| `alertsCreated` | alerting | Count of SupervisedItem documents | 0–8 |
| `fingerprint` | echo | Echo comparison fingerprint | string (hex-like) |
| `isEcho` | echo | Duplicate within TTL? | bool |
| `batchPosition` | indexer | Position in current bulk batch (1–50) | 1–50 |
| `bulkFlush` | indexer | Is this the flush batch? | bool |
| `latencyMs` | all stations | Cumulative end-to-end latency | 0–120000 |

---

**Phase 1 complete.** Ready for Phase 2: Sim.state enrichment and packageState tracking.
