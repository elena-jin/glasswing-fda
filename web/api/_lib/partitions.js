/* Test Flight — dataset partition gate (LIVE schema).
 *
 * Partition + synthetic live on tf_source_items, not on the normalized record.
 * tf_normalized_records.id is a TEXT FK equal to tf_source_items.id, so a record
 * is visible only when its source item is.
 *
 * Live partition values (2,087 rows):
 *   train        — 1,386 synthetic
 *   validation   —   430 synthetic
 *   locked_eval  —    57 real-source
 *   maude_stress —   214 real-source (positive-only)
 *
 * Rules:
 *  - PUBLIC reads require synthetic = true AND data_partition IN ('train','validation','demo').
 *  - Real-source partitions (locked_eval, maude_stress) are INTERNAL-only and must
 *    never leak through records, detail, metrics or error paths.
 *  - locked_eval and maude_stress are never training candidates.
 *  - MAUDE is positive-only → recall only, no specificity.
 *  - Writes require an authenticated internal reviewer; fail closed without it.
 */

const PUBLIC_PARTITIONS = ['train', 'validation', 'demo'];
const REAL_PARTITIONS = ['locked_eval', 'maude_stress'];
const MAUDE_PARTITIONS = ['maude_stress'];
const LOCKED_FROM_TRAINING = ['locked_eval', 'maude_stress'];
const ALL_PARTITIONS = ['demo', 'train', 'validation', 'locked_eval', 'maude_stress'];
const TRAINABLE = ['train', 'demo'];

function normalize(p) { return String(p == null ? '' : p).trim().toLowerCase(); }
function isSyntheticFlag(v) { return v === true || v === 'true' || v === 't' || v === 1; }
function isMaude(p) { return MAUDE_PARTITIONS.includes(normalize(p)); }
function isLockedFromTraining(p) { return LOCKED_FROM_TRAINING.includes(normalize(p)); }
function isPublicPartition(p) { return PUBLIC_PARTITIONS.includes(normalize(p)); }

/* A source row is visible to an audience. Public must be synthetic AND in the
 * public partition set. Internal sees everything. */
function isVisibleSource(source, aud) {
  if (!source) return false;
  if (aud === 'internal') return true;
  return isSyntheticFlag(source.synthetic) && isPublicPartition(source.data_partition);
}

/* Metrics "split" derived from the partition (the DB has no split column). */
function splitOf(partition) {
  const p = normalize(partition);
  if (p === 'validation' || p === 'locked_eval') return 'eval';
  if (p === 'maude_stress') return 'maude';
  if (p === 'train') return 'train';
  return p || 'unknown';
}

/* Audience. Internal requires TF_INTERNAL_TOKEN AND a matching header. An unset
 * token means nobody is internal — fail closed. */
function audience(req) {
  const token = process.env.TF_INTERNAL_TOKEN;
  if (!token) return 'public';
  const header = req && req.headers ? req.headers['x-tf-internal'] : null;
  return header && header === token ? 'internal' : 'public';
}

/* Write guard for the mutating endpoints. Returns the trusted reviewer id on
 * success; throws a typed error otherwise. `reviewer_id` comes from a header set
 * by the (future) auth proxy — never from the request body. */
function requireInternal(req) {
  const token = process.env.TF_INTERNAL_TOKEN;
  if (!token) {
    const e = new Error('auth_not_configured');
    e.code = 'auth_not_configured'; e.status = 401;
    throw e;
  }
  if (audience(req) !== 'internal') {
    const e = new Error('auth_required');
    e.code = 'auth_required'; e.status = 401;
    throw e;
  }
  const reviewer = (req.headers && (req.headers['x-tf-reviewer'] || req.headers['x-reviewer-id'])) || 'internal.reviewer';
  return { reviewer };
}

function assertVisibleSource(source, aud) {
  if (!isVisibleSource(source, aud)) {
    const e = new Error('partition_forbidden');
    e.code = 'partition_forbidden'; e.status = 403;
    e.partition = source ? normalize(source.data_partition) : null;
    throw e;
  }
  return true;
}

/* Training eligibility (candidate approval). real-source + maude are refused. */
function assertTrainable(source) {
  const p = normalize(source && source.data_partition);
  const synthetic = isSyntheticFlag(source && source.synthetic);
  if (!synthetic || !TRAINABLE.includes(p) || isLockedFromTraining(p)) {
    const e = new Error('training_leak_blocked');
    e.code = 'training_leak_blocked'; e.status = 409;
    e.partition = p || null;
    throw e;
  }
  return true;
}

function metricScope(partition) {
  return isMaude(partition)
    ? { recallOnly: true, reason: 'positive_only_partition' }
    : { recallOnly: false };
}

/* PostgREST `in.(...)` filter. */
function inFilter(values) { return `in.(${values.join(',')})`; }

/* Query params that restrict tf_source_items to the public set. */
function publicSourceParams() {
  return { synthetic: 'is.true', data_partition: inFilter(PUBLIC_PARTITIONS) };
}

function visiblePartitions(aud) {
  return aud === 'internal' ? ALL_PARTITIONS.slice() : PUBLIC_PARTITIONS.slice();
}

module.exports = {
  PUBLIC_PARTITIONS, REAL_PARTITIONS, MAUDE_PARTITIONS, LOCKED_FROM_TRAINING, ALL_PARTITIONS, TRAINABLE,
  normalize, isSyntheticFlag, isMaude, isLockedFromTraining, isPublicPartition,
  isVisibleSource, splitOf, audience, requireInternal, assertVisibleSource, assertTrainable,
  metricScope, inFilter, publicSourceParams, visiblePartitions,
};