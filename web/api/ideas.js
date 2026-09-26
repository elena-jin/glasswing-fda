/* GET /api/ideas
 *   ?pod=<pod name>       filter to a single pod
 *   ?ageDays=<n>          only ideas seen within the last n days
 *   ?sort=demand|priority|recent
 *   ?id=<idea id>         return a single idea (with its Jira + evidence)
 *
 * Ideas are the product-stage output: a cluster of cross-source feedback with
 * a confirmed owner and a Jira ticket. In production this reads from the theme
 * model + Jira sync rather than the seed file.
 */
const { send, method, query } = require('./_lib/http');
const { dataset } = require('./_lib/data');

const ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

module.exports = (req, res) => {
  if (!method(req, res, ['GET'])) return;
  const q = query(req);

  if (q.get('id')) {
    const idea = dataset.ideas.find((i) => i.id === q.get('id'));
    if (!idea) return send(res, 404, { ok: false, error: 'idea_not_found', id: q.get('id') });
    return send(res, 200, { ok: true, data: idea });
  }

  let ideas = dataset.ideas.slice();
  const pod = q.get('pod');
  const age = parseInt(q.get('ageDays') || '0', 10);
  if (pod) ideas = ideas.filter((i) => i.pod === pod);
  if (age) ideas = ideas.filter((i) => i.ageDays <= age);

  const sort = q.get('sort') || 'demand';
  if (sort === 'demand') ideas.sort((a, b) => b.reports - a.reports);
  if (sort === 'priority') ideas.sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
  if (sort === 'recent') ideas.sort((a, b) => a.ageDays - b.ageDays);

  send(res, 200, { ok: true, count: ideas.length, sort, pod: pod || null, data: ideas });
};