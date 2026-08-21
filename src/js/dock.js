/* dock.js — the transport-and-parameters dock, built from a spec.
 *
 * The dock used to be hand-authored markup in index.html plus matching wiring
 * in ui.js: adding one slider meant a <label class="field slider"> block, an
 * <input> with an id, a <b> with that id plus "-val", a wireSlider() call, and
 * — if it was logarithmic — an entry in a LOG_SLIDERS table. Five edits in two
 * files, four of which had to agree on a string. This module takes a spec and
 * does all five.
 *
 *   Dock.build({
 *     mount:     'dock',
 *     transport: [ { id:'btn-play', glyph:'❚❚', glyphId:'play-glyph', title:'…' }, … ],
 *     status:    { pipId:'carrier-pip', textId:'carrier-state', idle:'idle' },
 *     fields:    [ …descriptors shown in row 1, beside the primary… ],
 *     primary:   { id:'btn-run', label:'Start' },
 *     tune:      { id:'btn-tune', title:'Show settings' },
 *     controls:  [ …descriptors… ],
 *     onInput:   function (id, value, desc) { … }
 *   });
 *
 * Control descriptors:
 *
 *   { kind:'slider', id, label, min, max, step, value, unit, hint }
 *   { kind:'slider', scale:'log', logMax, fmt, … }   see "log scale" below
 *   { kind:'select', id, label, value, options:[{value,label}|'2'], hint }
 *   { kind:'toggles', items:[ { id, label, checked } ] }
 *   { kind:'text',   id, label, value, maxLength, grow, onEnter }
 *
 * It knows about rows, fields, sliders, selects, toggles and the mobile gear
 * drawer. It knows nothing about what any number means — that is the host's
 * spec, and the reason this file is reusable across explainers built from the
 * same kit.
 *
 * Exports: global.Dock = { build }
 */
