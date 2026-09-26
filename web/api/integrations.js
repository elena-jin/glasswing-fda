/* GET /api/integrations
 *
 * Everything the Integrations and Data-status surfaces need: the quality
 * platforms (QMS), the downstream destinations (Jira / CRM / support), the
 * connected tech stack, and the intake pipeline health.
 */
const { send, method } = require('./_lib/http');
const { dataset } = require('./_lib/data');

module.exports = (req, res) => {
  if (!method(req, res, ['GET'])) return;
  send(res, 200, {
    ok: true,
    qms: dataset.qms,
    destinations: dataset.dests,
    techStack: dataset.tech,
    connectors: dataset.connectors,
    pipeline: dataset.pipeline
  });
};