const test = require('node:test');
const assert = require('node:assert');
const { install, invoke } = require('./helpers');

const provider = require('../api/_lib/chat/provider');
const trace = require('../api/_lib/chat/trace');
const assistant = require('../api/assistant');

const KEY = 'gsk-groq-secret-never-leak-0123456789abcdef';

function setGroq() {
  process.env.CHAT_PROVIDER = 'groq';
  process.env.CHAT_MODEL = 'openai/gpt-oss-20b';
  process.env.CHAT_API_KEY = KEY;
  delete process.env.CHAT_BASE_URL;
  delete process.env.CHAT_TEMPERATURE;
}
function clearGroq() {
  delete process.env.CHAT_PROVIDER; delete process.env.CHAT_MODEL; delete process.env.CHAT_API_KEY;
  delete process.env.CHAT_BASE_URL; delete process.env.CHAT_TEMPERATURE;
}

function completion(content) {
  return { ok: true, status: 200, async text() { return JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 11, completion_tokens: 4 } }); }, async json() { return {}; } };
}
function errResp(status, body) {
  return { ok: false, status, async text() { return JSON.stringify(body || {}); }, async json() { return body || {}; } };
}

function fakeDb() {
  return install({
    tables: {
      tf_source_items: [
        { id: 'rec-sync', source_type: 'zendesk', source_url: 'u1', data_partition: 'train', synthetic: true },
        { id: 'rec-widget', source_type: 'appstore', data_partition: 'validation', synthetic: true },
        { id: 'rec-locked', source_type: 'curated', data_partition: 'locked_eval', synthetic: false },
        { id: 'rec-maude', source_type: 'maude', data_partition: 'maude_stress', synthetic: false },
      ],
      tf_normalized_records: [
        { id: 'rec-sync', screened_text: 'Nightly therapy sync stalls at 99 percent.', context: {} },
        { id: 'rec-widget', screened_text: 'Add a home screen widget for the AHI score.', context: {} },
        { id: 'rec-locked', screened_text: 'LOCKED REAL TEXT', context: {} },
        { id: 'rec-maude', screened_text: 'MAUDE NARRATIVE', context: {} },
      ],
      tf_reference_labels: [
        { record_id: 'rec-sync', label: 'product_feedback', route: 'product_review', potential_mdr: false },
        { record_id: 'rec-widget', label: 'product_feedback', route: 'product_review', potential_mdr: false },
        { record_id: 'rec-locked', label: 'complaint', route: 'quality_review', potential_mdr: true },
        { record_id: 'rec-maude', label: 'complaint', route: 'quality_review', potential_mdr: true },
      ],
    },
  });
}

/* ---------------- provider ---------------- */

test('groq: default base + host allowed; URL/auth/model correct', async () => {
  setGroq();
  const a = provider.available();
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.base, 'https://api.groq.com/openai/v1');

  const orig = global.fetch; const calls = [];
  provider.__setFetch(async (url, opts) => { calls.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) }); return completion('ok'); });
  try {
    const out = await provider.chat({ system: 'sys', user: 'usr', maxTokens: 100 });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.strictEqual(calls[0].headers.authorization, 'Bearer ' + KEY);
    assert.strictEqual(calls[0].body.model, 'openai/gpt-oss-20b');
    assert.strictEqual('temperature' in calls[0].body, false, 'temperature must be omitted by default (gpt-oss rejects 0)');
    assert.strictEqual(out.usage.model, 'openai/gpt-oss-20b');
  } finally { provider.__setFetch(orig); clearGroq(); }
});

test('groq: temperature included only when CHAT_TEMPERATURE is set', async () => {
  setGroq(); process.env.CHAT_TEMPERATURE = '0.2';
  const orig = global.fetch; const calls = [];
  provider.__setFetch(async (url, opts) => { calls.push(JSON.parse(opts.body)); return completion('ok'); });
  try {
    await provider.chat({ system: 's', user: 'u', maxTokens: 10 });
    assert.strictEqual(calls[0].temperature, 0.2);
  } finally { provider.__setFetch(orig); clearGroq(); }
});

test('groq: 401 / 429 / 500 are honest, redacted errors', async () => {
  setGroq();
  for (const status of [401, 429, 500]) {
    const orig = global.fetch;
    provider.__setFetch(async () => errResp(status, { error: { message: 'bad ' + KEY } }));
    try {
      const out = await provider.chat({ system: 's', user: 'u', maxTokens: 10 });
      assert.strictEqual(out.ok, false);
      assert.strictEqual(out.error, 'provider_' + status);
      assert.ok(!JSON.stringify(out).includes(KEY), 'key must be redacted');
    } finally { provider.__setFetch(orig); }
  }
  clearGroq();
});

test('groq: missing key → api_key_not_set, no call', async () => {
  setGroq(); delete process.env.CHAT_API_KEY;
  assert.strictEqual(provider.available().reason, 'api_key_not_set');
  const orig = global.fetch; let called = 0;
  provider.__setFetch(async () => { called++; return completion('x'); });
  try {
    const out = await provider.chat({ system: 's', user: 'u', maxTokens: 10 });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.error, 'api_key_not_set');
    assert.strictEqual(called, 0);
  } finally { provider.__setFetch(orig); clearGroq(); }
});

