/* QMS integration surface.
 *
 * GET  /api/qms            available and connected quality platforms + destinations
 *
 * POST /api/qms            export approved complaint packets to the QMS
 *       body: { records: [ "<record id>", ... ], provider: "veeva" }
 *
 * The export is a MOCK. Nothing is written to Veeva or any other system — the
 * response only reports the packet it would have sent. To go live, perform the
 * real API call with the provider credentials in the environment and keep the
 * human-approval gate in front of it. Never auto-file a complaint.
 */
const { send, method, readJson } = require('./_lib/http');
const { dataset } = require('./_lib/data');

const PROVIDERS = {
  veeva: { name: 'Veeva Vault Quality', object: 'complaint__v', mode: 'sandbox' },
  mastercontrol: { name: 'MasterControl', object: 'QualityEvent', mode: 'not_connected' },
  greenlight: { name: 'Greenlight Guru', object: 'Complaint', mode: 'not_connected' },
  trackwise: { name: 'TrackWise', object: 'ComplaintRecord', mode: 'not_connected' },
  compliancequest: { name: 'ComplianceQuest', object: 'Complaint__c', mode: 'not_connected' }
};

async function handlePost(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return send(res, err.statusCode || 400, { ok: false, error: 'invalid_json' });
  }
  const ids = Array.isArray(body.records) ? body.records : [];
  if (!ids.length) return send(res, 400, { ok: false, error: 'no_records' });

  const provider = PROVIDERS[body.provider] || PROVIDERS.veeva;
  const packets = ids.map((id) => ({
    packetId: 'PKT-' + String(id).replace(/[^A-Za-z0-9]/g, '-'),
    localRecord: id,
    object: provider.object,
    status: 'export_mock',
    humanApproved: true
  }));

  send(res, 202, {
    ok: true,
    provider: provider.name,
    environment: provider.mode,
    exported: packets.length,
    packets,
    note: 'Mock export. No QMS received this data. Configure credentials and call the provider API to go live.'
  });
}

module.exports = async (req, res) => {
  if (req.method === 'POST') return handlePost(req, res);
  if (!method(req, res, ['GET', 'POST'])) return;
  send(res, 200, {
    ok: true,
    providers: dataset.qms,
    destinations: dataset.dests,
    techStack: dataset.tech,
    mode: 'mock'
  });
};