/* GET /api/classifier/summary
 *
 * Per-run classifier metrics: confusion matrix, precision/recall/specificity,
 * false-negative counts, per split. Only runs that EXIST are returned; a run
 * with no predictions comes back as an explicit empty state, never a borrowed
 * accuracy number. Offline runs are labelled `offline: true`.
 *
 * MAUDE-positive partitions are recall-only (no specificity) and are marked so.
 * Partition visibility is enforced server-side via _lib/partitions.
 */
const { send, method } = require('../http');
const { safeSelect, referenceByRecord, latestPredictionByRecord } = require('../db');
const sb = require('../supabase');
const parts = require('../partitions');
const metrics = require('../metrics');

const MAX_RUNS = 10;
const MAX_ROWS = 2000;

async function runMetrics(run, aud) {
  const preds = await safeSelect('tf_predictions', {
    select: '*',
    run_id: `eq.${run.id}`,
    limit: MAX_ROWS,
  });
  if (!preds.ok) return metrics.computeRunMetrics(run, [], { partitionScope: parts.visiblePartitions(aud) });

  const ids = [...new Set(preds.data.map((p) => p.normalized_record_id))];
  if (!ids.length) return metrics.computeRunMetrics(run, [], { partitionScope: parts.visiblePartitions(aud) });

  const [labelsRes, recordsRes] = await Promise.all([
    safeSelect('tf_reference_labels', { select: '*', normalized_record_id: parts.inFilter(ids), limit: MAX_ROWS }),
    safeSelect('tf_normalized_records', { select: 'id,partition,split', id: parts.inFilter(ids), limit: MAX_ROWS }),
  ]);
  const ref = referenceByRecord(labelsRes.data);
  const recById = new Map(recordsRes.data.map((r) => [r.id, r]));

  // Enforce the partition gate again on the joined rows.
  const pairs = [];
  for (const p of preds.data) {
    const rec = recById.get(p.normalized_record_id);
    if (!rec || !parts.canSee(rec.partition, aud)) continue;
    const label = ref.get(p.normalized_record_id);
    if (!label) continue;
    pairs.push({
      reference: label.label,
      predicted: p.predicted_label,
      confidence: p.confidence,
      partition: rec.partition,
      split: label.split || rec.split,
    });
  }

  const anyMaude = pairs.some((p) => parts.isMaude(p.partition));
  const block = metrics.computeRunMetrics(run, pairs, {
    recallOnly: anyMaude,
    partitionScope: parts.visiblePartitions(aud),
  });
  block.perSplit = metrics.perSplit(pairs);
  block.recallOnly = anyMaude;
  return block;
}

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const aud = parts.audience(req);

  if (!sb.configured()) {
    return send(res, 503, {
      ok: false,
      error: 'supabase_not_configured',
      note: 'Serverless functions have no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in this environment.',
    });
  }

  const runs = await safeSelect('tf_model_runs', { select: '*', order: 'created_at.desc', limit: MAX_RUNS });
  if (!runs.ok) {
    return send(res, 200, {
      ok: true, audience: aud, runs: [], empty: true,
      error: runs.error,
      note: 'tf_model_runs could not be read (schema drift or empty). No metrics are shown rather than stale numbers.',
    });
  }
  if (!runs.data.length) {
    return send(res, 200, {
      ok: true, audience: aud, runs: [], empty: true, reason: 'no_runs',
      note: 'No classifier runs exist yet. Metrics appear only for runs that have actually been recorded.',
    });
  }

  const out = [];
  for (const run of runs.data) out.push(await runMetrics(run, aud));

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