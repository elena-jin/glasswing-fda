/* GET /api/classifier/records
 *   ?partition=  ?split=  ?label=  ?limit=  ?offset=
 *
 * Records with source/provenance, synthetic vs real, partition, evidence text,
 * reference label, prediction + confidence + threshold, route, and human status.
 *
 * SECURITY: the public audience only receives the synthetic partitions; the
 * filter is applied server-side. A non-visible `partition` returns 403.
 * Records with a NULL data_partition are NOT public (fail closed).
 */
const { send, method, query } = require('../http');
const { safeSelect, assemble } = require('../db');
const sb = require('../supabase');
const parts = require('../partitions');

const MAX_LIMIT = 100;

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const aud = parts.audience(req);
  if (!sb.configured()) return send(res, 503, { ok: false, error: 'supabase_not_configured' });

  const q = query(req);
  const limit = Math.min(parseInt(q.get('limit') || '25', 10) || 25, MAX_LIMIT);
  const offset = Math.max(parseInt(q.get('offset') || '0', 10) || 0, 0);

  let partitionFilter;
  const requested = q.get('partition');
  if (requested) {
    try { parts.assertVisible(requested, aud); }
    catch (err) { return send(res, 403, { ok: false, error: err.code, partition: err.partition }); }
    partitionFilter = `eq.${requested}`;
  } else {
    partitionFilter = parts.inFilter(parts.visiblePartitions(aud));
  }

  const recQuery = { select: '*', data_partition: partitionFilter, order: 'created_at.desc', limit, offset };
  const split = q.get('split');
  if (split) recQuery.split = `eq.${split}`;

  const recs = await safeSelect('tf_normalized_records', recQuery);
  if (!recs.ok) {
    return send(res, 200, {
      ok: true, audience: aud, partitions: parts.visiblePartitions(aud), count: 0, data: [], empty: true,
      error: recs.error, note: 'tf_normalized_records could not be read (schema drift or not migrated).',
    });
  }

  const ids = recs.data.map((r) => r.id);
  let labels = { data: [] };
  let preds = { data: [] };
  if (ids.length) {
    [labels, preds] = await Promise.all([
      safeSelect('tf_reference_labels', { select: '*', record_id: parts.inFilter(ids), limit: ids.length }),
      safeSelect('tf_predictions', { select: '*', record_id: parts.inFilter(ids), order: 'created_at.desc', limit: ids.length * 3 }),
    ]);
  }

  let data = assemble(recs.data, labels.data, preds.data);
  const label = q.get('label');
  if (label) data = data.filter((r) => (r.reference && r.reference.label) === label);

  send(res, 200, {
    ok: true,
    audience: aud,
    partitions: parts.visiblePartitions(aud),
    count: data.length,
    empty: data.length === 0,
    data,
  });
};