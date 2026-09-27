/* Test Flight — backend hydration adapter.
 *
 * Loaded after assets/app.js. It does nothing at all unless
 * window.TF_CONFIG.live is true (see assets/tf.config.js).
 *
 * When live mode is on it fetches the aggregate dataset from
 * `GET <apiBase>/api/bootstrap`, hands it to TF_DATA.apply(), and re-runs the
 * app's render functions so every view reflects the live data. On any failure
 * it leaves the embedded demo dataset in place.
 */
(function () {
  var RENDER = [
    'renderSources', 'renderThemes', 'renderStream', 'renderFreshness',
    'renderIdeas', 'renderRoadmap', 'renderPods', 'renderIntegrations',
    'renderData', 'renderQms', 'renderQualityTable', 'renderDecisionLog'
  ];

  function rerender() {
    RENDER.forEach(function (name) {
      if (typeof window[name] === 'function') {
        try { window[name](); } catch (e) { /* keep the rest rendering */ }
      }
    });
    try { if (typeof window.renderAnalytics === 'function') window.renderAnalytics(); } catch (e) {}
    var view = 'overview';
    try { view = JSON.parse(localStorage.getItem('tf.view') || '"overview"'); } catch (e) {}
    if (typeof window.go === 'function') window.go(view);
  }

  function boot() {
    var cfg = window.TF_CONFIG || {};
    if (!cfg.live) return;

    var base = cfg.apiBase || '';
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller && cfg.requestTimeoutMs
      ? setTimeout(function () { controller.abort(); }, cfg.requestTimeoutMs)
      : null;

    fetch(base + '/api/bootstrap', {
      headers: { accept: 'application/json' },
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (payload) {
        var data = payload && payload.data ? payload.data : payload;
        if (!data || !window.TF_DATA) return;
        window.TF_DATA.apply(data);
        rerender();
        window.dispatchEvent(new CustomEvent('tf:data', { detail: { source: 'api' } }));
      })
      .catch(function () {
        window.dispatchEvent(new CustomEvent('tf:data', { detail: { source: 'demo', fallback: true } }));
      })
      .then(function () { if (timer) clearTimeout(timer); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();