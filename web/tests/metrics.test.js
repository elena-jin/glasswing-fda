const test = require('node:test');
const assert = require('node:assert');
const m = require('../api/_lib/metrics');

const pairs = [
  { reference: 'complaint', predicted: 'complaint' },       // tp
  { reference: 'complaint', predicted: 'product_feedback' }, // fn
  { reference: 'product_feedback', predicted: 'product_feedback' }, // tn
  { reference: 'product_feedback', predicted: 'complaint' }, // fp
];

test('confusion matrix counts complaint as positive', () => {
  const cm = m.confusion(pairs);
  assert.deepStrictEqual({ tp: cm.tp, fp: cm.fp, tn: cm.tn, fn: cm.fn }, { tp: 1, fp: 1, tn: 1, fn: 1 });
});

test('binary metrics: recall/specificity/precision', () => {
  const b = m.binaryMetrics(m.confusion(pairs));
  assert.strictEqual(b.recall, 0.5);
  assert.strictEqual(b.specificity, 0.5);
  assert.strictEqual(b.precision, 0.5);
  assert.strictEqual(b.falseNegatives, 1);
});

test('excluded records are not folded into the confusion matrix', () => {
  const cm = m.confusion([...pairs, { reference: 'excluded', predicted: 'excluded' }]);
  assert.strictEqual(cm.excluded, 1);
  assert.strictEqual(cm.tp + cm.fp + cm.tn + cm.fn, 4);
});

test('computeRunMetrics returns honest empty states', () => {
  const noRun = m.computeRunMetrics(null, pairs);
  assert.strictEqual(noRun.empty, true);
  assert.strictEqual(noRun.reason, 'run_not_found');
  const noPreds = m.computeRunMetrics({ id: 'r1' }, []);
  assert.strictEqual(noPreds.empty, true);
  assert.strictEqual(noPreds.reason, 'no_predictions');
});

test('computeRunMetrics labels offline vs live and attaches provenance', () => {
  const run = { id: 'r1', run_type: 'offline', model_version: 'modernbert-gate-v1', status: 'succeeded', threshold: 0.5 };
  const out = m.computeRunMetrics(run, pairs);
  assert.strictEqual(out.offline, true);
  assert.strictEqual(out.modelVersion, 'modernbert-gate-v1');
  assert.match(out.provenance, /tf_predictions/);
});

test('positive-only (maude) metrics suppress specificity/precision', () => {
  const run = { id: 'r2', run_type: 'offline' };
  const out = m.computeRunMetrics(run, [{ reference: 'complaint', predicted: 'complaint' }], { recallOnly: true });
  assert.strictEqual(out.metrics.recall, 1);
  assert.strictEqual(out.metrics.specificity, null);
  assert.strictEqual(out.metrics.precision, null);
});

test('perSplit groups by split', () => {
  const out = m.perSplit([
    { reference: 'complaint', predicted: 'complaint', split: 'eval' },
    { reference: 'complaint', predicted: 'complaint', split: 'train' },
    { reference: 'complaint', predicted: 'product_feedback', split: 'train' },
  ]);
  assert.strictEqual(out.eval.n, 1);
  assert.strictEqual(out.train.n, 2);
});