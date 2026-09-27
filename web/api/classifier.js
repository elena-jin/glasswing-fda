/* Classifier API router — a single serverless function.
 *
 * The Hobby plan allows at most 12 functions per deployment, so the classifier
 * surface is served by this one file and dispatched by resource. The external
 * URLs stay clean (`/api/classifier/summary`, `/api/classifier/review`, …) via
 * a rewrite in vercel.json that maps the path segment to `?resource=`.
 *
 * Every resource checks the method it allows and the partition gate itself; this
 * router only validates the resource name (allowlist, no path traversal).
 */
const { send } = require('./_lib/http');

const HANDLERS = {
  summary: require('./_lib/classifier/summary'),
  records: require('./_lib/classifier/records'),
  record: require('./_lib/classifier/record'),
  review: require('./_lib/classifier/review'),
  candidates: require('./_lib/classifier/candidates'),
  retrain: require('./_lib/classifier/retrain'),
  schema: require('./_lib/classifier/schema'),
};

function resolveResource(req) {
  // 1) rewrite-provided query param  2) trailing path segment  3) default
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('resource');
  if (q) return q;
  const seg = url.pathname.replace(/\/+$/, '').split('/').pop();
  if (seg && seg !== 'classifier') return seg;
  return 'summary';
}

module.exports = async (req, res) => {
  const resource = resolveResource(req);
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, resource) ? HANDLERS[resource] : null;
  if (!handler) {
    return send(res, 404, { ok: false, error: 'unknown_classifier_resource', allowed: Object.keys(HANDLERS) });
  }
  return handler(req, res);
};