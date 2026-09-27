/* Test Flight — connector runtime state (pure, testable).
 *
 * The badge a source shows must come from runtime evidence, never from a
 * hardcoded green light:
 *
 *   not_connected      no credentials present                 → "synthetic demo / not connected"
 *   configured_untested credentials present, never pulled     → "configured, untested"
 *   tested_live        a read-only preview succeeded (ts)     → "tested live · <ts>"
 *   stub               source is not implemented (Salesforce) → "stub — no live reads"
 *   adapter_missing    no adapter code at all                 → "no adapter"
 *
 * Credential VALUES are never part of this module's inputs or outputs — only
 * booleans and env-var NAMES.
 */

const EXTERNAL_SOURCES = ['zoom', 'slack', 'gmail', 'zendesk', 'intercom', 'appstore', 'salesforce'];

// Entries that are deliberately out of scope for this demo (shown under "Next").
const NEXT_ITEMS = [
  { id: 'granola', name: 'Granola', reason: 'transcripts mocked; no adapter yet' },
  { id: 'jira', name: 'Jira', reason: 'demo project only — no app API wired' },
  { id: 'qms', name: 'QMS export (Veeva/MasterControl/…)', reason: 'no authorized tenant; mock only' },
];

const STUB_SOURCES = ['salesforce'];

function hasAdapter(id, registry) {
  const c = registry && registry[id];
  return !!(c && c.fetch);
}

function computeState({ configured, stub, adapterPresent, lastTestedAt }) {
  if (stub) return { state: 'stub', label: 'stub — no live reads' };
  if (!adapterPresent) return { state: 'adapter_missing', label: 'no adapter' };
  if (!configured) return { state: 'not_connected', label: 'synthetic demo / not connected' };
  if (lastTestedAt) return { state: 'tested_live', label: 'tested live', tested_at: lastTestedAt };
  return { state: 'configured_untested', label: 'configured, untested' };
}

function describe(id, { registry, configured, lastTestedAt }) {
  const stub = STUB_SOURCES.includes(id);
  const adapterPresent = hasAdapter(id, registry) && !stub;
  const base = computeState({ configured, stub, adapterPresent, lastTestedAt });
  return { source_class: stub ? 'stub' : (adapterPresent ? 'live' : 'unavailable'), ...base };
}

module.exports = { EXTERNAL_SOURCES, NEXT_ITEMS, STUB_SOURCES, hasAdapter, computeState, describe };