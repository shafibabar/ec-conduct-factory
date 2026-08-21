/* ui.js: EC Factory Tour — DOM panels, sliders, narration, HUD.
 *
 * Structured against /home/shafi/rocket-engine/js/ui.js, which is the
 * reference for the whole chrome: the stage card, the `.sheet` row helper with
 * its computed/warn vocabulary, the material bars, the traveller tokens, the
 * output list and the station chips are all that file's patterns pointed at
 * EC's data instead of a rocket engine's.
 *
 * Exports:  global.UI = { init, paint, run, resetAll,
 *                          showDistrict, unpin, activeDistrict, takeFlyTo, el }
 */
(function (global) {
  'use strict';

  var Sim = global.Sim, EC = global.EC, World = global.World, Iso = global.Iso;
  var Dock = global.Dock;
  var fmtMs = EC.fmtMs, fmtKb = EC.fmtKb, fmtNum = EC.fmtNum;

  /* ---- DOM refs ---------------------------------------------------------- */

  var _el = {};

  function el(id) { return _el[id] || (_el[id] = document.getElementById(id)); }

  /* ---- state ------------------------------------------------------------- */

  var _pinned = null;      /* district id the reader clicked */
  var _active = null;      /* district id the carrier is at */
  var _sheetOpen = false;  /* mobile bottom sheet */
  var _log = [];           /* the traveller trail for this run */
  var _filed = [];         /* completed trips, for the record-keeper list */
  var _lastPaint = 0;

  /* Camera destination requested. main.js applies ONE 0.5 lerp per frame it
     receives a target, so handing the target over once only ever moved the
     camera halfway there — clicking a machine left it framed between that
     machine and wherever the camera happened to be. Hold the target for a
     few frames instead and the lerp converges. */
  var _flyTo  = null;
  var _flyFor = 0;
  var FLY_FRAMES = 9;

  function activeDistrict() { return _pinned || _active; }
  function takeFlyTo() {
    if (!_flyTo) return null;
    var r = _flyTo;
    if (--_flyFor <= 0) _flyTo = null;
    return r;
  }

  /* ---- the dock ----------------------------------------------------------
   *
   * One descriptor per control. js/dock.js turns this into the markup, the
   * value readouts, the log-scale mapping and the listeners; onInput below is
   * the only place a control's value meets Sim.state. Adding a control is one
   * entry here and nothing anywhere else.
   *
   * Two of these span orders of magnitude, and both ends of both teach
   * something:
   *
   *   Document  a 1 KB chat line, and a 128 MB attachment-heavy mail that
   *             splits into 26 byte ranges and needs two waves of 25 streams.
   *   Ingest    a quiet tenant, and the rate at which KEDA actually has to do
   *             something. One replica of ec-gateway is modelled at roughly
   *             700 records/s, so below a few thousand a second every service
   *             sits at its three-replica floor, nothing queues, and the whole
   *             autoscaling lesson is inert.
   *
   * A linear range input can express one end of that or the other, never both,
   * so those two — and Cognition, which reaches from 1 ms to past the COMS
   * ceiling — declare scale:'log' and the dock does the rest.
   * ------------------------------------------------------------------ */

  var BIND = {
    'ingest-rate':    'ingestRate',
    'doc-size':       'avgDocSizeKb',
    'participants':   'participants',
    'ignore-share':   'ignoreShare',
    'content-pol':    'contentPolicyShare',
    'cognition-rtt':  'cognitionRttMs',
    'sample-pct':     'samplingPercent',
    'fail-rate':      'failureRate'
  };

  var DOCK_SPEC = {
    mount: 'dock',

    transport: [
      { id: 'btn-play',  glyph: '\u275a\u275a', playGlyph: '\u25b6', glyphId: 'play-glyph',
        title: 'Play / pause (space)', onClick: function () { Sim.toggle(); paint(true); } },
      { id: 'btn-step',  glyph: '\u21e5', title: 'Next station (S)',
        onClick: function () { Sim.step(); } },
      { id: 'btn-reset', glyph: '\u27f2', title: 'Reset and replay the slow tour (R)',
        onClick: function () { Sim.replayTour(); resetAll(); } }
    ],

    status:  { pipId: 'carrier-pip', textId: 'carrier-state', idle: 'idle' },
    primary: { id: 'btn-run', label: 'Start', onClick: function () { run(); } },
    tune:    { id: 'btn-tune', paneId: 'dock-tune' },

    controls: [
      { kind: 'slider', id: 'ingest-rate', label: 'Ingest',
        scale: 'log', logMax: 20000, value: 50,
        fmt: function (v) { return fmtNum(v) + '/s'; },
        hint: 'Records a second arriving at the gateway. Below a few thousand nothing queues and KEDA never moves.' },

      { kind: 'slider', id: 'doc-size', label: 'Document',
        scale: 'log', logMax: 131072, value: 512,
        fmt: function (v) { return fmtKb(v); },
        hint: '1 KB to 128 MB. Past 5 MB the object splits into byte ranges; past 125 MB it needs a second wave of streams.' },

      /* Linear, not logarithmic: the useful range is narrow and 0 has to be
         selectable — zero participants is the not-qualified exit. */
      { kind: 'slider', id: 'participants', label: 'Participants',
        min: 0, max: 500, value: 100,
        hint: 'People on the communication. At zero no pipeline claims it and the journey ends at the qualifier.' },

      { kind: 'slider', id: 'ignore-share', label: 'Ignore policies',
        min: 0, max: 100, value: 15, unit: '%',
        hint: 'Share of claiming pipelines an ignore policy suppresses. At 100% nothing qualifies and evaluation is skipped.' },

      { kind: 'slider', id: 'content-pol', label: 'Content policies',
        min: 0, max: 100, value: 40, unit: '%',
        hint: 'Share of policies needing the message body, so they cost a Cognition round trip instead of a metadata lookup.' },

      { kind: 'slider', id: 'cognition-rtt', label: 'Cognition RTT',
        scale: 'log', logMax: 20000000, value: 45000,
        fmt: function (v) { return fmtMs(v); },
        hint: 'The one latency EC does not bound. Past the 9 000 000 ms COMS ceiling every content verdict ages out.' },

      { kind: 'slider', id: 'sample-pct', label: 'Sampling',
        min: 1, max: 100, value: 10, unit: '%',
        hint: 'The quota manager\u2019s sampling percentage — the share of qualified communications that reach a reviewer.' },

      { kind: 'slider', id: 'fail-rate', label: 'Failure rate',
        min: 0, max: 10, value: 2, unit: '%',
        hint: 'Share of records that fail and walk the retry ladder.' },

      { kind: 'select', id: 'pipeline-count', label: 'Pipelines',
        value: 2, options: ['1', '2', '4', '8'],
        hint: 'Surveillance pipelines configured. Every fan-out on the floor is priced per pipeline.' },

      { kind: 'toggles', items: [
        { id: 'autoscale', label: 'KEDA',  checked: true,
          hint: 'Turn off to pin every service at its three-replica floor and watch the lag bars run away.' },
        { id: 'follow',    label: 'Follow', checked: true },
        { id: 'labels',    label: 'Labels', checked: true }
      ] }
    ],

    /* The one place a dock value meets simulation state. */
    onInput: function (id, value) {
      if (BIND[id]) { Sim.state[BIND[id]] = value; return; }
      if (id === 'pipeline-count') {
        Sim.state.pipelineCount = parseInt(value, 10) || 2;
        Sim.state.pipelineIds   = Sim.state.pipelineCount;
        return;
      }
      if (id === 'autoscale') { Sim.state.autoscaling = value; return; }
      if (id === 'labels' && global.Renderer) { global.Renderer.setLabels(value); return; }
      /* `follow` is main.js's business; it reads the checkbox directly. */
    }
  };

  var dock = null;

  /* ---- narration --------------------------------------------------------- */

  function interpolate(tmpl, s) {
    return tmpl.replace(/\{(\w+)\}/g, function (_, k) {
      var v = s[k];
      if (v === undefined || v === null) return '–';
      if (typeof v === 'boolean') return v ? 'SAMPLED ✓' : 'NOT SAMPLED';
      /* Opaque identifiers — the window token, the echo fingerprint — are
         strings and must pass through untouched. Falling through to fmtNum
         below rendered them as NaN. */
      if (typeof v === 'string') return v;
      if (k === 'bytesDownloaded' || k === 'bytesAfterMinify' || k === 'bulkBytes') return fmtKb(+v);
      if (k === 'comsWaitMs' || k === 'latencyMs') return fmtMs(+v);
      return fmtNum(+v);
    });
  }

  function writeStageCard(d, pinned) {
    var s = Sim.state;

    /* The chip carries the district's own accent inline rather than a fixed
       class, so one card reads differently per station while the rest of the
       panel stays neutral. */
    var chip = el('stage-chip');
    if (chip) {
      var c = d.color || '#e0a02c';
      chip.textContent = pinned ? 'pinned' : (d.id || '-');
      chip.style.color       = c;
      chip.style.background  = Iso.rgba(c, 0.14);
      chip.style.borderColor = Iso.rgba(c, 0.34);
    }

    var tag = el('stage-tag');
    if (tag) {
      tag.textContent = pinned
        ? (d.tag || '') + ' · click empty ground to resume'
        : (d.tag || '');
    }

    var nameEl  = el('stage-name');  if (nameEl)  nameEl.textContent  = d.name;
    var shortEl = el('stage-short'); if (shortEl) shortEl.textContent = d.short || '';
    var bodyEl  = el('stage-body');  if (bodyEl)  bodyEl.textContent  = d.body ? interpolate(d.body, s) : '';
  }

  function showDistrict(idOrObj, byUser) {
    /* main.js passes the district object; internal calls pass the id string */
    var id = (idOrObj && typeof idOrObj === 'object') ? idOrObj.id : idOrObj;
    var d = World.districtById[id];
    if (!d) return;

    if (byUser) _pinned = id; else _active = id;

    writeStageCard(d, !!byUser);
    updateChips();

    var s = Sim.state;

    /* The gate, and the three other places a journey can end early. The
       carrier no longer walks to ec-centralised-audit — audit is off the belt
       and consumes events about the communication, not the communication — so
       a suppressed record simply stops where it was suppressed. */
    if (id === 'quota') {
      hudNote(s.sampled ? 'SAMPLED — carrier continues to alerting'
                        : (s.quotaEvent || 'NOT SAMPLED') +
                          ' — journey ends here, receipt goes to audit');
    }
    if (id === 'qualifier' && s.pipelineIds === 0) {
      hudNote('NOT QUALIFIED — no pipeline claimed it, journey ends here');
    }
    if (id === 'filter' && s.allSuppressed) {
      hudNote('ALL SUPPRESSED — evaluation skipped, counted at the gate');
    }
    if (id === 'evaluator' && s.evaluatorStalled) {
      hudNote('COMS TIMED OUT — nothing reached sampling, journey ends here');
    }

    if (byUser) {
      _flyTo = { x: d.x, y: d.y };
      _flyFor = FLY_FRAMES;
      /* tapping a machine on a phone is a request to read it */
      if (isMobile()) setSheet(true);
    }
    paint(true);
  }

  function unpin() { _pinned = null; updateChips(); paint(true); }

  /* ---- HUD note ---------------------------------------------------------- */

  var _note = '', _noteT = 0;

  function hudNote(msg) {
    _note = msg;
    _noteT = performance.now() + 4500;
  }

  function noteText(s) {
    if (_note && performance.now() < _noteT) return _note;
    _note = '';
    if (s.finished) return 'Run complete — press R to reset, or ▶ to replay.';
    if (s.reading)  return 'Holding here so you can read the panel — Space to keep holding.';
    if (!s.running) return '';
    return 'One carrier, one communication. Everything off the belt is feeding it or keeping its record.';
  }

  /* ---- the data sheet ----------------------------------------------------
   *
   * The reference's "sexy numbers" pattern, and the one thing this panel was
   * missing entirely. A row is label + value; `calc` marks a figure the model
   * WORKED OUT rather than one the reader typed in (it gets the amber tint and
   * a small f mark), and `warn` marks one that is out of range. Everything the
   * reader can see move when they drag a slider is a calc row.
   * ------------------------------------------------------------------ */

  function rows(list) {
    return list.map(function (r) {
      var cls = 'row' + (r[2] ? ' calc' : '') + (r[3] ? ' warn' : '');
      return '<div class="' + cls + '"><span>' + r[0] + '</span><b>' + esc(r[1]) + '</b></div>';
    }).join('');
  }

  function paintSheet(plan, s) {
    var sheet = el('sheet');
    if (!sheet || !plan) return;

    var v  = plan.vehicle || {};
    var s3 = EC.s3Plan(s.avgDocSizeKb);

    /* The COMS ceiling is the one bound EC's own code does not enforce, so
       call it out in the section hint the moment the slider passes it. */
    var hint = el('sheet-hint');
    if (hint) hint.textContent = v.comsTimedOut ? 'Cognition past the COMS ceiling' : 'computed live';

    var list = [
      ['Document', fmtKb(s.avgDocSizeKb), false],
      ['Byte ranges', s3.chunks + ' × ' + fmtKb(s3.chunkKb), true],
      ['Concurrent streams', s3.conc + ' of 25', true, s3.conc >= 25],
      ['Download waves', s3.waves + '', true, s3.waves > 1],
      ['On the wire', fmtKb(v.bytesDownloaded || 0), true],
      ['After minify', fmtKb(v.bytesAfterMinify || 0), true],
      ['Participants', fmtNum(s.participants), false],
      ['Matched entities', fmtNum(v.matchedEntities || 0), true],
      ['Pipelines claiming', (v.pipelineIds || 0) + ' of ' + (v.pipelineCount || 0), true,
        (v.pipelineIds || 0) === 0],
      ['Suppressed / qualified', (v.filtered || 0) + ' / ' + (v.qualified || 0), true,
        !!v.allSuppressed],
      ['Answered from metadata', fmtNum(v.metadataOnly || 0), true],
      ['Sent to Cognition', fmtNum(v.sentToCognition || 0), true],
      ['Cognition wait', fmtMs(v.comsWaitMs || 0), true, !!v.comsTimedOut],
      ['Quota bucket', (v.quotaUsed || 0) + ' / ' + (v.quotaLimit || 0), true],
      ['Sampling verdict', v.sampled ? 'sampled' : (v.quotaEvent || 'not sampled'), true, !v.sampled],
      ['Alerts created', fmtNum(v.alertsCreated || 0), true],
      ['Echo outcome', v.echoOutcome || '-', true, v.echoOutcome === 'echo-closed'],
      ['ES bulk position', (v.batchPosition || 0) + ' / 50', true],
      ['Bulk payload', fmtKb(v.bulkBytes || 0), true],
      ['Audit receipts', fmtNum(s.auditEvents || 0), true]
    ];

    var html = rows(list);

    html += '<div class="row big calc"><span>End to end</span><b>' +
            esc(fmtMs(plan.totalMs)) + '</b></div>';

    if (v.comsTimedOut) {
      html += '<p class="fine">The Cognition round trip has passed the 9 000 000 ms COMS ceiling, so ' +
              'every content verdict ages out before it arrives. Those communications never reach ' +
              'sampling at all — the receipt goes to the tower and the journey ends at the evaluator.</p>';
    } else if (s3.waves > 1) {
      html += '<p class="fine">More byte ranges than the 25-stream ceiling, so ec-gateway comes back ' +
              'for a second wave. That is why the download time steps rather than sloping.</p>';
    }

    sheet.innerHTML = html;
  }

  /* ---- Kafka lag bars ---------------------------------------------------
   *
   * The reference's material-bar pattern: label, track, value. Here the value
   * is the replica count KEDA settled on and the bar is consumer lag measured
   * against that service's OWN lagThreshold — which differs per service, so a
   * full bar on alerting (threshold 1000) and a full bar on quota
   * (threshold 50) are very different amounts of backlog.
   * ------------------------------------------------------------------ */

  function paintLag(plan) {
    var box = el('lag-list');
    if (!box || !plan) return;

    var over = plan.phases.filter(function (ph) { return ph.overThresh; }).length;
    var hint = el('lag-hint');
    if (hint) {
      hint.textContent = over
        ? over + (over === 1 ? ' service over threshold' : ' services over threshold')
        : 'all within threshold';
    }

    box.innerHTML = plan.phases.map(function (ph) {
      var frac = Math.min(1, ph.lag / Math.max(1, ph.lagThresh));
      var fill = ph.overThresh ? 'var(--ember)' : 'var(--amber)';
      return '<div class="bar' + (ph.overThresh ? ' over' : '') + '">' +
        '<span class="lbl">' + esc(ph.id) + '</span>' +
        '<span class="track"><span class="fill" style="width:' +
          (Math.max(2, frac * 100)).toFixed(1) + '%;background:' + fill + '"></span></span>' +
        '<span class="val">' + ph.replicas + 'r</span></div>';
    }).join('') +
    '<p class="fine">Lag as a share of each service’s own lagThreshold, and the replica count ' +
    'KEDA scales to because of it. Drag Ingest up: nothing moves until one replica can no longer ' +
    'keep up, and then everything moves at once.</p>';
  }

  /* ---- traveller tokens -------------------------------------------------- */

  function paintLog() {
    var box = el('log');
    var count = el('log-count');
    if (count) count.textContent = _log.length + ' / ' + World.STATIONS_FLAT.length + ' stations';
    if (!box) return;
    box.innerHTML = _log.map(function (name, i) {
      var cls = 'tok' + (i === _log.length - 1 ? ' focus' : '');
      return '<span class="' + cls + '">' + esc(name) + '</span>';
    }).join('') || '<span class="fine">nothing yet</span>';
  }

  /* ---- the record keeper's list ------------------------------------------ */

  function paintOutput(s) {
    var box = el('output');
    if (!box) return;
    if (!_filed.length) {
      box.innerHTML = '<span class="fine">nothing filed yet</span><span class="caret">|</span>';
      return;
    }
    var agree = s.auditIngested === s.auditCompleted;
    box.innerHTML = _filed.map(function (f) {
      return '<span class="unit"><span class="no">#' + f.n + '</span> ended at ' + esc(f.end) +
             ' — ' + f.receipts + ' receipts filed</span>';
    }).join('') +
    '<span class="unit"><span class="no">' + s.auditCompleted + ' / ' + s.auditIngested +
      '</span> ' + (agree ? 'reconciled' : 'FLAGGED — counts disagree') + '</span>' +
    (s.finished ? '' : '<span class="caret">|</span>');
  }

  /* ---- station chips ----------------------------------------------------- */

  function buildChips() {
    var box = el('station-chips');
    if (!box) return;
    World.districts.forEach(function (d) {
      var b = document.createElement('button');
      b.textContent = d.name;
      b.dataset.id = d.id;
      b.addEventListener('click', function () { showDistrict(d, true); });
      box.appendChild(b);
    });
  }

  function updateChips() {
    var box = el('station-chips');
    if (!box) return;
    var on = activeDistrict();
    for (var i = 0; i < box.children.length; i++) {
      box.children[i].classList.toggle('on', box.children[i].dataset.id === on);
    }
  }

  /* ---- mobile ------------------------------------------------------------ */

  function isMobile() { return global.matchMedia('(max-width: 900px)').matches; }

  function setSheet(open) {
    _sheetOpen = open;
    var insp = el('inspector');
    if (!insp) return;
    insp.classList.toggle('open', open);
    var h = el('sheet-handle');
    if (h) h.setAttribute('aria-expanded', String(open));
    if (open) insp.scrollTop = 0;
  }

  /* The topbar cannot fit both actions on a phone, but both still need to be
     reachable — landscape especially, where dismissing the panel is the only
     way to get a usable canvas. */
  function applyResponsiveLabels() {
    var insp = el('inspector');
    var hidden = !!(insp && insp.classList.contains('hidden'));
    var narrow = isMobile();
    var bp = el('btn-panel');
    if (bp) bp.textContent = narrow ? (hidden ? 'Panel' : 'Hide')
                                    : (hidden ? 'Show panel' : 'Hide panel');
    var ba = el('btn-about');
    if (ba) ba.textContent = narrow ? 'About' : 'About & accuracy';
    var dh = el('dwell-hint');
    if (dh) {
      dh.innerHTML = narrow
        ? 'reading stop: tap <b>❚❚</b> below to hold it here'
        : 'reading stop: press <kbd>Space</kbd> to hold it here';
    }
  }

  /* ---- paint (called every frame from main.js) --------------------------- */

  function paint(force) {
    var now = performance.now();
    if (!force && now - _lastPaint < 90) return;
    _lastPaint = now;

    var s = Sim.state;

    /* planNow(), NOT s.plan. s.plan is frozen at the start of a trip, so a
       panel built from it only moves once per trip — drag Ingest and the lag
       bars sit still, which is exactly the failure CLAUDE.md warns about for
       the machines' own readouts. The panel obeys the same rule: what is on
       screen is what model.js computes from the CURRENT slider positions. */
    var plan = Sim.planNow();

    /* HUD */
    var st  = el('hud-station');     if (st)  st.textContent  = s.finished ? 'done' : (s.station || 'idle');
    var tot = el('hud-total');       if (tot) tot.textContent = fmtMs(plan.totalMs);
    var bn  = el('hud-bottleneck');  if (bn)  bn.textContent  = plan.bottleneck || '-';
    var tp  = el('hud-tput');        if (tp)  tp.textContent  = fmtNum(plan.throughput) + '/s';
    var tr  = el('hud-trip');        if (tr)  tr.textContent  = (s.trips || 0) + ' / ' + s.maxTrips;
    var nt  = el('hud-note');        if (nt)  nt.textContent  = noteText(s);

    /* transport — through the dock's own surface, not its DOM */
    if (dock) {
      var live = !!s.running && !s.finished;
      dock.setPlaying(!(s.paused || s.finished));
      dock.setStatus(live ? (s.sampled ? 'sampled' : 'unsampled') : '',
                     live ? (s.sampled ? 'sampled' : 'not sampled') : 'idle');
    }

    /* reading-stop progress */
    var showing = s.reading && s.dwellTotal > 0 && s.dwellLeft > 0;
    var dw = el('dwell');
    if (dw) dw.hidden = !showing;
    if (showing) {
      var bar = el('dwell-bar');
      if (bar) bar.style.width = (s.dwellLeft / s.dwellTotal * 100).toFixed(1) + '%';
    }

    /* keep the pinned/active write-up's interpolated figures live */
    var d = World.districtById[activeDistrict()];
    if (d && d.body) {
      var bodyEl = el('stage-body');
      if (bodyEl) bodyEl.textContent = interpolate(d.body, s);
    }

    paintSheet(plan, s);
    paintLag(plan);
    paintLog();
    paintOutput(s);
    updateChips();
  }

  /* ---- events ------------------------------------------------------------ */

  function onSim(name, payload) {
    if (name === 'reset') {
      _log = [];
      _filed = [];
      _pinned = null;
      _active = null;
      paint(true);
      return;
    }
    if (name !== 'station') return;

    if (payload === 'done') {
      _active = null;
      hudNote('Run complete — press R to reset or ▶ to replay');
      paint(true);
      return;
    }

    var d = World.districtById[payload];

    /* the audit emit at endTrip() is the record keeper closing a ledger, not
       a station the carrier travelled to — so it does not join the trail */
    if (payload === 'audit') {
      var s = Sim.state;
      _filed.push({
        n: s.trips || _filed.length + 1,
        end: _log.length ? _log[_log.length - 1] : 'gateway',
        receipts: s.auditEvents || 0
      });
    } else if (d) {
      _log.push(d.name || payload);
    }

    /* Follow the carrier. Only a click pins the panel; without the _pinned
       test the first station pinned itself and the narration never advanced
       past it. */
    if (!_pinned) showDistrict(payload);
  }

  /* ---- run --------------------------------------------------------------- */

  function run() {
    _log = [];
    _filed = [];
    _pinned = null;
    Sim.run();
    paint(true);
  }

  function resetAll() {
    Sim.reset();
    paint(true);
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---- init -------------------------------------------------------------- */

  function init() {
    /* The dock builds its own markup, readouts, log scales and listeners from
       DOCK_SPEC; sync() then pushes every default through onInput so Sim.state
       starts in step with it rather than the two carrying the numbers twice. */
    dock = Dock.build(DOCK_SPEC);
    dock.sync();

    buildChips();

    /* about modal — the `hidden` ATTRIBUTE, matching `.modal[hidden]` in CSS,
       so main.js's Escape handler actually closes it. It used to toggle a
       `.hidden` CLASS against a rule that set `display: flex`, so Escape
       silently did nothing. */
    var about = el('about');
    var aboutBtn = el('btn-about');
    var aboutClose = el('about-close');
    if (aboutBtn)   aboutBtn.addEventListener('click', function () { about.hidden = false; });
    if (aboutClose) aboutClose.addEventListener('click', function () { about.hidden = true; });
    if (about)      about.addEventListener('click', function (e) { if (e.target === about) about.hidden = true; });

    /* the panel toggle also frees the dock, via `.inspector.hidden ~ .dock` */
    var panelBtn = el('btn-panel');
    var insp = el('inspector');
    if (panelBtn && insp) {
      panelBtn.addEventListener('click', function () {
        var hidden = insp.classList.toggle('hidden');
        panelBtn.setAttribute('aria-expanded', String(!hidden));
        applyResponsiveLabels();
      });
    }
    global.addEventListener('resize', applyResponsiveLabels);

    /* mobile: the sheet expands to show the full write-up */
    var handle = el('sheet-handle');
    if (handle) handle.addEventListener('click', function () { setSheet(!_sheetOpen); });

    applyResponsiveLabels();
    Sim.on(onSim);
  }

  global.UI = {
    init: init,
    paint: paint,
    run: run,
    resetAll: resetAll,
    showDistrict: showDistrict,
    unpin: unpin,
    activeDistrict: activeDistrict,
    takeFlyTo: takeFlyTo,
    el: el,
    /* the dock's own surface — value/set/sync/setPlaying/setStatus/el — so a
       host or a test can drive a control without knowing its markup */
    dock: function () { return dock; }
  };
})(window);
