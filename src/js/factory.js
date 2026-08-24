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

    concrete:      '#5f5d57',   /* factory slab base            — rocket C.concrete */
    concrete2:     '#6a6862',   /* bay-pour tile variant        — rocket C.concrete2 */
    slabEdge:      '#4a4842',   /* under-plate showing past the slab lip */

    hazardDark:    '#1c1a14',   /* dark stripe in hazard band */
    hazardAmber:   '#c9a233',   /* amber stripe in hazard band */

    /* Belt colours are rocket's exactly. The previous cool-navy set had two
       problems: the frame was DARKER than the deck (rocket's is lighter, which
       is what makes the deck read as sunk into a shoulder), and the deck sat
       1.13:1 from the old dark floor tile, so the belt vanished wherever it
       crossed one. */
    beltFrame:     '#55524a',   /* outer belt shoulder          — rocket drawBelt default */
    beltDeck:      '#2f2e2b',   /* belt running surface         — rocket C.beltDeck */
    beltRail:      '#b08a2c',   /* side rails                   — rocket C.beltRail */

    /* The belt's vertical face. Rocket has no equivalent because its belt is
       flat. It must be DARKER than the slab, not the same value as the frame:
       #55524a sits 1.18:1 from the concrete, so a side wall painted in it is
       invisible and the rise is wasted. This is 1.97:1 — light top, dark side,
       which is the whole of how a raised object reads. */
    beltSkirt:     '#33312c'
  };

  /* Height the belt structure stands off the slab. Rocket draws its belt dead
     flat (z 0.02–0.05); this is the one deliberate departure, so the conveyor
     reads as a raised machine you could bark a shin on rather than as paint. */
  var BELT_H = 0.34;

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
        /* rocket hashes the raw grid coords, not a x10-rounded pair, and cuts
           at 0.52 — both matter, they are what fixes the pattern. */
        n = Iso.hash2(x, y, 17);
        if (n < 0.52) continue;
        ctx.fillStyle = DIRT[1 + Math.floor(n * 2.99) % 3];
        Iso.poly(ctx, [
          P(x,        y,        0),
          P(x + STEP, y,        0),
          P(x + STEP, y + STEP, 0),
          P(x,        y + STEP, 0)
        ]);
      }
    }

    /* 4. Concrete slab — an under-plate proud of the slab by 1.1 units, then
       the slab itself on top, so the pour has a visible lip like rocket's. */
    ctx.fillStyle = C.slabEdge;
    Iso.poly(ctx, [
      P(-1.1,      -1.1,      0.004), P(GW + 1.1, -1.1,      0.004),
      P(GW + 1.1,  GH + 1.1,  0.004), P(-1.1,     GH + 1.1,  0.004)
    ]);
    ctx.fillStyle = C.concrete;
    Iso.poly(ctx, [
      P(0,  0,  0.008), P(GW, 0,  0.008),
      P(GW, GH, 0.008), P(0,  GH, 0.008)
    ]);

    /* 5. Bay-pour variation */
    for (x = 0; x < GW; x += 2) {
      for (y = 0; y < GH; y += 2) {
        if (Iso.hash2(x, y, 41) < 0.5) continue;
        ctx.fillStyle = C.concrete2;
        Iso.poly(ctx, [
          P(x,     y,     0.009), P(x + 2, y,     0.009),
          P(x + 2, y + 2, 0.009), P(x,     y + 2, 0.009)
        ]);
      }
    }

    /* 6. Grid lines */
    ctx.strokeStyle = 'rgba(20,18,15,0.22)';   /* rocket's bay joint line */
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

    /* Hazard border LAST, like rocket's drawGround: the slab under-plate reaches
       1.1 units past the slab edge and the banding sits at 0.55, so banding
       drawn earlier is simply painted over by the plate. */
    var HW = 1.1, HZ = 0.012, SB = 0.55;
    hazardBand(ctx, Iso, 0,  -SB,     GW, -SB,     HW, HZ); /* top    */
    hazardBand(ctx, Iso, GW, -SB,     GW, GH + SB, HW, HZ); /* right  */
    hazardBand(ctx, Iso, GW, GH + SB, 0,  GH + SB, HW, HZ); /* bottom */
    hazardBand(ctx, Iso, 0,  GH + SB, 0,  -SB,     HW, HZ); /* left   */

    drawWalkways(ctx, Iso);
  }

  /* Painted pedestrian aisles, same two-ribbon construction as rocket's: an
     amber outer band with a grey tread inside it. The lines themselves are
     EC's — they have to run down this plant's aisles, and none of them may
     cross the belt. */
  var AISLES = [
  [4,  18.5, 60, 18.5],
  [21, 46.5, 50, 46.5]
];

  function drawWalkways(ctx, Iso) {
    for (var i = 0; i < AISLES.length; i++) {
      var a = AISLES[i];
      ctx.fillStyle = 'rgba(200,162,51,0.32)';
      Iso.ribbon(ctx, a[0], a[1], a[2], a[3], 1.5, 0.012);
      ctx.fillStyle = 'rgba(126,124,116,0.75)';
      Iso.ribbon(ctx, a[0], a[1], a[2], a[3], 1.1, 0.014);
    }
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

    /* ---- the raised structure ----
     * Rocket lays its belt flat. Here every segment is a solid standing BELT_H
     * off the slab, so the side walls catch the light and the conveyor reads as
     * a machine rather than as paint. Each straight is one oriented box and each
     * waypoint gets a square box so the corners are solid; all of the bodies go
     * down before any top surface, or a later straight would paint over the
     * deck of an earlier one. */
    var frameClr = o.frame || C.beltFrame;
    var H = (o.height != null) ? o.height : BELT_H;
    var TOP = H;
    var mx, my, sl, hx, hy;

    /* contact shadow on the slab, a touch wider than the belt — cheap, and it
       is what sells the rise once you are zoomed far enough out that the side
       wall is only a pixel or two deep */
    ctx.fillStyle = 'rgba(18,16,13,0.30)';
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (!within(s)) continue;
      Iso.ribbon(ctx, s.a.x, s.a.y, s.b.x, s.b.y, width + 0.42, 0.011);
    }
    joints(ctx, Iso, route, width + 0.42, from, to, 0.011);

    /* body: dark skirt, so the vertical faces read against the concrete */
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (!within(s)) continue;
      sl = s.len || 1;
      hx = (s.b.x - s.a.x) / sl; hy = (s.b.y - s.a.y) / sl;
      mx = (s.a.x + s.b.x) / 2;  my = (s.a.y + s.b.y) / 2;
      Iso.orientedBox(ctx, {
        x: mx, y: my, z: 0, hx: hx, hy: hy,
        len: sl, wid: width, h: H,
        color: C.beltSkirt, edge: 'rgba(16,14,11,0.55)'
      });
    }
    for (i = 0; i < route.pts.length; i++) {
      d = route.cum[i];
      if (d < from || d > to) continue;
      p = route.pts[i];
      Iso.orientedBox(ctx, {
        x: p.x, y: p.y, z: 0, hx: 1, hy: 0,
        len: width, wid: width, h: H,
        color: C.beltSkirt, edge: 'rgba(16,14,11,0.55)'
      });
    }

    /* ---- shoulder: rocket's frame colour, on the top face only ---- */
    ctx.fillStyle = frameClr;
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (!within(s)) continue;
      Iso.ribbon(ctx, s.a.x, s.a.y, s.b.x, s.b.y, width, TOP + 0.002);
    }
    joints(ctx, Iso, route, width, from, to, TOP + 0.002);

    /* ---- deck, inset so the shoulder shows as a frame around it ---- */
    ctx.fillStyle = o.deck || C.beltDeck;
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (!within(s)) continue;
      Iso.ribbon(ctx, s.a.x, s.a.y, s.b.x, s.b.y, width - 0.5, TOP + 0.004);
    }
    joints(ctx, Iso, route, width - 0.5, from, to, TOP + 0.004);

    /* animated treads */
    var speed  = o.speed || 1.6;
    var step   = 0.4;
    var innerW = width - 0.62;
    ctx.fillStyle = 'rgba(120,126,132,0.42)';
    /* Phase ADDED, not subtracted: subtracting walks each slat's distance-along-
       route downwards every frame, so the belt texture crawls back toward the
       archive while the carrier and the arrowheads go the other way. Adding it
       makes the surface travel with the work. The wrap stays seamless because
       the markers are spaced exactly `step` apart. */
    for (d = from + ((clock * speed) % step) - step; d < to; d += step) {
      if (d < from) continue;
      p = route.at(d);
      nx = -p.dy; ny = p.dx;
      hw = innerW / 2;
      Iso.poly(ctx, [
        P(p.x + nx * hw + p.dx * 0.05, p.y + ny * hw + p.dy * 0.05, TOP + 0.008),
        P(p.x - nx * hw + p.dx * 0.05, p.y - ny * hw + p.dy * 0.05, TOP + 0.008),
        P(p.x - nx * hw - p.dx * 0.05, p.y - ny * hw - p.dy * 0.05, TOP + 0.008),
        P(p.x + nx * hw - p.dx * 0.05, p.y + ny * hw - p.dy * 0.05, TOP + 0.008)
      ]);
    }

    /* animated direction arrows */
    var cstep = 3.4;
    ctx.fillStyle = 'rgba(224,160,44,0.72)';
    /* Same correction as the treads above — these slide with the flow, not
       against it. The arrowheads already POINT along +d (tip at p + dx*0.30);
       it was only the motion that ran backwards. */
    for (d = from + ((clock * speed) % cstep) - cstep; d < to; d += cstep) {
      if (d < from + 0.6) continue;
      p = route.at(d);
      nx = -p.dy; ny = p.dx;
      hw = innerW * 0.22;
      Iso.poly(ctx, [
        P(p.x + p.dx * 0.30,           p.y + p.dy * 0.30,           TOP + 0.012),
        P(p.x - p.dx * 0.06 + nx * hw, p.y - p.dy * 0.06 + ny * hw, TOP + 0.012),
        P(p.x - p.dx * 0.16,           p.y - p.dy * 0.16,           TOP + 0.012),
        P(p.x - p.dx * 0.06 - nx * hw, p.y - p.dy * 0.06 - ny * hw, TOP + 0.012)
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
      Iso.ribbon(ctx, s.a.x + rx, s.a.y + ry, s.b.x + rx, s.b.y + ry, 0.22, TOP + 0.016);
      Iso.ribbon(ctx, s.a.x - rx, s.a.y - ry, s.b.x - rx, s.b.y - ry, 0.22, TOP + 0.016);
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
    drawBelt:          drawBelt,
    BELT_H:            BELT_H
  };
})(window);
