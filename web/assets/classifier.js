/* Prism  -  classifier panel (Data status popup).
 *
 * Renders into the Classifier section of the Data status modal opened by
 * assets/app.js `renderData()` (which calls `window.renderClassifierPanel`).
 *
 * It talks only to the serverless endpoints under /api/classifier/*. The
 * service-role key never reaches this file; the public viewer only ever
 * receives the synthetic partition because filtering happens server-side.
 *
 * Honest states: when a table is empty or a call fails, the panel says so. It
 * never shows a metric it did not get from a real run.
 */
(function () {
  var base = (window.TF_CONFIG && window.TF_CONFIG.apiBase) || '';
  var state = { summary: null, records: [], audience: 'public' };

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(v) { return v == null ? ' - ' : (v * 100).toFixed(1) + '%'; }
  function num(v) { return v == null ? ' - ' : String(v); }
  function when(ts) { return ts ? new Date(ts).toLocaleString() : ' - '; }

  function partitionBadge(p) {
    var cls = /maude/.test(p) ? 'label-danger' : /real/.test(p) ? 'label-warning' : 'label-success';
    return '<span class="label ' + cls + '" style="font-size:10px">' + esc(p || 'unknown') + '</span>';
  }

  function api(path, opts) {
    return fetch(base + path, Object.assign({ headers: { accept: 'application/json' } }, opts || {}))
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); });
  }

  /* ---------- summary / metrics ---------- */
  function metricCard(run) {
    var head = '<div class="row-between"><span><b class="mono">' + esc(run.modelVersion || 'unversioned') + '</b> ' +
      '<span class="label ' + (run.offline ? 'label-neutral' : 'label-success') + '" style="font-size:10px">' +
      (run.offline ? 'offline' : 'live') + '</span> ' +
      '<span class="label label-outline" style="font-size:10px">' + esc(run.status) + '</span></span>' +
      '<span class="meta">' + esc(run.evalSplit || 'no eval split') + (run.threshold != null ? ' · thr ' + run.threshold : '') + '</span></div>';

    if (run.empty) {
      return '<div class="card" style="background:var(--surface-warm)">' + head +
        '<p class="meta" style="margin:8px 0 0">No metrics  -  ' + esc(run.reason || 'empty') + '. Metrics appear only for runs with predictions and labels.</p></div>';
    }

    var cm = run.confusion || {};
    var m = run.metrics || {};
    var cmHtml = '<div class="row wrap" style="gap:6px;margin:8px 0">' +
      '<span class="label label-success">TP ' + num(cm.tp) + '</span>' +
      '<span class="label label-danger">FP ' + num(cm.fp) + '</span>' +
      '<span class="label label-outline">TN ' + num(cm.tn) + '</span>' +
      '<span class="label label-warning">FN ' + num(cm.fn) + '</span>' +
      (cm.excluded ? '<span class="label label-neutral">excluded ' + num(cm.excluded) + '</span>' : '') +
      '</div>';
    var mHtml = '<div class="row wrap" style="gap:12px">' +
      '<span class="meta">recall <b>' + pct(m.recall) + '</b></span>' +
      '<span class="meta">specificity <b>' + pct(m.specificity) + '</b></span>' +
      '<span class="meta">precision <b>' + pct(m.precision) + '</b></span>' +
      '<span class="meta">FN <b>' + num(m.falseNegatives) + '</b></span>' +
      '<span class="meta">n <b>' + num(run.n) + '</b></span></div>' +
      (run.recallOnly ? '<p class="meta" style="margin:6px 0 0">Positive-only partition: recall only, no specificity.</p>' : '');
    var splitHtml = run.perSplit ? Object.keys(run.perSplit).map(function (s) {
      var b = run.perSplit[s];
      return '<span class="label label-neutral" style="font-size:10px">' + esc(s) + ' · n ' + b.n + ' · recall ' + pct(b.metrics.recall) + '</span>';
    }).join(' ') : '';

    return '<div class="card" style="background:var(--surface-warm)">' + head + cmHtml + mHtml +
      (splitHtml ? '<div class="row wrap" style="gap:6px;margin-top:8px">' + splitHtml + '</div>' : '') +
      '<p class="meta" style="margin:8px 0 0">provenance: ' + esc(run.provenance || 'computed from run predictions') + '</p></div>';
  }

  function renderMetrics() {
    var host = $('#clfMetrics'); if (!host) return;
    var s = state.summary;
    if (!s) { host.innerHTML = '<p class="meta">Loading classifier metrics…</p>'; return; }
    if (s.ok === false) {
      host.innerHTML = '<div class="card" style="background:var(--surface-warm)"><p class="meta">' +
        esc(s.note || s.error || 'Classifier backend unavailable.') + '</p></div>';
      return;
    }
    var retrainBtn = state.audience === 'internal'
      ? '<button class="btn btn-secondary btn-sm" id="clfRetrain" type="button">Request controlled retraining</button>'
      : '';
    if (s.empty) {
      host.innerHTML = '<div class="card" style="background:var(--surface-warm)"><p class="meta">' +
        esc(s.note || 'No classifier runs exist yet.') + '</p>' +
        (retrainBtn ? '<div style="margin-top:8px">' + retrainBtn + '</div>' : '') + '</div>';
      return;
    }
    host.innerHTML = s.runs.map(metricCard).join('') + retrainBtn;
  }

  /* ---------- records ---------- */
  function recRow(r) {
    var p = r.prediction || {};
    var ref = r.reference || {};
    var status = (r.humanStatus) || 'unreviewed';
    return '<button type="button" class="card" data-rec="' + esc(r.id) + '" style="text-align:left;background:var(--surface-warm);cursor:pointer">' +
      '<div class="row-between"><span class="mono" style="font-size:11px">' + esc(r.case_id || r.id.slice(0, 8)) + '</span>' +
      '<span class="row" style="gap:6px">' + partitionBadge(r.partition) +
      '<span class="label label-outline" style="font-size:10px">' + esc(r.split || ' - ') + '</span></span></div>' +
      '<div style="font-size:12.5px;margin:6px 0">' + esc((r.text || '').slice(0, 160)) + '</div>' +
      '<div class="row wrap" style="gap:8px">' +
      '<span class="meta">ref <b>' + esc(ref.label || ' - ') + '</b></span>' +
      '<span class="meta">pred <b>' + esc(p.predicted_label || ' - ') + '</b>' + (p.confidence != null ? ' @ ' + Number(p.confidence).toFixed(2) : '') + '</span>' +
      '<span class="meta">route <b>' + esc(p.route || ' - ') + '</b></span>' +
      '<span class="meta">human <b>' + esc(status) + '</b></span></div></button>';
  }

  function renderRecords() {
    var host = $('#clfRecords'); if (!host) return;
    var cnt = $('#clfCount'); if (cnt) cnt.textContent = (state.records.length || 0) + ' record' + (state.records.length === 1 ? '' : 's');
    if (!state.records.length) {
      host.innerHTML = '<p class="meta">No records visible to this audience. The public demo shows the synthetic partition only.</p>';
      return;
    }
    host.innerHTML = state.records.map(recRow).join('');
  }

  /* ---------- record detail + review ---------- */
  function renderDetail(d) {
    var host = $('#clfDetail'); if (!host) return;
    if (!d) { host.innerHTML = ''; return; }
    var r = d.record || {};
    var p = (d.predictions && d.predictions[0]) || {};
    var ref = d.reference || {};
    var cand = (d.candidates && d.candidates[0]) || {};
    var canWrite = state.audience === 'internal';
    host.innerHTML =
      '<div class="card" style="background:var(--bg-soft,#f7f9fc)">' +
      '<div class="row-between"><b class="mono">' + esc(r.id) + '</b><span class="row" style="gap:6px">' + partitionBadge(r.partition) + '<span class="label ' + (r.synthetic ? 'label-success' : 'label-warning') + '" style="font-size:10px">' + (r.synthetic ? 'synthetic' : 'non-synthetic') + '</span></span></div>' +
      '<div style="font-size:12.5px;margin:8px 0">' + esc(r.text || '') + '</div>' +
      '<div class="row wrap" style="gap:8px;margin-bottom:8px">' +
      '<span class="meta">source <b>' + esc(r.source_type || ' - ') + '</b></span>' +
      '<span class="meta">product <b>' + esc(r.product || ' - ') + '</b></span>' +
      '<span class="meta">ref <b>' + esc(ref.label || ' - ') + '</b></span>' +
      '<span class="meta">pred <b>' + esc(p.predicted_label || ' - ') + '</b> @ ' + (p.confidence != null ? Number(p.confidence).toFixed(2) : ' - ') + '</span>' +
      '<span class="meta">run <b class="mono">' + esc(String(p.run_id || ' - ')).slice(0, 8) + '</b></span></div>' +
      (canWrite
        ? '<div class="row" style="gap:6px;flex-wrap:wrap">' +
            '<select id="clfDecision" class="input" style="max-width:150px"><option value="agree">Agree with model</option><option value="override">Override</option></select>' +
            '<select id="clfCorrected" class="input" style="max-width:180px"><option value="">(corrected label)</option><option value="complaint">complaint</option><option value="product_feedback">product_feedback</option><option value="excluded">excluded</option></select>' +
            '<input id="clfReason" class="input" placeholder="reason (audited)" style="flex:1;min-width:160px" />' +
            '<label class="meta row" style="gap:5px"><input type="checkbox" id="clfMakeCand" /> propose training candidate</label>' +
            '<button class="btn btn-primary btn-sm" id="clfSaveReview" type="button">Save review</button>' +
          '</div>'
        : '<p class="meta">Review actions require an authenticated internal reviewer. Sign in through the internal console to approve, override or propose training candidates.</p>') +
      '<p class="meta" style="margin:8px 0 0">Human status: <b>' + esc(d.humanStatus || 'unreviewed') + '</b>' +
      (cand.id && canWrite ? ' · candidate ' + esc(cand.candidate_status || 'pending') + ' <button class="btn btn-ghost btn-sm" data-cand="' + esc(cand.id) + '" data-cand-action="approve">Approve</button> <button class="btn btn-ghost btn-sm" data-cand="' + esc(cand.id) + '" data-cand-action="revoke">Revoke</button>' : '') +
      '</p></div>' +
      (d.reviews && d.reviews.length ? '<div class="stack" style="gap:4px">' + d.reviews.map(function (rv) {
        return '<p class="meta">' + esc(when(rv.decision_at || rv.created_at)) + ' · ' + esc(rv.reviewer_id || ' - ') + ' · ' + esc(rv.final_label || '') + ' → ' + esc(rv.final_route || '') + (rv.override_reason ? ' · ' + esc(rv.override_reason) : '') + '</p>';
      }).join('') + '</div>' : '');
  }

  function loadRecord(id, reviewer) {
    return api('/api/classifier/record?id=' + encodeURIComponent(id)).then(function (r) {
      if (!r.body || !r.body.data) { setStatus('Record unavailable: ' + ((r.body && r.body.error) || r.status)); return; }
      renderDetail(r.body.data);
      var form = $('#clfDetail');
      form.addEventListener('click', function (e) {
        var save = e.target.closest('#clfSaveReview');
        if (save) saveReview(id, reviewer);
        var cand = e.target.closest('[data-cand]');
        if (cand) candidateAction(cand.dataset.cand, cand.dataset.candAction, reviewer);
      });
    });
  }

  function saveReview(id, reviewer) {
    var decision = ($('#clfDecision') || {}).value || 'agree';
    var corrected = ($('#clfCorrected') || {}).value || null;
    var reason = ($('#clfReason') || {}).value || null;
    var makeCand = ($('#clfMakeCand') || {}).checked || false;
    api('/api/classifier/review', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ record_id: id, decision: decision, corrected_label: corrected, reason: reason, create_candidate: makeCand }),
    }).then(function (r) {
      setStatus(r.body && r.body.ok ? 'Review saved (audit logged).' : (r.status === 401 ? 'Review requires an authenticated internal reviewer.' : 'Review failed: ' + ((r.body && r.body.error) || r.status)));
      loadRecord(id, reviewer);
    });
  }

  function candidateAction(id, action, reviewer) {
    api('/api/classifier/candidates', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: id, action: action, reason: 'panel action' }),
    }).then(function (r) {
      setStatus(r.body && r.body.ok ? 'Candidate ' + action + 'd.' : (r.status === 401 ? 'Requires an authenticated internal reviewer.' : 'Blocked: ' + ((r.body && (r.body.error || r.body.note)) || r.status)));
      if (state.selected) loadRecord(state.selected, reviewer);
    });
  }

  function retrain(reviewer) {
    var evalSplit = (state.summary && state.summary.runs && state.summary.runs[0] && state.summary.runs[0].evalSplit) || 'held_out_eval';
    api('/api/classifier/retrain', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataset_version: null, reason: 'panel request' }),
    }).then(function (r) {
      setStatus(r.body && r.body.ok ? 'Retraining request queued. A server-side worker is required; promotion stays manual.' : (r.status === 401 ? 'Requires an authenticated internal reviewer.' : 'Retrain request failed: ' + ((r.body && r.body.error) || r.status)));
    });
  }

  function setStatus(msg) { var s = $('#clfStatus'); if (s) s.textContent = msg; }

  function reviewerName() { return (window.KHIZAR_REVIEWER || 'khizar.kashif@aeris.demo'); }

  function load() {
    var audEl = $('#clfAudience');
    renderMetrics();
    return Promise.all([
      api('/api/classifier/summary'),
      api('/api/classifier/records?limit=25'),
    ]).then(function (out) {
      state.summary = out[0].body;
      state.audience = (out[0].body && out[0].body.audience) || 'public';
      state.records = (out[1].body && out[1].body.data) || [];
      if (audEl) audEl.innerHTML = '<span class="dot"></span>' + state.audience;
      renderMetrics();
      renderRecords();
      var note = state.summary && state.summary.note ? state.summary.note : 'Loaded from /api/classifier. Public audience sees the synthetic partition only.';
      setStatus(note);
    }).catch(function () {
      state.summary = { ok: false, note: 'Classifier backend unreachable.' };
      renderMetrics();
      renderRecords();
      setStatus('Classifier backend unreachable.');
    });
  }

  function bind() {
    var grid = $('#clfRecords');
    if (grid && !grid.dataset.bound) {
      grid.dataset.bound = '1';
      grid.addEventListener('click', function (e) {
        var b = e.target.closest('[data-rec]'); if (!b) return;
        state.selected = b.dataset.rec;
        loadRecord(state.selected, reviewerName());
      });
    }
    var refresh = $('#clfRefresh');
    if (refresh && !refresh.dataset.bound) { refresh.dataset.bound = '1'; refresh.addEventListener('click', load); }
    var metrics = $('#clfMetrics');
    if (metrics && !metrics.dataset.bound) {
      metrics.dataset.bound = '1';
      metrics.addEventListener('click', function (e) { if (e.target.closest('#clfRetrain')) retrain(reviewerName()); });
    }
  }

  window.renderClassifierPanel = function () { bind(); return load(); };
})();