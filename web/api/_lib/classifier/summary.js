/* GET /api/classifier/summary
 *
 * Per-run classifier metrics against the LIVE schema. Only runs that EXIST are
 * returned; a run with no predictions is an explicit empty state. Offline runs
 * are labelled `offline: true` (run.run_type added by migration 0001; defaults
 * to offline, which is the honest reading of the current exploratory runs).
 * MAUDE-positive partitions are recall-only.
 */
const { send, method } = require('../http');
const { safeSelect, referenceByRecord } = require('../db');
const sb = require('../supabase');
const parts = require('../partitions');
const metrics = require('../metrics');

const MAX_RUNS = 10;
const MAX_ROWS = 2000;
const inFilter = (v) => parts.inFilter(v);

async function runMetrics(run, aud) {
  const preds = await safeSelect('tf_predictions', { select: '*', run_id: `eq.${run.id}`, limit: MAX_ROWS });
  const scope = parts.visiblePartitions(aud);
  if (!preds.ok || !preds.data.length) {
    const empty = metrics.computeRunMetrics(run, [], { partitionScope: scope });
    empty.recallOnly = false;
    return empty;
  }

  const ids = [...new Set(preds.data.map((p) => p.record_id))];
  const [labelsRes, recordsRes, versionRes] = await Promise.all([
    safeSelect('tf_reference_labels', { select: '*', record_id: inFilter(ids), limit: MAX_ROWS }),
    safeSelect('tf_normalized_records', { select: 'id,data_partition,split', id: inFilter(ids), limit: MAX_ROWS }),
    run.model_version_id
      ? safeSelect('tf_model_versions', { select: '*', id: `eq.${run.model_version_id}`, limit: 1 })
      : Promise.resolve({ ok: true, data: [] }),
  ]);
  const ref = referenceByRecord(labelsRes.data);
  const recById = new Map(recordsRes.data.map((r) => [r.id, r]));

  const pairs = [];
  for (const p of preds.data) {
    const rec = recById.get(p.record_id);
    if (!rec || !parts.canSee(rec.data_partition, aud)) continue;
    const label = ref.get(p.record_id);
    if (!label) continue;
    pairs.push({
      reference: label.label,
      predicted: p.predicted_label,
      confidence: p.confidence,
      partition: rec.data_partition,
      split: label.split || rec.split,
    });
  }

  const anyMaude = pairs.some((p) => parts.isMaude(p.partition));
  const version = versionRes.data[0] || null;
  const block = metrics.computeRunMetrics(run, pairs, {
    recallOnly: anyMaude,
    partitionScope: scope,
  });
  block.perSplit = metrics.perSplit(pairs);
  block.recallOnly = anyMaude;
  block.modelFamily = version ? version.model_family : null;
  block.modelStatus = version ? version.status : null;
  block.modelThreshold = version ? version.threshold : (run.parameters && run.parameters.threshold) || null;
  block.datasetVersion = run.dataset_version || null;
  block.dataPartition = run.data_partition || null;
  return block;
}

function runMeta(run) {
  const params = run.parameters || {};
  return {
    ...run,
    run_type: run.run_type || params.run_type || 'offline',
    model_version: run.model_version_id || null,
    eval_split: run.eval_split || params.eval_split || null,
    threshold: params.threshold != null ? params.threshold : undefined,
    created_at: run.created_at || run.started_at || null,
  };
}

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const aud = parts.audience(req);

  if (!sb.configured()) {
    return send(res, 503, { ok: false, error: 'supabase_not_configured' });
  }

  const runs = await safeSelect('tf_model_runs', { select: '*', order: 'started_at.desc', limit: MAX_RUNS });
  if (!runs.ok) {
    return send(res, 200, {
      ok: true, audience: aud, runs: [], empty: true, error: runs.error,
      note: 'tf_model_runs could not be read. No metrics are shown rather than stale numbers.',
    });
  }
  if (!runs.data.length) {
    return send(res, 200, {
      ok: true, audience: aud, runs: [], empty: true, reason: 'no_runs',
      note: 'No classifier runs exist yet. Metrics appear only for runs that have actually been recorded.',
    });
  }

  const out = [];
  for (const run of runs.data) out.push(await runMetrics(runMeta(run), aud));

  send(res, 200, {
    ok: true,
    audience: aud,
    partitionsVisible: parts.visiblePartitions(aud),
    count: out.length,
    empty: out.every((r) => r.empty),
    runs: out,
    provenance: 'each block is computed from that run\'s tf_predictions joined to tf_reference_labels',
    metricDefinitions: {
      positiveClass: 'complaint (candidate for human Quality review)',
      recall: 'tp / (tp + fn)',
      specificity: 'tn / (tn + fp)',
      precision: 'tp / (tp + fp)',
      note: 'MAUDE-positive partitions report recall only.',
    },
  });
};