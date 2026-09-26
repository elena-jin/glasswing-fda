/* GET /api/health — liveness probe and data-status summary. */
const { send, method } = require('./_lib/http');
const { dataset } = require('./_lib/data');

module.exports = (req, res) => {
  if (!method(req, res, ['GET'])) return;
  send(res, 200, {
    ok: true,
    service: 'test-flight-api',
    time: new Date().toISOString(),
    counts: {
      sources: dataset.sources.length,
      connectors: dataset.connectors.length,
      ideas: dataset.ideas.length,
      qualityPending: dataset.quality.length,
      pods: dataset.pods.length
    }
  });
};