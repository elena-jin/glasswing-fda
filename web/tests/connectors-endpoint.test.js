const test = require('node:test');
const assert = require('node:assert');
const { install, invoke } = require('./helpers');

const connectors = require('../api/connectors');

const TOKEN = 'internal-connectors-token';
const AUTH = { 'x-tf-internal': TOKEN, 'x-tf-reviewer': 'khizar' };

function clearSupplierEnv() {
  ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID', 'ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET',
    'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL',
    'ZENDESK_API_TOKEN', 'INTERCOM_ACCESS_TOKEN', 'APPSTORE_APP_ID', 'SALESFORCE_INSTANCE_URL'].forEach((k) => delete process.env[k]);
}

function fakeVendorFetch({ ok = true } = {}) {
  return async (url) => {
    const u = String(url);
    const body = u.includes('auth.test') ? { ok, team: 'aeris', error: ok ? undefined : 'invalid_auth' }
      : u.includes('conversations.history') ? { ok, messages: [{ text: 'hello world', ts: '1790000000' }] }
        : {};
    return { ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); } };
  };
}

test('GET with empty credentials: all sources not_connected, next listed, no values', async () => {
  clearSupplierEnv();
  install({ tables: { tf_audit_events: [] } });
  const res = await invoke(connectors, { method: 'GET', url: '/api/connectors' });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.sources.filter((s) => s.id !== 'salesforce').every((s) => s.state === 'not_connected'));
  assert.strictEqual(res.body.sources.find((s) => s.id === 'salesforce').state, 'stub');
  assert.deepStrictEqual(res.body.next.map((n) => n.id).sort(), ['granola', 'jira', 'qms']);
});

test('configured but unverified: env alone is not "live" and leaks no value', async () => {
  clearSupplierEnv();
  process.env.SLACK_BOT_TOKEN = 'secret-value-xyz';
  process.env.SLACK_CHANNEL_ID = 'C0SECRETCHANNEL';
  install({ tables: { tf_audit_events: [] } });
  const res = await invoke(connectors, { method: 'GET', url: '/api/connectors' });
  const slack = res.body.sources.find((s) => s.id === 'slack');
  assert.strictEqual(slack.state, 'configured_untested');
  assert.strictEqual(slack.configured, true);
  const dump = JSON.stringify(res.body);
  assert.ok(!dump.includes('secret-value-xyz'), 'token value must never be returned');
  assert.ok(!dump.includes('C0SECRETCHANNEL'), 'channel id must never be returned');
  clearSupplierEnv();
});

test('anonymous preview is refused (401) and returns no items', async () => {
  clearSupplierEnv();
  delete process.env.TF_INTERNAL_TOKEN;
  install({ tables: { tf_audit_events: [] } });
  const res = await invoke(connectors, { method: 'POST', url: '/api/connectors', body: { id: 'slack' } });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.items, undefined);
});

test('configured-but-missing credentials preview → not_configured/409, no leak', async () => {
  clearSupplierEnv();
  process.env.TF_INTERNAL_TOKEN = TOKEN;
  install({ tables: { tf_audit_events: [] } });
  const res = await invoke(connectors, { method: 'POST', url: '/api/connectors', headers: AUTH, body: { id: 'slack' } });
  delete process.env.TF_INTERNAL_TOKEN;
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.error, 'not_configured');
});

test('preview success (internal) → tested_live and records audit; GET then reports tested_live', async () => {
  clearSupplierEnv();
  process.env.TF_INTERNAL_TOKEN = TOKEN;
  process.env.SLACK_BOT_TOKEN = 'tok';
  process.env.SLACK_CHANNEL_ID = 'C1';
  const db = install({ tables: { tf_audit_events: [] } });
  const origFetch = global.fetch;
  global.fetch = fakeVendorFetch({ ok: true });
  try {
    const post = await invoke(connectors, { method: 'POST', url: '/api/connectors', headers: AUTH, body: { id: 'slack' } });
    assert.strictEqual(post.statusCode, 200);
    assert.strictEqual(post.body.state, 'tested_live');
    assert.strictEqual(post.body.count, 1);
    assert.ok(db.tables.tf_audit_events.some((e) => e.event_type === 'connector.preview.ok' && e.object_id === 'slack'));

    const get = await invoke(connectors, { method: 'GET', url: '/api/connectors' });
    const slack = get.body.sources.find((s) => s.id === 'slack');
    assert.strictEqual(slack.state, 'tested_live');
    assert.ok(slack.tested_at);
  } finally {
    global.fetch = origFetch;
    delete process.env.TF_INTERNAL_TOKEN;
    clearSupplierEnv();
    db.tables.tf_audit_events.length = 0;
  }
});

test('preview failure (bad token) → 409, sanitized error, no credential leak', async () => {
  clearSupplierEnv();
  process.env.TF_INTERNAL_TOKEN = TOKEN;
  process.env.SLACK_BOT_TOKEN = 'bad-token-abc';
  process.env.SLACK_CHANNEL_ID = 'C1';
  install({ tables: { tf_audit_events: [] } });
  const origFetch = global.fetch;
  global.fetch = fakeVendorFetch({ ok: false });
  try {
    const res = await invoke(connectors, { method: 'POST', url: '/api/connectors', headers: AUTH, body: { id: 'slack' } });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.error, 'fetch_failed');
    assert.ok(!JSON.stringify(res.body).includes('bad-token-abc'));
  } finally {
    global.fetch = origFetch;
    delete process.env.TF_INTERNAL_TOKEN;
    clearSupplierEnv();
  }
});