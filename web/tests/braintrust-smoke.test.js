const test = require('node:test');
const assert = require('node:assert');
const { invoke } = require('./helpers');

const smoke = require('../api/braintrust-smoke');

const TOKEN = 'smoke-token-abc';
const KEY = 'sk-braintrust-secret-never-leak';

function setEnv(opts = {}) {
  const token = 'token' in opts ? opts.token : TOKEN;
  const key = 'key' in opts ? opts.key : KEY;
  if (token) process.env.SMOKE_TOKEN = token; else delete process.env.SMOKE_TOKEN;
  if (key) process.env.BRAINTRUST_API_KEY = key; else delete process.env.BRAINTRUST_API_KEY;
}
function clearEnv() { delete process.env.SMOKE_TOKEN; delete process.env.BRAINTRUST_API_KEY; }

test('wrong token → ok:false unauthorized, SDK not loaded', async () => {
  setEnv();
  let loaded = false;
  smoke.__setSdkLoader(() => { loaded = true; return {}; });
  const res = await invoke(smoke, { method: 'GET', url: '/api/braintrust-smoke', headers: { 'x-smoke-token': 'wrong' } });
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { ok: false, reason: 'unauthorized' });
  assert.strictEqual(loaded, false);
  clearEnv();
});

test('SMOKE_TOKEN unset → fails closed', async () => {
  setEnv({ token: undefined });
  const res = await invoke(smoke, { method: 'GET', url: '/api/braintrust-smoke', headers: { 'x-smoke-token': 'anything' } });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.reason, 'smoke_token_not_configured');
  clearEnv();
});

test('correct token but missing key → key_missing (never the key)', async () => {
  setEnv({ key: undefined });
  const res = await invoke(smoke, { method: 'GET', url: '/api/braintrust-smoke', headers: { 'x-smoke-token': TOKEN } });
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.reason, 'braintrust_api_key_missing');
  assert.ok(!JSON.stringify(res.body).toLowerCase().includes('api_key') || res.body.reason.includes('missing'));
  clearEnv();
});

test('success: logs one synthetic trace, flushes, returns {ok,logged}, leaks no key', async () => {
  setEnv();
  const events = []; let flushed = false; let projectName = null; let seenKey = null;
  smoke.__setSdkLoader(() => ({
    initLogger: ({ projectName: pn, apiKey }) => { projectName = pn; seenKey = apiKey; return { log: (e) => events.push(e), flush: async () => { flushed = true; } }; }
  }));
  const res = await invoke(smoke, { method: 'GET', url: '/api/braintrust-smoke', headers: { 'x-smoke-token': TOKEN } });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { ok: true, logged: true });
  assert.strictEqual(projectName, 'My Project');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].input, 'synthetic smoke test');
  assert.strictEqual(events[0].output, 'ok');
  assert.deepStrictEqual(events[0].metadata, { source: 'smoke' });
  assert.strictEqual(flushed, true);
  assert.strictEqual(seenKey, KEY);
  assert.ok(!JSON.stringify(res.body).includes(KEY), 'key must never be returned');
  clearEnv();
});

test('SDK unavailable → honest reason, no key', async () => {
  setEnv();
  smoke.__setSdkLoader(() => { throw new Error('cannot find module braintrust'); });
  const res = await invoke(smoke, { method: 'GET', url: '/api/braintrust-smoke', headers: { 'x-smoke-token': TOKEN } });
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.reason, 'braintrust_sdk_unavailable');
  assert.ok(!JSON.stringify(res.body).includes(KEY));
  clearEnv();
});

test('log failure → log_failed with redacted detail (never the key)', async () => {
  setEnv();
  smoke.__setSdkLoader(() => ({ initLogger: () => ({ log: () => { throw new Error('failed with ' + KEY); }, flush: async () => {} }) }));
  const res = await invoke(smoke, { method: 'GET', url: '/api/braintrust-smoke', headers: { 'x-smoke-token': TOKEN } });
  assert.strictEqual(res.statusCode, 502);
  assert.strictEqual(res.body.reason, 'log_failed');
  assert.ok(!JSON.stringify(res.body).includes(KEY), 'detail must be redacted');
  clearEnv();
});

test('non-GET is rejected', async () => {
  setEnv();
  const res = await invoke(smoke, { method: 'POST', url: '/api/braintrust-smoke', headers: { 'x-smoke-token': TOKEN } });
  assert.strictEqual(res.statusCode, 405);
  clearEnv();
});