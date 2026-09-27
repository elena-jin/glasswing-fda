/* POST /api/classifier/retrain
 *   body: { model_version, eval_split, train_partitions?, created_by, reason }
 *
 * Enqueues a CONTROLLED retraining request. This endpoint does not train
 * anything and never runs in the browser: it writes an immutable request row to
 * tf_model_runs (status "requested") that an async server-side worker picks up.
 * The request records the held-out evaluation gate and the partitions excluded
 * from training, and it never auto-promotes a model.
 *
 * Blocker: the worker itself is out of scope for this PR (see
 * docs/classifier-panel.md). Until it exists, requests stay in "requested".
 */
const { send, method, readJson } = require('../_lib/http');
const { safeInsert } = require('../_lib/db');
const sb = require('../_lib/supabase');
const parts = require('../_lib/partitions');

/* Default training partitions: synthetic train only. Locked eval is never
 * eligible, even if a caller asks for it. */
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

  const { model_version, eval_split, train_partitions, created_by, reason } = body;
  if (!eval_split) return send(res, 400, { ok: false, error: 'eval_split_required', note: 'a held-out evaluation split is mandatory' });

  const gate = resolveTrainPartitions(train_partitions);
  if (!gate.train.length) return send(res, 400, { ok: false, error: 'no_trainable_partitions', blocked: gate.blocked });

  const row = {
    model_version: model_version || null,
    run_type: 'offline',
    eval_split,
    status: 'requested',
    created_by: created_by || 'unknown',
    metrics: {
      gate: {
        eval_split,
        train_partitions: gate.train,
        blocked_partitions: gate.blocked,
        exclude_locked_eval: true,
        require_held_out_eval: true,
        human_promotion_required: true,
      },
      requested_by: created_by || 'unknown',
      reason: reason || null,
    },
  };

  const ins = await safeInsert('tf_model_runs', [row]);
  if (!ins.ok) return send(res, 200, { ok: false, error: ins.error, note: 'request not persisted' });

  const run = ins.data[0];
  await safeInsert('tf_audit_events', [{
    actor: created_by || 'unknown',
    action: 'retrain.requested',
    entity: 'tf_model_runs',
    entity_id: run && run.id,
    detail: { eval_split, train_partitions: gate.train, blocked: gate.blocked, reason: reason || null },
  }]);

  send(res, 202, {
    ok: true,
    run,
    gate,
    note: 'Retraining request queued server-side as an immutable tf_model_runs row. No training runs in the browser; a worker will pick this up. Model promotion stays manual.',
  });
};