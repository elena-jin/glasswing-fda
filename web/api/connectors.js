/* GET  /api/connectors            connector status: configured? which env vars?
 * POST /api/connectors            body: { id }  → read-only live preview from the
 *                                 source (never a write). Returns normalized items.
 *
 * Credentials are read from environment variables only. A connector is "live"
 * when its required variables are set; otherwise the console stays synthetic.
 * See docs/connectors.md for the per-vendor setup.
 */
const { send, method, readJson } = require('./_lib/http');
const { dataset } = require('./_lib/data');
const connectors = require('./_lib/connectors');

function merged() {
  return dataset.connectors.map((c) => {
    const meta = connectors.credentials(c.id);
    return { ...c, configured: meta.configured, auth: meta.auth, env: meta.env, mode: meta.configured ? 'live' : 'synthetic' };
  });
}

async function handlePost(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return send(res, err.statusCode || 400, { ok: false, error: 'invalid_json' });
  }
  const id = body.id;
  if (!id || !connectors.REGISTRY[id]) {
    return send(res, 400, { ok: false, error: 'unknown_connector', allowed: Object.keys(connectors.REGISTRY) });
  }
  const result = await connectors.preview(id);
  return send(res, result.ok ? 200 : 409, result);
}

module.exports = async (req, res) => {
  if (req.method === 'POST') return handlePost(req, res);
  if (!method(req, res, ['GET', 'POST'])) return;
  const data = merged();
  send(res, 200, {
    ok: true,
    live: data.filter((c) => c.mode === 'live').map((c) => c.id),
    data
  });
};