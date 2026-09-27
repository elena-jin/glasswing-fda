/* GET  /api/classifier/candidates?status=pending
 * POST /api/classifier/candidates   body: { id, action:"approve"|"revoke", actor, reason }
 *
 * Approve/revoke a training candidate. Approval is refused for any record on a
 * locked eval partition or a non-train split — the hard block that keeps
 * held-out data out of training. Candidate → review → record resolves the
 * partition (tf_training_candidates.review_id → tf_review_decisions.record_id).
 */
const { send, method, readJson, query } = require('../http');
const { safeSelect, safeInsert, safeUpdate } = require('../db');
const sb = require('../supabase');
const parts = require('../partitions');

const ACTIONS = ['approve', 'revoke'];

async function handlePost(req, res) {
  let body;
  try { body = await readJson(req); }
  catch (err) { return send(res, err.statusCode || 400, { ok: false, error: 'invalid_json' }); }

  const { id, action, actor, reason } = body;
  if (!id || ACTIONS.indexOf(action) === -1) {
    return send(res, 400, { ok: false, error: 'invalid_candidate_action', allowedAction: ACTIONS });
  }

  const cand = await safeSelect('tf_training_candidates', { select: '*', id: `eq.${id}`, limit: 1 });
  const candidate = cand.data[0];
  if (cand.ok && !candidate) return send(res, 404, { ok: false, error: 'candidate_not_found', id });

  if (action === 'approve') {
    let record = null;
    if (candidate && candidate.review_id) {
      const rev = await safeSelect('tf_review_decisions', { select: 'record_id', id: `eq.${candidate.review_id}`, limit: 1 });
      const recordId = rev.data[0] && rev.data[0].record_id;
      if (recordId) {
        const rec = await safeSelect('tf_normalized_records', { select: 'id,data_partition,split', id: `eq.${recordId}`, limit: 1 });
        record = rec.data[0] || null;
      }
    }
    try {
      parts.assertTrainable(record || {});
    } catch (err) {
      return send(res, 409, { ok: false, error: err.code, partition: err.partition, split: err.split, note: 'locked eval data cannot be promoted to training' });
    }
  }

  const status = action === 'approve' ? 'approved' : 'revoked';
  const patch = { candidate_status: status };
  if (action === 'revoke') patch.revoked_at = new Date().toISOString();
  const upd = await safeUpdate('tf_training_candidates', { id: `eq.${id}` }, patch);
  if (!upd.ok) return send(res, 200, { ok: false, error: upd.error });

  const audit = await safeInsert('tf_audit_events', [{
    actor_id: actor || 'unknown',
    event_type: `candidate.${action}`,
    object_type: 'tf_training_candidates',
    object_id: id,
    detail: { status, reason: reason || null },
  }]);

  send(res, 202, { ok: true, candidate: upd.data[0] || { id, candidate_status: status }, auditLogged: audit.ok });
}

module.exports = async (req, res) => {
  if (req.method === 'POST') return handlePost(req, res);
  if (!method(req, res, ['GET', 'POST'])) return;
  if (!sb.configured()) return send(res, 503, { ok: false, error: 'supabase_not_configured' });

  const status = query(req).get('status') || 'pending';
  const rows = await safeSelect('tf_training_candidates', { select: '*', candidate_status: `eq.${status}`, order: 'created_at.desc', limit: 100 });
  send(res, 200, {
    ok: true,
    status,
    count: rows.data.length,
    empty: rows.data.length === 0,
    error: rows.ok ? undefined : rows.error,
    data: rows.data,
  });
};