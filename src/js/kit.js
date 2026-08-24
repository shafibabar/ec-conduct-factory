/* kit.js — the machine kit: the drawing vocabulary every station is built from.
 *
 * render.js owns the SCENE — what stands where, in what depth order, and which
 * drawer runs for which station. This file owns the PARTS: materials, palettes,
 * cam timing, primitives, instruments and the standard sub-assemblies. A drawer
 * in render.js should read as a bill of materials, not as a pile of polygons.
 *
 * Five rules, restated in CLAUDE.md under "Building a machine":
 *
 *   1. Three material values, not one. A near-black body has no faces.
 *   2. The plant is cold (M), the payload is warm (PAPER).
 *   3. Every moving part is on a cam — cyc() and seg(), never a free timer.
 *   4. Numbers come from the model, and readouts size their own text.
 *   5. Plan the viewer-facing face around what hangs off it. South is the
 *      darkest face AND it is LEFT on screen, so an overhanging chute covers
 *      the casing to its west.
 *
 * ctx and the clock are rebound once per frame by Kit.bind(), so every helper
 * can be aliased into render.js by name and then called without ceremony:
 *
 *     var plate = Kit.plate, readout = Kit.readout;   // once, at module scope
 *     Kit.bind(ctx, clock);                           // once, per frame
 *
 * Depends on iso.js, and at call time only on Sim.state via busy(). iso.js is
 * engine and stays closed: a genuinely new drawing primitive (frustum was the
 * first) belongs here instead.
 */