test('groq: non-allowlisted base is rejected (strict host validation)', () => {
  setGroq(); process.env.CHAT_BASE_URL = 'https://groq.evil.example/openai/v1';
  const a = provider.available();
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.reason, 'endpoint_not_allowlisted');
  clearGroq();
});

/* ---------------- route-level (grounded), groq enabled ---------------- */

test('route: groq grounded answer cites only retrieved ids; no secret leak', async () => {
  setGroq(); const database = fakeDb();
  const orig = global.fetch; const calls = [];
  provider.__setFetch(async (url, opts) => { calls.push(JSON.parse(opts.body)); return completion('Sync issues are reported [rec-sync]. Also [bogus-id].'); });
  try {
    const res = await invoke(assistant, { method: 'POST', url: '/api/assistant', body: { message: 'nightly sync stalls', scope: 'product' } });
    assert.strictEqual(res.body.ok, true);
    assert.deepStrictEqual(res.body.reply.cites, ['rec-sync']);
    assert.ok(res.body.request_id);
    assert.ok(!JSON.stringify(res.body).includes(KEY));
    assert.strictEqual(calls[0].model, 'openai/gpt-oss-20b');
  } finally { provider.__setFetch(orig); clearGroq(); database.tables.tf_source_items.length = 0; }
});

test('route: product scope refuses quality topic (no provider call)', async () => {
  setGroq(); fakeDb();
  const orig = global.fetch; let called = 0;
  provider.__setFetch(async () => { called++; return completion('x'); });
  try {
    const res = await invoke(assistant, { method: 'POST', url: '/api/assistant', body: { message: 'show MDR candidates with harm', scope: 'product' } });
    assert.strictEqual(res.body.refused, 'scope');
    assert.deepStrictEqual(res.body.reply.cites, []);
    assert.strictEqual(called, 0);
  } finally { provider.__setFetch(orig); clearGroq(); }
});

test('route: synthetic-only retrieval, no restricted cohorts (locked/maude excluded)', async () => {
  setGroq(); const database = fakeDb();
  const orig = global.fetch;
  provider.__setFetch(async () => completion('ok [rec-sync]'));
  try {
    const res = await invoke(assistant, { method: 'POST', url: '/api/assistant', body: { message: 'widget for AHI score', scope: 'product' } });
    assert.ok(!res.body.retrieved.includes('rec-locked'));
    assert.ok(!res.body.retrieved.includes('rec-maude'));
    const call = database.calls.find((c) => c.table === 'tf_source_items');
    assert.strictEqual(call.query.synthetic, 'is.true');
    assert.strictEqual(call.query.data_partition, 'in.(train,validation,demo)');
  } finally { provider.__setFetch(orig); clearGroq(); database.tables.tf_source_items.length = 0; }
});

/* ---------------- runtime tracing (opt-in, metadata only) ---------------- */

test('trace: disabled by default → no SDK call', async () => {
  delete process.env.CHAT_TRACE; process.env.BRAINTRUST_API_KEY = 'bt-key';
  let loaded = false; trace.__setSdkLoader(() => { loaded = true; return { initLogger: () => ({ log() {}, flush: async () => {} }) }; });
  const r = await trace.traceChat({ request_id: 'r1', scope: 'product', outcome: 'grounded', citation_ids: ['rec-sync'] });
  assert.strictEqual(r.traced, false);
  assert.strictEqual(loaded, false);
  delete process.env.BRAINTRUST_API_KEY;
});

test('trace: enabled logs sanitized metadata only (no text keys)', async () => {
  process.env.CHAT_TRACE = '1'; process.env.BRAINTRUST_API_KEY = 'bt-key';
  const events = []; trace.__setSdkLoader(() => ({ initLogger: ({ projectName }) => ({ log: (e) => events.push({ projectName, e }), flush: async () => {} }) }));
  const r = await trace.traceChat({ request_id: 'r2', scope: 'quality', outcome: 'grounded', citation_ids: ['rec-sync'], model: 'openai/gpt-oss-20b', input_tokens: 10, output_tokens: 5, latency_ms: 123, score: 1, text: 'SHOULD NOT BE LOGGED', prompt: 'nope', evidence: 'nope' });
  assert.strictEqual(r.traced, true);
  assert.strictEqual(events[0].projectName, 'My Project');
  assert.deepStrictEqual(Object.keys(events[0].e.metadata).sort(), ['citation_ids', 'input_tokens', 'latency_ms', 'model', 'outcome', 'request_id', 'scope', 'score', 'output_tokens'].sort());
  assert.ok(!JSON.stringify(events[0].e).includes('SHOULD NOT BE LOGGED'));
  delete process.env.CHAT_TRACE; delete process.env.BRAINTRUST_API_KEY;
});