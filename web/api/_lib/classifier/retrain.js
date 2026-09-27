/* POST /api/classifier/retrain
 *   body: { model_version_id?, dataset_version, created_by?, reason? }
 *
 * AUTH: internal reviewers only (fail closed without TF_INTERNAL_TOKEN).
 *
 * Enqueues a CONTROLLED retraining request as an immutable tf_model_runs row
 * (status "pending"). Trains nothing here and never in the browser. The row
 * records the held-out evaluation gate; locked_eval and maude_stress are never
 * trainable. Model promotion stays manual — there is no auto-promote.
 *
 * Blockers: a server-side worker and a model API are required to actually run
 * this. Until they exist, requests stay pending.
 */
const { send, method, readJson } = require('../http');
const { safeInsert } = require('../db');
const sb = require('../supabase');
const parts = require('../partitions');

module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  if (!sb.configured()) return send(res, 503, { ok: false, error: 'supabase_not_configured' });

  let auth;
  try { auth = parts.requireInternal(req); }
  catch (err) { return send(res, err.status || 401, { ok: false, error: err.code || 'auth_required' }); }

  let body;
  try { body = await readJson(req); }
  catch (err) { return send(res, err.statusCode || 400, { ok: false, error: 'invalid_json' }); }

  // The DB enforces data_partition IN (train,validation,locked_eval,maude_stress,demo).
  // Training only ever draws from 'train'.
  const row = {
    model_version_id: body.model_version_id || null,
    dataset_version: body.dataset_version || 'unspecified',
    data_partition: 'train',
    status: 'pending',
    parameters: {
      requested_by: auth.reviewer,
      reason: body.reason || null,
      eval_split: 'validation',
      gate: {
        train_partitions: ['train'],
        blocked_partitions: parts.LOCKED_FROM_TRAINING,
        exclude_locked_eval: true,
        require_held_out_eval: 'validation',
        human_promotion_required: true,
      },
    },
    metrics: {},
  };

  const ins = await safeInsert('tf_model_runs', [row]);
  if (!ins.ok) return send(res, 200, { ok: false, error: ins.error, note: 'request not persisted' });

  const run = ins.data[0];
  await safeInsert('tf_audit_events', [{
    actor_id: auth.reviewer,
    event_type: 'retrain.requested',
    object_type: 'tf_model_runs',
    object_id: run && run.id,
    detail: { data_partition: 'train', blocked: parts.LOCKED_FROM_TRAINING, reason: body.reason || null },
  }]);

  send(res, 202, {
    ok: true,
    run,
    gate: partGate(),
    note: 'Retraining request queued as a tf_model_runs row (status "pending"). A worker must consume it; promotion stays manual.',
  });
};

function partGate() {
  return { train: ['train'], blocked: parts.LOCKED_FROM_TRAINING, eval: 'validation' };
}