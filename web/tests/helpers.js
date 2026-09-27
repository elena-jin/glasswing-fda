/* Shared test harness. Injects a fake fetch into the server-only Supabase
 * module so endpoints can be exercised without a live database, and provides
 * tiny request/response doubles for the Vercel handler signature.
 */
const path = require('path');
const sb = require(path.join(__dirname, '..', 'api', '_lib', 'supabase'));

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';
delete process.env.TF_INTERNAL_TOKEN;
delete process.env.TF_ADMIN_TOKEN;

function jsonResponse(rows, status = 200, headers) {
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) h[k.toLowerCase()] = String(v);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => h[String(k).toLowerCase()] ?? null },
    async text() { return JSON.stringify(rows); },
    async json() { return rows; },
  };
}

function matchFilter(value, expr) {
  if (expr == null) return true;
  if (expr === 'is.true') return value === true;
  if (expr === 'is.false') return value === false;
  if (expr.startsWith('eq.')) return String(value) === expr.slice(3);
  if (expr.startsWith('in.(')) {
    const list = expr.slice(4, -1).split(',').map((s) => s.trim());
    return list.includes(String(value));
  }
  return true;
}

/* db: { tables: { tf_x: [rows] } }  (mutated on POST) */
function install(db) {
  db.calls = db.calls || [];
  for (const t of Object.keys(db.tables)) {
    for (const row of db.tables[t]) if (!row.id) row.id = t + '-' + Math.random().toString(36).slice(2, 8);
  }
  sb.__setFetch(async (url, opts = {}) => {
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();
    const openapi = /\/rest\/v1\/?$/.test(u.pathname);
    const table = openapi ? null : decodeURIComponent(u.pathname.replace(/^\/rest\/v1\//, ''));
    const query = Object.fromEntries(u.searchParams.entries());
    const body = opts.body ? JSON.parse(opts.body) : null;
    db.calls.push({ url: url.toString(), method, table, query, body });

    if (openapi) {
      const definitions = {};
      for (const t of Object.keys(db.tables)) {
        const cols = {};
        for (const col of Object.keys(db.tables[t][0] || {})) cols[col] = { type: 'string' };
        definitions[t] = { properties: cols };
      }
      return jsonResponse({ definitions });
    }

    if (method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      db.tables[table] = db.tables[table] || [];
      const inserted = rows.map((r) => {
        const row = Object.assign({}, r);
        if (!row.id) row.id = table + '-' + Math.random().toString(36).slice(2, 8);
        if (!row.created_at) row.created_at = new Date().toISOString();
        db.tables[table].push(row);
        return row;
      });
      return jsonResponse(inserted);
    }

    if (method === 'PATCH') {
      const list = db.tables[table] || [];
      const updated = [];
      for (const row of list) {
        let ok = true;
        for (const [k, v] of Object.entries(query)) {
          if (k === 'select' || k === 'order') continue;
          if (!matchFilter(row[k], v)) ok = false;
        }
        if (ok) { Object.assign(row, body); updated.push(row); }
      }
      return jsonResponse(updated);
    }

    let rows = (db.tables[table] || []).slice();
    for (const [k, v] of Object.entries(query)) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      rows = rows.filter((r) => matchFilter(r[k], v));
    }
    if (method === 'HEAD') {
      return jsonResponse([], 206, { 'content-range': '0-0/' + rows.length });
    }
    if (query.limit) rows = rows.slice(0, parseInt(query.limit, 10));
    return jsonResponse(rows);
  });
  return db;
}

function makeReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; },
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s ? JSON.parse(s) : null; },
  };
  return res;
}

async function invoke(handler, reqOpts) {
  const res = makeRes();
  await handler(makeReq(reqOpts), res);
  return res;
}

module.exports = { sb, install, makeReq, makeRes, invoke, jsonResponse };