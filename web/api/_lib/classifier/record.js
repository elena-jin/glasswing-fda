/* GET /api/classifier/record?id=<record_id>
 *
 * Full detail for one normalized record: provenance (from the source item),
 * partition, evidence text, reference label, predictions (model version/run,
 * confidence, threshold, route), review history and candidate status.
 *
 * SECURITY: the source item's partition/synthetic gate is applied BEFORE any
 * text is shaped. A real-source record (locked_eval / maude_stress) returns 403
 * with no evidence text — the row is never serialized back to the client.
 */
const { send, method, query } = require('../http');
const { safeSelect, shapeRecord } = require('../db');
const sb = require('../supabase');
const parts = require('../partitions');
const inFilter = (v) => parts.inFilter(v);

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const aud = parts.audience(req);
  const id = query(req).get('id');
  if (!id) return send(res, 400, { ok: false, error: 'missing_id' });
  if (!sb.configured()) return send(res, 503, { ok: false, error: 'supabase_not_configured' });

  // Source item carries the gate. Fetch it first; refuse before touching text.
  const src = await safeSelect('tf_source_items', { select: '*', id: `eq.${id}`, limit: 1 });
  const source = src.data[0];
  if (src.ok && !source) return send(res, 404, { ok: false, error: 'record_not_found', id });
  if (source && !parts.isVisibleSource(source, aud)) {
    return send(res, 403, { ok: false, error: 'partition_forbidden', partition: source.data_partition });
  }

  const recs = await safeSelect('tf_normalized_records', { select: '*', id: `eq.${id}`, limit: 1 });
  const record = recs.data[0];
  if (!record) return send(res, 404, { ok: false, error: 'record_not_found', id });

  const [labels, preds, reviews] = await Promise.all([
    safeSelect('tf_reference_labels', { select: '*', record_id: `eq.${id}` }),
    safeSelect('tf_predictions', { select: '*', record_id: `eq.${id}`, order: 'created_at.desc' }),
    safeSelect('tf_review_decisions', { select: '*', record_id: `eq.${id}`, order: 'decision_at.desc' }),
  ]);

  let candidates = { data: [] };
  const reviewIds = reviews.data.map((r) => r.id).filter(Boolean);
  if (reviewIds.length) {
    candidates = await safeSelect('tf_training_candidates', { select: '*', review_id: inFilter(reviewIds) });
    const reviewById = new Map(reviews.data.map((r) => [r.id, r]));
    candidates.data = candidates.data.map((c) => ({ ...c, record_id: (reviewById.get(c.review_id) || {}).record_id || null }));
  }

  send(res, 200, {
    ok: true,
    audience: aud,
    data: {
      record: shapeRecord(record, source),
      source: source ? {
        id: source.id, source_type: source.source_type, native_id: source.native_id,
        source_url: source.source_url, occurred_at: source.occurred_at,
        data_partition: source.data_partition, synthetic: source.synthetic,
      } : null,
      provenance: source ? source.provenance : null,
      reference: labels.data[0] || null,
      predictions: preds.data,
      reviews: reviews.data,
      candidates: candidates.data,
      route: preds.data[0] ? preds.data[0].route : null,
      humanStatus: reviews.data[0]
        ? (reviews.data[0].final_label || reviews.data[0].final_route)
        : 'unreviewed',
    },
  });
};