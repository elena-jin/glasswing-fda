/* Quality review queue.
 *
 * GET  /api/quality            pending complaint candidates awaiting a human decision
 *       ?ageDays=<n>           only items seen within the last n days
 *       ?id=<record id>        a single candidate with its FTA rationale
 *
 * POST /api/quality            log a reviewer decision
 *       body: { id, action: "approve" | "deny" | "skip", reviewer, reason }
 *
 * IMPORTANT: this demo is stateless — a decision is echoed back but not
 * persisted, and it never writes to a QMS. Wire a database here, then forward
 * approved packets to /api/qms (see docs/api-contract.md). A "complaint" is
 * only ever a candidate for human Quality review; no automated MDR or legal
 * determination is made anywhere in this system.
 */
const { send, method, query, readJson } = require('./_lib/http');
const { dataset } = require('./_lib/data');

const ACTIONS = ['approve', 'deny', 'skip'];

async function handlePost(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return send(res, err.statusCode || 400, { ok: false, error: 'invalid_json' });
  }
  const action = body.action;
  if (!body.id || ACTIONS.indexOf(action) === -1) {
    return send(res, 400, { ok: false, error: 'invalid_decision', allowedActions: ACTIONS });
  }
  const item = dataset.quality.find((r) => r.id === body.id) || null;
  const decision = {
    id: body.id,
    action,
    reviewer: body.reviewer || 'demo.reviewer',
    reason: body.reason || null,
    decidedAt: new Date().toISOString(),
    record: item ? item.record : null,
    route: action === 'approve' ? 'qms_queue' : action === 'deny' ? 'product_feedback' : 'pending'
  };
  send(res, 202, {
    ok: true,
    decision,
    persisted: false,
    note: 'Stateless demo. Persist decisions and forward approved packets to /api/qms.'
  });
}

module.exports = async (req, res) => {
  if (req.method === 'POST') return handlePost(req, res);
  if (!method(req, res, ['GET', 'POST'])) return;

  const q = query(req);
  if (q.get('id')) {
    const item = dataset.quality.find((r) => r.id === q.get('id'));
    if (!item) return send(res, 404, { ok: false, error: 'record_not_found', id: q.get('id') });
    return send(res, 200, { ok: true, data: item });
  }

  let items = dataset.quality.slice();
  const age = parseInt(q.get('ageDays') || '0', 10);
  if (age) items = items.filter((r) => r.ageDays <= age);
  items.sort((a, b) => b.confidence - a.confidence);

  send(res, 200, {
    ok: true,
    count: items.length,
    potentialMdr: items.filter((r) => r.mdr).length,
    data: items
  });
};