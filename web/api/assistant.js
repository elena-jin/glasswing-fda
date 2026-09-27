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
    text: 'Three ideas still have unverified owners: “Clinician PDF export” (proposed: M. Adeyemi), “Home-screen widget for the AHI score” (proposed: J. Ferreira) and “Contrast and type tokens for therapy charts” (Design System pod). Each needs a human confirmation before it counts as owned.',
    cites: ['CLIN-770', 'APP-2260', 'DS-0442']
  },
  false: {
    text: 'The false-alarm cluster spans 41 reports across email, App Store and Zendesk over 11 days, all inside the 00:00–05:00 window. It is linked to SAFE-1108 (In Progress) and carries a clinical-risk-without-known-harm flag.',
    cites: ['email-5043', 'SAFE-1108', 'FTA-2026-0402']
  },
  mdr: {
    text: 'MDR candidates report actual or potential harm: CP-2208 (missed alarm during an apnea event — patient_harm_reported), CP-2185 (overnight power-off with reported harm) and CP-2196 (field-corrective humidifier lot 409-TX). CP-2214 and CP-2191 are lower-confidence candidates with implied clinical risk only.',
    cites: ['CP-2208', 'CP-2185', 'CP-2196', 'CP-2214']
  },
  outOfScope: {
    text: 'That lives in the quality &amp; compliance lane, which is outside the current scope. Flip the scope toggle to “+ Quality” and I’ll pull complaint candidates, potential MDR flags and the FTA rationale with citations.',
    cites: ['scope: product feedback']
  },
  default: {
    text: 'Here’s what I found across the demo dataset. The strongest signal is the sync-reliability cluster: 68 reports total across APP-2214 and APP-2015, both in the current sprint, with two enterprise clinic accounts ($340k ARR) behind them.',
    cites: ['APP-2214', 'APP-2015', 'Zendesk #48219']
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

  // Optional: proxy to the real retrieval backend (repo `assistant/`) when
  // configured. Falls back to the deterministic replies below if it is down.
  if (process.env.ASSISTANT_API_URL) {
    try {
      const r = await fetch(process.env.ASSISTANT_API_URL.replace(/\/$/, '') + '/assistant/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(process.env.ASSISTANT_API_KEY ? { authorization: 'Bearer ' + process.env.ASSISTANT_API_KEY } : {}) },
        body: JSON.stringify({ message, scope })
      });
      if (r.ok) {
        const j = await r.json();
        if (j && j.reply) return send(res, 200, { ok: true, scope, source: 'assistant_backend', reply: j.reply });
      }
    } catch (err) {
      // fall through to deterministic replies
    }
  }

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