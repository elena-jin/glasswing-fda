/* GET /api/classifier/schema
 *
 * Ops/recon endpoint: returns the live column names for the tf_* tables by
 * asking PostgREST for its OpenAPI document through the service key. Table and
 * column NAMES only — never rows, never secrets.
 *
 * Gated: returns 404 unless the `x-tf-admin` header matches TF_ADMIN_TOKEN.
 * If TF_ADMIN_TOKEN is unset the endpoint behaves as if it does not exist
 * (fail closed), so it is safe to ship.
 */
const { send, method } = require('../_lib/http');
const sb = require('../_lib/supabase');

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const token = process.env.TF_ADMIN_TOKEN;
  const header = req.headers['x-tf-admin'];
  if (!token || !header || header !== token) return send(res, 404, { ok: false, error: 'not_found' });
  if (!sb.configured()) return send(res, 503, { ok: false, error: 'supabase_not_configured' });

  try {
    const tables = await sb.introspect('tf_');
    send(res, 200, { ok: true, tables });
  } catch (err) {
    send(res, 200, { ok: false, error: err.message, status: err.status });
  }
};