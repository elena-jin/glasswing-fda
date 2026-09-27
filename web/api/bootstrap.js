/* GET /api/bootstrap
 *
 * Returns the full dataset the frontend needs to render every view in one
 * request. The response `data` object shares the exact keys the frontend's
 * TF_DATA.apply() understands, so pointing assets/tf.config.js at this API is
 * the only step needed to switch the console to live data.
 */
const { send, method } = require('./_lib/http');
const { dataset, meta } = require('./_lib/data');
const connectors = require('./_lib/connectors');

module.exports = (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const data = {
    ...dataset,
    connectors: dataset.connectors.map((c) => {
      const m = connectors.credentials(c.id);
      return { ...c, configured: m.configured, auth: m.auth, env: m.env, mode: m.configured ? 'live' : 'synthetic' };
    }),
  };
  const live = data.connectors.filter((c) => c.mode === 'live').map((c) => c.id);
  send(res, 200, { ok: true, meta: { ...meta, liveConnectors: live }, data });
};