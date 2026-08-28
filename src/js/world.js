/* world.js: EC Factory — conveyor belt, 8 belt stations, 2 off-belt, 6 side services.
 *
 * The belt carries a single communication from the archive input through the
 * surveillance data path (Flows A and B). At the quota-manager sorting gate the
 * carrier either continues to alerting (sampled) or ends its journey there
 * (not sampled, skipping alerting/echo/indexer).
 *
 * 16 repositories appear: 8 on the belt, 2 off it (ec-centralised-audit,
 * ec-reporting), 6 as side structures. Five more exist in the real platform —
 * conduct-reports, ec-conduct-audit-service, ec-compliance-report (the
 * reporting-corner trio, a redundant read/rollup path off the same audit
 * trail the tower already shows), conduct-actioning (a library, not a
 * deployable, in-process at ea-ui-portal), and ec-conduct-hithighlight-service
 * (a read-path detail too fine-grained to earn its own floor structure) — and
 * are documented in knowledge/system-explainer-input.md but not drawn.
 *
 * Grid space: x grows right, y grows down (isometric). GW=78, GH=54.
 */
(function (global) {
  'use strict';

  var Iso = global.Iso;
  var makeRoute = Iso.makeRoute;

  /* GH grew to 60 then 66 for a south placement of the review/actioning
     cluster that no longer exists — it moved to the west-central corridor
     the config/manual-runs swap opened up, entirely clear of the belt
     without needing extra depth, so GH is back to its post-U-turn 48. */
  var GW = 78, GH = 56;

  /* ---- belt route --------------------------------------------------------
   * Waypoint indices (used to anchor stations via route.cum[i]):
   *  0:(6,8)  1:(14,8) 2:(24,8) 3:(34,8) 4:(44,8) 5:(54,8) 6:(64,8)
   *  7:(64,18) 8:(64,28) 9:(54,28) 10:(44,28) 11:(34,28)
   *  12:(24,28) 13:(14,28) 14:(14,38) 15:(14,46)
   *  16:(26,46) 17:(38,46) 18:(52,46)
   * cum[1]=8, cum[2]=18, ..., cum[5]=48, cum[9]=88, cum[16]=158, cum[17]=170
   */
  /* A U, not a snake. The third run went when ec-centralised-audit and
     ec-reporting came off the line: the document's own path ends at the
     indexer, and the record keeper is not a step in it. What the U encloses is
     the records precinct — see FLOOR-TOPOLOGY.md D1/D2.

     cum[1]=8 gateway, [2]=18 qualifier, [3]=28 filter, [4]=38 evaluator,
     [6]=64 quota (on the turn), [8]=80 alerting, [9]=90 echo, [10]=100 indexer,
     total 106 with a short run-out past the last machine. */
  var BELT = makeRoute([
    [6,8],
  [14,8],
  [24,8],
  [34,8],
  [44,8],
  [60,8],
  [60,18],
  [60,28],
  [54,28]
  ]);

  /* ---- palette ----------------------------------------------------------- */

  var C = {
    gateway:   '#3a7fa8',
    qualifier: '#6a5caa',
    filter:    '#b08830',
    evaluator: '#3a8880',
    quota:     '#c8a020',  // sorting gate — warm amber
    alerting:  '#a84860',
    echo:      '#7850a0',
    indexer:   '#b07028',
    audit:     '#9a5038',
    reporting: '#8a7058',
    // side structures
    config:    '#4a8848',
    manualruns:'#5870a0',
    review:    '#506890',
    portal:    '#4a6878',
    externalapi: '#9a7a3a', // was C.review — same colour as a different building read as one machine twice
    actioning: '#704860',
    side:      '#3a4455'   // generic side
  };

  /* ---- stations on the belt --------------------------------------------- */

  var STATIONS_FLAT = [
    /* w/d is the reserved footprint, not the casing: the intake press runs
       from the archive mast at x 8.5 to the watermark standpipe at x 18.7,
       and buildProps() must keep the whole assembly clear. render.js draws
       it from explicit coordinates. */
    { id:'gateway',
    dist: BELT.cum[1],
    x:12, y:12,
    w:10.4,d:5.2,h:3.3,
    kind:'machine', dwell:1.6, color:C.gateway },
    /* Reserved floor area, not the casing — the comparator runs from the
       S3 riser at x 20.1 to the receipt duct at x 26.8. */
    { id:'qualifier',
    dist: BELT.cum[2],
    x:23, y:12,
    w:8.5,d:5.2,h:3.0,
    kind:'machine', dwell:1.4, color:C.qualifier },
    /* Reserved floor area: the screening line runs from the S3 riser at
       x 29.9 to the receipt duct at x 37.3. */
    { id:'filter',
    dist: BELT.cum[3],
    x:34, y:12,
    w:9.0,d:5.2,h:3.0,
    kind:'machine', dwell:1.4, color:C.filter },
    /* Reserved floor area: the router runs from the splitter at x 39.9 to
       the receipt duct at x 47.3, with the COMS return line above it. */
    { id:'evaluator',
    dist: BELT.cum[4],
    x:45, y:12,
    w:9.0,d:5.2,h:3.0,
    kind:'machine', dwell:1.8, color:C.evaluator },
    /* Moved north of the belt with the rest of the upstream row. It used to
       stand at y 12 — south of the line, where a solid can occlude the
       carrier — and it is the one station the carrier is diverted AT, so
       it is the last one that should be fighting the belt for depth. */
    /* On the turn, inside the U. The west side of a vertical run has the
       smaller x+y key, so it is drawn before the carrier and is safe at any
       size — FLOOR-TOPOLOGY.md D6. The machine itself is unrotated; only its
       transfer bays turn, to axis 'x'. */
    { id:'quota',
    dist: BELT.cum[6],
    x:53, y:20,
    w:9.0,d:5.2,h:3.0,
    kind:'gate', dwell:1.6, color:C.quota },
    /* South of their run, which is the side that has to earn its place: a
       machine north of a belt is drawn before the carrier and is safe at any
       height, one south of it is drawn after and can paint over the carrier.
       No overlap needs h < (15·(northEdge − beltY) + 12) / 20, so at y 36 a
       first-pass 5x3 clears anything under 5.4 units and a rebuilt 9x5.2 clears
       anything under 4.6. They were at y 32, where the rebuilt size would not
       have cleared at all. */
    
       { id:'alerting',
    dist: BELT.cum[8],
    x:53, y:31,
    w:9.0,d:6.6,h:3.0,
    kind:'machine', dwell:1.6, color:C.alerting }
  ];

  var DOWNSTREAM_STRUCTS = [
  {
    id:'echo',
    x:43,
    y:29,
    w:9,
    d:6.6,
    h:3.5,
    color:C.echo,
    label:'ec-echo-engine',
    sublabel:'alert deduplication'
  },

  {
    id:'indexer',
    x:31,
    y:29,
    w:9,
    d:7.6,
    h:3.5,
    color:C.indexer,
    label:'ec-indexer',
    sublabel:'Elasticsearch bulk indexing'
  }
];

  /* ---- off the belt ------------------------------------------------------
   * The record keepers. They consume events ABOUT the communication, so the
   * communication never travels to them — putting them on the conveyor was the
   * floor telling a small lie. They stand inside the U instead, with the line
   * running around them.
   *
   * Same shape as a station minus `dist`: render.js dispatches them through
   * OFFBELT_DRAW and they are never fired by the simulation.
   * -------------------------------------------------------------------- */
  var OFFBELT = [
    {
    id:'audit',
    x:29,
    y:20,
    w:7.5,
    d:4.8,
    h:6.6,
    color:C.audit,
    label:'audit',
    sublabel:'ec-centralised-audit · the tower'
  },

    {
    id:'reporting',
    x:20,
    y:24,
    w:5,
    d:3,
    h:3,
    color:C.reporting,
    label:'reporting',
    sublabel:'ec-reporting'
  }
  ];

  var STATION_IDX_BY_ID = {};
  STATIONS_FLAT.forEach(function (s, i) { STATION_IDX_BY_ID[s.id] = i; });

  /* ---- side structures (6 off-belt repos) -------------------------------- */

  var SIDE_STRUCTS = [
  {
    id:'portal',
    x:42,
    y:43,
    w:9,
    d:5.5,
    h:3.5,
    color:C.portal,
    label:'ea-ui-portal',
    sublabel:'reviewer portal · Flow G'
  },

  {
    id:'reviewservice',
    x:31,
    y:43,
    w:9,
    d:6,
    h:3.4,
    color:C.review,
    label:'ec-review-service',
    sublabel:'entitlements & pipelines'
  },

  {
    id:'actioningservice',
    x:42,
    y:34,
    w:9,
    d:7.5,
    h:3.6,
    color:C.actioning,
    label:'conduct-actioning-service',
    sublabel:'disposition executor'
  },

  {
    id:'externalapi',
    x:20,
    y:43,
    w:9,
    d:5.5,
    h:3,
    color:C.externalapi,
    label:'ep-conduct-external-api',
    sublabel:'external API gateway'
  },

  {
    id:'manualruns',
    x:31,
    y:11,
    w:7,
    d:5.5,
    h:3.2,
    color:C.manualruns,
    label:'ec-manual-runs-service',
    sublabel:'re-processing · Flow F'
  },

  {
    id:'config',
    x:31,
    y:34,
    w:8.8,
    d:6.5,
    h:4,
    color:C.config,
    label:'ec-config-curator',
    sublabel:'configuration control · Flow E'
  }
];

  var SIDE_STRUCTS_BY_ID = {};
  SIDE_STRUCTS.forEach(function (s) { SIDE_STRUCTS_BY_ID[s.id] = s; });

  /* The centre point of a side structure's footprint — SIDE_STRUCTS gives the
     NW corner, everything that connects two structures wants the middle. */
  function structCentre(id) {
    var s = SIDE_STRUCTS_BY_ID[id];
    return s ? { x: s.x + s.w / 2, y: s.y + s.d / 2 } : null;
  }

  /* ---- cluster wiring -----------------------------------------------------
   * The real relationships among the six control/review/actioning
   * structures, traced from knowledge/system-explainer-input.md. Every
   * edge here fired; portal<->external-api and review-service<->
   * actioning-service did not, on purpose — see drawClusterLinks() in
   * render.js for how the column layout keeps both of those legible as
   * confirmed absences rather than as gaps in the data. `type` picks the
   * pipe colour: 'control' for config-curator's own edges (Kafka-borne
   * configuration, not a request), 'rest' for everything else. */
  var CLUSTER_LINKS = [
    { from:'manualruns',     to:'config',            mech:'bootstrap',    label:'config priming', type:'control' },
    { from:'config',         to:'reviewservice',     mech:'Kafka + REST', label:'pipeline config / windowToken', type:'control' },
    { from:'manualruns',     to:'portal',             mech:'REST',         label:'run status', type:'rest' },
    { from:'reviewservice',  to:'portal',             mech:'REST',         label:'entitled pipeline IDs', type:'rest' },
    { from:'reviewservice',  to:'externalapi',        mech:'REST',         label:'entitlements, reviewer-groups', type:'rest' },
    { from:'portal',         to:'actioningservice',   mech:'lib → Kafka', label:'disposition, tiered', type:'rest' },
    { from:'externalapi',    to:'actioningservice',   mech:'REST',         label:'bulk actions', type:'rest' }
  ];

  /* Cognition island — small external compound north of the evaluator. */
  var COG_FLOOR = { x: 36, y: -22, w: 16, d: 12 };

  /* Cognition building sits centred on COG_FLOOR. */
  var COGNITION = { id:'cognition', x:41, y:-18, w:5,d:4,h:3, color:'#445060',
                    label:'Cognition', sublabel:'external analytics platform' };

  /* ---- districts (narration panels — belt stations + side structs) ------- */

  var DISTRICTS = [
    {
      id:'gateway', name:'ec-gateway', x:16, y:2,  r:4.5, color:C.gateway,
      tag:'archive → miniIndexable · CDC outbox',
      short:'The archive announces a communication; ec-gateway downloads the full JSON from S3 in parallel byte-range chunks, strips the message body, and writes a small metadata object plus one audit ledger row.',
      /* No literal unit after these two: interpolate() formats them through
         fmtKb, which already carries KB/MB — and picks MB for a large doc. */
      body:'It arrived at {bytesDownloaded} and leaves at {bytesAfterMinify} — the body is both too large to fan out to nine services and too sensitive to copy widely. ' +
        'The download uses the FileChunkingStrategy: the object is cut into 5 MB byte ranges fetched in parallel, up to 25 concurrent streams, and past that ceiling it comes back for a second wave. ' +
        'The 25 lamps on the press casing are that ceiling, one lamp per stream. ' +
        'The ledger row carries a reconciliation token so that later the platform can answer "how many communications did you take in?" with an exact integer. ' +
        'Debezium publishes the outbox row onto the ingestedCommunication topic — the pickup head reading the printed strip. ' +
        'Drag Doc up: the chunk plan on the readout, the billet under the ram and the S3 time in the bar chart all move together.'
    },
    {
      id:'qualifier', name:'ec-queue-qualifier', x:24, y:2,  r:4.5, color:C.qualifier,
      tag:'participant extraction · pipeline routing',
      short:'ec-queue-qualifier streams the participant list out of the document and intersects it with a frozen snapshot of every monitored population, producing the list of surveillance pipelines that claim this communication.',
      body:'{participants} participants streamed out of the document; {matchedEntities} of them are in the monitored population, and they matched {pipelineIds} surveillance pipeline(s). ' +
        'The rest are not rejected so much as never returned: the intersection is one indexed query against pipeline-entity-mapping_{windowToken}, and an id that is not in that collection simply does not come back. ' +
        'That query costs the same whatever the length of the list — drag People and the machine fills up while the bar chart does not move. ' +
        'A pipeline is one named review queue — one compliance team\'s inbox. ' +
        'A zero match is not silence: it is published as an audited not-qualified outcome, because proving that nobody was being watched is part of the regulatory record. Drag People to zero to take that exit. ' +
        'The windowToken is the key: it prevents a midday policy change from retroactively re-categorising this morning\'s emails.'
    },
    {
      id:'filter', name:'ec-surveillance-filter', x:34, y:2,  r:4.5, color:C.filter,
      tag:'ignore policies · flag policies · per pipeline',
      short:'Each pipeline\'s screens run in a fixed order: ignore policies first to suppress noise, then flag policies to select genuinely reviewable content. The same message can be reviewable in one queue and ignored in another.',
      body:'{filtered} FILTERED, {qualified} QUALIFIED, {notQualified} NOT_QUALIFIED across the {pipelineIds} claiming pipeline(s) — one verdict each, decided independently. ' +
        'Suppression always wins: an ignored communication is never offered to the flag policies at all, and the two screens on the machine are numbered and bolted in that order because reordering them silently changes results. ' +
        'The config load and the chunked document fetch run concurrently, which is why both supply lines light on the same stroke. ' +
        'FILTERED and NOT_QUALIFIED are different reasons that publish to the same topic — …not-qualified, which ec-surveillance-quota-manager consumes for accounting only — so the audit trail is complete regardless of outcome. ' +
        'Drag Ignore% to 100 and nothing qualifies: the record skips evaluation entirely and is counted at the gate.'
    },
    {
      id:'evaluator', name:'ec-surveillance-policy-evaluator', x:44, y:2,  r:4.5, color:C.evaluator,
      tag:'metadata local · content → Cognition · COMS async',
      short:'Policies answerable from metadata alone are decided here in milliseconds; policies needing the message body are sent to Cognition, an external analytics platform, whose verdicts return asynchronously on a separate topic.',
      body:'{metadataOnly} verdict(s) answered here from metadata alone, in milliseconds, and stamped into Cognition\'s own response shape — the platform manufactures the reply it would otherwise have waited for. ' +
        '{sentToCognition} went out for content evaluation, and the wait stands at {comsRttMs} against a hard ceiling of 9,000,000 ms — about two and a half hours. ' +
        'This station is a router and a timekeeper: it never judges content itself. ' +
        'The CIMS payload goes out on the tenant\'s Cognition topic; the COMS response arrives on samplingTopic_k8s, on its own line rather than the belt, and is matched by the correlation id — a non-V3 run mode is dropped by design. ' +
        'This is the only latency in the platform that EC\'s own code does not bound. Push Cognition past the ceiling and the slots on the wait rack fill through the red line: the outcome is recorded as no-coms-timedout, which is audited rather than lost, but those communications never reach sampling at all.'
    },
    {
      id:'quota', name:'ec-surveillance-quota-manager', x:53, y:16.3, r:5.0, color:C.quota,
      tag:'SORTING GATE · atomic Redis · sampled or audit-only',
      short:'This is where the platform decides whether a human will ever read this communication. A single atomic Redis INCR, shared by every replica, prevents thirty-two replicas from together exceeding the quota.',
      body:'Sampling is two conditions ANDed against one counter, and a scope check before either of them. ' +
        'The profile\'s participant filters run first: fail them and the outcome is ignored, recorded, and the quota is never spent — which is why an ignored record leaves the counter where it was. ' +
        'Then the bucket. Its key is four things at once — pipeline, population, direction and the hour the message was sent — and this one reads {bucketKey}. ' +
        'redis.incr on that bucket returns {quotaUsed} against a limit of {quotaLimit}, and because the increment is atomic, thirty-two replicas share the one number rather than each keeping their own. ' +
        'Second condition: hash({gcid}) % 100 = {hashBucket}, which has to land under the sampling percentage. Both must pass. ' +
        'Verdict: {quotaEvent}. Being unsampled is itself an audited outcome with a stored reason — it is never silence. ' +
        'Sampled communications continue to alerting. Everything else stops here — the journey ends, and only the receipt goes on to ec-centralised-audit, by a route the carrier never takes. ' +
        'Watch three trips at the same settings: the counter barely moves, but the hash decides differently each time.'
    },
    {
      id:'alerting', name:'ec-alerting-service', x:54, y:36, r:5.0, color:C.alerting,
      tag:'four parallel enrichments · SupervisedItem · outbox write',
      short:'An alert is assembled rather than merely recorded: four data sources are fetched in parallel and built into a durable SupervisedItem document that will sit in a reviewer\'s queue.',
      body:'Four sources fetched simultaneously — the message body from S3, the monitored populations from ec-queue-qualifier, the policy detail from ec-surveillance-filter, and the scenario hits from EA Storage. Three of those are REST calls to other machines on this floor, and the feeds are coloured for where each comes from. ' +
        'Because they run in parallel the station costs the SLOWEST of them rather than their sum: S3 {enrichS3Ms} against REST {enrichRestMs}, so it pays {enrichMs}. Drag Doc and watch which one becomes the bottleneck. ' +
        '{alertsCreated} alert(s) created — one per sampled pipeline, because the same communication can be reviewable in two different queues for two different reasons. ' +
        'The supervised item and its outbox row are written in PARALLEL, not in sequence, and a partial failure can therefore leave an item nobody was told about. The outbox is the source of truth for downstream publication, which is why it is the press marked as such. ' +
        'ec-alerting-service CREATES the supervised_item document; months later conduct-actioning-service MUTATES that same document when a reviewer dispositions it — one of only two shared-write relationships in the platform. ' +
        'It is also the one machine on the belt that emits no audit event at all: its accounting arrives second-hand through echo and the indexer, and the duct pad on its apron is bolted shut. Its lagThreshold of 1000 is the loosest on the floor — push Ingest up and every other replica rack grows while this one stays at three.'
    },
    {
      id:'echo', name:'ec-echo-engine', x:44, y:36, r:4.5, color:C.echo,
      tag:'MD5 fingerprint · 14-day TTL · echo suppression',
      short:'The echo engine asks whether this alert is genuinely new by comparing a 32-character MD5 digest of the policy hits against every fingerprint seen on this thread in the last 14 days.',
      body:'Fingerprint {fingerprint}, {echoPriors} prior alert(s) on this thread inside the window, outcome: {echoOutcome}. ' +
        'On a long email thread re-scanned after every reply, the same surveillance scenario would raise an alert for every message. The echo engine prevents that with one indexed lookup against ec-echo-engine-state, keyed pipeline|thread|fingerprint with a TTL index for the 14-day window. ' +
        'The fingerprint is an MD5 of the SORTED policy hit IDs — sorted, so the same hits in a different order still match — and never of the message content. This station does not open the document at all, which is why the body port on it is capped. ' +
        'The card is filed BEFORE the comparison runs, not after. That ordering is the failure mode: a crash between the two leaves a candidate with no action, and the next alert on the thread still suppresses correctly. ' +
        'There are three answers, not two. Nothing earlier and it is new; something earlier and this alert closes; something LATER and the alert already published is reclassified instead of this one — that is how a late arrival is handled. ' +
        'It publishes nothing onto the belt: the answer goes back east to ec-alerting-service as an echoAction, and the receipt goes down the trench.'
    },
    {
      id:'indexer', name:'ec-indexer', x:34, y:36, r:4.5, color:C.indexer,
      tag:'bulk batch → Elasticsearch · audio child doc',
      short:'Indexing deliberately does not write one document at a time: the indexer fills a batch of up to 50 records and flushes them as a single Elasticsearch bulk request.',
      body:'Position {batchPosition} of 50, in a batch carrying {bulkBytes} of payload. Most communications cost this station nothing; every fiftieth pays for all fifty, and the bar chart shows it. ' +
        'The document is fetched from S3 a SECOND time here, using the same FileChunkingStrategy ec-gateway uses — ported verbatim, which is why the same 25-lamp concurrency matrix appears on both machines. ' +
        'The parent index name is one cached REST lookup. Audio calls get a second child document holding the transcript, attached to the same parent and indexed in the same request. ' +
        'Batching buys throughput at the cost of blast radius, and per-record fate is what limits it: a poison record in a batch of fifty is retried ALONE, on its own siding, while the other forty-nine go through. ' +
        'An empty S3 object never enters the bulk at all — it leaves over REST to ea-indexing-gateway, which is the bypass on the apron. ' +
        'ec-indexer CREATES the Elasticsearch review document; months later conduct-actioning-service UPDATES it when a reviewer acts — one of only two shared-write relationships in the platform. ' +
        'Its maxReplicaCount is 5 in the standard overlays, the lowest ceiling on the floor: Elasticsearch is the thing you cannot scale by adding consumers.'
    },
    {
      id:'audit', name:'ec-centralised-audit', x:32, y:19, r:4.5, color:C.audit,
      tag:'audit stitching · reconciliation watermark · ShedLock',
      short:'Off the belt, and deliberately so: the communication never travels here. Every verdict is mirrored to this place as an audit EVENT, stitched into one record per communication, and marked complete only when all pipelines reach a terminal outcome.',
      body:'{auditEventsEmitted} audit receipt(s) filed for this communication. ' +
        'It stands inside the loop the belt makes, because it is not a step in the path — it is what the path reports to. Seven of the eight upstream machines send it a receipt; ec-alerting-service is the exception, and its accounting arrives second-hand through echo and the indexer. ' +
        'ec-centralised-audit receives events from every upstream stage — not-qualified, filtered, evaluated, sampled, not-sampled, alerted, echo-closed, indexed. ' +
        'Every 15 minutes a ShedLock-guarded cron compares the number of completed communications against the gateway\'s ingest watermark for the same reconciliation token. ' +
        'Agreement between two independently produced counts is what "we can prove it" means in regulated surveillance. ' +
        'Its lagThreshold is 40 (the tightest of all consumers) because it receives several audit events per communication.'
    },
    {
      id:'reporting', name:'ec-reporting', x:42, y:21.5, r:4.5, color:C.reporting,
      tag:'per-pipeline counters · window-suffixed collections',
      short:'ec-reporting counts each audit event into a window-suffixed collection so a window\'s numbers can never be mixed with another\'s. Every 15 minutes a ShedLock cron re-aggregates per-pipeline totals.',
      body:'The counts stored here are what the monthly compliance report (ec-compliance-report) reads alongside the Elasticsearch review index — so an indexing failure and a disposition failure both change the numbers a regulator sees. ' +
        'Collection names include the windowToken suffix, making the time boundary explicit and preventing cross-window contamination. ' +
        'Like ec-centralised-audit, its lagThreshold is 40 — tight because the fan-in of audit events means several messages per communication arrive here.'
    },
    // side structure narrations
    {
      id:'config', name:'ec-config-curator', x:18, y:43, r:3.5, color:C.config,
      tag:'control room · window rotation · ShedLock freeze · Flow E',
      short:'ec-config-curator orchestrates the daily configuration boundary: it freezes incoming changes, rotates the window token across all data-plane services, and replays parked changes when the gate reopens.',
      body:'Once a day, per tenant, the freeze gate closes and all arriving configuration changes are parked in a staging store. ' +
        'The window token is rotated by calling ec-surveillance-quota-manager\'s REST endpoint, which publishes the new token on quota-windows (CDC). ' +
        'Nine data-plane services are then primed in parallel over REST. ' +
        'Without this pause, some services would count a day\'s communications under the old rules and some under the new, and the day\'s numbers could never be reconciled. ' +
        'ShedLock ensures only one instance holds the cron lock across a horizontally-scaled deployment. ' +
        'Cron: 0 */15 * * * * (evaluated every 15 minutes, fires once at each tenant\'s daily boundary).'
    },
    {
      id:'manualruns', name:'ec-manual-runs-service', x:30, y:53, r:3.5, color:C.manualruns,
      tag:'re-processing · Athena query · chunk strategy · Flow F',
      short:'ec-manual-runs-service re-processes historical communications through the surveillance pipeline on demand, using Athena to query the archive and streaming CSV results in parallel byte-range chunks.',
      body:'A compliance officer submits a run via POST /v1/tenants/{tenantName}/manual-runs. ' +
        'The service queries AWS Athena, waits for SUCCEEDED status, then splits the result CSV into 5 MB byte-range chunks and publishes one Kafka event per chunk. ' +
        'Each chunk streams and parses 250 rows per IngestionEvent batch. ' +
        'Row count integrity: rows cut at chunk boundaries are stitched back together and the total asserted against the Athena row count to prevent silent row loss. ' +
        'Re-processed records rejoin the live path at ec-gateway (ingestion lane) or at ec-surveillance-filter (already-qualified lane). ' +
        'Scaling: minReplicas 3, maxReplicas 10, lagThreshold 100.'
    },
    {
      id:'reviewservice', name:'ec-review-service', x:30, y:43, r:3.5, color:C.review,
      tag:'reviewer entitlements · pipeline-group bindings',
      short:'ec-review-service is the entitlement authority for the review interface: it maps reviewers to their pipeline IDs and manages reviewer groups, pipeline bindings, and supervision queue configuration.',
      body:'ea-ui-portal calls this service to resolve a reviewer\'s entitled pipeline IDs when reviewer groups are enabled. ' +
        'ep-conduct-external-api forwards all entitlement and reviewer-group operations here. ' +
        'It owns no surveillance logic and does not participate in the data path — it is a configuration service queried on the review path.'
    },
    {
      id:'portal', name:'ea-ui-portal', x:42, y:53, r:3.5, color:C.portal,
      tag:'reviewer web application · Flow G entry',
      short:'ea-ui-portal is the reviewer\'s and administrator\'s web application: it lists queues, renders alerted communications with matched phrases highlighted, and dispatches reviewer dispositions to the actioning tier.',
      body:'When a reviewer dispositions an alert, the portal calls the conduct-actioning library (in-process) which decides the tier topic based on selection size: small ≤20, medium 21–50, large >50 documents. ' +
        'The disposition is published as a Kafka message. ' +
        'If ec-review-service is unavailable, queue listing falls back to the legacy entitlement path. ' +
        'If the actioning topic is misconfigured, a disposition appears accepted from the reviewer\'s point of view and is never applied — the authoritative record of lost dispositions is metadata_nonretryable_event in conduct-actioning-service. ' +
        'Scaling: 3–9 replicas, CPU and memory triggers (not Kafka lag), pollingInterval 20 s.'
    },
    {
      id:'externalapi', name:'ep-conduct-external-api', x:18, y:53, r:3.5, color:C.externalapi,
      tag:'customer REST gateway · bulk actions · OAuth2/JWT',
      short:'ep-conduct-external-api is the customer-facing REST gateway for Conduct administration: reviewer groups, review entitlements, pipeline bindings, add-to-queue requests, and bulk actions. Every request is OAuth2/JWT authenticated.',
      body:'It owns no surveillance logic; it validates, audits every API interaction into app_audit_new, and forwards to ec-review-service and conduct-actioning-service. ' +
        'Bulk actions return a jobId immediately; the caller polls GET /external-api/bulk-actions/{jobId} for completion. ' +
        'Because it is a pure forwarder, a conduct-actioning-service outage surfaces as an accepted-then-stalled job. ' +
        'Scaling: 3–6 replicas, CPU 50% / memory 75% targets.'
    },
    {
      id:'actioningservice', name:'conduct-actioning-service', x:42, y:43, r:3.5, color:C.actioning,
      tag:'disposition executor · Mongo + ES two-store write · Flow G',
      short:'conduct-actioning-service executes what a reviewer decided: it applies the disposition to the supervised_item MongoDB document and to the Elasticsearch review index, then rolls up supervision metrics.',
      body:'It is the only service in the platform that mutates records another service created — ec-alerting-service wrote supervised_item and ec-indexer wrote the ES review document; conduct-actioning-service updates both. ' +
        'The two-store write is not transactional: a failure between the Mongo update and the ES update leaves an item dispositioned in the audit trail but still open in search results, where it will age into higher age buckets in the monthly compliance report. ' +
        'Non-retryable failures write metadata_nonretryable_event — there is no retry topic or DLT on this path. ' +
        'KEDA: lag autoscaling on the large tier only (lagThreshold 100).'
    }
  ];

  var DISTRICT_BY_ID = {};
  DISTRICTS.forEach(function (d) { DISTRICT_BY_ID[d.id] = d; });

  var STATION_TO_DISTRICT = {};
  STATIONS_FLAT.forEach(function (s) { STATION_TO_DISTRICT[s.id] = s.id; });
  SIDE_STRUCTS.forEach(function (s) { STATION_TO_DISTRICT[s.id] = s.id; });

  function readSeconds(stationId) {
    var d = DISTRICT_BY_ID[stationId];
    if (!d) return 9;
    var words = ((d.tag || '') + ' ' + d.short + ' ' + d.body).split(/\s+/).length;
    return Math.min(26, Math.max(9, words / 3.8 + 3.5));
  }

  /* ---- build (no-op — factory uses SIDE_STRUCTS and STATIONS_FLAT directly) */

  var _built = false;
  function build() { _built = true; }

  /* ---- props: the floor furniture ----------------------------------------
   *
   * The slab was bare, which made the plant read as a diagram floating in
   * space rather than a building standing on a site. None of this is part of
   * the model — it is here so the mechanism has somewhere to happen.
   *
   * Everything is placed through blocked(), which keeps props off the belt,
   * out of every footprint, and clear of the Cognition pad. Nothing may
   * occlude the carrier, so the belt clearance is generous.
   * ---------------------------------------------------------------------- */

  var props = [];

  /* Perpendicular distance from (x, y) to the nearest point on the belt. */
  function distToBelt(x, y) {
    var best = 1e9, i, s, dx, dy, t, px, py;
    for (i = 0; i < BELT.segs.length; i++) {
      s = BELT.segs[i];
      dx = s.b.x - s.a.x; dy = s.b.y - s.a.y;
      t = ((x - s.a.x) * dx + (y - s.a.y) * dy) / (dx*dx + dy*dy || 1);
      t = Math.max(0, Math.min(1, t));
      px = s.a.x + dx * t; py = s.a.y + dy * t;
      best = Math.min(best, Math.hypot(x - px, y - py));
    }
    return best;
  }

  /* Footprint test only — no belt clearance. Thin props that belong beside the
     belt (the stanchion line) use this, because they are a few centimetres wide
     and cannot hide the carrier the way a building would. */
  function blockedByStructure(x, y, pad) {
    var i, m;
    /* belt machines: x,y is the centre */
    for (i = 0; i < STATIONS_FLAT.length; i++) {
      m = STATIONS_FLAT[i];
      if (Math.abs(x - m.x) < m.w/2 + 1.2 + pad &&
          Math.abs(y - m.y) < m.d/2 + 1.2 + pad) return true;
    }
    /* side structures: x,y is the NW corner */
    for (i = 0; i < SIDE_STRUCTS.length; i++) {
      m = SIDE_STRUCTS[i];
      if (x > m.x - 1.2 - pad && x < m.x + m.w + 1.2 + pad &&
          y > m.y - 1.2 - pad && y < m.y + m.d + 1.2 + pad) return true;
    }
    /* off-belt structures: x,y is the centre, as for a station */
    for (i = 0; i < OFFBELT.length; i++) {
      m = OFFBELT[i];
      if (Math.abs(x - m.x) < m.w/2 + 1.2 + pad &&
          Math.abs(y - m.y) < m.d/2 + 1.2 + pad) return true;
    }
    /* the Cognition pad sits off the main floor and stays clear */
    if (x > COG_FLOOR.x - 3 && x < COG_FLOOR.x + COG_FLOOR.w + 3 &&
        y > COG_FLOOR.y - 3 && y < COG_FLOOR.y + COG_FLOOR.d + 3) return true;
    return false;
  }

  /* The rule for anything with real bulk: keep well clear of the belt so the
     carrier is never hidden behind it. */
  function blocked(x, y, pad) {
    if (distToBelt(x, y) < 3.2 + pad) return true;
    if (nearTrench(x, y, pad)) return true;
    return blockedByStructure(x, y, pad);
  }

  function onSlab(x, y) { return x > 1 && x < GW - 1 && y > 1 && y < GH - 1; }

  /* Flat floor paint. Kept separate from props because a decal must be laid
     down straight after the belt, before any solid — sorted into the main pass
     it would sometimes paint over the machine standing in front of it. */
  var decals = [];

  /* ---- the receipt relay --------------------------------------------------
   *
   * Seven machines report to ec-centralised-audit and one does not:
   * ec-alerting-service produces no audit event at all, so it has no line, and
   * that absence is meant to be visible.
   *
   * Receipts travel BELOW grade. A trench is a cut into the slab rather than
   * paint on it, so it passes under the belt without ever contending with the
   * carrier for depth — which is the only reason a network can reach the middle
   * of the floor from both sides of the line. Drawn before the belt.
   *
   * It is a common trench with branches, not point-to-point cabling: four
   * branches drop onto a north spine, two onto a south one, and each spine
   * feeds a riser into a face of the tower. ec-gateway's branch starts under
   * its CDC pickup head rather than a receipt duct, because its relay to audit
   * IS the outbox that Debezium publishes.
   *
   * `src` lists the machines whose receipts use a segment; a segment glows only
   * while one of them is sending.
   * -------------------------------------------------------------------- */
  var TOWER = { x: 32, y: 19 };

  var RELAY = {
    trench: [
      /* branches down from the top row, crossing the belt at y 8 */
      { src:['gateway'],   x0:17.8, y0:3.60,  x1:17.8, y1:12.5 },
      { src:['qualifier'], x0:27.2, y0:4.60,  x1:27.2, y1:12.5 },
      { src:['filter'],    x0:37.6, y0:5.10,  x1:37.6, y1:12.5 },
      { src:['evaluator'], x0:47.3, y0:5.10,  x1:47.3, y1:12.5 },
      /* the north spine, flowing inward to the riser from both ends */
      { src:['gateway','qualifier'],  x0:17.8, y0:12.5, x1:32.0, y1:12.5 },
      { src:['filter','evaluator'],   x0:47.3, y0:12.5, x1:32.0, y1:12.5 },
      { src:['gateway','qualifier','filter','evaluator'],
        x0:32.0, y0:12.5, x1:32.0, y1:17.05, riser:true },

      /* the quota manager comes in along the tower's east face */
      { src:['quota'],     x0:57.1, y0:18.85, x1:35.56, y1:18.85 },

      /* The middle row reports from its SOUTH apron, not its north one. North
         of those machines is behind them from this camera, and a receipt duct
         you cannot see is a duct that teaches nothing — so the branches drop
         away from the belt, gather on a spine behind the machines, and the
         riser comes back north at x 30, west of the indexer, passing under the
         belt and under nothing else. */
      { src:['echo'],      x0:44.0, y0:38.4, x1:44.0, y1:40.2 },
      { src:['indexer'],   x0:34.0, y0:38.4, x1:34.0, y1:40.2 },
      { src:['echo'],      x0:44.0, y0:40.2, x1:30.0, y1:40.2 },
      { src:['echo','indexer'],
        x0:30.0, y0:40.2, x1:30.0, y1:21.40, riser:true }
    ],

    /* Outbound, and overhead: at z 4.5 a run clears the carrier by some 170 px
       in screen space, so it may cross the belt freely. Three of them, because
       audit is mostly a listener — seven lines in, three out. */
    tube: [
      { to:'gateway',   z:4.5, pts:[[31.0,17.0],[31.0,6.4],[18.9,6.4]],
        label:'GET /watermark' },
      /* Audit ↔ Reporting pair: westbound connection from audit to reporting */
      { to:'reporting', z:4.5, pts:[[28.0,20.0],[22.0,21.5]],
        label:'windowReconciliation' },
      { to:'quota',     z:4.5, pts:[[35.60,17.0],[50.0,17.0]],
        label:'windowReconciliation' }
    ]
  };

  /* Stanchions for the overhead runs. The horizontal runs are drawn in a late
     pass because nothing on the floor can occlude them; their posts cannot be,
     because a post reaches the ground and has to sort like any other solid. */
  var RELAY_POSTS = [];
  RELAY.tube.forEach(function (t) {
    t.pts.forEach(function (pt) { RELAY_POSTS.push({ x: pt[0], y: pt[1], z: t.z }); });
  });

  /* ---- config-curator's fan-out ---------------------------------------
   * The nine data-plane services it primes over REST, drawn as its own
   * underground trunk rather than nine surface pipes crossing the belt —
   * same convention the audit relay already uses to cross under the belt
   * cleanly instead of running over it. A short connector drops from
   * config-curator's south face into the gap between review-service and
   * external-api (a 2-unit gap at this y, wide enough for a trench),
   * meets a north-south trunk at x19 — the same clear corridor
   * DOGLEG_X in render.js already uses, west of ec-reporting's footprint
   * at x19.5 — and that trunk carries two shared spine runs (top row,
   * bottom row) plus three individual spurs (quota, audit, reporting).
   * The trunk crosses under the belt's top run once; it never needs to
   * cross the middle run at all, because the middle run only exists for
   * x >= 28 and the trunk sits at x19. No pulses here — this is
   * configuration fan-out, not the audit relay, and this pass is
   * positioning and routing only. */
  var CONFIG_FANOUT = {
  trench: [
    /* ---------------------------------------------------------------
     * CONFIGURATION DISTRIBUTION TRUNK
     *
     * ec-config-curator is now at:
     *   x:14..21
     *   y:37.5..43
     *
     * The service-yard side of the factory is therefore kept clear.
     * Configuration leaves the east side of the curator, travels
     * east through the open service corridor, then enters a dedicated
     * north/south distribution trunk at x=28.
     *
     * The trunk is underground. It crosses the existing belt where
     * necessary rather than visually competing with the communication
     * conveyor.
     *
     * x=28 is deliberately chosen:
     *   ec-reporting ends at x=27
     *   audit tower begins at x=28.6
     *
     * This leaves the narrow corridor between them for the trunk.
     * --------------------------------------------------------------- */

    /* config-curator → dedicated distribution trunk */
    {
      x0:17.5, y0:40.25,
      x1:28,   y1:40.25,
      spine:true
    },

    /* Main north/south distribution trunk */
    {
      x0:28, y0:40.25,
      x1:28, y1:4.6,
      spine:true
    },

    /* ---------------------------------------------------------------
     * Upstream configuration
     * qualifier → filter → evaluator
     * --------------------------------------------------------------- */
    {
      x0:28, y0:4.6,
      x1:44, y1:4.6,
      spine:true
    },

    /* ---------------------------------------------------------------
     * Quota manager configuration
     * --------------------------------------------------------------- */
    {
      x0:28, y0:16.3,
      x1:53, y1:16.3
    },

    /* ---------------------------------------------------------------
     * Centralised audit configuration
     *
     * audit tower begins around x=28.6, so this is a very short
     * east-facing spur into its west side.
     * --------------------------------------------------------------- */
    {
      x0:28,   y0:21.2,
      x1:28.6, y1:21.2
    },

    /* ---------------------------------------------------------------
     * Reporting configuration
     *
     * ec-reporting occupies x≈22..27, so this branch approaches
     * its east face rather than crossing its footprint.
     * --------------------------------------------------------------- */
    {
      x0:28, y0:23,
      x1:27, y1:23
    },

    /* ---------------------------------------------------------------
     * Downstream configuration
     * indexer / alerting
     * --------------------------------------------------------------- */
    {
      x0:28,   y0:36,
      x1:49.5, y1:36,
      spine:true
    }
  ]
};

  function distToSeg(px, py, x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
    var t = L2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2)) : 0;
    return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
  }

  /* Props must keep off the trench, or a crate ends up straddling an open cut. */
  function nearTrench(x, y, pad) {
    for (var i = 0; i < RELAY.trench.length; i++) {
      var t = RELAY.trench[i];
      if (distToSeg(x, y, t.x0, t.y0, t.x1, t.y1) < 1.3 + pad) return true;
    }
    return false;
  }

  /* ---- topic lanes --------------------------------------------------------
   *
   * The belt is not one pipe. Every stretch of it between two machines is a
   * different Kafka topic, and until now those names lived only in the
   * narration. Painted on the floor alongside the belt, the topic change at
   * each station becomes something the reader watches rather than reads: the
   * intake arm of a machine reaches to one named lane, its outfeed arm places
   * onto the next.
   *
   * Names are verbatim from the channel table (Section 2b of
   * knowledge/system-explainer-input.md). Coordinates are the lane centreline,
   * already offset clear of the belt onto whichever side has floor: the top
   * row of machines stands north of its belt, so its lanes are painted south.
   * -------------------------------------------------------------------- */
  var TOPIC_LANES = [
    /* top run — machines north of the belt, lanes painted on the interior side */
    { x0: 6.4,  y0: 9.9,  x1: 13.4, y1: 9.9,
      text: 'supBulkIndexingTopic_k8s', from: 'archive' },
    { x0: 14.6, y0: 9.9,  x1: 23.4, y1: 9.9,
      text: 'ec.surveillance-gateway.outbox.{tenant}.ingestedCommunication' },
    { x0: 24.6, y0: 9.9,  x1: 33.4, y1: 9.9,
      text: 'ec.surveillance-qualifier.{tenant}.qualifications' },
    { x0: 34.6, y0: 9.9,  x1: 43.4, y1: 9.9,
      text: 'ec.surveillance-filter.{tenant}.evaluations' },
    { x0: 44.6, y0: 9.9,  x1: 58.4, y1: 9.9,
      text: 'ec.surveillance-policy-evaluator.{tenant}.surveilled' },

    /* the turn — painted outside the U, where there is floor to spare */
    { x0: 61.9, y0: 9.4,  x1: 61.9, y1: 26.6, dir: 'y',
      text: 'ec.surveillance-quota-manager.{tenant}.surveilled-communication-outbox' },

    /* middle run — machines south of the belt, lanes again on the interior */
    { x0: 53.4, y0: 26.1, x1: 35.0, y1: 26.1,
      text: 'ec.alerting-service.{tenant}.alertedCommunication' }
  ];

  function buildTopicLanes() {
    TOPIC_LANES.forEach(function (t) {
      decals.push({
        kind: 'topic',
        x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1,
        dir: t.dir || 'x', text: t.text, from: t.from || null
      });
    });
  }

  function buildProps() {
    var i, x, y, n;

    /* Conduit trunks: the trunking that gives the place its name, carried on
       stanchions down the clear aisles between the belt rows, plus one vertical
       run up the west side. None of these cross the belt. */
    /* The y 18.5 trunk used to cross the whole floor; the records precinct now
       sits in the middle of it, so it stops short of the tower. */
    [[8, 18.5, 26, 18.5], [10, 13.0, 10, 36.0]]
      .forEach(function (r) {
        props.push({ kind: 'conduit', x0: r[0], y0: r[1], x1: r[2], y1: r[3], z: 0.75 });
      });

    /* There used to be a third trunk at y 38.0 with a spur off it to each of
       alerting, echo and indexer — cable flavour, not a real relationship.
       It predated those three moving down to y 36 when each was rebuilt, and
       was never adjusted afterward: the trunk ran straight through echo's
       and indexer's casings, and the spurs dangled at y 40 short of it,
       neither end actually meeting the other. Removed rather than patched,
       because a fixed geometry would still draw a cable from manual-runs to
       echo/indexer that doesn't exist — manual-runs' real rejoin points are
       ec-gateway and ec-surveillance-filter, drawn on its own casing. */

    /* Belt-side stanchions carrying a cable strung post to post. This is the
       one thing the floor had no equivalent of: rocket-engine's pole line gives
       the whole length of the belt a vertical rhythm, and without it a long
       conveyor reads as a flat stripe. Posts are thin and set well back, so
       they never occlude the carrier. */
    var prev = null, step = 7.0, d, at, nx, ny, px, py, side;
    for (d = 4; d < BELT.total - 3; d += step) {
      at = BELT.at(d);
      nx = -at.dy; ny = at.dx;                    /* left-hand normal */
      side = 2.75;
      px = at.x + nx * side; py = at.y + ny * side;
      if (blockedByStructure(px, py, 0.6) || !onSlab(px, py)) {
        px = at.x - nx * side; py = at.y - ny * side;   /* try the other side */
        if (blockedByStructure(px, py, 0.6) || !onSlab(px, py)) { prev = null; continue; }
      }
      var post = { kind: 'post', x: px, y: py, prev: prev };
      props.push(post);
      prev = post;
    }

    /* Painted bay markings — cheap floor structure in the open middle. */
    [[26, 18.5], [38, 18.5], [50, 18.5], [22, 40], [34, 40],
     [30, 24], [42, 24]].forEach(function (b) {
      if (!blocked(b[0], b[1], 1.0)) {
        decals.push({ kind: 'bay', x: b[0], y: b[1], w: 4.2, d: 3.0 });
      }
    });

    /* High-bay lamps on the aisle centrelines. */
    [[14, 18.5], [30, 18.5], [46, 18.5], [58, 18.5],
     [14, 40.0], [30, 40.0], [42, 40.0]].forEach(function (p) {
      if (!blocked(p[0], p[1], 0)) props.push({ kind: 'lamp', x: p[0], y: p[1] });
    });

    /* Crate pallets — staged document batches waiting on floor space. */
    [[10, 14], [20, 15.5], [30, 14.5], [42, 15.5], [50, 20],
      [20, 36], [46, 36], [56, 40], [8, 46],
      [60, 34], [46, 24], [22, 22], [16, 20], [36, 20], [58, 16],
      [24, 34], [40, 36], [52, 24],
      [62, 30], [12, 34], [50, 34]].forEach(function (p, j) {
        if (!blocked(p[0], p[1], 0)) props.push({ kind: 'pallet', x: p[0], y: p[1], seed: j });
      });

    /* Equipment cabinets: the stores and switchgear the services run on. */
    [[6, 24], [6, 34], [58, 22], [62, 40], [30, 24],
      [18, 24], [26, 16], [48, 16], [60, 26],
      [56, 34], [22, 30], [50, 30]].forEach(function (p, j) {
      if (!blocked(p[0], p[1], 0.4)) props.push({ kind: 'cabinet', x: p[0], y: p[1], seed: j });
    });

    /* Cable drums — on their side, thematic for a plant full of trunking. */
    [[14, 16], [34, 24], [52, 18], [26, 38], [44, 40], [60, 20], [20, 42]]
      .forEach(function (p, j) {
        if (!blocked(p[0], p[1], 0.3)) props.push({ kind: 'spool', x: p[0], y: p[1], seed: j });
      });

    /* Barrel clusters. */
    [[12, 22], [40, 16], [56, 28], [24, 26], [46, 30], [32, 42], [8, 30]]
      .forEach(function (p, j) {
        if (!blocked(p[0], p[1], 0.3)) props.push({ kind: 'drum', x: p[0], y: p[1], seed: j });
      });

    /* Gravel and scrub OUTSIDE the slab, so the plant stands on ground rather
       than on nothing. The Cognition pad and the slab itself stay clear. */
    for (x = -12; x < GW + 14; x += 2.4) {
      for (y = -12; y < GH + 14; y += 2.4) {
        if (onSlab(x, y)) continue;
        if (x > COG_FLOOR.x - 4 && x < COG_FLOOR.x + COG_FLOOR.w + 4 &&
            y > COG_FLOOR.y - 4 && y < COG_FLOOR.y + COG_FLOOR.d + 4) continue;
        n = Iso.hash2(x * 7, y * 11, 23);
        if (n > 0.30) continue;
        props.push({ kind: n < 0.08 ? 'rock' : 'scrub',
                     x: x + n * 1.4, y: y + n * 0.9, s: 0.6 + n * 2.2 });
      }
    }
  }

  buildProps();
  buildTopicLanes();

  /* Kept for city-style callers that iterate a buildings list. */
  var buildings = [];

  global.World = {
    GW: GW, GH: GH,
    BELT: BELT,
    STATIONS_FLAT: STATIONS_FLAT,
    /* Alias under the name the skill's smoke test looks for. It does
       Object.values(World.stations).flat(), which yields the station objects
       whether this is an array or a group map — so the documented verification
       command works against this project without special-casing. */
    stations: STATIONS_FLAT,
    STATION_IDX_BY_ID: STATION_IDX_BY_ID,
    SIDE_STRUCTS: SIDE_STRUCTS,
    SIDE_STRUCTS_BY_ID: SIDE_STRUCTS_BY_ID,
    structCentre: structCentre,
    CLUSTER_LINKS: CLUSTER_LINKS,
    COG_FLOOR: COG_FLOOR,
    COGNITION: COGNITION,
    districts: DISTRICTS,
    districtById: DISTRICT_BY_ID,
    OFFBELT: OFFBELT,
    RELAY: RELAY,
    RELAY_POSTS: RELAY_POSTS,
    CONFIG_FANOUT: CONFIG_FANOUT,
    TOWER: TOWER,
    stationToDistrict: STATION_TO_DISTRICT,
    palette: C,
    readSeconds: readSeconds,
    decals: decals,
    buildings: buildings,
    props: props,
    build: build
  };
})(window);
