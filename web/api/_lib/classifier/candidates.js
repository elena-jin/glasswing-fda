/* GET/POST /api/classifier/candidates
 *
 * AUTH: internal reviewers only (fail closed without TF_INTERNAL_TOKEN). This is
 * an internal review surface, so even the list is gated — candidates can trace
 * to real-source records.
 *
 * POST body: { id, action:"approve"|"revoke" }
 *   approve → candidate_status 'approved', refused (409) for locked_eval /
 *             maude_stress / non-synthetic sources.
 *   revoke  → candidate_status 'rejected'.
 * Candidate → review → record → source resolves the partition
 * (tf_training_candidates.review_id → tf_review_decisions.record_id →
 *  tf_source_items.id).
 */
const { send, method, readJson, query } = require('../http');
const { safeSelect, safeInsert, safeUpdate } = require('../db');
const sb = require('../supabase');
const parts = require('../partitions');

const ACTIONS = ['approve', 'revoke'];

async function resolveSource(candidate) {
  if (!candidate || !candidate.review_id) return null;
  const rev = await safeSelect('tf_review_decisions', { select: 'record_id', id: `eq.${candidate.review_id}`, limit: 1 });
  const recordId = rev.data[0] && rev.data[0].record_id;
  if (!recordId) return null;
  const src = await safeSelect('tf_source_items', { select: 'id,data_partition,synthetic', id: `eq.${recordId}`, limit: 1 });
  return src.data[0] || null;
}

async function handlePost(req, res) {
  let auth;
  try { auth = parts.requireInternal(req); }
  catch (err) { return send(res, err.status || 401, { ok: false, error: err.code || 'auth_required' }); }

  let body;
  try { body = await readJson(req); }
  catch (err) { return send(res, err.statusCode || 400, { ok: false, error: 'invalid_json' }); }

  const { id, action, reason } = body;
  if (!id || ACTIONS.indexOf(action) === -1) {
    return send(res, 400, { ok: false, error: 'invalid_candidate_action', allowedAction: ACTIONS });
  }

  const cand = await safeSelect('tf_training_candidates', { select: '*', id: `eq.${id}`, limit: 1 });
  const candidate = cand.data[0];
  if (cand.ok && !candidate) return send(res, 404, { ok: false, error: 'candidate_not_found', id });

  if (action === 'approve') {
    const source = await resolveSource(candidate);
    try { parts.assertTrainable(source || {}); }
    catch (err) {
      return send(res, 409, { ok: false, error: err.code, partition: err.partition, note: 'locked_eval / maude_stress / non-synthetic data cannot be promoted to training' });
    }
  }

  const patch = { candidate_status: action === 'approve' ? 'approved' : 'rejected' };
  const upd = await safeUpdate('tf_training_candidates', { id: `eq.${id}` }, patch);
  if (!upd.ok) return send(res, 200, { ok: false, error: upd.error });

  const audit = await safeInsert('tf_audit_events', [{
    actor_id: auth.reviewer,
    event_type: `candidate.${action}`,
    object_type: 'tf_training_candidates',
    object_id: id,
    detail: { status: patch.candidate_status, reason: reason || null },
  }]);

  send(res, 202, { ok: true, candidate: upd.data[0] || { id, candidate_status: patch.candidate_status }, auditLogged: audit.ok });
}

module.exports = async (req, res) => {
  if (!method(req, res, ['GET', 'POST'])) return;
  if (!sb.configured()) return send(res, 503, { ok: false, error: 'supabase_not_configured' });

  try { parts.requireInternal(req); }
  catch (err) { return send(res, err.status || 401, { ok: false, error: err.code || 'auth_required' }); }

  if (req.method === 'POST') return handlePost(req, res);

  const status = query(req).get('status') || 'pending';
  const rows = await safeSelect('tf_training_candidates', { select: '*', candidate_status: `eq.${status}`, order: 'created_at.desc', limit: 100 });
  send(res, 200, { ok: true, status, count: rows.data.length, empty: rows.data.length === 0, error: rows.ok ? undefined : rows.error, data: rows.data });
};