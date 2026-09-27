/* GET  /api/connectors   → truthful runtime status for each source (+ "next")
 * POST /api/connectors   body:{ id } → read-only live preview, INTERNAL ONLY.
 *
 * Rules enforced here:
 *  - Credential VALUES are never returned (only booleans and env-var names).
 *  - Private source previews are never returned to anonymous viewers: the POST
 *    is gated to an authenticated internal reviewer and fails closed (401).
 *  - A source is "tested live" only after a successful preview recorded an audit
 *    event; an env var alone is "configured, untested". Salesforce stays a stub.
 *  - A provisioned vendor trial is NOT treated as a working connector.
 */
const { send, method, readJson } = require('./_lib/http');
const { dataset } = require('./_lib/data');
const connectors = require('./_lib/connectors');
const state = require('./_lib/connector-state');
const parts = require('./_lib/partitions');
const sb = require('./_lib/supabase');
const { safeSelect, safeInsert } = require('./_lib/db');

/* Latest successful-preview timestamp per connector (best effort). */
async function lastTestedMap() {
  const map = {};
  if (!sb.configured()) return map;
  const res = await safeSelect('tf_audit_events', {
    select: 'object_id,created_at,event_type',
    event_type: 'eq.connector.preview.ok',
    order: 'created_at.desc',
    limit: 100,
  });
  for (const row of res.data) if (!map[row.object_id]) map[row.object_id] = row.created_at;
  return map;
}

async function buildSources(audience) {
  const tested = await lastTestedMap();
  return dataset.connectors.map((c) => {
    const meta = connectors.credentials(c.id);
    const info = state.describe(c.id, { registry: connectors.REGISTRY, configured: meta.configured, lastTestedAt: tested[c.id] || null });
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      auth: c.auth || (connectors.REGISTRY[c.id] && connectors.REGISTRY[c.id].auth) || null,
      source_class: info.source_class,
      configured: meta.configured,
      state: info.state,
      label: info.label,
      tested_at: info.tested_at || null,
      requires: info.state === 'not_connected' || info.state === 'configured_untested' ? meta.missing : [],
      synthetic_records: c.records,
    };
  });
}

async function handlePost(req, res) {
  let auth;
  try { auth = parts.requireInternal(req); }
  catch (err) { return send(res, err.status || 401, { ok: false, error: err.code || 'auth_required' }); }

  let body;
  try { body = await readJson(req); }
  catch (err) { return send(res, err.statusCode || 400, { ok: false, error: 'invalid_json' }); }

  const id = body.id;
  if (!id || !connectors.REGISTRY[id]) {
    return send(res, 400, { ok: false, error: 'unknown_connector', allowed: Object.keys(connectors.REGISTRY) });
  }

  const result = await connectors.preview(id);
  if (!result.ok) {
    // Sanitize: never echo tokens or raw vendor payloads.
    const failureState = state.describe(id, { registry: connectors.REGISTRY, configured: !!result.configured, lastTestedAt: null });
    return send(res, 409, {
      ok: false, id,
      state: result.error === 'not_configured' ? 'not_connected' : failureState.state,
      error: result.error,
      requires: result.missing || [],
    });
  }

  const testedAt = new Date().toISOString();
  try {
    await safeInsert('tf_audit_events', [{
      actor_id: auth.reviewer,
      event_type: 'connector.preview.ok',
      object_type: 'connector',
      object_id: id,
      detail: { count: result.count },
    }]);
  } catch (e) { /* best effort; a failed audit write must not break the preview */ }

  return send(res, 200, { ok: true, id, mode: 'live', state: 'tested_live', tested_at: testedAt, count: result.count, items: result.items });
}

module.exports = async (req, res) => {
  if (req.method === 'POST') return handlePost(req, res);
  if (!method(req, res, ['GET', 'POST'])) return;
  const aud = parts.audience(req);
  const sources = await buildSources(aud);
  send(res, 200, {
    ok: true,
    checked_at: new Date().toISOString(),
    audience: aud,
    sources,
    next: state.NEXT_ITEMS,
    tested_live: sources.filter((s) => s.state === 'tested_live').map((s) => s.id),
    configured_untested: sources.filter((s) => s.state === 'configured_untested').map((s) => s.id),
    notice: 'Credential values are never returned. Previews are internal-only (x-tf-internal).',
  });
};