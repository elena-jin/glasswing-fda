/* Shared HTTP helpers for the Test Flight serverless functions. */

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function method(req, res, allowed) {
  if (allowed.indexOf(req.method) !== -1) return true;
  res.setHeader('allow', allowed.join(', '));
  send(res, 405, { ok: false, error: 'method_not_allowed', allowed });
  return false;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    const e = new Error('invalid_json');
    e.statusCode = 400;
    throw e;
  }
}

function query(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}

module.exports = { send, method, readJson, query };