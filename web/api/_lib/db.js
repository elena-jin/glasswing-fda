/* Test Flight — small query helpers over the server-only Supabase client.
 *
 * Coded against the LIVE schema (see supabase/live-schema.json):
 *   tf_normalized_records(id, schema_version, screened_text, evidence_text,
 *     context, provenance, eligibility, data_partition*, split*)
 *   tf_reference_labels(record_id, label, route, theme_id, potential_mdr, split*)
 *   tf_predictions(id, record_id, model_version_id, run_id, predicted_label,
 *     confidence, threshold, route, complaint_score)
 *   tf_review_decisions(id, record_id, prediction_id, reviewer_id, final_label,
 *     final_route, override_reason, decision_at, approved_for_training)
 *   tf_training_candidates(id, review_id, candidate_status)
 *   tf_audit_events(id, actor_id, event_type, object_type, object_id, detail)
 * (*) added by migration 0001.
 *
 * Every helper is tolerant: a missing table/column or empty table returns an
 * honest { ok:false, error } so endpoints render empty/error states.
 */
const sb = require('./supabase');

async function safeSelect(table, query, opts) {
  if (!sb.configured()) return { ok: false, error: 'supabase_not_configured', data: [] };
  try {
    const data = await sb.select(table, query, opts);
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'query_failed', status: err && err.status, data: [] };
  }
}

async function safeInsert(table, rows, opts) {
  if (!sb.configured()) return { ok: false, error: 'supabase_not_configured', data: [] };
  try {
    const data = await sb.insert(table, rows, opts);
    return { ok: true, data: Array.isArray(data) ? data : [data] };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'insert_failed', status: err && err.status, data: [] };
  }
}

async function safeUpdate(table, query, patch, opts) {
  if (!sb.configured()) return { ok: false, error: 'supabase_not_configured', data: [] };
  try {
    const data = await sb.update(table, query, patch, opts);
    return { ok: true, data: Array.isArray(data) ? data : [data] };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'update_failed', status: err && err.status, data: [] };
  }
}

/* Latest prediction per record_id (predictions reference records by record_id). */
function latestPredictionByRecord(predictions) {
  const m = new Map();
  for (const p of predictions || []) {
    const key = p.record_id;
    const cur = m.get(key);
    if (!cur) { m.set(key, p); continue; }
    const a = new Date(p.created_at || 0).getTime();
    const b = new Date(cur.created_at || 0).getTime();
    if (a >= b) m.set(key, p);
  }
  return m;
}

function referenceByRecord(labels) {
  const m = new Map();
  for (const l of labels || []) m.set(l.record_id, l);
  return m;
}

function recordText(r) {
  return r.screened_text || r.evidence_text || null;
}

function contextValue(r, keys) {
  const ctx = r.context || {};
  for (const k of keys) if (ctx[k] != null) return ctx[k];
  return null;
}

/* Shape a normalized record for the panel. */
function shapeRecord(r) {
  const partition = r.data_partition || null;
  return {
    id: r.id,
    partition,
    split: r.split || null,
    synthetic: /^synthetic/.test(String(partition || '')),
    schema_version: r.schema_version || null,
    text: recordText(r),
    product: contextValue(r, ['product_hint', 'product']),
    app_version: contextValue(r, ['version', 'app_version']),
    eligibility: r.eligibility,
    exclusion_reason: r.exclusion_reason || null,
    created_at: r.created_at || null,
  };
}

/* Join records with reference label + latest prediction. */
function assemble(records, labels, predictions) {
  const ref = referenceByRecord(labels);
  const pred = latestPredictionByRecord(predictions);
  return (records || []).map((r) => ({
    ...shapeRecord(r),
    reference: ref.get(r.id) || null,
    prediction: pred.get(r.id) || null,
  }));
}

module.exports = {
  safeSelect, safeInsert, safeUpdate,
  latestPredictionByRecord, referenceByRecord, assemble, shapeRecord, recordText,
};