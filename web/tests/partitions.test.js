const test = require('node:test');
const assert = require('node:assert');
const parts = require('../api/_lib/partitions');

test('public partitions are train/validation/demo only', () => {
  assert.deepStrictEqual(parts.PUBLIC_PARTITIONS, ['train', 'validation', 'demo']);
  assert.ok(parts.REAL_PARTITIONS.includes('locked_eval'));
  assert.ok(parts.REAL_PARTITIONS.includes('maude_stress'));
});

test('visibility requires synthetic AND a public partition', () => {
  assert.strictEqual(parts.isVisibleSource({ synthetic: true, data_partition: 'train' }, 'public'), true);
  assert.strictEqual(parts.isVisibleSource({ synthetic: true, data_partition: 'validation' }, 'public'), true);
  // real-source partitions are never public, even if a row were mis-flagged synthetic
  assert.strictEqual(parts.isVisibleSource({ synthetic: true, data_partition: 'locked_eval' }, 'public'), false);
  assert.strictEqual(parts.isVisibleSource({ synthetic: true, data_partition: 'maude_stress' }, 'public'), false);
  // non-synthetic train is not public
  assert.strictEqual(parts.isVisibleSource({ synthetic: false, data_partition: 'train' }, 'public'), false);
  // internal sees everything
  assert.strictEqual(parts.isVisibleSource({ synthetic: false, data_partition: 'locked_eval' }, 'internal'), true);
  assert.strictEqual(parts.isVisibleSource({ synthetic: false, data_partition: 'maude_stress' }, 'internal'), true);
});

test('assertVisibleSource throws 403 for real-source', () => {
  assert.throws(
    () => parts.assertVisibleSource({ synthetic: false, data_partition: 'locked_eval' }, 'public'),
    (e) => e.status === 403 && e.code === 'partition_forbidden'
  );
});

test('locked_eval and maude_stress are never trainable', () => {
  assert.throws(() => parts.assertTrainable({ synthetic: false, data_partition: 'locked_eval' }), (e) => e.code === 'training_leak_blocked');
  assert.throws(() => parts.assertTrainable({ synthetic: false, data_partition: 'maude_stress' }), (e) => e.code === 'training_leak_blocked');
  assert.throws(() => parts.assertTrainable({ synthetic: true, data_partition: 'validation' }), (e) => e.code === 'training_leak_blocked');
  assert.doesNotThrow(() => parts.assertTrainable({ synthetic: true, data_partition: 'train' }));
});

test('maude is recall-only; split mapping', () => {
  assert.strictEqual(parts.metricScope('maude_stress').recallOnly, true);
  assert.strictEqual(parts.metricScope('train').recallOnly, false);
  assert.strictEqual(parts.splitOf('train'), 'train');
  assert.strictEqual(parts.splitOf('validation'), 'eval');
  assert.strictEqual(parts.splitOf('locked_eval'), 'eval');
  assert.strictEqual(parts.splitOf('maude_stress'), 'maude');
});

test('requireInternal fails closed without a token or with a bad header', () => {
  delete process.env.TF_INTERNAL_TOKEN;
  assert.throws(() => parts.requireInternal({ headers: { 'x-tf-internal': 'x' } }), (e) => e.code === 'auth_not_configured' && e.status === 401);

  process.env.TF_INTERNAL_TOKEN = 's3cret';
  assert.throws(() => parts.requireInternal({ headers: {} }), (e) => e.code === 'auth_required');
  assert.throws(() => parts.requireInternal({ headers: { 'x-tf-internal': 'wrong' } }), (e) => e.code === 'auth_required');
  const ok = parts.requireInternal({ headers: { 'x-tf-internal': 's3cret', 'x-tf-reviewer': 'khizar' } });
  assert.strictEqual(ok.reviewer, 'khizar');
  delete process.env.TF_INTERNAL_TOKEN;
});