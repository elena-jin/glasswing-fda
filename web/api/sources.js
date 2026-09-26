/* GET /api/sources
 *   (no params)   every intake source with its connector status and volume
 *   ?id=<source>  one source plus its recent feedback feed and the ideas built
 *                 on it — this backs the source detail drawer in the UI
 */
const { send, method, query } = require('./_lib/http');
const { dataset } = require('./_lib/data');

module.exports = (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const q = query(req);
  const id = q.get('id');

  if (id) {
    const source = dataset.sources.find((s) => s.id === id);
    if (!source) return send(res, 404, { ok: false, error: 'source_not_found', id });
    const connector = dataset.connectors.find((c) => c.id === id) || null;
    const feed = dataset.sourceFeed[id] || [];
    const ideas = dataset.ideas.filter((i) => i.sources.some((s) => s[0] === id));
    return send(res, 200, { ok: true, data: { source, connector, feed, ideas } });
  }

  const data = dataset.sources.map((s) => ({
    ...s,
    connector: dataset.connectors.find((c) => c.id === s.id) || null
  }));
  send(res, 200, { ok: true, count: data.length, data });
};