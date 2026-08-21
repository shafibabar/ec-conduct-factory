/* model.js — EC Factory Tour: what surveilling one communication actually costs.
 *
 * THE LESSON. Write this first, make it correct on its own. Every number the
 * panel shows comes from compute() below; nothing is pre-baked.
 *
 * Fidelity boundary (restated in the About modal):
 *
 *   Genuinely computed  The whole ranged-GET plan — chunk count, concurrency,
 *                       wave count, bytes on the wire and download time (a port
 *                       of FileChunkingStrategy.maxAllowedChunkSizeBytes) —
 *                       Kafka queue depth, KEDA replica scaling, retry-ladder
 *                       timing, quota counter, pipeline verdict fan-out, ES bulk
 *                       flush, echo duplicate detection, end-to-end latency.
 *   Assumed             S3 first-byte latency 25 ms, throughput 60 KB/ms,
 *                       minification ratio 0.12, Mongo read 4 ms / write 8 ms,
 *                       Redis increment 1 ms, ES bulk 40 ms base + 200 KB/ms,
 *                       policy evaluation 0.5 ms, Cognition RTT 45 000 ms,
 *                       enrichment fan-out 60 ms, 80% of a document's
 *                       participants in the monitored population, a flag
 *                       policy matching on 75% of the pipelines an ignore
 *                       policy did not suppress, four policies per pipeline,
 *                       90% of surveilled communications passing the sampling
 *                       profile's participant filters, and — illustrative
 *                       rather than assumed — the run's three trips read as
 *                       three alerts on one thread, so echo suppression is
 *                       visible inside a short run,
 *                       max-poll-records 50 where not overridden.
 *   Controlled          The Cognition round trip. A slider, not a constant:
 *                       it is the only latency EC's own code does not bound,
 *                       and it reaches past the 9 000 000 ms COMS ceiling.
 *   Scaled              Cognition wait (real ceiling 9 000 000 ms compressed
 *                       to 3 s screen time), quota window, echo TTL, and every
 *                       machine's work cycle: ec-gateway's press takes 2.5 s a
 *                       stroke to do what the model prices at ~200 ms.
 *   Faked               Factory floor shapes, belt textures, machine livery,
 *                       and the two opaque identifiers the floor displays: the
 *                       window token and the echo fingerprint are plausible
 *                       shapes, not real values.
 */
