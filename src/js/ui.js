/* ui.js: EC City DOM panels, controls, narration.
 *
 * Every widget reads Sim.state or calls EC.compute() directly.
 * Nothing is stored twice: the panel can never disagree with the map.
 */
(function (global) {
  'use strict';

  var Sim = global.Sim, World = global.World, EC = global.EC;

  var $ = function (id) { return document.getElementById(id); };

  var el = {};
  var activeDistrict = null;
  var pinnedDistrict = null;
  var lastPaint = 0;
  var flyTo = null;
  var sheetOpen = false;

  var STATION_LABEL = {
    gateway:   'gateway',
    qualifier: 'qualifier',
    filter:    'filter',
    evaluator: 'evaluator',
    quota:     'quota',
    alerting:  'alerting',
    echo:      'echo',
    indexer:   'indexer',
    audit:     'audit',
    done:      'done'
  };

  /* ------------------------------------------------------------------ init */

  function init() {
    [
      'stage-chip', 'stage-tag', 'stage-name', 'stage-short', 'stage-body',
      'dwell', 'dwell-bar', 'dwell-hint',
      'phase-list', 'phase-hint',
      'stat-latency', 'stat-sampled', 'stat-alerts', 'stat-replicas',
      'stat-note',
      'district-chips',
      'hud-phase', 'hud-trip', 'hud-elapsed', 'hud-state', 'hud-note',
      'inspector', 'btn-run', 'btn-play', 'play-glyph', 'btn-step', 'btn-reset',
      'speed', 'ingest', 'docsize', 'content', 'sampling', 'failure',
      'v-speed', 'v-ingest', 'v-docsize', 'v-content', 'v-sampling', 'v-failure',
      'autoscaling', 'follow', 'labels',
      'btn-about', 'about', 'about-close', 'btn-panel', 'tooltip',
      'sheet-handle', 'btn-tune', 'dock', 'dock-tune'
    ].forEach(function (id) { el[id] = $(id); });

    buildChips();
    wire();
    applyResponsiveLabels();

    Sim.on(function (name, payload) {
      if (name === 'station') onStation(payload);
      if (name === 'reset') { pinnedDistrict = null; paint(true); }
    });
  }

  function buildChips() {
    World.districts.forEach(function (d) {
      var b = document.createElement('button');
      b.textContent = d.name;
      b.dataset.id = d.id;
      b.addEventListener('click', function () {
        showDistrict(d, true);
        flyTo = { x: d.x, y: d.y };
      });
      el['district-chips'].appendChild(b);
    });
  }

  function wire() {
    el['btn-run'].addEventListener('click', function () { Sim.run(); paint(true); });
    el['btn-play'].addEventListener('click', function () { Sim.toggle(); paint(true); });
    el['btn-step'].addEventListener('click', function () { Sim.step(); });
    el['btn-reset'].addEventListener('click', function () { Sim.replayTour(); Sim.run(); paint(true); });

    bindRange('speed',    'v-speed',    function (v) { Sim.state.speed = v; return v.toFixed(1) + '×'; });
    bindRange('ingest',   'v-ingest',   function (v) { Sim.state.ingestRate = v; return EC.fmtNum(v) + '/s'; });
    bindRange('docsize',  'v-docsize',  function (v) { Sim.state.avgDocSizeKb = v; return EC.fmtKb(v); });
    bindRange('content',  'v-content',  function (v) { Sim.state.contentPolicyShare = v; return v + '%'; });
    bindRange('sampling', 'v-sampling', function (v) { Sim.state.samplingPercent = v; return v + '%'; });
    bindRange('failure',  'v-failure',  function (v) { Sim.state.failureRate = v; return v + '%'; });

    el.autoscaling.addEventListener('change', function () { Sim.state.autoscaling = el.autoscaling.checked; paint(true); });
    el.labels.addEventListener('change', function () { global.Renderer.setLabels(el.labels.checked); });

    el['btn-about'].addEventListener('click', function () { el.about.hidden = false; });
    el['about-close'].addEventListener('click', function () { el.about.hidden = true; });
    el.about.addEventListener('click', function (e) { if (e.target === el.about) el.about.hidden = true; });

    el['btn-panel'].addEventListener('click', function () {
      var hidden = el.inspector.classList.toggle('hidden');
      el['btn-panel'].setAttribute('aria-expanded', String(!hidden));
      applyResponsiveLabels();
    });
    window.addEventListener('resize', applyResponsiveLabels);

    el['sheet-handle'].addEventListener('click', function () { setSheet(!sheetOpen); });
    el['btn-tune'].addEventListener('click', function () {
      var open = el.dock.classList.toggle('tune-open');
      el['btn-tune'].setAttribute('aria-expanded', String(open));
      el['btn-tune'].title = open ? 'Hide settings' : 'Show settings';
    });
  }

  function isMobile() { return window.matchMedia('(max-width: 900px)').matches; }

  function applyResponsiveLabels() {
    var hidden = el.inspector.classList.contains('hidden');
    var narrow = isMobile();
    el['btn-panel'].textContent = narrow ? (hidden ? 'Panel' : 'Hide')
                                         : (hidden ? 'Show panel' : 'Hide panel');
    el['btn-about'].textContent = narrow ? 'About' : 'About & accuracy';
    el['dwell-hint'].innerHTML = narrow
      ? 'reading stop: tap <b>❚❚</b> below to hold it here'
      : 'reading stop: press <kbd>Space</kbd> to hold it here';
  }

  function setSheet(open) {
    sheetOpen = open;
    el.inspector.classList.toggle('open', open);
    el['sheet-handle'].setAttribute('aria-expanded', String(open));
    if (open) el.inspector.scrollTop = 0;
  }

  function bindRange(id, out, fn) {
    var input = el[id];
    if (!input) return;
    var apply = function () { if (el[out]) el[out].textContent = fn(parseFloat(input.value)); };
    input.addEventListener('input', apply);
    apply();
  }

  /* -------------------------------------------------------------- narration */

  function onStation(station) {
    var id = station === 'done' ? null : (World.stationToDistrict[station] || station);
    activeDistrict = id;
    if (!pinnedDistrict && id) {
      var d = World.districtById[id];
      if (d) writeCard(d, station);
    }
    if (station === 'done') writeDone();
    paint(true);
  }

  /* Interpolate {vehicleState} placeholders with live values. */
  function interpolate(text) {
    var s = Sim.state;
    return text
      .replace(/\{participants\}/g, String(s.participants || 6))
      .replace(/\{pipelineCount\}/g, String(s.pipelineCount || 2))
      .replace(/\{sentToCognition\}/g, String(s.sentToCognition || 0))
      .replace(/\{comsWaitMs\}/g, EC.fmtMs(s.comsWaitMs || 0))
      .replace(/\{quotaUsed\}/g, String(s.quotaUsed || 0))
      .replace(/\{quotaLimit\}/g, String(s.quotaLimit || 0))
      .replace(/\{sampled\}/g, s.sampled ? 'Sampled — a human will review this' : 'Not sampled — audit only')
      .replace(/\{alertsCreated\}/g, String(s.alertsCreated || 0))
      .replace(/\{fingerprint\}/g, s.fingerprint || '(computing…)')
      .replace(/\{isEcho\}/g, s.isEcho ? 'yes — an earlier alert will be updated' : 'no — this is a new violation')
      .replace(/\{batchPosition\}/g, String(s.batchPosition || 0))
      .replace(/\{bulkBytes\}/g, EC.fmtKb(s.bulkBytes || 0))
      .replace(/\{auditEventsEmitted\}/g, String(s.auditEventsEmitted || 0));
  }

  function writeCard(d, station) {
    el['stage-chip'].textContent = STATION_LABEL[station] || d.id;
    el['stage-chip'].style.color = d.color;
    el['stage-chip'].style.background = global.Iso.rgba(d.color, 0.14);
    el['stage-chip'].style.borderColor = global.Iso.rgba(d.color, 0.3);
    el['stage-tag'].textContent = d.tag;
    el['stage-name'].textContent = d.name;
    el['stage-short'].textContent = interpolate(d.short);
    el['stage-body'].textContent = interpolate(d.body);
  }

  function writeDone() {
    var s = Sim.state;
    el['stage-chip'].textContent = 'done';
    el['stage-chip'].style.color = '';
    el['stage-chip'].style.background = '';
    el['stage-chip'].style.borderColor = '';
    el['stage-tag'].textContent = s.trips + ' communication(s)';
    el['stage-name'].textContent = 'City cycle complete';
    el['stage-short'].textContent = 'Each communication collected a verdict at every station and a complete audit trail.';
    el['stage-body'].textContent =
      'The last communication accumulated ' + EC.fmtMs(s.latencyMs) + ' of end-to-end latency. ' +
      'Every service in this city is a decision plus a receipt: the communication itself was barely modified, ' +
      'but at each stop it collected one more verdict and one more audit event. ' +
      'The receipts in the Records Hall now count back exactly against the ingest watermark at the Customs House. ' +
      'Drag Ingest Rate up and watch which road turns red first — that is the bottleneck.';
  }

  function showDistrict(d, pin) {
    pinnedDistrict = pin ? d.id : null;
    writeCard(d, Sim.state.station);
    if (pin) {
      el['stage-chip'].textContent = 'pinned';
      el['stage-tag'].textContent = d.tag + ' · tap empty ground to resume';
      if (isMobile()) setSheet(true);
    }
    updateChips();
  }

  function updateChips() {
    var kids = el['district-chips'].children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].classList.toggle('on', kids[i].dataset.id === (pinnedDistrict || activeDistrict));
    }
  }

  /* ------------------------------------------------------------------ paint */

  function paint(force) {
    var now = performance.now();
    if (!force && now - lastPaint < 90) return;
    lastPaint = now;

    var s = Sim.state;
    var plan = s.plan || Sim.planNow();

    el['play-glyph'].textContent = s.paused || s.finished ? '▶' : '❚❚';

    el['hud-phase'].textContent = s.station ? (STATION_LABEL[s.station] || s.station) : 'idle';
    el['hud-trip'].textContent = Math.min(s.trips + (s.finished ? 0 : 1), s.maxTrips) + ' / ' + s.maxTrips;
    el['hud-elapsed'].textContent = EC.fmtMs(s.latencyMs);
    el['hud-state'].textContent = s.sampled ? 'sampled' : 'audit-only';
    el['hud-note'].textContent = hudNote(s);

    var showing = s.reading && s.dwellTotal > 0 && s.dwellLeft > 0;
    el.dwell.hidden = !showing;
    if (showing) el['dwell-bar'].style.width = (s.dwellLeft / s.dwellTotal * 100).toFixed(1) + '%';

    paintPhaseList(s, plan);
    paintStats(s, plan);
    updateChips();
  }

  function hudNote(s) {
    if (s.finished) return '';
    if (s.reading) return '⏸ holding here so you can read the panel';
    if (!s.running) return 'Press Run to send a communication through the city.';
    if (s.station === 'quota' && !s.sampled) return '↩ not sampled: communication goes to audit-only road';
    if (s.fastForward) return '⏩ repeat trip: no new read stops until a new station';
    if (s.tourDone) return '⏩ every district explained — running at speed (drag Speed down to slow it)';
    return '';
  }

  function paintPhaseList(s, plan) {
    if (!plan || !plan.phases) return;
    var max = 1;
    plan.phases.forEach(function (p) { if (p.workMs + p.queueMs > max) max = p.workMs + p.queueMs; });

    if (el['phase-hint']) {
      el['phase-hint'].textContent = s.charged
        ? Object.keys(s.charged).length + ' of ' + plan.phases.length + ' stations visited'
        : 'projected';
    }

    if (!el['phase-list']) return;
    el['phase-list'].innerHTML = plan.phases.map(function (p) {
      var paid = s.charged && s.charged[p.id] != null;
      var live = s.station === p.id;
      var ms = paid ? s.charged[p.id] : (p.workMs + p.queueMs);
      var over = p.overThresh;
      return '<div class="bar' + (paid ? ' paid' : '') + (live ? ' live' : '') + (over ? ' hot' : '') + '">' +
        '<span class="lbl">' + escapeHtml(p.id) + '</span>' +
        '<span class="track"><span class="fill" style="width:' +
        (ms / max * 100).toFixed(1) + '%"></span></span>' +
        '<span class="val">' + EC.fmtMs(ms) + (over ? ' !' : '') + '</span></div>';
    }).join('');
  }

  function paintStats(s, plan) {
    if (!plan) return;
    if (el['stat-latency']) el['stat-latency'].textContent = EC.fmtMs(s.latencyMs || 0);
    if (el['stat-sampled']) el['stat-sampled'].textContent = s.sampled ? 'yes' : 'no';
    if (el['stat-alerts'])  el['stat-alerts'].textContent  = String(s.alertsCreated || 0);

    // current bottleneck replicas
    var bottleneck = plan.bottleneck;
    var bph = null;
    if (plan.phases) plan.phases.forEach(function (p) { if (p.id === bottleneck) bph = p; });
    if (el['stat-replicas']) el['stat-replicas'].textContent = bph ? String(bph.replicas) : '—';

    // live interpretation sentence
    if (el['stat-note'] && plan.phases) {
      var overThreshCount = plan.phases.filter(function (p) { return p.overThresh; }).length;
      var note;
      if (overThreshCount === 0) {
        note = 'All services within KEDA thresholds at ' + s.ingestRate + '/s.';
      } else {
        var cfg = EC.SERVICE_CFG[bottleneck] || {};
        note = overThreshCount + ' service(s) over lag threshold. ' +
          'Bottleneck: ' + bottleneck + ' (' + (bph ? bph.replicas : '?') + '/' + (cfg.maxRep || '?') + ' replicas). ' +
          'Drag Ingest Rate down or enable Autoscaling.';
      }
      if (s.contentPolicyShare > 60) note += ' High content-policy share is adding Cognition wait.';
      el['stat-note'].textContent = note;
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------------------------------------------------------- exports */

  global.UI = {
    init: init,
    paint: paint,
    run: function () { Sim.run(); paint(true); },
    resetAll: function () { Sim.replayTour(); Sim.run(); paint(true); },
    showDistrict: showDistrict,
    unpin: function () { pinnedDistrict = null; updateChips(); },
    activeDistrict: function () { return pinnedDistrict || activeDistrict; },
    takeFlyTo: function () { var f = flyTo; flyTo = null; return f; },
    el: el
  };
})(window);
