/* GET /api/classifier/record?id=<normalized_record_id>
 *
 * Full detail for one normalized record: provenance, partition, evidence text,
 * reference label, all predictions (with model version/run, confidence,
 * threshold, route) and the human review history + training-candidate status.
 * Still subject to the server-side partition gate.
 */
const { send, method, query } = require('../_lib/http');
const { safeSelect } = require('../_lib/db');
const sb = require('../_lib/supabase');
const parts = require('../_lib/partitions');

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
  if (!parts.canSee(record.partition, aud)) {
    return send(res, 403, { ok: false, error: 'partition_forbidden', partition: record.partition });
  }

  const [source, labels, preds, reviews, candidates] = await Promise.all([
    record.source_item_id
      ? safeSelect('tf_source_items', { select: '*', id: `eq.${record.source_item_id}`, limit: 1 })
      : Promise.resolve({ ok: true, data: [] }),
    safeSelect('tf_reference_labels', { select: '*', normalized_record_id: `eq.${id}` }),
    safeSelect('tf_predictions', { select: '*', normalized_record_id: `eq.${id}`, order: 'created_at.desc' }),
    safeSelect('tf_review_decisions', { select: '*', normalized_record_id: `eq.${id}`, order: 'created_at.desc' }),
    safeSelect('tf_training_candidates', { select: '*', normalized_record_id: `eq.${id}` }),
  ]);

  send(res, 200, {
    ok: true,
    audience: aud,
    data: {
      record: {
        id: record.id,
        case_id: record.case_id,
        partition: record.partition,
        split: record.split,
        synthetic: record.synthetic,
        product: record.product,
        app_version: record.app_version,
        text: record.text_screened,
      },
      source: source.data[0] || null,
      reference: labels.data[0] || null,
      predictions: preds.data,
      reviews: reviews.data,
      candidates: candidates.data,
      route: preds.data[0] ? preds.data[0].route : null,
      humanStatus: candidates.data[0] ? candidates.data[0].status : (reviews.data[0] ? reviews.data[0].decision : 'unreviewed'),
    },
  });
};