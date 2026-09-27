const test = require('node:test');
const assert = require('node:assert');
const { install, invoke } = require('./helpers');

const records = require('../api/_lib/classifier/records');
const review = require('../api/_lib/classifier/review');
const candidates = require('../api/_lib/classifier/candidates');
const retrain = require('../api/_lib/classifier/retrain');
const summary = require('../api/_lib/classifier/summary');
const detail = require('../api/_lib/classifier/record');
const router = require('../api/classifier');

const TOKEN = 'internal-test-token';
const AUTH = { 'x-tf-internal': TOKEN, 'x-tf-reviewer': 'khizar.kashif' };

function withInternal(fn) {
  process.env.TF_INTERNAL_TOKEN = TOKEN;
  try { return fn(); } finally { delete process.env.TF_INTERNAL_TOKEN; }
}

function baseDb(extra) {
  return install({
    tables: Object.assign({
      tf_source_items: [
        { id: 'rec-train', source_type: 'zendesk', native_id: 't1', data_partition: 'train', synthetic: true },
        { id: 'rec-val', source_type: 'appstore', native_id: 'v1', data_partition: 'validation', synthetic: true },
        { id: 'rec-locked', source_type: 'curated', native_id: 'l1', data_partition: 'locked_eval', synthetic: false },
        { id: 'rec-maude', source_type: 'maude', native_id: 'm1', data_partition: 'maude_stress', synthetic: false },
      ],
      tf_normalized_records: [
        { id: 'rec-train', schema_version: '1.1', evidence_text: 'raw train', screened_text: 'train text', context: { product_hint: 'Aeris Air app' } },
        { id: 'rec-val', schema_version: '1.1', evidence_text: 'raw val', screened_text: 'validation text' },
        { id: 'rec-locked', schema_version: '1.1', evidence_text: 'REAL LOCKED TEXT', screened_text: 'REAL LOCKED TEXT' },
        { id: 'rec-maude', schema_version: '1.1', evidence_text: 'MAUDE NARRATIVE', screened_text: 'MAUDE NARRATIVE' },
      ],
      tf_reference_labels: [
        { record_id: 'rec-train', label: 'complaint' },
        { record_id: 'rec-val', label: 'product_feedback' },
        { record_id: 'rec-locked', label: 'complaint' },
        { record_id: 'rec-maude', label: 'complaint' },
      ],
      tf_predictions: [
        { id: 'p1', record_id: 'rec-train', run_id: 'run1', model_version_id: 'mv1', predicted_label: 'complaint', confidence: 0.9, threshold: 0.5, route: 'quality_review' },
      ],
      tf_model_runs: [], tf_model_versions: [], tf_review_decisions: [], tf_training_candidates: [], tf_audit_events: [],
    }, extra || {}),
  });
}

/* ---------------- no leakage ---------------- */

test('records: public only sees synthetic train/validation; real-source never leaks', async () => {
  const db = baseDb();
  const res = await invoke(records, { method: 'GET', url: '/api/classifier/records?limit=50' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.audience, 'public');
  const ids = res.body.data.map((r) => r.id);
  assert.deepStrictEqual(ids.sort(), ['rec-train', 'rec-val']);
  assert.ok(!res.body.data.some((r) => /LOCKED|MAUDE/.test(r.text || '')), 'no real-source text');
  const call = db.calls.find((c) => c.table === 'tf_source_items');
  assert.strictEqual(call.query.synthetic, 'is.true');
  assert.match(call.query.data_partition, /in\.\(train,validation,demo\)/);
});

test('records: public requesting a real partition gets 403', async () => {
  baseDb();
  const res = await invoke(records, { method: 'GET', url: '/api/classifier/records?partition=locked_eval' });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error, 'partition_forbidden');
});

test('detail: real-source record returns 403 with no evidence text', async () => {
  baseDb();
  const res = await invoke(detail, { method: 'GET', url: '/api/classifier/record?id=rec-locked' });
  assert.strictEqual(res.statusCode, 403);
  assert.ok(!JSON.stringify(res.body).includes('REAL LOCKED TEXT'));
  assert.strictEqual(res.body.data, undefined);
});