(function (global) {
  'use strict';

  /* ---- constants (Section 5e of system-explainer-input.md) -------------- */

  var S3_CHUNK_KB      = 5120;   // 5 MB — s3.parallel.download.chunk-size-in-mb: 5
  var S3_MAXCONC       = 25;     // max-allowed-concurrency: 25
  var S3_LATENCY_MS    = 25;     // ASSUMED: typical same-region first-byte latency
  var S3_THROUGHPUT    = 60;     // ASSUMED: KB/ms per connection (~60 MB/s)
  var MINIFY_RATIO     = 0.12;   // ASSUMED: body strip leaves ~12% of original
  var MONGO_READ_MS    = 4;      // ASSUMED: single indexed lookup
  var MONGO_WRITE_MS   = 8;      // ASSUMED: acknowledged write
  var MONGO_BULK_MS    = 15;     // ASSUMED: unordered bulk upsert
  var REDIS_INCR_MS    = 1;      // ASSUMED: single atomic increment
  var ES_BULK_BASE_MS  = 40;     // ASSUMED: Elasticsearch bulk request base cost
  var ES_BULK_KB_PER_MS = 200;   // ASSUMED: KB/ms bulk indexing throughput
  var POLICY_MS        = 0.5;    // ASSUMED: ms per policy evaluated
  var COGNITION_RTT_MS = 45000;  // ASSUMED: external analytics platform RTT.
                                 // The default of the Cognition control, not a
                                 // fixed cost: this is the only step whose
                                 // latency EC's own code does not bound.
  var COMS_TIMEOUT_MS  = 9000000;// measured: ec-surveillance-policy-evaluator COMS timeout
  var HTTP_ENRICH_MS   = 60;     // ASSUMED: slowest of four parallel enrichment fetches
  var MD5_MS           = 0.2;    // industry-standard: MD5 over a small fingerprint
  var KAFKA_PRODUCE_MS = 2;      // industry-standard: Kafka produce latency
  var TRIAGE_MS        = 1;      // ASSUMED: in-process policy split

  var ECHO_TTL_DAYS    = 14;     // measured: ec-echo-engine-state TTL
  var PROFILE_INCLUDE  = 0.9;    // ASSUMED: share of surveilled communications
                                 // whose participants and direction pass the
                                 // sampling profile's own filters. The rest are
                                 // recorded as "ignored" — and the quota is
                                 // never spent on them, because that check runs
                                 // before the counter.
  var FLAG_MATCH_SHARE = 0.75;   // ASSUMED: of the pipelines an ignore policy
                                 // did NOT suppress, the share where a flag
                                 // policy then matches. The rest end
                                 // NOT_QUALIFIED — nothing claimed them, which
                                 // is still an audited outcome.
  var MONITORED_SHARE  = 0.8;    // ASSUMED: share of a document's participants
                                 // that are in the monitored population. The
                                 // rest come back from the pipeline-entity
                                 // -mapping query as no match at all.

  /* An illustrative window token, in the shape the real ones take. Every
     frozen collection is suffixed with one — pipeline-entity-mapping_{wt},
     ec-reporting-pipeline-events_{wt} — and the whole point of the mechanism
     is that it does not change while a window is open, so a constant is the
     honest representation of it. Same class as v.fingerprint below. */
  var WINDOW_TOKEN     = 'wt-2f9c41';

  // KEDA per-service config (measured from cd/k8s ScaledObject in each repo — Section 5e)
  var SERVICE_CFG = {
    gateway:   { batch: 50, conc: 1, minRep: 3, maxRep: 32, lagThresh: 150  },
    qualifier: { batch: 50, conc: 1, minRep: 3, maxRep: 32, lagThresh: 150  },
    filter:    { batch: 50, conc: 1, minRep: 3, maxRep: 32, lagThresh: 150  },
    evaluator: { batch: 50, conc: 1, minRep: 3, maxRep: 32, lagThresh: 150  },
    quota:     { batch: 50, conc: 1, minRep: 3, maxRep: 32, lagThresh: 50   }, // tightest
    alerting:  { batch: 50, conc: 1, minRep: 3, maxRep: 32, lagThresh: 1000 }, // loosest
    echo:      { batch: 10, conc: 1, minRep: 3, maxRep: 32, lagThresh: 150  },
    indexer:   { batch: 50, conc: 1, minRep: 3, maxRep: 5,  lagThresh: 150  },
    audit:     { batch: 50, conc: 1, minRep: 3, maxRep: 32, lagThresh: 40   }, // tight: fan-in
    reporting: { batch: 50, conc: 1, minRep: 3, maxRep: 32, lagThresh: 40   }  // tight: same
  };

  // retry delays per service (measured from repos — Section 5e)
  var RETRY0_MS = {
    gateway: 1000, qualifier: 1000, filter: 1000, evaluator: 1000,
    quota: 1000, alerting: 500, echo: 1000, indexer: 1000, audit: 500, reporting: 500
  };
  var RETRY1_MS = {
    gateway: 2000, qualifier: 2000, filter: 2000, evaluator: 2000,
    quota: 2000, alerting: 1500, echo: 2000, indexer: 2000, audit: 2000, reporting: 2000
  };

  /* ---- S3 download model (port of FileChunkingStrategy.maxAllowedChunkSizeBytes)
   *
   * s3Plan is the whole ranged-GET story in one object, because ec-gateway's
   * machine draws it: how many byte-range chunks the object splits into, how
   * many go out at once, how many waves that takes, and how big the chunk on
   * the wire actually is.
   *
   * That last number used to be pinned to the full 5 MB chunk size for every
   * document, so a 1 KB document was charged the same ~110 ms as a 5 MB one and
   * the download time never moved when the Doc slider did. A ranged GET only
   * asks for the bytes that exist: the chunk on the wire is min(size, 5 MB).
   */
  function s3Plan(sizeKb) {
    if (sizeKb <= 0) return { chunks: 0, conc: 0, waves: 0, chunkKb: 0, ms: 0 };
    var chunks  = Math.ceil(sizeKb / S3_CHUNK_KB);
    var conc    = Math.min(chunks, S3_MAXCONC);
    var waves   = Math.ceil(chunks / conc);
    var chunkKb = Math.min(sizeKb, S3_CHUNK_KB);
    return {
      chunks: chunks, conc: conc, waves: waves, chunkKb: chunkKb,
      ms: waves * (S3_LATENCY_MS + chunkKb / S3_THROUGHPUT)
    };
  }

  function s3DownloadMs(sizeKb) { return s3Plan(sizeKb).ms; }

  /* ---- per-station work (Section 5c) ----------------------------------- */

  function stationWork(service, v, p) {
    var docKb = p.avgDocSizeKb;
    switch (service) {

      case 'gateway':
        v.bytesDownloaded  = docKb;
        v.bytesAfterMinify = docKb * MINIFY_RATIO;
        return s3DownloadMs(docKb) + 30 /*S3_PUT_MS*/ + MONGO_WRITE_MS;

      case 'qualifier':
        /* One indexed query against pipeline-entity-mapping_{windowToken},
           whatever the length of the $in list — so participants moves what the
           machine shows and deliberately does not move what it costs. */
        v.participants    = p.participants;
        v.matchedEntities = Math.round(p.participants * MONITORED_SHARE);
        v.pipelineIds     = v.matchedEntities > 0 ? v.pipelineCount : 0;
        v.windowToken     = WINDOW_TOKEN;
        return s3DownloadMs(docKb) + MONGO_READ_MS;

      case 'filter':
        /* Ignore policies first, then flag policies, independently per
           pipeline. The order is not a detail: an ignored communication is
           never offered to the flag policies at all, and reordering the two
           silently changes results. */
        var claimed = v.pipelineIds;
        v.filtered     = Math.round(claimed * p.ignoreShare / 100);
        var survived   = claimed - v.filtered;
        v.qualified    = Math.round(survived * FLAG_MATCH_SHARE);
        v.notQualified = survived - v.qualified;
        /* Both suppression verdicts publish to …not-qualified, which the quota
           manager consumes for accounting only. If nothing qualified, the
           record never reaches evaluation at all — Flow B2. */
        v.allSuppressed = claimed > 0 && v.qualified === 0;
        var policies = claimed * 4;
        return s3DownloadMs(docKb) + MONGO_READ_MS + POLICY_MS * policies;

      case 'evaluator':
        /* partition(policies, p -> p.answerableFromMetadata). Only the
           pipelines that qualified reach evaluation at all. Metadata-only
           verdicts are synthesised here in Cognition's own response shape and
           published immediately; the rest leave the platform. */
        v.sentToCognition = Math.round(v.qualified * p.contentPolicyShare / 100);
        v.metadataOnly    = v.qualified - v.sentToCognition;

        /* The wait is whatever Cognition takes. What the platform is willing to
           wait is COMS_TIMEOUT_MS; past that the outcome is recorded as a
           timeout — no-coms-timedout — and those communications never reach
           sampling. The verdict is not lost, but it is not acted on either. */
        v.comsRttMs    = v.sentToCognition > 0 ? p.cognitionRttMs : 0;
        v.comsTimedOut = v.comsRttMs > COMS_TIMEOUT_MS;
        v.comsWaitMs   = Math.min(v.comsRttMs, COMS_TIMEOUT_MS);

        /* Nothing reached …surveilled: every qualified pipeline went out for
           content and none came back in time. */
        v.evaluatorStalled = v.comsTimedOut && v.metadataOnly === 0
                                            && v.sentToCognition > 0;
        return TRIAGE_MS + KAFKA_PRODUCE_MS;

      case 'quota':
        /* Sampling is TWO conditions ANDed, against ONE counter:
         *
         *   used    = redis.incr(bucket)                 // atomic, all replicas
         *   limit   = round(pct / 100 * expectedVolume(bucket))
         *   sampled = used <= limit AND hash(gcid) % 100 < pct
         *
         * and before either of them, the profile's participant filters decide
         * whether this communication is in scope at all. That check returns
         * early — an ignored record never touches the counter, so the quota is
         * not spent on it. */
        var seed = 1005 + (p.trip || 0) * 4327;
        v.gcid       = 'gcid-' + seed.toString(16);
        v.hashBucket = seed % 100;

        v.profileIgnored = !v.allSuppressed &&
                           (seed % 10) >= Math.round(PROFILE_INCLUDE * 10);

        v.quotaLimit = Math.round(p.samplingPercent / 100 * 100);
        if (!v.profileIgnored) v.quotaUsed = v.quotaUsed + 1;
        v.quotaRoom  = v.quotaUsed <= v.quotaLimit;
        v.hashAdmits = v.hashBucket < p.samplingPercent;

        /* A record with nothing qualified reaches the gate for accounting only
           and can never be sampled. */
        v.sampled = !v.allSuppressed && !v.profileIgnored &&
                    v.quotaRoom && v.hashAdmits;

        /* The event names this service emits distinguish WHY, and the machine
           has a separate chute for each. */
        v.quotaEvent = v.allSuppressed   ? 'not-qualified'
                     : v.profileIgnored  ? 'ignored'
                     : v.sampled         ? 'sampled'
                     : !v.quotaRoom      ? 'not-sampled'
                                         : 'random.not-sampled';

        /* bucketKey(pipelineId, populationOf(parts), direction, hourOf(sentTime)) */
        v.bucketKey = 'p' + Math.max(1, v.pipelineIds) +
                      '·pop' + (v.matchedEntities % 97).toString(36) +
                      '·in·h' + (seed % 24);
        return s3DownloadMs(docKb) + REDIS_INCR_MS + MONGO_WRITE_MS;

      case 'alerting':
        /* One alert per qualified pipeline, and four enrichments fetched in
           PARALLEL — the message body from S3, populations from the qualifier,
           policy detail from the filter, scenario hits from EA Storage. The
           cost is the slowest of the four, not their sum, and which one is
           slowest flips with document size. */
        v.alertsCreated = v.sampled ? v.qualified : 0;
        v.enrichS3Ms    = s3DownloadMs(docKb);
        v.enrichRestMs  = HTTP_ENRICH_MS;
        v.enrichMs      = Math.max(v.enrichS3Ms, v.enrichRestMs);
        v.enrichSlowest = v.enrichS3Ms >= v.enrichRestMs ? 'S3 body' : 'REST';
        return v.enrichMs + MONGO_WRITE_MS;

      case 'echo':
        /* The fingerprint is an MD5 of the SORTED POLICY HIT IDS. Content is
           never compared — this station does not open the document at all.
           It used to be `Math.random() < 0.08`, which was recomputed on every
           frame and made the outcome unrepeatable and unexplorable. */
        /* Derived from the policy hits, NOT from the trip — the whole point is
           that the same scenario firing on the same thread produces the same
           32 characters, which is what makes it recognisable as a repeat.
           Change Pipes and the hits change, so the fingerprint does too and
           nothing suppresses. */
        var ehits = Math.max(1, v.qualified) * 2654435761;
        v.fingerprint = 'a3f7' +
          ('00000000' + (ehits % 0xffffffff).toString(16)).slice(-8);

        /* ILLUSTRATIVE: the run's three trips are read as three alerts on ONE
           thread, which is the only way suppression becomes visible in a short
           run. Real threads are identified by alertThreadId. */
        v.echoPriors  = p.trip || 0;
        v.echoOutcome = v.echoPriors === 0 ? 'new'
                      : v.echoPriors === 1 ? 'echo-closed'
                                           : 'late-arrival';
        v.isEcho      = v.echoOutcome !== 'new';
        return MD5_MS + MONGO_READ_MS;

      case 'indexer':
        /* ILLUSTRATIVE: where in a batch of 50 a given communication lands is a
           matter of timing. Incrementing a counter that starts at 25 meant the
           position was 26 on every trip and the flush NEVER happened — the one
           thing this station exists to show. The run's three trips are given
           positions 26, 50 and 13 instead, so the fiftieth arrives inside a
           short run and you can watch it pay for the other forty-nine. */
        var IDX_POS = [26, 50, 13];
        v.batchPosition = IDX_POS[(p.trip || 0) % 3];
        v.bulkBytes     = v.batchPosition * docKb * MINIFY_RATIO;
        v.bulkFlush     = v.batchPosition >= 50;

        /* the same FileChunkingStrategy the gateway uses, ported verbatim */
        var iwork = s3DownloadMs(docKb);
        if (v.bulkFlush) {
          iwork += ES_BULK_BASE_MS + v.bulkBytes / ES_BULK_KB_PER_MS;
          /* per-record fate, not per-batch: one poison record in fifty is
             retried alone rather than holding back the other forty-nine */
          v.bulkFailed = Math.round(50 * p.failureRate / 100);
        } else {
          v.bulkFailed = 0;
        }

        v.esIndexName = 'surveil.av5';
        var iseed = 1005 + (p.trip || 0) * 4327;
        v.isAudio = (iseed % 3) === 0;   /* an audio call gets a child document */
        return iwork;

      case 'audit':
      case 'reporting':
        v.auditEventsEmitted = (v.auditEventsEmitted || 0) + 1;
        return MONGO_BULK_MS * Math.max(1, v.pipelineIds);

      default:
        return 2;
    }
  }

  /* ---- KEDA autoscaling ------------------------------------------------- */

  function scaleReplicas(cfg, lag, autoscaling) {
    if (!autoscaling) return cfg.minRep;
    return Math.max(cfg.minRep, Math.min(cfg.maxRep, Math.ceil(lag / cfg.lagThresh)));
  }

  /* ---- main compute call ------------------------------------------------ */

  function compute(p) {
    var services = ['gateway','qualifier','filter','evaluator','quota',
                    'alerting','echo','indexer','audit','reporting'];
    var v = {
      /* The Pipes selector. It reached the drawers but never this function,
         so every fan-out cost below — filter policies, alerts created, the
         audit bulk write — was priced for two pipelines whatever the reader
         had selected. */
      pipelineCount: p.pipelineCount || 2,
      bytesDownloaded: 0, bytesAfterMinify: 0,
      participants: 0, matchedEntities: 0, pipelineIds: 0,
      windowToken: WINDOW_TOKEN,
      filtered: 0, qualified: 0, notQualified: 0, allSuppressed: false,
      metadataOnly: 0, comsRttMs: 0, comsTimedOut: false, evaluatorStalled: false,
      enrichS3Ms: 0, enrichRestMs: 0, enrichMs: 0, enrichSlowest: '',
      gcid: '', hashBucket: 0, hashAdmits: false, quotaRoom: true,
      profileIgnored: false, quotaEvent: '', bucketKey: '',
      sentToCognition: 0, comsWaitMs: 0,
      quotaUsed: Math.round(p.samplingPercent / 100 * 50),
      quotaLimit: 0, sampled: false,
      alertsCreated: 0, fingerprint: '', isEcho: false,
      echoPriors: 0, echoOutcome: '',
      batchPosition: 25, bulkFlush: false, bulkFailed: 0,
      esIndexName: '', isAudio: false,
      bulkBytes: 0,
      auditEventsEmitted: 0,
      latencyMs: 0
    };

    var totalMs = 0;
    var phases = [];

    services.forEach(function (s) {
      var cfg = SERVICE_CFG[s];
      var workMs = stationWork(s, v, p);

      var retryMs = 0;
      if (p.failureRate > 0) {
        var fr = p.failureRate / 100;
        retryMs = fr * (RETRY0_MS[s] + RETRY1_MS[s]);
      }

      var totalWork = workMs + retryMs;
      var tputPerReplica = (cfg.batch * 1000) / Math.max(1, totalWork);
      var lag = Math.max(0, p.ingestRate / tputPerReplica - 1) * cfg.batch;
      var replicas = scaleReplicas(cfg, lag, p.autoscaling);
      var tput = replicas * tputPerReplica;
      var queueMs = lag > 0 ? (lag / Math.max(1, tput)) * 1000 : 0;

      totalMs += workMs + queueMs;

      phases.push({
        id: s, workMs: workMs, queueMs: queueMs,
        retryMs: retryMs, lag: lag, replicas: replicas,
        lagThresh: cfg.lagThresh, overThresh: lag > cfg.lagThresh
      });
    });

    var comsMs = v.comsWaitMs;

    return {
      phases: phases,
      vehicle: v,
      totalMs: totalMs + comsMs,
      comsMs: comsMs,
      sampledRate: p.samplingPercent,
      throughput: p.ingestRate * (p.samplingPercent / 100),
      bottleneck: findBottleneck(phases)
    };
  }

  function findBottleneck(phases) {
    var worst = phases[0];
    phases.forEach(function (ph) {
      if (ph.overThresh && (!worst.overThresh || ph.lag > worst.lag)) worst = ph;
    });
    return worst.id;
  }

  /* ---- formatters ------------------------------------------------------- */

  function fmtMs(ms) {
    if (ms >= 1000) return (ms / 1000).toFixed(1) + ' s';
    if (ms >= 100)  return Math.round(ms) + ' ms';
    return (Math.round(ms * 10) / 10) + ' ms';
  }

  function fmtKb(kb) {
    if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
    return Math.round(kb) + ' KB';
  }

  function fmtNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  global.EC = {
    SERVICE_CFG: SERVICE_CFG,
    ECHO_TTL_DAYS: ECHO_TTL_DAYS,
    MONITORED_SHARE: MONITORED_SHARE,
    FLAG_MATCH_SHARE: FLAG_MATCH_SHARE,
    COGNITION_RTT_MS: COGNITION_RTT_MS,
    PROFILE_INCLUDE: PROFILE_INCLUDE,
    WINDOW_TOKEN: WINDOW_TOKEN,
    COMS_TIMEOUT_MS: COMS_TIMEOUT_MS,
    MINIFY_RATIO: MINIFY_RATIO,
    S3_CHUNK_KB: S3_CHUNK_KB,
    S3_MAXCONC: S3_MAXCONC,
    s3Plan: s3Plan,
    s3DownloadMs: s3DownloadMs,
    stationWork: stationWork,
    scaleReplicas: scaleReplicas,
    compute: compute,
    fmtMs: fmtMs,
    fmtKb: fmtKb,
    fmtNum: fmtNum
  };
})(window);
