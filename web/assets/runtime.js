/* Prism  -  runtime status renderer.
 *
 * At load (and on every app re-render) this fetches real evidence and replaces
 * the hardcoded source-status surfaces:
 *   GET /api/connectors         → per-source runtime state
 *   GET /api/data/health        → Supabase live connection + counts + timestamp
 *   GET /api/classifier/summary → model status (offline code only / no runs)
 *
 * Fictional Aeris counts are tagged "synthetic scenario"; live Supabase counts
 * are shown separately. Toggles that only changed CSS/toasts are removed and
 * labelled demo-only. Anonymous viewers never receive previews or credential
 * values (the server enforces that too).
 */
(function () {
  var B = (window.TF_BADGES) || {};
  var base = (window.TF_CONFIG && window.TF_CONFIG.apiBase) || '';
  var state = { connectors: null, health: null, model: null, checked_at: null };

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clock(ts) { try { return ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ' - '; } catch (e) { return ' - '; } }
  function chip(tone, text) { return '<span class="label ' + (B.toneClass ? B.toneClass(tone) : 'label-neutral') + '" style="font-size:10px"><span class="dot"></span>' + esc(text) + '</span>'; }

  function api(path, opts) {
    return fetch(base + path, Object.assign({ headers: { accept: 'application/json' } }, opts || {}))
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }

  function load() {
    return Promise.all([
      api('/api/connectors').catch(function () { return { body: null }; }),
      api('/api/data/health').catch(function () { return { body: null }; }),
      api('/api/classifier/summary').catch(function () { return { body: null }; }),
    ]).then(function (out) {
      state.connectors = out[0].body;
      state.health = out[1].body;
      state.model = out[2].body;
      state.checked_at = (state.connectors && state.connectors.checked_at) || (state.health && state.health.checked_at) || new Date().toISOString();
      render();
      return state;
    });
  }

  /* ---------- sidebar ---------- */
  function renderSidebar() {
    var navItem = document.querySelector('.nav-item[data-view="data"]');
    var dot = $('#dataDot');
    var el = $('#dataSyncLabel');
    var h = state.health;
    var text;
    if (h && h.ok === false) text = 'Supabase connection error · ' + clock(h.checked_at);
    else if (h && h.configured) {
      var n = h.counts && h.counts.public_visible != null ? h.counts.public_visible : ' - ';
      text = 'Supabase live · checked ' + clock(h.checked_at) + ' · ' + n + ' public rows';
    } else text = 'Supabase not connected · synthetic scenario';

    if (el) el.textContent = text;
    if (navItem) { navItem.title = 'Data status  -  ' + text; navItem.setAttribute('aria-label', 'Data status  -  ' + text); }
    if (dot) dot.className = 'pulse-dot' + (h && h.ok === false ? ' warn' : '');
  }

  /* ---------- overview strip ---------- */
  function renderStrip() {
    var host = $('#runtimeStrip'); if (!host) return;
    var sb = B.supabaseBadge ? B.supabaseBadge(state.health) : { tone: 'neutral', label: 'Supabase: …' };
    var mb = B.modelBadge ? B.modelBadge(state.model) : { tone: 'neutral', label: 'Model: …' };
    var cs = B.connectorSummary ? B.connectorSummary(state.connectors) : { tone: 'neutral', label: 'Sources: …' };
    var counts = state.health && state.health.counts;
    var countLine = counts
      ? 'partitions: ' + Object.keys(counts.by_partition).map(function (k) { return k + ' ' + counts.by_partition[k]; }).join(' · ')
      : 'no live counts (server has no Supabase credentials)';
    host.innerHTML =
      '<div class="glass panel" style="margin-bottom:var(--space-md)" data-od-id="runtime-strip">' +
      '<div class="row-between" style="align-items:flex-start;gap:12px;flex-wrap:wrap">' +
      '<div><h3 style="margin:0 0 6px">Runtime evidence</h3>' +
      '<div class="row wrap" style="gap:8px">' + chip(sb.tone, sb.label) + chip(mb.tone, mb.label) + chip(cs.tone, cs.label) + '</div></div>' +
      '<span class="meta">checked ' + esc(clock(state.checked_at)) + '</span></div>' +
      '<p class="meta" style="margin:10px 0 0">' + esc(countLine) + '</p>' +
      '<p class="meta" style="margin:4px 0 0"><span class="label label-neutral" style="font-size:10px">synthetic scenario</span> The Aeris Health figures below are a fictional scenario; live Supabase counts are shown above.</p>' +
      '</div>';
  }

  /* ---------- overview data freshness ---------- */
  function renderFreshness() {
    var host = $('#freshnessList'); if (!host) return;
    var c = state.connectors;
    if (!c || !c.sources) { host.innerHTML = '<p class="meta">Connector status unavailable.</p>'; return; }
    host.innerHTML = c.sources.map(function (s) {
      var tone = s.state === 'tested_live' ? 'label-success' : s.state === 'configured_untested' ? 'label-warning' : 'label-neutral';
      return '<div class="row-between" style="padding:10px 0;border-bottom:1px solid var(--border-soft)">' +
        '<div><div style="font-size:13px;font-weight:500">' + esc(s.name) + '</div>' +
        '<div class="meta">' + esc(s.kind || '') + ' · ' + esc(s.synthetic_records || ' - ') + ' synthetic records</div></div>' +
        '<span class="label ' + tone + '" style="font-size:10px"><span class="dot"></span>' + esc(s.label) + (s.tested_at ? ' · ' + esc(clock(s.tested_at)) : '') + '</span></div>';
    }).join('') + '<p class="meta" style="margin-top:8px"><span class="label label-neutral" style="font-size:10px">synthetic scenario</span></p>';
  }

  /* ---------- integrations ---------- */
  function renderSourceGrid() {
    var host = $('#sourceGrid'); if (!host) return;
    var c = state.connectors;
    if (!c || !c.sources) { host.innerHTML = '<p class="meta">Connector status unavailable.</p>'; return; }
    host.innerHTML = c.sources.map(function (s) {
      var tone = s.state === 'tested_live' ? 'label-success' : s.state === 'configured_untested' ? 'label-warning' : 'label-neutral';
      var logo = (typeof LOGOS !== 'undefined' && LOGOS[s.id]) ? LOGOS[s.id] : '<span class="logo-mono">AS</span>';
      return '<div class="glass int-card">' +
        '<div class="ic-top"><span class="logo-tile">' + logo + '</span><div><div class="ic-name">' + esc(s.name) + '</div>' +
        '<span class="label ' + tone + '" style="font-size:10px"><span class="dot"></span>' + esc(s.label) + (s.tested_at ? ' · ' + esc(clock(s.tested_at)) : '') + '</span></div></div>' +
        '<p class="ic-desc">' + esc(s.kind || 'source') + ' · <span class="label label-neutral" style="font-size:9.5px">synthetic scenario</span> ' + esc(s.synthetic_records || ' - ') + ' records' +
        (s.requires && s.requires.length ? '<br><span class="meta">needs: ' + esc(s.requires.join(', ')) + '</span>' : '') + '</p>' +
        '<div class="ic-foot"><button type="button" class="src-link" data-test-connector="' + esc(s.id) + '">Test read (internal)</button>' +
        '<span class="meta" style="font-size:10px">credential values never returned</span></div></div>';
    }).join('');
  }

  function renderNext() {
    var host = $('#nextGrid'); if (!host) return;
    var c = state.connectors; var next = (c && c.next) || [];
    host.innerHTML = next.map(function (n) {
      return '<div class="glass int-card" style="opacity:.9"><div class="ic-top"><span class="logo-tile"><span class="logo-mono">' + esc((n.name || '?').slice(0, 2).toUpperCase()) + '</span></span>' +
        '<div><div class="ic-name">' + esc(n.name) + '</div><span class="label label-neutral" style="font-size:10px">next</span></div></div>' +
        '<p class="ic-desc">' + esc(n.reason) + '</p></div>';
    }).join('');
  }

  function paintIntegrationsHeader() {
    var el = $('#integrationsStatusChip'); if (!el) return;
    var cs = B.connectorSummary ? B.connectorSummary(state.connectors) : { tone: 'neutral', label: '…' };
    el.className = 'label ' + B.toneClass(cs.tone);
    el.innerHTML = '<span class="dot"></span>' + esc(cs.label);
  }

  /* ---------- data status popup ---------- */
  function renderDataOverrides() {
    var sb = B.supabaseBadge ? B.supabaseBadge(state.health) : null;
    var mb = B.modelBadge ? B.modelBadge(state.model) : null;

    var pchip = $('#pipelineChip');
    if (pchip && sb) { pchip.className = 'label ' + B.toneClass(sb.tone); pchip.innerHTML = '<span class="dot"></span>' + esc(sb.label); }

    var stages = $('#pipelineStages');
    if (stages) {
      var h = state.health || {};
      var counts = h.counts;
      var rows = [];
      rows.push(row('Supabase connection', h.checked_at ? 'checked ' + clock(h.checked_at) : ' - ', sb.label, h.connection === 'live'));
      if (counts) rows.push(row('Rows by partition', 'total ' + counts.total + ' · public-visible ' + counts.public_visible, Object.keys(counts.by_partition).map(function (k) { return k + ' ' + counts.by_partition[k]; }).join(' · '), true));
      rows.push(row('Classifier model', mb.label, 'no runs recorded' , false));
      var creds = state.connectors ? 'tested live ' + (state.connectors.tested_live || []).length + ' · configured ' + (state.connectors.configured_untested || []).length + ' · total ' + state.connectors.sources.length : ' - ';
      rows.push(row('Feedback sources', creds, 'synthetic demo unless tested', false));
      stages.innerHTML = rows.join('');
    }

    var list = $('#connectorList');
    if (list && state.connectors && state.connectors.sources) {
      list.innerHTML = state.connectors.sources.map(function (s) {
        var tone = s.state === 'tested_live' ? 'label-success' : s.state === 'configured_untested' ? 'label-warning' : 'label-neutral';
        return '<div class="row-between" style="padding:9px 11px;border:1px solid var(--border-soft);border-radius:10px;background:var(--glass-hi)">' +
          '<div><div style="font-size:12.5px;font-weight:500">' + esc(s.name) + '</div><div class="meta">' + esc(s.kind || '') + ' · needs: ' + esc((s.requires || []).join(', ') || ' - ') + '</div></div>' +
          '<span class="label ' + tone + '" style="font-size:10px"><span class="dot"></span>' + esc(s.label) + '</span></div>';
      }).join('');
    }

    var next = $('#nextList');
    if (next && state.connectors && state.connectors.next) {
      next.innerHTML = state.connectors.next.map(function (n) { return '<span class="label label-neutral" style="font-size:10px">' + esc(n.name) + '  -  ' + esc(n.reason) + '</span>'; }).join(' ') || '<span class="meta"> - </span>';
    }
  }

  function row(title, sub, value, ok) {
    return '<div><div class="row-between" style="font-size:12.5px;margin-bottom:5px"><span>' + esc(title) +
      ' <span class="meta">· ' + esc(sub) + '</span></span><span class="meta">' + esc(value) + '</span></div>' +
      '<div class="progress"><i style="width:' + (ok ? 100 : 0) + '%;background:' + (ok ? 'var(--success)' : 'var(--border-soft)') + '"></i></div></div>';
  }

  function render() { renderSidebar(); renderStrip(); renderFreshness(); renderSourceGrid(); renderNext(); paintIntegrationsHeader(); renderDataOverrides(); }

  /* ---------- interaction: internal "Test read" ---------- */
  function onTest(id, btn) {
    btn.disabled = true; var old = btn.textContent; btn.textContent = 'Testing…';
    api('/api/connectors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id }) })
      .then(function (r) {
        btn.disabled = false; btn.textContent = old;
        if (r.status === 401) { toast('Preview is internal-only (requires x-tf-internal).', 'info'); return; }
        if (r.body && r.body.ok) { toast('Tested live · ' + (r.body.count || 0) + ' items read', 'success'); load(); }
        else { toast('Preview failed: ' + ((r.body && (r.body.error || r.body.state)) || r.status), 'danger'); }
      })
      .catch(function () { btn.disabled = false; btn.textContent = old; toast('Preview unavailable', 'danger'); });
  }

  function toast(text, kind) { if (typeof window.toast === 'function') window.toast(text, kind); }

  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-test-connector]'); if (t) { e.preventDefault(); onTest(t.dataset.testConnector, t); }
    });
    var sync = $('#runSyncBtn');
    if (sync && !sync.dataset.rtBound) { sync.dataset.rtBound = '1'; sync.textContent = 'Refresh status'; sync.addEventListener('click', function (e) { e.preventDefault(); load().then(function () { toast('Runtime status refreshed', 'info'); }); }); }
  }

  /* Re-apply overrides whenever the app re-renders those surfaces. */
  function wrap(name) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__rtWrapped) return;
    var wrapped = function () { var r = orig.apply(this, arguments); try { render(); } catch (e) {} return r; };
    wrapped.__rtWrapped = true; window[name] = wrapped;
  }
  function wrapAll() { ['renderData', 'renderIntegrations', 'renderFreshness'].forEach(wrap); }

  function init() { bind(); wrapAll(); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('tf:data', function () { render(); });

  window.TF_RUNTIME = { refresh: load, state: state };
})();