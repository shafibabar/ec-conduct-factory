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
  var Kit     = global.Kit;

  var P = Iso.project;   /* iso-grid coords -> screen-space {x,y} */

  /* ---- the machine kit ---------------------------------------------------
   * kit.js holds the drawing vocabulary — materials, cam timing, primitives,
   * instruments, sub-assemblies. Aliased in by name here so a station drawer
   * reads as a bill of materials. Kit.bind(ctx, clock) in draw() rebinds the
   * canvas and clock every frame; nothing below needs to pass them.
   * -------------------------------------------------------------------- */
  var ACCENT = Kit.ACCENT, LIVERY = Kit.LIVERY, livery = Kit.livery;
  var casing = Kit.casing, binRow = Kit.binRow, reel = Kit.reel;
  var receiptDuct = Kit.receiptDuct, gaugeCol = Kit.gaugeCol;
  var trench = Kit.trench, tubeRun = Kit.tubeRun, tubePost = Kit.tubePost;
  var pulse = Kit.pulse, hazardFloor = Kit.hazardFloor, atWorld = Kit.atWorld;
  var M = Kit.M, PAPER = Kit.PAPER, RIB = Kit.RIB, GLAZE = Kit.GLAZE;
  var busy = Kit.busy, cyc = Kit.cyc, seg = Kit.seg, segLin = Kit.segLin;
  var frustum = Kit.frustum, pipe = Kit.pipe, plate = Kit.plate, quad = Kit.quad;
  var bolts = Kit.bolts, ribs = Kit.ribs, door = Kit.door, louvres = Kit.louvres;
  var hazardStrip = Kit.hazardStrip, lattice = Kit.lattice;
  var lamp = Kit.lamp, readout = Kit.readout, stencil = Kit.stencil, matrix = Kit.matrix;
  var faceText = Kit.faceText;
  var puffs = Kit.puffs, sparks = Kit.sparks, chips = Kit.chips;
  var replicaStack = Kit.replicaStack;
  var inserter = Kit.inserter, transferBay = Kit.transferBay;
  var floorText = Kit.floorText;

  var cam = null, ctx = null, clk = 0;
  var labels = [];
  var showLabels = true;

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

  /* ==== ec-gateway — the intake press ======================================
   *
   * What the service does (Section "ec-gateway", Flow A step A1): the archive
   * announces a communication on supBulkIndexingTopic_k8s; the gateway pulls
   * the whole indexable.json out of the archive bucket in parallel byte-range
   * chunks, strips the body and attachments, puts the small object back into
   * the Conduct bucket under tn=/wt=/{reconToken} with a TTL tag, and inserts
   * one outbox row keyed by an idempotency token, which Debezium then publishes
   * onto ingestedCommunication. It also serves the ingest watermark that
   * ec-centralised-audit reconciles against.
   *
   * So the machine is a press, read west to east:
   *
   *   archive mast  ─ the one structure on this floor, because the archive is
   *                   off-platform. It announces; it is not part of the plant.
   *   ranged-GET    ─ four intake lines off a manifold, and a 25-cell matrix
   *   manifold        that is literally max-allowed-concurrency: 25. Cells
   *                   light as chunks go on the wire; a document over 5 MB
   *                   fills the matrix and comes back for a second wave.
   *   the press     ─ chunks laminate into one billet on the anvil, the ram
   *                   comes down, and what is left is a wafer 12% as thick.
   *                   The offcut — body and attachments — goes down the scrap
   *                   chute into a bin on the reader's side of the machine,
   *                   because throwing away 88% of the mass IS the station.
   *   stamp + hatch ─ the wafer is tagged (the S3 TTL tag) and dropped through
   *                   a floor hatch: the put into the Conduct bucket.
   *   ledger        ─ one printed row per communication, and a pickup head
   *                   reading the newest row off the strip: Debezium CDC. The
   *                   pip it throws is what leaves on the belt.
   *   watermark     ─ a standpipe holding the ingest count, tapped by REST.
   *                   ec-centralised-audit reads this to prove the numbers.
   *
   * Nothing here runs on a free timer: cyc() gives the press one 2.5 s work
   * cycle while the carrier is at this station, and every stroke is a window
   * cut out of it. Every figure on the readout is model.js output, so dragging
   * the Doc slider re-plans the download and the matrix changes shape.
   * ===================================================================== */

  /* o and active are the dispatch signature every station drawer takes; this
     one places from explicit floor coordinates and gates on busy() instead, so
     it uses neither. */
  function drawGateway(o, active) {
    var s  = Sim.state;
    var mv = busy('gateway');
    var p  = cyc('gateway', 0.40);              /* one 2.5 s work cycle */

    /* ---- cam: the strokes of one cycle ---- */
    var FILL   = segLin(p, 0.02, 0.44);   /* chunks land, billet laminates    */
    var STROKE = seg(p,    0.46, 0.60);   /* ram down                         */
    var RETURN = seg(p,    0.66, 0.96);   /* ram back up                      */
    var EJECT  = segLin(p, 0.62, 0.76);   /* wafer out to the stamp           */
    var STAMPD = seg(p,    0.76, 0.82);   /* tag on                           */
    var STAMPU = seg(p,    0.84, 0.90);
    var SHIFT  = segLin(p, 0.90, 0.96);   /* wafer over the hatch             */
    var DROP   = segLin(p, 0.96, 1.00);   /* through it, into the bucket      */
    var PRINT  = segLin(p, 0.82, 0.98);   /* ledger row, then the CDC pickup  */

    /* ---- what the model says about this document ---- */
    var kbIn   = s.avgDocSizeKb || 1;
    var kbOut  = kbIn * EC.MINIFY_RATIO;
    var s3     = EC.s3Plan(kbIn);
    var LOGMAX = Math.log(1 + 131072);
    var hIn    = 0.24 + 0.70 * (Math.log(1 + kbIn) / LOGMAX);
    var hOut   = Math.max(0.055, hIn * EC.MINIFY_RATIO);

    /* which chunks are on the wire right now */
    var waveIdx  = Math.min(s3.waves - 1, Math.floor(FILL * s3.waves));
    var inWave   = Math.min(1, s3.waves * FILL - waveIdx);
    var thisWave = (waveIdx < s3.waves - 1) ? s3.conc
                                            : s3.chunks - s3.conc * (s3.waves - 1);
    var inFlight = mv ? Math.min(s3.conc, Math.ceil(thisWave * inWave)) : 0;

    var lv   = livery('gateway');
    var AC   = ACCENT.gateway;
    var cs   = casing('gateway');
    var BODY = cs.body, KERB = cs.kerb, TRAY = cs.tray;

    /* ---- the press, in numbers ---- */
    var px0 = 11.50, px1 = 15.90, py0 = 0.70, py1 = 3.30;
    var sf   = py1 + 0.01;                /* the face the reader is looking at */
    var deck = 1.66, anvil = deck + 0.13, crown = 3.36;
    var ax = 13.85, ay = 1.95;            /* anvil centre and the ram axis     */

    var i, u, lz, lh;

    /* ================================================== 1. archive mast ==== */
    var mx = 8.60, my = 1.60;
    Iso.box(ctx, { x: mx - 0.66, y: my - 0.66, z: 0, w: 1.32, d: 1.32, h: 0.28,
                   color: '#2b3138' });
    lattice(mx, my, 0.28, 3.90, 0.44, 4, '#616b77');
    Iso.box(ctx, { x: mx - 0.36, y: my - 0.36, z: 4.18, w: 0.72, d: 0.72, h: 0.32,
                   color: '#5b646f' });
    /* dish: two crossing arms, a face, and a feed horn on a stalk */
    ctx.fillStyle = '#828d99';
    Iso.poly(ctx, [P(mx - 0.86, my - 0.07, 4.58), P(mx + 0.86, my - 0.07, 4.58),
                   P(mx + 0.86, my + 0.07, 4.58), P(mx - 0.86, my + 0.07, 4.58)]);
    Iso.poly(ctx, [P(mx - 0.07, my - 0.86, 4.58), P(mx + 0.07, my - 0.86, 4.58),
                   P(mx + 0.07, my + 0.86, 4.58), P(mx - 0.07, my + 0.86, 4.58)]);
    ctx.fillStyle = Iso.rgba(AC, mv ? 0.50 : 0.26);
    Iso.disc(ctx, mx, my, 4.60, 0.46);
    Iso.cylinder(ctx, { x: mx, y: my, z: 4.62, r: 0.06, h: 0.34, color: '#8d97a2' });
    Iso.box(ctx, { x: mx - 0.11, y: my - 0.11, z: 4.96, w: 0.22, d: 0.22, h: 0.14,
                   color: M.brass });
    /* obstruction light: the archive is off-platform and always up */
    ctx.fillStyle = mv ? 'rgba(255,92,72,' + (0.55 + 0.45 * Math.abs(Math.sin(clk * 2.4))).toFixed(2) + ')'
                       : 'rgba(152,54,44,0.62)';
    Iso.disc(ctx, mx, my, 4.52, 0.11);
    stencil(mx - 0.68, my + 0.67, 1.24, 'ARCHIVE',
            { size: 4.6, color: 'rgba(198,214,236,0.50)' });

    /* ============================================ 2. ranged-GET manifold ==== */
    pipe(mx + 0.58, my, 10.40, my, 1.14, 0.20, M.steelD);
    pipe(10.40, 0.95, 10.40, 3.05, 1.14, 0.28, M.iron, 0.32);
    Iso.cylinder(ctx, { x: 10.40, y: 0.95, z: 1.46, r: 0.14, h: 0.26, color: M.steelD });

    var LANE_Y = [1.15, 1.75, 2.35, 2.95];
    var lanesLit = mv ? Math.min(4, Math.max(1, inFlight)) : 0;
    for (i = 0; i < 4; i++) {
      var lit = i < lanesLit;
      pipe(10.40, LANE_Y[i], px0 + 0.05, LANE_Y[i], 1.14, 0.14,
           lit ? Iso.mix(M.steelD, AC, 0.40) : M.steelD);
      Iso.box(ctx, { x: px0 - 0.07, y: LANE_Y[i] - 0.13, z: 1.06, w: 0.11, d: 0.26,
                     h: 0.26, color: M.iron });
      if (lit) {
        u = ((clk * 1.7) + i * 0.21) % 1;
        ctx.fillStyle = Iso.rgba('#c6e8ff', 0.9 * (1 - u * 0.45));
        Iso.disc(ctx, 10.45 + u * (px0 - 10.55), LANE_Y[i], 1.31, 0.09);
      }
    }

    /* ========================================================= 3. press ==== */
    Iso.box(ctx, { x: px0 - 0.15, y: py0 - 0.15, z: 0, w: (px1 - px0) + 0.30,
                   d: (py1 - py0) + 0.30, h: 0.26, color: lv.plinth });
    Iso.box(ctx, { x: px0, y: py0, z: 0.26, w: px1 - px0, d: py1 - py0,
                   h: deck - 0.26, color: BODY });

    /* casing detail on the face the reader sees: ribbed sheet between the
       fittings, a bolted seam top and bottom, an access door, cooling louvres */
    /* The face is planned around the scrap chute. South is LEFT in this
       projection, so a chute hanging off the deck covers the casing to its
       west: the band it eats is roughly face x 13.05 to 14.45, and the two
       instruments go either side of it. */
    ribs(px0 + 0.10, px1 - 0.10, sf, 0.34, 1.18, 11);
    louvres(px0 + 0.08, sf, 0.42, 0.38, 0.86, 5);
    bolts(px0 + 0.12, px1 - 0.12, sf, 1.52, 13);
    bolts(px0 + 0.12, px1 - 0.12, sf, 0.32, 13);
    plate(px0, sf, 1.54, px1 - px0, 0.05, 'rgba(0,0,0,0.42)');

    /* max-allowed-concurrency: 25, as 25 lamps */
    matrix(px0 + 0.52, sf, 0.46, 5, 5, 0.165, inFlight, s3.conc, AC, 'rgba(90,176,224,0.44)');
    stencil(px0 + 0.52, sf, 1.50, 'RANGED GET',
            { size: 4.0, color: 'rgba(222,238,255,0.50)' });

    /* the HMI. Both figures are model.js output, so the Doc slider moves them
       whether or not the carrier is standing here. */
    readout(px0 + 2.86, sf, 0.42, 1.50, 0.62, [
      EC.fmtKb(kbIn) + ' > ' + EC.fmtKb(kbOut),
      s3.chunks + 'x' + EC.fmtKb(s3.chunkKb) + ' w' + s3.waves
    ], { size: 5.0 });

    /* deck: a recessed tray, darker than the casing, so the bright steel
       mechanism standing in it is what the eye goes to */
    Iso.box(ctx, { x: px0 - 0.07, y: py0 - 0.07, z: deck - 0.14,
                   w: (px1 - px0) + 0.14, d: (py1 - py0) + 0.14, h: 0.14, color: KERB });
    Iso.box(ctx, { x: px0 + 0.12, y: py0 + 0.12, z: deck - 0.03,
                   w: (px1 - px0) - 0.24, d: (py1 - py0) - 0.24, h: 0.03, color: TRAY });
    hazardStrip(px0 + 0.16, px1 - 0.16, py1 + 0.08, deck - 0.13, 0.11, 0.24);

    /* --- 3a. manifold receiver and the chunk magazine --- */
    Iso.box(ctx, { x: px0 + 0.06, y: 1.02, z: deck, w: 0.62, d: 2.06, h: 0.38,
                   color: M.iron });
    Iso.box(ctx, { x: px0 + 0.02, y: 0.98, z: deck + 0.38, w: 0.70, d: 2.14, h: 0.07,
                   color: '#5f6871' });
    louvres(px0 + 0.12, 3.09, deck + 0.05, 0.50, 0.30, 3);
    for (i = 0; i < 4; i++) {
      Iso.cylinder(ctx, { x: px0 + 0.37, y: LANE_Y[i], z: deck + 0.44, r: 0.09, h: 0.16,
                          color: i < lanesLit ? Iso.mix(M.steel, AC, 0.5) : M.steelD });
    }
    var magN = Math.max(1, Math.min(6, s3.chunks));
    for (i = 0; i < magN; i++) {
      var used = mv && (i / magN) < FILL;
      Iso.box(ctx, { x: px0 + 0.80, y: 1.14 + i * 0.145, z: deck, w: 0.74, d: 0.115,
                     h: 0.10, color: used ? '#3a4149' : PAPER.mid });
    }
    Iso.box(ctx, { x: px0 + 0.74, y: 1.06, z: deck, w: 0.08, d: 0.96, h: 0.30, color: M.iron });
    Iso.box(ctx, { x: px0 + 1.54, y: 1.06, z: deck, w: 0.08, d: 0.96, h: 0.30, color: M.iron });

    /* --- 3b. the press frame: two housings, a crown, a screw --- */
    for (i = 0; i < 4; i++) {
      Iso.box(ctx, { x: (i % 2 ? 14.48 : 13.22), y: (i < 2 ? 1.24 : 2.46), z: deck,
                     w: 0.19, d: 0.19, h: crown - deck, color: '#6c757e' });
    }
    Iso.box(ctx, { x: 13.10, y: 1.12, z: crown, w: 1.60, d: 1.55, h: 0.22, color: '#586069' });
    Iso.cylinder(ctx, { x: ax, y: ay - 0.06, z: crown + 0.22, r: 0.12, h: 0.40, color: M.steel });
    Iso.gear(ctx, ax, ay - 0.06, crown + 0.64, 0.30, 10,
             mv ? clk * 2.2 : 0.4, mv ? M.brass : Iso.shade(M.brass, 0.60));

    Iso.box(ctx, { x: ax - 0.48, y: ay - 0.50, z: deck, w: 0.96, d: 1.00, h: 0.13,
                   color: '#697079' });

    /* --- 3c. the billet, or the wafer it becomes --- */
    var billetH = FILL < 1 ? hIn * FILL : hIn - (hIn - hOut) * STROKE;
    if (mv && p < 0.62 && billetH > 0.02) {
      /* laminated: one slab per chunk, because that is how it arrived */
      var lam = Math.max(1, Math.min(6, s3.chunks));
      for (i = 0; i < lam; i++) {
        lz = billetH * (i / lam);
        lh = billetH / lam;
        if (lz + lh > billetH) lh = billetH - lz;
        if (lh <= 0.004) break;
        Iso.box(ctx, { x: ax - 0.39, y: ay - 0.42, z: anvil + lz, w: 0.78, d: 0.84,
                       h: lh, color: i % 2 ? PAPER.full : PAPER.mid });
      }
    } else if (mv) {
      var wx = ax + EJECT * 0.92 + SHIFT * 0.62;
      var wz = anvil - DROP * 0.92;
      ctx.save();
      if (DROP > 0) ctx.globalAlpha = 1 - DROP * 0.8;
      Iso.box(ctx, { x: wx - 0.39, y: ay - 0.42, z: wz, w: 0.78, d: 0.84, h: hOut,
                     color: (STAMPU > 0.5) ? Iso.mix(PAPER.full, AC, 0.40) : PAPER.full });
      ctx.restore();
    }

    /* the ram */
    /* the ram parks clear of the billet, whatever size the document is */
    var ramT    = STROKE - RETURN;
    var ramRest = Math.min(2.98, anvil + hIn + 0.13);
    var ramZ    = ramRest - ramT * (ramRest - (anvil + hOut));
    Iso.box(ctx, { x: ax - 0.46, y: ay - 0.48, z: ramZ, w: 0.92, d: 0.96, h: 0.32,
                   color: '#aab4be' });
    Iso.box(ctx, { x: ax - 0.44, y: ay - 0.46, z: ramZ - 0.06, w: 0.88, d: 0.92, h: 0.06,
                   color: '#7d8790' });
    Iso.box(ctx, { x: ax - 0.15, y: ay - 0.18, z: ramZ + 0.32, w: 0.30, d: 0.36,
                   h: Math.max(0.02, crown - ramZ - 0.30), color: M.steelD });
    if (mv && ramT > 0.85) {
      sparks(ax, ay - 0.28, anvil + hOut, 5, 17, '#cfe6ff');
      puffs(ax, ay, anvil + 0.45, 3, 23,
            { color: '#9fb2c6', alpha: 0.20, rise: 0.8, r1: 0.28, rate: 1.2 });
    }

    /* --- 3d. tag stamp and the hatch into the Conduct bucket --- */
    var sx = 14.77;
    var stampZ = 2.34 - (STAMPD - STAMPU) * (2.34 - (anvil + hOut + 0.09));
    Iso.box(ctx, { x: sx - 0.17, y: ay - 0.32, z: 2.66, w: 0.34, d: 0.64, h: 0.24,
                   color: M.iron });
    Iso.box(ctx, { x: sx - 0.10, y: ay - 0.24, z: stampZ, w: 0.20, d: 0.48,
                   h: Math.max(0.02, 2.66 - stampZ), color: M.steelD });
    Iso.box(ctx, { x: sx - 0.19, y: ay - 0.32, z: stampZ - 0.13, w: 0.38, d: 0.64, h: 0.15,
                   color: (STAMPD > 0.5 && STAMPU < 0.5) ? M.brass : Iso.shade(M.brass, 0.66) });

    var hx = 15.42;
    Iso.box(ctx, { x: hx - 0.40, y: ay - 0.44, z: deck, w: 0.80, d: 0.88, h: 0.05,
                   color: M.ironD });
    quad([[hx - 0.33, ay - 0.37, deck + 0.05], [hx + 0.33, ay - 0.37, deck + 0.05],
          [hx + 0.33, ay + 0.37, deck + 0.05], [hx - 0.33, ay + 0.37, deck + 0.05]], '#0c1013');
    if (SHIFT > 0.15) {   /* the lid stands up while the wafer goes through */
      quad([[hx - 0.33, ay - 0.37, deck + 0.05], [hx + 0.33, ay - 0.37, deck + 0.05],
            [hx + 0.33, ay - 0.37, deck + 0.45], [hx - 0.33, ay - 0.37, deck + 0.45]],
           M.steelD);
    } else {
      quad([[hx - 0.33, ay - 0.37, deck + 0.06], [hx + 0.33, ay - 0.37, deck + 0.06],
            [hx + 0.33, ay + 0.37, deck + 0.06], [hx - 0.33, ay + 0.37, deck + 0.06]],
           M.steelD);
    }

    /* --- 3e. KEDA replicas, racked along the deck's north kerb. This service
           scales to 18 under load, so the rack runs nine long and two deep on
           the one strip of deck the mechanism does not use. --- */
    replicaStack(px1 - 0.30, py0 + 0.12, deck,
                 phaseFor(s.plan || Sim.planNow(), 'gateway'),
                 { cols: 9, pitch: 0.26, max: 18 });
    lamp(px1 - 0.30, py0 + 0.30, deck + 0.10, 0.12, mv, '#5ad24e');

    /* ==================================================== 4. scrap chute ==== */
    /* 88% of the mass leaves here, on the reader's side of the machine. */
    var cx0 = 13.50, cx1 = 14.40, cyLip = 3.86;
    quad([[cx0, py1, 1.10], [cx1, py1, 1.10], [cx1, cyLip, 0.62], [cx0, cyLip, 0.62]], '#3d434b');
    quad([[cx0, py1, 1.10], [cx0, cyLip, 0.62], [cx0, cyLip, 0.44], [cx0, py1, 0.92]], '#2b3036');
    quad([[cx1, py1, 1.10], [cx1, cyLip, 0.62], [cx1, cyLip, 0.44], [cx1, py1, 0.92]], '#23272c');
    Iso.box(ctx, { x: cx0 - 0.14, y: cyLip - 0.02, z: 0, w: (cx1 - cx0) + 0.28, d: 0.80,
                   h: 0.56, color: '#3b414a' });
    /* the bin is full of shredded document, not of shadow */
    quad([[cx0 - 0.06, cyLip + 0.06, 0.56], [cx1 + 0.06, cyLip + 0.06, 0.56],
          [cx1 + 0.06, cyLip + 0.70, 0.56], [cx0 - 0.06, cyLip + 0.70, 0.56]], '#15181c');
    quad([[cx0 + 0.02, cyLip + 0.13, 0.50], [cx1 - 0.02, cyLip + 0.13, 0.50],
          [cx1 - 0.02, cyLip + 0.63, 0.50], [cx0 + 0.02, cyLip + 0.63, 0.50]],
         Iso.shade(PAPER.scrap, 0.72));
    stencil(cx0 - 0.14, cyLip + 0.79, 0.34, 'body + attachments',
            { size: 4.0, color: 'rgba(228,224,214,0.44)' });
    if (mv && p > 0.48 && p < 0.76) chips(13.95, 3.42, 1.24, 9, 31, PAPER.scrap);

    /* ======================================================= 5. ledger ==== */
    /* one row per communication, keyed by the idempotency token; the pickup
       head over the strip is Debezium. */
    var lx0 = 16.30, lx1 = 17.86, ly0 = 1.10, ly1 = 2.74, ltop = 1.02;
    Iso.box(ctx, { x: lx0 - 0.11, y: ly0 - 0.11, z: 0, w: (lx1 - lx0) + 0.22,
                   d: (ly1 - ly0) + 0.22, h: 0.20, color: lv.plinth });
    Iso.box(ctx, { x: lx0, y: ly0, z: 0.20, w: lx1 - lx0, d: ly1 - ly0, h: ltop - 0.20,
                   color: lv.body });
    louvres(lx0 + 0.12, ly1 + 0.01, 0.30, 0.36, 0.34, 3);
    door(lx0 + 0.56, ly1 + 0.01, 0.28, 0.40, 0.46);
    bolts(lx0 + 0.10, lx1 - 0.10, ly1 + 0.01, 0.26, 8);
    stencil(lx0 + 0.66, ly1 + 0.01, 0.84, 'OUTBOX', { size: 4.4 });
    Iso.box(ctx, { x: lx0 + 0.05, y: ly0 + 0.05, z: ltop, w: (lx1 - lx0) - 0.10,
                   d: (ly1 - ly0) - 0.10, h: 0.05, color: lv.cap });

    /* the strip, running east off the roof */
    quad([[lx0 + 0.18, 1.62, ltop + 0.06], [18.70, 1.62, ltop + 0.06],
          [18.70, 2.16, ltop + 0.06], [lx0 + 0.18, 2.16, ltop + 0.06]], '#cdc7b6');
    for (i = 0; i < 9; i++) {
      var rowU = lx0 + 0.30 + i * 0.23 + PRINT * 0.23;
      if (rowU > 18.60) continue;
      quad([[rowU, 1.69, ltop + 0.065], [rowU + 0.09, 1.69, ltop + 0.065],
            [rowU + 0.09, 2.09, ltop + 0.065], [rowU, 2.09, ltop + 0.065]],
           (i === 0 && PRINT > 0.05) ? '#2f6ea8' : 'rgba(58,56,50,0.78)');
    }
    /* pickup head straddling the strip */
    Iso.box(ctx, { x: 17.62, y: 1.54, z: ltop, w: 0.13, d: 0.13, h: 0.46, color: M.iron });
    Iso.box(ctx, { x: 17.62, y: 2.20, z: ltop, w: 0.13, d: 0.13, h: 0.46, color: M.iron });
    Iso.box(ctx, { x: 17.54, y: 1.50, z: ltop + 0.46, w: 0.30, d: 0.84, h: 0.14,
                   color: M.steelD });
    ctx.fillStyle = mv ? 'rgba(120,235,160,' + (0.32 + 0.48 * PRINT).toFixed(2) + ')'
                       : 'rgba(58,108,78,0.30)';
    Iso.poly(ctx, [P(17.66, 1.69, ltop + 0.066), P(17.73, 1.69, ltop + 0.066),
                   P(17.73, 2.09, ltop + 0.066), P(17.66, 2.09, ltop + 0.066)]);
    stencil(17.40, 2.21, ltop + 0.70, 'CDC', { size: 4.2, color: 'rgba(140,230,175,0.60)' });

    /* the published row, leaving for the belt */
    if (mv && PRINT > 0.45) {
      var fly = segLin(p, 0.90, 1.00);
      ctx.fillStyle = Iso.rgba('#7fe0a8', 0.85 * (1 - fly * 0.6));
      Iso.disc(ctx, 17.70 + fly * 0.8, 1.90 + fly * 3.4, ltop + 0.58 - fly * 0.45, 0.12);
    }

    /* ================================================ 6. transfer bays ==== */
    /* The gateway consumes from supBulkIndexingTopic_k8s and produces onto
       …outbox.{tenant}.ingestedCommunication — two different topics, so two
       bays: intake at the upstream end, outfeed under the ledger. The S3 body
       does not come through either of them; that is the mast. */
    var ph = phaseFor(s.plan || Sim.planNow(), 'gateway');
    var lagFrac = ph ? Math.min(1, ph.lag / Math.max(1, ph.lagThresh)) : 0;

    transferBay({
      x: 12.35, yMachine: py1 + 0.24, yBelt: 5.85, phase: p, arms: 'in',
      accent: AC, label: 'INTAKE',
      queue: lagFrac, over: !!(ph && ph.overThresh),
      inSwing: [0.00, 0.16], upRun: [0.08, 0.30]
    });
    transferBay({
      x: 17.05, yMachine: 3.05, yBelt: 5.85, phase: p, arms: 'out',
      accent: AC, label: 'OUTBOX',
      downRun: [0.80, 0.94], outSwing: [0.86, 1.00]
    });

    /* ==================================================== 7. watermark ==== */
    /* the integer ec-centralised-audit reconciles against, in a standpipe. */
    var wxp = 18.36, wyp = 3.00, wH = 2.05;
    Iso.box(ctx, { x: wxp - 0.34, y: wyp - 0.34, z: 0, w: 0.68, d: 0.68, h: 0.17,
                   color: lv.plinth });
    Iso.cylinder(ctx, { x: wxp, y: wyp, z: 0.17, r: 0.22, h: wH, color: M.iron, ring: 0.5 });
    var mark = Math.min(1, ((s.trips || 0) + (mv ? p : 0)) / Math.max(1, s.maxTrips || 3));
    Iso.cylinder(ctx, { x: wxp, y: wyp, z: 0.19, r: 0.155, h: Math.max(0.08, wH * mark),
                        color: Iso.mix('#2f6ea8', AC, 0.5), edge: false });
    Iso.cylinder(ctx, { x: wxp, y: wyp, z: 0.17 + wH, r: 0.26, h: 0.13, color: M.steelD });
    pipe(wxp, wyp, wxp - 0.80, wyp, 1.20, 0.12, M.steelD);
    Iso.box(ctx, { x: wxp - 0.93, y: wyp - 0.10, z: 1.14, w: 0.15, d: 0.20, h: 0.20,
                   color: M.brass });
    stencil(wxp - 0.58, wyp + 0.36, 0.58, 'WATERMARK',
            { size: 4.0, color: 'rgba(222,238,255,0.46)' });
  }

  /* ==== ec-queue-qualifier — the plate comparator ==========================
   *
   * What the service does (Section "ec-queue-qualifier", Flow A step A3, and
   * Flow B exit B1):
   *
   *   participants = streamExtract(s3.getObject(storage), ["iusers","eusers"])
   *   matches      = mongo.find("pipeline-entity-mapping_" + windowToken,
   *                             {entityId: {$in: participants}})
   *   pipelineIds  = distinct(matches.pipelineId)
   *   if pipelineIds.isEmpty(): publish(audit, {eventName: "not-qualified"})
   *   else:                     publish(qualifications, {pipelineIds})
   *
   * So the machine is a comparator: a stream matched against a fixed plate.
   * Read west to east —
   *
   *   reel + scanner ─ the document is READ, not consumed: it stays in S3 and
   *                    only the participant list is streamed out of it. A reel
   *                    pays out a strip, a scanner arch reads it, and the ids
   *                    pop off into the tag frame. Nothing here is destroyed,
   *                    which is the difference between this machine and the
   *                    gateway's press.
   *   the plate      ─ pipeline-entity-mapping_{windowToken}: a frozen
   *                    photograph of who was under surveillance when this
   *                    window opened. Bolted in, stamped with its token, and
   *                    it does not change while you are looking at it. The
   *                    frame presses the tags against it; the holes that light
   *                    are this document's hits.
   *   the sorter     ─ what passes drops into one bin per pipeline. A pipeline
   *                    is one named review queue — one compliance team's inbox.
   *   the reject bin ─ what does not pass. Most of it: these are participants
   *                    who are simply not in the monitored population, and the
   *                    single indexed query never returns them at all.
   *   receipt duct   ─ an audit event on BOTH paths. A zero match is not
   *                    silence; it is published as an audited not-qualified
   *                    outcome, because proving that nobody was being watched
   *                    is part of the regulatory record. See FLOOR-TOPOLOGY.md
   *                    for why this leaves through the floor.
   *
   * Drag People to zero and the plate stays dark, the verdict goes amber, and
   * the carrier takes the Flow B1 exit straight to ec-centralised-audit.
   * ===================================================================== */

  function drawQualifier(o, active) {
    var s  = Sim.state;
    var mv = busy('qualifier');
    var p  = cyc('qualifier', 0.40);

    /* ---- cam ---- */
    var READ    = segLin(p, 0.10, 0.44);   /* reel pays out, tags pop off   */
    var PRESS   = seg(p,    0.46, 0.58);   /* tag frame against the plate   */
    var SORT    = segLin(p, 0.58, 0.72);   /* matched tags into the bins    */
    var REJECT  = segLin(p, 0.60, 0.74);   /* the rest down the chute       */
    var VERDICT = seg(p,    0.70, 0.80);

    /* ---- what the model says about this document ---- */
    var people   = s.participants || 0;
    var matched  = Math.round(people * EC.MONITORED_SHARE);
    var rejected = people - matched;
    var pipes    = matched > 0 ? (s.pipelineCount || 1) : 0;
    var wt       = s.windowToken || EC.WINDOW_TOKEN;

    var lv = livery('qualifier');
    var AC = ACCENT.qualifier;
    var cs = casing('qualifier');

    /* ---- the machine, in numbers ---- */
    var px0 = 20.10, px1 = 26.30, py0 = 0.70, py1 = 3.30;
    var sf   = py1 + 0.01;
    var deck = 1.66;
    var i, u;

    /* =============================================== 1. casing and face ==== */
    Iso.box(ctx, { x: px0 - 0.15, y: py0 - 0.15, z: 0, w: (px1 - px0) + 0.30,
                   d: (py1 - py0) + 0.30, h: 0.26, color: cs.plinth });
    Iso.box(ctx, { x: px0, y: py0, z: 0.26, w: px1 - px0, d: py1 - py0,
                   h: deck - 0.26, color: cs.body });

    /* The reject chute hangs off the face between x 23.00 and 23.90, and south
       is left on screen, so it hides casing face x 22.45 to 23.91. The two
       instruments go either side of that band. */
    ribs(px0 + 0.10, px1 - 0.10, sf, 0.34, 1.18, 15);
    louvres(px0 + 0.08, sf, 0.42, 0.38, 0.86, 5);
    bolts(px0 + 0.12, px1 - 0.12, sf, 1.52, 17);
    bolts(px0 + 0.12, px1 - 0.12, sf, 0.32, 17);
    plate(px0, sf, 1.54, px1 - px0, 0.05, 'rgba(0,0,0,0.42)');

    readout(px0 + 0.58, sf, 0.46, 1.62, 0.62, [
      people + ' in / ' + matched + ' matched',
      rejected + ' not watched'
    ], { size: 5.0 });

    readout(px0 + 4.10, sf, 0.70, 1.94, 0.60, [
      pipes + ' pipeline' + (pipes === 1 ? '' : 's'),
      wt
    ], { size: 5.0, color: pipes ? '#78cff2' : '#f2b978' });

    /* deck: a recessed bed with a kerb, as the press has */
    Iso.box(ctx, { x: px0 - 0.07, y: py0 - 0.07, z: deck - 0.14,
                   w: (px1 - px0) + 0.14, d: (py1 - py0) + 0.14, h: 0.14, color: cs.kerb });
    Iso.box(ctx, { x: px0 + 0.12, y: py0 + 0.12, z: deck - 0.03,
                   w: (px1 - px0) - 0.24, d: (py1 - py0) - 0.24, h: 0.03, color: cs.tray });
    hazardStrip(px0 + 0.16, px1 - 0.16, py1 + 0.08, deck - 0.13, 0.11, 0.24);

    /* ===================================== 2. the S3 feed and the reel ==== */
    /* The document is read, not consumed — it stays in the archive bucket and
       only the participant list is streamed out of it. */
    pipe(20.85, py0 - 1.30, 20.85, py0 + 0.10, 1.16, 0.20, M.steelD);
    Iso.box(ctx, { x: 20.66, y: py0 - 1.44, z: 0.92, w: 0.38, d: 0.30, h: 0.46,
                   color: M.iron });
    stencil(20.30, py0 - 1.13, 1.42, 'S3', { size: 4.2, color: 'rgba(222,238,255,0.46)' });

    Iso.box(ctx, { x: 20.32, y: 1.02, z: deck, w: 0.92, d: 0.86, h: 0.22, color: M.iron });
    reel(20.78, 1.45, deck + 0.22, 0.32, mv ? READ * 9.4 : 0.3,
         mv && READ > 0 && READ < 1 ? Iso.mix(M.steel, AC, 0.35) : M.steelD);

    /* the strip running east to the scanner, and the tags popping off it */
    var sx0 = 21.16, sx1 = 22.34, sz = deck + 0.30;
    quad([[sx0, 1.24, sz], [sx1, 1.24, sz], [sx1, 1.66, sz], [sx0, 1.66, sz]],
         people > 0 ? PAPER.full : PAPER.dark);
    for (i = 0; i < 7; i++) {
      u = sx0 + 0.10 + i * ((sx1 - sx0 - 0.20) / 6);
      quad([[u, 1.28, sz + 0.004], [u + 0.05, 1.28, sz + 0.004],
            [u + 0.05, 1.62, sz + 0.004], [u, 1.62, sz + 0.004]],
           'rgba(60,58,52,0.55)');
    }

    /* scanner arch: streamed, not fully buffered */
    Iso.box(ctx, { x: 21.86, y: 1.16, z: sz, w: 0.11, d: 0.11, h: 0.46, color: M.iron });
    Iso.box(ctx, { x: 21.86, y: 1.72, z: sz, w: 0.11, d: 0.11, h: 0.46, color: M.iron });
    Iso.box(ctx, { x: 21.78, y: 1.12, z: sz + 0.46, w: 0.27, d: 0.72, h: 0.14,
                   color: M.steelD });
    ctx.fillStyle = (mv && READ > 0 && READ < 1)
      ? Iso.rgba(AC, 0.75) : 'rgba(120,110,150,0.22)';
    Iso.poly(ctx, [P(21.90, 1.26, sz + 0.006), P(21.97, 1.26, sz + 0.006),
                   P(21.97, 1.64, sz + 0.006), P(21.90, 1.64, sz + 0.006)]);

    /* ============================================== 3. the tag frame ==== */
    var fx = 22.44, fy = 1.16;
    Iso.box(ctx, { x: fx, y: fy, z: deck, w: 0.62, d: 0.66, h: 0.13, color: M.steelD });
    var held = mv ? Math.min(6, Math.floor(READ * 6.99)) : 0;
    for (i = 0; i < held; i++) {
      Iso.box(ctx, { x: fx + 0.07 + (i % 3) * 0.17, y: fy + 0.10 + ((i / 3) | 0) * 0.24,
                     z: deck + 0.13, w: 0.13, d: 0.18, h: 0.07,
                     color: i % 2 ? PAPER.full : PAPER.mid });
    }
    /* the frame travels the last inch onto the plate during the press stroke */
    if (mv && PRESS > 0) {
      ctx.fillStyle = Iso.rgba(PAPER.full, 0.9);
      Iso.disc(ctx, fx + 0.31 + PRESS * 0.42, fy + 0.33, deck + 0.30, 0.10);
    }

    /* ============================================ 4. the frozen plate ==== */
    /* pipeline-entity-mapping_{windowToken}: bolted in, dated, unmoving. */
    var qx = 23.10, qy = 1.30, qw = 0.86, qh = 1.18;
    Iso.box(ctx, { x: qx - 0.09, y: qy - 0.04, z: deck, w: qw + 0.18, d: 0.20,
                   h: 0.11, color: M.ironD });                       /* base */
    Iso.box(ctx, { x: qx - 0.09, y: qy, z: deck + 0.11, w: 0.09, d: 0.12,
                   h: qh, color: M.iron });                          /* frame */
    Iso.box(ctx, { x: qx + qw, y: qy, z: deck + 0.11, w: 0.09, d: 0.12,
                   h: qh, color: M.iron });
    Iso.box(ctx, { x: qx - 0.09, y: qy, z: deck + 0.11 + qh, w: qw + 0.18, d: 0.12,
                   h: 0.10, color: M.iron });
    Iso.box(ctx, { x: qx, y: qy + 0.01, z: deck + 0.11, w: qw, d: 0.10, h: qh,
                   color: '#2b2740' });                              /* the plate */

    /* the hole grid: the monitored population, and this document's hits */
    var psf = qy + 0.11 + 0.005;
    var lit = mv ? Math.round(Math.min(60, matched / 8) * Math.max(PRESS, SORT > 0 ? 1 : 0)) : 0;
    matrix(qx + 0.05, psf, deck + 0.30, 10, 6, 0.068,
           lit, 60, AC, 'rgba(154,136,224,0.20)');
    stencil(qx + 0.02, psf, deck + 0.16, wt,
            { size: 3.6, color: 'rgba(222,238,255,0.44)' });
    bolts(qx, qx + qw, psf, deck + 0.11 + qh + 0.05, 4);

    /* ========================================= 5. sorter and the bins ==== */
    var bx0 = 24.24, bspan = 1.76, bgap = 0.06;
    var bw  = pipes > 0 ? (bspan - (pipes - 1) * bgap) / pipes : bspan;
    var fills = [], labels = [];
    for (i = 0; i < pipes; i++) {
      fills.push(mv ? SORT * (0.55 + 0.35 * ((i % 2) ? 1 : 0.6)) : 0);
      labels.push('P' + (i + 1));
    }
    /* the chute the matched tags run down, from the plate to the bins */
    quad([[qx + qw + 0.10, 1.34, deck + 0.34], [bx0 - 0.04, 1.34, deck + 0.16],
          [bx0 - 0.04, 1.92, deck + 0.16], [qx + qw + 0.10, 1.92, deck + 0.34]],
         M.steelD);
    if (pipes > 0) {
      binRow(bx0, 1.34, deck, pipes, fills,
             { w: bw, d: 0.66, h: 0.50, gap: bgap, color: M.iron,
               fill: Iso.mix(PAPER.full, AC, 0.30),
               lit: mv && SORT > 0 && SORT < 1 ? Math.min(pipes - 1, Math.floor(SORT * pipes)) : -1,
               labels: pipes <= 4 ? labels : null, sf: 2.01, labelSize: 3.6 });
    }
    if (mv && SORT > 0 && SORT < 1) {
      ctx.fillStyle = Iso.mix(PAPER.full, AC, 0.30);
      Iso.disc(ctx, qx + qw + 0.14 + SORT * (bx0 - qx - qw), 1.62, deck + 0.40, 0.10);
    }

    /* Verdict indicator. Not the red/green standby lamp: on this machine red
       would read as failure, and a not-qualified outcome is a correct,
       audited result. The colour carries the verdict, the brightness carries
       whether it has just been reached. */
    var vcol = pipes > 0 ? '#5ad24e' : '#e0a040';
    ctx.fillStyle = 'rgba(9,11,13,0.85)';
    Iso.disc(ctx, 26.02, 2.62, deck + 0.10, 0.18);
    ctx.fillStyle = Iso.rgba(vcol, mv ? 0.40 + 0.60 * VERDICT : 0.34);
    Iso.disc(ctx, 26.02, 2.62, deck + 0.11, 0.13);
    stencil(px0 + 4.10, sf, 1.54, pipes > 0 ? 'QUALIFIED' : 'NOT QUALIFIED',
            { size: 4.2, color: pipes > 0 ? 'rgba(150,224,140,0.62)'
                                          : 'rgba(232,176,104,0.70)' });

    /* ========================================== 6. the reject chute ==== */
    /* Most of what goes in does not come out here — these participants are
       simply not in the monitored population, and the single indexed query
       never returns them at all. */
    var cx0 = 23.00, cx1 = 23.90, cyLip = 3.86;
    quad([[cx0, py1, 1.10], [cx1, py1, 1.10], [cx1, cyLip, 0.62], [cx0, cyLip, 0.62]], '#3d434b');
    quad([[cx0, py1, 1.10], [cx0, cyLip, 0.62], [cx0, cyLip, 0.44], [cx0, py1, 0.92]], '#2b3036');
    quad([[cx1, py1, 1.10], [cx1, cyLip, 0.62], [cx1, cyLip, 0.44], [cx1, py1, 0.92]], '#23272c');
    Iso.box(ctx, { x: cx0 - 0.14, y: cyLip - 0.02, z: 0, w: (cx1 - cx0) + 0.28, d: 0.80,
                   h: 0.56, color: '#3b414a' });
    quad([[cx0 - 0.06, cyLip + 0.06, 0.56], [cx1 + 0.06, cyLip + 0.06, 0.56],
          [cx1 + 0.06, cyLip + 0.70, 0.56], [cx0 - 0.06, cyLip + 0.70, 0.56]], '#15181c');
    if (rejected > 0) {
      quad([[cx0 + 0.02, cyLip + 0.13, 0.50], [cx1 - 0.02, cyLip + 0.13, 0.50],
            [cx1 - 0.02, cyLip + 0.63, 0.50], [cx0 + 0.02, cyLip + 0.63, 0.50]],
           Iso.shade(PAPER.dark, 0.80));
    }
    stencil(cx0 - 0.18, cyLip + 0.79, 0.34, 'not in population',
            { size: 4.0, color: 'rgba(228,224,214,0.44)' });
    if (mv && rejected > 0 && REJECT > 0 && REJECT < 1) {
      chips(23.45, 3.42, 1.24, 8, 53, PAPER.dark);
    }

    /* ============================================ 7. receipt and rack ==== */
    receiptDuct(27.20, 4.05, {
      phase: p, drop: [0.72, 0.86], accent: pipes > 0 ? '#8fd6a0' : '#e0a040',
      label: 'ec.centralized.audit'
    });

    replicaStack(px1 - 0.30, py0 + 0.12, deck,
                 phaseFor(s.plan || Sim.planNow(), 'qualifier'),
                 { cols: 9, pitch: 0.26, max: 13 });

    /* ============================================== 8. transfer bays ==== */
    var ph = phaseFor(s.plan || Sim.planNow(), 'qualifier');
    var lagFrac = ph ? Math.min(1, ph.lag / Math.max(1, ph.lagThresh)) : 0;

    transferBay({
      x: 21.20, yMachine: py1 + 0.24, yBelt: 5.85, phase: p, arms: 'in',
      accent: AC, label: 'INTAKE',
      queue: lagFrac, over: !!(ph && ph.overThresh),
      inSwing: [0.00, 0.16], upRun: [0.08, 0.30]
    });
    transferBay({
      x: 25.40, yMachine: py1 + 0.24, yBelt: 5.85, phase: p, arms: 'out',
      accent: AC, label: 'OUTFEED',
      downRun: [0.76, 0.90], outSwing: [0.84, 1.00]
    });
  }

  /* ==== ec-surveillance-filter — the screening line ========================
   *
   * What the service does (Section "ec-surveillance-filter", Flow A step A5,
   * Flow B exit B2):
   *
   *   config = mongo.load(pipelines_{wt}, policies_{wt}, libraries_{wt})
   *   doc    = parallelChunkedGet(s3Bucket, storage)   // CONCURRENTLY
   *   for pipelineId in headers.pipelineIds:           // independent verdict
   *     if   anyMatch(ignorePolicies[pipelineId], doc): verdict = FILTERED
   *     elif anyMatch(flagPolicies[pipelineId],   doc): verdict = QUALIFIED
   *     else:                                           verdict = NOT_QUALIFIED
   *     publish(verdict == QUALIFIED ? evaluations : not-qualified, …)
   *     publish(audit, …)
   *
   * So the machine is a screening line with two screens in series, and the
   * order is the whole point: "ignore policies must be evaluated before flag
   * policies — reordering silently changes results". The screens are numbered
   * on the deck and bolted in sequence so the order is not something you have
   * to be told.
   *
   *   config bay    ─ three cartridges, stamped with the window token, and the
   *                   S3 riser beside them. Both supply lines light together
   *                   during the load stroke, because the config load and the
   *                   chunked document fetch run concurrently.
   *   the lane      ─ one carrier per claiming pipeline. Independent verdicts
   *                   mean this station is the first that does N things rather
   *                   than one, and the lane shows N.
   *   screen 1      ─ IGNORE. Suppression, and it goes first. What it catches
   *                   drops out here and is never offered to screen 2 at all.
   *   screen 2      ─ FLAG. Selection. What it catches continues east on the
   *                   qualified rail; what it does not is NOT_QUALIFIED.
   *   the bin       ─ two compartments, one topic. FILTERED and NOT_QUALIFIED
   *                   are different reasons that both publish to
   *                   …not-qualified, which the quota manager consumes for
   *                   accounting only.
   *   receipt duct  ─ one audit event PER PIPELINE, not one per record. See
   *                   FLOOR-TOPOLOGY.md.
   *
   * Drag Ignore% to 100 and nothing qualifies: the record skips evaluation
   * entirely and is counted at the gate — Flow B2.
   * ===================================================================== */

  function drawFilter(o, active) {
    var s  = Sim.state;
    var mv = busy('filter');
    var p  = cyc('filter', 0.40);

    /* ---- cam ---- */
    var LOAD  = segLin(p, 0.06, 0.30);   /* config + S3, concurrently        */
    var FEED  = segLin(p, 0.28, 0.44);   /* carriers onto the lane           */
    var IGN   = seg(p,    0.46, 0.58);   /* screen 1 closes                  */
    var DROP1 = segLin(p, 0.54, 0.66);   /* the suppressed fall out          */
    var FLAG  = seg(p,    0.62, 0.74);   /* screen 2 closes                  */
    var DROP2 = segLin(p, 0.70, 0.82);   /* the unclaimed fall out           */
    var EXIT  = segLin(p, 0.78, 0.92);   /* the qualified run east           */
    var VERD  = seg(p,    0.80, 0.90);

    /* ---- what the model says ---- */
    var claimed = s.pipelineIds || 0;
    var nFil    = s.filtered || 0;
    var nQual   = s.qualified || 0;
    var nNot    = s.notQualified || 0;
    var wt      = s.windowToken || EC.WINDOW_TOKEN;
    var shown   = Math.min(8, claimed);

    var AC = ACCENT.filter;
    var cs = casing('filter');
    var V_FIL = '#c8503c', V_QUAL = '#5ad24e', V_NOT = '#e0a040';

    var px0 = 29.90, px1 = 36.70, py0 = 0.70, py1 = 3.30;
    var sf   = py1 + 0.01;
    var deck = 1.66;
    var i, u, vx, vz, kind;

    /* the lane */
    var laneY = 1.52, laneX0 = 31.50, s1x = 32.72, s2x = 34.45, laneX1 = 36.34;

    /* =============================================== 1. casing and face ==== */
    Iso.box(ctx, { x: px0 - 0.15, y: py0 - 0.15, z: 0, w: (px1 - px0) + 0.30,
                   d: (py1 - py0) + 0.30, h: 0.26, color: cs.plinth });
    Iso.box(ctx, { x: px0, y: py0, z: 0.26, w: px1 - px0, d: py1 - py0,
                   h: deck - 0.26, color: cs.body });

    /* Two chutes hang off this face — one per screen — and south is left on
       screen, so they hide face x 31.85-33.10 and 33.60-34.85. The two
       instruments sit west and east of both bands. */
    ribs(px0 + 0.10, px1 - 0.10, sf, 0.34, 1.18, 16);
    louvres(px0 + 0.08, sf, 0.42, 0.38, 0.86, 5);
    bolts(px0 + 0.12, px1 - 0.12, sf, 1.52, 18);
    bolts(px0 + 0.12, px1 - 0.12, sf, 0.32, 18);
    plate(px0, sf, 1.54, px1 - px0, 0.05, 'rgba(0,0,0,0.42)');

    readout(px0 + 0.24, sf, 0.44, 1.54, 0.60, [
      'policies_' + wt,
      claimed + ' x 4 policies'
    ], { size: 5.0 });

    readout(px0 + 5.10, sf, 0.44, 1.52, 0.86, [
      'FILTERED  ' + nFil,
      'QUALIFIED ' + nQual,
      'NOT QUAL  ' + nNot
    ], { size: 5.0, color: nQual > 0 ? '#78cff2' : '#f2b978' });

    /* verdict board: one cell per claiming pipeline, in verdict colour */
    for (i = 0; i < shown; i++) {
      kind = i < nFil ? V_FIL : (i < nFil + nQual ? V_QUAL : V_NOT);
      plate(px0 + 5.10 + i * 0.17, sf, 1.40, 0.14, 0.14,
            Iso.rgba(kind, mv && VERD > 0.3 ? 0.95 : 0.40));
    }

    /* deck */
    Iso.box(ctx, { x: px0 - 0.07, y: py0 - 0.07, z: deck - 0.14,
                   w: (px1 - px0) + 0.14, d: (py1 - py0) + 0.14, h: 0.14, color: cs.kerb });
    Iso.box(ctx, { x: px0 + 0.12, y: py0 + 0.12, z: deck - 0.03,
                   w: (px1 - px0) - 0.24, d: (py1 - py0) - 0.24, h: 0.03, color: cs.tray });
    hazardStrip(px0 + 0.16, px1 - 0.16, py1 + 0.08, deck - 0.13, 0.11, 0.24);

    /* ========================== 2. config bay and the S3 riser, together ==== */
    /* The config load and the chunked document fetch run concurrently, so both
       supply lines light on the same stroke. */
    var lit = mv && LOAD > 0 && LOAD < 1;
    pipe(30.62, py0 - 1.30, 30.62, py0 + 0.10, 1.16, 0.20,
         lit ? Iso.mix(M.steelD, AC, 0.40) : M.steelD);
    Iso.box(ctx, { x: 30.43, y: py0 - 1.44, z: 0.92, w: 0.38, d: 0.30, h: 0.46,
                   color: M.iron });
    stencil(30.05, py0 - 1.13, 1.42, 'S3', { size: 4.2, color: 'rgba(222,238,255,0.46)' });

    Iso.box(ctx, { x: px0 + 0.14, y: 0.94, z: deck, w: 0.98, d: 1.34, h: 0.16,
                   color: M.iron });
    var CART = ['pipelines', 'policies', 'libraries'];
    for (i = 0; i < 3; i++) {
      Iso.box(ctx, { x: px0 + 0.22 + i * 0.30, y: 1.02, z: deck + 0.16,
                     w: 0.22, d: 1.16, h: 0.42,
                     color: lit ? Iso.mix('#4e4a3a', AC, 0.30) : '#4e4a3a' });
      Iso.box(ctx, { x: px0 + 0.22 + i * 0.30, y: 1.02, z: deck + 0.58,
                     w: 0.22, d: 1.16, h: 0.04, color: PAPER.dark });
    }
    floorText(px0 + 0.18, 2.36, deck + 0.04, ['CONFIG ' + wt],
              { size: 3.6, color: 'rgba(226,236,250,0.36)' });

    /* ================================================== 3. the lane ==== */
    Iso.box(ctx, { x: laneX0 - 0.10, y: laneY - 0.28, z: deck, w: laneX1 - laneX0 + 0.20,
                   d: 0.10, h: 0.12, color: M.iron });
    Iso.box(ctx, { x: laneX0 - 0.10, y: laneY + 0.18, z: deck, w: laneX1 - laneX0 + 0.20,
                   d: 0.10, h: 0.12, color: M.iron });
    for (i = 0; i * 0.34 < laneX1 - laneX0; i++) {
      Iso.orientedBox(ctx, { x: laneX0 + 0.14 + i * 0.34, y: laneY - 0.05, z: deck + 0.10,
                             hx: 0, hy: 1, len: 0.34, wid: 0.10, h: 0.06,
                             color: i % 2 ? M.steel : M.steelD });
    }

    /* ============================================ 4. the two screens ==== */
    /* Numbered, and bolted in this order. */
    function screen(x, num, colour, close, label) {
      Iso.box(ctx, { x: x - 0.07, y: laneY - 0.42, z: deck, w: 0.14, d: 0.14,
                     h: 0.86, color: M.iron });
      Iso.box(ctx, { x: x - 0.07, y: laneY + 0.30, z: deck, w: 0.14, d: 0.14,
                     h: 0.86, color: M.iron });
      Iso.box(ctx, { x: x - 0.13, y: laneY - 0.46, z: deck + 0.86, w: 0.26, d: 0.90,
                     h: 0.14, color: M.steelD });
      /* the shutter: down means the screen is being applied */
      var sh = 0.62 * (close || 0);
      Iso.box(ctx, { x: x - 0.05, y: laneY - 0.34, z: deck + 0.86 - sh, w: 0.10,
                     d: 0.70, h: Math.max(0.04, sh),
                     color: Iso.rgba(colour, 0.80) });
      Iso.box(ctx, { x: x - 0.10, y: laneY - 0.40, z: deck + 0.94, w: 0.20, d: 0.20,
                     h: 0.16, color: colour });
      floorText(x - 0.30, laneY + 0.58, deck + 0.04, [num + ' ' + label],
                { size: 3.8, color: 'rgba(226,236,250,0.44)' });
    }
    screen(s1x, '1', V_FIL,  mv ? IGN  : 0, 'IGNORE');
    screen(s2x, '2', V_QUAL, mv ? FLAG : 0, 'FLAG');

    /* ======================================= 5. the carriers on the lane ==== */
    if (mv) {
      for (i = 0; i < shown; i++) {
        kind = i < nFil ? 'F' : (i < nFil + nQual ? 'Q' : 'N');
        var back = i * 0.13;                       /* they run as a train */
        vz = deck + 0.16;
        if (kind === 'F') {
          if (DROP1 >= 1) continue;
          vx = laneX0 + FEED * (s1x - laneX0) - back * (1 - FEED);
          vz -= DROP1 * 0.92;
        } else {
          vx = laneX0 + FEED * (s1x - laneX0)
                      + FLAG * (s2x - s1x)
                      + (kind === 'Q' ? EXIT * (laneX1 - s2x) : 0)
                      - back * (1 - EXIT);
          if (kind === 'N') {
            if (DROP2 >= 1) continue;
            vz -= DROP2 * 0.92;
          }
        }
        ctx.save();
        if (kind === 'F' && DROP1 > 0) ctx.globalAlpha = 1 - DROP1 * 0.5;
        if (kind === 'N' && DROP2 > 0) ctx.globalAlpha = 1 - DROP2 * 0.5;
        Iso.box(ctx, { x: vx - 0.11, y: laneY - 0.16, z: vz, w: 0.22, d: 0.32,
                       h: 0.14, color: PAPER.full });
        Iso.box(ctx, { x: vx - 0.08, y: laneY - 0.13, z: vz + 0.14, w: 0.16, d: 0.26,
                       h: 0.05,
                       color: kind === 'F' ? V_FIL : kind === 'Q' ? V_QUAL : V_NOT });
        ctx.restore();
      }
    }

    /* ===================================== 6. the two suppression chutes ==== */
    function chute(cx0, cx1) {
      quad([[cx0, py1, 1.10], [cx1, py1, 1.10], [cx1, 3.86, 0.62], [cx0, 3.86, 0.62]], '#3d434b');
      quad([[cx0, py1, 1.10], [cx0, 3.86, 0.62], [cx0, 3.86, 0.44], [cx0, py1, 0.92]], '#2b3036');
      quad([[cx1, py1, 1.10], [cx1, 3.86, 0.62], [cx1, 3.86, 0.44], [cx1, py1, 0.92]], '#23272c');
    }
    chute(32.40, 33.10);
    chute(34.15, 34.85);

    /* one bin, two compartments: two reasons, one topic */
    Iso.box(ctx, { x: 32.30, y: 3.92, z: 0, w: 2.65, d: 0.80, h: 0.55, color: '#3b414a' });
    Iso.box(ctx, { x: 33.58, y: 3.92, z: 0, w: 0.09, d: 0.80, h: 0.62, color: M.iron });
    quad([[32.38, 4.00, 0.55], [33.54, 4.00, 0.55], [33.54, 4.64, 0.55], [32.38, 4.64, 0.55]],
         nFil  ? Iso.shade(V_FIL, 0.42) : '#15181c');
    quad([[33.70, 4.00, 0.55], [34.87, 4.00, 0.55], [34.87, 4.64, 0.55], [33.70, 4.64, 0.55]],
         nNot  ? Iso.shade(V_NOT, 0.40) : '#15181c');
    stencil(32.36, 4.73, 0.30, 'FILTERED', { size: 3.8, color: 'rgba(228,224,214,0.46)' });
    stencil(33.68, 4.73, 0.30, 'NOT QUALIFIED', { size: 3.8, color: 'rgba(228,224,214,0.46)' });
    floorText(32.30, 4.98, 0.03, ['ec.surveillance-filter.{tenant}.not-qualified'],
              { size: 3.8, color: 'rgba(226,236,250,0.32)' });
    if (mv && nFil  && DROP1 > 0 && DROP1 < 1) chips(32.75, 3.46, 1.22, 6, 61, V_FIL);
    if (mv && nNot  && DROP2 > 0 && DROP2 < 1) chips(34.50, 3.46, 1.22, 6, 67, V_NOT);

    /* ============================================ 7. receipt and rack ==== */
    /* One audit event per pipeline, not one per record. */
    receiptDuct(37.60, 4.55, {
      phase: p, drop: [0.84, 0.96], accent: '#8fd6a0',
      label: 'audit x' + Math.max(1, claimed)
    });

    replicaStack(px1 - 0.30, py0 + 0.12, deck,
                 phaseFor(s.plan || Sim.planNow(), 'filter'),
                 { cols: 9, pitch: 0.26, max: 14 });

    /* ============================================== 8. transfer bays ==== */
    var ph = phaseFor(s.plan || Sim.planNow(), 'filter');
    var lagFrac = ph ? Math.min(1, ph.lag / Math.max(1, ph.lagThresh)) : 0;

    transferBay({
      x: 30.90, yMachine: py1 + 0.24, yBelt: 5.85, phase: p, arms: 'in',
      accent: AC, label: 'INTAKE',
      queue: lagFrac, over: !!(ph && ph.overThresh),
      inSwing: [0.00, 0.16], upRun: [0.08, 0.30]
    });
    transferBay({
      x: 35.80, yMachine: py1 + 0.24, yBelt: 5.85, phase: p, arms: 'out',
      accent: AC, label: 'OUTFEED',
      downRun: [0.80, 0.92], outSwing: [0.86, 1.00]
    });
  }

  /* ==== ec-surveillance-policy-evaluator — the router and timekeeper =======
   *
   * What the service does (Section "ec-surveillance-policy-evaluator", Flow A
   * step A7, Flow C):
   *
   *   policies = filterApi.policies(tenant, windowToken, evt.pipelineId)
   *   metadataOnly, needsContent = partition(policies, p -> answerableFromMetadata)
   *   if metadataOnly.nonEmpty: publish(surveilled, synthesiseCognitionResponse(…))
   *   if needsContent.nonEmpty: publish(cims, buildCimsPayload(…, ingestionToken))
   *                             publish(audit, {eventName: "initiated"})
   *   onComsResponse(coms):     // may arrive up to COMS_TIMEOUT_MS later
   *     if coms.runMode != "V3": return
   *     eventName = deriveEventName(status, elapsed > COMS_TIMEOUT_MS)
   *     publish(eventName == "succeeded" ? surveilled : audit, …)
   *
   * "This station is a router and a timekeeper: it never judges content
   * itself." So the machine sorts and it waits, and nothing on it evaluates.
   *
   *   the splitter  ─ one verdict in, two ways out. Metadata-answerable goes
   *                   north to the local bench; anything needing the message
   *                   body goes south to dispatch. The Content% control is
   *                   literally the angle of this diverter.
   *   local bench   ─ metadata verdicts are answered here in milliseconds, and
   *                   stamped into Cognition's own response shape —
   *                   synthesiseCognitionResponse. The platform manufactures
   *                   the reply it would otherwise have waited for.
   *   CIMS dispatch ─ the payload leaves the platform, up the mast to the
   *                   Cognition island off the north edge of the floor.
   *   the wait rack ─ the point of the whole station. One slot per pending
   *                   content evaluation, each filling against a hard red line:
   *                   COMS_TIMEOUT_MS, 9 000 000 ms. Everything before this
   *                   station is milliseconds of local work. This one step can
   *                   add two and a half hours, and it is the only latency in
   *                   the platform that EC's own code does not bound.
   *   V3 gate       ─ COMS responses arrive on their own line, not the belt,
   *                   and a non-V3 run mode is dropped by design.
   *   timeout bin   ─ slots that pass the red line are aged out as
   *                   no-coms-timedout. Recorded, audited, not lost — but they
   *                   never reach sampling.
   *
   * Drag Content% to 100 and Cognition past the ceiling and the record takes
   * that exit: nothing reaches …surveilled and the carrier leaves for audit.
   * ===================================================================== */

  function drawEvaluator(o, active) {
    var s  = Sim.state;
    var mv = busy('evaluator');
    var p  = cyc('evaluator', 0.40);

    /* ---- cam ---- */
    var SPLIT = segLin(p, 0.08, 0.28);   /* verdicts divide                  */
    var META  = seg(p,    0.24, 0.42);   /* the local bench stamps           */
    var SEND  = segLin(p, 0.34, 0.54);   /* CIMS out and up the mast         */
    var WAIT  = segLin(p, 0.50, 0.76);   /* slots fill against the ceiling   */
    var BACK  = segLin(p, 0.70, 0.88);   /* COMS comes down its own line     */
    var GATE  = seg(p,    0.82, 0.90);   /* runMode == V3                    */

    /* ---- what the model says ---- */
    var meta    = s.metadataOnly || 0;
    var out     = s.sentToCognition || 0;
    var rtt     = s.comsRttMs || 0;
    var ceiling = EC.COMS_TIMEOUT_MS;
    var timedOut = !!s.comsTimedOut;
    var frac    = ceiling > 0 ? rtt / ceiling : 0;

    var AC = ACCENT.evaluator;
    var cs = casing('evaluator');
    var C_META = '#5ad24e', C_COG = '#5090e0', C_TMO = '#d0402c';

    var px0 = 39.90, px1 = 46.90, py0 = 0.70, py1 = 3.30;
    var sf   = py1 + 0.01;
    var deck = 1.66;
    var i, u, n;

    var metaY = 1.16, cogY = 2.44;       /* the two lanes out of the splitter */

    /* =============================================== 1. casing and face ==== */
    Iso.box(ctx, { x: px0 - 0.15, y: py0 - 0.15, z: 0, w: (px1 - px0) + 0.30,
                   d: (py1 - py0) + 0.30, h: 0.26, color: cs.plinth });
    Iso.box(ctx, { x: px0, y: py0, z: 0.26, w: px1 - px0, d: py1 - py0,
                   h: deck - 0.26, color: cs.body });

    /* The timeout chute hangs off the face at x 44.60-45.50 and so hides face
       x 44.05-45.50. Both instruments sit west of it. */
    ribs(px0 + 0.10, px1 - 0.10, sf, 0.34, 1.18, 16);
    louvres(px0 + 0.08, sf, 0.42, 0.38, 0.86, 5);
    bolts(px0 + 0.12, px1 - 0.12, sf, 1.52, 18);
    bolts(px0 + 0.12, px1 - 0.12, sf, 0.32, 18);
    plate(px0, sf, 1.54, px1 - px0, 0.05, 'rgba(0,0,0,0.42)');

    readout(px0 + 0.25, sf, 0.44, 1.68, 0.60, [
      meta + ' metadata, local',
      out  + ' out to Cognition'
    ], { size: 5.0 });

    readout(px0 + 2.20, sf, 0.44, 1.80, 0.86, [
      'WAIT    ' + EC.fmtMs(rtt),
      'CEILING ' + EC.fmtMs(ceiling),
      timedOut ? 'no-coms-timedout' : 'within ceiling'
    ], { size: 5.0, color: timedOut ? '#f28a78' : '#78cff2' });

    /* deck */
    Iso.box(ctx, { x: px0 - 0.07, y: py0 - 0.07, z: deck - 0.14,
                   w: (px1 - px0) + 0.14, d: (py1 - py0) + 0.14, h: 0.14, color: cs.kerb });
    Iso.box(ctx, { x: px0 + 0.12, y: py0 + 0.12, z: deck - 0.03,
                   w: (px1 - px0) - 0.24, d: (py1 - py0) - 0.24, h: 0.03, color: cs.tray });
    hazardStrip(px0 + 0.16, px1 - 0.16, py1 + 0.08, deck - 0.13, 0.11, 0.24);

    /* ================================================ 2. the splitter ==== */
    /* One verdict in, two ways out. Content% is the angle of this diverter. */
    var spx = 40.55;
    Iso.box(ctx, { x: spx - 0.34, y: 1.52, z: deck, w: 0.68, d: 0.92, h: 0.30,
                   color: M.iron });
    Iso.cylinder(ctx, { x: spx, y: 1.98, z: deck + 0.30, r: 0.17, h: 0.20, color: M.steelD });
    /* the vane points the way the majority is going */
    var vane = (meta + out) > 0 ? (out / (meta + out)) : 0;
    Iso.orientedBox(ctx, {
      x: spx + 0.34, y: 1.98 + (vane - 0.5) * 0.62, z: deck + 0.34,
      hx: 1, hy: (vane - 0.5) * 1.6, len: 0.78, wid: 0.16, h: 0.11,
      color: vane > 0.5 ? C_COG : C_META
    });
    floorText(spx - 0.36, 2.62, deck + 0.04, ['SPLIT'],
              { size: 3.8, color: 'rgba(226,236,250,0.40)' });

    /* the two lanes */
    function lane(y0, x0, x1, tint) {
      Iso.box(ctx, { x: x0, y: y0 - 0.22, z: deck, w: x1 - x0, d: 0.07, h: 0.10, color: M.iron });
      Iso.box(ctx, { x: x0, y: y0 + 0.15, z: deck, w: x1 - x0, d: 0.07, h: 0.10, color: M.iron });
      for (var k = 0; k * 0.30 < x1 - x0; k++) {
        Iso.orientedBox(ctx, { x: x0 + 0.12 + k * 0.30, y: y0 - 0.04, z: deck + 0.09,
                               hx: 0, hy: 1, len: 0.30, wid: 0.09, h: 0.05,
                               color: k % 2 ? M.steel : M.steelD });
      }
    }
    lane(metaY, 41.15, 43.30);
    lane(cogY,  41.15, 42.20);

    /* ============================== 3. the local bench: metadata verdicts ==== */
    /* Answered here in milliseconds, and stamped into Cognition's own response
       shape — the platform manufactures the reply it would have waited for. */
    var bx = 42.72;
    Iso.box(ctx, { x: bx - 0.42, y: metaY - 0.40, z: deck, w: 0.84, d: 0.80, h: 0.16,
                   color: M.steelD });
    for (i = 0; i < 4; i++) {
      Iso.box(ctx, { x: bx - 0.36 + (i % 2) * 0.62, y: metaY - 0.34 + ((i / 2) | 0) * 0.56,
                     z: deck + 0.16, w: 0.12, d: 0.12, h: 0.54, color: M.iron });
    }
    var stampZ = deck + 0.70 - (mv && meta > 0 ? META : 0) * 0.38;
    Iso.box(ctx, { x: bx - 0.30, y: metaY - 0.28, z: stampZ, w: 0.60, d: 0.56, h: 0.18,
                   color: '#aab4be' });
    Iso.box(ctx, { x: bx - 0.36, y: metaY - 0.34, z: deck + 0.70, w: 0.72, d: 0.68,
                   h: 0.12, color: M.ironD });
    floorText(bx - 0.52, metaY + 0.36, deck + 0.04, ['METADATA · LOCAL'],
              { size: 3.6, color: 'rgba(150,224,140,0.44)' });
    if (mv && meta > 0 && META > 0.55 && META < 0.95) {
      sparks(bx, metaY, deck + 0.30, 4, 29, '#bdf0b4');
    }
    /* the synthesised responses joining the surveilled rail */
    if (mv && meta > 0 && META >= 0.6) {
      for (i = 0; i < Math.min(4, meta); i++) {
        u = segLin(p, 0.42 + i * 0.03, 0.72 + i * 0.03);
        if (u <= 0 || u >= 1) continue;
        ctx.fillStyle = Iso.rgba(C_META, 0.9);
        Iso.disc(ctx, bx + 0.42 + u * 4.10, metaY, deck + 0.26, 0.10);
      }
    }

    /* =================================== 4. CIMS dispatch and the mast ==== */
    var dx = 41.55;
    Iso.box(ctx, { x: dx - 0.44, y: cogY - 0.40, z: deck, w: 0.88, d: 0.80, h: 0.52,
                   color: M.iron });
    louvres(dx - 0.36, cogY + 0.41, deck + 0.08, 0.70, 0.36, 3);
    Iso.box(ctx, { x: dx - 0.30, y: cogY - 0.30, z: deck + 0.52, w: 0.60, d: 0.58,
                   h: 0.08, color: M.steelD });
    lattice(dx, cogY, deck + 0.60, 1.36, 0.24, 3, '#5c6672');
    Iso.box(ctx, { x: dx - 0.19, y: cogY - 0.19, z: deck + 1.96, w: 0.38, d: 0.38,
                   h: 0.17, color: M.steelD });
    ctx.fillStyle = Iso.rgba(C_COG, mv && out > 0 && SEND > 0 && SEND < 1 ? 0.85 : 0.30);
    Iso.disc(ctx, dx, cogY, deck + 2.15, 0.28);
    floorText(dx - 0.56, cogY + 0.50, deck + 0.04, ['CIMS · ingestionToken'],
              { size: 3.6, color: 'rgba(120,170,230,0.46)' });
    /* the payload leaving the platform */
    if (mv && out > 0 && SEND > 0 && SEND < 1) {
      ctx.fillStyle = Iso.rgba('#bdd8ff', 0.9 * (1 - SEND * 0.4));
      Iso.disc(ctx, dx, cogY, deck + 0.70 + SEND * 2.0, 0.11);
    }

    /* ======================================== 5. the wait rack ==== */
    /* One slot per pending content evaluation, filling against the hard red
       line at COMS_TIMEOUT_MS. */
    var rx0 = 43.36, rw = 0.30, rgap = 0.10, rh = 1.30;
    n = Math.max(1, Math.min(5, out));
    Iso.box(ctx, { x: rx0 - 0.14, y: 1.30, z: deck, w: n * (rw + rgap) + 0.18, d: 0.76,
                   h: 0.12, color: M.ironD });
    for (i = 0; i < n; i++) {
      var fill = (mv && out > 0) ? frac * WAIT : (out > 0 ? frac : 0);
      gaugeCol(rx0 + i * (rw + rgap), 1.52, deck + 0.12, rw, rh,
               out > 0 ? fill : 0,
               timedOut ? C_TMO : C_COG,
               { ceiling: 1.0, max: 1.14, over: C_TMO, track: '#2a3540' });
    }
    floorText(rx0 - 0.16, 2.22, deck + 0.04, ['WAITING · COMS'],
              { size: 3.6, color: 'rgba(120,170,230,0.46)' });
    if (out === 0) {
      stencil(rx0 - 0.10, 2.20, deck + 0.60, 'IDLE',
              { size: 4.0, color: 'rgba(200,215,235,0.30)' });
    }

    /* ================================= 6. the COMS return and V3 gate ==== */
    /* Responses arrive on samplingTopic_k8s — their own line, not the belt. */
    var gx = 46.10;
    pipe(gx, py0 - 1.40, gx, 1.28, 1.30, 0.20,
         mv && out > 0 && BACK > 0 && BACK < 1 ? Iso.mix(M.steelD, C_COG, 0.45) : M.steelD);
    Iso.box(ctx, { x: gx - 0.20, y: py0 - 1.54, z: 1.06, w: 0.40, d: 0.32, h: 0.46,
                   color: M.iron });
    stencil(gx - 0.62, py0 - 1.22, 1.54, 'samplingTopic_k8s',
            { size: 3.6, color: 'rgba(222,238,255,0.44)' });

    Iso.box(ctx, { x: gx - 0.36, y: 1.34, z: deck, w: 0.16, d: 0.16, h: 0.66, color: M.iron });
    Iso.box(ctx, { x: gx + 0.20, y: 1.34, z: deck, w: 0.16, d: 0.16, h: 0.66, color: M.iron });
    Iso.box(ctx, { x: gx - 0.42, y: 1.28, z: deck + 0.66, w: 0.84, d: 0.30, h: 0.16,
                   color: M.steelD });
    ctx.fillStyle = Iso.rgba(timedOut ? C_TMO : C_META,
                             mv && GATE > 0.3 ? 0.92 : 0.34);
    Iso.disc(ctx, gx - 0.08, 1.42, deck + 0.86, 0.13);
    floorText(gx - 0.42, 1.72, deck + 0.04, ['V3 GATE'],
              { size: 3.6, color: 'rgba(226,236,250,0.42)' });
    if (mv && out > 0 && BACK > 0 && BACK < 1) {
      ctx.fillStyle = Iso.rgba(timedOut ? C_TMO : C_META, 0.9);
      Iso.disc(ctx, gx, 1.28 - 0.0, deck + 0.90 - BACK * 0.10, 0.11);
    }

    /* ==================================== 7. the timeout chute and bin ==== */
    var cx0 = 44.60, cx1 = 45.50, cyLip = 3.86;
    quad([[cx0, py1, 1.10], [cx1, py1, 1.10], [cx1, cyLip, 0.62], [cx0, cyLip, 0.62]], '#3d434b');
    quad([[cx0, py1, 1.10], [cx0, cyLip, 0.62], [cx0, cyLip, 0.44], [cx0, py1, 0.92]], '#2b3036');
    quad([[cx1, py1, 1.10], [cx1, cyLip, 0.62], [cx1, cyLip, 0.44], [cx1, py1, 0.92]], '#23272c');
    Iso.box(ctx, { x: cx0 - 0.14, y: cyLip - 0.02, z: 0, w: (cx1 - cx0) + 0.28, d: 0.80,
                   h: 0.56, color: '#3b414a' });
    quad([[cx0 - 0.06, cyLip + 0.06, 0.56], [cx1 + 0.06, cyLip + 0.06, 0.56],
          [cx1 + 0.06, cyLip + 0.70, 0.56], [cx0 - 0.06, cyLip + 0.70, 0.56]],
         timedOut ? Iso.shade(C_TMO, 0.42) : '#15181c');
    stencil(cx0 - 0.22, cyLip + 0.79, 0.34, 'no-coms-timedout',
            { size: 3.8, color: 'rgba(228,224,214,0.46)' });
    if (mv && timedOut && out > 0 && BACK > 0.3 && BACK < 1) {
      chips(45.05, 3.46, 1.22, 6, 71, C_TMO);
    }

    /* ============================================ 8. receipt and rack ==== */
    receiptDuct(47.30, 4.55, {
      phase: p, drop: [0.86, 0.97],
      accent: timedOut ? '#e0a040' : '#8fd6a0',
      label: timedOut ? 'audit · timed out' : 'audit · initiated'
    });

    replicaStack(px1 - 0.30, py0 + 0.12, deck,
                 phaseFor(s.plan || Sim.planNow(), 'evaluator'),
                 { cols: 9, pitch: 0.26, max: 12 });

    /* ============================================== 9. transfer bays ==== */
    var ph = phaseFor(s.plan || Sim.planNow(), 'evaluator');
    var lagFrac = ph ? Math.min(1, ph.lag / Math.max(1, ph.lagThresh)) : 0;

    transferBay({
      x: 40.80, yMachine: py1 + 0.24, yBelt: 5.85, phase: p, arms: 'in',
      accent: AC, label: 'INTAKE',
      queue: lagFrac, over: !!(ph && ph.overThresh),
      inSwing: [0.00, 0.16], upRun: [0.08, 0.28]
    });
    transferBay({
      x: 46.30, yMachine: py1 + 0.24, yBelt: 5.85, phase: p, arms: 'out',
      accent: AC, label: 'OUTFEED',
      downRun: [0.84, 0.94], outSwing: [0.88, 1.00]
    });
  }

  /* ---- machine box -------------------------------------------------------- */

  /* Generic Factorio-style casing: concrete plinth, panelled body, coloured
     accent cap, status lamp, vent pipe, face-text, smoke and sparks. */
  function drawMachine(o) {
    /* One machine is alive at a time: mv gates every moving part, so an
       idle machine shows nothing but its standby lamp. */
    var mv = busy(o.id), t = mv ? clk : 0;
    var bx = o.x - o.w / 2;   /* west edge */
    var by = o.y - o.d / 2;   /* north edge */
    var sf = by + o.d + 0.01; /* south (viewer-facing) face y */
    var ac = ACCENT[o.id] || o.color;
    var lv = livery(o.id);

    /* ---- plinth ---- */
    Iso.box(ctx, { x: bx-0.12, y: by-0.12, z: 0, w: o.w+0.24, d: o.d+0.24, h: 0.22, color: lv.plinth });

    /* ---- body ---- */
    Iso.box(ctx, { x: bx, y: by, z: 0.22, w: o.w, d: o.d, h: o.h, color: lv.body });

    /* ---- ribbed sheet panels + glazed top band on south face ---- */
    var rows = 4, cols = 4, r, c, z0, z1, u0, u1;
    for (r = 0; r < rows; r++) {
      z0 = 0.32 + (o.h - 0.12) * ((r + 0.18) / rows);
      z1 = 0.32 + (o.h - 0.12) * ((r + 0.82) / rows);
      for (c = 0; c < cols; c++) {
        u0 = bx + o.w * ((c + 0.13) / cols);
        u1 = bx + o.w * ((c + 0.87) / cols);
        ctx.fillStyle = (r === rows - 1)
          ? GLAZE   /* glazed top band */
          : RIB;    /* ribbed joint shadow */
        Iso.poly(ctx, [P(u0, sf, z0), P(u1, sf, z0), P(u1, sf, z1), P(u0, sf, z1)]);
      }
    }

    /* ---- accent cap (flush inset) ---- */
    Iso.box(ctx, { x: bx+0.22, y: by+0.22, z: 0.22+o.h, w: o.w-0.44, d: o.d-0.44, h: 0.16, color: lv.cap });

    /* ---- vent pipe on roof (adds visible Z-depth, no sort concerns) ---- */
    Iso.cylinder(ctx, { x: bx+o.w-0.7, y: by+o.d*0.28, z: 0.22+o.h+0.16, r: 0.15, h: 0.44, color: lv.plinth });

    /* ---- status lamp — always visible (green=active, red=idle) ---- */
    var lp = mv ? (0.72 + 0.28 * Math.sin(t * 7)) : 0.65;
    ctx.fillStyle = mv
      ? 'rgba(90,210,80,'  + lp.toFixed(2) + ')'
      : 'rgba(200,55,45,0.68)';
    Iso.disc(ctx, bx+o.w-0.48, by+0.38, 0.22+o.h+0.18, 0.13);

    /* ---- service name on south face ---- */
    faceText(bx+0.30, sf, 0.38, [o.id || ''], { size: 7, color: 'rgba(20,16,10,0.55)' });

    /* ---- active effects ---- */
    if (mv) {
      puffs(o.x, by+o.d*0.28, 0.22+o.h+0.60, 4, (o.x * 7) | 0,
            { color: '#7888a8', alpha: 0.17, rise: 1.2, r1: 0.38, rate: 0.45 });
      sparks(bx+o.w-0.48, by+0.38, 0.22+o.h+0.18, 3, (o.x * 5) | 0, ac);
    }
  }

  /* ==== bespoke belt machines =============================================
   *
   * The four upstream stations have their own drawers above. These six had been
   * sharing drawMachine(), which meant six different jobs looked identical on
   * the floor. Each now carries the one mechanism that makes it recognisable —
   * the Redis counter, the four enrichments, the fingerprint drum, the batch
   * hopper, the reconciliation columns, the window bins — driven by the same
   * Sim.state fields the panel reads, so the geometry moves when the model does.
   *
   * shell() is the common plinth + panelled body + nameplate, factored out so
   * each drawer below is only its distinctive part.
   * ===================================================================== */

  function shell(o, bodyColor, bodyH) {
    var bx = o.x - o.w / 2;
    var by = o.y - o.d / 2;
    var sf = by + o.d + 0.01;      /* south = viewer-facing face */
    var h  = bodyH || o.h;
    var ac = ACCENT[o.id] || o.color;
    var lv = livery(o.id);

    /* plinth */
    Iso.box(ctx, { x: bx-0.12, y: by-0.12, z: 0, w: o.w+0.24, d: o.d+0.24,
                   h: 0.22, color: lv.plinth });
    /* body */
    Iso.box(ctx, { x: bx, y: by, z: 0.22, w: o.w, d: o.d, h: h,
                   color: bodyColor || lv.body });
    /* ribbed sheet panels, glazed top band */
    var rows = 4, cols = 4, r, c, z0, z1, u0, u1;
    for (r = 0; r < rows; r++) {
      z0 = 0.32 + (h - 0.12) * ((r + 0.18) / rows);
      z1 = 0.32 + (h - 0.12) * ((r + 0.82) / rows);
      for (c = 0; c < cols; c++) {
        u0 = bx + o.w * ((c + 0.13) / cols);
        u1 = bx + o.w * ((c + 0.87) / cols);
        ctx.fillStyle = (r === rows - 1) ? GLAZE : RIB;
        Iso.poly(ctx, [P(u0, sf, z0), P(u1, sf, z0), P(u1, sf, z1), P(u0, sf, z1)]);
      }
    }
    /* accent cap */
    Iso.box(ctx, { x: bx+0.22, y: by+0.22, z: 0.22+h, w: o.w-0.44, d: o.d-0.44,
                   h: 0.16, color: lv.cap });
    /* nameplate */
    faceText(bx+0.30, sf, 0.38, [o.id || ''], { size: 7, color: 'rgba(20,16,10,0.55)' });

    return { bx: bx, by: by, sf: sf, ac: ac, top: 0.22 + h + 0.16 };
  }

  /* ==== ec-surveillance-quota-manager — the sorting gate ===================
   *
   * What the service does (Section "ec-surveillance-quota-manager", Flow A
   * step A9, Flow B exit B3):
   *
   *   profile = mongo.samplingProfile(tenant, pipelineId, windowToken)
   *   parts   = extractParticipants(s3.get(storage))
   *   if not includedByFilters(profile, parts, direction): record("ignored"); return
   *   bucket  = bucketKey(pipelineId, populationOf(parts), direction, hourOf(sentTime))
   *   used    = redis.incr(bucket)                      // atomic across replicas
   *   limit   = round(profile.percentage / 100 * expectedVolume(bucket))
   *   sampled = used <= limit and hash(gcid) % 100 < profile.percentage
   *
   * This is where the platform decides whether a human will ever read this
   * communication, and the machine is built around the three facts that make
   * that decision what it is:
   *
   *   ONE counter    ─ redis.incr is atomic, so up to thirty-two replicas share
   *                    a single number instead of each keeping their own. The
   *                    drive shaft running from the replica rack down into the
   *                    register head is that fact: every can on the roof turns
   *                    the same wheel.
   *   TWO conditions ─ quota room AND hash admission, in series, both required.
   *                    Two latches; either one shut sends the record down the
   *                    not-sampled chute. The hash is why THIS message and not
   *                    that one, at identical settings.
   *   THREE outcomes ─ and the order matters. The profile's participant filters
   *                    run BEFORE the counter and return early, so an ignored
   *                    record never spends quota. Its chute is upstream of the
   *                    register for exactly that reason.
   *
   * The bucket keyer in the middle is the other half of the story: a quota is
   * not global. Four tumblers — pipeline, population, direction, hour — compose
   * the key of the counter that gets incremented, so "the quota" is really
   * thousands of them.
   *
   * This service also emits …quota-windows, which is what rotates the window
   * token every other machine on this floor stamps on its work.
   * ===================================================================== */

  /* Authored around a centre of (53.40, 2.00), beside the top run. It now
     stands on the turn, inside the U — so the whole assembly is shifted by
     atWorld() rather than re-deriving sixty coordinates, and only the transfer
     bays are rebuilt, because they have to reach EAST to a vertical belt
     instead of south to a horizontal one. See FLOOR-TOPOLOGY.md D6. */
  var QUOTA_DX = -0.30, QUOTA_DY = 14.30;

  function drawQuota(o, active, s) {
    atWorld(QUOTA_DX, QUOTA_DY, function () { drawQuotaBody(o, active, s); });
    drawQuotaBays(o, s);
  }

  function drawQuotaBody(o, active, s) {
    var mv = busy('quota');
    var p  = cyc('quota', 0.40);

    /* ---- cam ---- */
    var PROFILE = segLin(p, 0.04, 0.20);   /* the profile dial swings round   */
    var INCLUDE = seg(p,    0.20, 0.34);   /* participant filters             */
    var KEY     = segLin(p, 0.30, 0.48);   /* four tumblers compose the key   */
    var INCR    = seg(p,    0.50, 0.60);   /* the atomic increment            */
    var LATCH   = seg(p,    0.62, 0.74);   /* the two conditions              */
    var SORT    = segLin(p, 0.72, 0.86);   /* to the ledger or to a chute     */
    var PRINT   = segLin(p, 0.82, 0.96);   /* the CDC rows                    */

    /* ---- what the model says ---- */
    var used    = s.quotaUsed || 0;
    var limit   = Math.max(1, s.quotaLimit || 1);
    var room    = s.quotaRoom !== false;
    var hashB   = s.hashBucket || 0;
    var admits  = !!s.hashAdmits;
    var ignored = !!s.profileIgnored;
    var event   = s.quotaEvent || '';
    var sampled = !!s.sampled;
    var pct     = s.samplingPercent || 0;

    var AC = ACCENT.quota;
    var cs = casing('quota');
    var C_OK = '#5ad24e', C_NO = '#c8503c', C_IGN = '#8a8f98';

    var px0 = 49.90, px1 = 56.90, py0 = 0.70, py1 = 3.30;
    var sf   = py1 + 0.01;
    var deck = 1.66;
    var laneY = 2.30;                    /* the mechanism runs along here     */
    var i, u;

    /* =============================================== 1. casing and face ==== */
    Iso.box(ctx, { x: px0 - 0.15, y: py0 - 0.15, z: 0, w: (px1 - px0) + 0.30,
                   d: (py1 - py0) + 0.30, h: 0.26, color: cs.plinth });
    Iso.box(ctx, { x: px0, y: py0, z: 0.26, w: px1 - px0, d: py1 - py0,
                   h: deck - 0.26, color: cs.body });

    /* Two chutes hang off this face — ignored at x 50.62-51.32, not-sampled at
       54.30-55.10 — and south is left on screen, so they hide face
       50.05-51.32 and 53.75-55.10. The instruments go in the gaps. */
    ribs(px0 + 0.10, px1 - 0.10, sf, 0.34, 1.18, 16);
    louvres(px0 + 0.08, sf, 0.42, 0.34, 0.86, 5);
    bolts(px0 + 0.12, px1 - 0.12, sf, 1.52, 18);
    bolts(px0 + 0.12, px1 - 0.12, sf, 0.32, 18);
    plate(px0, sf, 1.54, px1 - px0, 0.05, 'rgba(0,0,0,0.42)');

    readout(px0 + 1.55, sf, 0.44, 2.12, 0.86, [
      'BUCKET ' + (s.bucketKey || '—'),
      'INCR   ' + used + ' / ' + limit,
      'HASH   ' + hashB + ' < ' + pct + (admits ? '  admit' : '  reject')
    ], { size: 5.0, color: sampled ? '#78cff2' : '#f2b978' });

    readout(px0 + 5.35, sf, 0.44, 1.42, 0.60, [
      event || '—',
      sampled ? '→ alerting' : '→ audit only'
    ], { size: 5.0, color: sampled ? '#9be89b' : '#f2b978' });

    /* deck */
    Iso.box(ctx, { x: px0 - 0.07, y: py0 - 0.07, z: deck - 0.14,
                   w: (px1 - px0) + 0.14, d: (py1 - py0) + 0.14, h: 0.14, color: cs.kerb });
    Iso.box(ctx, { x: px0 + 0.12, y: py0 + 0.12, z: deck - 0.03,
                   w: (px1 - px0) - 0.24, d: (py1 - py0) - 0.24, h: 0.03, color: cs.tray });
    /* this is the one machine that diverts, so its deck edge is fully banded */
    hazardStrip(px0 + 0.16, px1 - 0.16, py1 + 0.08, deck - 0.13, 0.13, 0.22);

    /* the mechanism rail */
    Iso.box(ctx, { x: px0 + 0.30, y: laneY - 0.30, z: deck, w: (px1 - px0) - 0.60,
                   d: 0.07, h: 0.10, color: M.iron });
    Iso.box(ctx, { x: px0 + 0.30, y: laneY + 0.23, z: deck, w: (px1 - px0) - 0.60,
                   d: 0.07, h: 0.10, color: M.iron });

    /* ======================================== 2. the sampling profile ==== */
    var dlx = 50.52;
    Iso.box(ctx, { x: dlx - 0.42, y: laneY - 0.44, z: deck, w: 0.84, d: 0.88, h: 0.30,
                   color: M.iron });
    Iso.cylinder(ctx, { x: dlx, y: laneY, z: deck + 0.30, r: 0.34, h: 0.14,
                        color: M.steelD, ring: 0.5 });
    /* the dial face: the required review percentage for this queue */
    ctx.fillStyle = 'rgba(10,13,16,0.92)';
    Iso.disc(ctx, dlx, laneY, deck + 0.45, 0.30);
    ctx.fillStyle = Iso.rgba(AC, 0.85);
    Iso.disc(ctx, dlx, laneY, deck + 0.46, 0.30 * Math.min(1, pct / 100) + 0.03);
    Iso.gear(ctx, dlx, laneY, deck + 0.47, 0.33, 12,
             mv ? 0.4 + PROFILE * 1.2 : 0.4, Iso.shade(M.brass, mv ? 1.0 : 0.62));
    floorText(dlx - 0.50, laneY + 0.52, deck + 0.04, ['PROFILE ' + pct + '%'],
              { size: 3.6, color: 'rgba(226,236,250,0.44)' });

    /* ============================ 3. participant filters, before the counter ==== */
    var isx = 50.98;
    Iso.box(ctx, { x: isx - 0.07, y: laneY - 0.44, z: deck, w: 0.14, d: 0.14,
                   h: 0.80, color: M.iron });
    Iso.box(ctx, { x: isx - 0.07, y: laneY + 0.32, z: deck, w: 0.14, d: 0.14,
                   h: 0.80, color: M.iron });
    Iso.box(ctx, { x: isx - 0.13, y: laneY - 0.48, z: deck + 0.80, w: 0.26, d: 0.94,
                   h: 0.13, color: M.steelD });
    var ish = 0.56 * (mv ? INCLUDE : 0) * (ignored ? 1 : 0.30);
    Iso.box(ctx, { x: isx - 0.05, y: laneY - 0.36, z: deck + 0.80 - ish, w: 0.10,
                   d: 0.72, h: Math.max(0.04, ish),
                   color: Iso.rgba(ignored ? C_IGN : C_OK, 0.85) });
    floorText(isx - 0.34, laneY + 0.60, deck + 0.04, ['IN SCOPE?'],
              { size: 3.6, color: 'rgba(226,236,250,0.44)' });

    /* ================================= 4. the bucket keyer: four tumblers ==== */
    /* A quota is not global. pipeline · population · direction · hour. */
    var kx = 51.74;
    Iso.box(ctx, { x: kx - 0.12, y: laneY - 0.36, z: deck, w: 1.42, d: 0.72, h: 0.16,
                   color: M.ironD });
    for (i = 0; i < 4; i++) {
      u = kx + i * 0.34;
      Iso.cylinder(ctx, { x: u, y: laneY, z: deck + 0.16, r: 0.14, h: 0.34,
                          color: i % 2 ? M.steel : M.steelD, ring: 0.45 });
      Iso.gear(ctx, u, laneY, deck + 0.51, 0.15, 8,
               mv ? KEY * (3.0 + i * 0.9) : 0.2 + i * 0.3,
               Iso.rgba(AC, mv && KEY > 0 && KEY < 1 ? 0.95 : 0.45));
    }
    floorText(kx - 0.16, laneY + 0.48, deck + 0.04, ['BUCKET KEY'],
              { size: 3.6, color: 'rgba(226,236,250,0.44)' });

    /* ================================= 5. ONE counter, every replica on it ==== */
    var cxr = 53.52;
    Iso.box(ctx, { x: cxr - 0.36, y: laneY - 0.40, z: deck, w: 0.72, d: 0.80, h: 0.22,
                   color: M.ironD });
    /* the register: a column that fills toward the bucket's limit */
    gaugeCol(cxr - 0.22, laneY - 0.22, deck + 0.22, 0.44, 1.02,
             used / limit, room ? AC : C_NO,
             { ceiling: 1.0, max: 1.10, over: C_NO, track: '#3a3222' });
    /* the increment head, driven from the replica rack above */
    var headZ = deck + 1.30 - (mv ? INCR : 0) * 0.16;
    Iso.box(ctx, { x: cxr - 0.26, y: laneY - 0.26, z: headZ, w: 0.52, d: 0.52, h: 0.18,
                   color: '#aab4be' });
    /* THE drive shaft: thirty-two replicas, one wheel */
    Iso.box(ctx, { x: cxr - 0.05, y: 1.16, z: deck + 1.30, w: 0.10, d: laneY - 1.42,
                   h: 0.10, color: M.steel });
    Iso.gear(ctx, cxr, 1.16, deck + 1.36, 0.20, 10,
             mv ? INCR * 5.0 : 0.3, mv ? M.brass : Iso.shade(M.brass, 0.62));
    faceText(cxr - 0.34, laneY + 0.42, deck + 1.24, ['ATOMIC'],
             { size: 3.6, color: 'rgba(240,192,64,0.70)' });

    /* ================================ 6. the two latches, both required ==== */
    var l1 = 54.34, l2 = 54.96;
    function latch(x, ok, label) {
      Iso.box(ctx, { x: x - 0.07, y: laneY - 0.42, z: deck, w: 0.14, d: 0.14,
                     h: 0.74, color: M.iron });
      Iso.box(ctx, { x: x - 0.07, y: laneY + 0.30, z: deck, w: 0.14, d: 0.14,
                     h: 0.74, color: M.iron });
      Iso.box(ctx, { x: x - 0.13, y: laneY - 0.46, z: deck + 0.74, w: 0.26, d: 0.90,
                     h: 0.13, color: M.steelD });
      /* open when the condition passes: a shut latch is the one that stopped it */
      var drop = ok ? 0.10 : 0.58;
      Iso.box(ctx, { x: x - 0.05, y: laneY - 0.34, z: deck + 0.74 - drop * (mv ? LATCH : 1),
                     w: 0.10, d: 0.68, h: Math.max(0.05, drop * (mv ? LATCH : 1)),
                     color: Iso.rgba(ok ? C_OK : C_NO, 0.88) });
      floorText(x - 0.30, laneY + 0.58, deck + 0.04, [label],
                { size: 3.4, color: ok ? 'rgba(150,224,140,0.50)' : 'rgba(224,120,100,0.60)' });
    }
    latch(l1, room,   'QUOTA');
    latch(l2, admits, 'HASH');

    /* ============================ 7. the CDC ledger: three outbox tracks ==== */
    /* This service never publishes directly. It writes rows and Debezium picks
       them up — surveilled-communication-outbox, metadata-outbox, quota-windows
       — so it gets a ledger and a pickup head rather than an outfeed arm. */
    var lx0 = 55.42, lx1 = 56.76;
    Iso.box(ctx, { x: lx0 - 0.10, y: laneY - 0.56, z: deck, w: (lx1 - lx0) + 0.20,
                   d: 1.12, h: 0.14, color: M.ironD });
    var TRACKS = ['surveilled-comm', 'metadata', 'quota-windows'];
    for (i = 0; i < 3; i++) {
      var ty = laneY - 0.46 + i * 0.34;
      quad([[lx0, ty, deck + 0.15], [lx1, ty, deck + 0.15],
            [lx1, ty + 0.26, deck + 0.15], [lx0, ty + 0.26, deck + 0.15]], '#cdc7b6');
      for (var k = 0; k < 5; k++) {
        var rowU = lx0 + 0.12 + k * 0.24 + (mv ? PRINT : 0) * 0.24;
        if (rowU > lx1 - 0.10) continue;
        quad([[rowU, ty + 0.04, deck + 0.155], [rowU + 0.08, ty + 0.04, deck + 0.155],
              [rowU + 0.08, ty + 0.22, deck + 0.155], [rowU, ty + 0.22, deck + 0.155]],
             (k === 0 && mv && PRINT > 0.1 && (i === 2 || sampled))
               ? '#2f6ea8' : 'rgba(58,56,50,0.72)');
      }
    }
    /* the pickup head straddles all three tracks at once */
    Iso.box(ctx, { x: 56.30, y: laneY - 0.60, z: deck + 0.15, w: 0.13, d: 0.13,
                   h: 0.42, color: M.iron });
    Iso.box(ctx, { x: 56.30, y: laneY + 0.50, z: deck + 0.15, w: 0.13, d: 0.13,
                   h: 0.42, color: M.iron });
    Iso.box(ctx, { x: 56.22, y: laneY - 0.64, z: deck + 0.57, w: 0.29, d: 1.28,
                   h: 0.14, color: M.steelD });
    ctx.fillStyle = mv ? 'rgba(120,235,160,' + (0.32 + 0.48 * PRINT).toFixed(2) + ')'
                       : 'rgba(58,108,78,0.30)';
    Iso.poly(ctx, [P(56.34, laneY - 0.46, deck + 0.16), P(56.41, laneY - 0.46, deck + 0.16),
                   P(56.41, laneY + 0.48, deck + 0.16), P(56.34, laneY + 0.48, deck + 0.16)]);
    floorText(lx0 - 0.06, laneY + 0.70, deck + 0.04, ['CDC · 3 outboxes'],
              { size: 3.4, color: 'rgba(140,230,175,0.50)' });

    /* ==================================== 8. the two reject chutes ==== */
    function chute(cx0, cx1, filled, tint, label) {
      quad([[cx0, py1, 1.10], [cx1, py1, 1.10], [cx1, 3.86, 0.62], [cx0, 3.86, 0.62]], '#3d434b');
      quad([[cx0, py1, 1.10], [cx0, 3.86, 0.62], [cx0, 3.86, 0.44], [cx0, py1, 0.92]], '#2b3036');
      quad([[cx1, py1, 1.10], [cx1, 3.86, 0.62], [cx1, 3.86, 0.44], [cx1, py1, 0.92]], '#23272c');
      Iso.box(ctx, { x: cx0 - 0.13, y: 3.84, z: 0, w: (cx1 - cx0) + 0.26, d: 0.78,
                     h: 0.55, color: '#3b414a' });
      quad([[cx0 - 0.05, 3.92, 0.55], [cx1 + 0.05, 3.92, 0.55],
            [cx1 + 0.05, 4.54, 0.55], [cx0 - 0.05, 4.54, 0.55]],
           filled ? Iso.shade(tint, 0.42) : '#15181c');
      stencil(cx0 - 0.16, 4.63, 0.30, label,
              { size: 3.8, color: 'rgba(228,224,214,0.46)' });
    }
    chute(50.62, 51.32, ignored, C_IGN, 'ignored');
    chute(54.30, 55.10, !sampled && !ignored, C_NO, 'not-sampled');
    if (mv && ignored && INCLUDE > 0.3 && INCLUDE < 1) chips(50.97, 3.46, 1.22, 5, 83, C_IGN);
    if (mv && !sampled && !ignored && LATCH > 0.3 && LATCH < 1) chips(54.70, 3.46, 1.22, 5, 89, C_NO);

    /* ============================================ 9. receipt and rack ==== */
    receiptDuct(57.40, 4.55, {
      phase: p, drop: [0.86, 0.97],
      accent: sampled ? '#8fd6a0' : '#e0a040',
      label: 'audit · ' + (event || 'surveilled')
    });

    /* Thirty-two of them, and the shaft above the register says they all turn
       the same wheel. Racked two deep on the north kerb so the drive line from
       the rack to the counter head is a straight run. */
    replicaStack(px1 - 0.34, py0 + 0.14, deck,
                 phaseFor(s.plan || Sim.planNow(), 'quota'),
                 { cols: 16, pitch: 0.22, max: 32 });

  }

  /* The bays are placed against the machine's NEW surroundings, so they sit
     outside the atWorld() shift and use absolute floor coordinates. The belt on
     the turn runs south at x 60, west edge 58.7; the machine's east face lands
     at 56.6 once shifted. Travel is southward, so `flow: 's'` — the intake arm
     reaches east-and-north to the upstream segment, the outfeed east-and-south
     to the downstream one. */
  function drawQuotaBays(o, s) {
    var p  = cyc('quota', 0.40);
    var ph = phaseFor(s.plan || Sim.planNow(), 'quota');
    var lagFrac = ph ? Math.min(1, ph.lag / Math.max(1, ph.lagThresh)) : 0;
    var AC = ACCENT.quota;

    transferBay({
      axis: 'x', flow: 's', y: 15.55, xMachine: 56.85, xBelt: 58.60,
      phase: p, arms: 'in', accent: AC, label: 'INTAKE',
      queue: lagFrac, over: !!(ph && ph.overThresh),
      inSwing: [0.00, 0.16], upRun: [0.06, 0.26]
    });
    transferBay({
      axis: 'x', flow: 's', y: 17.35, xMachine: 56.85, xBelt: 58.60,
      phase: p, arms: 'out', accent: AC,
      label: s.sampled ? 'SAMPLED' : 'AUDIT ONLY',
      downRun: [0.84, 0.94], outSwing: [0.88, 1.00]
    });
  }

  /* ==== ec-alerting-service — the assembly bench ===========================
   *
   * What the service does (Section "ec-alerting-service", Flow A step A11):
   *
   *   parts = parallel(s3.getBody(storage),
   *                    queueQualifier.populations(tenant, wt, pipelineIds),
   *                    filterApi.policyInfo(tenant, wt, pipelineIds),
   *                    eaStorage.scenarioHits(gcid))
   *   for pipelineId in event.pipelineIds:          // one alert per pipeline
   *     item = buildSupervisedItem(event, parts, initialStateFor(pipelineId))
   *     parallel(mongo.upsert(supervisedItems, item),
   *              mongo.insert(alertOutbox, {itemKey: item.key}))
   *   onEchoAction(a): mongo.update(supervisedItems, a.itemKey, {state, echoOf})
   *                    mongo.insert(echoOutbox, a)
   *
   * An alert is ASSEMBLED, not recorded — which is why this is a bench and not
   * a press. Four things arrive at once from four different places, they are
   * built onto the event, and what leaves is a document a human will read.
   *
   *   four feeds     ─ and they run in parallel, so the station costs the
   *                    SLOWEST of them rather than their sum. Each is coloured
   *                    for where it comes from: the message body from S3, and
   *                    three REST calls to other machines on this floor —
   *                    populations from ec-queue-qualifier, policy detail from
   *                    ec-surveillance-filter, scenario hits from EA Storage.
   *                    Drag Doc and watch which feed becomes the bottleneck.
   *   the bench      ─ one SupervisedItem per qualified pipeline.
   *   twin presses   ─ the item and its outbox row are written IN PARALLEL, and
   *                    a partial failure can leave a supervised item that was
   *                    never announced. The outbox is the source of truth for
   *                    publication, and it is the press marked as such.
   *   the rack       ─ finished items waiting for a reviewer.
   *   echo return    ─ ec-echo-engine is downstream, and its verdicts come back
   *                    to re-stamp items already on the rack. That return runs
   *                    along the south apron, on the opposite side from the
   *                    belt, because it travels against the flow.
   *   blanked duct   ─ THE ABSENCE. Every other machine on the belt drops a
   *                    receipt to ec-centralised-audit. This one produces no
   *                    audit event at all; its accounting arrives second-hand
   *                    through echo and the indexer. The pad is there and the
   *                    plate is bolted over it, which is a deliberate decision
   *                    rather than an omission. See FLOOR-TOPOLOGY.md §1a.
   *
   * Its lagThreshold is 1000, the loosest on the floor: it is allowed to fall a
   * long way behind before KEDA reacts. At high ingest every other machine's
   * replica rack grows and this one stays at three.
   * ===================================================================== */

  function drawAlerting(o, active, s) {
    var mv = busy('alerting');
    var p  = cyc('alerting', 0.40);

    /* ---- cam ---- */
    var FETCH = segLin(p, 0.06, 0.34);   /* four enrichments, at once        */
    var BUILD = seg(p,    0.34, 0.52);   /* the bench assembles an item      */
    var STAMP = seg(p,    0.54, 0.66);   /* both writes, together            */
    var RACK  = segLin(p, 0.64, 0.78);   /* onto the rack                    */
    var PRINT = segLin(p, 0.74, 0.90);   /* CDC rows, then the pickup        */
    var ECHOA = seg(p,    0.82, 0.94);   /* an echo verdict re-stamps one    */

    /* ---- what the model says ---- */
    var alerts = s.alertsCreated || 0;
    var shown  = Math.min(6, alerts);
    var s3ms   = s.enrichS3Ms || 0;
    var restms = s.enrichRestMs || 0;
    var payms  = s.enrichMs || 0;
    var slow   = s.enrichSlowest || '—';

    var AC = ACCENT.alerting;
    var cs = casing('alerting');

    var px0 = 50.20, px1 = 57.80, py0 = 34.70, py1 = 37.30;
    var sf   = py1 + 0.01;
    var deck = 1.66;
    var line = 35.45;                    /* the production lane              */
    var ldg  = 36.72;                    /* the ledger lane                  */
    var i, u;

    /* the four enrichments, coloured for where each comes from */
    var FEED = [
      { c: '#7fb4d8', n: 'S3 body'   },
      { c: '#9a88e0', n: 'populations' },
      { c: '#e0b840', n: 'policy'    },
      { c: '#6fb894', n: 'scenarios' }
    ];

    /* =============================================== 1. casing and face ==== */
    Iso.box(ctx, { x: px0 - 0.15, y: py0 - 0.15, z: 0, w: (px1 - px0) + 0.30,
                   d: (py1 - py0) + 0.30, h: 0.26, color: cs.plinth });
    Iso.box(ctx, { x: px0, y: py0, z: 0.26, w: px1 - px0, d: py1 - py0,
                   h: deck - 0.26, color: cs.body });

    /* nothing hangs off this face — no reject chute — so the whole width is
       available for instruments */
    ribs(px0 + 0.10, px1 - 0.10, sf, 0.34, 1.18, 17);
    louvres(px0 + 0.08, sf, 0.42, 0.34, 0.86, 5);
    bolts(px0 + 0.12, px1 - 0.12, sf, 1.52, 19);
    bolts(px0 + 0.12, px1 - 0.12, sf, 0.32, 19);
    plate(px0, sf, 1.54, px1 - px0, 0.05, 'rgba(0,0,0,0.42)');

    readout(px0 + 0.28, sf, 0.44, 2.70, 0.86, [
      'S3   ' + EC.fmtMs(s3ms),
      'REST ' + EC.fmtMs(restms),
      'PAY  ' + EC.fmtMs(payms) + '  ' + slow
    ], { size: 5.0 });

    readout(px0 + 3.90, sf, 0.44, 3.20, 0.86, [
      alerts + ' alert' + (alerts === 1 ? '' : 's') + ' · one per pipeline',
      'lagThreshold 1000',
      'loosest on the floor'
    ], { size: 5.0, color: alerts ? '#9be89b' : '#f2b978' });

    /* deck */
    Iso.box(ctx, { x: px0 - 0.07, y: py0 - 0.07, z: deck - 0.14,
                   w: (px1 - px0) + 0.14, d: (py1 - py0) + 0.14, h: 0.14, color: cs.kerb });
    Iso.box(ctx, { x: px0 + 0.12, y: py0 + 0.12, z: deck - 0.03,
                   w: (px1 - px0) - 0.24, d: (py1 - py0) - 0.24, h: 0.03, color: cs.tray });
    hazardStrip(px0 + 0.16, px1 - 0.16, py1 + 0.08, deck - 0.13, 0.11, 0.24);

    /* ===================================== 2. four feeds, all at once ==== */
    var fx = 50.58;
    Iso.box(ctx, { x: fx - 0.16, y: line - 0.52, z: deck, w: 1.42, d: 1.04, h: 0.34,
                   color: M.iron });
    for (i = 0; i < 4; i++) {
      u = fx + i * 0.36;
      /* the lateral in from the north face */
      pipe(u, py0 - 0.86, u, py0 + 0.10, 1.16, 0.15,
           mv && FETCH > 0 && FETCH < 1 ? Iso.mix(M.steelD, FEED[i].c, 0.55) : M.steelD);
      /* the collar on the deck */
      Iso.cylinder(ctx, { x: u, y: line - 0.14, z: deck + 0.34, r: 0.11, h: 0.18,
                          color: mv && FETCH > 0 && FETCH < 1
                                 ? FEED[i].c : Iso.shade(FEED[i].c, 0.55) });
      /* all four pips travel together — that is the whole point */
      if (mv && FETCH > 0 && FETCH < 1) {
        ctx.fillStyle = Iso.rgba(FEED[i].c, 0.92);
        Iso.disc(ctx, u, py0 - 0.86 + FETCH * 0.96, 1.34, 0.09);
      }
    }
    floorText(fx - 0.20, line + 0.56, deck + 0.04, ['4 ENRICHMENTS · AT ONCE'],
              { size: 3.6, color: 'rgba(226,236,250,0.42)' });

    /* ============================================ 3. the assembly bench ==== */
    var bx = 53.40;
    Iso.box(ctx, { x: bx - 0.86, y: line - 0.46, z: deck, w: 1.72, d: 0.92, h: 0.16,
                   color: M.steelD });
    for (i = 0; i < 4; i++) {
      Iso.box(ctx, { x: bx - 0.78 + (i % 2) * 1.48, y: line - 0.38 + ((i / 2) | 0) * 0.68,
                     z: deck + 0.16, w: 0.12, d: 0.12, h: 0.62, color: M.iron });
    }
    Iso.box(ctx, { x: bx - 0.84, y: line - 0.44, z: deck + 0.78, w: 1.68, d: 0.88,
                   h: 0.13, color: M.ironD });
    /* the head that builds the item */
    var headZ = deck + 0.78 - (mv ? BUILD : 0) * 0.44;
    Iso.box(ctx, { x: bx - 0.34, y: line - 0.28, z: headZ, w: 0.68, d: 0.56, h: 0.20,
                   color: '#aab4be' });
    /* the item taking shape under it */
    if (mv && BUILD > 0.1) {
      Iso.box(ctx, { x: bx - 0.28, y: line - 0.22, z: deck + 0.16, w: 0.56, d: 0.44,
                     h: 0.05 + 0.10 * BUILD, color: Iso.mix(PAPER.full, AC, 0.30) });
    }
    floorText(bx - 0.82, line + 0.56, deck + 0.04, ['BUILD SUPERVISED ITEM'],
              { size: 3.6, color: 'rgba(226,236,250,0.44)' });

    /* ================== 4. the two writes, in parallel, one authoritative ==== */
    /* A partial failure here leaves an item nobody was told about, so the
       outbox — not the item store — is the source of truth. */
    var wx = 55.20;
    for (i = 0; i < 2; i++) {
      u = wx + i * 0.74;
      Iso.box(ctx, { x: u - 0.28, y: line - 0.38, z: deck, w: 0.56, d: 0.76, h: 0.14,
                     color: M.steelD });
      Iso.box(ctx, { x: u - 0.24, y: line - 0.34, z: deck + 0.86, w: 0.48, d: 0.68,
                     h: 0.12, color: M.ironD });
      Iso.box(ctx, { x: u - 0.10, y: line - 0.10, z: deck + 0.14, w: 0.20, d: 0.20,
                     h: 0.72, color: M.iron });
      /* both heads fall together */
      var pz = deck + 0.72 - (mv ? STAMP : 0) * 0.40;
      Iso.box(ctx, { x: u - 0.22, y: line - 0.32, z: pz, w: 0.44, d: 0.64, h: 0.16,
                     color: i === 1 ? M.brass : '#aab4be' });
    }
    floorText(wx - 0.34, line + 0.52, deck + 0.04, ['ITEM'],
              { size: 3.4, color: 'rgba(226,236,250,0.40)' });
    floorText(wx + 0.42, line + 0.52, deck + 0.04, ['OUTBOX · truth'],
              { size: 3.4, color: 'rgba(208,176,80,0.60)' });

    /* ================================== 5. the rack of finished alerts ==== */
    var rx = 56.42;
    if (shown > 0) {
      var fills = [];
      for (i = 0; i < shown; i++) fills.push(mv ? Math.min(1, RACK * 1.2) : 0.85);
      binRow(rx, line - 0.34, deck, shown, fills, {
        w: (1.20 - (shown - 1) * 0.05) / shown, d: 0.68, h: 0.44, gap: 0.05,
        color: M.iron, fill: Iso.mix(PAPER.full, AC, 0.35)
      });
    }
    floorText(rx - 0.06, line + 0.48, deck + 0.04, ['SUPERVISED ITEMS'],
              { size: 3.4, color: 'rgba(226,236,250,0.40)' });

    /* ============================ 6. the CDC ledger: two outbox tracks ==== */
    var lx0 = 52.60, lx1 = 57.40;
    Iso.box(ctx, { x: lx0 - 0.10, y: ldg - 0.42, z: deck, w: (lx1 - lx0) + 0.20,
                   d: 0.84, h: 0.13, color: M.ironD });
    var TRACK = ['alert-outbox', 'echo-outbox'];
    for (i = 0; i < 2; i++) {
      var ty = ldg - 0.34 + i * 0.36;
      quad([[lx0, ty, deck + 0.14], [lx1, ty, deck + 0.14],
            [lx1, ty + 0.28, deck + 0.14], [lx0, ty + 0.28, deck + 0.14]], '#cdc7b6');
      for (var k = 0; k < 6; k++) {
        var rowU = lx0 + 0.14 + k * 0.24 + (mv ? PRINT : 0) * 0.24;
        if (rowU > lx1 - 0.10) continue;
        quad([[rowU, ty + 0.05, deck + 0.145], [rowU + 0.08, ty + 0.05, deck + 0.145],
              [rowU + 0.08, ty + 0.23, deck + 0.145], [rowU, ty + 0.23, deck + 0.145]],
             (k === 0 && mv && PRINT > 0.1 && (i === 0 || ECHOA > 0.2))
               ? '#2f6ea8' : 'rgba(58,56,50,0.72)');
      }
    }
    Iso.box(ctx, { x: 56.86, y: ldg - 0.46, z: deck + 0.14, w: 0.12, d: 0.12,
                   h: 0.40, color: M.iron });
    Iso.box(ctx, { x: 56.86, y: ldg + 0.34, z: deck + 0.14, w: 0.12, d: 0.12,
                   h: 0.40, color: M.iron });
    Iso.box(ctx, { x: 56.78, y: ldg - 0.50, z: deck + 0.54, w: 0.28, d: 0.96,
                   h: 0.13, color: M.steelD });
    ctx.fillStyle = mv ? 'rgba(120,235,160,' + (0.32 + 0.48 * PRINT).toFixed(2) + ')'
                       : 'rgba(58,108,78,0.30)';
    Iso.poly(ctx, [P(56.90, ldg - 0.30, deck + 0.15), P(56.97, ldg - 0.30, deck + 0.15),
                   P(56.97, ldg + 0.28, deck + 0.15), P(56.90, ldg + 0.28, deck + 0.15)]);
    floorText(lx0 - 0.04, ldg + 0.56, deck + 0.04, ['CDC · 2 outboxes'],
              { size: 3.4, color: 'rgba(140,230,175,0.50)' });

    /* ================================ 7. the echo return, against the flow ==== */
    /* ec-echo-engine sits downstream and its verdicts come BACK to re-stamp
       items already on the rack. Routed along the south apron so it is plainly
       not part of the westward flow on the belt. */
    /* Low, and clear of the face: at z 0.62 this ran straight across the
       readouts, because a pipe south of a casing projects UP over it. */
    pipe(47.60, 37.95, 57.10, 37.95, 0.30, 0.17,
         mv && ECHOA > 0 && ECHOA < 1 ? Iso.mix(M.steelD, '#a870d8', 0.5) : M.steelD);
    Iso.box(ctx, { x: 56.94, y: 37.78, z: 0.30, w: 0.34, d: 0.34, h: 0.30, color: M.iron });
    pipe(57.10, 37.95, 57.10, py1 + 0.06, 0.30, 0.15,
         mv && ECHOA > 0.4 ? Iso.mix(M.steelD, '#a870d8', 0.5) : M.steelD);
    floorText(47.70, 38.32, 0.03, ['echoAction · re-stamps a finished item'],
              { size: 3.6, color: 'rgba(168,112,216,0.52)' });
    if (mv && ECHOA > 0 && ECHOA < 1) {
      ctx.fillStyle = Iso.rgba('#c8a0f0', 0.9);
      Iso.disc(ctx, 57.10 - (1 - ECHOA) * 9.5, 37.95, 0.46, 0.11);
    }

    /* ======================= 8. the duct that is deliberately blanked off ==== */
    /* Seven machines drop a receipt to ec-centralised-audit. This one does not
       produce an audit event at all, so the pad is here and the plate is bolted
       over it. An absence you can see is worth more than one you cannot. */
    var dx = 54.00, dy = 38.85;
    Iso.box(ctx, { x: dx - 0.42, y: dy - 0.34, z: 0, w: 0.84, d: 0.68, h: 0.11,
                   color: M.ironD });
    Iso.box(ctx, { x: dx - 0.34, y: dy - 0.26, z: 0.11, w: 0.68, d: 0.52, h: 0.05,
                   color: '#6a6f76' });
    for (i = 0; i < 4; i++) {
      ctx.fillStyle = 'rgba(232,238,246,0.30)';
      Iso.disc(ctx, dx - 0.24 + (i % 2) * 0.48, dy - 0.16 + ((i / 2) | 0) * 0.32,
               0.17, 0.045);
    }
    floorText(dx - 0.46, dy + 0.46, 0.03, ['NO AUDIT EVENT — BLANKED'],
              { size: 3.4, color: 'rgba(226,236,250,0.34)' });

    /* ============================================ 9. lamp and replicas ==== */
    lamp(px1 - 0.30, py0 + 0.30, deck + 0.10, 0.12, mv, '#5ad24e');
    replicaStack(px1 - 0.34, py0 + 0.14, deck,
                 phaseFor(s.plan || Sim.planNow(), 'alerting'),
                 { cols: 12, pitch: 0.24, max: 32 });

    /* ============================================== 10. transfer bays ==== */
    /* The middle run travels WEST, so upstream is east: flow 'w'. */
    var ph = phaseFor(s.plan || Sim.planNow(), 'alerting');
    var lagFrac = ph ? Math.min(1, ph.lag / Math.max(1, ph.lagThresh)) : 0;

    transferBay({
      x: 53.00, yMachine: py0 - 0.25, yBelt: 30.20, phase: p, arms: 'in',
      flow: 'w', accent: AC, label: 'INTAKE',
      queue: lagFrac, over: !!(ph && ph.overThresh),
      inSwing: [0.00, 0.16], upRun: [0.06, 0.28]
    });
    transferBay({
      x: 56.80, yMachine: py0 - 0.25, yBelt: 30.20, phase: p, arms: 'out',
      flow: 'w', accent: AC, label: 'ALERTED',
      downRun: [0.80, 0.92], outSwing: [0.86, 1.00]
    });
  }

  /* ==== ec-echo-engine — the card-index comparator =========================
   *
   * What the service does (Section "ec-echo-engine", Flow A step A13):
   *
   *   groups = messages.groupBy(m -> m.pipelineId + "|" + m.alertThreadId)
   *   for g in groups: runOnVirtualThread(() -> process(g))
   *   process(g): for alert in g:
   *     fingerprint = md5(sortedPolicyHitIds(alert))   // content NEVER compared
   *     mongo.upsert(echoState, key(pipelineId, alertThreadId, fingerprint), …)
   *     if not (alert.isCreate and allPoliciesEchoEnabled(alert)): continue
   *     candidates = echoState within 14 days on the same key
   *     if earlier.nonEmpty: close(alert, earlier.oldest())
   *     else if later.nonEmpty: close(later.newest(), alert)   // late arrival
   *
   * On a long thread re-scanned after every reply, the same scenario would
   * raise an alert for every message. This station stops that — and the way it
   * stops it is the interesting part:
   *
   *   the sorter    ─ a batch of ten, grouped by pipeline and thread, one
   *                   worker per group, so one thread's alerts are handled in
   *                   order. Three lanes stand for that grouping.
   *   the press     ─ the policy-hit tags are SORTED and then hashed. Sorted,
   *                   because the same hits arriving in a different order must
   *                   give the same 32 characters. The body port beside it is
   *                   capped and stencilled: this machine never opens the
   *                   document, and comparing content is not what it does.
   *   the card file ─ ec-echo-engine-state, keyed pipeline|thread|fingerprint,
   *                   TTL fourteen days. The card is filed BEFORE the
   *                   comparison runs, not after — so a crash between the two
   *                   leaves a candidate with no action, and the next alert on
   *                   that thread still suppresses correctly. The order of
   *                   those two operations IS the failure mode.
   *   the verdict   ─ three lamps, because there are three answers. Nothing
   *                   earlier: new. Something earlier: this alert closes.
   *                   Something LATER: the later one is closed instead, which
   *                   is how a late arrival is handled — the alert already
   *                   published gets reclassified rather than this one.
   *
   * It publishes nothing onto the belt. Its answer goes back east to
   * ec-alerting-service as an echoAction, and its receipt goes down the trench.
   * The missing outfeed bay is not an omission.
   * ===================================================================== */

  function drawEcho(o, active, s) {
    var mv = busy('echo');
    var p  = cyc('echo', 0.40);

    /* ---- cam ---- */
    var BATCH  = segLin(p, 0.04, 0.22);   /* ten in, grouped into lanes      */
    var HITS   = segLin(p, 0.20, 0.38);   /* hit tags collected and sorted   */
    var STAMP  = seg(p,    0.40, 0.52);   /* the digest pressed              */
    var FILE   = seg(p,    0.52, 0.62);   /* filed FIRST                     */
    var LOOKUP = segLin(p, 0.62, 0.78);   /* candidates inside the window    */
    var VERD   = seg(p,    0.76, 0.88);
    var SEND   = segLin(p, 0.84, 0.96);   /* echoAction east                 */

    /* ---- what the model says ---- */
    var fp      = s.fingerprint || '--------';
    var priors  = s.echoPriors || 0;
    var outcome = s.echoOutcome || 'new';
    var isEcho  = outcome !== 'new';
    var late    = outcome === 'late-arrival';

    var AC = ACCENT.echo;
    var cs = casing('echo');
    var C_NEW = '#5ad24e', C_ECHO = '#e0603c', C_LATE = '#e0a040';
    var verdColour = late ? C_LATE : isEcho ? C_ECHO : C_NEW;

    var px0 = 40.50, px1 = 47.50, py0 = 34.70, py1 = 37.30;
    var sf   = py1 + 0.01;
    var deck = 1.66;
    var line = 35.55;
    var i, u;

    /* =============================================== 1. casing and face ==== */
    Iso.box(ctx, { x: px0 - 0.15, y: py0 - 0.15, z: 0, w: (px1 - px0) + 0.30,
                   d: (py1 - py0) + 0.30, h: 0.26, color: cs.plinth });
    Iso.box(ctx, { x: px0, y: py0, z: 0.26, w: px1 - px0, d: py1 - py0,
                   h: deck - 0.26, color: cs.body });

    /* nothing overhangs this face */
    ribs(px0 + 0.10, px1 - 0.10, sf, 0.34, 1.18, 16);
    louvres(px0 + 0.08, sf, 0.42, 0.34, 0.86, 5);
    bolts(px0 + 0.12, px1 - 0.12, sf, 1.52, 18);
    bolts(px0 + 0.12, px1 - 0.12, sf, 0.32, 18);
    plate(px0, sf, 1.54, px1 - px0, 0.05, 'rgba(0,0,0,0.42)');

    readout(px0 + 0.26, sf, 0.44, 3.02, 0.86, [
      'md5 ' + fp,
      priors + ' prior' + (priors === 1 ? '' : 's') + ' on this thread',
      outcome
    ], { size: 5.0, color: isEcho ? '#f2b978' : '#9be89b' });

    /* the fourteen-day window, as fourteen slots ageing left to right */
    var tx = 44.05, cell = 0.185, gap = 0.033;
    for (i = 0; i < 14; i++) {
      var held = i < Math.min(14, priors + (mv && FILE > 0.5 ? 1 : 0));
      plate(tx + i * (cell + gap), sf, 0.62, cell, 0.34,
            held ? Iso.rgba(verdColour, 0.85) : 'rgba(190,208,226,0.14)');
    }
    stencil(tx, sf, 1.12, 'ec-echo-engine-state · TTL 14d',
            { size: 4.0, color: 'rgba(222,238,255,0.46)' });

    /* deck */
    Iso.box(ctx, { x: px0 - 0.07, y: py0 - 0.07, z: deck - 0.14,
                   w: (px1 - px0) + 0.14, d: (py1 - py0) + 0.14, h: 0.14, color: cs.kerb });
    Iso.box(ctx, { x: px0 + 0.12, y: py0 + 0.12, z: deck - 0.03,
                   w: (px1 - px0) - 0.24, d: (py1 - py0) - 0.24, h: 0.03, color: cs.tray });
    hazardStrip(px0 + 0.16, px1 - 0.16, py1 + 0.08, deck - 0.13, 0.11, 0.24);

    /* ================================ 2. batch of ten, grouped into lanes ==== */
    /* max-poll-records is 10 here, not 50, and the batch is grouped by
       pipeline and thread so one thread is handled in order. */
    var gx = 40.80;
    Iso.box(ctx, { x: gx, y: line - 0.50, z: deck, w: 0.62, d: 1.00, h: 0.14,
                   color: M.ironD });
    for (i = 0; i < 10; i++) {
      var bh = (mv && BATCH > i / 10) ? PAPER.mid : 'rgba(190,208,226,0.16)';
      Iso.box(ctx, { x: gx + 0.06 + (i % 2) * 0.26, y: line - 0.44 + ((i / 2) | 0) * 0.18,
                     z: deck + 0.14, w: 0.22, d: 0.14, h: 0.05, color: bh });
    }
    /* the three lanes, one worker each */
    for (i = 0; i < 3; i++) {
      u = line - 0.34 + i * 0.34;
      Iso.box(ctx, { x: gx + 0.72, y: u - 0.06, z: deck, w: 0.80, d: 0.12, h: 0.10,
                     color: M.iron });
      Iso.gear(ctx, gx + 1.62, u, deck + 0.16, 0.11, 8,
               mv ? BATCH * (4 + i) : 0.3 + i * 0.4,
               mv && BATCH > 0 && BATCH < 1 ? AC : Iso.shade(AC, 0.5));
    }
    floorText(gx - 0.06, line + 0.60, deck + 0.04, ['10 PER POLL · GROUPED BY THREAD'],
              { size: 3.4, color: 'rgba(226,236,250,0.40)' });

    /* =========================== 3. hit tags, sorted, then the digest ==== */
    var hx = 42.90;
    Iso.box(ctx, { x: hx - 0.44, y: line - 0.42, z: deck, w: 0.88, d: 0.84, h: 0.15,
                   color: M.steelD });
    /* four tags, shuffling into order as HITS runs — sorted, because the same
       hits in a different order must give the same digest */
    for (i = 0; i < 4; i++) {
      var slot = mv ? (HITS < 1 ? (i + Math.floor(HITS * 4)) % 4 : i) : i;
      Iso.box(ctx, { x: hx - 0.36 + slot * 0.19, y: line - 0.34, z: deck + 0.15,
                     w: 0.15, d: 0.62, h: 0.07,
                     color: i % 2 ? PAPER.full : PAPER.mid });
    }
    /* the press */
    var pz = deck + 0.72 - (mv ? STAMP : 0) * 0.42;
    Iso.box(ctx, { x: hx - 0.30, y: line - 0.30, z: deck + 0.78, w: 0.60, d: 0.58,
                   h: 0.12, color: M.ironD });
    Iso.box(ctx, { x: hx - 0.24, y: line - 0.24, z: pz, w: 0.48, d: 0.46, h: 0.16,
                   color: '#aab4be' });
    /* the capped body port: content is never compared */
    Iso.cylinder(ctx, { x: hx + 0.60, y: line + 0.30, z: deck, r: 0.15, h: 0.22,
                        color: M.ironD });
    Iso.cylinder(ctx, { x: hx + 0.60, y: line + 0.30, z: deck + 0.22, r: 0.18, h: 0.07,
                        color: '#6a6f76' });
    floorText(hx - 0.48, line + 0.60, deck + 0.04, ['SORT · MD5 · BODY PORT CAPPED'],
              { size: 3.4, color: 'rgba(226,236,250,0.40)' });

    /* ================= 4. the card file — filed BEFORE it is judged ==== */
    var cx = 44.80;
    Iso.box(ctx, { x: cx - 0.52, y: line - 0.46, z: deck, w: 1.04, d: 0.92, h: 0.68,
                   color: M.iron });
    for (i = 0; i < 3; i++) {
      /* the drawer that is open is the one taking this card */
      var out = (mv && FILE > 0.2 && i === 1) ? 0.20 * FILE : 0;
      Iso.box(ctx, { x: cx - 0.44, y: line - 0.38 - out, z: deck + 0.08 + i * 0.19,
                     w: 0.88, d: 0.76, h: 0.15,
                     color: i === 1 ? Iso.mix(M.steelD, AC, 0.30) : M.steelD });
      Iso.box(ctx, { x: cx - 0.10, y: line - 0.40 - out, z: deck + 0.12 + i * 0.19,
                     w: 0.20, d: 0.05, h: 0.07, color: M.brass });
    }
    if (mv && FILE > 0.3 && FILE < 1) {
      ctx.fillStyle = PAPER.full;
      Iso.disc(ctx, cx, line - 0.30, deck + 0.78, 0.10);
    }
    floorText(cx - 0.54, line + 0.62, deck + 0.04, ['FILE FIRST, THEN COMPARE'],
              { size: 3.4, color: 'rgba(226,236,250,0.44)' });

    /* ============================= 5. the comparator and three answers ==== */
    var vx = 46.55;
    Iso.box(ctx, { x: vx - 0.42, y: line - 0.44, z: deck, w: 0.84, d: 0.88, h: 0.20,
                   color: M.ironD });
    Iso.gear(ctx, vx, line, deck + 0.22, 0.30, 12,
             mv ? LOOKUP * 5.0 : 0.4, mv && LOOKUP > 0 && LOOKUP < 1 ? AC : Iso.shade(AC, 0.5));
    var ANS = [
      { c: C_NEW,  on: !isEcho,        n: 'new' },
      { c: C_ECHO, on: isEcho && !late, n: 'earlier' },
      { c: C_LATE, on: late,           n: 'later' }
    ];
    for (i = 0; i < 3; i++) {
      ctx.fillStyle = 'rgba(9,11,13,0.85)';
      Iso.disc(ctx, vx - 0.28 + i * 0.28, line + 0.52, deck + 0.24, 0.13);
      ctx.fillStyle = Iso.rgba(ANS[i].c,
        ANS[i].on ? (mv ? 0.40 + 0.60 * VERD : 0.42) : 0.12);
      Iso.disc(ctx, vx - 0.28 + i * 0.28, line + 0.52, deck + 0.25, 0.10);
    }
    floorText(vx - 0.42, line + 0.76, deck + 0.04, ['new · earlier · later'],
              { size: 3.4, color: 'rgba(226,236,250,0.40)' });

    /* ===================== 6. echoAction, east and against the flow ==== */
    /* ec-alerting-service is upstream on the belt; this answer travels back to
       it, which is why the line runs the other way along the south apron. */
    Iso.box(ctx, { x: 47.16, y: 37.78, z: 0.30, w: 0.34, d: 0.34, h: 0.30,
                   color: M.iron });
    pipe(px1 - 0.10, py1 + 0.06, 47.34, 37.95, 0.30, 0.15,
         mv && SEND > 0 ? Iso.mix(M.steelD, '#a870d8', 0.5) : M.steelD);
    if (mv && SEND > 0 && SEND < 1) {
      ctx.fillStyle = Iso.rgba('#c8a0f0', 0.9);
      Iso.disc(ctx, 47.34 + SEND * 0.4, 37.95, 0.46, 0.10);
    }
    floorText(45.90, 38.34, 0.03, ['echoAction →'],
              { size: 3.6, color: 'rgba(168,112,216,0.52)' });

    /* the absence of an outfeed bay is deliberate */
    floorText(40.70, 38.92, 0.03, ['no outfeed — nothing is published to the line'],
              { size: 3.4, color: 'rgba(200,214,232,0.34)' });

    /* =============================================== 7. receipt and rack ==== */
    receiptDuct(o.x, o.y + 2.20, {
      phase: p, drop: [0.86, 0.97],
      accent: isEcho ? '#e0a040' : '#8fd6a0',
      label: 'audit · ' + outcome
    });

    lamp(px1 - 0.30, py0 + 0.30, deck + 0.10, 0.12, mv, '#5ad24e');
    replicaStack(px1 - 0.34, py0 + 0.14, deck,
                 phaseFor(s.plan || Sim.planNow(), 'echo'),
                 { cols: 12, pitch: 0.24, max: 32 });

    /* ================================================ 8. the intake bay ==== */
    var ph = phaseFor(s.plan || Sim.planNow(), 'echo');
    var lagFrac = ph ? Math.min(1, ph.lag / Math.max(1, ph.lagThresh)) : 0;
    transferBay({
      x: 43.00, yMachine: py0 - 0.25, yBelt: 30.20, phase: p, arms: 'in',
      flow: 'w', accent: AC, label: 'INTAKE',
      queue: lagFrac, over: !!(ph && ph.overThresh),
      inSwing: [0.00, 0.16], upRun: [0.04, 0.24]
    });
  }

  /* ==== ec-indexer — the bulk press ========================================
   *
   * What the service does (Section "ec-indexer", Flow A step A14):
   *
   *   collector = new BulkIndexCollector()
   *   for record in batch:                       // up to 50, processed concurrently
   *     indexName = reconApi.parentIndexName(tenant, record)   // cached
   *     data = parallelRangedDownload(s3, record.storage, chunkSize(...))
   *     if isEmpty(data): indexingGateway.post(record); continue
   *     collector.addParentDocument(injectPtime(compact(data)), indexName)
   *     if record.channel == "audio": collector.addChildDocument(…)
   *   flushBulk(collector)                       // ONE Elasticsearch request
   *   for r in succeeded: publish(auditIndexerTopic, …)
   *   for r in failed:    publishRetryTopic(r)   // per-record fate
   *
   * Most communications cost this station nothing. Every fiftieth pays for all
   * fifty. That is the entire trade, and it is why the machine is a press with
   * a hopper rather than a machine that does one thing at a time.
   *
   *   ranged GET    ─ the same FileChunkingStrategy as ec-gateway, ported
   *                   verbatim, so the same 25-lamp concurrency matrix appears
   *                   here. The document is fetched from S3 a second time; this
   *                   station does not receive it from the belt.
   *   index name    ─ one cached REST lookup, surveil.av5 / review.av5.
   *   the collector ─ a hopper filling toward fifty. A sight glass, because the
   *                   level is the only thing that decides whether this record
   *                   is cheap or expensive.
   *   parent, child ─ an audio call gets a SECOND document — the transcript —
   *                   attached to the same parent and indexed in the same
   *                   request.
   *   the bulk ram  ─ fires only when the hopper is full, and sends one request
   *                   for the whole batch.
   *   the siding    ─ per-record fate, not per-batch. A poison record in a
   *                   batch of fifty is retried ALONE, parked on its own siding
   *                   while the other forty-nine go through. Batching buys
   *                   throughput at the cost of blast radius, and this is the
   *                   part that limits the blast radius.
   *   the bypass    ─ an empty S3 object never enters the bulk at all; it goes
   *                   out over REST to ea-indexing-gateway. Plumbing that
   *                   exists for an edge case, drawn and not animated.
   *
   * Its maxReplicaCount is 5 in the standard overlays — the lowest ceiling on
   * the floor, because Elasticsearch is the thing that cannot be scaled by
   * adding consumers.
   * ===================================================================== */

  function drawIndexer(o, active, s) {
    var mv = busy('indexer');
    var p  = cyc('indexer', 0.40);

    /* ---- cam ---- */
    var FETCH = segLin(p, 0.04, 0.26);   /* the ranged GET, again            */
    var NAME  = seg(p,    0.22, 0.32);   /* cached index name                */
    var ADD   = seg(p,    0.32, 0.50);   /* parent, and a child if audio     */
    var FLUSH = seg(p,    0.54, 0.72);   /* only when the hopper is full     */
    var FATE  = segLin(p, 0.70, 0.86);   /* succeeded / failed, per record   */

    /* ---- what the model says ---- */
    var pos    = s.batchPosition || 0;
    var frac   = Math.min(1, pos / 50);
    var flush  = !!s.bulkFlush;
    var failed = s.bulkFailed || 0;
    var audio  = !!s.isAudio;
    var idx    = s.esIndexName || 'surveil.av5';
    var s3     = EC.s3Plan(s.avgDocSizeKb || 1);

    var AC = ACCENT.indexer;
    var cs = casing('indexer');

    var px0 = 30.50, px1 = 37.50, py0 = 34.70, py1 = 37.30;
    var sf   = py1 + 0.01;
    var deck = 1.66;
    var line = 35.55;
    var i, u;

    /* =============================================== 1. casing and face ==== */
    Iso.box(ctx, { x: px0 - 0.15, y: py0 - 0.15, z: 0, w: (px1 - px0) + 0.30,
                   d: (py1 - py0) + 0.30, h: 0.26, color: cs.plinth });
    Iso.box(ctx, { x: px0, y: py0, z: 0.26, w: px1 - px0, d: py1 - py0,
                   h: deck - 0.26, color: cs.body });

    ribs(px0 + 0.10, px1 - 0.10, sf, 0.34, 1.18, 16);
    bolts(px0 + 0.12, px1 - 0.12, sf, 1.52, 18);
    bolts(px0 + 0.12, px1 - 0.12, sf, 0.32, 18);
    plate(px0, sf, 1.54, px1 - px0, 0.05, 'rgba(0,0,0,0.42)');

    /* the same concurrency ceiling as the gateway, because it is the same code */
    var inFlight = mv ? Math.min(s3.conc, Math.ceil(s3.conc * FETCH)) : 0;
    matrix(px0 + 0.22, sf, 0.46, 5, 5, 0.148, inFlight, s3.conc, AC,
           'rgba(224,144,64,0.22)');
    stencil(px0 + 0.20, sf, 1.44, 'FileChunkingStrategy',
            { size: 3.8, color: 'rgba(222,238,255,0.44)' });

    readout(px0 + 1.32, sf, 0.44, 2.42, 0.86, [
      'position ' + pos + '/50',
      'bulk ' + EC.fmtKb(s.bulkBytes || 0),
      idx
    ], { size: 5.0, color: flush ? '#ffd889' : '#78cff2' });

    readout(px0 + 4.02, sf, 0.44, 2.86, 0.86, [
      flush ? 'FLUSH — pays for 50' : 'accumulating',
      audio ? 'audio: + child doc' : 'parent doc only',
      failed ? failed + ' retried alone' : 'maxReplicas 5'
    ], { size: 5.0, color: flush ? '#ffd889' : '#9be89b' });

    /* deck */
    Iso.box(ctx, { x: px0 - 0.07, y: py0 - 0.07, z: deck - 0.14,
                   w: (px1 - px0) + 0.14, d: (py1 - py0) + 0.14, h: 0.14, color: cs.kerb });
    Iso.box(ctx, { x: px0 + 0.12, y: py0 + 0.12, z: deck - 0.03,
                   w: (px1 - px0) - 0.24, d: (py1 - py0) - 0.24, h: 0.03, color: cs.tray });
    hazardStrip(px0 + 0.16, px1 - 0.16, py1 + 0.08, deck - 0.13, 0.11, 0.24);

    /* ====================================== 2. the S3 riser, a second time ==== */
    pipe(31.15, py0 - 0.92, 31.15, py0 + 0.10, 1.16, 0.20,
         mv && FETCH > 0 && FETCH < 1 ? Iso.mix(M.steelD, AC, 0.45) : M.steelD);
    Iso.box(ctx, { x: 30.96, y: py0 - 1.06, z: 0.92, w: 0.38, d: 0.30, h: 0.46,
                   color: M.iron });
    Iso.cylinder(ctx, { x: 31.15, y: line - 0.10, z: deck, r: 0.16, h: 0.30,
                        color: mv && FETCH > 0 && FETCH < 1 ? Iso.mix(M.steel, AC, 0.5)
                                                            : M.steelD });

    /* =============================== 3. the cached parent index name ==== */
    var nx = 32.30;
    Iso.box(ctx, { x: nx - 0.34, y: line - 0.34, z: deck, w: 0.68, d: 0.68, h: 0.36,
                   color: M.iron });
    Iso.box(ctx, { x: nx - 0.26, y: line - 0.26, z: deck + 0.36, w: 0.52, d: 0.52,
                   h: 0.05,
                   color: mv && NAME > 0.4 ? Iso.mix('#cdc7b6', AC, 0.25) : '#8f8a7c' });
    floorText(nx - 0.40, line + 0.46, deck + 0.04, ['INDEX NAME · cached'],
              { size: 3.4, color: 'rgba(226,236,250,0.40)' });

    /* =========================== 4. the collector, filling toward fifty ==== */
    var hx = 33.90, hz = deck;
    Iso.prism(ctx, [
      { x: hx - 0.92, y: line - 0.66 }, { x: hx + 0.92, y: line - 0.66 },
      { x: hx + 0.68, y: line + 0.66 }, { x: hx - 0.68, y: line + 0.66 }
    ], hz, 1.10, '#6a5330', 'rgba(230,190,90,0.40)');

    /* the sight glass down the viewer-facing wall: the level is the only thing
       that decides whether this record is cheap or expensive */
    var gs = line + 0.67, gx0 = hx - 0.52, gw = 0.34, gz = hz + 0.10, gh = 0.86;
    plate(gx0, gs, gz, gw, gh, '#100c04');
    plate(gx0, gs, gz, gw, gh * (mv && flush ? Math.max(frac, 1 - FLUSH) : frac),
          flush ? '#ffe890' : '#e0a840');
    for (i = 1; i < 5; i++) {
      plate(gx0, gs, gz + gh * (i / 5), gw, 0.035, 'rgba(20,14,4,0.75)');
    }
    plate(gx0 - 0.05, gs, gz + gh - 0.02, gw + 0.10, 0.045, '#d0402c');
    floorText(hx - 0.96, line + 0.86, deck + 0.04, ['COLLECTOR · 50'],
              { size: 3.4, color: 'rgba(226,236,250,0.44)' });

    /* ================================= 5. parent document, and a child ==== */
    var cx = 35.42;
    Iso.box(ctx, { x: cx - 0.36, y: line - 0.42, z: deck, w: 0.72, d: 0.84, h: 0.14,
                   color: M.steelD });
    if (mv && ADD > 0.15) {
      Iso.box(ctx, { x: cx - 0.28, y: line - 0.34, z: deck + 0.14, w: 0.56, d: 0.40,
                     h: 0.10, color: PAPER.full });
      if (audio) {
        Iso.box(ctx, { x: cx - 0.20, y: line + 0.10, z: deck + 0.14, w: 0.40, d: 0.26,
                       h: 0.08, color: Iso.mix(PAPER.mid, AC, 0.40) });
      }
    }
    floorText(cx - 0.42, line + 0.62, deck + 0.04,
              [audio ? 'PARENT + AUDIO CHILD' : 'PARENT DOC'],
              { size: 3.4, color: audio ? 'rgba(224,144,64,0.60)'
                                        : 'rgba(226,236,250,0.40)' });

    /* ============================ 6. the bulk ram — one request per batch ==== */
    var bx = 36.72;
    for (i = 0; i < 4; i++) {
      Iso.box(ctx, { x: bx - 0.44 + (i % 2) * 0.80, y: line - 0.42 + ((i / 2) | 0) * 0.76,
                     z: deck, w: 0.14, d: 0.14, h: 0.94, color: M.iron });
    }
    Iso.box(ctx, { x: bx - 0.50, y: line - 0.48, z: deck + 0.94, w: 1.08, d: 1.02,
                   h: 0.16, color: M.ironD });
    var rz = deck + 0.80 - (mv && flush ? FLUSH : 0) * 0.56;
    Iso.box(ctx, { x: bx - 0.38, y: line - 0.36, z: rz, w: 0.84, d: 0.78, h: 0.22,
                   color: flush ? '#c8b47e' : '#aab4be' });
    if (mv && flush && FLUSH > 0.8) {
      sparks(bx, line, deck + 0.30, 5, 43, '#ffe890');
      puffs(bx, line, deck + 0.60, 3, 47,
            { color: '#c8b48a', alpha: 0.20, rise: 0.9, r1: 0.30, rate: 1.2 });
    }
    floorText(bx - 0.54, line + 0.66, deck + 0.04, ['BULK · ONE REQUEST'],
              { size: 3.4, color: flush ? 'rgba(255,216,137,0.70)'
                                        : 'rgba(226,236,250,0.36)' });

    /* ============================ 7. the siding: retried alone, not as 50 ==== */
    var sx0 = 35.40, sx1 = 36.92, sy = 38.02;
    Iso.box(ctx, { x: sx0, y: sy, z: 0, w: sx1 - sx0, d: 0.10, h: 0.10, color: M.iron });
    Iso.box(ctx, { x: sx0, y: sy + 0.52, z: 0, w: sx1 - sx0, d: 0.10, h: 0.10, color: M.iron });
    for (i = 0; i < Math.min(3, failed); i++) {
      Iso.box(ctx, { x: sx0 + 0.16 + i * 0.46, y: sy + 0.14, z: 0.10, w: 0.34, d: 0.34,
                     h: 0.20, color: mv && FATE > 0.4 ? '#b8503c' : '#6a4038' });
    }
    floorText(sx0 - 0.06, sy + 0.78, 0.03, ['RETRY SIDING · per record, not per batch'],
              { size: 3.4, color: 'rgba(224,140,120,0.46)' });

    /* ======================= 8. the bypass an empty object takes instead ==== */
    pipe(31.30, py1 + 0.06, 31.30, 38.66, 0.34, 0.16, M.steelD);
    Iso.box(ctx, { x: 31.12, y: 38.62, z: 0.34, w: 0.36, d: 0.36, h: 0.30, color: M.iron });
    Iso.cylinder(ctx, { x: 31.30, y: 38.80, z: 0.64, r: 0.13, h: 0.06, color: '#6a6f76' });
    floorText(30.42, 39.12, 0.03, ['empty object → ea-indexing-gateway (REST)'],
              { size: 3.4, color: 'rgba(200,214,232,0.34)' });

    /* =============================================== 9. receipt and rack ==== */
    /* one audit event per SUCCEEDED record, which is why this duct is busiest
       on a flush */
    receiptDuct(o.x, o.y + 2.20, {
      phase: p, drop: [0.86, 0.97], accent: '#8fd6a0',
      label: 'audit.indexer.event' + (flush ? ' x50' : '')
    });

    lamp(px1 - 0.30, py0 + 0.30, deck + 0.10, 0.12, mv, '#5ad24e');
    replicaStack(px1 - 0.34, py0 + 0.14, deck,
                 phaseFor(s.plan || Sim.planNow(), 'indexer'),
                 { cols: 5, pitch: 0.28, max: 5 });

    /* ================================================ 10. the intake bay ==== */
    var ph = phaseFor(s.plan || Sim.planNow(), 'indexer');
    var lagFrac = ph ? Math.min(1, ph.lag / Math.max(1, ph.lagThresh)) : 0;
    transferBay({
      x: 33.20, yMachine: py0 - 0.25, yBelt: 30.20, phase: p, arms: 'in',
      flow: 'w', accent: AC, label: 'INTAKE',
      queue: lagFrac, over: !!(ph && ph.overThresh),
      inSwing: [0.00, 0.16], upRun: [0.04, 0.24]
    });
  }
  /* ==== ec-centralised-audit — the control tower ===========================
   *
   * Not a machine. Nothing passes through it, nothing comes out the far side,
   * and the communication never arrives here at all — what arrives is a receipt
   * ABOUT it. So this is built as a structure: legs, a receiving floor, a
   * ledger hall, and an instrument deck you can read from anywhere on the
   * floor. The belt runs around it.
   *
   *   event  = validateHeaders(record)          // missing headers: non-retryable
   *   ledger = mongo.findWithVersion(auditEvents, event.gcid)
   *   ledger.pipelines[event.pipelineId].history.append(event)
   *   ledger.pipelines[event.pipelineId].terminal = isTerminal(event.eventName)
   *   ledger.complete = all(p.terminal for p in ledger.pipelines)
   *   mongo.saveWithOptimisticVersion(ledger)   // concurrent writers RETRY
   *
   *   onTokenReconCron(token):                  // ShedLock, every 15 minutes
   *     completed = count(auditEvents, {reconToken: token, complete: true})
   *     ingested  = gateway.watermark(tenant, source, token)
   *     publish({token, completed, ingested, reconciled: completed == ingested})
   *
   * Read it bottom to top, because that is the order things happen in:
   *
   *   under the legs ─ three trench risers surface between them, and beside
   *                    them the header gate. A record with missing headers is
   *                    NON-RETRYABLE: it does not go to a siding to be tried
   *                    again, it goes into ec-audit-ingestion-failed-events and
   *                    stays there. That bin is a dead end on purpose.
   *   ledger hall    ─ one book per communication, pulled, written, and put
   *                    back with its version stamp. Concurrent writers retry
   *                    rather than overwrite, so nothing is silently lost — the
   *                    version wheel is that guarantee.
   *   the row of     ─ one lamp per pipeline. A lamp lights when that
   *   terminal lamps   pipeline's verdict can no longer change. COMPLETE falls
   *                    only when the LAST one lights, which is what "one record
   *                    per communication, marked complete" actually means.
   *   the deck       ─ two columns, and they are the point of the whole
   *                    building. Left: what this service counted. Right: the
   *                    gateway's ingest watermark, fetched over REST from the
   *                    other side of the floor. Two numbers produced
   *                    INDEPENDENTLY, and agreement between them is what "we
   *                    can prove it" means. When they disagree the lamp goes
   *                    amber — and note what it does NOT tell you: a mismatch
   *                    does not say which side is wrong. It only flags the
   *                    window.
   *
   * Its lagThreshold is 40, the tightest on the floor, because several receipts
   * arrive per communication.
   * ===================================================================== */

  var TOWER_SRC = ['gateway', 'qualifier', 'filter', 'evaluator',
                   'quota', 'echo', 'indexer'];

  /* The tower has no station of its own to be "busy" at, so it borrows the cam
     of whichever machine is currently reporting to it. That is the honest
     gate: it stirs when the floor reports, and is still when the floor is. */
  function towerSrc() {
    for (var i = 0; i < TOWER_SRC.length; i++) {
      if (busy(TOWER_SRC[i])) return TOWER_SRC[i];
    }
    return null;
  }

  /* The reconciliation cron, which runs on its own clock after a trip ends. */
  function reconPhase() {
    var t = Sim.state.reconT || 0;
    if (t <= 0) return 0;
    return 1 - t / (Sim.RECON_SECONDS || 3.2);
  }

  function drawTower(o, active, s) {
    var src = towerSrc();
    var tp  = src ? cyc(src, 0.40) : 0;
    var mv  = !!src;

    /* ---- the stitching cam, one receipt at a time ---- */
    var ARRIVE = segLin(tp, 0.02, 0.20);
    var VALID  = seg(tp,    0.18, 0.32);
    var PULL   = seg(tp,    0.32, 0.46);
    var WRITE  = seg(tp,    0.46, 0.62);
    var TERM   = seg(tp,    0.60, 0.74);
    var FILE   = seg(tp,    0.72, 0.86);

    /* ---- the reconciliation cam ---- */
    var rp    = reconPhase();
    var rOn   = rp > 0 && rp < 1;
    var COUNT = segLin(rp, 0.05, 0.40);
    var WMARK = segLin(rp, 0.30, 0.62);
    var CMP   = seg(rp,    0.60, 0.80);
    var SEAL  = seg(rp,    0.80, 0.94);

    /* ---- what the books say ---- */
    var events    = s.auditEvents || 0;
    var ingested  = s.auditIngested || 0;
    var completed = s.auditCompleted || 0;
    var agree     = ingested === completed;
    var claimed   = s.pipelineIds || 0;
    var termN     = Math.min(claimed, s.pipesTerminal || 0);
    var complete  = claimed > 0 && termN >= claimed;
    var wt        = s.windowToken || EC.WINDOW_TOKEN;

    var AC = ACCENT.audit;
    var cs = casing('audit');
    /* Rule 2 cuts hard here: the two decks are the largest flat surfaces on
       the floor, and the audit livery cap is a warm salmon. Warm is the
       payload's colour and nothing warm passes through this building, so the
       decks are galvanised plate and the accent is spent on a lit edge trim
       and the instruments instead. */
    var DECK = Iso.mix(M.steelD, cs.body, 0.28);
    var C_OK = '#5ad24e', C_WARN = '#e0a040';

    var tx0 = 28.60, tx1 = 35.40, ty0 = 17.20, ty1 = 21.20;
    var legZ = 1.60, dkZ = 1.80, hallZ = 4.10, upZ = 4.32;
    var sfh  = ty1 - 0.25 + 0.01;          /* the ledger hall's south face */
    var i, u;

    /* ============================================= 1. pad, legs, risers ==== */
    Iso.box(ctx, { x: tx0 - 0.24, y: ty0 - 0.24, z: 0, w: (tx1 - tx0) + 0.48,
                   d: (ty1 - ty0) + 0.48, h: 0.20, color: cs.plinth });
    hazardFloor(tx0 - 0.24, ty1 + 0.26, tx1 + 0.24, ty1 + 0.26, 0.16, 0.014, { step: 0.30 });

    var LEG = [[tx0 + 0.22, ty0 + 0.22], [tx1 - 0.56, ty0 + 0.22],
               [tx0 + 0.22, ty1 - 0.56], [tx1 - 0.56, ty1 - 0.56]];
    for (i = 0; i < 4; i++) {
      Iso.box(ctx, { x: LEG[i][0], y: LEG[i][1], z: 0.20, w: 0.34, d: 0.34,
                     h: legZ - 0.20, color: M.iron });
    }
    /* cross-bracing, so it reads as a frame holding a storey up */
    ctx.strokeStyle = Iso.rgba(M.ironD, 0.95);
    ctx.lineWidth = 2.2;
    Iso.polyLine(ctx, [P(tx0 + 0.39, ty1 - 0.39, 0.30), P(tx1 - 0.39, ty1 - 0.39, legZ - 0.10)]);
    Iso.polyLine(ctx, [P(tx0 + 0.39, ty1 - 0.39, legZ - 0.10), P(tx1 - 0.39, ty1 - 0.39, 0.30)]);

    /* the three risers surfacing between the legs — the receipts arriving */
    var RISER = [[32.0, ty0 - 0.10, 'north'], [30.0, ty1 + 0.14, 'south'],
                 [tx1 + 0.16, 18.85, 'east']];
    for (i = 0; i < 3; i++) {
      u = RISER[i];
      Iso.box(ctx, { x: u[0] - 0.30, y: u[1] - 0.24, z: 0.20, w: 0.60, d: 0.48,
                     h: 0.24, color: M.ironD });
      Iso.cylinder(ctx, { x: u[0], y: u[1], z: 0.44, r: 0.16, h: 0.92,
                          color: mv && ARRIVE > 0 && ARRIVE < 1
                                 ? Iso.mix(M.steelD, '#8fd6a0', 0.5) : M.steelD });
      if (mv && ARRIVE > 0 && ARRIVE < 1) {
        ctx.fillStyle = Iso.rgba('#8fd6a0', 0.92);
        Iso.disc(ctx, u[0], u[1], 0.44 + ARRIVE * 0.92, 0.11);
      }
    }

    /* ================= 2. the header gate, and a bin that is a dead end ==== */
    var gx = tx0 - 0.86, gy = ty1 - 0.30;
    Iso.box(ctx, { x: gx - 0.30, y: gy - 0.34, z: 0, w: 0.60, d: 0.68, h: 0.52,
                   color: M.iron });
    Iso.box(ctx, { x: gx - 0.24, y: gy - 0.28, z: 0.52, w: 0.48, d: 0.56, h: 0.10,
                   color: M.steelD });
    ctx.fillStyle = Iso.rgba(mv && VALID > 0.3 ? C_OK : '#3a5a44',
                             mv && VALID > 0.3 ? 0.85 : 0.40);
    Iso.disc(ctx, gx, gy - 0.02, 0.64, 0.12);
    /* the failed-events bin: non-retryable, so nothing ever leaves it */
    Iso.box(ctx, { x: gx - 0.44, y: gy + 0.52, z: 0, w: 0.88, d: 0.66, h: 0.42,
                   color: '#3b414a' });
    quad([[gx - 0.38, gy + 0.58, 0.42], [gx + 0.38, gy + 0.58, 0.42],
          [gx + 0.38, gy + 1.12, 0.42], [gx - 0.38, gy + 1.12, 0.42]], '#15181c');
    floorText(gx - 0.52, gy + 1.30, 0.03, ['ec-audit-ingestion-failed-events'],
              { size: 3.4, color: 'rgba(224,140,120,0.44)' });
    floorText(gx - 0.44, gy - 0.62, 0.03, ['HEADERS'],
              { size: 3.4, color: 'rgba(226,236,250,0.42)' });

    /* ==================================== 3. receiving deck, ledger hall ==== */
    Iso.box(ctx, { x: tx0 - 0.15, y: ty0 - 0.15, z: legZ, w: (tx1 - tx0) + 0.30,
                   d: (ty1 - ty0) + 0.30, h: dkZ - legZ, color: DECK });
    hazardStrip(tx0 - 0.15, tx1 + 0.15, ty1 + 0.16, legZ + 0.02, dkZ - legZ - 0.04);
    Iso.box(ctx, { x: tx0 + 0.25, y: ty0 + 0.25, z: dkZ, w: (tx1 - tx0) - 0.50,
                   d: (ty1 - ty0) - 0.50, h: hallZ - dkZ, color: cs.body });

    var hx0 = tx0 + 0.25, hx1 = tx1 - 0.25;
    ribs(hx0 + 0.10, hx1 - 0.10, sfh, 1.92, 2.02, 14);
    bolts(hx0 + 0.12, hx1 - 0.12, sfh, hallZ - 0.12, 15);
    bolts(hx0 + 0.12, hx1 - 0.12, sfh, dkZ + 0.12, 15);
    /* a glazed band, because people work in here */
    plate(hx0 + 0.20, sfh, 3.18, (hx1 - hx0) - 0.40, 0.56, 'rgba(150,205,230,0.30)');
    for (i = 1; i < 6; i++) {
      plate(hx0 + 0.20 + i * ((hx1 - hx0 - 0.40) / 6), sfh, 3.18, 0.05, 0.56,
            'rgba(24,28,34,0.75)');
    }

    /* ============================== 4. the books, and the version wheel ==== */
    /* one ledger per communication: pulled, written, put back with its version */
    var bx = hx0 + 0.30;
    for (i = 0; i < 5; i++) {
      var out = (mv && i === 2) ? (PULL - FILE) * 0.26 : 0;
      Iso.box(ctx, { x: bx + i * 0.30, y: 19.10 - out, z: dkZ + 0.06, w: 0.22, d: 0.60,
                     h: 0.62, color: i % 2 ? '#8a5f4c' : '#7a5343' });
      Iso.box(ctx, { x: bx + i * 0.30, y: 19.10 - out, z: dkZ + 0.52, w: 0.22, d: 0.60,
                     h: 0.06, color: M.brass });
    }
    Iso.gear(ctx, bx + 1.72, 19.28, dkZ + 0.30, 0.20, 10,
             mv ? WRITE * 5.0 : 0.3, mv && WRITE > 0 && WRITE < 1 ? M.brass
                                                                 : Iso.shade(M.brass, 0.6));
    readout(hx0 + 0.18, sfh, 2.02, 2.62, 0.86, [
      events + ' receipts filed',
      'ledger ' + termN + '/' + claimed + ' terminal',
      complete ? 'COMPLETE' : 'open'
    ], { size: 5.0, color: complete ? '#9be89b' : '#78cff2' });

    /* one lamp per pipeline; COMPLETE only when the last one lights */
    var lx = hx0 + 3.10;
    for (i = 0; i < Math.max(1, Math.min(8, claimed)); i++) {
      plate(lx + i * 0.34, sfh, 2.56, 0.26, 0.26, 'rgba(12,14,17,0.72)');
      plate(lx + i * 0.34 + 0.03, sfh, 2.59, 0.20, 0.20,
            i < termN ? Iso.rgba(C_OK, mv && TERM > 0.3 ? 0.95 : 0.72)
                      : 'rgba(190,208,226,0.13)');
    }
    stencil(lx, sfh, 2.98, 'TERMINAL PER PIPELINE',
            { size: 3.8, color: 'rgba(222,238,255,0.44)' });
    plate(lx, sfh, 2.06, 1.10, 0.42, complete ? 'rgba(90,210,78,0.28)' : 'rgba(0,0,0,0.30)');
    stencil(lx + 0.08, sfh, 2.42, complete ? 'COMPLETE' : 'INCOMPLETE',
            { size: 5.0, color: complete ? 'rgba(150,224,140,0.92)'
                                         : 'rgba(200,214,232,0.42)' });

    /* ======================================= 5. the instrument deck ==== */
    Iso.box(ctx, { x: tx0 - 0.25, y: ty0 - 0.25, z: hallZ, w: (tx1 - tx0) + 0.50,
                   d: (ty1 - ty0) + 0.50, h: upZ - hallZ, color: DECK });
    plate(tx0 - 0.25, ty1 + 0.26, hallZ + 0.03, (tx1 - tx0) + 0.50, upZ - hallZ - 0.06,
          Iso.rgba(AC, 0.55));
    /* a handrail round it, so the deck reads as somewhere you can stand */
    ctx.strokeStyle = 'rgba(150,158,168,0.75)';
    ctx.lineWidth = 1.6;
    Iso.polyLine(ctx, [P(tx0 - 0.25, ty0 - 0.25, upZ + 0.34),
                       P(tx1 + 0.25, ty0 - 0.25, upZ + 0.34),
                       P(tx1 + 0.25, ty1 + 0.25, upZ + 0.34),
                       P(tx0 - 0.25, ty1 + 0.25, upZ + 0.34)], true);

    /* --- the two columns. This is what the building is for. --- */
    var cA = 29.70, cB = 30.96, cy = 20.30, cH = 1.78;
    var top = Math.max(1, Math.max(ingested, completed), 3);
    gaugeCol(cA, cy, upZ, 0.56, cH, completed / top,
             mv || rOn ? Iso.mix(AC, '#ffd070', 0.35 * COUNT) : AC,
             { track: '#2f2a24' });
    gaugeCol(cB, cy, upZ, 0.56, cH, ingested / top,
             rOn && WMARK > 0 ? Iso.mix('#5ab0e0', '#bde4ff', WMARK) : '#5ab0e0',
             { track: '#242c34' });
    floorText(cA - 0.12, cy - 0.44, upZ + 0.03, ['completed · counted here'],
              { size: 3.4, color: 'rgba(224,160,120,0.68)' });
    floorText(cB - 0.08, cy - 0.44, upZ + 0.03, ['ingested · gateway watermark'],
              { size: 3.4, color: 'rgba(140,190,235,0.68)' });

    /* the verdict: green only when two independently produced counts agree */
    var vcx = (cA + cB) / 2 + 0.28, vz = upZ + cH + 0.34;
    /* a yoke tying the two columns together — the comparison is a mechanism,
       not two gauges that happen to stand side by side */
    Iso.box(ctx, { x: cA, y: cy + 0.16, z: upZ + cH + 0.02, w: (cB - cA) + 0.56,
                   d: 0.22, h: 0.12, color: M.iron });
    ctx.fillStyle = 'rgba(9,11,13,0.88)';
    Iso.disc(ctx, vcx, cy + 0.27, vz, 0.32);
    ctx.fillStyle = Iso.rgba(agree ? C_OK : C_WARN,
                             rOn ? 0.42 + 0.58 * CMP : 0.52);
    Iso.disc(ctx, vcx, cy + 0.27, vz + 0.01, 0.24);
    faceText(cA + 0.06, cy + 0.92, vz + 0.52,
             [completed + ' / ' + ingested + (agree ? '  RECONCILED' : '  FLAGGED')],
             { size: 4.8, color: agree ? 'rgba(150,224,140,0.92)'
                                       : 'rgba(232,176,104,0.94)' });
    /* what a mismatch does NOT tell you, said on the machine itself */
    if (!agree) {
      floorText(cA - 0.30, cy + 1.06, upZ + 0.03,
                ['flags the window — not which side is wrong'],
                { size: 3.2, color: 'rgba(232,176,104,0.52)' });
    }

    /* --- the window ledgers, closed and stamped --- */
    var wx = 33.10;
    for (i = 0; i < 4; i++) {
      var closed = i < 3;
      Iso.box(ctx, { x: wx + i * 0.46, y: 20.06, z: upZ, w: 0.36, d: 0.92,
                     h: 0.46 + (closed ? 0 : 0.10),
                     color: closed ? '#6d5a4a' : Iso.mix('#6d5a4a', AC, 0.35) });
      ctx.fillStyle = closed ? Iso.rgba(C_OK, 0.75)
                             : Iso.rgba(C_WARN, rOn ? 0.40 + 0.55 * SEAL : 0.45);
      Iso.disc(ctx, wx + i * 0.46 + 0.18, 20.52, upZ + 0.50, 0.09);
    }
    floorText(wx - 0.04, 19.66, upZ + 0.03, ['ec-audit-events_' + wt],
              { size: 3.4, color: 'rgba(226,236,250,0.44)' });

    /* --- ShedLock: only one instance holds the cron --- */
    Iso.cylinder(ctx, { x: 34.90, y: 17.70, z: upZ, r: 0.20, h: 0.42, color: M.iron });
    ctx.fillStyle = Iso.rgba('#d0b040', rOn ? 0.45 + 0.55 * Math.abs(Math.sin(clk * 3)) : 0.26);
    Iso.disc(ctx, 34.90, 17.70, upZ + 0.46, 0.17);
    floorText(34.10, 18.14, upZ + 0.03, ['ShedLock · 15 min'],
              { size: 3.4, color: 'rgba(208,176,64,0.55)' });

    /* --- the beacon, because it is the tallest thing on the floor --- */
    lattice(32.20, 17.90, upZ + 0.10, 2.10, 0.26, 4, '#616b77');
    Iso.box(ctx, { x: 32.02, y: 17.72, z: upZ + 2.20, w: 0.36, d: 0.36, h: 0.18,
                   color: M.steelD });
    ctx.fillStyle = Iso.rgba(agree ? C_OK : C_WARN,
                             rOn ? 0.45 + 0.45 * Math.abs(Math.sin(clk * 1.6)) : 0.55);
    Iso.disc(ctx, 32.20, 17.90, upZ + 2.41, 0.19);

    /* --- the stair, for scale --- */
    for (i = 0; i < 7; i++) {
      Iso.box(ctx, { x: tx1 + 0.24, y: ty1 - 0.10 - i * 0.20, z: i * 0.24,
                     w: 0.62, d: 0.20, h: 0.08, color: M.steelD });
    }

    /* the tightest threshold on the floor, and the reason for it */
    replicaStack(28.60, 18.75, upZ,
                 phaseFor(s.plan || Sim.planNow(), 'audit'),
                 { cols: 12, pitch: 0.22, max: 32 });
    floorText(tx0 - 0.20, ty1 + 1.62, 0.03,
              ['lagThreshold 40 — several receipts per communication'],
              { size: 3.6, color: 'rgba(226,236,250,0.34)' });
  }

  /* ---- ec-reporting: window-suffixed bins -------------------------------- */

  /* Counters land in a collection named for the window they belong to, so one
     window's numbers can never be mixed with another's. */
  function drawReporting(o, active, s) {
    /* One machine is alive at a time: mv gates every moving part, so an
       idle machine shows nothing but its standby lamp. */
    var mv = busy(o.id), t = mv ? clk : 0;
    var k = shell(o);
    var i;

    /* four window bins; the newest is the live one */
    var live = 3;
    for (i = 0; i < 4; i++) {
      var bx2 = k.bx + 0.35 + i * ((o.w - 0.7) / 4);
      var bw  = (o.w - 0.7) / 4 - 0.16;
      var isLive = (i === live);
      var fill = isLive ? (0.25 + 0.6 * Math.abs(Math.sin(t * 0.55)))
                        : (0.55 + i * 0.12);
      Iso.box(ctx, { x: bx2, y: k.by + 0.45, z: k.top, w: bw, d: 0.85,
                     h: 1.25, color: '#141108', edge: 'rgba(150,130,90,0.28)' });
      Iso.box(ctx, { x: bx2+0.05, y: k.by + 0.50, z: k.top, w: bw-0.10, d: 0.75,
                     h: 1.15 * fill,
                     color: isLive ? '#c0a070' : '#6a5a44', edge: false });
      /* window token plate under each bin */
      ctx.fillStyle = isLive ? 'rgba(224,200,150,0.85)' : 'rgba(130,115,88,0.55)';
      Iso.poly(ctx, [P(bx2, k.sf, 0.50), P(bx2+bw, k.sf, 0.50),
                     P(bx2+bw, k.sf, 0.62), P(bx2, k.sf, 0.62)]);
    }
    faceText(k.bx+0.30, k.sf, k.top-0.55, ['_windowToken'],
             { size: 6.5, color: 'rgba(200,180,140,0.60)' });

    /* the 15-minute ShedLock cron, sweeping */
    var sxc = o.x + 1.85, syc = o.y - 0.35;
    Iso.cylinder(ctx, { x: sxc, y: syc, z: k.top, r: 0.17, h: 0.36, color: '#2e2a20' });
    var sweep = (t * 0.5) % 1;
    ctx.fillStyle = 'rgba(200,180,120,' + (0.35 + 0.5 * Math.abs(Math.sin(sweep*Math.PI))).toFixed(2) + ')';
    Iso.disc(ctx, sxc, syc, k.top + 0.40, 0.20);

    ctx.fillStyle = mv ? 'rgba(90,210,80,' + (0.72 + 0.28*Math.sin(t*7)).toFixed(2) + ')'
                           : 'rgba(200,55,45,0.68)';
    Iso.disc(ctx, k.bx+o.w-0.48, k.by+0.38, k.top+0.04, 0.13);
    if (mv) puffs(o.x, k.by+o.d*0.28, k.top+0.6, 3, (o.x*7)|0,
                      { color: '#98886a', alpha: 0.15, rise: 1.1, r1: 0.34, rate: 0.42 });
  }

  /* ==== floor props ========================================================
   * Scenery. None of it is in the model; it is here so the plant reads as a
   * building standing on a site. World.buildProps() has already kept all of it
   * off the belt and out of every footprint.
   * ===================================================================== */

  /* Cable trunking on stanchions — the conduit the place is named for. */
  function drawConduit(pr) {
    var dx = pr.x1 - pr.x0, dy = pr.y1 - pr.y0;
    var len = Math.hypot(dx, dy) || 1;
    var n = Math.max(2, Math.round(len / 6));
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      Iso.cylinder(ctx, { x: pr.x0 + dx*t, y: pr.y0 + dy*t, z: 0,
                          r: 0.11, h: pr.z, color: '#2a3040', edge: false });
    }
    /* two runs of trunking, the lower one amber-capped like the hazard band */
    ctx.fillStyle = '#39435c';
    Iso.ribbon(ctx, pr.x0, pr.y0, pr.x1, pr.y1, 0.42, pr.z);
    ctx.fillStyle = 'rgba(176,138,44,0.55)';
    Iso.ribbon(ctx, pr.x0, pr.y0, pr.x1, pr.y1, 0.14, pr.z + 0.02);
    ctx.fillStyle = '#2f394f';
    Iso.ribbon(ctx, pr.x0, pr.y0, pr.x1, pr.y1, 0.34, pr.z - 0.30);
  }

  /* High-bay lamp: mast, head, and a pool of light on the slab. */
  function drawLamp(pr) {
    ctx.fillStyle = 'rgba(230,215,160,0.055)';
    Iso.disc(ctx, pr.x, pr.y, 0.02, 2.6);
    Iso.cylinder(ctx, { x: pr.x, y: pr.y, z: 0, r: 0.11, h: 3.1, color: '#262c3a' });
    Iso.box(ctx, { x: pr.x-0.42, y: pr.y-0.42, z: 3.1, w: 0.84, d: 0.84, h: 0.22,
                   color: '#31384a', edge: false });
    ctx.fillStyle = 'rgba(240,226,170,0.80)';
    Iso.disc(ctx, pr.x, pr.y, 3.09, 0.30);
  }

  /* Stacked crates on a pallet. Seeded so each stack differs but never moves. */
  function drawPallet(pr) {
    var h1 = Iso.hash2(pr.x, pr.y, pr.seed || 1);
    var h2 = Iso.hash2(pr.y, pr.x, (pr.seed || 1) + 7);
    Iso.box(ctx, { x: pr.x-0.85, y: pr.y-0.65, z: 0, w: 1.70, d: 1.30, h: 0.16,
                   color: '#4a3f30', edge: false });
    var tiers = 1 + Math.round(h1 * 2);
    for (var i = 0; i < tiers; i++) {
      var inset = 0.10 * i;
      Iso.box(ctx, {
        x: pr.x - 0.72 + inset + h2*0.10, y: pr.y - 0.54 + inset,
        w: 1.44 - inset*2, d: 1.08 - inset*2,
        z: 0.16 + i * 0.52, h: 0.50,
        color: i % 2 ? '#54607a' : '#464f66', edge: 'rgba(0,0,0,0.32)'
      });
    }
  }

  /* Equipment cabinet — switchgear and stores, louvred, with a status LED. */
  function drawCabinet(pr) {
    var w = 1.1, d = 0.8, h = 2.0;
    var bx = pr.x - w/2, by = pr.y - d/2, sf = by + d + 0.01;
    Iso.box(ctx, { x: bx, y: by, z: 0, w: w, d: d, h: h,
                   color: '#2b3346', edge: 'rgba(90,115,170,0.30)' });
    for (var r = 0; r < 5; r++) {
      var z0 = 0.22 + (h - 0.5) * (r / 5);
      ctx.fillStyle = 'rgba(18,22,34,0.55)';
      Iso.poly(ctx, [P(bx+0.14, sf, z0), P(bx+w-0.14, sf, z0),
                     P(bx+w-0.14, sf, z0+0.16), P(bx+0.14, sf, z0+0.16)]);
    }
    ctx.fillStyle = (Iso.hash2(pr.x, pr.y, pr.seed || 3) > 0.5)
      ? 'rgba(90,200,110,0.85)' : 'rgba(210,170,60,0.85)';
    Iso.disc(ctx, pr.x, by + 0.18, h + 0.02, 0.09);
  }

  /* Ground cover outside the slab. Flat, cheap, and never near the carrier. */
  function drawScrub(pr) {
    var s = pr.s || 1;
    /* Opaque and a little larger than looks right up close: at zoom-fit these
       are three pixels each, and the job they do — making the ground read as
       ground — only happens if they survive that. */
    ctx.fillStyle = '#3c3526';
    Iso.disc(ctx, pr.x, pr.y, 0.01, 0.52 * s);
    ctx.fillStyle = '#4e4632';
    Iso.disc(ctx, pr.x + 0.16*s, pr.y - 0.10*s, 0.02, 0.34 * s);
    ctx.fillStyle = '#5c5540';
    Iso.disc(ctx, pr.x - 0.14*s, pr.y + 0.10*s, 0.03, 0.20 * s);
  }

  function drawRock(pr) {
    var s = pr.s || 1;
    Iso.prism(ctx, [
      { x: pr.x - 0.42*s, y: pr.y            },
      { x: pr.x,          y: pr.y - 0.36*s   },
      { x: pr.x + 0.42*s, y: pr.y            },
      { x: pr.x,          y: pr.y + 0.36*s   }
    ], 0, 0.38 * s, '#6b6353', false);
  }

  /* A spur is a short conduit branch off a trunk into the machine it feeds:
     same construction, lower and thinner. */
  function drawSpur(pr) {
    Iso.cylinder(ctx, { x: pr.x0, y: pr.y0, z: 0, r: 0.08, h: pr.z, color: '#2a3040', edge: false });
    Iso.cylinder(ctx, { x: pr.x1, y: pr.y1, z: 0, r: 0.08, h: pr.z, color: '#2a3040', edge: false });
    ctx.fillStyle = '#333c52';
    Iso.ribbon(ctx, pr.x0, pr.y0, pr.x1, pr.y1, 0.26, pr.z);
    ctx.fillStyle = 'rgba(176,138,44,0.40)';
    Iso.ribbon(ctx, pr.x0, pr.y0, pr.x1, pr.y1, 0.09, pr.z + 0.02);
  }

  /* Belt-side stanchion, with the cable strung back to the previous post.
     The wire is what makes a row of posts read as a line rather than as litter,
     so it is drawn here from `prev` rather than as its own prop. */
  function drawPost(pr) {
    var top = 3.4;
    Iso.cylinder(ctx, { x: pr.x, y: pr.y, z: 0, r: 0.10, h: top, color: '#232a38', edge: false });
    /* crossarm */
    Iso.box(ctx, { x: pr.x - 0.55, y: pr.y - 0.07, z: top - 0.25, w: 1.10, d: 0.14,
                   h: 0.11, color: '#2c3446', edge: false });
    ctx.fillStyle = 'rgba(176,138,44,0.75)';
    Iso.disc(ctx, pr.x, pr.y, top + 0.02, 0.13);

    if (pr.prev) {
      /* a shallow catenary: three segments sagging toward the midpoint */
      var a = P(pr.prev.x, pr.prev.y, top - 0.22);
      var b = P(pr.x, pr.y, top - 0.22);
      var mx = (pr.prev.x + pr.x) / 2, my = (pr.prev.y + pr.y) / 2;
      var mid = P(mx, my, top - 0.62);
      ctx.strokeStyle = 'rgba(18,22,32,0.75)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
      ctx.stroke();
    }
  }

  /* Cable drum lying on its side. */
  function drawSpool(pr) {
    var h = Iso.hash2(pr.x, pr.y, pr.seed || 5);
    Iso.cylinder(ctx, { x: pr.x, y: pr.y, z: 0, r: 0.62, h: 0.30,
                        color: '#4a4032', edge: 'rgba(0,0,0,0.30)' });
    Iso.cylinder(ctx, { x: pr.x, y: pr.y, z: 0.30, r: 0.44, h: 0.42,
                        color: h > 0.5 ? '#2f3a4e' : '#3a344a',
                        edge: false });
    Iso.cylinder(ctx, { x: pr.x, y: pr.y, z: 0.72, r: 0.62, h: 0.28,
                        color: '#4a4032', edge: 'rgba(0,0,0,0.30)' });
  }

  /* Barrel cluster — three drums, seeded so the group differs per site. */
  function drawDrum(pr) {
    var h = Iso.hash2(pr.x, pr.y, pr.seed || 9);
    var off = [[0, 0], [0.62, 0.18], [0.28, 0.62]];
    for (var i = 0; i < 3; i++) {
      Iso.cylinder(ctx, {
        x: pr.x + off[i][0], y: pr.y + off[i][1], z: 0,
        r: 0.30, h: 0.86,
        color: (i + (h > 0.5 ? 1 : 0)) % 2 ? '#5c5340' : '#3f4656',
        ring: 0.45, edge: 'rgba(0,0,0,0.30)'
      });
    }
  }

  /* Painted bay marking. Flat floor paint, laid down before any solid. */
  function drawBay(dc) {
    var x0 = dc.x - dc.w/2, y0 = dc.y - dc.d/2, x1 = dc.x + dc.w/2, y1 = dc.y + dc.d/2;
    ctx.strokeStyle = 'rgba(190,158,70,0.30)';
    ctx.lineWidth = 1.6;
    Iso.polyLine(ctx, [P(x0,y0,0.01), P(x1,y0,0.01), P(x1,y1,0.01), P(x0,y1,0.01)], true);
    /* corner ticks, brighter than the outline */
    ctx.fillStyle = 'rgba(200,168,80,0.45)';
    [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].forEach(function (c) {
      Iso.disc(ctx, c[0], c[1], 0.012, 0.13);
    });
  }

  /* A named lane of floor alongside the belt: one Kafka topic. Painted flat,
     so it goes down with the decals — before any solid, or a machine standing
     in front of the lane would have the lettering laid over it. */
  function drawTopicLane(dc) {
    var vert = dc.dir === 'y';
    var back = vert ? (dc.y1 > dc.y0 ? 1 : -1) : (dc.x1 > dc.x0 ? 1 : -1);

    /* the aisle line the name is painted against */
    ctx.fillStyle = 'rgba(176,138,44,0.20)';
    Iso.ribbon(ctx, dc.x0, dc.y0, dc.x1, dc.y1, 0.10, 0.014);

    /* the name reads along the lane, in the direction of travel */
    var tx = Math.min(dc.x0, dc.x1), ty = Math.min(dc.y0, dc.y1);
    if (vert)      { tx = dc.x0; ty = back > 0 ? dc.y0 : dc.y1; }
    else if (back < 0) { tx = dc.x1; }
    floorText(tx + (vert ? 0.22 : 0.10), ty + (vert ? 0.10 : 0.22), 0.016,
              [dc.text], { size: 4.6, dir: dc.dir,
                           color: dc.from ? 'rgba(226,236,250,0.30)'
                                          : 'rgba(226,236,250,0.36)' });
  }


  /* ==== the receipt relay ==================================================
   *
   * Seven machines report to ec-centralised-audit; ec-alerting-service does not,
   * and has no line. Inbound receipts run below grade in a trench — a cut into
   * the slab, drawn before the belt, so it passes under the conveyor instead of
   * fighting the carrier for depth. Outbound traffic runs overhead.
   *
   * Every glow is gated on the machine that SENT it. Nothing on this network
   * moves unless something is reporting, which is the whole point: the floor is
   * dark until a decision is made, and then you watch the receipt travel.
   * ===================================================================== */

  /* how far along its send a given machine is, or 0 if it is not sending */
  function relayAt(id, a, b) {
    return busy(id) ? segLin(cyc(id, 0.40), a, b) : 0;
  }
  /* a shared segment carries whichever of its sources is live; the cam gate
     guarantees that is at most one */
  function relayOf(src, a, b) {
    var t = 0;
    for (var i = 0; i < src.length; i++) t = Math.max(t, relayAt(src[i], a, b));
    return t;
  }

  var RELAY_BRANCH = [0.84, 0.92];
  var RELAY_SPINE  = [0.90, 0.96];
  var RELAY_RISER  = [0.94, 1.00];

  function drawTrenches() {
    var runs = World.RELAY.trench, i, t, win;
    for (i = 0; i < runs.length; i++) {
      var r = runs[i];
      /* a branch feeds one machine, a spine several, and the riser is last —
         so a receipt is seen to travel machine → spine → tower */
      win = r.riser        ? RELAY_RISER
          : r.src.length > 1 ? RELAY_SPINE
                             : RELAY_BRANCH;
      t = relayOf(r.src, win[0], win[1]);
      trench(r.x0, r.y0, r.x1, r.y1, {
        pulse: t,
        pulseColor: '#8fd6a0',
        cap: !!r.riser,
        hazard: r.src.length > 1        /* mark the common runs, not every stub */
      });
    }
  }

  /* The overhead outbound runs. Drawn after the sorted pass because at z 4.5
     nothing on the floor can occlude them — their stanchions go through the
     sorted pass instead, as ordinary solids. */
  function drawRelayOverhead() {
    var tubes = World.RELAY.tube, i, k, t;
    /* The three overhead runs are the tower's OWN traffic, and they belong to
       the reconciliation cron rather than to any machine's work cycle. The
       watermark line is the REST call out to the gateway for the ingest count;
       the two windowReconciliation lines carry the sealed verdict away
       afterwards. So they fire on the cron, in that order — and stay dark the
       rest of the time, which is honest: this happens every fifteen minutes,
       not on every receipt. */
    var rp = reconPhase();
    for (i = 0; i < tubes.length; i++) {
      var tb = tubes[i];
      t = rp > 0 && rp < 1
          ? (tb.to === 'gateway' ? segLin(rp, 0.30, 0.62) : segLin(rp, 0.84, 1.00))
          : 0;
      for (k = 0; k + 1 < tb.pts.length; k++) {
        tubeRun(tb.pts[k][0], tb.pts[k][1], tb.pts[k+1][0], tb.pts[k+1][1], tb.z,
                { pulse: t, pulseColor: '#7fd4ff' });
      }
      if (tb.label) {
        floorText(tb.pts[0][0] + 0.3, tb.pts[0][1] + 0.3, tb.z + 0.42, [tb.label],
                  { size: 3.8, color: 'rgba(150,205,235,0.42)' });
      }
    }
  }

  function drawDecals() {
    World.decals.forEach(function (dc) {
      if (dc.kind === 'bay')   drawBay(dc);
      if (dc.kind === 'topic') drawTopicLane(dc);
    });
  }

  var PROP_KIND = {
    conduit: drawConduit, spur: drawSpur, post: drawPost, lamp: drawLamp,
    pallet: drawPallet, cabinet: drawCabinet, spool: drawSpool, drum: drawDrum,
    scrub: drawScrub, rock: drawRock
  };

  /* Dispatch table for the six, mirroring rocket-engine's KIND map. drawMachine
     stays as the fallback so a new station renders as something before it gets
     its own drawer. */
  var BESPOKE = {
    alerting:  drawAlerting,
    echo:      drawEcho,
    indexer:   drawIndexer
  };

  /* Drawn like machines but never fired: they consume events, not documents. */
  var OFFBELT_DRAW = {
    audit:     drawTower,
    reporting: drawReporting
  };

  var BESPOKE_SUB = {
    alerting:  'ec-alerting-service',
    echo:      'ec-echo-engine',
    indexer:   'ec-indexer',
    audit:     'ec-centralised-audit',
    reporting: 'ec-reporting'
  };

  /* ---- side structure ----------------------------------------------------- */

  /* The eleven off-belt repos. They are machinery too — plant standing away
     from the belt, not offices: a plinth, a panelled casing, a flat capped top
     with a vent stack and a louvre bank, and a standby lamp. (They carried a
     gable roof while this floor was still a city; a pitched roof is the one
     shape that instantly reads as a building.) */
  function drawSideStruct(o) {
    var sf = o.y + o.d + 0.01;
    var rows, cols, r, c, z0, z1, u0, u1;

    var body   = Iso.mix(o.color, '#8e939c', 0.28);
    var plinth = Iso.mix(o.color, '#101216', 0.62);
    var cap    = Iso.mix(o.color, '#9aa2ae', 0.44);

    /* plinth */
    Iso.box(ctx, { x: o.x-0.12, y: o.y-0.12, z: 0, w: o.w+0.24, d: o.d+0.24,
                   h: 0.20, color: plinth });

    /* casing */
    Iso.box(ctx, { x: o.x, y: o.y, z: 0.20, w: o.w, d: o.d, h: o.h,
                   color: body });

    /* ribbed sheet panels on the viewer-facing face */
    rows = Math.max(2, Math.round(o.h * 0.85));
    cols = Math.max(2, Math.round(o.w * 0.6));
    for (r = 0; r < rows; r++) {
      z0 = 0.28 + (o.h - 0.1) * ((r + 0.18) / rows);
      z1 = 0.28 + (o.h - 0.1) * ((r + 0.82) / rows);
      for (c = 0; c < cols; c++) {
        u0 = o.x + o.w * ((c + 0.12) / cols);
        u1 = o.x + o.w * ((c + 0.88) / cols);
        ctx.fillStyle = (r === rows - 1) ? GLAZE : RIB;
        Iso.poly(ctx, [P(u0, sf, z0), P(u1, sf, z0), P(u1, sf, z1), P(u0, sf, z1)]);
      }
    }

    /* louvre bank low on the face — the vent intake */
    var lz = 0.34, lStep = 0.13;
    for (r = 0; r < 4; r++) {
      ctx.fillStyle = (r % 2) ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.07)';
      Iso.poly(ctx, [P(o.x+0.30, sf, lz + r*lStep), P(o.x+o.w-0.30, sf, lz + r*lStep),
                     P(o.x+o.w-0.30, sf, lz + r*lStep + 0.08),
                     P(o.x+0.30, sf, lz + r*lStep + 0.08)]);
    }

    /* flat cap: a raised deck rather than a roof, with a kerb all round */
    Iso.box(ctx, { x: o.x-0.14, y: o.y-0.14, z: 0.20 + o.h,
                   w: o.w+0.28, d: o.d+0.28, h: 0.16, color: cap });
    Iso.box(ctx, { x: o.x+0.20, y: o.y+0.20, z: 0.20 + o.h + 0.16,
                   w: o.w-0.40, d: o.d-0.40, h: 0.10, color: plinth });

    /* vent stack and a cooling drum on the deck */
    var top = 0.20 + o.h + 0.26;
    Iso.cylinder(ctx, { x: o.x + o.w - 0.75, y: o.y + o.d - 0.70, z: top,
                        r: 0.20, h: 0.62, color: plinth });
    Iso.cylinder(ctx, { x: o.x + 0.80, y: o.y + o.d - 0.70, z: top,
                        r: 0.30, h: 0.26, color: cap, ring: 0.55 });

    /* standby lamp — dim red at rest, pulsing green while this repo is live */
    var lp = o.active ? (0.70 + 0.30 * Math.sin(clk * 5)) : 0.60;
    ctx.fillStyle = o.active
      ? 'rgba(90,210,80,' + lp.toFixed(2) + ')'
      : 'rgba(185,55,45,0.55)';
    Iso.disc(ctx, o.x + o.w - 0.4, o.y + 0.32, top + 0.04, 0.11);

    /* short name on the face */
    var slug = (o.label || o.id || '').replace(/^ec-/, '').split('-').slice(0, 2).join('-');
    faceText(o.x + 0.28, sf, o.h - 0.30, [slug], { size: 6.0, color: 'rgba(16,14,10,0.55)' });
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

  /* ---- the carrier: one communication, gaining verdicts as it travels -----
   *
   * The best thing rocket-engine does is let you watch the thing on the belt
   * change — it leaves goods-in as bar stock and reaches the pad as an engine.
   * The analogue here runs the other way: a communication does not grow, it
   * SHEDS. ec-gateway strips the message body, so the payload block loses most
   * of its mass at station one, and everything after that is verdicts, stamps
   * and receipts attaching to a much smaller object.
   *
   * Every part is keyed off state.charged, which records the stations this trip
   * has actually fired — so on the short route (not sampled) the alert crates
   * and the index chip never appear, and you can see that they didn't.
   * ---------------------------------------------------------------------- */

  /* Place a part in carrier-local space: u runs along the heading, v across. */
  function carrierPart(f, u, v, z, len, wid, h, color, edge) {
    Iso.orientedBox(ctx, {
      x: f.x + f.hx * u - f.hy * v,
      y: f.y + f.hy * u + f.hx * v,
      z: z, hx: f.hx, hy: f.hy,
      len: len, wid: wid, h: h, color: color, edge: edge
    });
  }

  function cpx(f, u, v) { return f.x + f.hx * u - f.hy * v; }
  function cpy(f, u, v) { return f.y + f.hy * u + f.hx * v; }

  function drawCarrier(vanPos, s) {
    if (!s.running && !s.finished) return;

    var m = Math.hypot(vanPos.dx || 0, vanPos.dy || 1) || 1;
    var f = { x: vanPos.x, y: vanPos.y,
              hx: (vanPos.dx || 0) / m, hy: (vanPos.dy || 1) / m };
    var done = s.charged || {};
    var i;

    /* The belt now stands off the slab, so everything on the carrier is lifted
       by that height — otherwise the skid sinks into the deck it rides on. */
    var BZ = (Factory.BELT_H != null) ? Factory.BELT_H : 0;

    /* skid and deck */
    carrierPart(f, 0, 0, BZ + 0.06, 2.10, 1.46, 0.14, '#151922', false);
    carrierPart(f, 0, 0, BZ + 0.20, 1.94, 1.30, 0.10, '#2c3446', false);

    /* ---- the payload ----
       Full document until the gateway strips it; a fraction of the size after,
       and shifted to the rear to leave deck space for what accumulates. */
    var stripped = !!done.gateway;
    carrierPart(f,
      stripped ? -0.48 : 0, 0, BZ + 0.30,
      stripped ? 0.66 : 1.52,
      stripped ? 0.56 : 1.10,
      stripped ? 0.36 : 0.80,
      stripped ? '#78839a' : '#c9c2ae',
      'rgba(0,0,0,0.35)');

    /* ---- pipeline tags: one upright plate per matched pipeline ----
       They stand short and grey out of the qualifier, then grow and turn amber
       once the filter has ruled on each one. */
    if (done.qualifier) {
      var pipes = Math.min(4, s.pipelineCount || 2);
      var ruled = !!done.filter;
      for (i = 0; i < pipes; i++) {
        carrierPart(f, 0.30, -0.39 + i * 0.26, BZ + 0.30,
                    0.14, 0.18, ruled ? 0.44 : 0.24,
                    ruled ? '#e0b840' : '#485266', false);
      }
    }

    /* ---- Cognition pending: content policies are still out for evaluation --- */
    if (done.evaluator && (s.sentToCognition || 0) > 0) {
      var ax = cpx(f, 0.74, 0), ay = cpy(f, 0.74, 0);
      Iso.cylinder(ctx, { x: ax, y: ay, z: BZ + 0.30, r: 0.05, h: 0.52,
                          color: '#1e5048', edge: false });
      ctx.fillStyle = (Math.sin(clk * 5) > 0) ? '#7ce0d0' : '#20443e';
      Iso.disc(ctx, ax, ay, BZ + 0.86, 0.11);
    }

    /* ---- the sampling stamp: green if a human will read this, red if not --- */
    if (done.quota) {
      ctx.fillStyle = s.sampled ? '#4ad066' : '#c04040';
      Iso.disc(ctx, cpx(f, -0.02, 0.50), cpy(f, -0.02, 0.50), BZ + 0.32, 0.17);
    }

    /* ---- alert crates: one per sampled pipeline ---- */
    if (done.alerting) {
      var made = Math.min(3, s.alertsCreated || 0);
      for (i = 0; i < made; i++) {
        carrierPart(f, -0.06 + i * 0.32, 0.36, BZ + 0.40, 0.28, 0.28, 0.26,
                    i % 2 ? '#c05070' : '#a84860', 'rgba(0,0,0,0.30)');
      }
    }

    /* ---- echo verdict: new, or a repeat of something already raised ---- */
    if (done.echo) {
      ctx.fillStyle = s.isEcho ? '#ff7060' : '#a870d8';
      Iso.disc(ctx, cpx(f, -0.58, -0.42), cpy(f, -0.58, -0.42), BZ + 0.42, 0.13);
    }

    /* ---- index chip ---- */
    if (done.indexer) {
      carrierPart(f, -0.30, -0.40, BZ + 0.40, 0.32, 0.22, 0.13, '#e09040', false);
    }

    /* ---- audit receipts, stacked ---- */
    var receipts = (done.audit ? 1 : 0) + (done.reporting ? 1 : 0);
    for (i = 0; i < receipts; i++) {
      carrierPart(f, 0.58, 0.28, BZ + 0.40 + i * 0.10, 0.42, 0.34, 0.09,
                  i ? '#b0704c' : '#9a5038', false);
    }

    /* ---- latency gauge along the near side of the deck ----
       Both track and fill set their own fillStyle: the old version set it only
       for the fill, so the track picked up whatever colour ran last. */
    var maxMs = 120000;
    var frac = Math.min(1, (s.latencyMs || 0) / maxMs);
    var gx0 = cpx(f, -0.84, -0.58), gy0 = cpy(f, -0.84, -0.58);
    var gx1 = cpx(f,  0.84, -0.58), gy1 = cpy(f,  0.84, -0.58);
    ctx.fillStyle = 'rgba(10,14,22,0.85)';
    Iso.ribbon(ctx, gx0, gy0, gx1, gy1, 0.18, BZ + 0.32);
    if (frac > 0) {
      ctx.fillStyle = frac > 0.7 ? '#d04040' : (frac > 0.4 ? '#d09030' : '#40a060');
      Iso.ribbon(ctx, gx0, gy0,
                 gx0 + (gx1 - gx0) * frac, gy0 + (gy1 - gy0) * frac, 0.14, BZ + 0.33);
    }
  }

  /* ---- KEDA replica cylinders -------------------------------------------- */

  /* One cylinder per live replica, stacked on the machine's own roof.
   *
   * Two things matter here and both were wrong when this was first enabled: the
   * stack must sit ON the machine, not on the apron between it and the belt —
   * that strip is where the carrier passes — and it must be drawn from inside
   * the depth-sorted pass, or it paints over whatever is in front of it,
   * carrier included.
   */
  function drawReplicaStack(o, ph, top) {
    if (!ph) return;
    var repColor = ph.overThresh ? '#a83020' : '#2a7030';
    var n = Math.min(12, ph.replicas || 0);
    var bx = o.x - o.w / 2, by = o.y - o.d / 2;
    /* back-right corner of the roof, marching along +x and away from the belt */
    var cx = bx + o.w - 0.85, cy = by + 0.55;
    for (var r = 0; r < n; r++) {
      Iso.cylinder(ctx, {
        x: cx - (r % 4) * 0.42, y: cy + Math.floor(r / 4) * 0.42,
        z: (top != null ? top : o.h + 0.38) + 0.02,
        r: 0.19, h: 0.42, color: repColor, edge: false
      });
    }
    if (ph.overThresh) {
      ctx.fillStyle = 'rgba(255,110,80,' + (0.5 + 0.45*Math.abs(Math.sin(clk*4))).toFixed(2) + ')';
      Iso.disc(ctx, cx + 0.30, cy - 0.30, (top != null ? top : o.h + 0.38) + 0.50, 0.14);
    }
  }

  function phaseFor(plan, id) {
    if (!plan || !plan.phases) return null;
    for (var i = 0; i < plan.phases.length; i++) {
      if (plan.phases[i].id === id) return plan.phases[i];
    }
    return null;
  }

  /* ---- label queue -------------------------------------------------------- */

  /* sx,sy  = bubble centre in iso-screen coords (high above the building)
     ax,ay  = anchor/leader-line target in iso-screen coords (building top)
             if omitted, anchor = bubble centre (no leader line)            */
  function addLabel(sx, sy, text, sub, color, sub2, ax, ay, act) {
    labels.push({
      sx: sx, sy: sy,
      ax: (ax !== undefined) ? ax : sx,
      ay: (ay !== undefined) ? ay : sy,
      text: text, sub: sub, sub2: sub2,
      color: color || '#607090',
      act: !!act
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

    /* Twenty-five plates at once is an unreadable pile, and the thing it hides
       is the floor — which is the only reason to be zoomed out at all. Below
       HIDE just the live station keeps its plate; between HIDE and COMPACT the
       plates keep the service name but drop the sub-lines. Default framing is
       0.95 and zoom-fit lands near 0.33, so a full-floor view declutters and
       the view you start in does not. */
    var HIDE = 0.46, COMPACT = 0.70;
    var hideOthers = cam.scale < HIDE;
    var compact    = cam.scale < COMPACT;

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
      if (hideOthers && !lb.act) continue;

      /* the live plate keeps its detail at every zoom; the rest shed it */
      var lsub  = (compact && !lb.act) ? null : lb.sub;
      var lsub2 = (compact && !lb.act) ? null : lb.sub2;

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
      if (lsub)  { ctx.font = fss  + 'px system-ui,sans-serif'; tw2 = ctx.measureText(lsub).width;  }
      tw3 = 0;
      if (lsub2) { ctx.font = fss2 + 'px system-ui,sans-serif'; tw3 = ctx.measureText(lsub2).width; }

      bw = Math.max(tw1, tw2, tw3) + padH * 2;
      lineCount = 1 + (lsub ? 1 : 0) + (lsub2 ? 1 : 0);
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
        ctx.fillText(lsub,    bpx, bpy + lineH / 2);
      } else {
        ctx.fillText(lb.text, bpx, bpy - lineH);
        ctx.font = fss + 'px system-ui,sans-serif'; ctx.fillStyle = '#445060';
        ctx.fillText(lsub,    bpx, bpy);
        ctx.font = fss2 + 'px system-ui,sans-serif'; ctx.fillStyle = '#607888';
        ctx.fillText(lsub2,   bpx, bpy + lineH);
      }
    }

    ctx.restore();
  }

  /* ---- main draw entry point ---------------------------------------------- */

  function draw(canvas, camIn, clock, activeId, hoverDistId) {
    cam = camIn;
    clk = clock;
    ctx = canvas.getContext('2d');
    Kit.bind(ctx, clk);          /* the kit draws onto this canvas, this frame */
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
    /* The trench network is a cut into the slab, so it goes down BEFORE the
       belt — that is what lets a run pass under the conveyor instead of being
       painted over it. Everything else flat is paint ON the slab and goes
       after. */
    drawTrenches();
    drawBelt();
    drawDecals();          /* flat floor paint — must precede every solid */

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

    /* stanchions carrying the overhead runs — solids, so they sort */
    World.RELAY_POSTS.forEach(function (pt) {
      objects.push({ kind: 'relaypost', pt: pt, sortKey: pt.x + pt.y });
    });

    /* off-belt structures: the record keepers, inside the U. They are not
       stations — the simulation never fires them — but they are solids on the
       floor and sort like anything else. */
    World.OFFBELT.forEach(function (ob) {
      objects.push({
        kind:     'offbelt',
        x: ob.x, y: ob.y, w: ob.w, d: ob.d, h: ob.h,
        color:    ob.color,
        id:       ob.id,
        label:    ob.label,
        sublabel: ob.sublabel,
        active:   ob.id === activeId || ob.id === hoverDistId,
        sortKey:  ob.x + ob.y
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

    /* floor props — into the same sorted pass so a crate in front of a machine
       occludes it and one behind does not. A conduit run spans the floor, so it
       sorts on its midpoint. */
    World.props.forEach(function (pr) {
      var fn = PROP_KIND[pr.kind];
      if (!fn) return;
      var key = pr.kind === 'conduit'
        ? (pr.x0 + pr.y0 + pr.x1 + pr.y1) / 2
        : pr.x + pr.y;
      /* x+y is the right depth key for things of similar height standing near
         each other. It is the wrong key for a knee-high bush sitting off the
         north edge of the slab at a large x: its x+y can exceed that of a
         5-unit-tall machine standing well in front of it, and the bush then
         paints over the machine's roof. Nothing north of the slab can legally
         occlude anything on it, so that scenery is pushed to the back. */
      if ((pr.kind === 'scrub' || pr.kind === 'rock') && pr.y < 1) key -= 1000;
      objects.push({ kind: 'prop', fn: fn, pr: pr, sortKey: key });
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
          /* The press draws its own replica stack, on its own roof — the
             declared w/d is the reserved floor area, not the casing. */
          drawGateway(o, o.active);
          bub = P(13.7, o.y, 3.9 + ZL);
          anc = P(13.7, o.y, 3.9);
          addLabel(bub.x, bub.y, 'GATEWAY', 'ec-gateway',
                   o.active ? '#8fd4ff' : '#7f93a8',
                   'k8s', anc.x, anc.y, o.active);

        } else if (o.id === 'qualifier') {
          /* Draws its own replica rack, like the press: the declared w/d is
             reserved floor area, not the casing. */
          drawQualifier(o, o.active);
          bub = P(23.2, o.y, 3.6 + ZL);
          anc = P(23.2, o.y, 3.6);
          addLabel(bub.x, bub.y, 'QUALIFIER', 'ec-queue-qualifier',
                   o.active ? '#c4b4ff' : '#8b83a8',
                   'k8s', anc.x, anc.y, o.active);

        } else if (o.id === 'filter') {
          drawFilter(o, o.active);
          bub = P(33.3, o.y, 3.6 + ZL);
          anc = P(33.3, o.y, 3.6);
          addLabel(bub.x, bub.y, 'FILTER', 'ec-surveillance-filter',
                   o.active ? '#ffe060' : '#9a8c5c',
                   'k8s', anc.x, anc.y, o.active);

        } else if (o.id === 'evaluator') {
          drawEvaluator(o, o.active);
          bub = P(43.4, o.y, 3.6 + ZL);
          anc = P(43.4, o.y, 3.6);
          addLabel(bub.x, bub.y, 'EVALUATOR', 'ec-surveillance-policy-evaluator',
                   o.active ? '#48d8c0' : '#5c9a90',
                   'k8s', anc.x, anc.y, o.active);

        } else if (o.id === 'indexer') {
          drawIndexer(o, o.active, s);
          bub = P(34.0, o.y, 3.6 + ZL);
          anc = P(34.0, o.y, 3.6);
          addLabel(bub.x, bub.y, 'INDEXER', 'ec-indexer',
                   o.active ? '#ffc078' : '#a8906c',
                   'k8s', anc.x, anc.y, o.active);

        } else if (o.id === 'echo') {
          drawEcho(o, o.active, s);
          bub = P(44.0, o.y, 3.6 + ZL);
          anc = P(44.0, o.y, 3.6);
          addLabel(bub.x, bub.y, 'ECHO', 'ec-echo-engine',
                   o.active ? '#c9a0f0' : '#9080a8',
                   'k8s', anc.x, anc.y, o.active);

        } else if (o.id === 'alerting') {
          /* draws its own replica rack, like the rest of the rebuilt row */
          drawAlerting(o, o.active, s);
          bub = P(53.6, o.y, 3.6 + ZL);
          anc = P(53.6, o.y, 3.6);
          addLabel(bub.x, bub.y, 'ALERTING', 'ec-alerting-service',
                   o.active ? '#ff9ab0' : '#a8808c',
                   'k8s', anc.x, anc.y, o.active);

        } else if (BESPOKE[o.id]) {
          BESPOKE[o.id](o, o.active, s);
          drawReplicaStack(o, phaseFor(plan, o.id), o.h + 0.38);
          bub = P(o.x, o.y, o.h + ZL);
          anc = P(o.x, o.y, o.h + 0.1);
          addLabel(bub.x, bub.y, o.id, BESPOKE_SUB[o.id],
                   o.active ? '#e0c060' : '#8090a8',
                   'k8s', anc.x, anc.y, o.active);

        } else {
          drawMachine(o);
          bub = P(o.x, o.y, o.h + ZL);
          anc = P(o.x, o.y, o.h + 0.1);
          addLabel(bub.x, bub.y, o.id, null,
                   o.active ? '#e0c060' : '#8090a8',
                   null, anc.x, anc.y, o.active);
        }

      } else if (o.kind === 'gate') {
        drawQuota(o, o.active, s);
        bub = P(53.1, 16.3, 3.6 + ZL);
        anc = P(53.1, 16.3, 3.6);
        addLabel(bub.x, bub.y, 'QUOTA', 'ec-surveillance-quota-manager',
                 o.active ? '#f0d040' : '#a89a62',
                 'k8s', anc.x, anc.y, o.active);

      } else if (o.kind === 'relaypost') {
        tubePost(o.pt.x, o.pt.y, o.pt.z);

      } else if (o.kind === 'offbelt') {
        /* still on their first-pass drawers; the tower and its annex come next */
        (OFFBELT_DRAW[o.id] || drawMachine)(o, o.active, s);
        drawReplicaStack(o, phaseFor(plan, o.id), o.h + 0.38);
        bub = P(o.x, o.y, o.h + ZL);
        anc = P(o.x, o.y, o.h + 0.1);
        addLabel(bub.x, bub.y, o.label, o.sublabel,
                 o.active ? '#e0c060' : '#8090a8',
                 'k8s', anc.x, anc.y, o.active);

      } else if (o.kind === 'side') {
        /* side structs: o.x/o.y is the NW corner; use box centre for both */
        var scx = o.x + o.w / 2, scy = o.y + o.d / 2;
        drawSideStruct(o);
        bub = P(scx, scy, o.h + ZL - 2);
        anc = P(scx, scy, o.h + 0.2);
        addLabel(bub.x, bub.y, o.label, o.sublabel,
                 o.active ? '#a0c8f0' : '#6880a0',
                 null, anc.x, anc.y, o.active);

      } else if (o.kind === 'cognition') {
        var cgcx = cg.x + cg.w / 2, cgcy = cg.y + cg.d / 2;
        /* the link leaves the CIMS mast on the evaluator's south lane, not
           the middle of the station */
        drawCognition(busy('evaluator') && s.sentToCognition > 0,
                      evalSt ? { x: 41.55, y: 2.44 } : null);
        bub = P(cgcx, cgcy, cg.h + ZL - 2);
        anc = P(cgcx, cgcy, cg.h + 0.2);
        addLabel(bub.x, bub.y, 'Cognition', 'external', '#607090',
                 null, anc.x, anc.y, s.sentToCognition > 0);

      } else if (o.kind === 'carrier') {
        drawCarrier(o.pos, s);

      } else if (o.kind === 'prop') {
        o.fn(o.pr);
      }
    });

    /* archive source marker — same x,y for both so line is vertical */
    var srcAnc = P(4, 6, 0.1);
    var srcBub = P(4, 6, 5.1);
    addLabel(srcBub.x, srcBub.y, 'Archive', 'supBulkIndexingTopic_k8s', '#506070',
             null, srcAnc.x, srcAnc.y);

    /* KEDA replica stacks are drawn per machine inside the sorted pass above,
       so they occlude correctly. Nothing to do here. */

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

    /* Above everything, and provably so: at z 4.5 an overhead run clears the
       carrier by some 170 px in screen space. */
    drawRelayOverhead();

    ctx.restore();

    /* ---- label pass (physical pixel space, after restore) ---- */
    drawLabels(dpr);
  }

  function setLabels(v) { showLabels = v; }

  global.Renderer = { draw: draw, setLabels: setLabels };
})(window);
