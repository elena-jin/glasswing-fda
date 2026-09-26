/* GET /api/bootstrap
 *
 * Returns the full dataset the frontend needs to render every view in one
 * request. The response `data` object shares the exact keys the frontend's
 * TF_DATA.apply() understands, so pointing assets/tf.config.js at this API is
 * the only step needed to switch the console to live data.
 */
const { send, method } = require('./_lib/http');
const { dataset, meta } = require('./_lib/data');

module.exports = (req, res) => {
  if (!method(req, res, ['GET'])) return;
  send(res, 200, { ok: true, meta, data: dataset });
};