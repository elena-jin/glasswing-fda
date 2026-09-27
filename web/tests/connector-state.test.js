const test = require('node:test');
const assert = require('node:assert');
const state = require('../api/_lib/connector-state');

const registry = { slack: { fetch: () => {} }, salesforce: { fetch: null } };

test('empty credentials → not_connected', () => {
  const s = state.computeState({ configured: false, stub: false, adapterPresent: true, lastTestedAt: null });
  assert.strictEqual(s.state, 'not_connected');
  assert.match(s.label, /synthetic demo \/ not connected/);
});

test('env var alone → configured, untested (never "live")', () => {
  const s = state.computeState({ configured: true, stub: false, adapterPresent: true, lastTestedAt: null });
  assert.strictEqual(s.state, 'configured_untested');
  assert.match(s.label, /untested/);
});

test('successful preview → tested live with timestamp', () => {
  const s = state.computeState({ configured: true, stub: false, adapterPresent: true, lastTestedAt: '2026-09-27T12:00:00Z' });
  assert.strictEqual(s.state, 'tested_live');
  assert.strictEqual(s.tested_at, '2026-09-27T12:00:00Z');
});

test('salesforce stays a stub even when configured', () => {
  const d = state.describe('salesforce', { registry, configured: true, lastTestedAt: '2026-09-27T12:00:00Z' });
  assert.strictEqual(d.state, 'stub');
  assert.strictEqual(d.source_class, 'stub');
  assert.match(d.label, /stub/);
});

test('unknown source without an adapter → adapter_missing', () => {
  const d = state.describe('granola', { registry, configured: true, lastTestedAt: null });
  assert.strictEqual(d.state, 'adapter_missing');
});

test('next list names the deliberately-unwired items', () => {
  const ids = state.NEXT_ITEMS.map((n) => n.id);
  assert.ok(ids.includes('granola'));
  assert.ok(ids.includes('jira'));
  assert.ok(ids.includes('qms'));
});