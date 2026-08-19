/* ui.js: EC Factory Tour — DOM panels, sliders, narration, HUD.
 *
 * Exports:  global.UI = { init, paint, run, resetAll,
 *                          showDistrict, unpin, activeDistrict, takeFlyTo, el }
 */
(function (global) {
  'use strict';

  var Sim = global.Sim, EC = global.EC, World = global.World;
  var fmtMs = EC.fmtMs, fmtKb = EC.fmtKb, fmtNum = EC.fmtNum;

  /* ---- DOM refs ---------------------------------------------------------- */

  var _el = {};

  function el(id) { return _el[id] || (_el[id] = document.getElementById(id)); }

  /* ---- state ------------------------------------------------------------- */

  var _pinned = null;    /* district id currently pinned in the sidebar */
  var _flyTo  = null;    /* {x,y,scale} camera destination requested */
  var _pendingFlyTo = null;

  function activeDistrict() { return _pinned; }
  function takeFlyTo()      { var r = _flyTo; _flyTo = null; return r; }

  /* ---- slider wiring ----------------------------------------------------- */

  function wireSlider(sid, vidProp, min, max, isFloat) {
    var slider = el(sid);
    var valEl  = el(sid + '-val');
    if (!slider) return;
    slider.addEventListener('input', function () {
      var raw = parseFloat(slider.value);
      Sim.state[vidProp] = isFloat ? raw : Math.round(raw);
      if (valEl) valEl.textContent = raw + (sid === 'ingest-rate' ? '/s' :
                                            sid === 'doc-size'   ? ' KB' :
                                            sid === 'content-pol' ? '%' :
                                            sid === 'sample-pct'  ? '%' :
                                            sid === 'fail-rate'   ? '%' : '');
    });
    /* seed display */
    if (valEl) {
      var fmt = isFloat ? parseFloat(slider.value) : Math.round(slider.value);
      valEl.textContent = fmt + (sid === 'ingest-rate' ? '/s' :
                                 sid === 'doc-size'    ? ' KB' :
                                 sid === 'content-pol' ? '%' :
                                 sid === 'sample-pct'  ? '%' :
                                 sid === 'fail-rate'   ? '%' : '');
    }
  }

  /* ---- narration panel --------------------------------------------------- */

  function interpolate(tmpl, s) {
    return tmpl.replace(/\{(\w+)\}/g, function (_, k) {
      var v = s[k];
      if (v === undefined || v === null) return '–';
      if (typeof v === 'boolean') return v ? 'SAMPLED ✓' : 'NOT SAMPLED';
      if (k === 'bytesDownloaded' || k === 'bytesAfterMinify' || k === 'bulkBytes') return fmtKb(+v);
      if (k === 'comsWaitMs' || k === 'latencyMs') return fmtMs(+v);
      return fmtNum(+v);
    });
  }

  function showDistrict(idOrObj) {
    /* main.js passes the district object; internal calls pass the id string */
    var id = (idOrObj && typeof idOrObj === 'object') ? idOrObj.id : idOrObj;
    var d = World.districtById[id];
    if (!d) { hidePanel(); return; }

    _pinned = id;

    var panel = el('inspector');
    if (panel) panel.classList.remove('hidden');

    var s = Sim.state;
    var body = d.body ? interpolate(d.body, s) : '';

    var nameEl = el('district-name');
    if (nameEl) nameEl.textContent = d.name;

    var tagEl = el('district-tag');
    if (tagEl) tagEl.textContent = d.tag || '';

    var shortEl = el('district-short');
    if (shortEl) shortEl.textContent = d.short || '';

    var bodyEl = el('district-body');
    if (bodyEl) bodyEl.textContent = body;

    var colorBar = el('district-color-bar');
    if (colorBar) colorBar.style.background = d.color || '#445';

    /* HUD note for gate */
    if (id === 'quota') {
      hudNote(s.sampled ? 'SAMPLED — carrier continues to alerting' :
                          'NOT SAMPLED — carrier jumps to audit');
    }

    /* set camera fly destination to the district position */
    _flyTo = { x: d.x, y: d.y };
  }

  function hidePanel() {
    _pinned = null;
    var panel = el('inspector');
    if (panel) panel.classList.add('hidden');
  }

  function unpin() { hidePanel(); }

  /* ---- HUD --------------------------------------------------------------- */

  function hudNote(msg) {
    var n = el('hud-note');
    if (!n) return;
    n.textContent = msg;
    n.classList.add('visible');
    clearTimeout(n._t);
    n._t = setTimeout(function () { n.classList.remove('visible'); }, 4000);
  }

  /* ---- phase / bar chart ------------------------------------------------- */

  function paintPhaseList(plan) {
    var container = el('phase-list');
    if (!container || !plan) return;

    var html = '';
    plan.phases.forEach(function (ph) {
      var pct  = plan.totalMs > 0 ? Math.round(100 * ph.workMs / plan.totalMs) : 0;
      var warn = ph.overThresh ? ' over-thresh' : '';
      html += '<div class="phase-row' + warn + '">' +
              '<span class="ph-name">' + ph.id + '</span>' +
              '<span class="ph-bar-wrap">' +
              '<span class="ph-bar" style="width:' + Math.max(2, pct) + '%"></span>' +
              '</span>' +
              '<span class="ph-ms">' + fmtMs(ph.workMs) +
              ' <em>' + ph.replicas + 'r</em></span>' +
              '</div>';
    });
    container.innerHTML = html;
  }

  /* ---- stats bar (top-right readout) ------------------------------------- */

  function paintStats(plan, s) {
    var statsEl = el('stats-bar');
    if (!statsEl || !plan) return;

    var bottleneck = plan.bottleneck || '–';
    var html =
      '<span>Total: <b>' + fmtMs(plan.totalMs) + '</b></span>' +
      '<span>Tput: <b>' + fmtNum(plan.throughput) + '/s sampled</b></span>' +
      '<span>Bottleneck: <b>' + bottleneck + '</b></span>' +
      '<span>Trip: <b>' + (s.trips || 0) + '/' + s.maxTrips + '</b></span>';
    statsEl.innerHTML = html;
  }

  /* ---- dwell progress bar ------------------------------------------------ */

  function paintDwell(s) {
    var bar = el('dwell-bar');
    if (!bar) return;
    if (s.reading && s.dwellTotal > 0) {
      bar.classList.add('reading');
      bar.style.width = Math.round(100 * (1 - s.dwellLeft / s.dwellTotal)) + '%';
    } else {
      bar.classList.remove('reading');
      bar.style.width = '0%';
    }
  }

  /* ---- paint (called every frame from main.js) --------------------------- */

  function paint() {
    var s    = Sim.state;
    var plan = s.plan || Sim.planNow();

    paintPhaseList(plan);
    paintStats(plan, s);
    paintDwell(s);

    /* refresh panel body interpolation if pinned */
    if (_pinned) {
      var bodyEl = el('district-body');
      var d      = World.districtById[_pinned];
      if (bodyEl && d && d.body) {
        bodyEl.textContent = interpolate(d.body, s);
      }
    }

    /* play/pause button icon */
    var ppBtn = el('play-btn');
    if (ppBtn) ppBtn.textContent = s.paused ? '▶' : '❚❚';

    /* autoscale toggle label */
    var asBtn = el('autoscale-btn');
    if (asBtn) asBtn.classList.toggle('active', s.autoscaling);

    /* carrier status pip */
    var pip = el('carrier-pip');
    if (pip) {
      pip.className = 'carrier-pip ' + (s.running ? (s.sampled ? 'sampled' : 'unsampled') : '');
    }
  }

  /* ---- station event handler -------------------------------------------- */

  function onStation(name, payload) {
    if (name === 'station' && payload !== 'done') {
      if (!_pinned || _pinned === payload) {
        showDistrict(payload);
      }
    }
    if (name === 'station' && payload === 'done') {
      hudNote('Run complete — press R to reset or ▶ to replay');
    }
  }

  /* ---- run --------------------------------------------------------------- */

  function run() {
    Sim.run();
    hidePanel();
  }

  function resetAll() {
    Sim.reset();
    hidePanel();
  }

  /* ---- init -------------------------------------------------------------- */

  function init() {
    /* sliders */
    wireSlider('ingest-rate', 'ingestRate',        1,  200);
    wireSlider('doc-size',    'avgDocSizeKb',       1, 5120);
    wireSlider('content-pol', 'contentPolicyShare', 0,  100);
    wireSlider('sample-pct',  'samplingPercent',    1,  100);
    wireSlider('fail-rate',   'failureRate',        0,   10);

    /* autoscale toggle */
    var asBtn = el('autoscale-btn');
    if (asBtn) {
      asBtn.addEventListener('click', function () {
        Sim.state.autoscaling = !Sim.state.autoscaling;
      });
    }

    /* play/pause */
    var ppBtn = el('play-btn');
    if (ppBtn) ppBtn.addEventListener('click', function () { Sim.toggle(); });

    /* step button */
    var stepBtn = el('step-btn');
    if (stepBtn) stepBtn.addEventListener('click', function () { Sim.step(); });

    /* start button (hero) */
    var startBtn = el('start-btn');
    if (startBtn) startBtn.addEventListener('click', function () { run(); });

    /* reset button */
    var resetBtn = el('reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', function () { resetAll(); });

    /* replay tour */
    var replayBtn = el('replay-btn');
    if (replayBtn) replayBtn.addEventListener('click', function () { Sim.replayTour(); run(); });

    /* close panel */
    var closeBtn = el('panel-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { unpin(); });

    /* about modal */
    var aboutBtn  = el('about-btn');
    var aboutModal = el('about');
    var aboutClose = el('about-close');
    if (aboutBtn)  aboutBtn.addEventListener('click',  function () { if (aboutModal) { aboutModal.classList.remove('hidden'); aboutModal.hidden = false; } });
    if (aboutClose) aboutClose.addEventListener('click', function () { if (aboutModal) { aboutModal.classList.add('hidden'); aboutModal.hidden = true; } });

    /* pipe count select */
    var pipeSelect = el('pipeline-count');
    if (pipeSelect) {
      pipeSelect.addEventListener('change', function () {
        Sim.state.pipelineCount = parseInt(pipeSelect.value, 10) || 2;
        Sim.state.pipelineIds   = Sim.state.pipelineCount;
      });
    }

    /* station event */
    Sim.on(onStation);
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
    el: el
  };
})(window);
