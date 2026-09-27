/* POST /api/classifier/review
 *   body: { record_id | normalized_record_id, reviewer, decision:"agree"|"override",
 *           corrected_label?, reason?, prediction_id?, create_candidate? }
 *
 * Writes a human review/correction to tf_review_decisions + an audit event, and
 * optionally proposes a PENDING training candidate (never auto-approved). No
 * QMS/Jira record is created and no model is promoted.
 *
 * Blocker: no real auth yet — `reviewer` is self-declared (needs SSO + RBAC).
 * Writes remain partition-gated so the public demo only touches synthetic rows.
 */
const { send, method, readJson } = require('../http');
const { safeSelect, safeInsert } = require('../db');
const sb = require('../supabase');
const parts = require('../partitions');

const DECISIONS = ['agree', 'override'];

module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  if (!sb.configured()) return send(res, 503, { ok: false, error: 'supabase_not_configured' });
  const aud = parts.audience(req);

  let body;
  try { body = await readJson(req); }
  catch (err) { return send(res, err.statusCode || 400, { ok: false, error: 'invalid_json' }); }

  const recordId = body.record_id || body.normalized_record_id;
  const { reviewer, decision, corrected_label, reason, prediction_id } = body;
  if (!recordId || !reviewer || DECISIONS.indexOf(decision) === -1) {
    return send(res, 400, { ok: false, error: 'invalid_review', allowedDecisions: DECISIONS });
  }
  if (decision === 'override' && !corrected_label) {
    return send(res, 400, { ok: false, error: 'override_requires_corrected_label' });
  }

  const recs = await safeSelect('tf_normalized_records', { select: 'id,data_partition,split', id: `eq.${recordId}`, limit: 1 });
  const record = recs.data[0];
  if (recs.ok && !record) return send(res, 404, { ok: false, error: 'record_not_found' });
  if (record && !parts.canSee(record.data_partition, aud)) {
    return send(res, 403, { ok: false, error: 'partition_forbidden', partition: record.data_partition });
  }

  const write = await safeInsert('tf_review_decisions', [{
    record_id: recordId,
    prediction_id: prediction_id || null,
    reviewer_id: reviewer,
    final_label: decision === 'override' ? corrected_label : (body.predicted_label || null),
    final_route: body.final_route || null,
    override_reason: reason || null,
    notes: body.notes || null,
    decision_at: new Date().toISOString(),
  }]);
  if (!write.ok) return send(res, 200, { ok: false, error: write.error, note: 'review not persisted' });

  const review = write.data[0] || {};
  const audit = await safeInsert('tf_audit_events', [{
    actor_id: reviewer,
    event_type: 'review.saved',
    object_type: 'tf_normalized_records',
    object_id: recordId,
    detail: { decision, corrected_label: corrected_label || null, reason: reason || null, review_id: review.id || null },
  }]);

  let candidate = null;
  if (body.create_candidate && decision === 'override') {
    try {
      parts.assertTrainable(record || {});
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
    decision: { record_id: recordId, reviewer, decision, corrected_label: corrected_label || null },
    auditLogged: audit.ok,
    candidate,
    persisted: write.ok,
    note: 'Review saved to tf_review_decisions with an audit event. No QMS/Jira record was created.',
  });
};