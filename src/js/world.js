/* world.js: EC City — routes, stations, districts, buildings, props.
 *
 * Districts match the seven named districts in system-explainer-input.md:
 *   Control Plane, Ingestion, Qualification, Evaluation,
 *   Sampling/Alerting, Search/Review, Audit/Reporting.
 *
 * The vehicle (a communication) enters from the Archive Dock and travels
 * through 9 processing stations. If sampled it takes the full alert road;
 * if not sampled it takes the short audit road directly.
 *
 * Roads = Kafka topics. Dashed centre line = CDC / Debezium outbox.
 */
(function (global) {
  'use strict';

  var Iso = global.Iso;
  var makeRoute = Iso.makeRoute;

  /* ---- routes ------------------------------------------------------------ */

  /* The main pipeline road — archive dock through quota manager. */
  var OUT = makeRoute([
    [5, 11],       // 0  Archive Dock — where the communication begins
    [15, 11],      // 1  Customs House (ec-gateway)
    [26, 11],      // 2  Sorting Office (ec-queue-qualifier)
    [38, 11],      // 3  Filtration Plant (ec-surveillance-filter)
    [50, 11],      // 4  corner
    [50, 22]       // 5  Weighbridge (ec-surveillance-quota-manager)
  ]);

  /* The Dispatch Office lives on a spur between filter and quota manager.
     The vehicle passes through it on the way, so we model it as the evaluator
     leg sitting off the corner. For routing simplicity, evaluator is a
     station on OUT at index 4 (the corner waypoint). */

  /* The alert road — sampled communications travel to the alerting district,
     then echo, then indexer, then the audit hall. */
  var ALERT = makeRoute([
    [50, 22],      // 0  from quota manager
    [50, 34],      // 1  corner
    [40, 40],      // 2  Assembly Hall (ec-alerting-service)
    [28, 40],      // 3  Fingerprint File (ec-echo-engine)
    [16, 40],      // 4  Rail Yard (ec-indexer)
    [6, 40],       // 5  corner
    [6, 30],       // 6  Records Hall (ec-centralised-audit / ec-reporting)
    [6, 11]        // 7  back to archive
  ]);

  /* The audit road — non-sampled communications skip alerting and go
     straight to the audit ledger, then home. */
  var AUDIT = makeRoute([
    [50, 22],      // 0  from quota manager
    [30, 22],      // 1  Records Hall shortcut
    [6, 22],       // 2  corner
    [6, 11]        // 3  back to archive
  ]);

  function station(route, idx, id, dwell) {
    return { dist: route.cum[idx], id: id, dwell: dwell == null ? 0.8 : dwell };
  }

  var STATIONS = {
    out: [
      station(OUT, 1, 'gateway',   1.6),
      station(OUT, 2, 'qualifier', 1.4),
      station(OUT, 3, 'filter',    1.4),
      station(OUT, 4, 'evaluator', 1.8), // corner = where evaluator sits
      station(OUT, 5, 'quota',     1.6)
    ],
    alert: [
      station(ALERT, 2, 'alerting', 1.6),
      station(ALERT, 3, 'echo',     1.2),
      station(ALERT, 4, 'indexer',  1.2),
      station(ALERT, 6, 'audit',    1.4)
    ],
    audit: [
      station(AUDIT, 1, 'audit', 1.4)
    ]
  };

  /* Two routes can show the same write-up (audit appears on both paths). */
  var STATION_TO_DISTRICT = {
    gateway:   'gateway',
    qualifier: 'qualifier',
    filter:    'filter',
    evaluator: 'evaluator',
    quota:     'quota',
    alerting:  'alerting',
    echo:      'echo',
    indexer:   'indexer',
    audit:     'audit'
  };

  /* ---- palette ----------------------------------------------------------- */

  var C = {
    steel:   '#4a7a9b',   // gateway
    violet:  '#6f63a8',   // qualifier
    ochre:   '#c2913c',   // filter
    teal:    '#3f8a86',   // evaluator
    sage:    '#6d9068',   // quota
    rose:    '#b05470',   // alerting
    plum:    '#8b5f96',   // echo
    orange:  '#c07a3c',   // indexer
    brick:   '#a85a44',   // audit / reporting
    moss:    '#5f8a52',   // config curator
    stone:   '#7d8b96',
    ink:     '#4a4540',
    paper:   '#e5e1d5',
    road:    '#c9c4b6',
    roadTop: '#d8d3c6'
  };

  /* ---- districts --------------------------------------------------------- */

  var DISTRICTS = [
    {
      id: 'gateway', name: 'Customs House', x: 15, y: 11, r: 4.8, color: C.steel,
      tag: 'Archive → miniIndexable',
      short: 'Every communication starts here: the gateway opens the full archive file, strips the body, and files one countable receipt.',
      body: 'The archive announces that a communication exists on a Kafka topic — ' +
        'the gateway\'s only job is to turn that announcement into two things: a small ' +
        'miniIndexable.json (about 12% of the original size, body and attachments stripped) ' +
        'written to S3, and one row in a MongoDB outbox keyed by a reconciliation token. ' +
        'That row is what Debezium publishes onto the road out. The gateway downloads the ' +
        'full indexable.json in parallel byte-range chunks of 5 MB each — drag Doc Size up ' +
        'and watch the download time grow. The ledger row stamped here is what the audit ' +
        'district counts against at the end to prove every communication was processed.'
    },
    {
      id: 'qualifier', name: 'Sorting Office', x: 26, y: 11, r: 4.6, color: C.violet,
      tag: 'Who is being watched?',
      short: 'The qualifier intersects the communication\'s participants with a frozen snapshot of every monitored population.',
      body: 'A surveillance pipeline is a named review queue — one compliance team\'s ' +
        'inbox. The qualifier streams the participant list out of S3 and looks them up ' +
        'in pipeline-entity-mapping_{windowToken}, a MongoDB collection that is a ' +
        'frozen photograph of who was under surveillance at the moment this window opened. ' +
        'It found ' + '{participants}' + ' participants and matched ' + '{pipelineCount}' + ' pipelines. ' +
        'If the number were zero the communication leaves on the audit road immediately: ' +
        '"nobody is watching this" is a recorded verdict here, not a silence. The ' +
        'windowToken is the key: it is what prevents a midday policy change from ' +
        'retroactively re-categorising this morning\'s emails.'
    },
    {
      id: 'filter', name: 'Filtration Plant', x: 38, y: 11, r: 4.6, color: C.ochre,
      tag: 'Ignore → flag, per pipeline',
      short: 'Two screens in series: ignore policies remove noise first, then flag policies select anything genuinely reviewable.',
      body: 'Each pipeline has two kinds of rules. Ignore policies run first — they ' +
        'suppress newsletters, automated system messages, internal IT noise. Then flag ' +
        'policies run over what survives — they select communications that match a ' +
        'surveillance scenario. Suppression always wins because it is evaluated first. ' +
        'The vehicle now carries one verdict per pipeline rather than one verdict overall, ' +
        'because the same communication can be FILTERED for one team and QUALIFIED for ' +
        'another. Drag the content policy share down to zero and watch the evaluator ' +
        'station cost collapse — most of that cost is waiting for Cognition to answer.'
    },
    {
      id: 'evaluator', name: 'Dispatch Office', x: 50, y: 14, r: 4.8, color: C.teal,
      tag: 'Metadata local · content shipped',
      short: 'Policies that need the message body are crated up and sent to Cognition; the office keeps the paperwork open until the lab report returns.',
      body: 'The policy evaluator splits its work in two. Metadata-only policies — sender ' +
        'domain, timestamp, participant count — are decided instantly. Policies that need ' +
        'the actual content are sent to Cognition, an external analytics platform, as a ' +
        'CIMS payload, and the evaluator waits asynchronously for the COMS response. ' +
        '{sentToCognition} pipeline(s) have been sent away; the wait counter is running ' +
        'against a hard ceiling of 2.5 hours, after which the outcome is recorded as a ' +
        'timeout rather than lost. This station is a router and a timekeeper: it never ' +
        'judges content itself, which is why its building is an outbound freight bay.'
    },
    {
      id: 'quota', name: 'Weighbridge', x: 50, y: 22, r: 4.8, color: C.sage,
      tag: 'Atomic quota · sampled or not',
      short: 'Regulated review is a defined percentage of traffic — the atomic Redis counter is what prevents thirty-two replicas from together overshooting it.',
      body: 'A single Redis INCR is shared by every replica of this service — that is ' +
        'the only way to make the quota decision consistent across a horizontally-scaled ' +
        'fleet. The counter reads {quotaUsed} of {quotaLimit} for this pipeline\'s bucket. ' +
        '{sampled}: being unsampled is an audited verdict, recorded in the ledger just ' +
        'like a positive decision. Drag Sampling % down and watch the vehicle start ' +
        'turning toward the short audit road more often — not because fewer communications ' +
        'arrive, but because the quota fills faster. The quota window resets every 24 hours.'
    },
    {
      id: 'alerting', name: 'Assembly Hall', x: 40, y: 40, r: 5.0, color: C.rose,
      tag: 'Four suppliers · one alert',
      short: 'Four data sources are fetched in parallel and assembled into one durable SupervisedItem document that will sit in a reviewer\'s queue.',
      body: 'An alert is assembled, not merely recorded. In parallel: the message body ' +
        'from S3, the monitored populations from the qualifier, the policy details from ' +
        'the filter, and the Cognition scenario hits from ea-storage. All four must arrive ' +
        'before the supervised item is written. {alertsCreated} alert(s) created — one per ' +
        'sampled pipeline, because the same communication can require review in two ' +
        'different queues for two different reasons. The alert and an outbox row are ' +
        'written together inside a single MongoDB operation, so the alert cannot exist in ' +
        'a reviewer\'s queue without also existing on the road out of this building.'
    },
    {
      id: 'echo', name: 'Fingerprint File', x: 28, y: 40, r: 4.6, color: C.plum,
      tag: 'Same violation · same thread?',
      short: 'The echo engine never reads the message text — it compares a 32-character fingerprint of the policy hits against every fingerprint seen on this thread in the last 14 days.',
      body: 'On a long email thread re-scanned after every reply, the same surveillance ' +
        'scenario would raise an alert for every message. The echo engine prevents that by ' +
        'fingerprinting the policy hit set with MD5 and doing one indexed MongoDB lookup ' +
        'against all fingerprints from the same conversation thread in the last 14 days. ' +
        'This communication\'s fingerprint is {fingerprint}. Echo: {isEcho}. If it is an ' +
        'echo, the earlier alert is re-opened and updated rather than a new one created, ' +
        'so a reviewer reads one alert and not thirty. The 14-day window is exact, not ' +
        'approximate — it is a MongoDB TTL index on the echo-state collection.'
    },
    {
      id: 'indexer', name: 'Rail Yard', x: 16, y: 40, r: 4.8, color: C.orange,
      tag: 'Batch → Elasticsearch',
      short: 'The indexer does not write one document at a time — it fills a train of 50 records and shunts them into Elasticsearch in a single bulk request.',
      body: 'Search is expensive per-request and cheap per-byte, so the indexer accumulates ' +
        'up to 50 records before flushing an Elasticsearch bulk request. This communication ' +
        'is record {batchPosition} in a batch that will flush {bulkBytes} KB. Audio calls ' +
        'get a second child document holding the transcript, attached to the same parent. ' +
        'One poison record is retried alone — it does not hold back the other 49. The ' +
        'indexer is the reason a compliance reviewer can type a name and find every ' +
        'communication that person sent. Without it, alerts exist but cannot be searched.'
    },
    {
      id: 'audit', name: 'Records Hall', x: 18, y: 30, r: 5.0, color: C.brick,
      tag: 'Receipt + reconciliation',
      short: 'Every verdict the vehicle collected is mirrored here as an audit event, and a tally cron compares the completed count against the gateway\'s ingest watermark to prove nothing was lost.',
      body: 'The audit ledger receives a copy of every service\'s verdict: qualified, ' +
        'filtered, sampled, not-sampled, alerted, indexed. It stitches them into one ' +
        'record per communication, marking it complete only when every pipeline has ' +
        'reached a terminal state. {auditEventsEmitted} receipt(s) filed so far for this ' +
        'communication. A ShedLock-guarded cron then calls the gateway\'s watermark API: ' +
        '"how many did you ingest for reconciliation token X?" and compares that against ' +
        '"how many completed records do I hold for X?" Agreement between two independently ' +
        'produced counts is what "we can prove it" means in regulated surveillance. A ' +
        'missed day\'s rotation makes the counts irreconcilable — that is why ec-config-curator ' +
        'is the most consequential service in the city.'
    }
  ];

  var DISTRICT_BY_ID = {};
  DISTRICTS.forEach(function (d) { DISTRICT_BY_ID[d.id] = d; });

  function readSeconds(stationId) {
    var d = DISTRICT_BY_ID[STATION_TO_DISTRICT[stationId] || stationId];
    if (!d) return 9;
    var words = (d.short + ' ' + d.body).split(/\s+/).length;
    return Math.min(26, Math.max(9, words / 3.8 + 3.5));
  }

  /* ---- buildings and props ----------------------------------------------- */

  var buildings = [];
  var props = [];

  function put(o) { buildings.push(o); return o; }

  function block(x, y, o) {
    put({
      x: x, y: y, z: 0, w: o.w, d: o.d, h: o.h, color: o.color,
      roof: o.roof, roofH: o.roofH,
      windows: { cols: o.cols || 3, seed: Math.round(x * 7 + y * 13), color: o.lit }
    });
  }

  function distToRoutes(x, y) {
    var best = 1e9;
    [OUT, ALERT, AUDIT].forEach(function (r) {
      r.segs.forEach(function (s) {
        var vx = s.b.x - s.a.x, vy = s.b.y - s.a.y;
        var denom = vx * vx + vy * vy;
        if (denom < 0.0001) return;
        var t = ((x - s.a.x) * vx + (y - s.a.y) * vy) / denom;
        t = Math.max(0, Math.min(1, t));
        var d = Math.hypot(x - (s.a.x + vx * t), y - (s.a.y + vy * t));
        if (d < best) best = d;
      });
    });
    return best;
  }

  function build() {
    if (buildings.length) return;

    /* -- Archive Dock: dockside structure where communications arrive --- */
    block(2.0, 7.0, { w: 2.6, d: 2.2, h: 2.0, color: '#b8b0a0', cols: 2, lit: C.stone });
    block(2.2, 12.2, { w: 2.4, d: 2.0, h: 1.6, color: '#c0b8a8', cols: 2, lit: C.stone });
    put({ kind: 'crane', x: 4.0, y: 9.0, color: C.stone });

    /* -- Customs House (ec-gateway): a dockside customs hall with shredder */
    put({
      x: 12.0, y: 7.8, z: 0, w: 5.2, d: 3.4, h: 3.2, color: '#a0b8cc',
      panels: { cols: 5, seed: 2, color: '#bcd4e8' }, rooftop: C.steel
    });
    put({ kind: 'shredder', x: 11.6, y: 14.0, color: C.steel });
    block(18.4, 8.2, { w: 2.6, d: 2.4, h: 2.2, color: '#b4c8d8', cols: 2, lit: C.steel });

    /* -- Sorting Office (ec-queue-qualifier): mail sorting hall with pigeonholes */
    put({
      x: 23.0, y: 7.4, z: 0, w: 5.4, d: 3.2, h: 3.0, color: '#c4b8d8',
      windows: { cols: 4, seed: 7, color: C.violet }
    });
    put({ kind: 'pigeonholes', x: 22.8, y: 14.0, color: C.violet });
    block(29.4, 7.6, { w: 2.4, d: 2.2, h: 2.4, color: '#cec8e2', cols: 2, lit: C.violet });

    /* -- Filtration Plant (ec-surveillance-filter): two-stage screens */
    put({
      x: 34.8, y: 7.4, z: 0, w: 5.2, d: 3.2, h: 2.8, color: '#d8c498',
      panels: { cols: 5, seed: 3, color: '#ecd8b4', band: 1 }, rooftop: C.ochre
    });
    put({ kind: 'screens', x: 35.2, y: 14.0, color: C.ochre });
    block(40.8, 8.0, { w: 2.6, d: 2.0, h: 2.0, color: '#e2d0a4', cols: 2, lit: C.ochre });

    /* -- Dispatch Office (ec-surveillance-policy-evaluator): outbound freight bay */
    put({
      x: 53.0, y: 9.2, z: 0, w: 3.6, d: 4.8, h: 3.4, color: '#96c0bc',
      panels: { cols: 4, seed: 9, color: '#b4d8d4' }, rooftop: C.teal
    });
    put({ kind: 'freightBay', x: 58.0, y: 12.0, color: C.teal });
    block(46.0, 7.0, { w: 2.4, d: 2.2, h: 2.2, color: '#a8ccc8', cols: 2, lit: C.teal });

    /* -- Weighbridge (ec-surveillance-quota-manager): turnstile counters */
    put({
      x: 53.4, y: 19.0, z: 0, w: 5.0, d: 3.8, h: 2.8, color: '#a0b8a0',
      panels: { cols: 5, seed: 5, color: '#bcd4bc' }, rooftop: C.sage
    });
    put({ kind: 'weighbridge', x: 46.2, y: 22.0, color: C.sage });
    block(46.0, 17.0, { w: 2.2, d: 2.0, h: 2.4, color: '#b0c8b0', cols: 2, lit: C.sage });

    /* -- Assembly Hall (ec-alerting-service): parallel parts feeders */
    put({
      x: 36.0, y: 43.0, z: 0, w: 6.0, d: 4.0, h: 3.6, color: '#d09098',
      panels: { cols: 6, seed: 11, color: '#e4b0b8' }, rooftop: C.rose
    });
    put({ kind: 'assembly', x: 44.8, y: 41.0, color: C.rose });
    block(44.0, 44.8, { w: 2.6, d: 2.2, h: 2.2, color: '#d8a4ac', cols: 2, lit: C.rose });

    /* -- Fingerprint File (ec-echo-engine): quality control with file wall */
    put({
      x: 24.0, y: 43.2, z: 0, w: 4.8, d: 3.6, h: 3.0, color: '#c0a0d0',
      windows: { cols: 4, seed: 13, color: C.plum }
    });
    put({ kind: 'fingerprintWall', x: 32.8, y: 43.4, color: C.plum });
    block(33.8, 44.0, { w: 2.2, d: 2.0, h: 2.0, color: '#ccb4dc', cols: 2, lit: C.plum });

    /* -- Rail Yard (ec-indexer): freight rail yard beside archive tower */
    put({
      x: 12.0, y: 43.0, z: 0, w: 5.2, d: 3.8, h: 3.2, color: '#d4a878',
      panels: { cols: 5, seed: 8, color: '#e8c498' }, rooftop: C.orange
    });
    put({ kind: 'railYard', x: 11.4, y: 35.6, color: C.orange });
    block(18.6, 43.2, { w: 2.4, d: 2.0, h: 2.6, color: '#dcb888', cols: 2, lit: C.orange });

    /* -- Records Hall (ec-centralised-audit + ec-reporting): tally room */
    put({
      x: 6.6, y: 26.6, z: 0, w: 5.6, d: 4.0, h: 3.4, color: '#c09482',
      panels: { cols: 5, seed: 6, color: '#d8b09c' }, rooftop: C.brick
    });
    put({ kind: 'tallyRoom', x: 3.0, y: 29.0, color: C.brick });
    block(13.4, 26.8, { w: 2.4, d: 2.2, h: 2.2, color: '#c8a490', cols: 2, lit: C.brick });

    /* -- Config Curator: canal lock control tower at the top of the city */
    put({
      x: 32.0, y: 3.6, z: 0, w: 3.6, d: 3.2, h: 4.8, color: '#a8c8a4',
      windows: { cols: 3, seed: 15, color: C.moss }
    });
    put({ kind: 'lockGate', x: 34.8, y: 3.2, color: C.moss });
    block(27.8, 3.8, { w: 2.4, d: 2.2, h: 2.4, color: '#b8d4b4', cols: 2, lit: C.moss });

    /* -- scenery ----------------------------------------------------------- */
    var spots = [
      [9, 5], [21, 5], [44, 5], [57, 5], [62, 15], [62, 25], [62, 35],
      [48, 37], [48, 44], [35, 36], [22, 35], [10, 34], [3, 37], [3, 18],
      [20, 19], [29, 19], [39, 19], [58, 40], [8, 47], [24, 47], [44, 47]
    ];
    spots.forEach(function (s, i) {
      if (distToRoutes(s[0], s[1]) < 2.8) return;
      var n = Iso.hash2(s[0], s[1], 3);
      if (n < 0.32) {
        block(s[0], s[1], {
          w: 1.8 + n * 1.4, d: 1.4 + n * 0.8, h: 1.2 + n * 1.4,
          color: n < 0.16 ? '#d4cbba' : '#c8c0ae', cols: 2, lit: '#8a9aa4',
          roof: '#b09880', roofH: 0.5
        });
      } else {
        props.push({ kind: n < 0.68 ? 'tree' : 'lamp', x: s[0], y: s[1], seed: i });
      }
    });

    // Kafka crate stacks along roads — represent messages in-flight
    [[20, 14], [31, 14], [43, 14], [50, 17], [45, 37], [33, 37], [20, 37]].forEach(
      function (pos, i) {
        if (distToRoutes(pos[0], pos[1]) < 2.2) return;
        props.push({ kind: 'kafkaStack', x: pos[0], y: pos[1], seed: i + 100 });
      }
    );
  }

  global.World = {
    GW: 66, GH: 50,
    routes: { out: OUT, alert: ALERT, audit: AUDIT },
    stations: STATIONS,
    districts: DISTRICTS,
    districtById: DISTRICT_BY_ID,
    stationToDistrict: STATION_TO_DISTRICT,
    readSeconds: readSeconds,
    buildings: buildings,
    props: props,
    palette: C,
    distToRoutes: distToRoutes,
    build: build
  };
})(window);
