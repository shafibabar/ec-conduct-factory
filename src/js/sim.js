/* sim.js: EC Factory state machine — walks one communication along the belt.
 *
 * Three ideas do all the work:
 *   1. The carrier moves along the belt route by distance; stations fire on arrival.
 *   2. The FIRST time a station fires, the carrier stops for a reading stop.
 *   3. What the reader has already read lives outside the run state (tour object).
 *
 * The one branch: at ec-surveillance-quota-manager (quota), if sampled the
 * carrier continues to alerting; if not sampled, it jumps directly to
 * ec-centralised-audit (skipping alerting, echo, and indexer).
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
    contentPolicyShare: 40,
    samplingPercent:   10,
    failureRate:       2,
    autoscaling:       true,

    /* ---- vehicle state (the lesson, carried by the communication) ---- */
    bytesDownloaded:  0,
    bytesAfterMinify: 0,
    participants:     0,
    pipelineCount:    2,
    pipelineIds:      2,   // alias for narration interpolation
    sentToCognition:  0,
    comsWaitMs:       0,
    quotaUsed:        0,
    quotaLimit:       0,
    sampled:          false,
    alertsCreated:    0,
    fingerprint:      '',
    isEcho:           false,
    batchPosition:    0,
    bulkBytes:        0,
    auditEventsEmitted: 0,
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
    if (id === 'qualifier') { state.participants = v.participants; state.pipelineIds = state.pipelineCount; }
    if (id === 'evaluator') { state.sentToCognition = v.sentToCognition; state.comsWaitMs = v.comsWaitMs; }
    if (id === 'quota')     { state.quotaUsed = v.quotaUsed; state.quotaLimit = v.quotaLimit; state.sampled = v.sampled; }
    if (id === 'alerting')  { state.alertsCreated = v.alertsCreated; }
    if (id === 'echo')      { state.fingerprint = v.fingerprint; state.isEcho = v.isEcho; }
    if (id === 'indexer')   { state.batchPosition = v.batchPosition; state.bulkBytes = v.bulkBytes; }
    if (id === 'audit' || id === 'reporting') { state.auditEventsEmitted = (state.auditEventsEmitted || 0) + 1; }
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
    state.participants     = 0;
    state.pipelineIds      = state.pipelineCount;
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
    van.dist = 0;
    van.stationIdx = 0;
    van.dwell = 0;
  }

  function reset() {
    state.finished = false;
    state.trips = 0;
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
    emit('station', st.id);
  }

  /* The one fork: after quota, skip alerting/echo/indexer when not sampled. */
  function applyGate() {
    if (!state.sampled) {
      /* Jump to ec-centralised-audit (STATIONS_FLAT index 8) */
      var auditIdx = World.STATION_IDX_BY_ID['audit'];
      van.stationIdx = auditIdx;
      van.dist = World.STATIONS_FLAT[auditIdx].dist - 0.1;
    }
  }

  function endTrip() {
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
    if (!state.running || state.paused || state.finished) return;

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
        /* apply sorting gate AFTER fire so sampled state is set */
        if (st.id === 'quota') applyGate();
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
