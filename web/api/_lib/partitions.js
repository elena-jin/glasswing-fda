/* Test Flight — dataset partition gate.
 *
 * This is the single place that decides who may see which records. It is
 * enforced on the server (in every classifier endpoint), never in the browser.
 *
 * Rules (from the task spec):
 *  - The PUBLIC demo exposes only synthetic records.
 *  - Real / non-synthetic eval text is INTERNAL-only (authenticated reviewers).
 *  - The 214 MAUDE records are positive-only: recall only, no specificity.
 *  - Locked eval data must never be mixed into training.
 */

const SYNTHETIC = ['synthetic', 'synthetic_train', 'synthetic_eval'];

// Partitions that are held out and locked away from training.
const LOCKED_EVAL = ['synthetic_eval', 'real_eval', 'maude', 'maude_eval'];

const INTERNAL_REAL = ['real', 'real_train', 'real_eval', 'real_heldout'];

function normalize(partition) {
  return String(partition || '').trim().toLowerCase();
}

function isSynthetic(partition) {
  return SYNTHETIC.includes(normalize(partition));
}

function isMaude(partition) {
  return ['maude', 'maude_eval'].includes(normalize(partition));
}

function isLockedEval(partition) {
  return LOCKED_EVAL.includes(normalize(partition));
}

/* Who is asking. Internal requires a shared token header. Until real auth (SSO)
 * exists, an unset INTERNAL_TOKEN means nobody is internal — fail closed. */
function audience(req) {
  const token = process.env.TF_INTERNAL_TOKEN;
  if (!token) return 'public';
  const header = req && req.headers ? req.headers['x-tf-internal'] : null;
  return header && header === token ? 'internal' : 'public';
}

/* The set of partitions an audience may read. */
function visiblePartitions(aud) {
  return aud === 'internal'
    ? [...SYNTHETIC, ...INTERNAL_REAL, 'maude', 'maude_eval']
    : [...SYNTHETIC];
}

function canSee(partition, aud) {
  return visiblePartitions(aud).includes(normalize(partition));
}

/* Guard used by read endpoints. Throws a typed error the HTTP layer maps to 403
 * (never a silent empty result that could mask a leak). */
function assertVisible(partition, aud) {
  if (!canSee(partition, aud)) {
    const err = new Error('partition_not_visible');
    err.code = 'partition_forbidden';
    err.status = 403;
    err.partition = normalize(partition);
    throw err;
  }
  return true;
}

/* Training eligibility. Locked eval and non-train splits are refused outright. */
function assertTrainable(record) {
  const partition = normalize(record && record.partition);
  const split = normalize(record && record.split);
  if (isLockedEval(partition) || (split && split !== 'train')) {
    const err = new Error('record_not_trainable');
    err.code = 'training_leak_blocked';
    err.status = 409;
    err.partition = partition;
    err.split = split;
    throw err;
  }
  return true;
}

/* MAUDE is complaint-only; any metric computed over it must not report
 * specificity/precision (there are no negatives to be specific about). */
function metricScope(partition) {
  return isMaude(partition)
    ? { recallOnly: true, reason: 'positive_only_partition' }
    : { recallOnly: false };
}

/* PostgREST `in.(...)` filter string for a partition list. */
function inFilter(values) {
  return `in.(${values.join(',')})`;
}

module.exports = {
  SYNTHETIC,
  LOCKED_EVAL,
  normalize,
  isSynthetic,
  isMaude,
  isLockedEval,
  audience,
  visiblePartitions,
  canSee,
  assertVisible,
  assertTrainable,
  metricScope,
  inFilter,
};