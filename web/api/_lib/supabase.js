/* Test Flight — server-only Supabase access.
 *
 * SECURITY
 *  - This module reads the service-role key from the environment and must only
 *    ever run inside Vercel serverless functions. Never import it from browser
 *    code (assets/*), never return the key, never log it.
 *  - It talks to PostgREST over HTTPS with the service key. The public demo only
 *    ever reads the synthetic partition; the partition gate lives in
 *    `./partitions.js` and is enforced server-side, not in the client.
 *
 * The client is intentionally tiny and dependency-free so the console stays a
 * zero-dependency static app with thin serverless functions.
 */

function envUrl() {
  return (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.POSTGRES_URL ||
    ''
  ).replace(/\/$/, '');
}

function serviceKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ''
  );
}

function configured() {
  return !!(envUrl() && serviceKey());
}

class SupabaseError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.body = body;
  }
}

let fetchImpl = typeof fetch === 'function' ? fetch : null;
// Test seam: inject a fetch implementation. Never used in production.
function __setFetch(fn) {
  fetchImpl = fn;
}

async function rest(path, { method = 'GET', query, body, headers = {}, prefer } = {}) {
  if (!configured()) throw new SupabaseError('supabase_not_configured', 500, null);
  const url = new URL(`${envUrl()}/rest/v1/${path.replace(/^\//, '')}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  const key = serviceKey();
  const res = await fetchImpl(url.toString(), {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(prefer ? { prefer } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }
  if (!res.ok) throw new SupabaseError(`supabase_${res.status}`, res.status, parsed);
  return parsed;
}

const select = (table, query, opts) => rest(table, { query, ...opts });
const insert = (table, rows, opts) =>
  rest(table, { method: 'POST', body: rows, prefer: 'return=representation', ...opts });
const update = (table, query, patch, opts) =>
  rest(table, { method: 'PATCH', query, body: patch, prefer: 'return=representation', ...opts });
const upsert = (table, rows, opts) =>
  rest(table, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=representation', ...opts });

/* Read the live schema via PostgREST's OpenAPI document (table + column names
 * only — no rows, no secrets). Used by the guarded /api/classifier/schema
 * endpoint so migrations can be reconciled against reality. */
async function introspect(prefix = 'tf_') {
  if (!configured()) throw new SupabaseError('supabase_not_configured', 500, null);
  const res = await fetchImpl(`${envUrl()}/rest/v1/`, {
    headers: { apikey: serviceKey(), authorization: `Bearer ${serviceKey()}`, accept: 'application/openapi+json' },
  });
  if (!res.ok) throw new SupabaseError(`supabase_${res.status}`, res.status, null);
  const spec = await res.json();
  const out = {};
  for (const [name, def] of Object.entries(spec.definitions || spec.components?.schemas || {})) {
    if (!name.startsWith(prefix)) continue;
    out[name] = Object.keys(def.properties || {});
  }
  return out;
}

module.exports = {
  SupabaseError,
  configured,
  rest,
  select,
  insert,
  update,
  upsert,
  introspect,
  __setFetch,
  _envUrl: envUrl,
};