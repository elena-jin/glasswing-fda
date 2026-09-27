const test = require('node:test');
const assert = require('node:assert');
const parts = require('../api/_lib/partitions');

test('public audience may only see synthetic partitions', () => {
  const vis = parts.visiblePartitions('public');
  assert.deepStrictEqual(vis.sort(), ['synthetic', 'synthetic_eval', 'synthetic_train']);
  assert.ok(!vis.some((p) => /real|maude/.test(p)));
});

test('public cannot see real or maude partitions; internal can', () => {
  assert.strictEqual(parts.canSee('real_eval', 'public'), false);
  assert.strictEqual(parts.canSee('maude', 'public'), false);
  assert.strictEqual(parts.canSee('real_eval', 'internal'), true);
  assert.strictEqual(parts.canSee('maude', 'internal'), true);
  assert.strictEqual(parts.canSee('synthetic', 'public'), true);
});

test('assertVisible throws 403 for a forbidden partition', () => {
  assert.throws(() => parts.assertVisible('real_eval', 'public'), (e) => e.status === 403 && e.code === 'partition_forbidden');
  assert.doesNotThrow(() => parts.assertVisible('synthetic', 'public'));
});

test('locked eval / non-train splits cannot enter training', () => {
  assert.throws(() => parts.assertTrainable({ partition: 'synthetic_eval', split: 'eval' }), (e) => e.code === 'training_leak_blocked');
  assert.throws(() => parts.assertTrainable({ partition: 'maude' }), (e) => e.code === 'training_leak_blocked');
  assert.throws(() => parts.assertTrainable({ partition: 'synthetic', split: 'eval' }), (e) => e.code === 'training_leak_blocked');
  assert.doesNotThrow(() => parts.assertTrainable({ partition: 'synthetic', split: 'train' }));
});

test('audience fails closed when no internal token is configured', () => {
  delete process.env.TF_INTERNAL_TOKEN;
  assert.strictEqual(parts.audience({ headers: { 'x-tf-internal': 'anything' } }), 'public');
  process.env.TF_INTERNAL_TOKEN = 'secret';
  assert.strictEqual(parts.audience({ headers: { 'x-tf-internal': 'secret' } }), 'internal');
  assert.strictEqual(parts.audience({ headers: {} }), 'public');
  delete process.env.TF_INTERNAL_TOKEN;
});

test('maude is flagged recall-only', () => {
  assert.strictEqual(parts.metricScope('maude').recallOnly, true);
  assert.strictEqual(parts.metricScope('synthetic').recallOnly, false);
});