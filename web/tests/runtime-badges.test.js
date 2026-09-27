const test = require('node:test');
const assert = require('node:assert');
const B = require('../assets/runtime-badges');

test('supabase badge: not configured / live / error', () => {
  assert.strictEqual(B.supabaseBadge(null).state, 'checking');
  assert.strictEqual(B.supabaseBadge({ ok: true, configured: false }).state, 'not_connected');
  assert.strictEqual(B.supabaseBadge({ ok: true, configured: true }).state, 'live');
  assert.strictEqual(B.supabaseBadge({ ok: false, configured: true }).state, 'error');
  assert.match(B.supabaseBadge({ ok: true, configured: true }).label, /live data connection/);
});

test('model badge: no runs until a real run exists', () => {
  assert.strictEqual(B.modelBadge(null).state, 'unknown');
  assert.strictEqual(B.modelBadge({ ok: true, empty: true }).state, 'no_runs');
  assert.match(B.modelBadge({ ok: true, empty: true }).label, /offline code only \/ no runs/);
  assert.strictEqual(B.modelBadge({ ok: true, empty: false, count: 2 }).state, 'has_runs');
});

test('connector summary reflects tested/untested/none', () => {
  assert.strictEqual(B.connectorSummary({ sources: [], tested_live: [], configured_untested: [] }).state, 'synthetic');
  const untested = B.connectorSummary({ sources: [{}, {}], tested_live: [], configured_untested: ['zoom'] });
  assert.strictEqual(untested.state, 'configured_untested');
  assert.match(untested.label, /configured, untested/);
  const tested = B.connectorSummary({ sources: [{}], tested_live: ['slack'], configured_untested: [] });
  assert.strictEqual(tested.state, 'tested_live');
  assert.match(tested.label, /tested live/);
});

test('toneClass maps tones to label classes', () => {
  assert.strictEqual(B.toneClass('success'), 'label-success');
  assert.strictEqual(B.toneClass('warning'), 'label-warning');
  assert.strictEqual(B.toneClass('nonsense'), 'label-neutral');
});