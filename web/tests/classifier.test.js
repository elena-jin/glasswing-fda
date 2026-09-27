const test = require('node:test');
const assert = require('node:assert');
const { install, invoke } = require('./helpers');

const records = require('../api/_lib/classifier/records');
const review = require('../api/_lib/classifier/review');
const candidates = require('../api/_lib/classifier/candidates');
const retrain = require('../api/_lib/classifier/retrain');
const summary = require('../api/_lib/classifier/summary');
const router = require('../api/classifier');

function baseDb(extra) {
  return install({
    tables: Object.assign({
      tf_normalized_records: [
        { id: 'n-syn', case_id: 'case-syn', partition: 'synthetic', split: 'train', synthetic: true, text_screened: 'sync stalls', product: 'Aeris Air app' },
        { id: 'n-real', case_id: 'case-real', partition: 'real_eval', split: 'eval', synthetic: false, text_screened: 'real PHI text', product: 'Aeris Air app' },
        { id: 'n-maude', case_id: 'case-maude', partition: 'maude', split: 'eval', synthetic: false, text_screened: 'MAUDE narrative', product: 'CPAP' },
      ],
      tf_reference_labels: [
        { id: 'l1', normalized_record_id: 'n-syn', label: 'complaint', split: 'train' },
        { id: 'l2', normalized_record_id: 'n-real', label: 'complaint', split: 'eval' },
      ],
      tf_predictions: [
        { id: 'p1', normalized_record_id: 'n-syn', predicted_label: 'complaint', confidence: 0.9, threshold: 0.5, route: 'quality', run_id: 'run1' },
      ],
      tf_model_runs: [],
      tf_review_decisions: [],
      tf_training_candidates: [],
      tf_audit_events: [],
    }, extra || {}),
  });
}

test('records: public audience only receives synthetic records', async () => {
  const db = baseDb();
  const res = await invoke(records, { method: 'GET', url: '/api/classifier/records?limit=25' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.audience, 'public');
  const partitions = res.body.data.map((r) => r.partition);
  assert.ok(partitions.length >= 1);
  assert.ok(partitions.every((p) => /^synthetic/.test(p)), 'no real/maude records leak to public');

  const call = db.calls.find((c) => c.table === 'tf_normalized_records');
  assert.match(call.query.partition, /in\.\(/);
  assert.ok(!/real|maude/.test(call.query.partition), 'server-side filter excludes real/maude');
});

test('records: requesting a non-visible partition is a 403, not an empty list', async () => {
  baseDb();
  const res = await invoke(records, { method: 'GET', url: '/api/classifier/records?partition=real_eval' });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error, 'partition_forbidden');
});

test('review: writes a decision and an audit event', async () => {
  const db = baseDb();
  const res = await invoke(review, {
    method: 'POST', url: '/api/classifier/review',
    body: { normalized_record_id: 'n-syn', reviewer: 'khizar', decision: 'override', corrected_label: 'product_feedback', reason: 'not a complaint' },
  });
  assert.strictEqual(res.statusCode, 202);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.auditLogged, true);
  assert.strictEqual(db.tables.tf_review_decisions.length, 1);
  assert.strictEqual(db.tables.tf_audit_events.length, 1);
  assert.strictEqual(db.tables.tf_audit_events[0].action, 'review.saved');
});

test('review: public cannot review a non-synthetic record', async () => {
  baseDb();
  const res = await invoke(review, {
    method: 'POST', url: '/api/classifier/review',
    body: { normalized_record_id: 'n-real', reviewer: 'khizar', decision: 'agree' },
  });
  assert.strictEqual(res.statusCode, 403);
});

test('review: override without a corrected label is rejected', async () => {
  baseDb();
  const res = await invoke(review, {
    method: 'POST', url: '/api/classifier/review',
    body: { normalized_record_id: 'n-syn', reviewer: 'khizar', decision: 'override' },
  });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, 'override_requires_corrected_label');
});