test('detail: synthetic record returns text', async () => {
  baseDb();
  const res = await invoke(detail, { method: 'GET', url: '/api/classifier/record?id=rec-train' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data.record.text, 'train text');
  assert.strictEqual(res.body.data.record.partition, 'train');
});

/* ---------------- no anonymous writes ---------------- */

test('writes fail closed without an internal token', async () => {
  delete process.env.TF_INTERNAL_TOKEN;
  const db = baseDb();
  const r1 = await invoke(review, { method: 'POST', url: '/api/classifier/review', body: { record_id: 'rec-train', decision: 'agree', final_label: 'complaint' } });
  assert.strictEqual(r1.statusCode, 401);
  assert.strictEqual(r1.body.error, 'auth_not_configured');
  const r2 = await invoke(candidates, { method: 'GET', url: '/api/classifier/candidates' });
  assert.strictEqual(r2.statusCode, 401);
  const r3 = await invoke(retrain, { method: 'POST', url: '/api/classifier/retrain', body: {} });
  assert.strictEqual(r3.statusCode, 401);
  assert.strictEqual(db.tables.tf_review_decisions.length, 0);
});

test('writes reject a wrong internal header', async () => {
  process.env.TF_INTERNAL_TOKEN = TOKEN;
  baseDb();
  const res = await invoke(review, { method: 'POST', url: '/api/classifier/review', headers: { 'x-tf-internal': 'nope' }, body: { record_id: 'rec-train', decision: 'agree', final_label: 'complaint' } });
  delete process.env.TF_INTERNAL_TOKEN;
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.error, 'auth_required');
});

test('review: internal reviewer writes final_label/route and an audit event', async () => {
  process.env.TF_INTERNAL_TOKEN = TOKEN;
  const db = baseDb();
  const res = await invoke(review, {
    method: 'POST', url: '/api/classifier/review', headers: AUTH,
    body: { record_id: 'rec-train', decision: 'override', corrected_label: 'product_feedback', reason: 'not a complaint' },
  });
  delete process.env.TF_INTERNAL_TOKEN;
  assert.strictEqual(res.statusCode, 202);
  assert.strictEqual(res.body.ok, true);
  const row = db.tables.tf_review_decisions[0];
  assert.strictEqual(row.reviewer_id, 'khizar.kashif');
  assert.strictEqual(row.final_label, 'product_feedback');
  assert.strictEqual(row.final_route, 'product_review');
  assert.ok(db.tables.tf_audit_events.some((e) => e.event_type === 'review.saved' && e.actor_id === 'khizar.kashif'));
});

test('review: an invalid corrected label is rejected', async () => {
  process.env.TF_INTERNAL_TOKEN = TOKEN;
  baseDb();
  const res = await invoke(review, { method: 'POST', url: '/api/classifier/review', headers: AUTH, body: { record_id: 'rec-train', decision: 'override', corrected_label: 'bogus' } });
  delete process.env.TF_INTERNAL_TOKEN;
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, 'invalid_final_label');
});

/* ---------------- training gate ---------------- */

test('candidates: locked_eval/maude_stress cannot be approved; train can', async () => {
  process.env.TF_INTERNAL_TOKEN = TOKEN;
  const db = baseDb({
    tf_review_decisions: [
      { id: 'rev-locked', record_id: 'rec-locked', reviewer_id: 'khizar.kashif', final_label: 'complaint', final_route: 'quality_review' },
      { id: 'rev-train', record_id: 'rec-train', reviewer_id: 'khizar.kashif', final_label: 'complaint', final_route: 'quality_review' },
    ],
    tf_training_candidates: [
      { id: 'c-locked', review_id: 'rev-locked', candidate_status: 'pending' },
      { id: 'c-train', review_id: 'rev-train', candidate_status: 'pending' },
    ],
  });
  const blocked = await invoke(candidates, { method: 'POST', url: '/api/classifier/candidates', headers: AUTH, body: { id: 'c-locked', action: 'approve' } });
  assert.strictEqual(blocked.statusCode, 409);
  assert.strictEqual(blocked.body.error, 'training_leak_blocked');
  const ok = await invoke(candidates, { method: 'POST', url: '/api/classifier/candidates', headers: AUTH, body: { id: 'c-train', action: 'approve' } });
  assert.strictEqual(ok.statusCode, 202);
  const byId = (id) => db.tables.tf_training_candidates.find((c) => c.id === id);
  assert.strictEqual(byId('c-locked').candidate_status, 'pending');
  assert.strictEqual(byId('c-train').candidate_status, 'approved');
  delete process.env.TF_INTERNAL_TOKEN;
});

