/* Test Flight — opt-in runtime Braintrust tracing (sanitized metadata only).
 *
 * DISABLED by default. Enabled only when BOTH:
 *   CHAT_TRACE=1 and BRAINTRUST_API_KEY are set.
 *
 * It logs ONLY sanitized metadata: request id, scope, outcome, synthetic
 * citation IDs, model, token counts and latency. It NEVER logs the prompt,
 * model output text, retrieved/evidence text, or any real-source rows — the
 * caller and this module both drop free text.
 *
 * Tracing is best-effort: any failure (missing SDK, network, key) is swallowed
 * so it can never break or slow an honest chat response.
 */

const SANITIZED_KEYS = [
  'request_id', 'scope', 'outcome', 'refused', 'unavailable', 'reason',
  'citation_ids', 'model', 'input_tokens', 'output_tokens', 'latency_ms', 'score',
];

let sdkLoader = () => require('braintrust');
function __setSdkLoader(fn) { sdkLoader = fn; }

function enabled() {
  return process.env.CHAT_TRACE === '1' && !!process.env.BRAINTRUST_API_KEY;
}

function sanitize(meta) {
  const out = {};
  for (const k of SANITIZED_KEYS) if (meta[k] !== undefined) out[k] = meta[k];
  if (Array.isArray(out.citation_ids)) out.citation_ids = out.citation_ids.slice(0, 20).map(String);
  return out;
}

async function traceChat(meta) {
  if (!enabled()) return { traced: false };
  try {
    const sdk = sdkLoader();
    const initLogger = sdk.initLogger || (sdk.default && sdk.default.initLogger);
    if (typeof initLogger !== 'function') return { traced: false };
    const logger = initLogger({ projectName: process.env.BRAINTRUST_PROJECT || 'My Project', apiKey: process.env.BRAINTRUST_API_KEY });
    logger.log({ input: 'grounded-chat', output: meta.outcome || 'unknown', metadata: sanitize(meta) });
    if (typeof logger.flush === 'function') await logger.flush();
    return { traced: true };
  } catch (err) {
    return { traced: false };
  }
}

module.exports = { enabled, sanitize, traceChat, __setSdkLoader, SANITIZED_KEYS };