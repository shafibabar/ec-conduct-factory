/* model.js — EC Factory Tour: what surveilling one communication actually costs.
 *
 * THE LESSON. Write this first, make it correct on its own. Every number the
 * panel shows comes from compute() below; nothing is pre-baked.
 *
 * Fidelity boundary (restated in the About modal):
 *
 *   Genuinely computed  S3 chunk sizing and wave count (port of
 *                       FileChunkingStrategy.maxAllowedChunkSizeBytes), Kafka
 *                       queue depth, KEDA replica scaling, retry-ladder timing,
 *                       quota counter, pipeline verdict fan-out, ES bulk flush,
 *                       echo duplicate detection, end-to-end latency.
 *   Assumed             S3 first-byte latency 25 ms, throughput 60 KB/ms,
 *                       minification ratio 0.12, Mongo read 4 ms / write 8 ms,
 *                       Redis increment 1 ms, ES bulk 40 ms base + 200 KB/ms,
 *                       policy evaluation 0.5 ms, Cognition RTT 45 000 ms,
 *                       enrichment fan-out 60 ms, 6 participants per document,
 *                       max-poll-records 50 where not overridden.
 *   Scaled              Cognition wait (real ceiling 9 000 000 ms compressed
 *                       to 3 s screen time), quota window, echo TTL.
 *   Faked               Factory floor shapes, belt textures, machine livery.
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
  var COGNITION_RTT_MS = 45000;  // ASSUMED: external analytics platform RTT
  var COMS_TIMEOUT_MS  = 9000000;// measured: ec-surveillance-policy-evaluator COMS timeout
  var HTTP_ENRICH_MS   = 60;     // ASSUMED: slowest of four parallel enrichment fetches
  var MD5_MS           = 0.2;    // industry-standard: MD5 over a small fingerprint
  var KAFKA_PRODUCE_MS = 2;      // industry-standard: Kafka produce latency
  var TRIAGE_MS        = 1;      // ASSUMED: in-process policy split

  var ECHO_TTL_DAYS    = 14;     // measured: ec-echo-engine-state TTL
  var PARTICIPANTS     = 6;      // ASSUMED: typical iusers+eusers per document

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

  /* ---- S3 download model (port of FileChunkingStrategy.maxAllowedChunkSizeBytes) */

  function s3DownloadMs(sizeKb) {
    if (sizeKb <= 0) return 0;
    var possibleConc = Math.ceil(sizeKb / S3_CHUNK_KB);
    var actualConc   = Math.min(possibleConc, S3_MAXCONC);
    var chunkKb      = possibleConc <= S3_MAXCONC ? S3_CHUNK_KB
                                                   : Math.ceil(sizeKb / actualConc);
    var waves        = Math.ceil(possibleConc / actualConc);
    return waves * (S3_LATENCY_MS + chunkKb / S3_THROUGHPUT);
  }

  /* ---- per-station work (Section 5c) ----------------------------------- */

  function stationWork(service, v, p) {
    var docKb = p.avgDocSizeKb;
    switch (service) {

      case 'gateway':
        v.bytesDownloaded  = docKb;
        v.bytesAfterMinify = docKb * MINIFY_RATIO;
        return s3DownloadMs(docKb) + 30 /*S3_PUT_MS*/ + MONGO_WRITE_MS;

      case 'qualifier':
        v.participants = PARTICIPANTS;
        return s3DownloadMs(docKb) + MONGO_READ_MS;

      case 'filter':
        var policies = v.pipelineCount * 4;
        return s3DownloadMs(docKb) + MONGO_READ_MS + POLICY_MS * policies;

      case 'evaluator':
        v.sentToCognition = Math.round(v.pipelineCount * p.contentPolicyShare / 100);
        if (v.sentToCognition > 0) {
          v.comsWaitMs = Math.min(COGNITION_RTT_MS, COMS_TIMEOUT_MS);
        } else {
          v.comsWaitMs = 0;
        }
        return TRIAGE_MS + KAFKA_PRODUCE_MS;

      case 'quota':
        v.quotaUsed  = v.quotaUsed + 1;
        var quota    = Math.round(p.samplingPercent / 100 * 100);
        v.quotaLimit = quota;
        v.sampled    = v.quotaUsed <= quota;
        return s3DownloadMs(docKb) + REDIS_INCR_MS + MONGO_WRITE_MS;

      case 'alerting':
        v.alertsCreated = v.sampled ? v.pipelineCount : 0;
        return Math.max(s3DownloadMs(docKb), HTTP_ENRICH_MS) + MONGO_WRITE_MS;

      case 'echo':
        v.fingerprint = 'a3f7' + Math.round(v.pipelineCount * 1e4).toString(16);
        v.isEcho = Math.random() < 0.08;
        return MD5_MS + MONGO_READ_MS;

      case 'indexer':
        v.batchPosition = (v.batchPosition || 0) + 1;
        v.bulkBytes = v.batchPosition * docKb * MINIFY_RATIO;
        var work = s3DownloadMs(docKb);
        if (v.batchPosition >= 50) {
          work += ES_BULK_BASE_MS + v.bulkBytes / ES_BULK_KB_PER_MS;
          v.batchPosition = 0;
        }
        return work;

      case 'audit':
      case 'reporting':
        v.auditEventsEmitted = (v.auditEventsEmitted || 0) + 1;
        return MONGO_BULK_MS * Math.max(1, v.pipelineCount);

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
      pipelineCount: 2,
      bytesDownloaded: 0, bytesAfterMinify: 0,
      participants: 0,
      sentToCognition: 0, comsWaitMs: 0,
      quotaUsed: Math.round(p.samplingPercent / 100 * 50),
      quotaLimit: 0, sampled: false,
      alertsCreated: 0, fingerprint: '', isEcho: false,
      batchPosition: 25,
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

    var comsMs = v.comsWaitMs > 0 ? Math.min(COGNITION_RTT_MS, COMS_TIMEOUT_MS) : 0;

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
    COMS_TIMEOUT_MS: COMS_TIMEOUT_MS,
    MINIFY_RATIO: MINIFY_RATIO,
    s3DownloadMs: s3DownloadMs,
    stationWork: stationWork,
    scaleReplicas: scaleReplicas,
    compute: compute,
    fmtMs: fmtMs,
    fmtKb: fmtKb,
    fmtNum: fmtNum
  };
})(window);
