/* POST /api/classifier/review
 *   body: { record_id, decision:"agree"|"override", corrected_label?, prediction_id?,
 *           reason?, notes?, create_candidate?, dataset_version? }
 *
 * AUTH: internal reviewers only. The reviewer id comes from a trusted header
 * (x-tf-reviewer) set by the auth layer — never from the request body. Without
 * TF_INTERNAL_TOKEN the endpoint fails closed (401). No public POST.
 *
 * Writes tf_review_decisions (+ audit event) and optionally a PENDING training
 * candidate. It never creates a QMS/Jira record, never promotes a model, and
 * never treats a label as a legal complaint/MDR determination.
 */
const { send, method, readJson } = require('../http');
const { safeSelect, safeInsert } = require('../db');
const sb = require('../supabase');
const parts = require('../partitions');

const LABELS = ['complaint', 'product_feedback', 'excluded'];
const ROUTE_FOR = { complaint: 'quality_review', product_feedback: 'product_review', excluded: 'excluded' };

async function handlePost(req, res) {
  if (!sb.configured()) return send(res, 503, { ok: false, error: 'supabase_not_configured' });

  let auth;
  try { auth = parts.requireInternal(req); }
  catch (err) { return send(res, err.status || 401, { ok: false, error: err.code || 'auth_required' }); }

  let body;
  try { body = await readJson(req); }
  catch (err) { return send(res, err.statusCode || 400, { ok: false, error: 'invalid_json' }); }

  const recordId = body.record_id;
  const decision = body.decision;
  if (!recordId || ['agree', 'override'].indexOf(decision) === -1) {
    return send(res, 400, { ok: false, error: 'invalid_review', allowedDecisions: ['agree', 'override'] });
  }

  // Resolve the final label + route.
  let finalLabel = null;
  if (decision === 'override') {
    finalLabel = body.corrected_label;
    if (!finalLabel) return send(res, 400, { ok: false, error: 'override_requires_corrected_label' });
  } else if (body.prediction_id) {
    const pred = await safeSelect('tf_predictions', { select: 'predicted_label', id: `eq.${body.prediction_id}`, limit: 1 });
    finalLabel = pred.data[0] ? pred.data[0].predicted_label : (body.final_label || null);
  } else {
    finalLabel = body.final_label || null;
  }
  if (LABELS.indexOf(finalLabel) === -1) {
    return send(res, 400, { ok: false, error: 'invalid_final_label', allowed: LABELS });
  }
  const finalRoute = ROUTE_FOR[finalLabel];

  // Record must exist (and its source dictates whether a candidate is trainable).
  const src = await safeSelect('tf_source_items', { select: 'id,data_partition,synthetic', id: `eq.${recordId}`, limit: 1 });
  const source = src.data[0];
  if (src.ok && !source) return send(res, 404, { ok: false, error: 'record_not_found' });

  const write = await safeInsert('tf_review_decisions', [{
    record_id: recordId,
    prediction_id: body.prediction_id || null,
    reviewer_id: auth.reviewer,
    final_label: finalLabel,
    final_route: finalRoute,
    override_reason: body.reason || null,
    notes: body.notes || null,
    decision_at: new Date().toISOString(),
    approved_for_training: !!body.approved_for_training,
  }]);
  if (!write.ok) return send(res, 200, { ok: false, error: write.error, note: 'review not persisted' });
  const review = write.data[0] || {};

  const audit = await safeInsert('tf_audit_events', [{
    actor_id: auth.reviewer,
    event_type: 'review.saved',
    object_type: 'tf_review_decisions',
    object_id: review.id || recordId,
    detail: { record_id: recordId, decision, final_label: finalLabel, final_route: finalRoute, reason: body.reason || null },
  }]);

  let candidate = null;
  if (body.create_candidate && decision === 'override') {
    try {
      parts.assertTrainable(source || {});
      const c = await safeInsert('tf_training_candidates', [{
        review_id: review.id,
        candidate_status: 'pending',
        dataset_version: body.dataset_version || null,
      }]);
      candidate = c.ok ? c.data[0] : { error: c.error };
    } catch (err) {
      candidate = { error: err.code };
    }
  }

  send(res, 202, {
    ok: true,
    decision: { record_id: recordId, reviewer: auth.reviewer, decision, final_label: finalLabel, final_route: finalRoute },
    auditLogged: audit.ok,
    candidate,
    persisted: write.ok,
    note: 'Review saved to tf_review_decisions with an audit event. No QMS/Jira record was created.',
  });
}

module.exports = async (req, res) => {
  if (req.method === 'POST') return handlePost(req, res);
  if (!method(req, res, ['POST'])) return;
};