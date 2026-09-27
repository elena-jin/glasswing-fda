/* POST /api/classifier/retrain
 *   body: { model_version_id?, eval_split, train_partitions?, dataset_version?, created_by, reason }
 *
 * Enqueues a CONTROLLED retraining request as an immutable tf_model_runs row
 * (status "requested"). No training runs here and never in the browser; a
 * server-side worker consumes the request. Records the held-out evaluation gate
 * and the partitions excluded from training. Never auto-promotes a model.
 *
 * Blocker: the worker is out of scope for this PR.
 */
const { send, method, readJson } = require('../http');
const { safeInsert } = require('../db');
const sb = require('../supabase');
const parts = require('../partitions');

function resolveTrainPartitions(requested) {
  const allowed = ['synthetic', 'synthetic_train', 'real', 'real_train'];
  const want = Array.isArray(requested) && requested.length ? requested : allowed;
  const blocked = want.filter((p) => parts.isLockedEval(p));
  const train = want.filter((p) => !parts.isLockedEval(p) && allowed.includes(p));
  return { train, blocked };
}

module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  if (!sb.configured()) return send(res, 503, { ok: false, error: 'supabase_not_configured' });

  let body;
  try { body = await readJson(req); }
  catch (err) { return send(res, err.statusCode || 400, { ok: false, error: 'invalid_json' }); }

  const { model_version_id, eval_split, train_partitions, dataset_version, created_by, reason } = body;
  if (!eval_split) return send(res, 400, { ok: false, error: 'eval_split_required', note: 'a held-out evaluation split is mandatory' });

  const gate = resolveTrainPartitions(train_partitions);
  if (!gate.train.length) return send(res, 400, { ok: false, error: 'no_trainable_partitions', blocked: gate.blocked });

  const row = {
    model_version_id: model_version_id || null,
    dataset_version: dataset_version || null,
    data_partition: gate.train.join(','),
    run_type: 'offline',
    status: 'requested',
    parameters: {
      requested_by: created_by || 'unknown',
      reason: reason || null,
      eval_split,
      gate: {
        train_partitions: gate.train,
        blocked_partitions: gate.blocked,
        exclude_locked_eval: true,
        require_held_out_eval: true,
        human_promotion_required: true,
      },
    },
    metrics: {},
  };

  const ins = await safeInsert('tf_model_runs', [row]);
  if (!ins.ok) return send(res, 200, { ok: false, error: ins.error, note: 'request not persisted (check tf_model_runs.status constraint)' });

  const run = ins.data[0];
  await safeInsert('tf_audit_events', [{
    actor_id: created_by || 'unknown',
    event_type: 'retrain.requested',
    object_type: 'tf_model_runs',
    object_id: run && run.id,
    detail: { eval_split, train_partitions: gate.train, blocked: gate.blocked, reason: reason || null },
  }]);

  send(res, 202, {
    ok: true,
    run,
    gate,
    note: 'Retraining request queued server-side as a tf_model_runs row (status "requested"). A worker must consume it; promotion stays manual.',
  });
};