test('candidates: approving a locked-eval candidate is blocked (409)', async () => {
  const db = baseDb({
    tf_training_candidates: [{ id: 'c1', normalized_record_id: 'n-real', proposed_label: 'complaint', status: 'pending' }],
  });
  const res = await invoke(candidates, {
    method: 'POST', url: '/api/classifier/candidates',
    body: { id: 'c1', action: 'approve', actor: 'khizar' },
  });
  assert.strictEqual(res.statusCode, 409);
  assert.strictEqual(res.body.error, 'training_leak_blocked');
  assert.strictEqual(db.tables.tf_training_candidates[0].status, 'pending', 'status unchanged on block');
});

test('candidates: approving a synthetic train candidate succeeds', async () => {
  const db = baseDb({
    tf_training_candidates: [{ id: 'c2', normalized_record_id: 'n-syn', proposed_label: 'complaint', status: 'pending' }],
  });
  const res = await invoke(candidates, {
    method: 'POST', url: '/api/classifier/candidates',
    body: { id: 'c2', action: 'approve', actor: 'khizar' },
  });
  assert.strictEqual(res.statusCode, 202);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(db.tables.tf_training_candidates[0].status, 'approved');
  assert.ok(db.tables.tf_audit_events.some((e) => e.action === 'candidate.approve'));
});

test('retrain: requires a held-out eval split', async () => {
  baseDb();
  const res = await invoke(retrain, { method: 'POST', url: '/api/classifier/retrain', body: { created_by: 'khizar' } });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, 'eval_split_required');
});

test('retrain: blocks locked eval from training and records the gate', async () => {
  const db = baseDb();
  const res = await invoke(retrain, {
    method: 'POST', url: '/api/classifier/retrain',
    body: { eval_split: 'held_out_eval', train_partitions: ['synthetic', 'maude', 'real_eval'], created_by: 'khizar', reason: 'test' },
  });
  assert.strictEqual(res.statusCode, 202);
  assert.ok(res.body.gate.blocked.includes('maude'));
  assert.ok(res.body.gate.blocked.includes('real_eval'));
  assert.deepStrictEqual(res.body.gate.train, ['synthetic']);
  assert.strictEqual(db.tables.tf_model_runs[0].metrics.gate.exclude_locked_eval, true);
  assert.strictEqual(db.tables.tf_model_runs[0].status, 'requested');
});

test('router: unknown resource returns 404 without touching the DB', async () => {
  baseDb();
  const res = await invoke(router, { method: 'GET', url: '/api/classifier?resource=bogus' });
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.body.error, 'unknown_classifier_resource');
});

test('router: dispatches to a resource by query param', async () => {
  baseDb();
  const res = await invoke(router, { method: 'GET', url: '/api/classifier?resource=records&limit=5' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.audience, 'public');
});

test('summary: a run without predictions is an honest empty state', async () => {
  install({
    tables: {
      tf_model_runs: [{ id: 'run1', model_version: 'modernbert-gate-v1', run_type: 'offline', status: 'succeeded', eval_split: 'eval' }],
      tf_predictions: [],
      tf_reference_labels: [],
      tf_normalized_records: [],
    },
  });
  const res = await invoke(summary, { method: 'GET', url: '/api/classifier/summary' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.runs[0].empty, true);
  assert.strictEqual(res.body.runs[0].reason, 'no_predictions');
});

test('summary: metrics provenance comes from the run, offline labelled', async () => {
  install({
    tables: {
      tf_model_runs: [{ id: 'run1', model_version: 'modernbert-gate-v1', run_type: 'offline', status: 'succeeded', eval_split: 'eval', threshold: 0.5 }],
      tf_predictions: [{ id: 'p1', run_id: 'run1', normalized_record_id: 'n-syn', predicted_label: 'complaint', confidence: 0.8 }],
      tf_reference_labels: [{ id: 'l1', normalized_record_id: 'n-syn', label: 'complaint', split: 'eval' }],
      tf_normalized_records: [{ id: 'n-syn', partition: 'synthetic_eval', split: 'eval' }],
    },
  });
  const res = await invoke(summary, { method: 'GET', url: '/api/classifier/summary' });
  const run = res.body.runs[0];
  assert.strictEqual(run.empty, false);
  assert.strictEqual(run.offline, true);
  assert.strictEqual(run.confusion.tp, 1);
  assert.match(run.provenance, /tf_predictions/);
});