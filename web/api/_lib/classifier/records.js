/* GET /api/classifier/records
 *   ?partition=  ?label=  ?limit=  ?offset=
 *
 * Records with source/provenance, synthetic vs real, partition, evidence text,
 * reference label, prediction + confidence + threshold, route, human status.
 *
 * SECURITY: public reads are filtered server-side by joining to tf_source_items
 * and requiring synthetic = true AND data_partition IN ('train','validation','demo').
 * Real-source partitions (locked_eval, maude_stress) are never returned to the
 * public audience through any path.
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
  const requested = q.get('partition');

  if (requested && aud !== 'internal' && !parts.isPublicPartition(requested)) {
    return send(res, 403, { ok: false, error: 'partition_forbidden', partition: parts.normalize(requested) });
  }

  // Step 1: the source items define visibility (partition + synthetic).
  const srcQuery = { select: 'id,source_type,data_partition,synthetic', order: 'received_at.desc', limit, offset };
  if (aud === 'internal') {
    if (requested) srcQuery.data_partition = `eq.${parts.normalize(requested)}`;
  } else {
    srcQuery.synthetic = 'is.true';
    srcQuery.data_partition = requested ? `eq.${parts.normalize(requested)}` : parts.inFilter(parts.PUBLIC_PARTITIONS);
  }

  const sources = await safeSelect('tf_source_items', srcQuery);
  if (!sources.ok) {
    return send(res, 200, {
      ok: true, audience: aud, partitions: parts.visiblePartitions(aud), count: 0, data: [], empty: true,
      error: sources.error, note: 'tf_source_items could not be read.',
    });
  }
  const ids = sources.data.map((s) => s.id);
  if (!ids.length) {
    return send(res, 200, { ok: true, audience: aud, partitions: parts.visiblePartitions(aud), count: 0, data: [], empty: true });
  }

  // Step 2: records + labels + predictions for the visible ids.
  const [recs, labels, preds] = await Promise.all([
    safeSelect('tf_normalized_records', { select: '*', id: parts.inFilter(ids), limit: ids.length }),
    safeSelect('tf_reference_labels', { select: '*', record_id: parts.inFilter(ids), limit: ids.length }),
    safeSelect('tf_predictions', { select: '*', record_id: parts.inFilter(ids), order: 'created_at.desc', limit: ids.length * 3 }),
  ]);

  // Preserve the source ordering (received_at desc).
  const recById = new Map(recs.data.map((r) => [r.id, r]));
  const ordered = ids.map((id) => recById.get(id)).filter(Boolean);
  let data = assemble(ordered, sources.data, labels.data, preds.data);

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