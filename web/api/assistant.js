/* POST /api/assistant
 *   body: { message: string, scope: "product" | "quality" }
 *   →    { ok, scope, reply: { text, cites } }   (unchanged UI contract)
 *
 * Server-side grounded chat. Retrieval reads ONLY synthetic records in the
 * public partitions (train/validation/demo) joined by text id to
 * tf_normalized_records and tf_reference_labels. locked_eval, maude_stress and
 * the app-review holdout are never fetched here. There is NO canned fallback:
 * when the DB or the provider is unavailable the response is an honest
 * unavailable state.
 *
 * The model provider is disabled until CHAT_PROVIDER/CHAT_MODEL/CHAT_API_KEY are
 * set (see docs/grounded-assistant.md). The service-role key never leaves the
 * server.
 */
const { send, method, readJson } = require('./_lib/http');
const { answer } = require('./_lib/chat/grounded');

module.exports = async (req, res) => {
  if (!method(req, res, ['POST'])) return;

  let body;
  try { body = await readJson(req); }
  catch (err) { return send(res, err.statusCode || 400, { ok: false, error: 'invalid_json', reply: { text: 'Invalid request.', cites: [] } }); }

  const scope = body.scope === 'quality' ? 'quality' : 'product';
  const result = await answer({ message: body.message, scope, req });
  return send(res, result.status, result.body);
};