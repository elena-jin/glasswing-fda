/* Test Flight — small query helpers over the server-only Supabase client.
 *
 * LIVE schema (see supabase/glasswing_live_schema_reference.sql):
 *   tf_source_items(id text PK, source_type, native_id, source_url, occurred_at,
 *     received_at, payload, synthetic bool, data_partition, provenance)
 *   tf_normalized_records(id text PK -> tf_source_items.id, schema_version,
 *     evidence_text, screened_text, source jsonb, evidence jsonb, context jsonb,
 *     intake jsonb, provenance jsonb, eligibility bool, exclusion_reason, created_at)
 *   tf_reference_labels(record_id text PK -> normalized.id, label, route, theme_id,
 *     potential_mdr, priority_subflags, reason, label_source, adjudicated, added_at)
 *   tf_predictions(id, record_id text -> normalized.id, model_version_id, run_id,
 *     complaint_score, threshold, predicted_label, route, confidence, rationale, created_at)
 *   tf_review_decisions(id, record_id text, prediction_id, reviewer_id, final_label,
 *     final_route, override_reason, notes, decision_at, approved_for_training, revoked_at)
 *   tf_training_candidates(id, review_id uuid UNIQUE -> review_decisions.id,
 *     candidate_status, weight, dataset_version, used_in_run, created_at)
 *   tf_model_runs(id uuid, model_version_id, dataset_version, data_partition,
 *     code_ref, parameters, started_at, finished_at, status, metrics, cohort_metrics, artifact_uri)
 *   tf_audit_events(id, actor_id, event_type, object_type, object_id, detail, created_at)
 *
 * There is NO partition/split/case_id on tf_normalized_records — partition and
 * synthetic come from the joined source item. All helpers tolerate missing
 * tables/empty results with an honest { ok:false, error }.
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

function indexById(rows) {
  const m = new Map();
  for (const r of rows || []) m.set(r.id, r);
  return m;
}

function latestPredictionByRecord(predictions) {
  const m = new Map();
  for (const p of predictions || []) {
    const key = p.record_id;
    const cur = m.get(key);
    if (!cur) { m.set(key, p); continue; }
    if (new Date(p.created_at || 0).getTime() >= new Date(cur.created_at || 0).getTime()) m.set(key, p);
  }
  return m;
}

function referenceByRecord(labels) {
  const m = new Map();
  for (const l of labels || []) m.set(l.record_id, l);
  return m;
}

function contextValue(r, keys) {
  const ctx = (r && r.context) || {};
  for (const k of keys) if (ctx[k] != null) return ctx[k];
  return null;
}

/* Shape a normalized record using its source item for partition/synthetic. */
function shapeRecord(r, source) {
  const partition = source ? source.data_partition : null;
  return {
    id: r.id,
    partition,
    synthetic: source ? (source.synthetic === true) : null,
    schema_version: r.schema_version || null,
    text: r.screened_text || r.evidence_text || null,
    product: contextValue(r, ['product_hint', 'product']),
    app_version: contextValue(r, ['version', 'app_version']),
    eligibility: r.eligibility,
    exclusion_reason: r.exclusion_reason || null,
    created_at: r.created_at || null,
    source_type: source ? source.source_type : null,
    source_url: source ? source.source_url : null,
  };
}

/* Join records with their source item, reference label and latest prediction. */
function assemble(records, sources, labels, predictions) {
  const src = indexById(sources);
  const ref = referenceByRecord(labels);
  const pred = latestPredictionByRecord(predictions);
  return (records || []).map((r) => ({
    ...shapeRecord(r, src.get(r.id) || null),
    reference: ref.get(r.id) || null,
    prediction: pred.get(r.id) || null,
  }));
}

module.exports = {
  safeSelect, safeInsert, safeUpdate,
  indexById, latestPredictionByRecord, referenceByRecord, assemble, shapeRecord,
};