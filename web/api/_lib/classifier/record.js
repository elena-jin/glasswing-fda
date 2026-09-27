/* GET /api/classifier/record?id=<record_id>
 *
 * Full detail for one normalized record against the LIVE schema: provenance,
 * partition, evidence text, reference label, predictions (model version/run,
 * confidence, threshold, route), human review history, and training-candidate
 * status (resolved through the review that produced it). Partition-gated.
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

  const recs = await safeSelect('tf_normalized_records', { select: '*', id: `eq.${id}`, limit: 1 });
  if (!recs.ok) return send(res, 200, { ok: true, data: null, empty: true, error: recs.error });
  const record = recs.data[0];
  if (!record) return send(res, 404, { ok: false, error: 'record_not_found', id });
  if (!parts.canSee(record.data_partition, aud)) {
    return send(res, 403, { ok: false, error: 'partition_forbidden', partition: record.data_partition });
  }

  const [labels, preds, reviews] = await Promise.all([
    safeSelect('tf_reference_labels', { select: '*', record_id: `eq.${id}` }),
    safeSelect('tf_predictions', { select: '*', record_id: `eq.${id}`, order: 'created_at.desc' }),
    safeSelect('tf_review_decisions', { select: '*', record_id: `eq.${id}`, order: 'decision_at.desc' }),
  ]);

  // Training candidates hang off reviews (tf_training_candidates.review_id).
  let candidates = { data: [] };
  const reviewIds = reviews.data.map((r) => r.id).filter(Boolean);
  if (reviewIds.length) {
    candidates = await safeSelect('tf_training_candidates', { select: '*', review_id: inFilter(reviewIds) });
    const reviewById = new Map(reviews.data.map((r) => [r.id, r]));
    candidates.data = candidates.data.map((c) => ({ ...c, record_id: (reviewById.get(c.review_id) || {}).record_id || null }));
  }

  const shaped = shapeRecord(record);
  send(res, 200, {
    ok: true,
    audience: aud,
    data: {
      record: shaped,
      source: record.source || null,
      provenance: record.provenance || null,
      reference: labels.data[0] || null,
      predictions: preds.data,
      reviews: reviews.data,
      candidates: candidates.data,
      route: preds.data[0] ? preds.data[0].route : null,
      humanStatus: reviews.data[0]
        ? (reviews.data[0].final_label || reviews.data[0].decision)
        : 'unreviewed',
    },
  });
};