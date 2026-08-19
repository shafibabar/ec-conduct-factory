/* factory.js: EC factory floor — palette and floor-drawing.
 *
 * Mirrors the role of factory.js in rocket-engine: owns the colour palette
 * and every drawing call that covers the ground before any structure goes up.
 *
 * Exports:  global.Factory = { C, drawFloor }
 *
 *   Factory.C          — colour palette object (dirt, concrete, hazard tones)
 *   Factory.drawFloor  — function(ctx, Iso, cam, GW, GH, vw, vh)
 *                        draws the outer ground mosaic + hazard border + slab
 */
(function (global) {
  'use strict';

  /* ---- palette -------------------------------------------------------------- */

  /* EC industrial palette. Low-chroma cool tones with warm earth for the
     outer ground. Hazard amber matches the belt's corner halos. */
  var C = {
    dirt:          '#453b30',   /* base fill — warm dark earth (same spread as rocket) */
    dirt2:         '#4d4237',   /* mosaic variant 1 */
    dirt3:         '#3e352b',   /* mosaic variant 2 */
    dirt4:         '#524738',   /* mosaic variant 3 */

    concrete:      '#5f5d57',   /* factory slab base */
    concrete2:     '#2b3040',   /* bay-pour tile variant */

    hazardDark:    '#1c1a14',   /* dark stripe in hazard band */
    hazardAmber:   '#c9a233',   /* amber stripe in hazard band */

    beltFrame:     '#1a1e28',   /* outer belt shoulder (EC navy, cooler than rocket) */
    beltDeck:      '#22273a',   /* belt running surface */
    beltRail:      '#b08a2c'    /* side rails — amber, matches hazard banding */
  };

  /* ---- hazard band ---------------------------------------------------------- */

  /* Draws diagonal amber / dark stripes along an iso-grid line segment,
     clipped to the band's own quad. Ported from rocket-engine iso.js. */
  function hazardBand(ctx, Iso, ax, ay, bx, by, width, z) {
    var P   = Iso.project;
    var dx  = bx - ax, dy = by - ay;
    var len = Math.hypot(dx, dy) || 1;
    var nx  = -dy / len * width / 2;
    var ny  =  dx / len * width / 2;

    var quad = [
      P(ax + nx, ay + ny, z), P(bx + nx, by + ny, z),
      P(bx - nx, by - ny, z), P(ax - nx, ay - ny, z)
    ];

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    for (var i = 1; i < 4; i++) ctx.lineTo(quad[i].x, quad[i].y);
    ctx.closePath();
    ctx.fillStyle = C.hazardDark;
    ctx.fill();
    ctx.clip();

    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (i = 0; i < 4; i++) {
      if (quad[i].x < minX) minX = quad[i].x;
      if (quad[i].x > maxX) maxX = quad[i].x;
      if (quad[i].y < minY) minY = quad[i].y;
      if (quad[i].y > maxY) maxY = quad[i].y;
    }
    var step = 16;
    ctx.strokeStyle = C.hazardAmber;
    ctx.lineWidth   = step * 0.5;
    ctx.beginPath();
    var span = (maxX - minX) + (maxY - minY);
    for (var s = minX - (maxY - minY); s < minX + span; s += step) {
      ctx.moveTo(s, maxY);
      ctx.lineTo(s + (maxY - minY), minY);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ---- floor ---------------------------------------------------------------- */

  /* drawFloor(ctx, Iso, cam, GW, GH, vw, vh)
   *
   * Six-layer stack, back to front:
   *   1. Solid fill covering the entire CSS viewport (in camera space)
   *   2. Outer ground mosaic — 2.5-unit tiles, ~50 % filled, four earth tones
   *   3. Hazard border — amber/black stripes on all four slab edges
   *   4. Concrete slab base  (z = 0.008)
   *   5. Bay-pour variation  (z = 0.009, ~50 % filled 2×2 tiles)
   *   6. Grid lines          (z = 0.010, every 2 units)
   */
  function drawFloor(ctx, Iso, cam, GW, GH, vw, vh) {
    var P    = Iso.project;
    var DIRT = [C.dirt, C.dirt2, C.dirt3, C.dirt4];

    var x, y, n;

    /* 1. Full-canvas fill in camera space */
    var l  = -cam.ox / cam.scale;
    var t  = -cam.oy / cam.scale;
    var cw = vw / cam.scale;
    var ch = vh / cam.scale;
    ctx.fillStyle = DIRT[0];
    ctx.fillRect(l, t, cw, ch);

    /* 2. Outer ground mosaic */
    var INSET = 14, STEP = 2.5;
    for (x = -INSET; x < GW + INSET; x += STEP) {
      for (y = -INSET; y < GH + INSET; y += STEP) {
        n = Iso.hash2(Math.round(x * 10), Math.round(y * 10), 17);
        if (n < 0.50) continue;
        ctx.fillStyle = DIRT[1 + Math.floor(n * 2.99) % 3];
        Iso.poly(ctx, [
          P(x,        y,        0),
          P(x + STEP, y,        0),
          P(x + STEP, y + STEP, 0),
          P(x,        y + STEP, 0)
        ]);
      }
    }

    /* 3. Hazard border — all four slab edges */
    var HW = 1.1, HZ = 0.012, SB = 0.55;
    hazardBand(ctx, Iso, 0,        -SB,       GW,       -SB,       HW, HZ); /* top    */
    hazardBand(ctx, Iso, GW,       -SB,       GW,       GH + SB,   HW, HZ); /* right  */
    hazardBand(ctx, Iso, GW,       GH + SB,   0,        GH + SB,   HW, HZ); /* bottom */
    hazardBand(ctx, Iso, 0,        GH + SB,   0,        -SB,       HW, HZ); /* left   */

    /* 4. Concrete slab base */
    ctx.fillStyle = C.concrete;
    Iso.poly(ctx, [
      P(0,  0,  0.008), P(GW, 0,  0.008),
      P(GW, GH, 0.008), P(0,  GH, 0.008)
    ]);

    /* 5. Bay-pour variation */
    for (x = 0; x < GW; x += 2) {
      for (y = 0; y < GH; y += 2) {
        if (Iso.hash2(x, y, 41) < 0.50) continue;
        ctx.fillStyle = C.concrete2;
        Iso.poly(ctx, [
          P(x,     y,     0.009), P(x + 2, y,     0.009),
          P(x + 2, y + 2, 0.009), P(x,     y + 2, 0.009)
        ]);
      }
    }

    /* 6. Grid lines */
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (x = 0; x <= GW; x += 2) {
      var a = P(x, 0,  0.010), b = P(x, GH, 0.010);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    for (y = 0; y <= GH; y += 2) {
      var c = P(0,  y, 0.010), d = P(GW, y, 0.010);
      ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    }
    ctx.stroke();
  }

  /* ---- belt ----------------------------------------------------------------- */

  /* Fill the square patch at each route waypoint so corners look solid,
     not like two ribbons that barely meet.  Ported from rocket-engine. */
  function joints(ctx, Iso, route, width, from, to, lift) {
    var P = Iso.project;
    var r = width / 2;
    for (var i = 0; i < route.pts.length; i++) {
      var d = route.cum[i];
      if (d < from || d > to) continue;
      var p = route.pts[i];
      Iso.poly(ctx, [
        P(p.x - r, p.y - r, lift), P(p.x + r, p.y - r, lift),
        P(p.x + r, p.y + r, lift), P(p.x - r, p.y + r, lift)
      ]);
    }
  }

  /* drawBelt(ctx, Iso, route, clock, from, to, opts)
   *
   * Ported from rocket-engine render.js drawBelt().  Key change: rocket reads
   * `t` from its enclosing render scope; here we accept `clock` as a parameter.
   *
   * Layers, back to front:
   *   frame ribbon + corner joints  (z 0.02)
   *   deck ribbon  + corner joints  (z 0.03)
   *   animated treads               (z 0.04)
   *   animated direction arrows     (z 0.045)
   *   amber side rails              (z 0.05)
   */
  function drawBelt(ctx, Iso, route, clock, from, to, opts) {
    var P    = Iso.project;
    var o    = opts || {};
    var i, s, d, p, nx, ny, hw;
    var width = o.width || 2.6;
    var segs  = route.segs;

    function within(sg) {
      return sg.cum + sg.len > from && sg.cum < to;
    }

    /* frame */
    ctx.fillStyle = o.frame || C.beltFrame;
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (!within(s)) continue;
      Iso.ribbon(ctx, s.a.x, s.a.y, s.b.x, s.b.y, width, 0.02);
    }
    joints(ctx, Iso, route, width, from, to, 0.02);

    /* deck */
    ctx.fillStyle = o.deck || C.beltDeck;
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (!within(s)) continue;
      Iso.ribbon(ctx, s.a.x, s.a.y, s.b.x, s.b.y, width - 0.5, 0.03);
    }
    joints(ctx, Iso, route, width - 0.5, from, to, 0.03);

    /* animated treads */
    var speed  = o.speed || 1.6;
    var step   = 0.4;
    var innerW = width - 0.62;
    ctx.fillStyle = 'rgba(120,126,132,0.42)';
    for (d = from - ((clock * speed) % step); d < to; d += step) {
      if (d < from) continue;
      p = route.at(d);
      nx = -p.dy; ny = p.dx;
      hw = innerW / 2;
      Iso.poly(ctx, [
        P(p.x + nx * hw + p.dx * 0.05, p.y + ny * hw + p.dy * 0.05, 0.04),
        P(p.x - nx * hw + p.dx * 0.05, p.y - ny * hw + p.dy * 0.05, 0.04),
        P(p.x - nx * hw - p.dx * 0.05, p.y - ny * hw - p.dy * 0.05, 0.04),
        P(p.x + nx * hw - p.dx * 0.05, p.y + ny * hw - p.dy * 0.05, 0.04)
      ]);
    }

    /* animated direction arrows */
    var cstep = 3.4;
    ctx.fillStyle = 'rgba(224,160,44,0.72)';
    for (d = from - ((clock * speed) % cstep); d < to; d += cstep) {
      if (d < from + 0.6) continue;
      p = route.at(d);
      nx = -p.dy; ny = p.dx;
      hw = innerW * 0.22;
      Iso.poly(ctx, [
        P(p.x + p.dx * 0.30,              p.y + p.dy * 0.30,              0.045),
        P(p.x - p.dx * 0.06 + nx * hw,    p.y - p.dy * 0.06 + ny * hw,   0.045),
        P(p.x - p.dx * 0.16,              p.y - p.dy * 0.16,              0.045),
        P(p.x - p.dx * 0.06 - nx * hw,    p.y - p.dy * 0.06 - ny * hw,   0.045)
      ]);
    }

    /* amber side rails */
    ctx.fillStyle = C.beltRail;
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (!within(s)) continue;
      var dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
      var L  = Math.hypot(dx, dy) || 1;
      var rx = -dy / L * (width / 2 - 0.12);
      var ry =  dx / L * (width / 2 - 0.12);
      Iso.ribbon(ctx, s.a.x + rx, s.a.y + ry, s.b.x + rx, s.b.y + ry, 0.22, 0.05);
      Iso.ribbon(ctx, s.a.x - rx, s.a.y - ry, s.b.x - rx, s.b.y - ry, 0.22, 0.05);
    }
  }

  /* ---- Cognition island floor ----------------------------------------------- */

  /* drawCognitionFloor(ctx, Iso, cam, floor, vw, vh)
   *
   * Smaller external compound north of the main factory.
   * floor = { x, y, w, d }  — NW corner in world space.
   *
   * Same four-layer stack as the main slab (no dirt mosaic — the main
   * drawFloor already fills the whole viewport).  Cooler concrete tint
   * signals "external / off-site" without breaking visual continuity.
   */
  function drawCognitionFloor(ctx, Iso, cam, floor, vw, vh) {
    var P  = Iso.project;
    var ox = floor.x, oy = floor.y, mw = floor.w, md = floor.d;

    /* Cooler slate concrete — distinguishable from main floor at a glance */
    var COG_BASE  = '#4a5060';
    var COG_POUR  = '#232840';

    /* 1. Hazard border — all four edges, same metrics as main floor */
    var HW = 1.1, HZ = 0.012, SB = 0.55;
    hazardBand(ctx, Iso, ox,      oy - SB,      ox + mw,  oy - SB,      HW, HZ);
    hazardBand(ctx, Iso, ox + mw, oy - SB,      ox + mw,  oy + md + SB, HW, HZ);
    hazardBand(ctx, Iso, ox + mw, oy + md + SB, ox,       oy + md + SB, HW, HZ);
    hazardBand(ctx, Iso, ox,      oy + md + SB, ox,       oy - SB,      HW, HZ);

    /* 2. Concrete slab base */
    ctx.fillStyle = COG_BASE;
    Iso.poly(ctx, [
      P(ox,      oy,      0.008), P(ox + mw, oy,      0.008),
      P(ox + mw, oy + md, 0.008), P(ox,      oy + md, 0.008)
    ]);

    /* 3. Bay-pour variation — offset hash seed so it differs from main floor */
    var bx, by;
    for (bx = ox; bx < ox + mw; bx += 2) {
      for (by = oy; by < oy + md; by += 2) {
        if (Iso.hash2(bx + 200, by + 200, 41) < 0.50) continue;
        ctx.fillStyle = COG_POUR;
        Iso.poly(ctx, [
          P(bx,     by,     0.009), P(bx + 2, by,     0.009),
          P(bx + 2, by + 2, 0.009), P(bx,     by + 2, 0.009)
        ]);
      }
    }

    /* 4. Grid lines */
    var ga, gb, gc, gd;
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (bx = ox; bx <= ox + mw; bx += 2) {
      ga = P(bx, oy,      0.010); gb = P(bx, oy + md, 0.010);
      ctx.moveTo(ga.x, ga.y); ctx.lineTo(gb.x, gb.y);
    }
    for (by = oy; by <= oy + md; by += 2) {
      gc = P(ox,      by, 0.010); gd = P(ox + mw, by, 0.010);
      ctx.moveTo(gc.x, gc.y); ctx.lineTo(gd.x, gd.y);
    }
    ctx.stroke();
  }

  global.Factory = {
    C:                 C,
    drawFloor:         drawFloor,
    drawCognitionFloor: drawCognitionFloor,
    drawBelt:          drawBelt
  };
})(window);
