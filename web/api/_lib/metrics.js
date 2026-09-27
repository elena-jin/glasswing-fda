/* Test Flight — metrics provenance.
 *
 * Pure functions so they can be unit-tested without a database. The rule the
 * spec cares about: never present a number that is not derived from a run that
 * actually exists. If a run has no predictions, the honest answer is "empty",
 * not a borrowed accuracy figure.
 *
 * The positive class is `complaint` (a candidate for human Quality review).
 * `excluded` records are intake-gate controls and are reported separately, not
 * folded into the confusion matrix.
 */

const POSITIVE = 'complaint';

function isPositive(label) {
  return String(label || '').toLowerCase() === POSITIVE;
}

/* pairs: [{ reference, predicted, confidence, partition }] */
function confusion(pairs) {
  const cm = { tp: 0, fp: 0, tn: 0, fn: 0, excluded: 0, total: 0 };
  for (const p of pairs) {
    cm.total++;
    const ref = String(p.reference || '').toLowerCase();
    const pred = String(p.predicted || '').toLowerCase();
    if (ref === 'excluded') { cm.excluded++; continue; }
    const rp = ref === POSITIVE;
    const pp = pred === POSITIVE;
    if (rp && pp) cm.tp++;
    else if (!rp && pp) cm.fp++;
    else if (!rp && !pp) cm.tn++;
    else cm.fn++;
  }
  return cm;
}

function safeDiv(n, d) {
  return d > 0 ? n / d : null;
}

function binaryMetrics(cm, { recallOnly = false } = {}) {
  const denom = cm.tp + cm.tn + cm.fp + cm.fn;
  const m = {
    precision: recallOnly ? null : safeDiv(cm.tp, cm.tp + cm.fp),
    recall: safeDiv(cm.tp, cm.tp + cm.fn),
    specificity: recallOnly ? null : safeDiv(cm.tn, cm.tn + cm.fp),
    falseNegativeRate: safeDiv(cm.fn, cm.tp + cm.fn),
    falsePositiveRate: recallOnly ? null : safeDiv(cm.fp, cm.tn + cm.fp),
    accuracy: recallOnly ? null : safeDiv(cm.tp + cm.tn, denom),
    falseNegatives: cm.fn,
    falsePositives: recallOnly ? null : cm.fp,
    support: denom,
  };
  if (recallOnly) m.note = 'positive-only partition: recall only, no specificity';
  return m;
}

/* Build a per-run metric block. Returns an honest empty state when a run has no
 * predictions or no labelled pairs. */
function computeRunMetrics(run, pairs, opts = {}) {
  const list = Array.isArray(pairs) ? pairs : [];
  const scope = opts.recallOnly ? { recallOnly: true } : { recallOnly: false };
  const base = {
    runId: run && run.id != null ? run.id : null,
    modelVersion: (run && run.model_version) || null,
    runType: (run && run.run_type) || 'offline',
    offline: !run || run.run_type !== 'live',
    threshold: run && run.threshold != null ? Number(run.threshold) : null,
    evalSplit: (run && run.eval_split) || null,
    partitionScope: opts.partitionScope || null,
    status: (run && run.status) || 'unknown',
    artifactUri: (run && run.artifact_uri) || null,
    createdAt: (run && run.created_at) || null,
  };
  if (!run) return { ...base, empty: true, reason: 'run_not_found', confusion: null, metrics: null };
  if (!list.length) return { ...base, empty: true, reason: 'no_predictions', confusion: null, metrics: null };

  const cm = confusion(list);
  return {
    ...base,
    empty: false,
    confusion: cm,
    metrics: binaryMetrics(cm, scope),
    n: list.length,
    provenance: 'computed_from_tf_predictions joined tf_reference_labels',
  };
}

/* Group pairs by split (train/eval) for per-split metrics. */
function perSplit(pairs) {
  const by = {};
  for (const p of pairs) {
    const s = (p.split || 'unknown').toLowerCase();
    (by[s] = by[s] || []).push(p);
  }
  const out = {};
  for (const [split, list] of Object.entries(by)) {
    const cm = confusion(list);
    out[split] = { confusion: cm, metrics: binaryMetrics(cm), n: list.length };
  }
  return out;
}

module.exports = { POSITIVE, isPositive, confusion, binaryMetrics, computeRunMetrics, perSplit, safeDiv };