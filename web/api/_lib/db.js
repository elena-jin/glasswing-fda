/* Test Flight — small query helpers over the server-only Supabase client.
 *
 * Every helper is tolerant: a missing table, an empty table or a schema drift
 * returns an honest { ok:false, error } instead of throwing, so endpoints can
 * render empty/error states rather than fake numbers.
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

/* Latest prediction per normalized_record_id. */
function latestPredictionByRecord(predictions) {
  const m = new Map();
  for (const p of predictions || []) {
    const cur = m.get(p.normalized_record_id);
    if (!cur) { m.set(p.normalized_record_id, p); continue; }
    const a = new Date(p.created_at || 0).getTime();
    const b = new Date(cur.created_at || 0).getTime();
    if (a >= b) m.set(p.normalized_record_id, p);
  }
  return m;
}

function referenceByRecord(labels) {
  const m = new Map();
  for (const l of labels || []) m.set(l.normalized_record_id, l);
  return m;
}

/* Join normalized records with their reference label and latest prediction. */
function assemble(records, labels, predictions) {
  const ref = referenceByRecord(labels);
  const pred = latestPredictionByRecord(predictions);
  return (records || []).map((r) => ({
    id: r.id,
    case_id: r.case_id,
    partition: r.partition,
    split: r.split,
    synthetic: r.synthetic,
    product: r.product,
    app_version: r.app_version,
    text: r.text_screened,
    reference: ref.get(r.id) || null,
    prediction: pred.get(r.id) || null,
  }));
}

module.exports = { safeSelect, safeInsert, safeUpdate, indexById, latestPredictionByRecord, referenceByRecord, assemble };