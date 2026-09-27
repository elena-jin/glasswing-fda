/* GET /api/data/health
 *
 * Server-side Supabase health/count endpoint. Returns an aggregate connection
 * status, the actual query timestamp, and partition-safe COUNTS only — never
 * rows, never evidence text, never identifiers, never credentials.
 *
 * Counts by partition are aggregates and safe for anonymous viewers; the public
 * demo's own bar is the `public_visible` count (synthetic AND a public partition).
 */
const { send, method } = require('../_lib/http');
const sb = require('../_lib/supabase');
const parts = require('../_lib/partitions');

const PARTITIONS = ['demo', 'train', 'validation', 'locked_eval', 'maude_stress'];

async function countSafe(table, query) {
  try { return await sb.count(table, query); }
  catch (err) { return { error: err && err.message ? err.message : 'count_failed' }; }
}

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const checkedAt = new Date().toISOString();

  if (!sb.configured()) {
    return send(res, 200, {
      ok: true,
      configured: false,
      connection: 'not_connected',
      label: 'not connected',
      checked_at: checkedAt,
      counts: null,
      note: 'No SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in this environment.',
    });
  }

  try {
    const byPartition = {};
    for (const p of PARTITIONS) {
      const n = await countSafe('tf_source_items', { select: 'id', data_partition: `eq.${p}` });
      byPartition[p] = typeof n === 'number' ? n : null;
    }
    const synthetic = await countSafe('tf_source_items', { select: 'id', synthetic: 'is.true' });
    const real = await countSafe('tf_source_items', { select: 'id', synthetic: 'is.false' });
    const total = await countSafe('tf_source_items', { select: 'id' });
    const publicVisible = await countSafe('tf_source_items', {
      select: 'id',
      synthetic: 'is.true',
      data_partition: parts.inFilter(parts.PUBLIC_PARTITIONS),
    });

    const counts = {
      total: typeof total === 'number' ? total : null,
      by_partition: byPartition,
      by_synthetic: {
        synthetic: typeof synthetic === 'number' ? synthetic : null,
        real: typeof real === 'number' ? real : null,
      },
      public_visible: typeof publicVisible === 'number' ? publicVisible : null,
    };

    send(res, 200, {
      ok: true,
      configured: true,
      connection: 'live',
      label: 'live data connection',
      checked_at: checkedAt,
      counts,
      note: 'Aggregate counts only. No rows, evidence text or credentials are returned.',
    });
  } catch (err) {
    send(res, 200, {
      ok: false,
      configured: true,
      connection: 'error',
      label: 'connection error',
      checked_at: checkedAt,
      counts: null,
      error: err && err.message ? err.message : 'query_failed',
    });
  }
};