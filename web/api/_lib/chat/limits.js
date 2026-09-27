/* Test Flight — grounded chat limits.
 *
 * Hard caps for input, retrieved context and output, plus a tiny in-memory rate
 * limiter. In-memory is per serverless instance (best effort); the caps are the
 * real guard. All values are conservative by default and overridable by env.
 */

const LIMITS = {
  MAX_MESSAGE_CHARS: intEnv('CHAT_MAX_MESSAGE_CHARS', 1000),
  MAX_CONTEXT_DOCS: intEnv('CHAT_MAX_CONTEXT_DOCS', 6),
  MAX_DOC_CHARS: intEnv('CHAT_MAX_DOC_CHARS', 600),
  MAX_OUTPUT_TOKENS: intEnv('CHAT_MAX_OUTPUT_TOKENS', 500),
  RATE_WINDOW_MS: intEnv('CHAT_RATE_WINDOW_MS', 60000),
  RATE_MAX: intEnv('CHAT_RATE_MAX', 12),
  // Candidate rows scanned before local ranking (bounds the DB read).
  CANDIDATE_LIMIT: intEnv('CHAT_CANDIDATE_LIMIT', 400),
};

function intEnv(name, dflt) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

function clampMessage(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!s) return { ok: false, error: 'empty_message' };
  if (s.length > LIMITS.MAX_MESSAGE_CHARS) return { ok: false, error: 'message_too_long', max: LIMITS.MAX_MESSAGE_CHARS };
  return { ok: true, message: s };
}

function clampDoc(text) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > LIMITS.MAX_DOC_CHARS ? s.slice(0, LIMITS.MAX_DOC_CHARS) + '…' : s;
}

function estimateTokens(s) { return Math.ceil(String(s || '').length / 4); }

/* In-memory sliding window keyed by caller id. */
const buckets = new Map();
function rateLimit(key) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < LIMITS.RATE_WINDOW_MS);
  if (arr.length >= LIMITS.RATE_MAX) {
    buckets.set(key, arr);
    return { ok: false, retry_after_ms: LIMITS.RATE_WINDOW_MS - (now - arr[0]) };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true, remaining: LIMITS.RATE_MAX - arr.length };
}

function callerKey(req) {
  const fwd = req && req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  return String(fwd || (req && req.socket && req.socket.remoteAddress) || 'anonymous').split(',')[0].trim();
}

module.exports = { LIMITS, clampMessage, clampDoc, estimateTokens, rateLimit, callerKey };