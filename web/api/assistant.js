/* POST /api/assistant
 *   body: { message: string, scope: "product" | "quality" }
 *
 * Deterministic, retrieval-style stub that mirrors the frontend's demo replies
 * so the API and the UI stay consistent. The scope gate is the important part:
 * quality/compliance questions asked while scope is "product" are refused and
 * pointed at the scope toggle; only the "+ Quality" scope returns MDR and
 * complaint-candidate answers.
 *
 * Replace the body with a real grounded retrieval call (Claude or another
 * model) over the schema v1.1 records. Keep the citation array — the UI
 * renders it, and the brief requires that every claim be traceable.
 */
const { send, method, readJson } = require('./_lib/http');

const REPLIES = {
  owner: {
    text: 'Two ideas still have unverified owners: “Clinician PDF export” (proposed: M. Adeyemi) and “BLE pairing reliability” (proposed: J. Ferreira). Both need a human confirmation before they count as owned.',
    cites: ['CLIN-770', 'MOB-1980']
  },
  false: {
    text: 'The false-alarm cluster spans 31 reports across email, App Store and Zendesk over 11 days, all inside the 00:00–05:00 window. It is linked to CARD-1108 (In Progress) and carries a clinical-risk-without-known-harm flag.',
    cites: ['email-5043', 'CARD-1108', 'FTA-2026-0402']
  },
  mdr: {
    text: 'Two MDR candidates report actual or potential harm: CP-2208 (missed alarm during an episode — patient_harm_reported) and CP-2196 (field-corrective lot 409-TX). CP-2214 is a third, lower-confidence candidate with implied risk only.',
    cites: ['CP-2208', 'CP-2196', 'CP-2214']
  },
  outOfScope: {
    text: 'That lives in the quality &amp; compliance lane, which is outside the current scope. Flip the scope toggle to “+ Quality” and I’ll pull complaint candidates, potential MDR flags and the FTA rationale with citations.',
    cites: ['scope: product feedback']
  },
  default: {
    text: 'Here’s what I found across the demo dataset. The strongest signal is the sync-reliability cluster: 66 reports total across CPAP-2214 and MOB-2015, both in the current sprint, with two enterprise accounts ($340k ARR) behind them.',
    cites: ['CPAP-2214', 'MOB-2015', 'Zendesk #48219']
  }
};

module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return send(res, err.statusCode || 400, { ok: false, error: 'invalid_json' });
  }

  const message = String(body.message || '');
  if (!message.trim()) return send(res, 400, { ok: false, error: 'empty_message' });

  const scope = body.scope === 'quality' ? 'quality' : 'product';
  const low = message.toLowerCase();
  const qualityTopic = /mdr|harm|complaint|quality|compliance/.test(low);

  let reply;
  if (qualityTopic && scope === 'product') {
    reply = REPLIES.outOfScope;
  } else if (low.includes('owner')) {
    reply = REPLIES.owner;
  } else if (low.includes('false') || low.includes('alarm')) {
    reply = REPLIES.false;
  } else if (low.includes('mdr') || low.includes('harm')) {
    reply = REPLIES.mdr;
  } else {
    reply = REPLIES.default;
  }

  send(res, 200, { ok: true, scope, reply });
};