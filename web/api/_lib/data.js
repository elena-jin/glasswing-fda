/* Single source of truth for the seed dataset used by the serverless API.
 *
 * This is the same synthetic dataset the frontend ships in
 * assets/data.js, read from data/dataset.json so there is exactly one copy.
 *
 * Replace this with real reads (a database, the normalization service, or
 * David's classifier output) and every endpoint below starts serving live
 * data without any frontend change. Keep the response shape identical to the
 * keys in data/dataset.json so `TF_DATA.apply()` can consume it unchanged.
 */
const dataset = require('../../data/dataset.json');

module.exports = {
  dataset,
  meta: { schemaVersion: '1.1', synthetic: true, generatedFor: 'test-flight-demo' }
};