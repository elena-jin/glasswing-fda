/* Test Flight — grounded chat orchestration.
 *
 * Flow: validate + cap → rate limit → retrieve (synthetic public partitions only)
 * → scope gate → provider call → citation filter. There is NO canned fallback:
 * if the DB or the provider is unavailable the route returns an honest
 * "unavailable" state and nothing is invented.
 */
const { clampMessage, rateLimit, callerKey, LIMITS, estimateTokens } = require('./limits');
const { retrieve } = require('./retrieval');
const { buildMessages } = require('./prompt');
const provider = require('./provider');

const QUALITY_TOPIC = /\b(mdr|harm|harmed|injury|complaint|complaints|quality|compliance|recall|adverse|safety|reportab)/i;

function isQualityTopic(message) { return QUALITY_TOPIC.test(String(message || '')); }

function citeFilter(text, docs) {
  const t = String(text || '');
  return docs.map((d) => d.id).filter((id) => t.includes(id));
}

async function answer({ message, scope, req }) {
  const clamped = clampMessage(message);
  if (!clamped.ok) return { status: 400, body: { ok: false, error: clamped.error, max: clamped.max, scope, reply: { text: 'Please enter a shorter question.', cites: [] } } };

  const rl = rateLimit(callerKey(req));
  if (!rl.ok) {
    return { status: 429, body: { ok: false, error: 'rate_limited', retry_after_ms: rl.retry_after_ms, scope, reply: { text: 'Too many requests — please wait a moment and try again.', cites: [] } } };
  }

  // Scope gate: product scope must not answer quality/compliance questions.
  if (scope !== 'quality' && isQualityTopic(clamped.message)) {
    return { status: 200, body: { ok: true, scope: 'product', refused: 'scope', reply: { text: 'Complaint, MDR and other Quality/compliance details are outside the product scope. Switch to the “+ Quality” scope to include them.', cites: [] } } };
  }

  const r = await retrieve({ message: clamped.message, scope });
  if (!r.ok) {
    return { status: 200, body: { ok: false, unavailable: true, reason: 'database_unavailable', scope, reply: { text: 'Grounded chat is unavailable: the evidence store could not be read. No answer was generated.', cites: [] } } };
  }
  if (!r.docs.length) {
    return { status: 200, body: { ok: true, scope, reply: { text: "I don't know — the retrieved records do not support an answer.", cites: [] } } };
  }

  const prov = provider.available();
  if (!prov.ok) {
    return { status: 200, body: { ok: false, unavailable: true, reason: prov.reason, scope, reply: { text: 'Grounded chat is unavailable: no model provider is configured yet. No answer was generated.', cites: [] }, evidence_available: r.docs.length } };
  }

  const { system, user } = buildMessages({ message: clamped.message, scope, docs: r.docs });
  const out = await provider.chat({ system, user, maxTokens: LIMITS.MAX_OUTPUT_TOKENS });
  if (!out.ok) {
    return { status: 200, body: { ok: false, unavailable: true, reason: out.error, scope, reply: { text: 'Grounded chat is temporarily unavailable: the model provider could not be reached. No answer was generated.', cites: [] } } };
  }

  const cites = citeFilter(out.text, r.docs);
  return {
    status: 200,
    body: {
      ok: true,
      scope,
      reply: { text: out.text, cites },
      grounded: true,
      retrieved: r.docs.map((d) => d.id),
      usage: { model: out.usage.model, input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens, latency_ms: out.usage.latency_ms, context_tokens_est: estimateTokens(user) },
    },
  };
}

module.exports = { answer, isQualityTopic, citeFilter, LIMITS };