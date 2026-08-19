/* world.js: EC Factory — conveyor belt, 10 surveillance stations, 11 side services.
 *
 * The belt carries a single communication from the archive input through the
 * surveillance data path (Flows A and B). At the quota-manager sorting gate the
 * carrier either continues to alerting (sampled) or jumps straight to audit
 * (not sampled, skipping alerting/echo/indexer).
 *
 * All 21 repositories appear: 10 on the belt, 11 as side structures.
 *
 * Grid space: x grows right, y grows down (isometric). GW=78, GH=54.
 */
(function (global) {
  'use strict';

  var Iso = global.Iso;
  var makeRoute = Iso.makeRoute;

  var GW = 78, GH = 54;

  /* ---- belt route --------------------------------------------------------
   * Waypoint indices (used to anchor stations via route.cum[i]):
   *  0:(6,8)  1:(14,8) 2:(24,8) 3:(34,8) 4:(44,8) 5:(54,8) 6:(64,8)
   *  7:(64,18) 8:(64,28) 9:(54,28) 10:(44,28) 11:(34,28)
   *  12:(24,28) 13:(14,28) 14:(14,38) 15:(14,46)
   *  16:(26,46) 17:(38,46) 18:(52,46)
   * cum[1]=8, cum[2]=18, ..., cum[5]=48, cum[9]=88, cum[16]=158, cum[17]=170
   */
  var BELT = makeRoute([
    [6,8],[14,8],[24,8],[34,8],[44,8],[54,8],[64,8],[64,18],[64,28],
    [54,28],[44,28],[34,28],[24,28],[14,28],[14,38],[14,46],[26,46],[38,46],[52,46]
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
    actioning: '#704860',
    reports:   '#607060',
    side:      '#3a4455'   // generic side
  };

  /* ---- stations on the belt --------------------------------------------- */

  var STATIONS_FLAT = [
    { id:'gateway',   dist: BELT.cum[1],  x:14, y:2,  w:5,d:3,h:3, kind:'machine', dwell:1.6, color:C.gateway },
    { id:'qualifier', dist: BELT.cum[2],  x:24, y:2,  w:5,d:3,h:3, kind:'machine', dwell:1.4, color:C.qualifier },
    { id:'filter',    dist: BELT.cum[3],  x:34, y:2,  w:5,d:3,h:3, kind:'machine', dwell:1.4, color:C.filter },
    { id:'evaluator', dist: BELT.cum[4],  x:44, y:2,  w:5,d:3,h:3, kind:'machine', dwell:1.8, color:C.evaluator },
    { id:'quota',     dist: BELT.cum[5],  x:54, y:12, w:5,d:3,h:3, kind:'gate',    dwell:1.6, color:C.quota },
    { id:'alerting',  dist: BELT.cum[9],  x:54, y:32, w:5,d:3,h:3, kind:'machine', dwell:1.6, color:C.alerting },
    { id:'echo',      dist: BELT.cum[10], x:44, y:32, w:5,d:3,h:3, kind:'machine', dwell:1.2, color:C.echo },
    { id:'indexer',   dist: BELT.cum[11], x:34, y:32, w:5,d:3,h:3, kind:'machine', dwell:1.2, color:C.indexer },
    { id:'audit',     dist: BELT.cum[16], x:26, y:50, w:5,d:3,h:3, kind:'machine', dwell:1.4, color:C.audit },
    { id:'reporting', dist: BELT.cum[17], x:38, y:50, w:5,d:3,h:3, kind:'machine', dwell:1.2, color:C.reporting }
  ];

  var STATION_IDX_BY_ID = {};
  STATIONS_FLAT.forEach(function (s, i) { STATION_IDX_BY_ID[s.id] = i; });

  /* ---- side structures (11 off-belt repos) ------------------------------- */

  var SIDE_STRUCTS = [
    { id:'config',          x:2,  y:16, w:6,d:5,h:4, color:C.config,    label:'ec-config-curator',              sublabel:'control room · Flow E' },
    { id:'hithighlight',    x:2,  y:28, w:5,d:4,h:2, color:C.review,    label:'ec-conduct-hithighlight-service',sublabel:'hit-highlight offsets' },
    { id:'manualruns',      x:2,  y:38, w:6,d:5,h:3, color:C.manualruns,label:'ec-manual-runs-service',         sublabel:'re-processing · Flow F' },
    { id:'reviewservice',   x:66, y:6,  w:5,d:4,h:3, color:C.review,    label:'ec-review-service',              sublabel:'entitlements & pipelines' },
    { id:'portal',          x:66, y:16, w:7,d:5,h:4, color:C.portal,    label:'ea-ui-portal',                   sublabel:'reviewer portal · Flow G' },
    { id:'externalapi',     x:66, y:26, w:6,d:4,h:3, color:C.review,    label:'ep-conduct-external-api',        sublabel:'external API gateway' },
    { id:'actioningservice',x:66, y:36, w:7,d:5,h:3, color:C.actioning, label:'conduct-actioning-service',      sublabel:'disposition executor' },
    { id:'actioninglib',    x:66, y:44, w:5,d:3,h:2, color:C.actioning, label:'conduct-actioning',              sublabel:'lib · in-process at portal' },
    { id:'conductaudit',    x:50, y:52, w:5,d:4,h:2, color:C.reports,   label:'ec-conduct-audit-service',       sublabel:'audit store manager' },
    { id:'reports',         x:58, y:52, w:6,d:4,h:3, color:C.reports,   label:'conduct-reports',                sublabel:'administrative reports' },
    { id:'compliance',      x:66, y:52, w:6,d:4,h:3, color:C.reports,   label:'ec-compliance-report',           sublabel:'regulator CSV · Flow H' }
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
      body:'It arrived at {bytesDownloaded} KB and leaves at {bytesAfterMinify} KB — the body is both too large to fan out to nine services and too sensitive to copy widely. ' +
        'The download uses the FileChunkingStrategy: for a document larger than 5 MB, chunks are fetched in parallel up to 25 concurrent streams. ' +
        'The ledger row carries a reconciliation token so that later the platform can answer "how many communications did you take in?" with an exact integer. ' +
        'Debezium publishes the outbox row onto the ingestedCommunication topic. ' +
        'Drag Doc Size up and watch the S3 download time grow in the bar chart.'
    },
    {
      id:'qualifier', name:'ec-queue-qualifier', x:24, y:2,  r:4.5, color:C.qualifier,
      tag:'participant extraction · pipeline routing',
      short:'ec-queue-qualifier streams the participant list out of the document and intersects it with a frozen snapshot of every monitored population, producing the list of surveillance pipelines that claim this communication.',
      body:'{participants} participants found, matched {pipelineIds} surveillance pipeline(s). ' +
        'A pipeline is one named review queue — one compliance team\'s inbox. ' +
        'The intersection is performed against pipeline-entity-mapping_{windowToken}, a MongoDB collection that is a frozen photograph of who was under surveillance when this window opened. ' +
        'A zero match is not silence: it is published as an audited not-qualified outcome, because proving that nobody was being watched is part of the regulatory record. ' +
        'The windowToken is the key: it prevents a midday policy change from retroactively re-categorising this morning\'s emails.'
    },
    {
      id:'filter', name:'ec-surveillance-filter', x:34, y:2,  r:4.5, color:C.filter,
      tag:'ignore policies · flag policies · per pipeline',
      short:'Each pipeline\'s screens run in a fixed order: ignore policies first to suppress noise, then flag policies to select genuinely reviewable content. The same message can be reviewable in one queue and ignored in another.',
      body:'Suppression always wins — an ignored communication is never offered to the flag policies at all. ' +
        'The vehicle now carries one verdict per pipeline rather than one verdict overall: FILTERED, QUALIFIED, or NOT_QUALIFIED. ' +
        'ec-surveillance-filter also handles the not-qualified exit to ec-surveillance-quota-manager for accounting, so the audit trail is complete regardless of outcome. ' +
        'Drag the content policy share slider down to zero and watch the evaluator station cost collapse — most of that cost is waiting for Cognition to answer.'
    },
    {
      id:'evaluator', name:'ec-surveillance-policy-evaluator', x:44, y:2,  r:4.5, color:C.evaluator,
      tag:'metadata local · content → Cognition · COMS async',
      short:'Policies answerable from metadata alone are decided here in milliseconds; policies needing the message body are sent to Cognition, an external analytics platform, whose verdicts return asynchronously on a separate topic.',
      body:'{sentToCognition} pipeline(s) currently out for content evaluation; the wait stands at {comsWaitMs} against a hard ceiling of 9,000,000 ms — about two and a half hours — after which the outcome is recorded as a timeout rather than lost. ' +
        'This station is a router and a timekeeper: it never judges content itself. ' +
        'The CIMS payload goes out on the tenant\'s Cognition topic; the COMS response arrives on samplingTopic_k8s and is matched by the correlation id. ' +
        'A metadata-only path (content policy share = 0%) skips this entirely.'
    },
    {
      id:'quota', name:'ec-surveillance-quota-manager', x:56, y:14, r:4.5, color:C.quota,
      tag:'SORTING GATE · atomic Redis · sampled or audit-only',
      short:'This is where the platform decides whether a human will ever read this communication. A single atomic Redis INCR, shared by every replica, prevents thirty-two replicas from together exceeding the quota.',
      body:'The counter reads {quotaUsed} of {quotaLimit} for this pipeline\'s bucket — and comes from a single atomic Redis increment, so the decision is consistent across a horizontally-scaled fleet. ' +
        'Verdict: {sampled}. ' +
        'Being unsampled is itself an audited outcome with a stored reason — it is never silence. ' +
        'From here, sampled communications continue to the alerting machine. Not-sampled communications skip to ec-centralised-audit directly. ' +
        'Drag Sampling % down to watch the carrier take the short route more often.'
    },
    {
      id:'alerting', name:'ec-alerting-service', x:52, y:34, r:4.5, color:C.alerting,
      tag:'four parallel enrichments · SupervisedItem · outbox write',
      short:'An alert is assembled rather than merely recorded: four data sources are fetched in parallel and written as a durable SupervisedItem document that will sit in a reviewer\'s queue.',
      body:'Four sources fetched simultaneously: the message body from S3, the monitored populations from the qualifier, the policy detail from the filter, and the Cognition scenario hits from ea-storage. ' +
        '{alertsCreated} alert(s) created — one per sampled pipeline, because the same communication can be reviewable in two different queues for two different reasons. ' +
        'ec-alerting-service CREATES the supervised_item document in MongoDB. ' +
        'Later, conduct-actioning-service MUTATES that same document when a reviewer dispositions it — one of only two shared-write relationships in the platform. ' +
        'The alert and its outbox row are written together so an alert cannot exist in a queue without also being announced downstream.'
    },
    {
      id:'echo', name:'ec-echo-engine', x:42, y:34, r:4.5, color:C.echo,
      tag:'MD5 fingerprint · 14-day TTL · echo suppression',
      short:'The echo engine asks whether this alert is genuinely new by comparing a 32-character MD5 digest of the policy hits against every fingerprint seen on this thread in the last 14 days.',
      body:'Fingerprint for this communication: {fingerprint}. Echo status: {isEcho}. ' +
        'On a long email thread re-scanned after every reply, the same surveillance scenario would raise an alert for every message. ' +
        'The echo engine prevents that with one indexed MongoDB lookup against the ec-echo-engine-state collection, which has a TTL index for the 14-day window. ' +
        'If it is an echo, the earlier alert is re-opened and updated rather than a new one created — the reviewer reads one alert, not thirty. ' +
        'The fingerprint is an MD5 of the sorted policy hit IDs, not of the message content.'
    },
    {
      id:'indexer', name:'ec-indexer', x:32, y:34, r:4.5, color:C.indexer,
      tag:'bulk batch → Elasticsearch · audio child doc',
      short:'Indexing deliberately does not write one document at a time: the indexer fills a batch of up to 50 records and flushes them as a single Elasticsearch bulk request.',
      body:'This communication is position {batchPosition} in a batch carrying {bulkBytes} of payload. ' +
        'Audio calls get a second child document holding the transcript attached to the same parent — both are indexed in the same bulk request. ' +
        'ec-indexer CREATES the Elasticsearch review document. ' +
        'Later, conduct-actioning-service UPDATES that document when a reviewer acts — one of only two shared-write relationships in the platform. ' +
        'Batching buys efficiency at the cost of blast radius, so a single poison record is retried alone rather than holding back the other 49.'
    },
    {
      id:'audit', name:'ec-centralised-audit', x:24, y:52, r:4.5, color:C.audit,
      tag:'audit stitching · reconciliation watermark · ShedLock',
      short:'Every verdict so far is mirrored here as an audit event and stitched into one record per communication, marked complete only when all pipelines reach a terminal outcome.',
      body:'{auditEventsEmitted} audit receipt(s) filed for this communication. ' +
        'ec-centralised-audit receives events from every upstream stage — not-qualified, filtered, evaluated, sampled, not-sampled, alerted, echo-closed, indexed. ' +
        'Every 15 minutes a ShedLock-guarded cron compares the number of completed communications against the gateway\'s ingest watermark for the same reconciliation token. ' +
        'Agreement between two independently produced counts is what "we can prove it" means in regulated surveillance. ' +
        'Its lagThreshold is 40 (the tightest of all consumers) because it receives several audit events per communication.'
    },
    {
      id:'reporting', name:'ec-reporting', x:36, y:52, r:4.5, color:C.reporting,
      tag:'per-pipeline counters · window-suffixed collections',
      short:'ec-reporting counts each audit event into a window-suffixed collection so a window\'s numbers can never be mixed with another\'s. Every 15 minutes a ShedLock cron re-aggregates per-pipeline totals.',
      body:'The counts stored here are what the monthly compliance report (ec-compliance-report) reads alongside the Elasticsearch review index — so an indexing failure and a disposition failure both change the numbers a regulator sees. ' +
        'Collection names include the windowToken suffix, making the time boundary explicit and preventing cross-window contamination. ' +
        'Like ec-centralised-audit, its lagThreshold is 40 — tight because the fan-in of audit events means several messages per communication arrive here.'
    },
    // side structure narrations
    {
      id:'config', name:'ec-config-curator', x:5, y:21, r:4.5, color:C.config,
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
      id:'hithighlight', name:'ec-conduct-hithighlight-service', x:5, y:30, r:3.5, color:C.review,
      tag:'hit-highlight offsets · reviewer rendering',
      short:'ec-conduct-hithighlight-service provides the byte offsets of matched phrases within the communication body, so the reviewer portal can render them as highlighted text.',
      body:'When a reviewer opens an alert in ea-ui-portal, the portal fetches the original snapshot and then requests highlight offsets from this service. ' +
        'The maximum number of highlight expressions per request is 20, measured from source. ' +
        'This service sits on the read path only: it never writes to surveillance stores and does not affect the audit trail.'
    },
    {
      id:'manualruns', name:'ec-manual-runs-service', x:5, y:41, r:4.5, color:C.manualruns,
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
      id:'reviewservice', name:'ec-review-service', x:68, y:8, r:3.5, color:C.review,
      tag:'reviewer entitlements · pipeline-group bindings',
      short:'ec-review-service is the entitlement authority for the review interface: it maps reviewers to their pipeline IDs and manages reviewer groups, pipeline bindings, and supervision queue configuration.',
      body:'ea-ui-portal calls this service to resolve a reviewer\'s entitled pipeline IDs when reviewer groups are enabled. ' +
        'ep-conduct-external-api forwards all entitlement and reviewer-group operations here. ' +
        'It owns no surveillance logic and does not participate in the data path — it is a configuration service queried on the review path.'
    },
    {
      id:'portal', name:'ea-ui-portal', x:68, y:19, r:5.0, color:C.portal,
      tag:'reviewer web application · Flow G entry',
      short:'ea-ui-portal is the reviewer\'s and administrator\'s web application: it lists queues, renders alerted communications with matched phrases highlighted, and dispatches reviewer dispositions to the actioning tier.',
      body:'When a reviewer dispositions an alert, the portal calls the conduct-actioning library (in-process) which decides the tier topic based on selection size: small ≤20, medium 21–50, large >50 documents. ' +
        'The disposition is published as a Kafka message. ' +
        'If ec-review-service is unavailable, queue listing falls back to the legacy entitlement path. ' +
        'If the actioning topic is misconfigured, a disposition appears accepted from the reviewer\'s point of view and is never applied — the authoritative record of lost dispositions is metadata_nonretryable_event in conduct-actioning-service. ' +
        'Scaling: 3–9 replicas, CPU and memory triggers (not Kafka lag), pollingInterval 20 s.'
    },
    {
      id:'externalapi', name:'ep-conduct-external-api', x:68, y:28, r:4.0, color:C.review,
      tag:'customer REST gateway · bulk actions · OAuth2/JWT',
      short:'ep-conduct-external-api is the customer-facing REST gateway for Conduct administration: reviewer groups, review entitlements, pipeline bindings, add-to-queue requests, and bulk actions. Every request is OAuth2/JWT authenticated.',
      body:'It owns no surveillance logic; it validates, audits every API interaction into app_audit_new, and forwards to ec-review-service and conduct-actioning-service. ' +
        'Bulk actions return a jobId immediately; the caller polls GET /external-api/bulk-actions/{jobId} for completion. ' +
        'Because it is a pure forwarder, a conduct-actioning-service outage surfaces as an accepted-then-stalled job. ' +
        'Scaling: 3–6 replicas, CPU 50% / memory 75% targets.'
    },
    {
      id:'actioningservice', name:'conduct-actioning-service', x:68, y:38, r:4.5, color:C.actioning,
      tag:'disposition executor · Mongo + ES two-store write · Flow G',
      short:'conduct-actioning-service executes what a reviewer decided: it applies the disposition to the supervised_item MongoDB document and to the Elasticsearch review index, then rolls up supervision metrics.',
      body:'It is the only service in the platform that mutates records another service created — ec-alerting-service wrote supervised_item and ec-indexer wrote the ES review document; conduct-actioning-service updates both. ' +
        'The two-store write is not transactional: a failure between the Mongo update and the ES update leaves an item dispositioned in the audit trail but still open in search results, where it will age into higher age buckets in the monthly compliance report. ' +
        'Non-retryable failures write metadata_nonretryable_event — there is no retry topic or DLT on this path. ' +
        'KEDA: lag autoscaling on the large tier only (lagThreshold 100).'
    },
    {
      id:'actioninglib', name:'conduct-actioning (library)', x:68, y:45, r:3.5, color:C.actioning,
      tag:'in-process at ea-ui-portal · tier routing · MetadataMessageInfo',
      short:'conduct-actioning is a Kotlin library linked into the portal process: it decides which tier topic an action goes to, builds the MetadataMessageInfo payload, and applies hold/legal-hold checks before publishing.',
      body:'Topic names are resolved at runtime from deployment properties (actioning.small.topic etc.), not hardcoded. ' +
        'A misconfigured or missing property publishes to a topic nobody consumes — the action is silently lost, with no local listener or DLT to catch it. ' +
        'This is the most fragile configuration coupling in the platform: the wrong label on the chute sends the item nowhere. ' +
        'The tier thresholds (small ≤20, medium 21–50, large >50 documents) are measured from env-variables.yaml.'
    },
    {
      id:'conductaudit', name:'ec-conduct-audit-service', x:51, y:54, r:3.5, color:C.reports,
      tag:'audit store manager · cross-service audit reads',
      short:'ec-conduct-audit-service manages audit records across the review and actioning planes, providing a unified read path for audit data that multiple services write independently.',
      body:'It sits on the read path for the review interface, aggregating audit data from ec-centralised-audit and the actioning plane. ' +
        'It does not participate in the live surveillance data path.'
    },
    {
      id:'reports', name:'conduct-reports', x:59, y:54, r:4.0, color:C.reports,
      tag:'scheduled administrative reports · ISS identity resolution',
      short:'conduct-reports produces scheduled and on-demand administrative reports — policy lists, entitlement reports, reconciliation numbers — by reading collections other repositories own.',
      body:'It is a Guice JAR driven by an external scheduler, not a service. It calls no EC service. ' +
        'Reads from MongoDB: supervision_queues, app_audit_new, supervision_queries, identities_v1, conduct_recon_report. ' +
        'Reads from Elasticsearch: supervision metric indices. ' +
        'The queue-level entitlement filter applied before any read is a security boundary — bypassing it would expose other queues\' data. ' +
        'Identifiers are resolved to human names through two ISS (identity service) calls. ' +
        'Scroll keep-alive 60 s; if the cluster is slow the scroll expires and the report is silently truncated.'
    },
    {
      id:'compliance', name:'ec-compliance-report', x:67, y:54, r:4.0, color:C.reports,
      tag:'monthly regulator CSV · SFTP/SMTP · Flow H',
      short:'ec-compliance-report produces the monthly regulator-facing CSV: supervised-item counts by origin and state, plus a histogram of how long open items have been open — and delivers it over SFTP or SMTP.',
      body:'It reads the same Elasticsearch review index that ec-indexer wrote and conduct-actioning-service mutated. ' +
        'This is the edge that closes the loop: an indexing failure removes rows from the report, and a disposition that updated MongoDB but not Elasticsearch leaves an item that reviewers see as closed and the report counts as open — ageing into higher buckets (1–15, 16–30, 31–60, 61–90, 91+ days) forever, visible here and nowhere else. ' +
        'Delivery is retried 10 times at 60-second intervals; a missed monthly send is a compliance event. ' +
        'Scroll: 10 slices, 5-minute keep-alive, 1000-document batches.'
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

  /* Expose an empty arrays that city-style code might iterate over. */
  var buildings = [];
  var props = [];

  global.World = {
    GW: GW, GH: GH,
    BELT: BELT,
    STATIONS_FLAT: STATIONS_FLAT,
    STATION_IDX_BY_ID: STATION_IDX_BY_ID,
    SIDE_STRUCTS: SIDE_STRUCTS,
    COG_FLOOR: COG_FLOOR,
    COGNITION: COGNITION,
    districts: DISTRICTS,
    districtById: DISTRICT_BY_ID,
    stationToDistrict: STATION_TO_DISTRICT,
    palette: C,
    readSeconds: readSeconds,
    buildings: buildings,
    props: props,
    build: build
  };
})(window);
