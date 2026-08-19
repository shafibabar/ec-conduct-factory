/* render.js: EC Factory painter's-algorithm renderer.
 *
 * ONE sorted pass over all objects, back to front by x+y depth key.
 * Labels drawn in a second pass in screen (physical pixel) space.
 *
 * CRITICAL: ctx.clearRect() runs before ctx.save() so the canvas is
 * fully wiped on every pan, zoom, and frame.  drawFloor() computes the
 * visible rectangle in camera-transformed coordinates so the dark
 * background covers every pixel even when the camera has panned far.
 */
(function (global) {
  'use strict';

  var Iso     = global.Iso;
  var Factory = global.Factory;
  var World   = global.World;
  var Sim     = global.Sim;
  var EC      = global.EC;

  var P = Iso.project;   /* iso-grid coords -> screen-space {x,y} */

  var cam = null, ctx = null, clk = 0;
  var labels = [];
  var showLabels = true;

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

  /* ---- floor — delegated to factory.js ----------------------------------- */

  function drawFloor(vw, vh) {
    Factory.drawFloor(ctx, Iso, cam, World.GW, World.GH, vw, vh);
  }

  /* ---- Cognition island floor -------------------------------------------- */

  function drawCognitionFloor(vw, vh) {
    Factory.drawCognitionFloor(ctx, Iso, cam, World.COG_FLOOR, vw, vh);
  }

  /* ---- belt — delegated to factory.js ------------------------------------ */

  function drawBelt() {
    Factory.drawBelt(ctx, Iso, World.BELT, clk, 0, World.BELT.total, {});
  }

  /* ---- gateway (ec-gateway) — receiving dock + archive tower ------------- */

  function drawGateway(o, active) {
    var bx = o.x - o.w / 2;   /* hall west edge  = 11.5 */
    var by = o.y - o.d / 2;   /* hall north edge = 0.5  */
    var sf = by + o.d + 0.01; /* south face y (belt-facing) */
    var tx = o.x - 4;          /* archive tower centre x = 10 */
    var ty = 1;                 /* archive tower centre y */

    var TERRA     = '#c4724e';
    var TERRA_DRK = '#7a3f28';
    var TWR_BODY  = '#6e7888';
    var GW_BLUE   = '#5ab0e0';
    var WIN_IDLE  = '#2a1e18';
    var WIN_ACT   = '#e0c060';
    var DOOR_CLR  = '#1a1410';

    /* ---- archive tower (drawn first — further back in depth) ---- */
    Iso.box(ctx, {
      x: tx - 0.75, y: ty - 0.75, z: 0,
      w: 1.5, d: 1.5, h: 5,
      color: TWR_BODY, edge: 'rgba(0,0,0,0.25)'
    });
    /* dish: two crossing arms */
    ctx.fillStyle = GW_BLUE;
    Iso.poly(ctx, [P(tx-1.1,ty-0.12,5.15),P(tx+1.1,ty-0.12,5.15),P(tx+1.1,ty+0.12,5.15),P(tx-1.1,ty+0.12,5.15)]);
    Iso.poly(ctx, [P(tx-0.12,ty-1.1,5.15),P(tx+0.12,ty-1.1,5.15),P(tx+0.12,ty+1.1,5.15),P(tx-0.12,ty+1.1,5.15)]);

    /* ---- main hall body ---- */
    Iso.box(ctx, {
      x: bx, y: by, z: 0,
      w: o.w, d: o.d, h: o.h,
      color: TERRA, edge: 'rgba(0,0,0,0.28)'
    });

    /* roof slab (slight overhang) */
    Iso.box(ctx, {
      x: bx - 0.2, y: by - 0.2, z: o.h,
      w: o.w + 0.4, d: o.d + 0.4, h: 0.22,
      color: TERRA_DRK, edge: false
    });

    /* roof ridge beam running east-west */
    Iso.box(ctx, {
      x: bx - 0.2, y: o.y - 0.22, z: o.h + 0.22,
      w: o.w + 0.4, d: 0.44, h: 0.14,
      color: TERRA_DRK, edge: false
    });

    /* ---- 3 windows on south face (belt-facing) ---- */
    ctx.fillStyle = active ? WIN_ACT : WIN_IDLE;
    var ww = 0.5, wh = 1.1, wz = 0.8;
    var wxa = [bx + 0.5, o.x - ww * 0.5, bx + o.w - 0.5 - ww];
    for (var wi = 0; wi < 3; wi++) {
      Iso.poly(ctx, [
        P(wxa[wi],      sf, wz),      P(wxa[wi] + ww, sf, wz),
        P(wxa[wi] + ww, sf, wz + wh), P(wxa[wi],      sf, wz + wh)
      ]);
    }

    /* ---- loading bay door on south face ---- */
    var dx = o.x - 0.9;
    ctx.fillStyle = DOOR_CLR;
    Iso.poly(ctx, [
      P(dx,       sf, 0), P(dx + 1.8, sf, 0),
      P(dx + 1.8, sf, 1.5), P(dx,    sf, 1.5)
    ]);

    /* ---- beacon on tower top — always visible, brighter when active ---- */
    var gwBcOn  = Math.sin(clk * 3.5) > 0;
    var gwBcClr = active ? (gwBcOn ? GW_BLUE : '#0e2840') : '#0b1a28';
    /* pole */
    Iso.cylinder(ctx, { x: tx, y: ty, z: 5.0, r: 0.10, h: 0.50, color: '#3a4050' });
    /* light head — 0.55 × 0.55 so it's actually visible */
    Iso.box(ctx, { x: tx-0.28, y: ty-0.28, z: 5.50, w: 0.56, d: 0.56, h: 0.26, color: gwBcClr, edge: false });

    /* ---- pressure tank beside tower ---- */
    Iso.cylinder(ctx, { x: tx-1.2, y: ty+0.2, z: 0, r: 0.32, h: 1.6, color: TWR_BODY });

    if (!active) return;

    /* ---- chunk download bars on south face (3 parallel streams) ---- */
    var bfw = 2.2, bfx = bx + 0.4;
    var spds = [0.38, 0.61, 0.27], boffs = [0.0, 0.40, 0.72];
    for (var bi = 0; bi < 3; bi++) {
      var bz = o.h - 0.32 - bi * 0.27;
      ctx.fillStyle = '#3a2518';
      Iso.poly(ctx, [
        P(bfx,       sf+0.02, bz),        P(bfx+bfw,   sf+0.02, bz),
        P(bfx+bfw,   sf+0.02, bz+0.13),   P(bfx,       sf+0.02, bz+0.13)
      ]);
      var fw = ((clk * spds[bi] + boffs[bi]) % 1.0) * bfw;
      if (fw > 0.02) {
        ctx.fillStyle = GW_BLUE;
        Iso.poly(ctx, [
          P(bfx,      sf+0.03, bz+0.01),  P(bfx+fw,   sf+0.03, bz+0.01),
          P(bfx+fw,   sf+0.03, bz+0.11),  P(bfx,      sf+0.03, bz+0.11)
        ]);
      }
    }

    /* ---- data particles: tower top → hall north face ---- */
    for (var di = 0; di < 3; di++) {
      var pt  = (clk * 0.55 + di / 3) % 1.0;
      var ppx = tx  + (o.x - tx)  * pt;
      var ppy = ty  + (by  - ty)  * pt;
      var ppz = 4.6 + (o.h * 0.5 - 4.6) * pt;
      var spt = P(ppx, ppy, ppz);
      ctx.fillStyle = GW_BLUE;
      ctx.beginPath();
      ctx.arc(spt.x, spt.y, 3.5, 0, 6.2832);
      ctx.fill();
    }
  }

  /* ---- qualifier (ec-queue-qualifier) — participant extractor + pipeline matcher */

  function drawQualifier(o, active) {
    var lx = o.x - 2;           /* left building centre  x = 22 */
    var rx = o.x + 2;           /* right building centre x = 26 */
    var qy = o.y;                /* both at y = 2                */
    var qw = 3.0, qd = 2.5, qh = 2.5;

    var lbx  = lx - qw / 2;     /* left west edge  = 20.5 */
    var rbx  = rx - qw / 2;     /* right west edge = 24.5 */
    var qby  = qy - qd / 2;     /* north edge      =  0.75 */
    var qsf  = qby + qd + 0.01; /* south face y    ~  3.26 */

    var SAGE     = '#7a8b58';
    var SAGE_DRK = '#4a5230';
    var SAGE_RIM = '#3a4020';
    var SAGE_ACT = '#a0cc44';
    var WIN_IDLE = '#1e2418';
    var WIN_ACT  = '#b8e060';
    var PIPE_CLR = '#566038';

    /* ---- connector pipe (drawn first so buildings occlude its ends) ---- */
    var pipeX = lx + qw / 2;
    var pipeW = rx - qw / 2 - pipeX;
    var pipeZ = qh * 0.44;
    Iso.box(ctx, { x: pipeX, y: qy - 0.15, z: pipeZ, w: pipeW, d: 0.3, h: 0.22, color: PIPE_CLR, edge: false });

    /* ---- LEFT building (participant extractor) ---- */
    Iso.box(ctx, { x: lbx, y: qby, z: 0, w: qw, d: qd, h: qh, color: SAGE, edge: 'rgba(0,0,0,0.28)' });
    Iso.box(ctx, { x: lbx-0.18, y: qby-0.18, z: qh,      w: qw+0.36, d: qd+0.36, h: 0.20, color: SAGE_DRK, edge: false });
    Iso.box(ctx, { x: lbx-0.18, y: qy -0.22, z: qh+0.20, w: qw+0.36, d: 0.44,   h: 0.14, color: SAGE_RIM, edge: false });

    var ww = 0.48, wh2 = 0.85, wz = 0.7;
    ctx.fillStyle = active ? WIN_ACT : WIN_IDLE;
    Iso.poly(ctx, [P(lbx+0.4,      qsf, wz), P(lbx+0.4+ww,     qsf, wz), P(lbx+0.4+ww,     qsf, wz+wh2), P(lbx+0.4,      qsf, wz+wh2)]);
    Iso.poly(ctx, [P(lbx+qw-0.4-ww,qsf, wz), P(lbx+qw-0.4,     qsf, wz), P(lbx+qw-0.4,     qsf, wz+wh2), P(lbx+qw-0.4-ww,qsf, wz+wh2)]);

    /* ---- RIGHT building (pipeline matcher) ---- */
    Iso.box(ctx, { x: rbx, y: qby, z: 0, w: qw, d: qd, h: qh, color: SAGE, edge: 'rgba(0,0,0,0.28)' });
    Iso.box(ctx, { x: rbx-0.18, y: qby-0.18, z: qh,      w: qw+0.36, d: qd+0.36, h: 0.20, color: SAGE_DRK, edge: false });
    Iso.box(ctx, { x: rbx-0.18, y: qy -0.22, z: qh+0.20, w: qw+0.36, d: 0.44,   h: 0.14, color: SAGE_RIM, edge: false });

    ctx.fillStyle = active ? WIN_ACT : WIN_IDLE;
    Iso.poly(ctx, [P(rbx+0.4,      qsf, wz), P(rbx+0.4+ww,     qsf, wz), P(rbx+0.4+ww,     qsf, wz+wh2), P(rbx+0.4,      qsf, wz+wh2)]);
    Iso.poly(ctx, [P(rbx+qw-0.4-ww,qsf, wz), P(rbx+qw-0.4,     qsf, wz), P(rbx+qw-0.4,     qsf, wz+wh2), P(rbx+qw-0.4-ww,qsf, wz+wh2)]);

    /* ---- beacons — always visible (dim idle, bright+pulsing active) ---- */
    var beaconOn  = Math.sin(clk * 3.2) > 0;
    var beaconClr = active ? (beaconOn ? SAGE_ACT : '#1a3008') : '#0d1f06';
    /* pole + light on each building */
    Iso.cylinder(ctx, { x: lx, y: qy, z: qh+0.34, r: 0.09, h: 0.40, color: SAGE_RIM });
    Iso.box(ctx, { x: lx-0.28, y: qy-0.28, z: qh+0.74, w: 0.56, d: 0.56, h: 0.24, color: beaconClr, edge: false });
    Iso.cylinder(ctx, { x: rx, y: qy, z: qh+0.34, r: 0.09, h: 0.40, color: SAGE_RIM });
    Iso.box(ctx, { x: rx-0.28, y: qy-0.28, z: qh+0.74, w: 0.56, d: 0.56, h: 0.24, color: beaconClr, edge: false });

    if (!active) return;

    /* ---- handoff dot along connector pipe ---- */
    var ht  = (clk * 0.8) % 1.0;
    var hdx = pipeX + ht * pipeW;
    var hpt = P(hdx, qy, pipeZ + 0.15);
    ctx.fillStyle = SAGE_ACT;
    ctx.beginPath(); ctx.arc(hpt.x, hpt.y, 3.5, 0, 6.2832); ctx.fill();

    /* ---- stream bars on left building south face ---- */
    var sbw = 1.6, sbx = lbx + 0.3;
    var sspds  = [0.45, 0.70, 0.32];
    var sboffs = [0.00, 0.38, 0.68];
    var si, sbz, sbFill;
    for (si = 0; si < 3; si++) {
      sbz = qh - 0.30 - si * 0.24;
      ctx.fillStyle = '#2e3820';
      Iso.poly(ctx, [P(sbx, qsf+0.02, sbz), P(sbx+sbw, qsf+0.02, sbz), P(sbx+sbw, qsf+0.02, sbz+0.12), P(sbx, qsf+0.02, sbz+0.12)]);
      sbFill = ((clk * sspds[si] + sboffs[si]) % 1.0) * sbw;
      if (sbFill > 0.02) {
        ctx.fillStyle = SAGE_ACT;
        Iso.poly(ctx, [P(sbx, qsf+0.03, sbz+0.01), P(sbx+sbFill, qsf+0.03, sbz+0.01), P(sbx+sbFill, qsf+0.03, sbz+0.11), P(sbx, qsf+0.03, sbz+0.11)]);
      }
    }

    /* ---- pipeline match blocks on right building south face ---- */
    var pCnt    = Math.min(Sim.state.pipelineCount || 2, 4);
    var blockW  = 0.38, blockH = 0.48, blockGap = 0.14;
    var totalBW = pCnt * blockW + (pCnt - 1) * blockGap;
    var bkStartX = rbx + (qw - totalBW) / 2;
    var pb, bkx, bkFrac;
    for (pb = 0; pb < pCnt; pb++) {
      bkx    = bkStartX + pb * (blockW + blockGap);
      bkFrac = ((clk * 0.6 + pb * 0.28) % 1.4);
      if (bkFrac > 1) bkFrac = 1;
      ctx.fillStyle = '#2a3418';
      Iso.poly(ctx, [P(bkx, qsf+0.02, 0.28), P(bkx+blockW, qsf+0.02, 0.28), P(bkx+blockW, qsf+0.02, 0.28+blockH), P(bkx, qsf+0.02, 0.28+blockH)]);
      if (bkFrac > 0.02) {
        ctx.fillStyle = SAGE_ACT;
        Iso.poly(ctx, [P(bkx, qsf+0.03, 0.28), P(bkx+blockW, qsf+0.03, 0.28), P(bkx+blockW, qsf+0.03, 0.28+blockH*bkFrac), P(bkx, qsf+0.03, 0.28+blockH*bkFrac)]);
      }
    }
  }

  /* ---- filter (ec-surveillance-filter) — ignore/flag screening ----------- */

  function drawFilter(o, active) {
    var lx = o.x - 2;           /* left building centre  x = 32 */
    var rx = o.x + 2;           /* right building centre x = 36 */
    var fy = o.y;               /* both at y = 2 */
    var fw = 3.0, fd = 2.5, fh = 2.5;

    var lbx = lx - fw / 2;     /* left west edge  = 30.5 */
    var rbx = rx - fw / 2;     /* right west edge = 34.5 */
    var fby = fy - fd / 2;     /* north edge      =  0.75 */
    var fsf = fby + fd + 0.01; /* south face y    ~  3.26 */

    var MSTD     = '#c8a830';  /* mustard body */
    var MSTD_DRK = '#7a6010';  /* dark amber roof */
    var MSTD_RIM = '#5a4008';  /* burnt ridge */
    var MSTD_ACT = '#ffe060';  /* active glow */
    var WIN_IDLE = '#2a1e08';
    var WIN_ACT  = '#fff0a0';
    var PIPE_CLR = '#8a6e18';
    var BLCK_CLR = '#c03020';  /* suppressed / blocked red */
    var GRND_CLR = '#40c850';  /* qualified green */

    /* ---- connector pipe (drawn first, buildings occlude its ends) ---- */
    var pipeX = lx + fw / 2;
    var pipeW = rx - fw / 2 - pipeX;  /* 1.0 unit gap */
    var pipeZ = fh * 0.44;
    Iso.box(ctx, { x: pipeX, y: fy - 0.15, z: pipeZ, w: pipeW, d: 0.30, h: 0.22, color: PIPE_CLR, edge: false });

    /* ---- LEFT building (ignore-policy screen) ---- */
    Iso.box(ctx, { x: lbx, y: fby, z: 0, w: fw, d: fd, h: fh, color: MSTD, edge: 'rgba(0,0,0,0.28)' });
    Iso.box(ctx, { x: lbx-0.18, y: fby-0.18, z: fh,      w: fw+0.36, d: fd+0.36, h: 0.20, color: MSTD_DRK, edge: false });
    Iso.box(ctx, { x: lbx-0.18, y: fy -0.22, z: fh+0.20, w: fw+0.36, d: 0.44,   h: 0.14, color: MSTD_RIM, edge: false });

    var ww = 0.48, wh2 = 0.85, wz = 0.7;
    ctx.fillStyle = active ? WIN_ACT : WIN_IDLE;
    Iso.poly(ctx, [P(lbx+0.4,      fsf, wz), P(lbx+0.4+ww,     fsf, wz), P(lbx+0.4+ww,     fsf, wz+wh2), P(lbx+0.4,      fsf, wz+wh2)]);
    Iso.poly(ctx, [P(lbx+fw-0.4-ww,fsf, wz), P(lbx+fw-0.4,     fsf, wz), P(lbx+fw-0.4,     fsf, wz+wh2), P(lbx+fw-0.4-ww,fsf, wz+wh2)]);

    /* ---- RIGHT building (flag-policy screen) ---- */
    Iso.box(ctx, { x: rbx, y: fby, z: 0, w: fw, d: fd, h: fh, color: MSTD, edge: 'rgba(0,0,0,0.28)' });
    Iso.box(ctx, { x: rbx-0.18, y: fby-0.18, z: fh,      w: fw+0.36, d: fd+0.36, h: 0.20, color: MSTD_DRK, edge: false });
    Iso.box(ctx, { x: rbx-0.18, y: fy -0.22, z: fh+0.20, w: fw+0.36, d: 0.44,   h: 0.14, color: MSTD_RIM, edge: false });

    ctx.fillStyle = active ? WIN_ACT : WIN_IDLE;
    Iso.poly(ctx, [P(rbx+0.4,      fsf, wz), P(rbx+0.4+ww,     fsf, wz), P(rbx+0.4+ww,     fsf, wz+wh2), P(rbx+0.4,      fsf, wz+wh2)]);
    Iso.poly(ctx, [P(rbx+fw-0.4-ww,fsf, wz), P(rbx+fw-0.4,     fsf, wz), P(rbx+fw-0.4,     fsf, wz+wh2), P(rbx+fw-0.4-ww,fsf, wz+wh2)]);

    /* ---- BEACONS — always visible (dim idle, bright+pulsing active) ----
       Pole sits above the ridge (z = fh+0.40). Light on top is 0.6x0.6 so
       it is impossible to miss. Never rendered in near-black.             */
    var beaconPulse = Math.sin(clk * 4.5) > 0;
    var lBcClr = active ? (beaconPulse ? MSTD_ACT : '#b07820') : '#7a5818';
    var rBcClr = active ? (beaconPulse ? MSTD_ACT : '#b07820') : '#7a5818';
    /* left pole + light */
    Iso.box(ctx, { x: lx-0.12, y: fy-0.12, z: fh+0.40, w: 0.24, d: 0.24, h: 0.50, color: MSTD_RIM, edge: false });
    Iso.box(ctx, { x: lx-0.30, y: fy-0.30, z: fh+0.90, w: 0.60, d: 0.60, h: 0.30, color: lBcClr,   edge: false });
    /* right pole + light */
    Iso.box(ctx, { x: rx-0.12, y: fy-0.12, z: fh+0.40, w: 0.24, d: 0.24, h: 0.50, color: MSTD_RIM, edge: false });
    Iso.box(ctx, { x: rx-0.30, y: fy-0.30, z: fh+0.90, w: 0.60, d: 0.60, h: 0.30, color: rBcClr,   edge: false });

    /* ---- VENETIAN BLINDS on left building south face (always animating) ----
       Five slats at stepped z heights. Each slat independently cycles through
       open (thin, mustard) and closed (thick, red). Simulates blind rotation
       by varying height: closed = full step, open = near-zero.            */
    var blindSpd = active ? 0.90 : 0.12;
    var numSlats = 5;
    var slatStep = (fh - 0.40) / numSlats;
    var sl, slatZ, sPhase, openFrac, slatThk, slatClr;
    for (sl = 0; sl < numSlats; sl++) {
      slatZ    = 0.18 + sl * slatStep;
      sPhase   = (clk * blindSpd + sl * 0.20) % 1.0;
      openFrac = (Math.sin(sPhase * 6.2832) + 1.0) / 2.0;  /* 0=closed 1=open */
      slatThk  = slatStep * 0.65 * (1.0 - openFrac * 0.78);
      if (slatThk < 0.05) slatThk = 0.05;
      slatClr = openFrac < 0.32 ? BLCK_CLR : (openFrac < 0.60 ? MSTD_DRK : MSTD);
      ctx.fillStyle = slatClr;
      Iso.poly(ctx, [
        P(lbx+0.14, fsf+0.02, slatZ),
        P(lbx+fw-0.14, fsf+0.02, slatZ),
        P(lbx+fw-0.14, fsf+0.02, slatZ+slatThk),
        P(lbx+0.14, fsf+0.02, slatZ+slatThk)
      ]);
    }

    /* ---- VERDICT BARS on right building south face (always animating) ----
       One bar per pipeline. Each cycles: scan (amber pulse) → QUALIFIED
       (green) → FILTERED (amber) → NOT_QUALIFIED (grey). A dark track
       sits behind each bar so the colour change reads clearly.           */
    var verdictSpd = active ? 0.50 : 0.07;
    var pCnt   = Math.min(Sim.state.pipelineCount || 2, 4);
    var barW   = (fw - 0.40) / pCnt - 0.10;
    var barH   = fh - 0.30;
    var barTW  = pCnt * barW + (pCnt - 1) * 0.10;
    var barSX  = rbx + (fw - barTW) / 2;
    var vb, vbx, vPhase, vColor, scanPulse;
    for (vb = 0; vb < pCnt; vb++) {
      vbx    = barSX + vb * (barW + 0.10);
      vPhase = (clk * verdictSpd + vb * 0.40) % 2.40;
      if (vPhase < 1.00) {
        scanPulse = (Math.sin(vPhase * 9.4248) + 1.0) / 2.0;
        vColor = scanPulse > 0.50 ? MSTD_ACT : MSTD_DRK;
      } else if (vPhase < 1.60) {
        vColor = GRND_CLR;   /* QUALIFIED */
      } else if (vPhase < 2.00) {
        vColor = MSTD_ACT;   /* FILTERED */
      } else {
        vColor = '#686878';  /* NOT_QUALIFIED */
      }
      /* dark track */
      ctx.fillStyle = '#3a2c08';
      Iso.poly(ctx, [P(vbx, fsf+0.02, 0.15), P(vbx+barW, fsf+0.02, 0.15), P(vbx+barW, fsf+0.02, 0.15+barH), P(vbx, fsf+0.02, 0.15+barH)]);
      /* verdict fill */
      ctx.fillStyle = vColor;
      Iso.poly(ctx, [P(vbx+0.04, fsf+0.03, 0.19), P(vbx+barW-0.04, fsf+0.03, 0.19), P(vbx+barW-0.04, fsf+0.03, 0.15+barH-0.04), P(vbx+0.04, fsf+0.03, 0.15+barH-0.04)]);
    }

    /* ---- SCAN LINE on right building — sweeps upward (always visible) ---- */
    var scanT = (clk * (active ? 0.80 : 0.10)) % 1.0;
    var scanZ = scanT * fh;
    ctx.fillStyle = active ? MSTD_ACT : MSTD_DRK;
    Iso.poly(ctx, [
      P(rbx+0.10, fsf+0.04, scanZ),
      P(rbx+fw-0.10, fsf+0.04, scanZ),
      P(rbx+fw-0.10, fsf+0.04, scanZ+0.10),
      P(rbx+0.10, fsf+0.04, scanZ+0.10)
    ]);

    if (!active) return;

    /* ---- SUPPRESSED PARTICLE DRIP on left building (active only) ----
       Red dots rain down the south face to show messages being blocked. */
    var pd, pdz, pdxo, ppt;
    for (pd = 0; pd < 5; pd++) {
      pdz  = (1.0 - (clk * 0.55 + pd * 0.20) % 1.0) * (fh - 0.20);
      pdxo = lbx + 0.28 + pd * ((fw - 0.56) / 4.0);
      ppt  = P(pdxo, fsf + 0.05, pdz);
      ctx.fillStyle = BLCK_CLR;
      ctx.beginPath(); ctx.arc(ppt.x, ppt.y, 3.5, 0, 6.2832); ctx.fill();
    }

    /* ---- FLOW DOT along connector pipe (active only) ---- */
    var ht  = (clk * 0.80) % 1.0;
    var hdx = pipeX + ht * pipeW;
    var hpt = P(hdx, fy, pipeZ + 0.15);
    ctx.fillStyle = MSTD_ACT;
    ctx.beginPath(); ctx.arc(hpt.x, hpt.y, 3.5, 0, 6.2832); ctx.fill();
  }

  /* ---- evaluator (ec-surveillance-policy-evaluator) ---------------------- */

  /* Left building = metadata evaluator (instant local decisions, fast bars).
     Right building = COMS router (async Cognition, orbit dots, antenna).    */
  function drawEvaluator(o, active) {
    var lx = o.x - 2;           /* left building centre  x = 42 */
    var rx = o.x + 2;           /* right building centre x = 46 */
    var fy = o.y;               /* both at y = 2 */
    var fw = 3.0, fd = 2.5, fh = 2.5;

    var lbx = lx - fw / 2;     /* left west edge  = 40.5 */
    var rbx = rx - fw / 2;     /* right west edge = 44.5 */
    var fby = fy - fd / 2;     /* north edge      =  0.75 */
    var fsf = fby + fd + 0.01; /* south face y    ~  3.26 */

    var TEAL     = '#2a7870';
    var TEAL_DRK = '#1a4840';
    var TEAL_RIM = '#123830';
    var TEAL_ACT = '#48d8c0';
    var WAIT_CLR = '#5090e0';
    var PASS_CLR = '#40c870';
    var FAIL_CLR = '#e06048';
    var WIN_IDLE = '#0e1e1c';
    var WIN_ACT  = '#90ffe8';
    var PIPE_CLR = '#1e5048';

    /* ---- connector pipe ---- */
    var pipeX = lx + fw / 2;
    var pipeW = rx - fw / 2 - pipeX;
    var pipeZ = fh * 0.44;
    Iso.box(ctx, { x: pipeX, y: fy-0.15, z: pipeZ, w: pipeW, d: 0.30, h: 0.22, color: PIPE_CLR, edge: false });

    /* ---- LEFT building (metadata evaluator) ---- */
    Iso.box(ctx, { x: lbx, y: fby, z: 0, w: fw, d: fd, h: fh, color: TEAL, edge: 'rgba(0,0,0,0.28)' });
    Iso.box(ctx, { x: lbx-0.18, y: fby-0.18, z: fh,      w: fw+0.36, d: fd+0.36, h: 0.20, color: TEAL_DRK, edge: false });
    Iso.box(ctx, { x: lbx-0.18, y: fy -0.22, z: fh+0.20, w: fw+0.36, d: 0.44,   h: 0.14, color: TEAL_RIM, edge: false });

    var ww = 0.48, wh2 = 0.85, wz = 0.7;
    ctx.fillStyle = active ? WIN_ACT : WIN_IDLE;
    Iso.poly(ctx, [P(lbx+0.4,      fsf, wz), P(lbx+0.4+ww,     fsf, wz), P(lbx+0.4+ww,     fsf, wz+wh2), P(lbx+0.4,      fsf, wz+wh2)]);
    Iso.poly(ctx, [P(lbx+fw-0.4-ww,fsf, wz), P(lbx+fw-0.4,     fsf, wz), P(lbx+fw-0.4,     fsf, wz+wh2), P(lbx+fw-0.4-ww,fsf, wz+wh2)]);

    /* ---- RIGHT building (COMS async router) ---- */
    Iso.box(ctx, { x: rbx, y: fby, z: 0, w: fw, d: fd, h: fh, color: TEAL, edge: 'rgba(0,0,0,0.28)' });
    Iso.box(ctx, { x: rbx-0.18, y: fby-0.18, z: fh,      w: fw+0.36, d: fd+0.36, h: 0.20, color: TEAL_DRK, edge: false });
    Iso.box(ctx, { x: rbx-0.18, y: fy -0.22, z: fh+0.20, w: fw+0.36, d: 0.44,   h: 0.14, color: TEAL_RIM, edge: false });

    ctx.fillStyle = active ? WIN_ACT : WIN_IDLE;
    Iso.poly(ctx, [P(rbx+0.4,      fsf, wz), P(rbx+0.4+ww,     fsf, wz), P(rbx+0.4+ww,     fsf, wz+wh2), P(rbx+0.4,      fsf, wz+wh2)]);
    Iso.poly(ctx, [P(rbx+fw-0.4-ww,fsf, wz), P(rbx+fw-0.4,     fsf, wz), P(rbx+fw-0.4,     fsf, wz+wh2), P(rbx+fw-0.4-ww,fsf, wz+wh2)]);

    /* ---- Cognition antenna on right building roof ---- */
    /* mast at NE corner of right building (on top face, always visible) */
    var antX = rbx + fw - 0.55, antY = fby + 0.55;
    Iso.cylinder(ctx, { x: antX, y: antY, z: fh+0.35, r: 0.07, h: 0.70, color: TEAL_RIM });
    /* dish: two crossing bars above mast */
    ctx.fillStyle = WAIT_CLR;
    Iso.poly(ctx, [P(antX-0.55, antY-0.06, fh+1.08), P(antX+0.40, antY-0.06, fh+1.08), P(antX+0.40, antY+0.06, fh+1.08), P(antX-0.55, antY+0.06, fh+1.08)]);
    Iso.poly(ctx, [P(antX-0.06, antY-0.55, fh+1.08), P(antX+0.06, antY-0.55, fh+1.08), P(antX+0.06, antY+0.45, fh+1.08), P(antX-0.06, antY+0.45, fh+1.08)]);

    /* ---- BEACONS — always visible ---- */
    var beaconPulse = Math.sin(clk * 3.8) > 0;
    var bcClr = active ? (beaconPulse ? TEAL_ACT : '#0e2e28') : '#0a1e18';
    Iso.cylinder(ctx, { x: lx, y: fy, z: fh+0.40, r: 0.09, h: 0.50, color: TEAL_RIM });
    Iso.box(ctx, { x: lx-0.30, y: fy-0.30, z: fh+0.90, w: 0.60, d: 0.60, h: 0.28, color: bcClr, edge: false });
    Iso.cylinder(ctx, { x: rx, y: fy, z: fh+0.40, r: 0.09, h: 0.50, color: TEAL_RIM });
    Iso.box(ctx, { x: rx-0.30, y: fy-0.30, z: fh+0.90, w: 0.60, d: 0.60, h: 0.28, color: bcClr, edge: false });

    /* ---- METADATA VERDICT BARS — left building, always animated (fast) ----
       Each bar cycles PASS → FAIL → evaluating. Speed is fast: metadata
       decisions happen in < 1 ms, so the bars flip almost continuously.    */
    var metaSpd = active ? 2.20 : 0.18;
    var pCnt    = Math.min(Sim.state.pipelineCount || 2, 4);
    var mBarW   = (fw - 0.40) / pCnt - 0.10;
    var mBarH   = fh - 0.30;
    var mBarTW  = pCnt * mBarW + (pCnt - 1) * 0.10;
    var mBarSX  = lbx + (fw - mBarTW) / 2;
    var mb, mbx, mPhase, mColor;
    for (mb = 0; mb < pCnt; mb++) {
      mbx    = mBarSX + mb * (mBarW + 0.10);
      mPhase = (clk * metaSpd * (0.85 + mb * 0.12) + mb * 0.28) % 1.0;
      mColor = mPhase < 0.62 ? PASS_CLR :
               mPhase < 0.82 ? FAIL_CLR :
               '#132420';  /* brief evaluating gap */
      /* dark track */
      ctx.fillStyle = '#0e1e1c';
      Iso.poly(ctx, [P(mbx, fsf+0.02, 0.15), P(mbx+mBarW, fsf+0.02, 0.15), P(mbx+mBarW, fsf+0.02, 0.15+mBarH), P(mbx, fsf+0.02, 0.15+mBarH)]);
      /* verdict fill */
      ctx.fillStyle = mColor;
      Iso.poly(ctx, [P(mbx+0.04, fsf+0.03, 0.19), P(mbx+mBarW-0.04, fsf+0.03, 0.19), P(mbx+mBarW-0.04, fsf+0.03, 0.15+mBarH-0.04), P(mbx+0.04, fsf+0.03, 0.15+mBarH-0.04)]);
    }

    /* ---- FAST SCAN LINE on left building — sweeps downward (metadata fast) */
    var mScanT = (clk * (active ? 2.00 : 0.22)) % 1.0;
    var mScanZ = (1.0 - mScanT) * fh;
    ctx.fillStyle = active ? TEAL_ACT : TEAL_DRK;
    Iso.poly(ctx, [
      P(lbx+0.10, fsf+0.04, mScanZ),       P(lbx+fw-0.10, fsf+0.04, mScanZ),
      P(lbx+fw-0.10, fsf+0.04, mScanZ+0.08), P(lbx+0.10,   fsf+0.04, mScanZ+0.08)
    ]);

    /* ---- ASYNC WAIT ORBIT DOTS — right building, always animated ----
       Dots orbit the right building center in world space. The iso projection
       makes the circle appear as an ellipse — the natural async-wait look.  */
    var orbitN   = 10;
    var orbitR   = 1.25;
    var orbitSpd = active ? 0.38 : 0.05;
    var od, oAng, oX, oY, oBright;
    for (od = 0; od < orbitN; od++) {
      oAng   = (od / orbitN) * 6.2832 + clk * orbitSpd;
      oX     = rx + Math.cos(oAng) * orbitR;
      oY     = fy + Math.sin(oAng) * orbitR;
      oBright = (Math.sin(oAng + clk * orbitSpd) + 1.8) / 2.8;
      ctx.fillStyle = Iso.rgba(WAIT_CLR, (active ? 0.58 : 0.18) * oBright);
      Iso.disc(ctx, oX, oY, fh + 0.40, 0.10);
    }

    /* ---- COMS PENDING PULSE on right building south face ----
       A slowly breathing disc in the center shows async wait state.       */
    var cPulse = (Math.sin(clk * (active ? 1.0 : 0.15)) + 1.0) / 2.0;
    ctx.fillStyle = Iso.rgba(WAIT_CLR, (active ? 0.45 : 0.12) * cPulse);
    Iso.poly(ctx, [
      P(rbx+0.40, fsf+0.02, 0.50), P(rbx+fw-0.40, fsf+0.02, 0.50),
      P(rbx+fw-0.40, fsf+0.02, fh-0.40), P(rbx+0.40, fsf+0.02, fh-0.40)
    ]);

    if (!active) return;

    /* ---- FLOW DOT on connector pipe ---- */
    var ht  = (clk * 0.80) % 1.0;
    var hdx = pipeX + ht * pipeW;
    var hpt = P(hdx, fy, pipeZ + 0.15);
    ctx.fillStyle = TEAL_ACT;
    ctx.beginPath(); ctx.arc(hpt.x, hpt.y, 3.5, 0, 6.2832); ctx.fill();

    /* ---- OUTBOUND CIMS PACKETS rising from antenna to Cognition ---- */
    for (var pk = 0; pk < 2; pk++) {
      var pt   = (clk * 0.32 + pk * 0.50) % 1.0;
      var ppz  = fh + 1.1 + pt * 3.2;
      var ppa  = (1.0 - pt) * 0.80;
      var pps  = P(antX, antY, ppz);
      ctx.fillStyle = Iso.rgba(WAIT_CLR, ppa);
      ctx.beginPath(); ctx.arc(pps.x, pps.y, 3.0, 0, 6.2832); ctx.fill();
    }
  }

  /* ---- machine box -------------------------------------------------------- */

  /* Generic Factorio-style casing: concrete plinth, panelled body, coloured
     accent cap, status lamp, vent pipe, face-text, smoke and sparks. */
  function drawMachine(o) {
    var bx = o.x - o.w / 2;   /* west edge */
    var by = o.y - o.d / 2;   /* north edge */
    var sf = by + o.d + 0.01; /* south (viewer-facing) face y */
    var ac = ACCENT[o.id] || o.color;

    /* ---- plinth ---- */
    Iso.box(ctx, { x: bx-0.12, y: by-0.12, z: 0, w: o.w+0.24, d: o.d+0.24, h: 0.22, color: '#18191f', edge: false });

    /* ---- body ---- */
    Iso.box(ctx, { x: bx, y: by, z: 0.22, w: o.w, d: o.d, h: o.h, color: '#1c2036', edge: 'rgba(55,75,130,0.32)' });

    /* ---- ribbed sheet panels + glazed top band on south face ---- */
    var rows = 4, cols = 4, r, c, z0, z1, u0, u1;
    for (r = 0; r < rows; r++) {
      z0 = 0.32 + (o.h - 0.12) * ((r + 0.18) / rows);
      z1 = 0.32 + (o.h - 0.12) * ((r + 0.82) / rows);
      for (c = 0; c < cols; c++) {
        u0 = bx + o.w * ((c + 0.13) / cols);
        u1 = bx + o.w * ((c + 0.87) / cols);
        ctx.fillStyle = (r === rows - 1)
          ? 'rgba(80,115,175,0.24)'   /* glazed top band */
          : 'rgba(28,32,52,0.40)';    /* ribbed joint shadow */
        Iso.poly(ctx, [P(u0, sf, z0), P(u1, sf, z0), P(u1, sf, z1), P(u0, sf, z1)]);
      }
    }

    /* ---- accent cap (flush inset) ---- */
    Iso.box(ctx, { x: bx+0.22, y: by+0.22, z: 0.22+o.h, w: o.w-0.44, d: o.d-0.44, h: 0.16, color: Iso.shade(ac, 0.65), edge: false });

    /* ---- vent pipe on roof (adds visible Z-depth, no sort concerns) ---- */
    Iso.cylinder(ctx, { x: bx+o.w-0.7, y: by+o.d*0.28, z: 0.22+o.h+0.16, r: 0.15, h: 0.44, color: '#24283a' });

    /* ---- status lamp — always visible (green=active, red=idle) ---- */
    var lp = o.active ? (0.72 + 0.28 * Math.sin(clk * 7)) : 0.65;
    ctx.fillStyle = o.active
      ? 'rgba(90,210,80,'  + lp.toFixed(2) + ')'
      : 'rgba(200,55,45,0.68)';
    Iso.disc(ctx, bx+o.w-0.48, by+0.38, 0.22+o.h+0.18, 0.13);

    /* ---- service name on south face ---- */
    faceText(bx+0.30, sf, 0.38, [o.id || ''], { size: 7, color: 'rgba(150,175,225,0.52)' });

    /* ---- active effects ---- */
    if (o.active) {
      puffs(o.x, by+o.d*0.28, 0.22+o.h+0.60, 4, (o.x * 7) | 0,
            { color: '#7888a8', alpha: 0.17, rise: 1.2, r1: 0.38, rate: 0.45 });
      sparks(bx+o.w-0.48, by+0.38, 0.22+o.h+0.18, 3, (o.x * 5) | 0, ac);
    }
  }

  /* ---- sorting gate (ec-surveillance-quota-manager) ----------------------- */

  function drawGate(o, sampled) {
    drawMachine(o);

    /* hazard stripes on top cap */
    var bx = o.x - o.w / 2, by = o.y - o.d / 2, bz = o.h + 0.35;
    var stripe = 0.6;
    var n = Math.floor(o.w / stripe);
    for (var i = 0; i < n; i++) {
      var sx = bx + i * stripe;
      ctx.fillStyle = (i % 2 === 0) ? 'rgba(255,192,0,0.70)' : 'rgba(20,28,48,0.60)';
      Iso.poly(ctx, [
        P(sx,          by,      bz),
        P(sx + stripe, by,      bz),
        P(sx + stripe, by + o.d, bz),
        P(sx,          by + o.d, bz)
      ]);
    }

    /* directional arrow */
    var ax = o.x, ay = o.y, az = o.h + 0.36;
    ctx.fillStyle = sampled ? '#40c040' : '#c04040';
    var dir = sampled ? 1 : -1;
    Iso.poly(ctx, [
      P(ax - 0.4, ay + dir * 0.1, az),
      P(ax + 0.4, ay + dir * 0.1, az),
      P(ax,       ay + dir * 0.8, az)
    ]);
  }

  /* ---- side structure ----------------------------------------------------- */

  /* Off-belt repos look like factory offices/plant rooms: plinth, panelled
     body, gable roof in the district colour, status lamp. */
  function drawSideStruct(o) {
    var sf = o.y + o.d + 0.01;
    var rows, cols, r, c, z0, z1, u0, u1;

    /* plinth */
    Iso.box(ctx, { x: o.x-0.12, y: o.y-0.12, z: 0, w: o.w+0.24, d: o.d+0.24, h: 0.20, color: '#16171d', edge: false });

    /* body */
    Iso.box(ctx, { x: o.x, y: o.y, z: 0.20, w: o.w, d: o.d, h: o.h, color: '#1a1e2e', edge: 'rgba(65,85,130,0.28)' });

    /* panel texture on south face */
    rows = Math.max(2, Math.round(o.h * 0.85));
    cols = Math.max(2, Math.round(o.w * 0.6));
    for (r = 0; r < rows; r++) {
      z0 = 0.28 + (o.h - 0.1) * ((r + 0.18) / rows);
      z1 = 0.28 + (o.h - 0.1) * ((r + 0.82) / rows);
      for (c = 0; c < cols; c++) {
        u0 = o.x + o.w * ((c + 0.12) / cols);
        u1 = o.x + o.w * ((c + 0.88) / cols);
        ctx.fillStyle = (r === rows - 1)
          ? 'rgba(70,110,165,0.22)'
          : 'rgba(25,30,48,0.34)';
        Iso.poly(ctx, [P(u0, sf, z0), P(u1, sf, z0), P(u1, sf, z1), P(u0, sf, z1)]);
      }
    }

    /* gable roof in district colour */
    Iso.gableRoof(ctx, {
      x: o.x - 0.18, y: o.y - 0.18, z: 0.20 + o.h,
      w: o.w + 0.36, d: o.d + 0.36, h: 0.75,
      color: o.color, edge: 'rgba(0,0,0,0.26)'
    });

    /* status lamp */
    var lp = o.active ? (0.70 + 0.30 * Math.sin(clk * 5)) : 0.60;
    ctx.fillStyle = o.active
      ? 'rgba(90,210,80,' + lp.toFixed(2) + ')'
      : 'rgba(185,55,45,0.55)';
    Iso.disc(ctx, o.x + o.w - 0.4, o.y + 0.32, 0.20 + o.h + 0.18, 0.11);

    /* short name on south face */
    var slug = (o.label || o.id || '').replace(/^ec-/, '').split('-').slice(0, 2).join('-');
    faceText(o.x + 0.28, sf, 0.34, [slug], { size: 6.0, color: 'rgba(135,160,210,0.42)' });
  }

  /* ---- Cognition external node -------------------------------------------- */

  function drawCognition(active, evalPos) {
    var cg = World.COGNITION;
    var cx = cg.x, cy = cg.y, cw = cg.w, cd = cg.d, ch = cg.h;
    var csf = cy + cd + 0.01;

    /* plinth */
    Iso.box(ctx, { x: cx-0.12, y: cy-0.12, z: 0, w: cw+0.24, d: cd+0.24, h: 0.20, color: '#12141a', edge: false });

    /* server body — distinct steel-blue tint from the EC machines */
    Iso.box(ctx, { x: cx, y: cy, z: 0.20, w: cw, d: cd, h: ch, color: '#1a2838', edge: 'rgba(100,140,210,0.32)' });

    /* panel texture on south face */
    var rows = 3, cols = 3, r, c, z0, z1, u0, u1;
    for (r = 0; r < rows; r++) {
      z0 = 0.28 + (ch - 0.1) * ((r + 0.18) / rows);
      z1 = 0.28 + (ch - 0.1) * ((r + 0.82) / rows);
      for (c = 0; c < cols; c++) {
        u0 = cx + cw * ((c + 0.12) / cols);
        u1 = cx + cw * ((c + 0.88) / cols);
        ctx.fillStyle = (r === rows - 1) ? 'rgba(60,100,170,0.26)' : 'rgba(20,30,50,0.40)';
        Iso.poly(ctx, [P(u0, csf, z0), P(u1, csf, z0), P(u1, csf, z1), P(u0, csf, z1)]);
      }
    }

    /* satellite dish mast */
    Iso.cylinder(ctx, { x: cx + cw - 0.6, y: cy + 0.5, z: 0.20 + ch, r: 0.10, h: 0.9, color: '#3a4455' });
    /* dish arms (two crossing bars) */
    ctx.fillStyle = '#6090c0';
    var dx = cx + cw - 0.6, dy = cy + 0.5, dz = 0.20 + ch + 0.9;
    Iso.poly(ctx, [P(dx-0.9, dy-0.08, dz+0.10), P(dx+0.4, dy-0.08, dz+0.10), P(dx+0.4, dy+0.08, dz+0.10), P(dx-0.9, dy+0.08, dz+0.10)]);
    Iso.poly(ctx, [P(dx-0.08, dy-0.9, dz+0.10), P(dx+0.08, dy-0.9, dz+0.10), P(dx+0.08, dy+0.5, dz+0.10), P(dx-0.08, dy+0.5, dz+0.10)]);

    /* status lamp */
    var cgPulse = active ? (0.65 + 0.35 * Math.sin(clk * 2.5)) : 0.55;
    ctx.fillStyle = active
      ? 'rgba(70,160,255,' + cgPulse.toFixed(2) + ')'
      : 'rgba(70,80,120,0.55)';
    Iso.disc(ctx, cx + cw - 0.42, cy + 0.32, 0.20 + ch + 0.18, 0.12);

    /* face text */
    faceText(cx + 0.28, csf, 0.34, ['Cognition', 'external'], { size: 6.5, color: 'rgba(120,160,220,0.48)' });

    /* dashed link to evaluator when active */
    if (active && evalPos) {
      var ep  = P(evalPos.x, evalPos.y, 3.5);
      var cp2 = P(cx + cw / 2, cy + cd / 2, ch + 0.5);
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.25 * Math.sin(clk * 3);
      ctx.strokeStyle = '#60a0e0';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(ep.x, ep.y); ctx.lineTo(cp2.x, cp2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      /* data packets along the link */
      for (var pk = 0; pk < 3; pk++) {
        var pt  = (clk * 0.4 + pk / 3) % 1.0;
        var ppt = P(evalPos.x + (cx + cw / 2 - evalPos.x) * pt,
                    evalPos.y + (cy + cd / 2 - evalPos.y) * pt,
                    3.5 + (ch + 0.5 - 3.5) * pt);
        ctx.fillStyle = '#60a0e0';
        ctx.beginPath(); ctx.arc(ppt.x, ppt.y, 3.0, 0, 6.2832); ctx.fill();
      }
    }
  }

  /* ---- carrier (the communication on the belt) ---------------------------- */

  function drawCarrier(vanPos, s) {
    if (!s.running && !s.finished) return;
    var hx = vanPos.dx || 0, hy = vanPos.dy || 1;
    var color = s.sampled ? '#3a6ab0' :
                (s.alertsCreated > 0 ? '#c06030' : '#445570');

    Iso.orientedBox(ctx, {
      x: vanPos.x, y: vanPos.y, z: 0.12,
      hx: hx, hy: hy,
      len: 2.0, wid: 1.4, h: 1.2,
      color: color
    });

    /* latency gauge on top */
    var maxMs = 120000;
    var frac = Math.min(1, (s.latencyMs || 0) / maxMs);
    if (frac > 0) {
      var barColor = frac > 0.7 ? '#d04040' : (frac > 0.4 ? '#d09030' : '#40a060');
      Iso.ribbon(ctx, vanPos.x - 0.8, vanPos.y, vanPos.x + 0.8, vanPos.y, 0.22, 1.33);
      ctx.fillStyle = barColor;
      Iso.ribbon(ctx, vanPos.x - 0.8, vanPos.y,
                       vanPos.x - 0.8 + 1.6 * frac, vanPos.y, 0.18, 1.34);
    }
  }

  /* ---- KEDA replica cylinders -------------------------------------------- */

  function drawReplicas(plan, activeId) {
    if (!plan || !plan.phases) return;
    plan.phases.forEach(function (ph) {
      var st = null;
      World.STATIONS_FLAT.forEach(function (s) { if (s.id === ph.id) st = s; });
      if (!st) return;
      var repColor = ph.overThresh ? '#a83020' : '#2a7030';
      var cx = st.x + st.w / 2 + 0.5;
      var cy = st.y - st.d / 2;
      for (var r = 0; r < ph.replicas; r++) {
        Iso.cylinder(ctx, {
          x: cx + r * 0.4, y: cy - r * 0.2,
          z: st.h + 0.35 + r * 0.6,
          r: 0.22, h: 0.5, color: repColor
        });
      }
    });
  }

  /* ---- label queue -------------------------------------------------------- */

  /* sx,sy  = bubble centre in iso-screen coords (high above the building)
     ax,ay  = anchor/leader-line target in iso-screen coords (building top)
             if omitted, anchor = bubble centre (no leader line)            */
  function addLabel(sx, sy, text, sub, color, sub2, ax, ay) {
    labels.push({
      sx: sx, sy: sy,
      ax: (ax !== undefined) ? ax : sx,
      ay: (ay !== undefined) ? ay : sy,
      text: text, sub: sub, sub2: sub2,
      color: color || '#607090'
    });
  }

  /* Draw labels in PHYSICAL pixel space.
     iso-pixel → CSS pixel:    cam.ox + coord * cam.scale
     CSS pixel → physical px:  multiply by dpr
     The bubble centre (sx,sy) and anchor (ax,ay) are both in iso-screen coords.
     The caller pushes sx,sy UP by adding z-units in iso-space before passing
     them in, so the separation scales naturally with zoom.                  */
  function drawLabels(dpr) {
    if (!showLabels) return;
    var i, lb, apx, apy, bpx, bpy;
    var tw1, tw2, tw3, bw, bh, lineCount;

    ctx.save();
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';

    var fs    = Math.round(11 * dpr);
    var fss   = Math.round(9  * dpr);
    var fss2  = Math.round(8  * dpr);
    var lineH = Math.round(15 * dpr);
    var padV  = Math.round(6  * dpr);
    var padH  = Math.round(10 * dpr);
    var RAD   = Math.round(4  * dpr);

    for (i = 0; i < labels.length; i++) {
      lb = labels[i];

      /* anchor = building top, in physical pixels */
      apx = (cam.ox + lb.ax * cam.scale) * dpr;
      apy = (cam.oy + lb.ay * cam.scale) * dpr;

      /* bubble centre = caller-positioned iso point, in physical pixels */
      bpx = (cam.ox + lb.sx * cam.scale) * dpr;
      bpy = (cam.oy + lb.sy * cam.scale) * dpr;

      /* measure every line */
      ctx.font = 'bold ' + fs + 'px system-ui,sans-serif';
      tw1 = ctx.measureText(lb.text).width;
      tw2 = 0;
      if (lb.sub)  { ctx.font = fss  + 'px system-ui,sans-serif'; tw2 = ctx.measureText(lb.sub).width;  }
      tw3 = 0;
      if (lb.sub2) { ctx.font = fss2 + 'px system-ui,sans-serif'; tw3 = ctx.measureText(lb.sub2).width; }

      bw = Math.max(tw1, tw2, tw3) + padH * 2;
      lineCount = 1 + (lb.sub ? 1 : 0) + (lb.sub2 ? 1 : 0);
      bh = lineCount * lineH + padV * 2;

      /* dashed leader line: bubble bottom → anchor — thick black */
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.80)';
      ctx.lineWidth   = Math.round(2 * dpr);
      ctx.setLineDash([Math.round(5 * dpr), Math.round(4 * dpr)]);
      ctx.beginPath();
      ctx.moveTo(bpx, bpy + bh / 2 + Math.round(2 * dpr));
      ctx.lineTo(apx, apy);
      ctx.stroke();
      ctx.setLineDash([]);

      /* bubble: light fill, thick dark rounded border */
      ctx.fillStyle   = 'rgba(228, 238, 252, 0.96)';
      ctx.strokeStyle = 'rgba(30, 40, 80, 0.80)';
      ctx.lineWidth   = Math.round(2 * dpr);
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(bpx - bw / 2, bpy - bh / 2, bw, bh, RAD);
      } else {
        ctx.rect(bpx - bw / 2, bpy - bh / 2, bw, bh);
      }
      ctx.fill();
      ctx.stroke();

      /* text — all dark, centred vertically in the bubble */
      ctx.font      = 'bold ' + fs + 'px system-ui,sans-serif';
      ctx.fillStyle = '#182030';
      if (lineCount === 1) {
        ctx.fillText(lb.text, bpx, bpy);
      } else if (lineCount === 2) {
        ctx.fillText(lb.text, bpx, bpy - lineH / 2);
        ctx.font = fss + 'px system-ui,sans-serif'; ctx.fillStyle = '#445060';
        ctx.fillText(lb.sub,  bpx, bpy + lineH / 2);
      } else {
        ctx.fillText(lb.text, bpx, bpy - lineH);
        ctx.font = fss + 'px system-ui,sans-serif'; ctx.fillStyle = '#445060';
        ctx.fillText(lb.sub,  bpx, bpy);
        ctx.font = fss2 + 'px system-ui,sans-serif'; ctx.fillStyle = '#607888';
        ctx.fillText(lb.sub2, bpx, bpy + lineH);
      }
    }

    ctx.restore();
  }

  /* ---- main draw entry point ---------------------------------------------- */

  function draw(canvas, camIn, clock, activeId, hoverDistId) {
    cam = camIn;
    clk = clock;
    ctx = canvas.getContext('2d');
    var dpr = cam.dpr || 1;

    /* ---- WIPE the entire canvas FIRST (prevents layering on pan/zoom) ---- */
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(cam.ox, cam.oy);
    ctx.scale(cam.scale, cam.scale);

    var vw = canvas.width / dpr;   /* CSS pixel dimensions */
    var vh = canvas.height / dpr;

    drawFloor(vw, vh);
    drawCognitionFloor(vw, vh);
    drawBelt();

    /* ---- collect objects for depth sort ---- */
    var objects = [];
    var s = Sim.state;
    var plan = s.plan || Sim.planNow();

    /* belt stations */
    World.STATIONS_FLAT.forEach(function (st) {
      var active = st.id === activeId || st.id === s.station;
      objects.push({
        kind:    st.kind === 'gate' ? 'gate' : 'machine',
        x: st.x, y: st.y, w: st.w, d: st.d, h: st.h,
        color:   st.color,
        id:      st.id,
        label:   st.label || st.id,
        active:  active,
        sortKey: st.x + st.y
      });
    });

    /* side structures */
    World.SIDE_STRUCTS.forEach(function (ss) {
      objects.push({
        kind:     'side',
        x: ss.x, y: ss.y, w: ss.w, d: ss.d, h: ss.h,
        color:    ss.color,
        id:       ss.id,
        label:    ss.label,
        sublabel: ss.sublabel,
        active:   ss.id === activeId || ss.id === hoverDistId,
        sortKey:  ss.x + ss.y
      });
    });

    /* Cognition */
    var cg = World.COGNITION;
    objects.push({
      kind: 'cognition',
      x: cg.x, y: cg.y, w: cg.w, d: cg.d, h: cg.h,
      sortKey: cg.x + cg.y
    });

    /* carrier */
    var vanPos = Sim.vanPosition();
    objects.push({
      kind: 'carrier', pos: vanPos,
      sortKey: vanPos.x + vanPos.y
    });

    /* depth sort */
    objects.sort(function (a, b) { return a.sortKey - b.sortKey; });

    /* ---- sorted draw pass ---- */
    labels = [];
    var evalSt = null;
    World.STATIONS_FLAT.forEach(function (st) { if (st.id === 'evaluator') evalSt = st; });

    /* Z-lift in iso-units added to building h to position bubble above roof.
       Scales naturally with cam.scale so separation stays proportional.    */
    var ZL = 8;

    objects.forEach(function (o) {
      var bub, anc;  /* bubble centre and leader-line anchor, both in iso-screen */

      /* For a vertical leader line, bubble and anchor must share the same
         world (x, y) — only z differs, so screen-x is identical for both. */
      if (o.kind === 'machine') {
        if (o.id === 'gateway') {
          drawGateway(o, o.active);
          bub = P(o.x, o.y, o.h + ZL);
          anc = P(o.x, o.y, o.h + 0.1);
          addLabel(bub.x, bub.y, o.id, null,
                   o.active ? '#e0c060' : '#8090a8',
                   null, anc.x, anc.y);

        } else if (o.id === 'qualifier') {
          drawQualifier(o, o.active);
          bub = P(o.x, o.y, 2.5 + ZL);
          anc = P(o.x, o.y, 2.5 + 0.1);
          addLabel(bub.x, bub.y, 'QUALIFIER', 'ec-queue-qualifier',
                   o.active ? '#c0e090' : '#7a9060',
                   'k8s', anc.x, anc.y);

        } else if (o.id === 'filter') {
          drawFilter(o, o.active);
          bub = P(o.x, o.y, 3.80 + ZL);
          anc = P(o.x, o.y, 3.80);
          addLabel(bub.x, bub.y, 'FILTER', 'ec-surveillance-filter',
                   o.active ? '#ffe060' : '#8a7030',
                   'k8s', anc.x, anc.y);

        } else if (o.id === 'evaluator') {
          drawEvaluator(o, o.active);
          bub = P(o.x, o.y, 3.80 + ZL);
          anc = P(o.x, o.y, 3.80);
          addLabel(bub.x, bub.y, 'EVALUATOR', 'ec-surveillance-policy-evaluator',
                   o.active ? '#48d8c0' : '#2a7060',
                   'k8s', anc.x, anc.y);

        } else {
          drawMachine(o);
          bub = P(o.x, o.y, o.h + ZL);
          anc = P(o.x, o.y, o.h + 0.1);
          addLabel(bub.x, bub.y, o.id, null,
                   o.active ? '#e0c060' : '#8090a8',
                   null, anc.x, anc.y);
        }

      } else if (o.kind === 'gate') {
        drawGate(o, s.sampled);
        bub = P(o.x, o.y, o.h + ZL);
        anc = P(o.x, o.y, o.h + 0.45);
        addLabel(bub.x, bub.y, o.id, null,
                 o.active ? '#f0d040' : '#a09060',
                 null, anc.x, anc.y);

      } else if (o.kind === 'side') {
        /* side structs: o.x/o.y is the NW corner; use box centre for both */
        var scx = o.x + o.w / 2, scy = o.y + o.d / 2;
        drawSideStruct(o);
        bub = P(scx, scy, o.h + ZL - 2);
        anc = P(scx, scy, o.h + 0.2);
        addLabel(bub.x, bub.y, o.label, o.sublabel,
                 o.active ? '#a0c8f0' : '#6880a0',
                 null, anc.x, anc.y);

      } else if (o.kind === 'cognition') {
        var cgcx = cg.x + cg.w / 2, cgcy = cg.y + cg.d / 2;
        drawCognition(s.sentToCognition > 0,
                      evalSt ? { x: evalSt.x, y: evalSt.y } : null);
        bub = P(cgcx, cgcy, cg.h + ZL - 2);
        anc = P(cgcx, cgcy, cg.h + 0.2);
        addLabel(bub.x, bub.y, 'Cognition', 'external', '#607090',
                 null, anc.x, anc.y);

      } else if (o.kind === 'carrier') {
        drawCarrier(o.pos, s);
      }
    });

    /* archive source marker — same x,y for both so line is vertical */
    var srcAnc = P(4, 6, 0.1);
    var srcBub = P(4, 6, 5.1);
    addLabel(srcBub.x, srcBub.y, 'Archive', 'supBulkIndexingTopic_k8s', '#506070',
             null, srcAnc.x, srcAnc.y);

    /* KEDA replica overlays disabled — represented in phase chart instead */

    /* active station highlight ring */
    if (activeId) {
      var ast = null;
      World.STATIONS_FLAT.forEach(function (st) { if (st.id === activeId) ast = st; });
      if (!ast) World.SIDE_STRUCTS.forEach(function (ss) { if (ss.id === activeId) ast = ss; });
      if (ast) {
        var ap = P(ast.x + (ast.w || 5) / 2, ast.y + (ast.d || 3) / 2, 0.01);
        ctx.strokeStyle = 'rgba(200,160,40,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(ap.x, ap.y,
                    (ast.w || 5) * Iso.TW * 0.8,
                    (ast.w || 5) * Iso.TH * 1.1,
                    0, 0, 6.2832);
        ctx.stroke();
      }
    }

    ctx.restore();

    /* ---- label pass (physical pixel space, after restore) ---- */
    drawLabels(dpr);
  }

  function setLabels(v) { showLabels = v; }

  global.Renderer = { draw: draw, setLabels: setLabels };
})(window);
