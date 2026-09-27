const test = require('node:test');
const assert = require('node:assert');
const { install, invoke } = require('./helpers');

const health = require('../api/data/health');

test('not configured → honest not_connected, no counts', async () => {
  const saved = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY, n: process.env.NEXT_PUBLIC_SUPABASE_URL };
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    const res = await invoke(health, { method: 'GET', url: '/api/data/health' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.configured, false);
    assert.strictEqual(res.body.connection, 'not_connected');
    assert.strictEqual(res.body.counts, null);
    assert.ok(res.body.checked_at);
  } finally {
    if (saved.u) process.env.SUPABASE_URL = saved.u;
    if (saved.k) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.k;
    if (saved.n) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.n;
  }
});

test('configured → live connection, partition-safe counts, timestamp, no text', async () => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';
  install({
    tables: {
      tf_source_items: [
        { id: 'a', data_partition: 'train', synthetic: true, payload: {} },
        { id: 'b', data_partition: 'train', synthetic: true, payload: {} },
        { id: 'c', data_partition: 'validation', synthetic: true, payload: {} },
        { id: 'd', data_partition: 'locked_eval', synthetic: false, payload: {} },
        { id: 'e', data_partition: 'maude_stress', synthetic: false, payload: {} },
      ],
    },
  });
  const res = await invoke(health, { method: 'GET', url: '/api/data/health' });
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.connection, 'live');
  assert.strictEqual(res.body.label, 'live data connection');
  assert.ok(res.body.checked_at);
  assert.strictEqual(res.body.counts.total, 5);
  assert.strictEqual(res.body.counts.by_partition.train, 2);
  assert.strictEqual(res.body.counts.by_partition.validation, 1);
  assert.strictEqual(res.body.counts.by_partition.locked_eval, 1);
  assert.strictEqual(res.body.counts.by_partition.maude_stress, 1);
  assert.strictEqual(res.body.counts.by_synthetic.synthetic, 3);
  assert.strictEqual(res.body.counts.by_synthetic.real, 2);
  assert.strictEqual(res.body.counts.public_visible, 3);
  // aggregates only — no row text / ids / payloads
  const dump = JSON.stringify(res.body);
  assert.ok(!dump.includes('payload'));
});