/* Test Flight — chat provider adapter (server-only).
 *
 * Configured entirely by environment variables and DISABLED until a provider is
 * chosen. No provider is called until CHAT_PROVIDER + CHAT_MODEL + CHAT_API_KEY
 * are set AND the endpoint host is allowlisted.
 *
 *   CHAT_PROVIDER   openai | anthropic | openrouter | sciforium | deepseek
 *   CHAT_MODEL      model id
 *   CHAT_API_KEY    secret (server-only; never returned, never sent to clients)
 *   CHAT_BASE_URL   optional override; host MUST be in the allowlist
 */

const ALLOWED_HOSTS = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'openrouter.ai',
  'api.sciforium.com',
  'api.deepseek.com',
  'generativelanguage.googleapis.com',
]);

const DEFAULT_BASE = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  sciforium: 'https://api.sciforium.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

let fetchImpl = typeof fetch === 'function' ? fetch : null;
function __setFetch(fn) { fetchImpl = fn; }

function hostOf(url) { try { return new URL(url).host; } catch (e) { return null; } }

function config() {
  const provider = (process.env.CHAT_PROVIDER || '').trim().toLowerCase();
  const model = (process.env.CHAT_MODEL || '').trim();
  const key = (process.env.CHAT_API_KEY || '').trim();
  const base = (process.env.CHAT_BASE_URL || DEFAULT_BASE[provider] || '').trim();
  return { provider, model, key, base };
}

/* Never include the key. Returns only why it is unavailable. */
function available() {
  const { provider, model, key, base } = config();
  if (!provider) return { ok: false, reason: 'provider_not_selected' };
  if (!DEFAULT_BASE[provider]) return { ok: false, reason: 'provider_not_supported' };
  if (!base || !ALLOWED_HOSTS.has(hostOf(base))) return { ok: false, reason: 'endpoint_not_allowlisted' };
  if (!model) return { ok: false, reason: 'model_not_set' };
  if (!key) return { ok: false, reason: 'api_key_not_set' };
  return { ok: true, provider, model, base };
}

function redact(text) {
  const { key } = config();
  let s = String(text == null ? '' : text);
  if (key) s = s.split(key).join('[redacted]');
  // never echo bearer tokens or long hex/base64 secrets
  return s.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]').replace(/[A-Za-z0-9_\-]{40,}/g, '[redacted]').slice(0, 500);
}

async function chat({ system, user, maxTokens }) {
  const cfg = available();
  if (!cfg.ok) return { ok: false, error: cfg.reason };

  const started = Date.now();
  try {
    let url; const headers = { 'content-type': 'application/json' }; let body;
    if (cfg.provider === 'anthropic') {
      url = `${cfg.base.replace(/\/$/, '')}/messages`;
      headers['x-api-key'] = config().key;
      headers['anthropic-version'] = '2023-06-01';
      body = { model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
    } else {
      url = `${cfg.base.replace(/\/$/, '')}/chat/completions`;
      headers.authorization = `Bearer ${config().key}`;
      body = { model: cfg.model, max_tokens: maxTokens, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    }

    const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const raw = await res.text();
    let json = null; try { json = raw ? JSON.parse(raw) : null; } catch (e) { json = null; }
    if (!res.ok) return { ok: false, error: `provider_${res.status}`, detail: redact(json ? JSON.stringify(json) : raw) };

    let text = '';
    let usage = { input_tokens: null, output_tokens: null };
    if (cfg.provider === 'anthropic') {
      text = ((json && json.content) || []).map((c) => c.text || '').join('').trim();
      usage.input_tokens = json && json.usage ? json.usage.input_tokens : null;
      usage.output_tokens = json && json.usage ? json.usage.output_tokens : null;
    } else {
      const choice = json && json.choices && json.choices[0];
      text = (choice && choice.message && choice.message.content) || '';
      usage.input_tokens = json && json.usage ? json.usage.prompt_tokens : null;
      usage.output_tokens = json && json.usage ? json.usage.completion_tokens : null;
    }
    return { ok: true, text: String(text).trim(), usage: { model: cfg.model, ...usage, latency_ms: Date.now() - started } };
  } catch (err) {
    return { ok: false, error: 'provider_unreachable', detail: redact(err && err.message) };
  }
}

module.exports = { ALLOWED_HOSTS, config, available, chat, __setFetch, redact };