(function (global) {
  'use strict';

  var Iso = global.Iso;
  var P   = Iso.project;

  /* Rebound once per frame by render.js. Module-private, so no drawer can hold
     a stale context across a resize. */
  var ctx = null, clk = 0;

  function bind(c, t) { ctx = c; clk = t; }

  /* ---- animation gate ----------------------------------------------------
   * Movement means "this is the step happening now". Anything that turns,
   * sweeps, blinks or travels must be gated on this, so an idle machine is
   * genuinely idle apart from its standby lamp. Read lazily off the global so
   * script load order does not matter.
   * -------------------------------------------------------------------- */
  function busy(id) {
    var st = global.Sim && global.Sim.state;
    return !!st && st.station === id && !st.paused && !st.finished;
  }

  /* ---- accent colours per belt station ----------------------------------- */
  var ACCENT = {
    gateway:   '#5ab0e0',
    qualifier: '#9a88e0',
    filter:    '#e0b840',
    evaluator: '#50c0b0',
    quota:     '#f0c040',
    alerting:  '#e06880',
    echo:      '#a870d8',
    indexer:   '#e09040',
    audit:     '#d07050',
    reporting: '#c0a070'
  };

  /* ---- machine livery ----------------------------------------------------
   * Face shading in iso.js spreads TOP/RIGHT/LEFT across 1.00/0.80/0.58. That
   * only reads as three faces of one solid if the body has lightness to give
   * away: these bodies sit at ~46% L, the band the reference plant uses, so a
   * 0.58 side face still lands well clear of black. The bodies had been at
   * 11–16% L, where every face shades to the same near-black and the machine
   * collapses into a flat silhouette.
   *
   * Each entry holds its service's ACCENT hue, so hue identity along the belt
   * is unchanged — only the value moves.
   * -------------------------------------------------------------------- */
  var LIVERY = {
    gateway:   { body: '#577e94', plinth: '#243138', cap: '#749db4' },
    qualifier: { body: '#635794', plinth: '#282438', cap: '#8174b4' },
    filter:    { body: '#948557', plinth: '#383324', cap: '#b4a474' },
    evaluator: { body: '#57948b', plinth: '#243835', cap: '#74b4ab' },
    quota:     { body: '#948357', plinth: '#383224', cap: '#b4a374' },
    alerting:  { body: '#945763', plinth: '#382428', cap: '#b47481' },
    echo:      { body: '#785794', plinth: '#2f2438', cap: '#9674b4' },
    indexer:   { body: '#947557', plinth: '#382e24', cap: '#b49474' },
    audit:     { body: '#946657', plinth: '#382924', cap: '#b48474' },
    reporting: { body: '#947b57', plinth: '#383024', cap: '#b49a74' },
    /* the review/actioning cluster plus config-curator and manual-runs —
       side structures built to the same three-value discipline as the
       belt machines instead of the shared generic shell they used before */
    config:       { body: '#4a8848', plinth: '#1e3320', cap: '#6bab68' },
    manualruns:   { body: '#5870a0', plinth: '#242e42', cap: '#7a94c0' },
    review:       { body: '#506890', plinth: '#20283a', cap: '#7088b4' },
    portal:       { body: '#4a6878', plinth: '#1e2c32', cap: '#6a8ea0' },
    externalapi:  { body: '#9a7a3a', plinth: '#3a2e16', cap: '#c0a058' },
    actioning:    { body: '#704860', plinth: '#2c1c26', cap: '#966284' }
  };
  var LIVERY_DEFAULT = { body: '#6b7080', plinth: '#282b33', cap: '#8d94a4' };

  function livery(id) { return LIVERY[id] || LIVERY_DEFAULT; }

  /* The three casing values a machine is built from, derived once from its
     livery so the whole floor stays in one key: a body a shade off the livery,
     a kerb for the raised edge of the deck, and a near-black bed for the deck
     itself, so the bright steel mechanism standing in it is what the eye goes
     to. Rule 1 — three material values, not one. */
  function casing(id) {
    var lv   = livery(id);
    var body = Iso.mix(lv.body, '#2c3038', 0.20);
    return {
      body:   body,
      kerb:   Iso.shade(body, 0.78),
      tray:   Iso.mix(body, '#171a1f', 0.66),
      plinth: lv.plinth,
      cap:    lv.cap
    };
  }

  /* Rib-joint and glaze washes for the panelled body. Kept as neutral blacks
     and whites so they read the same over any livery hue. */
  var RIB   = 'rgba(0,0,0,0.26)';
  var GLAZE = 'rgba(210,232,255,0.16)';

  /* ---- face-space text --------------------------------------------------- */

  /* Render text flat onto the iso south face so it foreshortens with the
     solid. x0/y1/z0 is the world-space anchor (south face corner).
     The shear transform  ctx.transform(1, TH/TW, 0, 1, sx, sy)  makes
     horizontal screen motion match the iso-grid x direction exactly. */
  function faceText(x0, y1, z0, lines, opts) {
    var o = opts || {};
    var a = P(x0, y1, z0);
    ctx.save();
    ctx.transform(1, Iso.TH / Iso.TW, 0, 1, a.x, a.y);
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.font = (o.size || 7) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = o.color || 'rgba(200,215,240,0.55)';
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 0, i * (o.size || 7) * 1.30);
    }
    ctx.restore();
  }

  /* ---- deterministic smoke puffs ---------------------------------------- */

  /* Each puff's life is derived from the clock so nothing needs storage.
     seed distinguishes machines.  opts: rate, r0, r1, spread, rise, alpha,
     color.  Uses Iso.disc so puffs appear as flat iso ellipses. */
  function puffs(x, y, z, n, seed, opts) {
    var o = opts || {};
    var rate = o.rate || 1.0;
    for (var i = 0; i < n; i++) {
      var life = ((clk * rate) + Iso.hash2(i, seed, 5)) % 1;
      var rr   = (o.r0 || 0.10) + ((o.r1 || 0.38) - (o.r0 || 0.10)) * life;
      var dx   = (Iso.hash2(i, seed,  9) - 0.5) * (o.spread || 0.45) * life;
      var dy   = (Iso.hash2(i, seed, 13) - 0.5) * (o.spread || 0.45) * life;
      ctx.fillStyle = Iso.rgba(o.color || '#9090a8', (o.alpha == null ? 0.35 : o.alpha) * (1 - life));
      Iso.disc(ctx, x + dx, y + dy, z + life * (o.rise || 1.0), rr);
    }
  }

  /* ---- spark particles --------------------------------------------------- */

  function sparks(x, y, z, n, seed, color) {
    for (var i = 0; i < n; i++) {
      var life = ((clk * 2.2) + Iso.hash2(i, seed, 3)) % 1;
      var ang  = Iso.hash2(i, seed, 7) * 6.2832;
      var rr   = life * 0.50;
      ctx.fillStyle = Iso.rgba(color || '#ffe080', 0.85 * (1 - life));
      Iso.disc(ctx, x + Math.cos(ang) * rr, y + Math.sin(ang) * rr,
               z + life * 0.45 - life * life * 0.50, 0.040);
    }
  }

  /* ==== machine kit ========================================================
   *
   * Every station on this floor is a machine, and machines are built out of the
   * same parts: cast frames, machined steel, pipe runs, bolted flanges, lamps,
   * stencilled plates and lit readouts. This section is that parts bin.
   *
   * Rules that make a drawer read as machinery rather than as a coloured box:
   *
   *   1. Three material values, not one. A near-black body has no faces; the
   *      livery body sits mid-tone (see LIVERY) and the mechanism on top of it
   *      is brighter steel, so the eye separates casing from moving part.
   *   2. Mechanism on top and on the viewer-facing face. A machine whose whole
   *      story is painted on the roof reads as a rug at belt level.
   *   3. Every moving part is on a cam. cyc() gives the machine one repeating
   *      work cycle while its station is live; seg() cuts that cycle into named
   *      strokes. Nothing moves on a free-running timer.
   *   4. Numbers come from the model. A readout shows what model.js computed,
   *      so dragging a slider moves the machinery, not just the panel.
   *
   * Coordinates: x east, y south, z up. The camera sees the TOP face, the EAST
   * face (x+w) and the SOUTH face (y+d) — south is the darkest of the three, so
   * anything meant to be read there is drawn as a self-lit plate, not as paint.
   * ===================================================================== */

  var M = {
    steel:   '#909aa4',   /* machined and unpainted — the brightest metal    */
    steelD:  '#5d666f',
    iron:    '#4b5158',   /* castings, frames, brackets                      */
    ironD:   '#31353a',
    rubber:  '#232528',   /* seals, belts, mounts — reads as a hole          */
    brass:   '#b08a2c',   /* handwheels, tags, anything turned by a person   */
    copper:  '#a8683c',
    glass:   'rgba(150,205,230,0.28)',
    screen:  'rgba(7,13,17,0.94)',
    bezel:   'rgba(17,19,23,0.92)',
    lampOff: 'rgba(190,58,46,0.62)'
  };
  var EDGE = 'rgba(12,10,8,0.55)';

  /* The one colour rule that makes a work cycle readable at a glance: the plant
     is cold and the payload is warm. Anything the reader should read as "the
     communication" — an arriving chunk, the assembled billet, the wafer that
     survives the press, the printed ledger row, the offcut in the scrap bin —
     is drawn out of PAPER. Anything that is machinery is drawn out of M. Two
     temperatures beat any amount of extra geometry: at the zoom the reader
     actually uses, warm-on-cold is still legible when detail is not. */
  var PAPER = {
    full:  '#d9d3c5',   /* the whole document                                */
    mid:   '#bfb8a7',   /* a chunk of it, or a lamination in the billet      */
    dark:  '#8d8779',   /* the shadowed side of a stack                      */
    scrap: '#6b6355'    /* body and attachments, on their way to the bin     */
  };

  /* ---- cam timing --------------------------------------------------------- */

  /* One repeating work cycle, 0→1, while this station is the live one. At rest
     it pins to 0, which every drawer below reads as "parked". */
  function cyc(id, rate) {
    return busy(id) ? ((clk * (rate || 0.42)) % 1) : 0;
  }

  /* The stroke of a cam: 0 before a, 1 after b, eased in between. Sequencing a
     machine is then just naming the windows — fill, press, eject, print. */
  function seg(p, a, b) {
    if (p <= a) return 0;
    if (p >= b) return 1;
    var u = (p - a) / (b - a);
    return u * u * (3 - 2 * u);
  }

  /* Linear version, for anything that should travel at constant speed. */
  function segLin(p, a, b) {
    return p <= a ? 0 : p >= b ? 1 : (p - a) / (b - a);
  }

  /* ---- primitives --------------------------------------------------------- */

  /* A tapered body of revolution — hoppers, stacks, dish backs, nose cones.
     iso.js is engine and stays closed, so this lives here with the machines. */
  function frustum(o) {
    var z = o.z || 0, c = o.color;
    var bot = P(o.x, o.y, z), top = P(o.x, o.y, z + o.h);
    var a0 = o.r0 * Iso.TW * 1.41421, e0 = o.r0 * Iso.TH * 1.41421;
    var a1 = o.r1 * Iso.TW * 1.41421, e1 = o.r1 * Iso.TH * 1.41421;

    /* one path for the whole silhouette, so no seam shows down the side */
    ctx.beginPath();
    ctx.ellipse(bot.x, bot.y, a0, e0, 0, 0, Math.PI);
    ctx.lineTo(top.x - a1, top.y);
    ctx.ellipse(top.x, top.y, a1, e1, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = Iso.shade(c, 0.58);
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.fillStyle = Iso.shade(c, 0.86);
    ctx.fillRect(Math.min(top.x, bot.x) + Math.max(a0, a1) * 0.20, top.y - e1 * 2,
                 Math.max(a0, a1) * 1.30, (bot.y - top.y) + e0 * 4);
    ctx.restore();

    ctx.fillStyle = o.inner || Iso.shade(c, 1.05);
    ctx.beginPath();
    ctx.ellipse(top.x, top.y, a1, e1, 0, 0, 6.2832);
    ctx.fill();

    if (o.edge !== false) {
      ctx.strokeStyle = EDGE;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(bot.x, bot.y, a0, e0, 0, 0, Math.PI);
      ctx.moveTo(bot.x - a0, bot.y); ctx.lineTo(top.x - a1, top.y);
      ctx.moveTo(bot.x + a0, bot.y); ctx.lineTo(top.x + a1, top.y);
      ctx.stroke();
    }
  }

  /* A pipe run between two floor points at one height. */
  function pipe(x0, y0, x1, y1, z, wid, color, h) {
    var dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
    Iso.orientedBox(ctx, {
      x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: z,
      hx: dx / L, hy: dy / L, len: L, wid: wid, h: h || wid, color: color
    });
  }

  /* A flat quad lying in the south face plane (y = sf), in face coordinates
     (x across, z up). The single most used call in every drawer below. */
  function plate(x, sf, z, w, h, color) {
    ctx.fillStyle = color;
    Iso.poly(ctx, [P(x, sf, z), P(x + w, sf, z), P(x + w, sf, z + h), P(x, sf, z + h)]);
  }

  /* A free quad from four world points — ramps, chutes, anything not axis
     aligned. Corners in order round the face. */
  function quad(pts, color) {
    ctx.fillStyle = color;
    Iso.poly(ctx, [P(pts[0][0], pts[0][1], pts[0][2]), P(pts[1][0], pts[1][1], pts[1][2]),
                   P(pts[2][0], pts[2][1], pts[2][2]), P(pts[3][0], pts[3][1], pts[3][2])]);
  }

  /* A row of bolt heads along a face — the cheapest thing that turns a painted
     rectangle into a bolted-on panel. */
  function bolts(x0, x1, sf, z, n, color) {
    ctx.fillStyle = color || 'rgba(255,248,235,0.16)';
    for (var i = 0; i < n; i++) {
      var u = x0 + (x1 - x0) * ((i + 0.5) / n);
      Iso.poly(ctx, [P(u - 0.035, sf, z - 0.035), P(u + 0.035, sf, z - 0.035),
                     P(u + 0.035, sf, z + 0.035), P(u - 0.035, sf, z + 0.035)]);
    }
  }

  /* Vertical pilasters up a casing face — the stiffening ribs a sheet-metal
     panel of any size has to have, and the cheapest way to stop a wide body
     reading as one blank slab. */
  function ribs(x0, x1, sf, z, h, n) {
    for (var i = 0; i < n; i++) {
      var u = x0 + (x1 - x0) * ((i + 0.5) / n);
      plate(u - 0.05, sf, z, 0.10, h, 'rgba(255,250,240,0.075)');
      plate(u + 0.05, sf, z, 0.045, h, 'rgba(0,0,0,0.30)');
    }
  }

  /* A bolted access door with a handle and a hinge pair. */
  function door(x, sf, z, w, h, color) {
    plate(x, sf, z, w, h, color || 'rgba(0,0,0,0.26)');
    plate(x, sf, z + h - 0.03, w, 0.03, 'rgba(255,250,240,0.10)');
    plate(x, sf, z, 0.035, h, 'rgba(255,250,240,0.09)');
    plate(x + w - 0.035, sf, z, 0.035, h, 'rgba(0,0,0,0.30)');
    plate(x + w - 0.16, sf, z + h * 0.46, 0.09, 0.10, M.brass);
  }

  /* Yellow-and-black kerb striping, in face coordinates. The floor is banded
     this way already; a machine's own step edge gets the same treatment. */
  function hazardStrip(x0, x1, sf, z, h, step) {
    var n = Math.max(1, Math.round((x1 - x0) / (step || 0.26))), i;
    for (i = 0; i < n; i++) {
      plate(x0 + i * (x1 - x0) / n, sf, z, (x1 - x0) / n, h,
            i % 2 ? 'rgba(24,22,17,0.85)' : 'rgba(201,162,51,0.85)');
    }
  }

  /* Louvre bank: horizontal slats with a shadow line under each. */
  function louvres(x, sf, z, w, h, n) {
    var step = h / n;
    for (var i = 0; i < n; i++) {
      plate(x, sf, z + i * step, w, step * 0.55, 'rgba(0,0,0,0.42)');
      plate(x, sf, z + i * step + step * 0.55, w, step * 0.20, 'rgba(255,250,240,0.09)');
    }
  }

  /* An indicator lamp in its own dark cowl, so an unlit lamp still reads as a
     fitting rather than as a smudge. */
  function lamp(x, y, z, r, on, onColor, rate) {
    ctx.fillStyle = 'rgba(9,11,13,0.85)';
    Iso.disc(ctx, x, y, z, r * 1.4);
    ctx.fillStyle = on
      ? Iso.rgba(onColor || '#5ad24e', 0.70 + 0.30 * Math.sin(clk * (rate || 7)))
      : M.lampOff;
    Iso.disc(ctx, x, y, z + 0.01, r);
  }

  /* A recessed, self-lit readout on a face. Mono text over a dark screen with a
     bezel: the one place a machine is allowed to use words and figures. */
  function readout(x, sf, z, w, h, lines, opts) {
    var o = opts || {};
    var i, longest = 0;
    for (i = 0; i < lines.length; i++) longest = Math.max(longest, lines[i].length);

    /* Size the text to the plate rather than the other way round. Text is laid
       out in iso-screen pixels — Iso.TW px to a world unit across, Iso.TZ up —
       so a figure that grows (128.0 MB, 26 chunks) can silently run off the
       end of a casing. Fitting here means no drawer has to hand-tune a font
       size against its longest possible string. */
    var pad  = 0.08;
    var byW  = (w - pad * 2) * Iso.TW / Math.max(1, longest * 0.62);
    var byH  = (h - pad * 1.4) * Iso.TZ / Math.max(1, lines.length * 1.30);
    var size = Math.min(o.size || 6.5, byW, byH);

    plate(x - 0.07, sf, z - 0.07, w + 0.14, h + 0.14, o.bezel || M.bezel);
    plate(x, sf, z, w, h, o.screen || M.screen);
    plate(x, sf, z + h * 0.55, w, h * 0.45, 'rgba(130,190,225,0.045)');
    faceText(x + pad, sf, z + h - pad * 0.7, lines,
             { size: size, color: o.color || '#78cff2' });
  }

  /* A stencilled plate name, painted straight onto the casing. */
  function stencil(x, sf, z, text, opts) {
    var o = opts || {};
    faceText(x, sf, z, [text], { size: o.size || 6.0, color: o.color || 'rgba(228,238,250,0.46)' });
  }

  /* A grid of cells on a face — a lamp matrix. Used wherever a service holds a
     count against a hard ceiling, which on this platform is most of them. */
  function matrix(x, sf, z, cols, rows, cell, lit, installed, onColor, offColor) {
    var gap = cell * 0.18, r, c, n;
    var w = cols * cell + (cols - 1) * gap, h = rows * cell + (rows - 1) * gap;
    /* a bezel, so an all-dark matrix still reads as an instrument and not as a
       smudge on the casing */
    plate(x - gap * 2.2, sf, z - gap * 2.2, w + gap * 4.4, h + gap * 4.4, '#565f69');
    plate(x - gap * 1.2, sf, z - gap * 1.2, w + gap * 2.4, h + gap * 2.4, '#0e1216');
    for (r = rows - 1; r >= 0; r--) {
      for (c = 0; c < cols; c++) {
        n = (rows - 1 - r) * cols + c;
        plate(x + c * (cell + gap), sf, z + r * (cell + gap), cell, cell,
              n < lit       ? (onColor  || '#5ab0e0')
            : n < installed ? (offColor || 'rgba(90,176,224,0.44)')
                            : 'rgba(190,208,226,0.13)');
      }
    }
  }

  /* A vertical column of four braced bays — a lattice mast. Not machinery:
     kept for the two things on this floor that genuinely are structures. */
  function lattice(x, y, z, h, r, bays, color) {
    var i, s, a, b, k = h / bays;
    for (i = 0; i < 4; i++) {
      var ox = (i % 2 ? 1 : -1) * r, oy = (i < 2 ? -1 : 1) * r;
      Iso.box(ctx, { x: x + ox - 0.080, y: y + oy - 0.080, z: z, w: 0.16, d: 0.16,
                     h: h, color: color });
    }
    ctx.strokeStyle = Iso.rgba(Iso.shade(color, 0.72), 0.95);
    ctx.lineWidth = 2.0;
    for (i = 0; i <= bays; i++) {
      Iso.polyLine(ctx, [P(x - r, y - r, z + i * k), P(x + r, y - r, z + i * k),
                         P(x + r, y + r, z + i * k), P(x - r, y + r, z + i * k)], true);
    }
    for (i = 0; i < bays; i++) {
      a = z + i * k; b = z + (i + 1) * k;
      s = (i % 2) ? 1 : -1;
      Iso.polyLine(ctx, [P(x - r, y + s * r, a), P(x + r, y + s * r, b)]);
      Iso.polyLine(ctx, [P(x + s * r, y - r, a), P(x + s * r, y + r, b)]);
    }
  }

  /* Debris falling under gravity into a bin — the visible cost of an operation
     that throws most of its input away. */
  function chips(x, y, z, n, seed, color, life0) {
    for (var i = 0; i < n; i++) {
      var life = ((clk * 1.6) + Iso.hash2(i, seed, 3)) % 1;
      if (life0 != null && life > life0) continue;
      var ang = Iso.hash2(i, seed, 7) * 6.2832;
      var rr  = 0.10 + life * 0.55;
      ctx.fillStyle = Iso.rgba(color || '#2c3138', 0.85 - life * 0.35);
      Iso.disc(ctx, x + Math.cos(ang) * rr * 0.6, y + rr,
               z - life * life * 1.7, 0.055 + Iso.hash2(i, seed, 11) * 0.035);
    }
  }

  /* KEDA replicas as a stack of cans on a roof, at an explicit spot. Drawn from
     inside a machine's own drawer so it stays in the depth-sorted pass — drawn
     outside it, the stack floats over the carrier. */
  /* KEDA replicas as a rack of cans on a roof: green at the three-replica
     floor, red once that consumer is past its own lagThreshold. o.cols and
     o.pitch let a machine fit the rack to whatever flat it has spare —
     ec-gateway scales to 18, and a 4-wide rack at the default pitch would
     spill off the deck and into the press frame. */
  function replicaStack(x, y, z, ph, o) {
    if (!ph) return;
    o = o || {};
    var cols  = o.cols  || 4;
    var pitch = o.pitch || 0.42;
    var col = ph.overThresh ? '#a83020' : '#2a7030';
    var n = Math.min(o.max || 12, ph.replicas || 0);
    for (var r = 0; r < n; r++) {
      Iso.cylinder(ctx, { x: x - (r % cols) * pitch, y: y + Math.floor(r / cols) * pitch,
                          z: z + 0.02, r: pitch * 0.45, h: pitch, color: col, edge: false });
    }
    if (ph.overThresh) {
      ctx.fillStyle = 'rgba(255,110,80,' + (0.5 + 0.45 * Math.abs(Math.sin(clk * 4))).toFixed(2) + ')';
      Iso.disc(ctx, x + pitch * 0.7, y - pitch * 0.7, z + pitch * 1.2, 0.13);
    }
  }

  /* ---- floor-plane text ---------------------------------------------------
   * faceText lies on a vertical face; this lies flat on the slab, for lane
   * markings and painted bay names. dir 'x' reads along +x, dir 'y' along +y.
   * Both transforms have determinant 1, so glyphs are never mirrored. */
  function floorText(x, y, z, lines, opts) {
    var o = opts || {};
    var a = P(x, y, z || 0.02);
    ctx.save();
    if (o.dir === 'y') ctx.transform(-1, 0.5, -1, -0.5, a.x, a.y);
    else               ctx.transform( 1, 0.5, -1,  0.5, a.x, a.y);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = (o.weight ? o.weight + ' ' : '') +
               (o.size || 7) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = o.color || 'rgba(226,232,244,0.42)';
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 0, i * (o.size || 7) * 1.30);
    }
    ctx.restore();
  }

  /* ---- inserter -----------------------------------------------------------
   * The swing-arm that moves one item between the line and a machine. Ported
   * from the reference plant, with the pivot height and the claw's payload
   * made explicit so a bay can say what is being carried and when.
   *
   * phase 0..1 drives a cosine swing from ang0 to ang1 and back; world angles,
   * so 0 is east and +PI/2 is south. */
  function inserter(x, y, ang0, ang1, phase, color, opts) {
    var o = opts || {};
    var z0 = o.z || 0;
    var swing = 0.5 - 0.5 * Math.cos(phase * 6.2832);
    var ang = ang0 + (ang1 - ang0) * swing;
    var reach = o.reach || 0.92;
    var base = P(x, y, z0 + 0.34);
    var tip  = P(x + Math.cos(ang) * reach, y + Math.sin(ang) * reach, z0 + 0.62);

    Iso.box(ctx, { x: x - 0.19, y: y - 0.19, z: z0, w: 0.38, d: 0.38, h: 0.34,
                   color: M.iron });

    /* enhanced arm with thicker stroke and elbow detail */
    ctx.strokeStyle = color || M.brass;
    ctx.lineWidth = o.lw || 3.2;
    ctx.lineCap = 'round';

    /* main arm link */
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    /* add elbow joint visual — halfway point gets a small reinforcement */
    var midX = base.x + (tip.x - base.x) * 0.5;
    var midY = base.y + (tip.y - base.y) * 0.5;
    ctx.fillStyle = color || M.brass;
    ctx.beginPath();
    ctx.arc(midX, midY, (o.lw || 3.2) * 0.6, 0, 6.2832);
    ctx.fill();

    ctx.lineCap = 'butt';

    /* the claw carries something home on the return half of the swing */
    var carrying = (o.carry != null) ? o.carry : (swing > 0.5);
    var clawSize = o.claw || 3.4;

    /* claw with enhanced detail */
    ctx.fillStyle = carrying ? (o.payload || PAPER.full) : M.steelD;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, clawSize, 0, 6.2832);
    ctx.fill();

    /* claw highlight for depth */
    ctx.fillStyle = carrying ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.arc(tip.x + clawSize * 0.3, tip.y - clawSize * 0.3, clawSize * 0.35, 0, 6.2832);
    ctx.fill();
  }


  /* ---- hazard banding on the floor plane ---------------------------------
   * hazardStrip() paints a machine's kerb in face coordinates; this paints the
   * slab itself, along an arbitrary run. Thin, because a service trench is
   * marked, not fenced. */
  function hazardFloor(x0, y0, x1, y1, width, z, o) {
    o = o || {};
    var dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
    var nx = -dy / L * width / 2, ny = dx / L * width / 2;
    var n = Math.max(1, Math.round(L / (o.step || 0.34))), i, t0, t1;
    for (i = 0; i < n; i++) {
      t0 = i / n; t1 = (i + 1) / n;
      quad([[x0 + dx * t0 + nx, y0 + dy * t0 + ny, z],
            [x0 + dx * t1 + nx, y0 + dy * t1 + ny, z],
            [x0 + dx * t1 - nx, y0 + dy * t1 - ny, z],
            [x0 + dx * t0 - nx, y0 + dy * t0 - ny, z]],
           i % 2 ? (o.dark || 'rgba(24,22,17,0.75)')
                 : (o.light || 'rgba(201,162,51,0.72)'));
    }
  }

  /* ---- move a whole assembly ---------------------------------------------
   * A machine's drawer is authored around fixed floor coordinates — the press
   * knows it starts at x 11.35 — and re-deriving sixty of them to move it is
   * both tedious and a good way to introduce a subtle error.
   *
   * In this projection a translation in WORLD space is exactly a translation in
   * screen space: project(x+dx, y+dy, z) = project(x,y,z) + ((dx-dy)·TW,
   * (dx+dy)·TH). So a machine can be relocated by shifting the canvas under it,
   * with no change to its internals at all.
   *
   * Only the drawing moves. The object's depth key still comes from its entry
   * in World, so set that to the new position too — and anything that must be
   * placed against the machine's NEW surroundings rather than carried with it,
   * a transfer bay reaching for a belt that is now on a different side, goes
   * outside the call.
   */
  function atWorld(dx, dy, fn) {
    ctx.save();
    ctx.translate((dx - dy) * Iso.TW, (dx + dy) * Iso.TH);
    fn();
    ctx.restore();
  }

  /* ---- pulse --------------------------------------------------------------
   * The travelling glow that says something is being carried, shared by the
   * trench and the overhead tubes. t is 0..1 along the segment and comes from
   * the SENDING machine's own cam — pass segLin(p, a, b) — so a relay only
   * lights while the machine at its far end is actually working. Off the cam
   * it is a no-op, which is what keeps an idle floor idle. */
  function pulse(ax, ay, az, bx, by, bz, t, color, o) {
    if (!(t > 0 && t < 1)) return;
    o = o || {};
    var n = o.trail || 4, gap = o.gap || 0.045, i, u, f;
    for (i = n - 1; i >= 0; i--) {
      u = t - i * gap;
      if (u <= 0) continue;
      f = 1 - i / n;
      ctx.fillStyle = Iso.rgba(color || '#8fd6a0', (o.alpha || 0.90) * f * f);
      Iso.disc(ctx, ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u,
               (o.r || 0.12) * (0.45 + 0.55 * f));
    }
  }

  /* ---- recessed trench ----------------------------------------------------
   * A gutter cut into the slab, carrying receipts from the machines to the
   * record keeper.
   *
   * This is the only network on the floor that can cross the belt freely, and
   * the reason is that it lives at NEGATIVE z. The slab is laid first, the cut
   * goes in on top of it, and every solid on the floor is drawn later and
   * higher — so a trench can never contend with the carrier for depth. Draw it
   * from the decal pass, before any solid.
   *
   * Axis-aligned runs only. From this camera the FAR side of the cut is the one
   * you see into, because its inner wall is the face pointing at the viewer.
   * The NEAR kerb is what stops the bottom appearing to fall out past the lip,
   * so it has to be wide enough to cover the depth in screen space: at depth
   * 0.22 that is about 0.30, and the default is set from that.
   *
   * Order the endpoints in the direction of travel — the pulse runs x0,y0 →
   * x1,y1 regardless of which end is geometrically first.
   *
   * o = { width, depth, kerb, cap, hazard, pulse: 0..1, pulseColor }
   */
  function trench(x0, y0, x1, y1, o) {
    o = o || {};
    /* Narrow and deep reads as a channel; wide and shallow reads as a black
        stripe painted on the floor. The wall has to be a decent fraction of the
        width or there is nothing to see into. */
    var HW = (o.width || 0.58) / 2;
    var D  = o.depth || 0.34;
    var K  = o.kerb  || 0.34;
    var vert = Math.abs(x1 - x0) < 1e-6;

    var aA = vert ? y0 : x0, aB = vert ? y1 : x1;
    var a0 = Math.min(aA, aB), a1 = Math.max(aA, aB), len = a1 - a0;
    var cr = vert ? x0 : y0;

    /* (along, across, z) -> world triple */
    function W3(a, c, z) { return vert ? [cr + c, a, z] : [a, cr + c, z]; }
    function lbox(aS, cS, aLen, cLen, z, h, col) {
      Iso.box(ctx, vert
        ? { x: cr + cS, y: aS, z: z, w: cLen, d: aLen, h: h, color: col, edge: false }
        : { x: aS, y: cr + cS, z: z, w: aLen, d: cLen, h: h, color: col, edge: false });
    }

    /* The kerb has to be lighter than the slab (#5f5d57) or the lip vanishes:
        a raised edge that matches the floor is not a raised edge. */
    var KERB = o.kerbColor || '#807d75';

    /* far kerb first: it is behind everything else in this assembly */
    lbox(a0, -HW - K, len, K, 0, 0.05, KERB);

    /* the cut, and the far wall you look into */
    quad([W3(a0, -HW, -D), W3(a1, -HW, -D), W3(a1, HW, -D), W3(a0, HW, -D)],
         o.floorColor || '#191d23');
    quad([W3(a0, -HW, 0), W3(a1, -HW, 0), W3(a1, -HW, -D), W3(a0, -HW, -D)],
         o.wallColor || '#333c45');
    /* a lit top edge on the far wall, so the cut has a rim rather than fading
       into the slab */
    quad([W3(a0, -HW, 0), W3(a1, -HW, 0), W3(a1, -HW, -0.035), W3(a0, -HW, -0.035)],
         'rgba(232,238,246,0.22)');
    if (o.cap !== false) {
      quad([W3(a1, -HW, 0), W3(a1, HW, 0), W3(a1, HW, -D), W3(a1, -HW, -D)],
           o.wallColor || '#333c45');
    }

    /* the pulse rides the bottom, under the near lip */
    if (o.pulse > 0 && o.pulse < 1) {
      pulse(x0, y0, -D + 0.06, x1, y1, -D + 0.06, o.pulse,
            o.pulseColor || '#8fd6a0', { r: 0.11, trail: 5 });
    }

    /* near kerb last, so it covers the bottom past the lip */
    lbox(a0, HW, len, K, 0, 0.05, KERB);

    if (o.hazard !== false) {
      var hz = HW + K + 0.10;
      hazardFloor(vert ? cr + hz : a0, vert ? a0 : cr + hz,
                  vert ? cr + hz : a1, vert ? a1 : cr + hz,
                  0.15, 0.014, { step: 0.26 });
    }
  }

  /* ---- overhead tube run --------------------------------------------------
   * Capsule tubes carrying the record keeper's own outbound traffic. At
   * z ~ 4.5 a run projects roughly 170 px ABOVE the carrier, so it crosses the
   * belt without ever overlapping it in screen space — which means the
   * horizontal run may be drawn in a late pass, after the sorted one, as
   * genuinely-above-everything.
   *
   * Its STANCHIONS may not: a post reaches down to the floor and has to sort
   * against the carrier like any other solid. Use tubePost() for those and put
   * them in the depth-sorted pass.
   */
  function tubeRun(x0, y0, x1, y1, z, o) {
    o = o || {};
    var r  = o.width || 0.20;
    var dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;

    pipe(x0, y0, x1, y1, z, r, o.color || M.steelD, r * 0.92);
    /* a lit crown along the top: without it an oriented box reads as a girder
       rather than as a tube */
    pipe(x0, y0, x1, y1, z + r * 0.92 - 0.035, r * 0.44,
         Iso.shade(o.color || M.steelD, 1.32), 0.05);

    /* collars, so a long run does not read as one extruded bar */
    var n = Math.max(1, Math.round(L / 2.4)), i, t;
    for (i = 1; i < n; i++) {
      t = i / n;
      Iso.box(ctx, { x: x0 + dx * t - r * 0.78, y: y0 + dy * t - r * 0.78,
                     z: z - 0.035, w: r * 1.56, d: r * 1.56, h: r * 1.14,
                     color: M.iron });
    }
    if (o.pulse > 0 && o.pulse < 1) {
      pulse(x0, y0, z + r * 0.55, x1, y1, z + r * 0.55, o.pulse,
            o.pulseColor || '#7fd4ff', { r: 0.13, trail: 3, gap: 0.05 });
    }
  }

  /* A stanchion carrying an overhead run. Belongs in the depth-sorted pass. */
  function tubePost(x, y, z, o) {
    o = o || {};
    Iso.box(ctx, { x: x - 0.17, y: y - 0.17, z: 0, w: 0.34, d: 0.34, h: 0.15,
                   color: M.ironD });
    Iso.box(ctx, { x: x - 0.09, y: y - 0.09, z: 0.15, w: 0.18, d: 0.18,
                   h: Math.max(0.1, z - 0.15), color: o.color || M.iron });
    Iso.box(ctx, { x: x - 0.21, y: y - 0.21, z: z - 0.07, w: 0.42, d: 0.42,
                   h: 0.11, color: M.steelD });
  }


  /* ---- reel ---------------------------------------------------------------
   * A spool with a turning face: anything that pays out or takes up a strip.
   * spin is an angle in radians — pass 0 to park it. */
  function reel(x, y, z, r, spin, color) {
    Iso.cylinder(ctx, { x: x, y: y, z: z, r: r, h: r * 0.55,
                        color: color || M.steelD, ring: 0.5 });
    Iso.gear(ctx, x, y, z + r * 0.57, r * 0.86, 8, spin || 0,
             Iso.shade(color || M.steelD, 1.25));
    ctx.fillStyle = 'rgba(12,14,17,0.75)';
    Iso.disc(ctx, x, y, z + r * 0.59, r * 0.20);
  }

  /* ---- gauge column -------------------------------------------------------
   * A dark track with a coloured fill to `frac`. Wherever a service holds a
   * count against a limit — the quota counter, the reconciliation columns, the
   * evaluator's waiting slots against the COMS ceiling.
   *
   * o.ceiling draws a hard line across the track at that fraction, for a limit
   * the fill is allowed to pass; o.over recolours the overshoot. */
  function gaugeCol(x, y, z, w, hMax, frac, fillClr, o) {
    o = o || {};
    /* Track is mid-tone, not near-black: an empty gauge should read as an empty
       tube standing on the deck, not as a hole cut out of the machine. */
    Iso.box(ctx, { x: x, y: y, z: z, w: w, d: w, h: hMax,
                   color: o.track || '#2b3346', edge: 'rgba(120,145,200,0.45)' });
    var f  = Math.max(0, frac);
    var fh = Math.max(0.04, hMax * Math.min(o.max || 1, f));
    Iso.box(ctx, { x: x+0.04, y: y+0.04, z: z, w: w-0.08, d: w-0.08, h: fh,
                   color: (o.ceiling != null && f > o.ceiling && o.over) ? o.over : fillClr,
                   edge: false });
    if (o.ceiling != null) {
      Iso.box(ctx, { x: x-0.03, y: y-0.03, z: z + hMax * o.ceiling,
                     w: w+0.06, d: w+0.06, h: 0.035,
                     color: o.ceilingColor || '#d0402c', edge: false });
    }
  }

  /* ---- bin row ------------------------------------------------------------
   * A rank of open bins with fill levels — one per pipeline, per verdict, per
   * window, whatever the machine sorts into. fills is an array of 0..1; a bin
   * whose fill is null is drawn as installed-but-empty.
   *
   * o = { w, d, h, gap, color, fill, lit, labels, sf }
   *   lit    index of the bin to highlight, or -1
   *   labels optional array stencilled on the bin fronts (needs o.sf)
   */
  function binRow(x, y, z, n, fills, o) {
    o = o || {};
    var w   = o.w   || 0.46, d = o.d || 0.62, h = o.h || 0.52;
    var gap = o.gap || 0.10;
    var shell = o.color || M.iron;
    var i, bx, f;
    for (i = 0; i < n; i++) {
      bx = x + i * (w + gap);
      /* the bin: two walls and a floor, open at the top so the level shows */
      Iso.box(ctx, { x: bx, y: y, z: z, w: w, d: d, h: h,
                     color: (o.lit === i) ? Iso.mix(shell, '#e8f0ff', 0.28) : shell });
      Iso.box(ctx, { x: bx + 0.05, y: y + 0.05, z: z + h - 0.02, w: w - 0.10,
                     d: d - 0.10, h: 0.02, color: '#101418' });
      f = fills && fills[i];
      if (f != null && f > 0) {
        Iso.box(ctx, { x: bx + 0.05, y: y + 0.05, z: z + 0.04,
                       w: w - 0.10, d: d - 0.10,
                       h: Math.max(0.03, (h - 0.08) * Math.min(1, f)),
                       color: o.fill || PAPER.mid, edge: false });
      }
      if (o.labels && o.labels[i] && o.sf != null) {
        stencil(bx + 0.04, o.sf, z + 0.08, o.labels[i],
                { size: o.labelSize || 3.6, color: 'rgba(226,236,250,0.50)' });
      }
    }
    return { w: n * w + (n - 1) * gap };
  }

  /* ---- receipt duct -------------------------------------------------------
   * Every service performs one decision and emits one receipt, and that fan-in
   * is the platform's actual product. It is also the one connection the belt
   * cannot carry: the audit topic has five producers spread across three rows
   * of this floor, and a solid crossing the belt fights the carrier for depth.
   *
   * So a receipt leaves through the floor. This is the hooded hatch on a
   * machine's apron that it goes through; the trench it joins is painted, and
   * gets laid once enough machines have one. See FLOOR-TOPOLOGY.md.
   *
   * o = { phase 0..1 cam, drop [a,b] window, label, accent }
   */
  function receiptDuct(x, y, o) {
    o = o || {};
    var p    = o.phase || 0;
    var drop = o.drop || [0.70, 0.84];
    var t    = p > 0 ? segLin(p, drop[0], drop[1]) : 0;

    /* the pit, and the kerb round it */
    Iso.box(ctx, { x: x - 0.42, y: y - 0.34, z: 0, w: 0.84, d: 0.68, h: 0.11,
                   color: M.ironD });
    quad([[x - 0.33, y - 0.25, 0.115], [x + 0.33, y - 0.25, 0.115],
          [x + 0.33, y + 0.25, 0.115], [x - 0.33, y + 0.25, 0.115]], '#0b0e11');
    /* the hood over it, on two legs, with the duct rising into the machine */
    Iso.box(ctx, { x: x - 0.38, y: y - 0.30, z: 0.11, w: 0.09, d: 0.09, h: 0.46,
                   color: M.iron });
    Iso.box(ctx, { x: x + 0.29, y: y - 0.30, z: 0.11, w: 0.09, d: 0.09, h: 0.46,
                   color: M.iron });
    Iso.box(ctx, { x: x - 0.42, y: y - 0.36, z: 0.57, w: 0.84, d: 0.42, h: 0.13,
                   color: M.steelD });
    Iso.cylinder(ctx, { x: x, y: y - 0.16, z: 0.70, r: 0.13, h: 0.64, color: M.iron });

    /* the receipt itself, on its way down */
    if (t > 0 && t < 1) {
      ctx.fillStyle = Iso.rgba(o.accent || '#e8dfc6', 1 - t * 0.55);
      Iso.disc(ctx, x, y, 0.62 - t * 0.52, 0.11);
    }
    /* filed lamp: on for the rest of the cycle once it has gone */
    lamp(x + 0.30, y + 0.20, 0.24, 0.075, p > 0 && t >= 1, o.accent || '#8fd6a0', 3);

    if (o.label) {
      floorText(x - 0.40, y + 0.46, 0.03, [o.label],
                { size: 3.8, color: 'rgba(226,236,250,0.34)' });
    }
  }

  /* ---- transfer bay -------------------------------------------------------
   * How a machine is connected to the line, and the reason the machines stand
   * back from it at all.
   *
   * A service does not sit on a topic. It consumes a message from one topic,
   * does its work, and produces a *different* message to a *different* topic —
   * so a machine straddling the belt would be a lie. The bay makes the real
   * shape visible: an intake arm reaching to the belt segment upstream of the
   * machine, a spur carrying the payload up to the casing, and an outfeed arm
   * placing onto the segment downstream. The two arms point at two differently
   * named stretches of floor, which is the topic change happening in view.
   *
   * The spur is also where the queue stands. `queue` is consumer lag as a
   * fraction of that service's own lagThreshold, so a spur backing up is the
   * same fact the roof's replica stack is about to react to.
   *
   * TWO AXES. A machine beside a horizontal belt run gets a north-south spur
   * (axis 'y', the default). A machine beside a vertical run — the turn — gets
   * an east-west one (axis 'x'). Only the connection rotates: the machine
   * itself stays reading west-to-east, because every instrument in this kit is
   * written for the south face.
   *
   * `flow` is the belt's direction of travel at this bay, and it decides which
   * way each arm splays. It is not derivable from the geometry: the top run
   * travels east and the middle run travels west, and a bay on the middle row
   * that assumed east would reach its intake arm downstream.
   *
   * o = {
   *   axis      'y' (default) | 'x'
   *   x, yMachine, yBelt       for axis 'y'
   *   y, xMachine, xBelt       for axis 'x'
   *   flow      'e' | 'w' | 'n' | 's'; defaults to 'e' on a y-spur, 's' on an x-spur
   *   phase     0..1 work cycle from cyc(); 0 parks everything
   *   arms      'both' | 'in' | 'out'
   *   inSwing / upRun / downRun / outSwing   cam windows
   *   accent, label, queue 0..1, over
   * }
   */
  function transferBay(o) {
    var vert = (o.axis || 'y') === 'y';
    var cr   = vert ? o.x : o.y;                      /* the fixed perpendicular */
    var mA   = vert ? o.yMachine : o.xMachine;        /* along, at the machine   */
    var bA   = vert ? o.yBelt    : o.xBelt;           /* along, at the belt      */
    var dir  = bA > mA ? 1 : -1;
    var p    = o.phase || 0;
    var arms = o.arms || 'both';
    var AC   = o.accent || '#5ab0e0';
    var HW   = o.width ? o.width / 2 : 0.52;

    var a0 = Math.min(mA, bA), a1 = Math.max(mA, bA), len = a1 - a0;
    var DECK = 0.30;
    var i, ly;

    /* local frame: (along, across) -> world */
    function LX(a, c) { return vert ? cr + c : a; }
    function LY(a, c) { return vert ? a : cr + c; }
    function lbox(aS, cS, aLen, cLen, z, h, col) {
      Iso.box(ctx, vert
        ? { x: cr + cS, y: aS, z: z, w: cLen, d: aLen, h: h, color: col }
        : { x: aS, y: cr + cS, z: z, w: aLen, d: cLen, h: h, color: col });
    }

    /* --- the spur: a gravity roller table, deliberately NOT built like the
           belt. The belt is the topic and it is the only conveyor on the
           floor; a second one running at right angles to it just reads as a
           junction. Legs, side rails and bare rollers say "transfer". --- */
    ctx.fillStyle = 'rgba(18,16,13,0.24)';
    Iso.ribbon(ctx, LX(a0, 0), LY(a0, 0), LX(a1, 0), LY(a1, 0), HW * 2 + 0.20, 0.011);

    var legs = Math.max(2, Math.round(len / 1.05));
    for (i = 0; i <= legs; i++) {
      ly = a0 + (len - 0.14) * (i / legs);
      lbox(ly, -HW, 0.11, 0.11, 0, DECK, M.ironD);
      lbox(ly, HW - 0.11, 0.11, 0.11, 0, DECK, M.ironD);
    }
    /* side rails */
    lbox(a0, -HW, len, 0.10, DECK, 0.13, M.iron);
    lbox(a0, HW - 0.10, len, 0.10, DECK, 0.13, M.iron);
    /* rollers, running across the table — animated when payload moves */
    var rollers = Math.max(3, Math.round(len / 0.30));
    var movementPhase = (segLin(p, 0.08, 0.28) + segLin(p, 0.74, 0.90)) * 0.5; /* combined up + down */
    for (i = 0; i < rollers; i++) {
      ly = a0 + (i + 0.5) * len / rollers;
      /* roller spin: add rotation offset based on movement phase */
      var spinOffset = movementPhase * Math.PI * 2;  /* full rotation during movement */
      var rotateSeed = (i * 0.618 + spinOffset) % (Math.PI * 2);

      Iso.orientedBox(ctx, {
        x: LX(ly, 0), y: LY(ly, 0), z: DECK + 0.02,
        hx: vert ? 1 : 0, hy: vert ? 0 : 1,
        len: HW * 2 - 0.20, wid: 0.13, h: 0.09,
        color: i % 2 ? M.steel : M.steelD
      });
      /* add visual grooves to indicate rotation */
      ctx.fillStyle = 'rgba(60,50,40,0.35)';
      var grooveA = rotateSeed, grooveB = rotateSeed + Math.PI / 2;
      Iso.disc(ctx, LX(ly, -0.02), LY(ly, -0.02), DECK + 0.13, 0.04);
      Iso.disc(ctx, LX(ly, 0.02), LY(ly, 0.02), DECK + 0.13, 0.04);
    }

    if (o.label) {
      floorText(LX(mA + dir * 0.30, HW + 0.16), LY(mA + dir * 0.30, HW + 0.16),
                0.03, [o.label],
                { size: 4.2, color: 'rgba(226,236,250,0.38)' });
    }

    /* --- the queue: what is waiting on this consumer, against its own
           lagThreshold. A full table means KEDA is about to add replicas. --- */
    var q = Math.max(0, Math.min(1, o.queue || 0));
    var slots = Math.max(1, Math.floor(len / 0.42) - 1);
    var waiting = Math.round(q * slots);
    for (i = 0; i < waiting; i++) {
      ly = mA + dir * (0.36 + i * 0.42);
      var qColor = o.over ? (i % 2 ? '#b8503c' : '#a0432f')
                          : (i % 2 ? PAPER.mid : PAPER.dark);
      lbox(ly - 0.14, -0.19, 0.28, 0.38, DECK + 0.11, 0.19, qColor);

      /* add visual detail to queue blocks — stack indicator */
      var darkColor = o.over ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.15)';
      ctx.fillStyle = darkColor;
      Iso.box(ctx, vert
        ? { x: cr - 0.19, y: ly - 0.14, z: DECK + 0.26, w: 0.38, d: 0.28, h: 0.04 }
        : { x: ly - 0.14, y: cr - 0.19, z: DECK + 0.26, w: 0.28, d: 0.38, h: 0.04 });
    }
    if (o.over && waiting) {
      ctx.fillStyle = 'rgba(255,110,80,' + (0.45 + 0.45 * Math.abs(Math.sin(clk * 4))).toFixed(2) + ')';
      Iso.disc(ctx, LX(mA + dir * 0.12, 0), LY(mA + dir * 0.12, 0), DECK + 0.40, 0.10);
    }

    /* --- the payload, on its way up to the machine and back down --- */
    var up   = segLin(p, (o.upRun   || [0.08, 0.28])[0], (o.upRun   || [0.08, 0.28])[1]);
    var down = segLin(p, (o.downRun || [0.74, 0.90])[0], (o.downRun || [0.74, 0.90])[1]);

    if (p > 0 && up > 0 && up < 1) {
      ly = bA - dir * up * len;
      ctx.fillStyle = PAPER.full;
      Iso.disc(ctx, LX(ly, 0), LY(ly, 0), DECK + 0.20, 0.14);
      /* add guide rail shadows to show payload motion path */
      ctx.fillStyle = 'rgba(60,50,40,0.25)';
      Iso.disc(ctx, LX(ly, -HW * 0.7), LY(ly, -HW * 0.7), DECK + 0.20, 0.03);
      Iso.disc(ctx, LX(ly, HW * 0.7), LY(ly, HW * 0.7), DECK + 0.20, 0.03);
    }
    if (p > 0 && down > 0 && down < 1) {
      ly = mA + dir * down * len;
      ctx.fillStyle = Iso.mix(PAPER.full, AC, 0.45);
      Iso.disc(ctx, LX(ly, 0), LY(ly, 0), DECK + 0.20, 0.14);
      /* guide rail shadows on return path */
      ctx.fillStyle = 'rgba(60,50,40,0.25)';
      Iso.disc(ctx, LX(ly, -HW * 0.7), LY(ly, -HW * 0.7), DECK + 0.20, 0.03);
      Iso.disc(ctx, LX(ly, HW * 0.7), LY(ly, HW * 0.7), DECK + 0.20, 0.03);
    }

    /* --- the arms, at the belt end. Intake reaches upstream, outfeed places
           downstream: two different topics, two directions. --- */
    var pivotA = bA + dir * 0.10;
    var px = LX(pivotA, 0), py = LY(pivotA, 0);
    var inSw  = o.inSwing  || [0.00, 0.16];
    var outSw = o.outSwing || [0.84, 1.00];

    /* the reach points from the spur at the belt; the park points back along
       the table toward the machine */
    var reachAng = vert ? dir * (Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    var parkAng  = reachAng + Math.PI;

    /* which way to splay for upstream, worked out from the belt's travel
       rather than assumed from the axis */
    var FLOW = { e: [1, 0], w: [-1, 0], n: [0, -1], s: [0, 1] };
    var f = FLOW[o.flow || (vert ? 'e' : 's')] || FLOW.e;
    var upA = Math.cos(reachAng + 0.60) * -f[0] + Math.sin(reachAng + 0.60) * -f[1];
    var upB = Math.cos(reachAng - 0.60) * -f[0] + Math.sin(reachAng - 0.60) * -f[1];
    var splay = upA >= upB ? 0.60 : -0.60;
    var swingP;

    if (arms !== 'out') {
      swingP = p > 0 ? segLin(p, inSw[0], inSw[1]) : 0;
      inserter(px, py, parkAng, reachAng + splay, swingP,
               '#c9a233', { z: DECK - 0.06, reach: 0.86, carry: swingP > 0.5,
                            payload: PAPER.full });
    }
    if (arms !== 'in') {
      swingP = p > 0 ? segLin(p, outSw[0], outSw[1]) : 0;
      inserter(px, py, parkAng, reachAng - splay, swingP,
               '#c9a233', { z: DECK - 0.06, reach: 0.86,
                            carry: swingP < 0.5 && swingP > 0,
                            payload: Iso.mix(PAPER.full, AC, 0.45) });
    }
  }

  global.Kit = {
    bind: bind,
    busy: busy,

    /* palettes */
    ACCENT: ACCENT, LIVERY: LIVERY, livery: livery, casing: casing,
    M: M, PAPER: PAPER, RIB: RIB, GLAZE: GLAZE, EDGE: EDGE,

    /* cam timing */
    cyc: cyc, seg: seg, segLin: segLin,

    /* primitives */
    frustum: frustum, pipe: pipe, plate: plate, quad: quad, atWorld: atWorld,

    /* casing detail */
    bolts: bolts, ribs: ribs, door: door, louvres: louvres,
    hazardStrip: hazardStrip, hazardFloor: hazardFloor, lattice: lattice,

    /* instruments */
    lamp: lamp, readout: readout, stencil: stencil, matrix: matrix,
    gaugeCol: gaugeCol,

    /* text */
    faceText: faceText, floorText: floorText,

    /* particles */
    puffs: puffs, sparks: sparks, chips: chips,

    /* sub-assemblies */
    replicaStack: replicaStack, inserter: inserter, transferBay: transferBay,
    reel: reel, binRow: binRow, receiptDuct: receiptDuct,

    /* the relay network */
    trench: trench, tubeRun: tubeRun, tubePost: tubePost, pulse: pulse
  };
})(window);
