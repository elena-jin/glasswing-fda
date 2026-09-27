/* Test Flight — frontend runtime configuration.
 *
 * live:false  → the console renders the embedded synthetic dataset in
 *               assets/data.js. No network calls. This is the default, and it
 *               is what you see on a plain static deploy.
 * live:true   → on load the console fetches `<apiBase>/api/bootstrap` and
 *               replaces the embedded dataset with whatever the backend
 *               returns. If the request fails it silently falls back to the
 *               embedded data, so the UI never breaks.
 *
 * apiBase: leave '' when the frontend and the serverless functions in /api are
 *          deployed together on Vercel (same origin). Set an absolute URL when
 *          the backend lives elsewhere, e.g. 'https://api.yourco.com'.
 */
window.TF_CONFIG = {
  live: true,
  apiBase: '',
  requestTimeoutMs: 8000
};