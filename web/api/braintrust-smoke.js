/* GET /api/braintrust-smoke
 *
 * Server-only smoke test for the Braintrust integration. It logs ONE synthetic
 * trace to the Braintrust project "My Project" and flushes it.
 *
 *   input:    "synthetic smoke test"
 *   output:   "ok"
 *   metadata: { source: "smoke" }
 *
 * Guarantees:
 *  - Gated by the `x-smoke-token` header matching process.env.SMOKE_TOKEN.
 *  - Uses process.env.BRAINTRUST_API_KEY, which is never returned, logged or
 *    echoed anywhere.
 *  - Makes NO model call and reads NO Supabase data.
 *  - Missing key / bad token → { ok: false, reason }.
 *
 * Configure (server-side only): SMOKE_TOKEN + BRAINTRUST_API_KEY.
 * The braintrust SDK is required lazily so a missing dependency cannot break
 * other functions.
 */
const { send, method } = require('./_lib/http');

const PROJECT = 'My Project';

// Test seam: allow a fake SDK to be injected. Not used in production.
let sdkLoader = () => require('braintrust');
function __setSdkLoader(fn) { sdkLoader = fn; }

function redact(value) {
  const key = process.env.BRAINTRUST_API_KEY || '';
  let s = String(value == null ? '' : value);
  if (key) s = s.split(key).join('[redacted]');
  s = s.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]').replace(/[A-Za-z0-9_\-]{40,}/g, '[redacted]');
  return s.slice(0, 200);
}

module.exports = async (req, res) => {
  if (!method(req, res, ['GET'])) return;

  // 1. Token gate (fail closed).
  const expected = process.env.SMOKE_TOKEN;
  const provided = req.headers && req.headers['x-smoke-token'];
  if (!expected || !provided || provided !== expected) {
    return send(res, 401, { ok: false, reason: expected ? 'unauthorized' : 'smoke_token_not_configured' });
  }

  // 2. Key must exist. Never returned.
  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) return send(res, 503, { ok: false, reason: 'braintrust_api_key_missing' });

  // 3. Lazily load the SDK.
  let sdk;
  try { sdk = sdkLoader(); }
  catch (err) { return send(res, 503, { ok: false, reason: 'braintrust_sdk_unavailable' }); }

  // 4. Log one synthetic trace and flush.
  try {
    const initLogger = sdk.initLogger || (sdk.default && sdk.default.initLogger);
    if (typeof initLogger !== 'function') return send(res, 503, { ok: false, reason: 'braintrust_sdk_unavailable' });

    const logger = initLogger({ projectName: PROJECT, apiKey });
    logger.log({ input: 'synthetic smoke test', output: 'ok', metadata: { source: 'smoke' } });
    if (typeof logger.flush === 'function') await logger.flush();

    // No key, no payload echo — just the truth.
    return send(res, 200, { ok: true, logged: true });
  } catch (err) {
    return send(res, 502, { ok: false, reason: 'log_failed', detail: redact(err && err.message) });
  }
};

module.exports.__setSdkLoader = __setSdkLoader;