test('retrain: internal only; gate blocks locked_eval and maude_stress', async () => {
  process.env.TF_INTERNAL_TOKEN = TOKEN;
  const db = baseDb();
  const res = await invoke(retrain, { method: 'POST', url: '/api/classifier/retrain', headers: AUTH, body: { dataset_version: 'v1.3', reason: 'test' } });
  delete process.env.TF_INTERNAL_TOKEN;
  assert.strictEqual(res.statusCode, 202);
  const run = db.tables.tf_model_runs[0];
  assert.strictEqual(run.data_partition, 'train');
  assert.strictEqual(run.status, 'pending');
  assert.ok(run.parameters.gate.blocked_partitions.includes('locked_eval'));
  assert.ok(run.parameters.gate.blocked_partitions.includes('maude_stress'));
});

/* ---------------- metrics provenance ---------------- */

test('summary: public excludes real-source pairs (empty when only locked/maude predictions)', async () => {
  baseDb({
    tf_model_runs: [{ id: 'run1', model_version_id: 'mv1', dataset_version: 'v1.3', data_partition: 'validation', status: 'succeeded', parameters: {} }],
    tf_predictions: [
      { id: 'pL', run_id: 'run1', record_id: 'rec-locked', predicted_label: 'complaint', confidence: 0.9 },
      { id: 'pM', run_id: 'run1', record_id: 'rec-maude', predicted_label: 'complaint', confidence: 0.9 },
    ],
  });
  const res = await invoke(summary, { method: 'GET', url: '/api/classifier/summary' });
  assert.strictEqual(res.body.runs[0].empty, true);
});

test('summary: maude metrics are recall-only for internal', async () => {
  process.env.TF_INTERNAL_TOKEN = TOKEN;
  baseDb({
    tf_model_runs: [{ id: 'run2', model_version_id: 'mv1', dataset_version: 'v1.3', data_partition: 'maude_stress', status: 'succeeded', parameters: {} }],
    tf_predictions: [{ id: 'pM', run_id: 'run2', record_id: 'rec-maude', predicted_label: 'complaint', confidence: 0.9 }],
  });
  const res = await invoke(summary, { method: 'GET', url: '/api/classifier/summary', headers: AUTH });
  delete process.env.TF_INTERNAL_TOKEN;
  const run = res.body.runs[0];
  assert.strictEqual(run.empty, false);
  assert.strictEqual(run.recallOnly, true);
  assert.strictEqual(run.metrics.specificity, null);
});

test('summary: synthetic run computes a confusion matrix with provenance, offline', async () => {
  baseDb({
    tf_model_runs: [{ id: 'run3', model_version_id: 'mv1', dataset_version: 'v1.3', data_partition: 'validation', status: 'succeeded', parameters: { threshold: 0.5 } }],
    tf_model_versions: [{ id: 'mv1', model_family: 'ModernBERT', status: 'candidate', threshold: 0.5 }],
    tf_predictions: [{ id: 'p2', run_id: 'run3', record_id: 'rec-train', predicted_label: 'complaint', confidence: 0.8 }],
  });
  const res = await invoke(summary, { method: 'GET', url: '/api/classifier/summary' });
  const run = res.body.runs[0];
  assert.strictEqual(run.empty, false);
  assert.strictEqual(run.offline, true);
  assert.strictEqual(run.confusion.tp, 1);
  assert.strictEqual(run.modelFamily, 'ModernBERT');
  assert.match(run.provenance, /tf_source_items/);
});

/* ---------------- router ---------------- */

test('router: unknown resource 404; dispatch by query param', async () => {
  baseDb();
  const bad = await invoke(router, { method: 'GET', url: '/api/classifier?resource=bogus' });
  assert.strictEqual(bad.statusCode, 404);
  const good = await invoke(router, { method: 'GET', url: '/api/classifier?resource=records&limit=5' });
  assert.strictEqual(good.statusCode, 200);
  assert.strictEqual(good.body.audience, 'public');
});