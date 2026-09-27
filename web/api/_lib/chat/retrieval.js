/* Test Flight — grounded retrieval for chat.
 *
 * Only synthetic source items in the public partitions are ever read:
 *   tf_source_items.synthetic = true AND data_partition IN ('train','validation','demo')
 * joined by the TEXT id to tf_normalized_records and tf_reference_labels.
 *
 * locked_eval, maude_stress and any app-review holdout are NEVER fetched into
 * chat (or Braintrust). The scope gate is applied here too: product scope must
 * not surface complaint / potential-MDR evidence.
 *
 * Filter-injection safety: the user's message is NEVER interpolated into a
 * PostgREST filter. We fetch a bounded candidate window with a fixed, safe
 * filter and rank locally by keyword overlap.
 */
const { safeSelect } = require('../db');
const parts = require('../partitions');
const { LIMITS, clampDoc } = require('./limits');

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be', 'with', 'that', 'this', 'it', 'as', 'at', 'by', 'from', 'we', 'i', 'you', 'they', 'our', 'my', 'me', 'do', 'does', 'did', 'how', 'what', 'why', 'when', 'which', 'who', 'about', 'show', 'me', 'tell', 'any', 'all', 'can', 'could', 'should', 'would', 'there', 'here', 'has', 'have', 'had', 'not', 'no', 'yes']);

function keywords(message) {
  return [...new Set(String(message || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 12);
}

function score(doc, kws) {
  const hay = (doc.text + ' ' + (doc.source_type || '') + ' ' + (doc.label || '')).toLowerCase();
  let s = 0;
  for (const k of kws) if (hay.includes(k)) s += 1;
  return s;
}

function isComplaintish(label, potentialMdr, route) {
  return label === 'complaint' || potentialMdr === true || route === 'quality_review';
}

async function retrieve({ message, scope }) {
  const sources = await safeSelect('tf_source_items', {
    select: 'id,source_type,source_url,occurred_at,data_partition,synthetic',
    synthetic: 'is.true',
    data_partition: parts.inFilter(parts.PUBLIC_PARTITIONS),
    order: 'received_at.desc',
    limit: LIMITS.CANDIDATE_LIMIT,
  });
  if (!sources.ok) return { ok: false, error: sources.error || 'retrieval_failed', docs: [] };
  const ids = sources.data.map((s) => s.id);
  if (!ids.length) return { ok: true, docs: [] };

  const [recs, labels] = await Promise.all([
    safeSelect('tf_normalized_records', { select: 'id,screened_text,evidence_text,context,source,provenance,eligibility', id: parts.inFilter(ids), limit: ids.length }),
    safeSelect('tf_reference_labels', { select: 'record_id,label,route,potential_mdr', record_id: parts.inFilter(ids), limit: ids.length }),
  ]);
  const srcById = new Map(sources.data.map((s) => [s.id, s]));
  const labById = new Map(labels.data.map((l) => [l.record_id, l]));

  let docs = recs.data.map((r) => {
    const s = srcById.get(r.id) || {};
    const l = labById.get(r.id) || {};
    return {
      id: r.id,
      text: clampDoc(r.screened_text || r.evidence_text || ''),
      source_type: s.source_type || null,
      source_url: s.source_url || null,
      partition: s.data_partition || null,
      synthetic: s.synthetic === true,
      label: l.label || null,
      route: l.route || null,
      potential_mdr: l.potential_mdr === true,
      occurred_at: s.occurred_at || null,
    };
  }).filter((d) => d.text);

  // Scope enforcement: product scope must not reveal complaint/MDR evidence.
  if (scope !== 'quality') docs = docs.filter((d) => !isComplaintish(d.label, d.potential_mdr, d.route));

  const kws = keywords(message);
  docs = docs.map((d) => ({ ...d, _score: score(d, kws) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, LIMITS.MAX_CONTEXT_DOCS)
    .map(({ _score, ...d }) => d);

  return { ok: true, docs };
}

module.exports = { retrieve, keywords, isComplaintish };