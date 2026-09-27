/* POST /api/classifier/review
 *   body: { normalized_record_id, reviewer, decision: "agree"|"override",
 *           corrected_label?, reason?, prediction_id?, create_candidate? }
 *
 * Records a human review / correction and writes an audit event. Optionally
 * proposes a training candidate (pending — never auto-approved).
 *
 * NOTES
 *  - No real auth yet: `reviewer` is self-declared. This is a blocker for
 *    production (needs SSO + RBAC). Writes are still partition-gated so the
 *    public demo can only touch synthetic records.
 *  - Nothing here creates a QMS or Jira record, and nothing promotes a model.
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

  const { normalized_record_id, reviewer, decision, corrected_label, reason, prediction_id } = body;
  if (!normalized_record_id || !reviewer || DECISIONS.indexOf(decision) === -1) {
    return send(res, 400, { ok: false, error: 'invalid_review', allowedDecisions: DECISIONS });
  }
  if (decision === 'override' && !corrected_label) {
    return send(res, 400, { ok: false, error: 'override_requires_corrected_label' });
  }

  const recs = await safeSelect('tf_normalized_records', { select: 'id,partition,split', id: `eq.${normalized_record_id}`, limit: 1 });
  const record = recs.data[0];
  if (recs.ok && !record) return send(res, 404, { ok: false, error: 'record_not_found' });
  if (record && !parts.canSee(record.partition, aud)) {
    return send(res, 403, { ok: false, error: 'partition_forbidden', partition: record.partition });
  }

  const write = await safeInsert('tf_review_decisions', [{
    normalized_record_id,
    prediction_id: prediction_id || null,
    reviewer,
    decision,
    corrected_label: corrected_label || null,
    reason: reason || null,
  }]);
  if (!write.ok) return send(res, 200, { ok: false, error: write.error, note: 'review not persisted' });

  const audit = await safeInsert('tf_audit_events', [{
    actor: reviewer,
    action: 'review.saved',
    entity: 'tf_normalized_records',
    entity_id: normalized_record_id,
    detail: { decision, corrected_label: corrected_label || null, reason: reason || null },
  }]);

  let candidate = null;
  if (body.create_candidate && decision === 'override') {
    // Locked eval / non-train splits are refused here too (defence in depth).
    try {
      parts.assertTrainable(record || {});
      const c = await safeInsert('tf_training_candidates', [{
        normalized_record_id,
        proposed_label: corrected_label,
        status: 'pending',
        created_by: reviewer,
      }]);
      candidate = c.ok ? c.data[0] : { error: c.error };
    } catch (err) {
      candidate = { error: err.code };
    }
  }

  send(res, 202, {
    ok: write.ok,
    decision: { normalized_record_id, reviewer, decision, corrected_label: corrected_label || null },
    auditLogged: audit.ok,
    candidate,
    persisted: write.ok,
    note: 'Review saved to tf_review_decisions with an audit event. No QMS/Jira record was created.',
  });
};