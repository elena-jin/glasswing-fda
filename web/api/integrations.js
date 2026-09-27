/* GET /api/integrations
 *
 * Everything the Integrations and Data-status surfaces need: the quality
 * platforms (QMS), the downstream destinations (Jira / CRM / support), the
 * connected tech stack, and the intake pipeline health.
 */
const { send, method } = require('./_lib/http');
const { dataset } = require('./_lib/data');
const connectors = require('./_lib/connectors');

module.exports = (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const connectorList = dataset.connectors.map((c) => {
    const m = connectors.credentials(c.id);
    return { ...c, configured: m.configured, auth: m.auth, env: m.env, mode: m.configured ? 'live' : 'synthetic' };
  });
  send(res, 200, {
    ok: true,
    qms: dataset.qms,
    destinations: dataset.dests,
    techStack: dataset.tech,
    connectors: connectorList,
    liveConnectors: connectorList.filter((c) => c.mode === 'live').map((c) => c.id),
    pipeline: dataset.pipeline
  });
};