(function (global) {
  'use strict';

  /* ---- log scale ---------------------------------------------------------
   *
   * A control that has to span orders of magnitude cannot say both ends on a
   * linear range input: at 1-131072 every useful small value is inside the
   * first pixel. So the DOM value is a fixed 0-1000 and the real figure is
   * logMax^(dom/1000). The host never sees the DOM number — onInput is always
   * handed the real one, and set() takes the real one too.
   * -------------------------------------------------------------------- */

  var LOG_DOM_MAX = 1000;

  function toReal(d, dom) {
    if (d.scale !== 'log') return d.step && d.step < 1 ? dom : Math.round(dom);
    return Math.max(1, Math.round(Math.exp(dom / LOG_DOM_MAX * Math.log(d.logMax))));
  }

  function toDom(d, real) {
    if (d.scale !== 'log') return real;
    return Math.round(Math.log(Math.max(1, real)) / Math.log(d.logMax) * LOG_DOM_MAX);
  }

  /* ---- tiny DOM helper --------------------------------------------------- */

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] === null || attrs[k] === undefined) return;
        if (k === 'text') n.textContent = attrs[k];
        else if (k === 'cls') n.className = attrs[k];
        else n.setAttribute(k, attrs[k]);
      });
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  /* ---- controls ---------------------------------------------------------- */

  function buildSlider(d, api) {
    /* The value readout keeps the "<id>-val" convention the hand-written
       markup used, so nothing outside had to learn a new id. */
    var out = h('b', { id: d.id + '-val' });
    var lab = h('span', {}, [document.createTextNode(d.label + ' '), out]);

    var input = h('input', {
      id: d.id,
      type: 'range',
      min: d.scale === 'log' ? 0 : d.min,
      max: d.scale === 'log' ? LOG_DOM_MAX : d.max,
      step: d.step || 1
    });

    var field = h('label', { cls: 'field slider', title: d.hint || null }, [lab, input]);

    function apply(fire) {
      var real = toReal(d, parseFloat(input.value));
      out.textContent = d.fmt ? d.fmt(real) : real + (d.unit || '');
      if (fire !== false) api._emit(d.id, real, d);
    }

    input.value = toDom(d, d.value);
    input.addEventListener('input', function () { apply(true); });

    api._ctl[d.id] = {
      desc: d, input: input,
      read: function () { return toReal(d, parseFloat(input.value)); },
      write: function (real) { input.value = toDom(d, real); apply(true); },
      refresh: apply
    };
    return field;
  }

  function buildSelect(d, api) {
    var sel = h('select', { id: d.id });
    (d.options || []).forEach(function (o) {
      var v = (typeof o === 'object') ? o.value : o;
      var l = (typeof o === 'object') ? o.label : o;
      sel.appendChild(h('option', { value: v, text: l }));
    });
    sel.value = String(d.value);

    var field = h('label', { cls: 'field pick', title: d.hint || null },
                  [h('span', { text: d.label }), sel]);

    sel.addEventListener('change', function () { api._emit(d.id, sel.value, d); });

    api._ctl[d.id] = {
      desc: d, input: sel,
      read: function () { return sel.value; },
      write: function (v) { sel.value = String(v); api._emit(d.id, sel.value, d); },
      refresh: function () {}
    };
    return field;
  }

  function buildToggles(d, api) {
    var group = h('div', { cls: 'group toggles' });
    (d.items || []).forEach(function (t) {
      var box = h('input', { id: t.id, type: 'checkbox' });
      box.checked = t.checked !== false;
      group.appendChild(h('label', { cls: 'toggle', title: t.hint || null },
                          [box, h('span', { text: t.label })]));
      box.addEventListener('change', function () { api._emit(t.id, box.checked, t); });
      api._ctl[t.id] = {
        desc: t, input: box,
        read: function () { return box.checked; },
        write: function (v) { box.checked = !!v; api._emit(t.id, box.checked, t); },
        refresh: function () {}
      };
    });
    return group;
  }

  /* Not used by EC — nothing here is named by hand — but the reference dock's
     first row is a text field plus the primary action, and css/dock.css still
     carries `.field.grow` / `input[type="text"]` for it. Without this the
     module could not rebuild the dock it was extracted from, which is the
     bar "reusable" has to clear. */
  function buildText(d, api) {
    var input = h('input', {
      id: d.id, type: 'text', value: d.value || '',
      maxlength: d.maxLength || null, spellcheck: 'false'
    });
    var field = h('label', { cls: 'field' + (d.grow === false ? '' : ' grow'),
                             title: d.hint || null },
                  [h('span', { text: d.label }), input]);

    input.addEventListener('input', function () { api._emit(d.id, input.value, d); });
    if (d.onEnter) {
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') d.onEnter(input.value); });
    }

    api._ctl[d.id] = {
      desc: d, input: input,
      read: function () { return input.value; },
      write: function (v) { input.value = String(v); api._emit(d.id, input.value, d); },
      refresh: function () {}
    };
    return field;
  }

  var KIND = {
    slider: buildSlider, select: buildSelect,
    toggles: buildToggles, text: buildText
  };

  /* ---- build ------------------------------------------------------------- */

  function build(spec) {
    var root = typeof spec.mount === 'string'
      ? document.getElementById(spec.mount) : spec.mount;
    if (!root) throw new Error('Dock.build: no mount element "' + spec.mount + '"');

    var api = {
      root: root,
      _ctl: {},
      _emit: function (id, value, desc) {
        if (spec.onInput) spec.onInput(id, value, desc);
      }
    };

    root.innerHTML = '';
    root.classList.add('dock');

    /* --- row 1: transport, carrier status, the primary action --- */
    var row1 = h('div', { cls: 'dock-row dock-prompt' });

    if (spec.transport && spec.transport.length) {
      var tg = h('div', { cls: 'group transport' });
      spec.transport.forEach(function (b) {
        var inner = b.glyphId ? h('span', { id: b.glyphId, text: b.glyph })
                              : document.createTextNode(b.glyph);
        var btn = h('button', { id: b.id, cls: 'icon', title: b.title || null }, [inner]);
        btn.addEventListener('click', function () { if (b.onClick) b.onClick(); });
        tg.appendChild(btn);
      });
      row1.appendChild(tg);
    }

    (spec.fields || []).forEach(function (d) {
      var fn = KIND[d.kind];
      if (!fn) throw new Error('Dock.build: unknown field kind "' + d.kind + '"');
      row1.appendChild(fn(d, api));
    });

    if (spec.status) {
      api._pip = h('span', { id: spec.status.pipId, cls: 'carrier-pip', 'aria-hidden': 'true' });
      api._pipText = h('span', { id: spec.status.textId, cls: 'carrier-state',
                                 text: spec.status.idle || 'idle' });
      row1.appendChild(api._pip);
      row1.appendChild(api._pipText);
    }

    if (spec.primary) {
      var pb = h('button', { id: spec.primary.id, cls: 'primary', text: spec.primary.label });
      pb.addEventListener('click', function () { if (spec.primary.onClick) spec.primary.onClick(); });
      row1.appendChild(pb);
    }
    root.appendChild(row1);

    /* --- row 2: the gear, then the controls it hides on a phone --- */
    var row2 = h('div', { cls: 'dock-row' });

    var tune = spec.tune || {};
    var tuneBtn = h('button', {
      id: tune.id || 'btn-tune', cls: 'icon',
      title: tune.title || 'Show settings',
      'aria-expanded': 'false', 'aria-controls': tune.paneId || 'dock-tune'
    }, [document.createTextNode(tune.glyph || '⚙')]);
    row2.appendChild(tuneBtn);

    var pane = h('div', { cls: 'dock-tune', id: tune.paneId || 'dock-tune' });
    (spec.controls || []).forEach(function (d) {
      var fn = KIND[d.kind];
      if (!fn) throw new Error('Dock.build: unknown control kind "' + d.kind + '"');
      pane.appendChild(fn(d, api));
    });
    row2.appendChild(pane);
    root.appendChild(row2);

    /* On a phone the sliders live behind the gear; on a desktop .dock-tune is
       display:contents and they flow straight into the row, so the button is
       hidden by CSS and this listener simply never fires. */
    tuneBtn.addEventListener('click', function () {
      var open = root.classList.toggle('tune-open');
      tuneBtn.setAttribute('aria-expanded', String(open));
      tuneBtn.title = open ? (tune.titleOpen || 'Hide settings') : (tune.title || 'Show settings');
    });

    /* --- public surface ---------------------------------------------------
     * Everything a host needs without reaching into the dock's DOM. */

    api.value = function (id) {
      var c = api._ctl[id];
      return c ? c.read() : undefined;
    };
    api.set = function (id, v) {
      var c = api._ctl[id];
      if (c) c.write(v);
    };
    /* Push every control's current value back through onInput. The host calls
       this once after wiring so its own state starts in step with the dock,
       instead of duplicating the defaults on both sides. */
    api.sync = function () {
      Object.keys(api._ctl).forEach(function (id) {
        var c = api._ctl[id];
        c.refresh(false);
        api._emit(id, c.read(), c.desc);
      });
    };
    api.setPlaying = function (playing) {
      spec.transport && spec.transport.forEach(function (b) {
        if (!b.glyphId || !b.playGlyph) return;
        var g = document.getElementById(b.glyphId);
        if (g) g.textContent = playing ? b.glyph : b.playGlyph;
      });
    };
    api.setStatus = function (cls, text) {
      if (api._pip) api._pip.className = 'carrier-pip' + (cls ? ' ' + cls : '');
      if (api._pipText) api._pipText.textContent = text;
    };
    api.el = function (id) {
      var c = api._ctl[id];
      return c ? c.input : document.getElementById(id);
    };

    return api;
  }

  global.Dock = { build: build };
})(window);
