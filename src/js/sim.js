/* sim.js: EC Factory state machine — walks one communication along the belt.
 *
 * Three ideas do all the work:
 *   1. The carrier moves along the belt route by distance; stations fire on arrival.
 *   2. The FIRST time a station fires, the carrier stops for a reading stop.
 *   3. What the reader has already read lives outside the run state (tour object).
 *
 * Four forks leave the line early — at the qualifier, the filter, the
 * evaluator and the quota gate. Three of them end the journey where they
 * happen; the filter's sends the record on to the quota manager, which really
 * does consume it, for accounting only. Nothing travels to
 * ec-centralised-audit: it is off the belt and it consumes events about the
 * communication, not the communication.
 */
(function (global) {
  'use strict';

  var EC    = global.EC;
  var World = global.World;
  var Iso   = global.Iso;

  var BASE_SPEED = 5.5;   // grid units / second at 1×

  var tour = { seen: Object.create(null), done: false };

  var state = {
    running: false,
    paused: true,
    finished: false,

    station: null,
    stationT: 0,
    stepMode: false,
    speed: 1,

    /* ---- model inputs (wired to sliders in ui.js) ---- */
    ingestRate:        50,
    avgDocSizeKb:      512,
    participants:      100,
    ignoreShare:       15,
    contentPolicyShare: 40,
    cognitionRttMs:    45000,
    samplingPercent:   10,
    failureRate:       2,
    autoscaling:       true,

    /* ---- vehicle state (the lesson, carried by the communication) ---- */
    bytesDownloaded:  0,
    bytesAfterMinify: 0,
    matchedEntities:  0,   // participants found in the monitored population
    pipelineCount:    2,   // the Pipes selector: pipelines configured
    pipelineIds:      0,   // pipelines that actually claimed this one
    windowToken:      '',
    filtered:         0,   // an ignore policy matched
    qualified:        0,   // a flag policy matched
    notQualified:     0,   // neither did
    allSuppressed:    false,
    metadataOnly:     0,   // answerable without the message body
    comsRttMs:        0,   // what Cognition actually took
    comsTimedOut:     false,
    evaluatorStalled: false,
    sentToCognition:  0,
    comsWaitMs:       0,
    quotaUsed:        0,
    quotaLimit:       0,
    sampled:          false,
    alertsCreated:    0,
    enrichS3Ms:       0,   // the four enrichments run in parallel, so the
    enrichRestMs:     0,   // station costs the slowest of them, not the sum
    enrichMs:         0,
    enrichSlowest:    '',
    fingerprint:      '',
    isEcho:           false,
    echoPriors:       0,    // prior alerts on this thread inside the TTL
    echoOutcome:      '',   // new / echo-closed / late-arrival
    batchPosition:    0,
    bulkFlush:        false,  // is this the fiftieth, the one that pays
    bulkFailed:       0,      // of the fifty, how many are retried alone
    esIndexName:      '',
    isAudio:          false,
    bulkBytes:        0,
    auditEventsEmitted: 0,

    /* ---- the record keeper's own books ----
     * ec-centralised-audit left the belt, so charge() never runs for it. These
     * are kept by the simulation instead, which is the truer arrangement: they
     * are properties of the RUN, not of the communication on the belt. */
    auditEvents:    0,    // receipts filed, all machines, all trips
    auditIngested:  0,    // the gateway's watermark
    auditCompleted: 0,    // ledgers marked complete
    pipesTerminal:  0,    // pipelines of THIS communication at a terminal outcome
    reconT:         0,    // the reconciliation cron, counting down
    latencyMs:        0,

    /* ---- what this run has computed per station ---- */
    charged:   null,   // stationId -> workMs
    plan:      null,   // full EC.compute() result

    /* ---- pacing ---- */
    reading:    false,
    dwellLeft:  0,
    dwellTotal: 0,
    fastForward: false,
    tourDone:   false,

    /* ---- trip counter ---- */
    trips:     0,
    maxTrips:  3
  };

  var van = {
    dist: 0,
    dwell: 0,
    stationIdx: 0    // index into World.STATIONS_FLAT
  };

  var listeners = [];
  function emit(name, payload) {
    for (var i = 0; i < listeners.length; i++) listeners[i](name, payload);
  }

  /* ---- model ------------------------------------------------------------ */

  function planNow() {
    return EC.compute({
      ingestRate:         state.ingestRate,
      avgDocSizeKb:       state.avgDocSizeKb,
      participants:       state.participants,
      ignoreShare:        state.ignoreShare,
      pipelineCount:      state.pipelineCount,
      cognitionRttMs:     state.cognitionRttMs,
      trip:               state.trips,
      contentPolicyShare: state.contentPolicyShare,
      samplingPercent:    state.samplingPercent,
      failureRate:        state.failureRate,
      autoscaling:        state.autoscaling
    });
  }

  function phaseOf(plan, id) {
    if (!plan) return null;
    for (var i = 0; i < plan.phases.length; i++) {
      if (plan.phases[i].id === id) return plan.phases[i];
    }
    return null;
  }

  function charge(id) {
    state.plan = planNow();
    var ph = phaseOf(state.plan, id);
    var ms = ph ? ph.workMs + ph.queueMs : 2;
    state.charged[id] = ms;
    state.latencyMs += ms;
    var v = state.plan.vehicle;
    if (id === 'gateway')   { state.bytesDownloaded = v.bytesDownloaded; state.bytesAfterMinify = v.bytesAfterMinify; }
    if (id === 'qualifier') {
      state.matchedEntities = v.matchedEntities;
      state.pipelineIds     = v.pipelineIds;
      state.windowToken     = v.windowToken;
    }
    if (id === 'filter') {
      state.filtered      = v.filtered;
      state.qualified     = v.qualified;
      state.notQualified  = v.notQualified;
      state.allSuppressed = v.allSuppressed;
    }
    if (id === 'evaluator') {
      state.sentToCognition  = v.sentToCognition;
      state.metadataOnly     = v.metadataOnly;
      state.comsWaitMs       = v.comsWaitMs;
      state.comsRttMs        = v.comsRttMs;
      state.comsTimedOut     = v.comsTimedOut;
      state.evaluatorStalled = v.evaluatorStalled;
    }
    if (id === 'quota') {
      state.quotaUsed      = v.quotaUsed;
      state.quotaLimit     = v.quotaLimit;
      state.sampled        = v.sampled;
      state.quotaRoom      = v.quotaRoom;
      state.hashBucket     = v.hashBucket;
      state.hashAdmits     = v.hashAdmits;
      state.profileIgnored = v.profileIgnored;
      state.quotaEvent     = v.quotaEvent;
      state.bucketKey      = v.bucketKey;
      state.gcid           = v.gcid;
    }
    if (id === 'alerting') {
      state.alertsCreated = v.alertsCreated;
      state.enrichS3Ms    = v.enrichS3Ms;
      state.enrichRestMs  = v.enrichRestMs;
      state.enrichMs      = v.enrichMs;
      state.enrichSlowest = v.enrichSlowest;
    }
    if (id === 'echo') {
      state.fingerprint  = v.fingerprint;
      state.isEcho       = v.isEcho;
      state.echoPriors   = v.echoPriors;
      state.echoOutcome  = v.echoOutcome;
    }
    if (id === 'indexer') {
      state.batchPosition = v.batchPosition;
      state.bulkBytes     = v.bulkBytes;
      state.bulkFlush     = v.bulkFlush;
      state.bulkFailed    = v.bulkFailed;
      state.esIndexName   = v.esIndexName;
      state.isAudio       = v.isAudio;
    }
    return ph;
  }

  /* ---- lifecycle -------------------------------------------------------- */

  function beginTrip() {
    state.charged = Object.create(null);
    state.latencyMs = 0;
    state.station = null;
    state.plan = planNow();
    state.fastForward = state.trips > 0;
    state.sampled = false;
    state.bytesDownloaded  = 0;
    state.bytesAfterMinify = 0;
    /* Seeded from the plan rather than zeroed. These three are pure functions
       of the current sliders — the qualifier's machine reads them live off its
       own readout — so zeroing them until the station fires only made the
       narration disagree with the hardware standing in front of the reader. */
    state.matchedEntities  = state.plan.vehicle.matchedEntities;
    state.pipelineIds      = state.plan.vehicle.pipelineIds;
    state.windowToken      = state.plan.vehicle.windowToken;
    state.filtered         = state.plan.vehicle.filtered;
    state.qualified        = state.plan.vehicle.qualified;
    state.notQualified     = state.plan.vehicle.notQualified;
    state.allSuppressed    = state.plan.vehicle.allSuppressed;
    state.metadataOnly     = state.plan.vehicle.metadataOnly;
    state.comsRttMs        = state.plan.vehicle.comsRttMs;
    state.comsTimedOut     = state.plan.vehicle.comsTimedOut;
    state.evaluatorStalled = state.plan.vehicle.evaluatorStalled;
    state.quotaRoom        = state.plan.vehicle.quotaRoom;
    state.hashBucket       = state.plan.vehicle.hashBucket;
    state.hashAdmits       = state.plan.vehicle.hashAdmits;
    state.profileIgnored   = state.plan.vehicle.profileIgnored;
    state.quotaEvent       = state.plan.vehicle.quotaEvent;
    state.bucketKey        = state.plan.vehicle.bucketKey;
    state.gcid             = state.plan.vehicle.gcid;
    state.enrichS3Ms       = state.plan.vehicle.enrichS3Ms;
    state.enrichRestMs     = state.plan.vehicle.enrichRestMs;
    state.enrichMs         = state.plan.vehicle.enrichMs;
    state.enrichSlowest    = state.plan.vehicle.enrichSlowest;
    state.echoPriors       = state.plan.vehicle.echoPriors;
    state.echoOutcome      = state.plan.vehicle.echoOutcome;
    state.bulkFlush        = state.plan.vehicle.bulkFlush;
    state.bulkFailed       = state.plan.vehicle.bulkFailed;
    state.esIndexName      = state.plan.vehicle.esIndexName;
    state.isAudio          = state.plan.vehicle.isAudio;
    state.sentToCognition  = 0;
    state.comsWaitMs       = 0;
    state.quotaUsed        = 0;
    state.quotaLimit       = 0;
    state.alertsCreated    = 0;
    state.fingerprint      = '';
    state.isEcho           = false;
    state.batchPosition    = 25;
    state.bulkBytes        = 0;
    state.auditEventsEmitted = 0;
    state.pipesTerminal      = 0;
    van.dist = 0;
    van.stationIdx = 0;
    van.dwell = 0;
  }

  function reset() {
    state.finished = false;
    state.trips = 0;
    state.auditEvents    = 0;
    state.auditIngested  = 0;
    state.auditCompleted = 0;
    state.reconT         = 0;
    state.tourDone = tour.done;
    state.reading = false;
    state.dwellLeft = 0;
    state.dwellTotal = 0;
    beginTrip();
  }

  function run() {
    reset();
    state.running = true;
    state.paused = false;
    emit('reset');
  }

  /* ---- per-station ops -------------------------------------------------- */

  /* One decision, one receipt — except where a station decides per pipeline, and
     except ec-alerting-service, which files none at all. */
  var AUDIT_RECEIPTS = {
    gateway:   function () { return 1; },
    qualifier: function () { return 1; },
    filter:    function (st) { return Math.max(1, st.pipelineIds); },
    evaluator: function () { return 1; },
    quota:     function () { return 1; },
    alerting:  function () { return 0; },
    echo:      function () { return 1; },
    indexer:   function (st) { return st.bulkFlush ? 50 : 1; }
  };

  /* A pipeline is terminal once its verdict cannot change again. Suppressed
     ones reach that at the filter; the rest only at the gate or the indexer.
     ledger.complete = all(p.terminal), which is why the COMPLETE stamp on the
     tower falls when the LAST row goes green and not before. */
  function terminalAfter(id) {
    if (id === 'filter')    return (state.filtered || 0) + (state.notQualified || 0);
    if (id === 'quota')     return state.sampled ? state.pipesTerminal : state.pipelineIds;
    if (id === 'indexer')   return state.pipelineIds;
    return state.pipesTerminal;
  }

  var OPS = {
    gateway:   function () { charge('gateway'); },
    qualifier: function () { charge('qualifier'); },
    filter:    function () { charge('filter'); },
    evaluator: function () { charge('evaluator'); },
    quota:     function () { charge('quota'); },
    alerting:  function () { charge('alerting'); },
    echo:      function () { charge('echo'); },
    indexer:   function () { charge('indexer'); },
    audit:     function () { charge('audit'); },
    reporting: function () { charge('reporting'); }
  };

  /* ---- update ----------------------------------------------------------- */

  function travelBoost() {
    return (state.fastForward ? 2.4 : 1) * (state.tourDone ? 3.0 : 1);
  }
  function dwellBoost() {
    return (state.fastForward ? 2.2 : 1) * (state.tourDone ? 1.4 : 1);
  }

  function fire(st) {
    state.station = st.id;
    state.stationT = 0;
    var op = OPS[st.id];
    if (op) op();

    /* the receipt this station files, and how much of the ledger it closes */
    /* AUDIT_RECEIPTS is the one counter: it used to be incremented in charge()
       when the carrier reached the audit station, which has not existed since
       the belt became a U. Both names now feed the same number — the tower
       reads auditEvents, the narration interpolates auditEventsEmitted. */
    var rec = AUDIT_RECEIPTS[st.id];
    if (rec) state.auditEvents += rec(state);
    state.auditEventsEmitted = state.auditEvents;
    state.pipesTerminal = terminalAfter(st.id);
    if (st.id === 'gateway') state.auditIngested += 1;

    emit('station', st.id);
  }

  /* End the journey here.
   *
   * This used to walk the carrier down to ec-centralised-audit, because audit
   * was the last station on the belt. It is not on the belt any more, and it
   * never should have been: audit consumes events ABOUT the communication, so
   * the communication does not travel to it. A suppressed record simply stops
   * where it was suppressed, and its receipt goes to the record keeper by a
   * route the carrier never takes.
   *
   * Leaving van.dist where it is means the carrier holds its dwell at the
   * station that stopped it — the reader watches it stop — and the trip ends on
   * the next tick, because there are no stations left to reach. */
  function endRunHere() {
    van.stationIdx = World.STATIONS_FLAT.length;
  }

  /* Fork one — Flow B1, at the qualifier: no pipeline claimed this
     communication, so pipelineIds is empty. ec-queue-qualifier publishes an
     audited not-qualified outcome and the record never reaches evaluation, so
     the journey ends at the qualifier. Reachable by dragging People to zero. */
  function applyQualifierGate() {
    if (state.pipelineIds === 0) endRunHere();
  }

  /* Fork two — Flow B2, at the filter: every pipeline was either suppressed by
     an ignore policy or claimed by no flag policy. Both verdicts publish to
     …not-qualified, which the quota manager consumes for accounting only, so
     the record skips evaluation entirely and is counted at the gate.
     Reachable by dragging Ignore% up. */
  function applyFilterGate() {
    if (state.allSuppressed) {
      var quotaIdx = World.STATION_IDX_BY_ID['quota'];
      van.stationIdx = quotaIdx;
      van.dist = World.STATIONS_FLAT[quotaIdx].dist - 0.1;
    }
  }

  /* Fork three — Flow C, at the evaluator: every qualified pipeline went out
     for content evaluation and none came back inside COMS_TIMEOUT_MS. The
     outcomes are recorded as no-coms-timedout, which is an audited result and
     not a loss, but nothing reached …surveilled so the record never reaches
     sampling. Reachable by pushing Cognition past the ceiling with Content%
     at 100. */
  function applyEvaluatorGate() {
    if (state.evaluatorStalled) endRunHere();
  }

  /* Fork four — Flow B3, at the quota manager: sampled continues to alerting,
     not sampled skips alerting, echo and the indexer. */
  function applyGate() {
    if (!state.sampled) endRunHere();
  }

  var RECON_SECONDS = 3.2;

  function endTrip() {
    /* The ledger for this communication is complete, so the record keeper has
       something to reconcile — and gets the floor. The tour used to end at
       audit because audit was the last station; it ends AT audit still, but
       now because the record is what completes at the end of every path. */
    state.auditCompleted += 1;
    state.reconT = RECON_SECONDS;
    emit('station', 'audit');

    if (state.trips >= state.maxTrips) {
      state.finished = true;
      state.paused = true;
      state.station = 'done';
      emit('station', 'done');
      return;
    }
    tour.done = true;
    state.tourDone = true;
    state.trips++;
    beginTrip();
  }

  function update(dt) {
    state.stationT += dt;
    if (state.paused) return;
    /* the cron runs on its own clock, including after the last trip */
    if (state.reconT > 0) state.reconT = Math.max(0, state.reconT - dt * state.speed);
    if (!state.running || state.finished) return;

    var sdt = dt * state.speed * travelBoost();

    if (van.dwell > 0) {
      van.dwell -= dt * state.speed;
      state.dwellLeft = Math.max(0, van.dwell);
      if (van.dwell <= 0) { state.reading = false; state.dwellTotal = 0; }
      return;
    }

    van.dist += BASE_SPEED * sdt;

    var sts = World.STATIONS_FLAT;
    if (van.stationIdx < sts.length) {
      var st = sts[van.stationIdx];
      if (van.dist >= st.dist) {
        van.dist = st.dist;
        van.stationIdx++;
        var topic = World.stationToDistrict[st.id] || st.id;
        var firstTime = !tour.seen[topic];
        fire(st);
        /* apply the gates AFTER fire, so the state they read is set */
        if (st.id === 'qualifier') applyQualifierGate();
        if (st.id === 'filter')    applyFilterGate();
        if (st.id === 'evaluator') applyEvaluatorGate();
        if (st.id === 'quota')     applyGate();
        tour.seen[topic] = true;
        van.dwell = firstTime ? World.readSeconds(st.id) : st.dwell / dwellBoost();
        state.reading = firstTime;
        state.dwellTotal = van.dwell;
        state.dwellLeft = van.dwell;
        if (state.stepMode) { state.paused = true; state.stepMode = false; }
        return;
      }
    }

    if (van.stationIdx >= sts.length || van.dist >= World.BELT.total) {
      endTrip();
    }
  }

  function vanPosition() {
    return Iso.smoothAt(World.BELT, van.dist, 0.8);
  }

  global.Sim = {
    state: state,
    RECON_SECONDS: RECON_SECONDS,
    van: van,
    run: run,
    reset: function () { reset(); emit('reset'); },
    replayTour: function () { tour.seen = Object.create(null); tour.done = false; },
    update: update,
    vanPosition: vanPosition,
    planNow: planNow,
    on: function (fn) { listeners.push(fn); },
    play: function () { if (!state.finished) { state.paused = false; state.running = true; } },
    pause: function () { state.paused = true; },
    toggle: function () { if (state.paused) this.play(); else this.pause(); },
    step: function () {
      if (state.finished) return;
      state.running = true;
      state.stepMode = true;
      state.paused = false;
      if (van.dwell > 0) van.dwell = 0;
    }
  };
})(window);
