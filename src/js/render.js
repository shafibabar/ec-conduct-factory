/* render.js: EC City painter's-algorithm renderer.
 *
 * Layers, in order: sky, ground, district washes, roads, ONE SORTED PASS,
 * overlays (KEDA replica bars, Cognition beam), then screen-space labels.
 *
 * Custom `kind` functions below draw landmarks that carry model state.
 * Keep each one small — the scenery is context, not the lesson.
 */
(function (global) {
  'use strict';

  var Iso = global.Iso, World = global.World, Sim = global.Sim, EC = global.EC;
  var P = Iso.project;

  var cam = null, ctx = null, t = 0;
  var labels = [];
  var showLabels = true;
  var C = World.palette;

  /* ------------------------------------------------------------------ sky */

  function drawSky(w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#eef3f7');
    g.addColorStop(0.5, '#e8edf0');
    g.addColorStop(1, '#e2e6e4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /* --------------------------------------------------------------- ground */

  function plate(inset, z) {
    return [
      P(inset, inset, z), P(World.GW - inset, inset, z),
      P(World.GW - inset, World.GH - inset, z), P(inset, World.GH - inset, z)
    ];
  }

  var GRASS = ['#8aa96a', '#93b073', '#83a463', '#9ab77c', '#7fa064'];

  function drawGround() {
    ctx.fillStyle = 'rgba(110,114,100,0.28)';
    Iso.poly(ctx, plate(-0.9, -0.35));
    ctx.fillStyle = '#93b073';
    Iso.poly(ctx, plate(0, 0));

    for (var gx = 1; gx < World.GW; gx += 2) {
      for (var gy = 1; gy < World.GH; gy += 2) {
        var n = Iso.hash2(gx, gy, 17);
        if (n < 0.45) continue;
        ctx.fillStyle = GRASS[(n * 5) | 0];
        Iso.disc(ctx, gx + n, gy + (1 - n), 0, 0.7 + n * 0.5);
      }
    }
    ctx.strokeStyle = 'rgba(74,69,64,0.26)';
    ctx.lineWidth = 1.4;
    Iso.polyLine(ctx, plate(0, 0), true);
  }

  function drawZones(activeId) {
    for (var i = 0; i < World.districts.length; i++) {
      var d = World.districts[i];
      var on = d.id === activeId;
      ctx.fillStyle = Iso.rgba(d.color, on ? 0.16 : 0.055);
      Iso.disc(ctx, d.x, d.y, 0.01, d.r);
      if (on) {
        ctx.strokeStyle = Iso.rgba(d.color, 0.5);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        var p = P(d.x, d.y, 0.01);
        ctx.ellipse(p.x, p.y, d.r * Iso.TW * 1.41421, d.r * Iso.TH * 1.41421, 0, 0, 6.2832);
        ctx.stroke();
      }
    }
  }

  /* ---------------------------------------------------------------- roads */

  function roadQuad(a, b, width, dz) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len * width / 2, ny = dx / len * width / 2;
    var za = (a.z || 0) + (dz || 0), zb = (b.z || 0) + (dz || 0);
    Iso.poly(ctx, [
      P(a.x + nx, a.y + ny, za), P(b.x + nx, b.y + ny, zb),
      P(b.x - nx, b.y - ny, zb), P(a.x - nx, a.y - ny, za)
    ]);
  }

  function drawRoute(route, opts) {
    var width = opts.width, i, s;
    ctx.fillStyle = opts.shoulder || C.road;
    for (i = 0; i < route.segs.length; i++) {
      s = route.segs[i];
      roadQuad(s.a, s.b, width + 0.5, 0);
      Iso.disc(ctx, s.a.x, s.a.y, s.a.z || 0, (width + 0.5) / 2);
    }
    var last = route.pts[route.pts.length - 1];
    Iso.disc(ctx, last.x, last.y, last.z || 0, (width + 0.5) / 2);

    ctx.fillStyle = opts.surface || C.roadTop;
    for (i = 0; i < route.segs.length; i++) {
      s = route.segs[i];
      roadQuad(s.a, s.b, width, 0.005);
      Iso.disc(ctx, s.a.x, s.a.y, (s.a.z || 0) + 0.005, width / 2);
    }
    Iso.disc(ctx, last.x, last.y, (last.z || 0) + 0.005, width / 2);

    ctx.strokeStyle = opts.dash || 'rgba(96,90,78,0.35)';
    ctx.lineWidth = 1.3;
    ctx.setLineDash([6, 7]);
    ctx.beginPath();
    for (i = 0; i < route.pts.length; i++) {
      var pp = P(route.pts[i].x, route.pts[i].y, (route.pts[i].z || 0) + 0.01);
      if (i === 0) ctx.moveTo(pp.x, pp.y); else ctx.lineTo(pp.x, pp.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawRoads() {
    // Main pipeline road
    drawRoute(World.routes.out,   { width: 2.6 });
    // Alert road (sampled path) — warm terracotta to signal value
    drawRoute(World.routes.alert, { width: 2.2, surface: '#d8cec0', dash: 'rgba(170,80,70,0.4)' });
    // Audit shortcut (not-sampled path) — cooler stone
    drawRoute(World.routes.audit, { width: 2.0, surface: '#ccc8be', dash: 'rgba(90,88,78,0.3)' });
  }

  /* ----------------------------------------------------------- landmarks  */

  var FACE_ANG = Math.atan2(Iso.TH, Iso.TW);
  var FACE_U   = Math.hypot(Iso.TW, Iso.TH);

  /* A dockside crane — the archive dock entry point */
  function drawCrane(b) {
    // mast
    Iso.box(ctx, { x: b.x - 0.22, y: b.y - 0.22, z: 0, w: 0.44, d: 0.44, h: 4.0, color: '#9a9488' });
    // boom
    Iso.box(ctx, { x: b.x, y: b.y - 2.8, z: 4.0, w: 0.28, d: 2.8, h: 0.26, color: '#b8b0a0' });
    // hook cable
    var hook = P(b.x, b.y - 2.6, 3.0);
    var top  = P(b.x, b.y - 2.6, 4.0);
    ctx.strokeStyle = 'rgba(80,74,64,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(hook.x, hook.y);
    ctx.stroke();
  }

  /* Shredder at the gateway — represents minification of indexable.json */
  function drawShredder(b) {
    Iso.box(ctx, { x: b.x - 1.0, y: b.y - 0.7, z: 0, w: 2.0, d: 1.4, h: 1.2, color: '#9ab0c0' });
    // slot on top
    var slot = P(b.x, b.y - 0.08, 1.2);
    ctx.fillStyle = Iso.rgba('#334455', 0.6);
    ctx.fillRect(slot.x - 14, slot.y - 2, 28, 4);
    // shredded paper spilling out
    var s = Sim.state;
    if (s.station === 'gateway') {
      for (var i = 0; i < 5; i++) {
        var ph = (t * 0.8 + i * 0.2) % 1;
        var pp = P(b.x + (i - 2) * 0.22, b.y + 0.4, 0.3 + ph * 0.5);
        ctx.fillStyle = Iso.rgba('#e8e4d8', 0.7 * (1 - ph));
        ctx.fillRect(pp.x - 3, pp.y, 6, 2);
      }
    }
  }

  /* Pigeonholes — represents the pipeline-entity-mapping lookup */
  function drawPigeonholes(b) {
    Iso.box(ctx, { x: b.x - 1.4, y: b.y - 0.8, z: 0, w: 2.8, d: 1.6, h: 2.0, color: '#ccc4da' });
    // pigeon slots
    var s = Sim.state;
    var active = s.station === 'qualifier';
    for (var row = 0; row < 3; row++) {
      for (var col = 0; col < 4; col++) {
        var n = Iso.hash2(row, col, 19);
        var filled = active && (row * 4 + col) < (s.pipelineCount || 0) * 2;
        ctx.fillStyle = filled ? Iso.rgba(C.violet, 0.6) : Iso.rgba('#4a4060', 0.22);
        var pz = 0.28 + row * 0.55;
        var py = b.y - 1.0 + col * 0.44;
        var pp = P(b.x + 1.4, py, pz);
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 5, 0, 6.2832);
        ctx.fill();
      }
    }
  }

  /* Two-stage screens — represents ignore-then-flag policy evaluation */
  function drawScreens(b) {
    // coarse screen (ignore policies)
    Iso.box(ctx, { x: b.x - 1.5, y: b.y - 0.5, z: 0, w: 1.2, d: 1.0, h: 2.2, color: '#d8c090' });
    // fine screen (flag policies)
    Iso.box(ctx, { x: b.x + 0.4, y: b.y - 0.5, z: 0, w: 1.2, d: 1.0, h: 2.2, color: '#e8c87c' });
    // bars on screens
    ctx.strokeStyle = Iso.rgba('#7a6030', 0.5);
    ctx.lineWidth = 1.2;
    for (var r = 0; r < 4; r++) {
      var z0 = 0.4 + r * 0.45;
      for (var sx = 0; sx < 2; sx++) {
        var bx = b.x + sx * 1.9 - 1.5;
        var a = P(bx, b.y - 0.5, z0), bb = P(bx + 1.2, b.y - 0.5, z0);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(bb.x, bb.y);
        ctx.stroke();
      }
    }
  }

  /* Freight bay — Cognition outbound crates */
  function drawFreightBay(b) {
    Iso.box(ctx, { x: b.x - 1.2, y: b.y - 0.8, z: 0, w: 2.4, d: 1.6, h: 0.4, color: '#8ab0ac' });
    var s = Sim.state;
    var sending = s.station === 'evaluator' && s.sentToCognition > 0;
    // outbound crate
    Iso.box(ctx, { x: b.x - 0.7, y: b.y - 0.5, z: 0.4, w: 1.4, d: 1.0, h: 0.9,
                   color: sending ? Iso.mix(C.teal, '#ffffff', 0.3) : '#b0cac8' });
    if (sending) {
      // beam going to Cognition (off-screen toward upper right)
      var beam = P(b.x, b.y - 0.3, 1.4);
      ctx.strokeStyle = Iso.rgba(C.teal, 0.5 + 0.35 * Math.sin(t * 4));
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(beam.x, beam.y);
      ctx.lineTo(beam.x + 60, beam.y - 35);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* Weighbridge with Redis counter bar */
  function drawWeighbridge(b) {
    // platform
    Iso.box(ctx, { x: b.x - 1.6, y: b.y - 0.6, z: 0, w: 3.2, d: 1.2, h: 0.4, color: '#a0b8a0' });
    // counter display — shows quota ratio
    var s = Sim.state;
    var frac = s.quotaLimit > 0 ? Math.min(1, s.quotaUsed / s.quotaLimit) : 0;
    var barW = 2.8;
    Iso.box(ctx, { x: b.x - barW / 2, y: b.y - 0.3, z: 0.4, w: 0.1, d: 0.6, h: 1.2, color: '#7a9878' });
    Iso.box(ctx, { x: b.x + barW / 2 - 0.1, y: b.y - 0.3, z: 0.4, w: 0.1, d: 0.6, h: 1.2, color: '#7a9878' });
    // fill bar — actual quota used
    if (frac > 0) {
      var fillColor = frac > 0.85 ? '#e8603a' : frac > 0.6 ? '#d4a030' : C.sage;
      Iso.box(ctx, { x: b.x - barW / 2 + 0.05, y: b.y - 0.2, z: 0.42,
                     w: Math.max(0.06, (barW - 0.1) * frac), d: 0.4, h: 0.56, color: fillColor, edge: false });
    }
  }

  /* Assembly Hall conveyor + four feeder arms */
  function drawAssembly(b) {
    // base conveyor
    Iso.box(ctx, { x: b.x - 2.0, y: b.y - 0.5, z: 0, w: 4.0, d: 1.0, h: 0.4, color: '#c07888' });
    // four feeder stubs
    var s = Sim.state;
    var active = s.station === 'alerting';
    [[-1.4, -1.8], [0, -1.8], [1.4, -1.8], [0, 1.4]].forEach(function (off, i) {
      var lit = active && ((t * 3 + i) % 1) > 0.4;
      Iso.box(ctx, { x: b.x + off[0] - 0.2, y: b.y + off[1] - 0.2, z: 0.4,
                     w: 0.4, d: 0.4, h: 0.7,
                     color: lit ? Iso.mix(C.rose, '#ffffff', 0.3) : '#d4a0a8' });
    });
    // alert box on conveyor — the SupervisedItem
    if (s.alertsCreated > 0) {
      Iso.box(ctx, { x: b.x - 0.5, y: b.y - 0.25, z: 0.4, w: 1.0, d: 0.5, h: 0.8,
                     color: Iso.mix(C.rose, '#ffffff', 0.2) });
    }
  }

  /* Fingerprint wall — 14-day TTL fingerprint ledger */
  function drawFingerprintWall(b) {
    // wall panel
    Iso.box(ctx, { x: b.x - 1.4, y: b.y - 0.2, z: 0, w: 2.8, d: 0.4, h: 2.6, color: '#ccc0da' });
    // fingerprint dots — 14 days worth
    var s = Sim.state;
    for (var day = 0; day < EC.ECHO_TTL_DAYS; day++) {
      var n = Iso.hash2(day, 7, s.trips || 0);
      var hasMark = day < 10 || n > 0.5;
      var col = day % 7, row = (day / 7) | 0;
      var pz = 0.3 + row * 1.0;
      var py = b.y - 0.18 + col * 0.36;
      var pp = P(b.x + 1.4, py, pz);
      ctx.fillStyle = hasMark
        ? (s.isEcho && day === 3 ? Iso.rgba(C.plum, 0.9) : Iso.rgba(C.plum, 0.45))
        : Iso.rgba('#9090a0', 0.2);
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, hasMark ? 4.5 : 3, 0, 6.2832);
      ctx.fill();
    }
  }

  /* Rail yard — ES bulk buffer visible as a train of crates */
  function drawRailYard(b) {
    // rail track
    ctx.strokeStyle = Iso.rgba('#7a6a54', 0.55);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    var r1 = P(b.x - 2.0, b.y + 0.4, 0.05);
    var r2 = P(b.x + 3.2, b.y + 0.4, 0.05);
    ctx.moveTo(r1.x, r1.y);
    ctx.lineTo(r2.x, r2.y);
    ctx.stroke();
    // batch crates — one per 10 records buffered
    var s = Sim.state;
    var batchPos = s.batchPosition || 0;
    var crates = Math.max(0, Math.min(5, Math.round(batchPos / 10)));
    for (var i = 0; i < crates; i++) {
      Iso.box(ctx, { x: b.x - 1.8 + i * 0.9, y: b.y + 0.1, z: 0.1,
                     w: 0.76, d: 0.56, h: 0.6,
                     color: i % 2 ? C.orange : Iso.mix(C.orange, '#ffffff', 0.2) });
    }
  }

  /* Tally room — the audit ledger's reconciliation counter */
  function drawTallyRoom(b) {
    // ledger table
    Iso.box(ctx, { x: b.x - 1.2, y: b.y - 0.8, z: 0, w: 2.4, d: 1.6, h: 0.7, color: '#b89878' });
    // tally marks
    var s = Sim.state;
    var count = Math.min(20, s.auditEventsEmitted || 0);
    for (var i = 0; i < count; i++) {
      var col = i % 5, row = (i / 5) | 0;
      var pp = P(b.x + 1.2, b.y - 1.2 + col * 0.32, 0.72 + row * 0.25);
      ctx.fillStyle = Iso.rgba(C.brick, 0.75);
      ctx.fillRect(pp.x - 2, pp.y - 5, 4, 10);
    }
    // open ledger book on top
    Iso.box(ctx, { x: b.x - 0.8, y: b.y - 0.5, z: 0.7, w: 1.6, d: 1.0, h: 0.1,
                   color: '#e8dcc4', edge: false });
  }

  /* Config curator canal lock gate */
  function drawLockGate(b) {
    // two gate leaves
    Iso.box(ctx, { x: b.x - 1.2, y: b.y - 1.0, z: 0, w: 0.3, d: 1.4, h: 3.2, color: '#8ab888' });
    Iso.box(ctx, { x: b.x + 0.9, y: b.y - 1.0, z: 0, w: 0.3, d: 1.4, h: 3.2, color: '#8ab888' });
    // beam across top
    Iso.box(ctx, { x: b.x - 1.2, y: b.y - 0.4, z: 3.2, w: 2.4, d: 0.3, h: 0.28,
                   color: Iso.mix(C.moss, '#ffffff', 0.3) });
  }

  /* Kafka stack props — small crates beside roads representing in-flight messages */
  function drawKafkaStack(p) {
    var n = Iso.hash2(p.x, p.y, p.seed || 1);
    var h = 0.4 + n * 0.6;
    Iso.box(ctx, { x: p.x - 0.4, y: p.y - 0.3, z: 0, w: 0.8, d: 0.6, h: h,
                   color: n > 0.5 ? '#a8a090' : '#bcb4a4' });
  }

  function drawRooftop(o) {
    var m = 0.5;
    Iso.box(ctx, {
      x: o.x + m, y: o.y + m, z: o.z + o.h,
      w: Math.max(0.8, o.w - m * 2),
      d: Math.max(0.8, o.d - m * 2), h: 0.4,
      color: Iso.mix(o.rooftop, '#ffffff', 0.35)
    });
  }

  /* ---- props ------------------------------------------------------------- */

  function drawLamp(p) {
    Iso.cylinder(ctx, { x: p.x, y: p.y, z: 0, r: 0.13, h: 2.7, color: '#9c968a' });
    Iso.box(ctx, { x: p.x - 0.28, y: p.y - 0.22, z: 2.7, w: 0.56, d: 0.44, h: 0.18, color: '#c8c2b2' });
  }

  function drawTree(p) {
    var n = Iso.hash2(p.x, p.y, p.seed || 1);
    Iso.cylinder(ctx, { x: p.x, y: p.y, z: 0, r: 0.18, h: 0.9 + n * 0.4, color: '#8a7358' });
    var r = 0.85 + n * 0.5;
    ctx.fillStyle = n < 0.5 ? '#5f8a52' : '#6d9068';
    Iso.disc(ctx, p.x, p.y, 1.5 + n * 0.8, r);
    ctx.fillStyle = Iso.rgba('#ffffff', 0.16);
    Iso.disc(ctx, p.x - r * 0.25, p.y - r * 0.25, 1.62 + n * 0.8, r * 0.6);
  }

  /* --------------------------------------------------------------- vehicle
     The communication: a small packet-carrier. The gauge on its flank is the
     end-to-end latency accumulated so far. The crate in the bed is the
     minified document (bytesAfterMinify). */

  function drawVan(v) {
    var s = Sim.state;
    var hx = v.dx, hy = v.dy;
    var z  = v.z || 0;

    ctx.fillStyle = 'rgba(80,76,66,0.20)';
    Iso.disc(ctx, v.x, v.y, z + 0.01, 1.0);

    // chassis
    Iso.orientedBox(ctx, { x: v.x, y: v.y, z: z + 0.14, hx: hx, hy: hy, len: 2.4, wid: 1.2, h: 0.32, color: '#505e68' });
    // body — the communication payload
    Iso.orientedBox(ctx, { x: v.x - hx * 0.32, y: v.y - hy * 0.32, z: z + 0.46, hx: hx, hy: hy, len: 1.6, wid: 1.15, h: 0.96, color: '#e8e4d8' });
    // cab
    Iso.orientedBox(ctx, { x: v.x + hx * 0.8, y: v.y + hy * 0.8, z: z + 0.46, hx: hx, hy: hy, len: 0.8, wid: 1.05, h: 0.72, color: '#4a7a9b' });

    // Latency gauge on flank (the lesson: end-to-end accumulated latency)
    var frac = s.plan && s.plan.totalMs > 0 ? Math.min(1, s.latencyMs / s.plan.totalMs) : 0;
    var px = -hy, py = hx;
    var side = (px + py) > 0 ? 1 : -1;
    var gx = v.x - hx * 0.32 + px * side * 0.6;
    var gy = v.y - hy * 0.32 + py * side * 0.6;
    var GLEN = 1.45;
    Iso.orientedBox(ctx, { x: gx, y: gy, z: z + 0.68, hx: hx, hy: hy, len: GLEN, wid: 0.03, h: 0.40, color: '#6d675c', edge: false });
    if (frac > 0) {
      var gcolor = frac > 0.66 ? '#e4643f' : frac > 0.33 ? '#e8b34a' : '#7fc06a';
      Iso.orientedBox(ctx, {
        x: gx - hx * (GLEN * (1 - frac) / 2), y: gy - hy * (GLEN * (1 - frac) / 2),
        z: z + 0.70, hx: hx, hy: hy,
        len: Math.max(0.06, GLEN * frac - 0.06), wid: 0.05, h: 0.32,
        color: gcolor, edge: false
      });
    }

    // the miniIndexable crate in the bed (bytesAfterMinify)
    if (s.bytesAfterMinify > 0) {
      Iso.orientedBox(ctx, {
        x: v.x - hx * 0.8 + px * 0, y: v.y - hy * 0.8 + py * 0,
        z: z + 1.42, hx: hx, hy: hy, len: 0.56, wid: 0.56, h: 0.44,
        color: '#c2913c'
      });
    }

    // wheels
    ctx.fillStyle = '#3f3a34';
    [[0.78, 0.48], [0.78, -0.48], [-0.78, 0.48], [-0.78, -0.48]].forEach(function (o) {
      Iso.disc(ctx, v.x + hx * o[0] + px * o[1], v.y + hy * o[0] + py * o[1], z + 0.13, 0.21);
    });
  }

  /* -------------------------------------------------------------- labels  */

  function drawLabels() {
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    ctx.textBaseline = 'middle';

    labels.sort(function (a, b) { return (b.pri || 0) - (a.pri || 0); });

    var placed = [];
    var i;
    for (i = 0; i < labels.length; i++) {
      var L = labels[i];
      var pp = P(L.x, L.y, L.z);
      L.ax = pp.x * cam.scale + cam.ox;
      L.ay = pp.y * cam.scale + cam.oy;
      L.px = (L.size || 12) * Math.min(1.15, Math.max(0.92, cam.scale));
      ctx.font = (L.bold ? '600 ' : '') + L.px + 'px ' + fontOf(L);
      var wpx = ctx.measureText(L.text).width;
      var subw = L.sub ? ctx.measureText(L.sub).width * 0.85 : 0;
      L.boxW = Math.max(wpx, subw) + 16;
      L.boxH = L.sub ? L.px * 2.4 : L.px * 1.75;
      L.sy = L.lift ? L.ay - L.lift - L.boxH / 2 : L.ay;
      for (var tries = 0; tries < 10 && overlaps(L, placed); tries++) L.sy -= L.boxH * 0.92;
      placed.push(L);
    }
    for (i = 0; i < labels.length; i++) drawPlate(labels[i]);
  }

  function fontOf(L) {
    return L.mono
      ? 'ui-monospace, Menlo, Consolas, monospace'
      : '"Iowan Old Style", Palatino, "Palatino Linotype", Georgia, serif';
  }

  function overlaps(L, placed) {
    for (var i = 0; i < placed.length; i++) {
      var o = placed[i];
      if (Math.abs(L.ax - o.ax) < (L.boxW + o.boxW) / 2 + 2 &&
          Math.abs(L.sy - o.sy) < (L.boxH + o.boxH) / 2 + 2) return true;
    }
    return false;
  }

  function drawPlate(L) {
    var ax = L.ax, ay = L.ay, sy = L.sy, size = L.px;
    var boxW = L.boxW, boxH = L.boxH;
    ctx.textAlign = 'center';
    ctx.font = (L.bold ? '600 ' : '') + size + 'px ' + fontOf(L);
    if (L.lift) {
      ctx.strokeStyle = Iso.rgba(L.tint || '#6e6250', 0.6);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(ax, sy + boxH / 2);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      ctx.fillStyle = Iso.rgba(L.tint || '#6e6250', 0.85);
      ctx.beginPath();
      ctx.arc(ax, ay, 2.4, 0, 6.2832);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(96,84,66,0.26)';
    roundRect(ax - boxW / 2 + 1, sy - boxH / 2 + 2.5, boxW, boxH, 5);
    ctx.fill();
    ctx.fillStyle = L.tint ? Iso.mix('#fffdf7', L.tint, 0.14) : '#fffdf7';
    roundRect(ax - boxW / 2, sy - boxH / 2, boxW, boxH, 5);
    ctx.fill();
    ctx.strokeStyle = Iso.rgba(L.tint || '#6e6250', 0.85);
    ctx.lineWidth = L.bold ? 1.7 : 1.2;
    roundRect(ax - boxW / 2, sy - boxH / 2, boxW, boxH, 5);
    ctx.stroke();
    ctx.fillStyle = L.color || '#3a352e';
    ctx.fillText(L.text, ax, sy + (L.sub ? -size * 0.42 : 0));
    if (L.sub) {
      ctx.font = (size * 0.85) + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(88,80,68,0.75)';
      ctx.fillText(L.sub, ax, sy + size * 0.62);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------------------------------------------------------- draw  */

  function key(o) { return o.x + o.y + ((o.w || 0) + (o.d || 0)) * 0.5; }

  var KIND = {
    crane:           drawCrane,
    shredder:        drawShredder,
    pigeonholes:     drawPigeonholes,
    screens:         drawScreens,
    freightBay:      drawFreightBay,
    weighbridge:     drawWeighbridge,
    assembly:        drawAssembly,
    fingerprintWall: drawFingerprintWall,
    railYard:        drawRailYard,
    tallyRoom:       drawTallyRoom,
    lockGate:        drawLockGate,
    kafkaStack:      drawKafkaStack
  };

  function draw(canvas, camera, time, activeDistrict, hoverDistrict) {
    ctx = canvas.getContext('2d');
    cam = camera;
    t   = time;
    labels.length = 0;

    var w = canvas.width / cam.dpr, h = canvas.height / cam.dpr;
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    drawSky(w, h);

    ctx.setTransform(cam.scale * cam.dpr, 0, 0, cam.scale * cam.dpr,
                     cam.ox * cam.dpr, cam.oy * cam.dpr);

    drawGround();
    drawZones(activeDistrict);
    drawRoads();

    /* ---- one sorted pass ---- */
    var items = [];
    var i;

    for (i = 0; i < World.buildings.length; i++) {
      var b = World.buildings[i];
      if (b.kind && KIND[b.kind]) items.push({ k: b.x + b.y, f: KIND[b.kind], a: b });
      else items.push({ k: key(b), f: null, a: b });
    }
    for (i = 0; i < World.props.length; i++) {
      var pr = World.props[i];
      var fn = pr.kind === 'tree' ? drawTree
             : pr.kind === 'lamp' ? drawLamp
             : pr.kind === 'kafkaStack' ? drawKafkaStack
             : null;
      if (fn) items.push({ k: pr.x + pr.y, f: fn, a: pr });
    }

    var v = Sim.vanPosition();
    items.push({ k: v.x + v.y + 0.2, f: drawVan, a: v });

    items.sort(function (p, q) { return p.k - q.k; });
    for (i = 0; i < items.length; i++) {
      if (items[i].f) { items[i].f(items[i].a); continue; }
      var o = items[i].a;
      Iso.box(ctx, o);
      if (o.roof) {
        Iso.gableRoof(ctx, {
          x: o.x - 0.08, y: o.y - 0.08, z: o.z + o.h,
          w: o.w + 0.16, d: o.d + 0.16, h: o.roofH || 0.45, color: o.roof
        });
      } else if (o.rooftop) {
        drawRooftop(o);
      }
    }

    /* ---- KEDA replica overlay: small cylinders above active building ---- */
    var s = Sim.state;
    if (s.plan && s.station && s.charged) {
      var ph = null;
      s.plan.phases.forEach(function (p) { if (p.id === s.station) ph = p; });
      if (ph && ph.replicas > 0) {
        var d = World.districtById[s.station];
        if (d) {
          ctx.setTransform(cam.scale * cam.dpr, 0, 0, cam.scale * cam.dpr, cam.ox * cam.dpr, cam.oy * cam.dpr);
          for (var ri = 0; ri < Math.min(ph.replicas, 8); ri++) {
            var rangle = (ri / 8) * Math.PI * 2;
            var rx = d.x + Math.cos(rangle) * 2.2;
            var ry = d.y + Math.sin(rangle) * 1.2;
            Iso.cylinder(ctx, { x: rx, y: ry, z: 0, r: 0.22, h: 0.5 + ph.replicas * 0.18,
                                 color: Iso.mix(d.color, '#ffffff', 0.4) });
          }
        }
      }
    }

    /* ---- district labels ---- */
    if (showLabels) {
      var declutter = cam.scale < 0.34;
      for (i = 0; i < World.districts.length; i++) {
        var dd = World.districts[i];
        var isActive = dd.id === activeDistrict || dd.id === hoverDistrict;
        if (declutter && !isActive) continue;
        var sub = isActive ? dd.tag : null;
        if (s.charged && s.charged[dd.id] != null) sub = '+' + EC.fmtMs(s.charged[dd.id]);
        labels.push({
          x: dd.x, y: dd.y, z: 0, lift: isActive ? 34 : 26,
          text: dd.name, sub: sub,
          color: isActive ? dd.color : '#3d3831',
          tint: dd.color,
          size: isActive ? 16.5 : 14, bold: isActive,
          pri: isActive ? 2 : 1
        });
      }
    }

    /* Running latency label above the vehicle */
    if (s.running) {
      labels.push({
        x: v.x, y: v.y, z: (v.z || 0) + 2.4, lift: 8,
        text: EC.fmtMs(s.latencyMs),
        sub: s.bytesAfterMinify > 0 ? EC.fmtKb(s.bytesAfterMinify) + ' aboard' : 'gcid loaded',
        color: '#3d3831', tint: '#8a8272', size: 14, bold: true, mono: true,
        pri: 3
      });
    }

    drawLabels();
  }

  global.Renderer = {
    draw: draw,
    setLabels: function (v) { showLabels = v; }
  };
})(window);
