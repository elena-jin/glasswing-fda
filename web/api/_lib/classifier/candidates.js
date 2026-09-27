/* GET  /api/classifier/candidates?status=pending
 * POST /api/classifier/candidates   body: { id, action: "approve"|"revoke", actor, reason }
 *
 * Reviewers approve or revoke a training candidate. Approval is refused for any
 * record on a locked eval partition or a non-train split — the hard block that
 * keeps held-out data out of training. Every action writes an audit event.
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

  // Enforce the training gate before any approval.
  if (action === 'approve') {
    const rec = candidate && candidate.normalized_record_id
      ? await safeSelect('tf_normalized_records', { select: 'id,partition,split', id: `eq.${candidate.normalized_record_id}`, limit: 1 })
      : { data: [] };
    try {
      parts.assertTrainable(rec.data[0] || {});
    } catch (err) {
      return send(res, 409, { ok: false, error: err.code, partition: err.partition, split: err.split, note: 'locked eval data cannot be promoted to training' });
    }
  }

  const status = action === 'approve' ? 'approved' : 'revoked';
  const upd = await safeUpdate('tf_training_candidates', { id: `eq.${id}` }, {
    status,
    approved_by: actor || null,
    updated_at: new Date().toISOString(),
  });
  if (!upd.ok) return send(res, 200, { ok: false, error: upd.error });

  const audit = await safeInsert('tf_audit_events', [{
    actor: actor || 'unknown',
    action: `candidate.${action}`,
    entity: 'tf_training_candidates',
    entity_id: id,
    detail: { status, reason: reason || null },
  }]);

  send(res, 202, { ok: true, candidate: upd.data[0] || { id, status }, auditLogged: audit.ok });
}

module.exports = async (req, res) => {
  if (req.method === 'POST') return handlePost(req, res);
  if (!method(req, res, ['GET', 'POST'])) return;
  if (!sb.configured()) return send(res, 503, { ok: false, error: 'supabase_not_configured' });

  const status = query(req).get('status') || 'pending';
  const rows = await safeSelect('tf_training_candidates', { select: '*', status: `eq.${status}`, order: 'created_at.desc', limit: 100 });
  send(res, 200, {
    ok: true,
    status,
    count: rows.data.length,
    empty: rows.data.length === 0,
    error: rows.ok ? undefined : rows.error,
    data: rows.data,
  });
};