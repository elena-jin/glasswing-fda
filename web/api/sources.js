/* GET /api/sources
 *   (no params)   every intake source with its connector status and volume
 *   ?id=<source>  one source plus its recent feedback feed and the ideas built
 *                 on it — this backs the source detail drawer in the UI
 */
const { send, method, query } = require('./_lib/http');
const { dataset } = require('./_lib/data');
const connectors = require('./_lib/connectors');

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const q = query(req);
  const id = q.get('id');

  if (id) {
    const source = dataset.sources.find((s) => s.id === id);
    if (!source) return send(res, 404, { ok: false, error: 'source_not_found', id });
    const connector = dataset.connectors.find((c) => c.id === id) || null;
    const feed = dataset.sourceFeed[id] || [];
    const ideas = dataset.ideas.filter((i) => i.sources.some((s) => s[0] === id));

    const meta = connectors.credentials(id);
    let live = null;
    if (meta.configured) {
      const p = await connectors.preview(id);
      if (p.ok) live = { count: p.count, items: p.items };
    }

    return send(res, 200, {
      ok: true,
      data: {
        source,
        connector: connector ? { ...connector, configured: meta.configured, mode: meta.configured ? 'live' : 'synthetic', env: meta.env } : null,
        feed,
        ideas,
        live,
      },
    });
  }

  const data = dataset.sources.map((s) => {
    const meta = connectors.credentials(s.id);
    return {
      ...s,
      connector: dataset.connectors.find((c) => c.id === s.id)
        ? { ...dataset.connectors.find((c) => c.id === s.id), configured: meta.configured, mode: meta.configured ? 'live' : 'synthetic' }
        : null,
    };
  });
  send(res, 200, { ok: true, count: data.length, data });
};