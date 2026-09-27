/* Test Flight — Quality & Product Console
 * Application logic. Requires assets/data.js to be loaded first (declares
 * SOURCES, SOURCE_FEED, SPLIT, TREND, IDEAS, PODS, QUALITY, PIPELINE,
 * CONNECTORS, TECH, ROADMAP, SHIPPED, QMS, DESTS on window).
 * Derived from the single-file design prototype; behaviour is unchanged. */
/* ================= helpers ================= */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const fmt = n => n.toLocaleString('en-US');
const store = {
  get(k, d) { try { const v = localStorage.getItem('tf.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tf.' + k, JSON.stringify(v)); } catch (e) {} }
};

/* ================= real brand marks (Simple Icons, CC0) ================= */
const LOGOS = {
  salesforce: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.006 5.415a4.195 4.195 0 013.045-1.306c1.56 0 2.954.9 3.69 2.205.63-.3 1.35-.45 2.1-.45 2.85 0 5.159 2.34 5.159 5.22s-2.31 5.22-5.176 5.22c-.345 0-.69-.044-1.02-.104a3.75 3.75 0 01-3.3 1.95c-.6 0-1.155-.15-1.65-.375A4.314 4.314 0 018.88 20.4a4.302 4.302 0 01-4.05-2.82c-.27.062-.54.076-.825.076-2.204 0-4.005-1.8-4.005-4.05 0-1.5.811-2.805 2.01-3.51-.255-.57-.39-1.2-.39-1.846 0-2.58 2.1-4.65 4.65-4.65 1.53 0 2.85.705 3.72 1.8"/></svg>',
  zendesk: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.914 2.904V16.29L24 2.905H12.914zM0 2.906C0 5.966 2.483 8.45 5.543 8.45s5.542-2.484 5.543-5.544H0zm11.086 4.807L0 21.096h11.086V7.713zm7.37 7.84c-3.063 0-5.542 2.48-5.542 5.543H24c0-3.06-2.48-5.543-5.543-5.543z"/></svg>',
  slack: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>',
  zoom: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.033 14.649H.743a.74.74 0 0 1-.686-.458.74.74 0 0 1 .16-.808L3.19 10.41H1.06A1.06 1.06 0 0 1 0 9.35h3.957c.301 0 .57.18.686.458a.74.74 0 0 1-.161.808L1.51 13.59h2.464c.585 0 1.06.475 1.06 1.06zM24 11.338c0-1.14-.927-2.066-2.066-2.066-.61 0-1.158.265-1.537.686a2.061 2.061 0 0 0-1.536-.686c-1.14 0-2.066.926-2.066 2.066v3.311a1.06 1.06 0 0 0 1.06-1.06v-2.251a1.004 1.004 0 0 1 2.013 0v2.251c0 .586.474 1.06 1.06 1.06v-3.311a1.004 1.004 0 0 1 2.012 0v2.251c0 .586.475 1.06 1.06 1.06zM16.265 12a2.728 2.728 0 1 1-5.457 0 2.728 2.728 0 0 1 5.457 0zm-1.06 0a1.669 1.669 0 1 0-3.338 0 1.669 1.669 0 0 0 3.338 0zm-4.82 0a2.728 2.728 0 1 1-5.458 0 2.728 2.728 0 0 1 5.457 0zm-1.06 0a1.669 1.669 0 1 0-3.338 0 1.669 1.669 0 0 0 3.338 0z"/></svg>',
  jira: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z"/></svg>',
  google: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg>',
  gmail: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>',
  intercom: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 0H3C1.343 0 0 1.343 0 3v18c0 1.658 1.343 3 3 3h18c1.658 0 3-1.342 3-3V3c0-1.657-1.342-3-3-3zm-5.801 4.399c0-.44.36-.8.802-.8.44 0 .8.36.8.8v10.688c0 .442-.36.801-.8.801-.443 0-.802-.359-.802-.801V4.399zM11.2 3.994c0-.44.357-.799.8-.799s.8.359.8.799v11.602c0 .44-.357.8-.8.8s-.8-.36-.8-.8V3.994zm-4 .405c0-.44.359-.8.799-.8.443 0 .802.36.802.8v10.688c0 .442-.36.801-.802.801-.44 0-.799-.359-.799-.801V4.399zM3.199 6c0-.442.36-.8.802-.8.44 0 .799.358.799.8v7.195c0 .441-.359.8-.799.8-.443 0-.802-.36-.802-.8V6zM20.52 18.202c-.123.105-3.086 2.593-8.52 2.593-5.433 0-8.397-2.486-8.521-2.593-.335-.288-.375-.792-.086-1.128.285-.334.79-.375 1.125-.09.047.041 2.693 2.211 7.481 2.211 4.848 0 7.456-2.186 7.479-2.207.334-.289.839-.25 1.128.086.289.336.25.84-.086 1.128zm.281-5.007c0 .441-.36.8-.801.8-.441 0-.801-.36-.801-.8V6c0-.442.361-.8.801-.8.441 0 .801.357.801.8v7.195z"/></svg>'
};
const brand = id => ({ salesforce: 'var(--brand-salesforce)', zendesk: 'var(--brand-zendesk)', slack: 'var(--brand-slack)', zoom: 'var(--brand-zoom)', jira: 'var(--brand-jira)', google: 'var(--brand-google)', gmail: 'var(--brand-gmail)', intercom: 'var(--brand-intercom)', appstore: 'var(--brand-apple)' }[id] || 'var(--fg-2)');
const badge = (id, label, attrs) => `<span class="src-badge"${attrs ? ' ' + attrs : ''} style="color:${brand(id)}" title="${label}">${LOGOS[id] || '<span class="logo-mono">' + (label || '?').slice(0, 2).toUpperCase() + '</span>'}</span>`;


/* ================= count-up ================= */
function countUp(node) {
  const target = +node.dataset.count; const dur = 900; const t0 = performance.now();
  const step = now => { const p = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - p, 3);
    node.textContent = fmt(Math.round(target * e)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* ================= charts ================= */
function renderSources() {
  const W = 640, H = 260, pad = { l: 8, r: 8, t: 20, b: 40 };
  const max = Math.max(...SOURCES.map(s => s.value));
  const bw = (W - pad.l - pad.r) / SOURCES.length;
  const bars = SOURCES.map((s, i) => {
    const h = (s.value / max) * (H - pad.t - pad.b);
    const x = pad.l + i * bw + bw * 0.18, y = H - pad.b - h, w = bw * 0.64;
    return '<g class="bar" data-source="' + s.id + '" data-tip="' + s.name + ' · ' + fmt(s.value) + ' reports"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6" fill="var(--accent)" opacity="0.92"/><text class="axis" x="' + (x + w / 2) + '" y="' + (H - pad.b + 20) + '" text-anchor="middle">' + s.name.split(' ')[0] + '</text><text class="axis" x="' + (x + w / 2) + '" y="' + (y - 8) + '" text-anchor="middle" style="fill:var(--fg-2)">' + fmt(s.value) + '</text></g>';
  }).join('');
  const grid = [0.25, 0.5, 0.75].map(g => '<line x1="0" x2="' + W + '" y1="' + (pad.t + g * (H - pad.t - pad.b)) + '" y2="' + (pad.t + g * (H - pad.t - pad.b)) + '" stroke="var(--border-soft)" stroke-dasharray="3 5"/>').join('');
  $('#chartSources').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Intake volume by source">' + grid + bars + '</svg><div class="chart-tip" id="tipSources"></div>';
  bindTips('#chartSources', '#tipSources');
}

function renderSplit() {
  const total = SPLIT.reduce((a, b) => a + b.value, 0);
  const r = 58, C = 2 * Math.PI * r; let off = 0;
  const segs = SPLIT.map(s => {
    const len = (s.value / total) * C;
    const arc = '<circle cx="80" cy="80" r="' + r + '" fill="none" stroke="' + s.color + '" stroke-width="20" stroke-linecap="butt" stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 80 80)"><title>' + s.name + '</title></circle>';
    off += len; return arc;
  }).join('');
  $('#chartSplit').insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 160 160" width="100%" style="max-width:230px;margin:0 auto" role="img" aria-label="Classifier routing">' + segs + '</svg>');
  $('#legendSplit').innerHTML = SPLIT.map(s => '<span class="legend-item"><span class="sw" style="background:' + s.color + '"></span>' + s.name + ' · <b class="num">' + fmt(s.value) + '</b></span>').join('') +
    '<span class="legend-item"><span class="sw" style="background:var(--surface-alt)"></span>Excluded at intake · <b class="num">265</b></span>';
}

function renderTrend(weeks) {
  const n = weeks, labels = TREND.labels.slice(-n), q = TREND.quality.slice(-n), p = TREND.product.slice(-n);
  const W = 920, H = 280, pad = { l: 34, r: 16, t: 18, b: 34 };
  const max = Math.max(...q, ...p) * 1.15;
  const X = i => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
  const Y = v => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const line = arr => arr.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  const area = arr => line(arr) + ' L' + X(n - 1) + ' ' + (H - pad.b) + ' L' + X(0) + ' ' + (H - pad.b) + ' Z';
  const grid = [0, .5, 1].map(g => { const yy = pad.t + g * (H - pad.t - pad.b); return '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + yy + '" y2="' + yy + '" stroke="var(--border-soft)"/><text class="axis" x="4" y="' + (yy + 3) + '">' + Math.round(max * (1 - g)) + '</text>'; }).join('');
  const xlab = labels.map((l, i) => '<text class="axis" x="' + X(i) + '" y="' + (H - pad.b + 18) + '" text-anchor="middle">' + l + '</text>').join('');
  const dots = (arr, c) => arr.map((v, i) => '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="3.2" fill="' + c + '"/>').join('');
  $('#chartTrend').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Quality versus product weekly volume">' +
    '<defs><linearGradient id="gProd" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.30"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient>' +
    '<linearGradient id="gQual" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--danger)" stop-opacity="0.22"/><stop offset="1" stop-color="var(--danger)" stop-opacity="0"/></linearGradient></defs>' +
    grid + '<path d="' + area(p) + '" fill="url(#gProd)"/><path d="' + area(q) + '" fill="url(#gQual)"/>' +
    '<path d="' + line(p) + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>' +
    '<path d="' + line(q) + '" fill="none" stroke="var(--danger)" stroke-width="2.5" stroke-linejoin="round"/>' +
    dots(p, 'var(--accent)') + dots(q, 'var(--danger)') + xlab + '</svg>';
}

function bindTips(host, tip) {
  const h = $(host), t = $(tip); if (!h || !t) return;
  $$('.bar, .pt', h).forEach(b => {
    b.addEventListener('mousemove', e => { const r = h.getBoundingClientRect(); t.textContent = b.dataset.tip; t.style.left = (e.clientX - r.left) + 'px'; t.style.top = (e.clientY - r.top) + 'px'; t.classList.add('on'); });
    b.addEventListener('mouseleave', () => t.classList.remove('on'));
  });
}

/* ================= overview lists ================= */
function renderStream() {
  const rows = [
    { src: 'appstore', name: 'App store · iOS', t: 'Aeris Air app sync stall after nightly upload', label: 'Potential MDR', cls: 'label-danger', when: '18 min ago' },
    { src: 'zendesk', name: 'Zendesk #48219', t: 'Stalls at 99% when two therapy profiles are active', label: 'Complaint', cls: 'label-warning', when: '44 min ago' },
    { src: 'gmail', name: 'Email msg-5043', t: 'False low-pressure alerts most nights', label: 'Complaint', cls: 'label-warning', when: '2h ago' },
    { src: 'zoom', name: 'Zoom · clinic call', t: 'Clinician PDF export request', label: 'Product feedback', cls: 'label-accent', when: '3h ago' },
    { src: 'slack', name: 'Slack #design-system', t: 'Therapy chart contrast in dark mode', label: 'Product feedback', cls: 'label-accent', when: '5h ago' },
    { src: 'salesforce', name: 'Salesforce case', t: 'Field-safety notice — humidifier lot 409-TX', label: 'Potential MDR', cls: 'label-danger', when: '6h ago' }
  ];
  $('#triageStream').innerHTML = rows.map(r => '<div class="stream-row src-row" data-source="' + r.src + '" role="button" tabindex="0" aria-label="View ' + r.name + ' feedback" data-search="' + (r.t + ' ' + r.name).toLowerCase() + '">' + badge(r.src, r.name) +
    '<div><div class="stream-title">' + r.t + '</div><div class="stream-meta">' + r.name + ' · ' + r.when + '</div></div>' +
    '<span class="label ' + r.cls + '">' + r.label + '</span></div>').join('');
}
function renderFreshness() {
  const rows = CONNECTORS.slice(0, 4);
  $('#freshnessList').innerHTML = rows.map(c => '<div class="row-between src-row" data-source="' + c.id + '" role="button" tabindex="0" aria-label="View ' + c.name + ' status" style="padding:10px 0;border-bottom:1px solid var(--border-soft)"><div class="row" style="gap:10px">' + badge(c.id, c.name) + '<div><div style="font-size:13px;font-weight:500">' + c.name + '</div><div class="meta">' + c.records + ' records</div></div></div><span class="label ' + (c.status === 'warn' ? 'label-warning' : 'label-success') + '"><span class="dot"></span>' + c.last + '</span></div>').join('');
}

/* ================= ideas ================= */
let ideaSort = 'demand', ideaAge = 0;
function sparkline(seed) {
  const pts = Array.from({ length: 12 }, (_, i) => 8 + Math.abs(Math.sin(i * 1.3 + seed) * 12) + i);
  const max = Math.max(...pts);
  const d = pts.map((v, i) => (i ? 'L' : 'M') + (i * 4) + ' ' + (24 - (v / max) * 20)).join(' ');
  return '<svg class="spark" width="48" height="24" viewBox="0 0 48 24" aria-hidden="true"><path d="' + d + ' L44 24 L0 24 Z" fill="var(--accent)" opacity="0.15"/><path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="1.6"/></svg>';
}
function ideaCard(i, k) {
  const pcls = i.priority === 'Critical' ? 'label-danger' : i.priority === 'High' ? 'label-warning' : i.priority === 'Medium' ? 'label-info' : 'label-neutral';
  return '<button class="glass idea-card rise" style="--i:' + k + '" data-idea="' + i.id + '" data-search="' + (i.title + ' ' + i.pod + ' ' + i.jira).toLowerCase() + '" data-od-id="' + i.id + '">' +
    '<div class="i-top"><span class="label ' + pcls + '">' + i.priority + '</span></div>' +
    '<h3>' + i.title + '</h3>' +
    '<p class="i-quote">' + i.quote + '</p>' +
    '<div class="i-foot"><span class="mini-logos">' + i.sources.slice(0, 3).map(s => badge(s[0], s[1])).join('') + '</span>' +
    '<span class="meta">' + i.reports + ' reports</span>' + sparkline(i.reports) + '</div>' +
    '<div class="i-foot" style="border-top:1px solid var(--border-soft);padding-top:12px"><span class="row" style="gap:6px;color:var(--brand-jira)"><span style="width:14px;height:14px">' + LOGOS.jira + '</span><b class="mono" style="font-size:11.5px">' + i.jira + '</b></span>' +
    '<span class="label ' + i.jiraClass + '" style="margin-left:auto">' + i.jiraStatus + '</span></div></button>';
}
function renderIdeas() {
  let list = IDEAS.slice();
  if (ideaAge) list = list.filter(i => i.ageDays <= ideaAge);
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  if (ideaSort === 'demand') list = list.slice().sort((a, b) => b.reports - a.reports);
  if (ideaSort === 'priority') list = list.slice().sort((a, b) => order[a.priority] - order[b.priority]);
  if (ideaSort === 'recent') list = list.slice().sort((a, b) => a.ageDays - b.ageDays);
  $('#ideaGrid').innerHTML = list.map((i, k) => ideaCard(i, k)).join('');
  $('#ideaEmpty').classList.toggle('hide', list.length > 0);
}

/* ================= idea detail ================= */
const STAGES = ['Intake', 'Triage', 'In build', 'In review', 'Shipped'];
function showIdea(id) {
  const i = IDEAS.find(x => x.id === id); if (!i) return;
  $('#detailEyebrow').textContent = 'IDEA';
  $('#detailTitle').textContent = i.title;
  $('#detailMeta').innerHTML = '<span class="label ' + (i.priority === 'Critical' ? 'label-danger' : i.priority === 'High' ? 'label-warning' : 'label-info') + '">' + i.priority + ' priority</span><span class="label label-neutral"><span class="dot"></span>' + i.reports + ' reports in cluster</span>';
  $('#detailEvidenceCount').textContent = i.reports + ' reports';
  $('#detailEvidenceList').innerHTML = i.evidence.map(e => '<div class="evidence-quote">' + e.text + '<span class="whisper">' + e.src + ' · ' + e.when + ' · provenance: ' + e.prov + '</span>' + (e.url ? '<a class="ev-link" href="' + e.url + '" target="_blank" rel="noopener noreferrer" title="Open the source record"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg>Open source</a>' : '') + '</div>').join('');
  $('#detailWhy').textContent = i.why;
  $('#detailJiraLogo').innerHTML = LOGOS.jira; $('#detailJiraLogo').style.color = 'var(--brand-jira)';
  $('#detailJiraKey').textContent = i.jira; $('#detailJiraTitle').textContent = i.jiraTitle;
  const js = $('#detailJiraStatus'); js.textContent = i.jiraStatus; js.className = 'label ' + i.jiraClass;
  $('#detailJiraAssignee').textContent = i.assignee; $('#detailJiraSprint').textContent = i.sprint;
  $('#detailJiraPoints').textContent = i.points; $('#detailJiraUpdated').textContent = i.updated;
  $('#detailRoadmapStage').textContent = i.stage;
  $('#detailRoadmapTrack').innerHTML = STAGES.map((s, idx) => '<span class="seg-item ' + (idx < i.roadmapIdx ? 'done' : idx === i.roadmapIdx ? 'now' : '') + '">' + s + '</span>').join('');
  $('#detailRoadmapNote').textContent = i.roadmapNote;
  const dmax = 50, emax = 90;
  $('#detailDemand').textContent = i.reports + ' reports'; $('#detailDemandBar').style.width = Math.min(100, (i.demand / dmax) * 100) + '%';
  $('#detailEffort').textContent = i.effort + ' pts'; $('#detailEffortBar').style.width = (i.effort / emax * 100) + '%';
  $('#detailContext').innerHTML =
    '<div class="kv"><span class="k">SUGGESTED OWNER</span><span class="v">' + i.owner.name + ' ' + (i.owner.verified ? '<span class="label label-success" style="font-size:10px">verified</span>' : '<span class="unverified">UNVERIFIED</span>') + '</span></div>' +
    '<div class="kv"><span class="k">ROLE</span><span class="v">' + i.owner.role + '</span></div>' +
    '<div class="kv"><span class="k">CRM CONTEXT</span><span class="v">' + (i.crmVerified ? '' : '<span class="unverified">UNVERIFIED</span> ') + i.crm + '</span></div>' +
    '<p class="meta">Owner and CRM mapping stay marked unverified until a human checks them.</p>';
  go('idea');
}

/* ================= quality deck ================= */
let queue = [], decisions = [], busy = false;
function persist() { store.set('deck', { queue: queue.map(q => q.id), decisions: decisions }); }
function restore() {
  const s = store.get('deck', null);
  if (s && Array.isArray(s.queue)) { queue = s.queue.map(id => QUALITY.find(q => q.id === id)).filter(Boolean); decisions = s.decisions || []; }
  else queue = QUALITY.slice();
}
function renderDeck() {
  const deck = $('#qualityDeck'); deck.innerHTML = '';
  const top3 = queue.slice(0, 3);
  top3.forEach((it, idx) => {
    const c = el('div', 'swipe-card'); c.dataset.id = it.id; c.tabIndex = 0;
    const mdr = it.mdr ? '<span class="label label-danger"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>Potential MDR</span>' : '<span class="label label-warning">Complaint candidate</span>';
    c.innerHTML =
      '<div class="sw-flag approve">APPROVE</div><div class="sw-flag deny">DENY</div>' +
      '<div class="sw-edge approve"></div><div class="sw-edge deny"></div>' +
      '<div class="row-between"><div class="row" style="gap:10px">' + badge(it.sourceId, it.source, 'data-source="' + it.sourceId + '" role="button" tabindex="0" aria-label="View ' + it.source + ' records"') + '<div><div class="mono" style="font-size:11.5px;color:var(--meta)">' + it.id + ' · ' + it.record + '</div><div style="font-size:12.5px">' + it.source + '</div></div></div>' + mdr + '</div>' +
      '<div class="q-text">' + it.quote + '</div>' +
      '<div class="row wrap" style="gap:8px"><span class="label label-neutral">' + it.product + '</span>' + (it.version ? '<span class="label label-outline mono">v' + it.version + '</span>' : '') + '</div>' +
      '<div class="rationale" style="margin-top:auto">' + it.reason.slice(0, 180) + '…</div>' +
      '<div class="row-between" style="padding-top:12px;border-top:1px solid var(--border-soft)"><span class="meta">classifier confidence ' + it.confidence.toFixed(2) + ' · ' + it.when + '</span><span class="meta">' + it.related + ' related reports</span></div>';
    const rot = idx * -1.4, sc = 1 - idx * 0.035, ty = idx * 10;
    c.style.transform = 'rotate(' + rot + 'deg) scale(' + sc + ') translateY(' + ty + 'px)';
    c.style.zIndex = 10 - idx; c.style.opacity = idx === 0 ? 1 : 0.75;
    if (idx === 0) attachDrag(c);
    deck.appendChild(c);
  });
  const empty = '<div class="deck-empty"><div><div style="font-family:var(--font-display);font-size:18px;font-weight:600">Queue clear</div><p class="sub" style="margin-top:6px">Every pending item has a logged decision.</p><button class="btn btn-secondary btn-sm" id="reloadDeck" style="margin-top:14px">Reload demo queue</button></div></div>';
  if (!queue.length) { deck.innerHTML = empty; const r = $('#reloadDeck'); if (r) r.onclick = () => { queue = QUALITY.slice(); decisions = []; persist(); renderDeck(); renderDecisionLog(); renderQms(); updateDetail(); }; }
  $('#deckCount').textContent = queue.length + ' remaining';
  const qp = $('#qtabPending'); if (qp) qp.textContent = queue.length;
  const hasItems = queue.length > 0;
  ['#approveBtn', '#denyBtn', '#skipBtn'].forEach(sel => { const b = $(sel); if (b) b.disabled = !hasItems; });
  updateDetail(); renderDecisionLog(); renderQms();
}
function updateDetail() {
  const it = queue[0]; const host = $('#qualityDetail');
  if (!it) { host.innerHTML = '<div class="panel-head"><div><h3>Classifier rationale</h3></div></div><div class="empty">Advance the deck to inspect an item.</div>'; return; }
  host.innerHTML =
    '<div class="panel-head"><div><h3>' + it.id + ' · rationale</h3><p class="sub">' + it.classification + ' → ' + (it.mdr ? 'MDR review' : 'quality review') + '</p></div><span class="label ' + (it.mdr ? 'label-danger' : 'label-warning') + '">conf ' + it.confidence.toFixed(2) + '</span></div>' +
    '<div class="rationale" style="margin-bottom:14px">' + it.reason + '</div>' +
    '<div class="rat-grid">' +
    '<div class="rat-item"><div class="rk">FTA report</div><div class="rv num">' + it.fta + '</div></div>' +
    '<div class="rat-item"><div class="rk">Fault-tree node</div><div class="rv">' + it.ftaNote + '</div></div>' +
    '<div class="rat-item"><div class="rk">Priority subflags</div><div class="rv">' + (it.flags.length ? it.flags.map(f => '<span class="label label-warning" style="font-size:10px">' + f + '</span>').join(' ') : '—') + '</div></div>' +
    '<div class="rat-item"><div class="rk">Related reports</div><div class="rv"><span class="num">' + it.related + '</span> linked</div></div>' +
    '</div>' +
    '<p class="rat-foot">A complaint is only a candidate for human review. No automatic legal or MDR determination is ever made.</p>';
}
function logDecision(it, action) {
  decisions.unshift({ id: it.id, action, title: it.quote.slice(0, 54) + '…', when: 'just now' });
  if (decisions.length > 12) decisions.pop();
}
function renderDecisionLog() {
  const host = $('#decisionLog');
  if (!decisions.length) { host.innerHTML = '<div class="empty" style="padding:24px 0">No decisions yet this session.</div>'; return; }
  host.innerHTML = decisions.map(d => '<div class="decision-row"><span class="src-badge" style="width:26px;height:26px;border-radius:8px;color:' + (d.action === 'approve' ? 'var(--success)' : d.action === 'deny' ? 'var(--danger)' : 'var(--fg-2)') + '">' +
    (d.action === 'approve' ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7"/></svg>' : d.action === 'deny' ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>') + '</span>' +
    '<span class="grow"><b class="mono">' + d.id + '</b> ' + (d.action === 'approve' ? 'approved → QMS' : d.action === 'deny' ? 'denied → product' : 'marked for follow-up') + '<br><span class="meta">' + d.title + '</span></span><span class="meta">' + d.when + '</span></div>').join('');
}
function renderQms() {
  const approved = decisions.filter(d => d.action === 'approve');
  const label = approved.length + ' queued';
  const qc = $('#qmsCount'); if (qc) qc.textContent = label;
  const qh = $('#qmsCountHead'); if (qh) qh.innerHTML = '<span class="dot"></span>' + label;
  $('#pushQmsBtn').disabled = approved.length === 0;
  const host = $('#qmsQueue');
  host.innerHTML = approved.length ? approved.map(a => '<div class="decision-row" style="background:var(--success-bg);border-color:color-mix(in oklch, var(--success) 25%, transparent)"><span class="mono" style="font-weight:600;color:var(--success)">' + a.id + '</span><span class="grow meta" style="color:var(--success)">Complaint_Type__c ← complaint</span><span class="label label-success">ready</span></div>').join('')
    : '<p class="sub" style="font-size:12px">Approved complaint packets appear here before export.</p>';
}
function resolve(action) {
  if (!queue.length) return;
  const it = queue.shift();
  if (action === 'skip') { queue.push(it); toast('Marked ' + it.id + ' for follow-up', 'info'); }
  else { logDecision(it, action); toast(action === 'approve' ? it.id + ' approved → queued for QMS' : it.id + ' denied → returned to product', action === 'approve' ? 'success' : 'danger'); }
  persist(); renderDeck();
  if (!queue.length) persist();
}
function fly(card, dir) {
  card.style.transition = 'transform .42s var(--ease), opacity .42s var(--ease)';
  if (dir === 0) card.style.transform = 'translateY(190px) scale(.9)';
  else card.style.transform = 'translateX(' + (dir * 620) + 'px) rotate(' + (dir * 26) + 'deg)';
  card.style.opacity = '0';
}
function act(action) {
  if (busy || !queue.length) return;
  const card = $('#qualityDeck .swipe-card');
  const dir = action === 'approve' ? 1 : action === 'deny' ? -1 : 0;
  if (!card) { resolve(action); return; }
  busy = true;
  fly(card, dir);
  setTimeout(() => { resolve(action); busy = false; }, 200);
}
function attachDrag(card) {
  let sx = 0, sy = 0, dx = 0, dy = 0, down = false;
  const ap = $('.sw-flag.approve', card), dn = $('.sw-flag.deny', card);
  const ea = $('.sw-edge.approve', card), ed = $('.sw-edge.deny', card);
  const clearStamps = () => { ap.style.opacity = 0; dn.style.opacity = 0; if (ea) ea.style.opacity = 0; if (ed) ed.style.opacity = 0; };
  card.addEventListener('pointerdown', e => { if (e.target.closest('button, [data-source]')) return; down = true; sx = e.clientX; sy = e.clientY; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; });
  card.addEventListener('pointermove', e => {
    if (!down) return; dx = e.clientX - sx; dy = e.clientY - sy;
    const tilt = Math.max(-16, Math.min(16, dx * 0.055));
    card.style.transform = 'translate(' + dx + 'px,' + dy * 0.4 + 'px) rotate(' + tilt + 'deg)';
    const p = Math.max(0, Math.min(1, dx / 140)), n = Math.max(0, Math.min(1, -dx / 140));
    ap.style.opacity = p; dn.style.opacity = n;
    if (ea) ea.style.opacity = p * .85; if (ed) ed.style.opacity = n * .85;
  });
  const end = () => {
    if (!down) return; down = false;
    if (dx > 120) { busy = true; fly(card, 1); setTimeout(() => { resolve('approve'); busy = false; }, 190); }
    else if (dx < -120) { busy = true; fly(card, -1); setTimeout(() => { resolve('deny'); busy = false; }, 190); }
    else { card.style.transition = 'transform .35s var(--ease-spring)'; card.style.transform = ''; clearStamps(); }
    dx = 0; dy = 0;
  };
  card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
}
function renderQualityTable() {
  const rows = QUALITY.slice().filter(r => !qualityAge || r.ageDays <= qualityAge);
  const title = $('#qualityTableTitle'); if (title) title.textContent = 'Complaint candidates';
  $('#qualityTableCount').textContent = rows.length + ' rows';
  const note = $('#qualityAgeNote'); if (note) note.textContent = qualityAge ? 'Showing last ' + qualityAge + ' days' : 'Showing all time · newest first';
  $('#qualityTableBody').innerHTML = rows.map(r =>
    '<tr><td class="mono">' + r.id + '</td>' +
    '<td><span class="label ' + (r.mdr ? 'label-danger' : 'label-warning') + '">' + (r.mdr ? 'MDR flag' : 'complaint candidate') + '</span></td>' +
    '<td class="cell-evidence"><span class="cell-quote">' + r.quote + '</span></td>' +
    '<td><button type="button" class="src-link" data-source="' + r.sourceId + '">' + r.source + '</button></td>' +
    '<td>' + (r.mdr ? '<span class="label label-danger">flagged</span>' : '—') + '</td>' +
    '<td>' + (r.reviewer || '—') + '</td><td class="mono">' + r.when + '</td></tr>').join('');
}

/* ================= team / pods ================= */
const initials = s => (String(s).replace(/[^A-Za-z ]/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '—');
const podStat = (n, l) => '<div class="pod-stat"><div class="n num">' + n + '</div><div class="l">' + l + '</div></div>';
function personRow(name, verified, role, showUnverified) {
  return '<div class="pod-person"><span class="ava" aria-hidden="true">' + initials(name) + '</span><span class="grow"><b>' + name + '</b> ' + (verified ? '<span class="label label-success" style="font-size:9.5px">verified lead</span>' : (showUnverified ? '<span class="unverified">UNVERIFIED</span>' : '')) + '</span><span class="role">' + role + '</span></div>';
}
function renderPods() {
  const tone = { ok: 'label-success', 'at-risk': 'label-warning', critical: 'label-danger' };
  const text = { ok: 'On track', 'at-risk': 'Watch', critical: 'Needs decision' };
  $('#podGrid').innerHTML = PODS.map((p, k) => {
    const ideas = IDEAS.filter(i => i.pod === p.name);
    const reports = ideas.reduce((s, i) => s + i.reports, 0);
    return '<div class="glass pod-card rise" style="--i:' + k + '" data-od-id="pod-' + p.id + '" data-pod="' + p.name + '" role="button" tabindex="0" aria-label="Open the ' + p.name + ' pod">' +
      '<div class="pod-head"><span class="pod-monogram" aria-hidden="true">' + p.mono + '</span>' +
      '<div class="grow"><div class="pod-name">' + p.name + '</div><div class="pod-role">' + p.okr + '</div></div>' +
      '<span class="label ' + tone[p.health] + '"><span class="dot"></span>' + text[p.health] + '</span></div>' +
      '<div class="pod-people">' +
        personRow(p.lead, p.leadVerified, 'Pod lead', true) +
        personRow(p.pm, true, 'Product mgr', false) +
      '</div>' +
      '<div class="pod-stats">' + podStat(ideas.length, 'ideas') + podStat(reports, 'reports') + podStat(fmt(p.complaints), 'complaint cand.') + '</div>' +
      '<div class="pod-ideas"><div class="pod-ideas-head"><span class="meta">' + ideas.length + ' idea' + (ideas.length === 1 ? '' : 's') + ' owned by this pod</span><span class="meta">Open pod →</span></div>' +
      (ideas.length ? ideas.slice(0, 3).map(i => '<span class="pod-idea" data-idea="' + i.id + '"><span class="grow"><span class="pi-title">' + i.title + '</span><br><span class="pi-meta">' + i.jira + ' · ' + i.priority + ' · ' + i.reports + ' reports</span></span><span class="label ' + (i.jiraClass || 'label-neutral') + '">' + i.jiraStatus + '</span></span>').join('') : '<p class="pod-empty">No idea clusters assigned yet — feedback for this pod is still below the clustering threshold.</p>') +
      '</div></div>';
  }).join('');
  const withLead = PODS.filter(p => p.leadVerified).length;
  const pct = Math.round((withLead / PODS.length) * 100);
  $('#podCoverageTag').textContent = withLead + ' of ' + PODS.length + ' pods led';
  $('#podCoverageLabel').textContent = 'Pods with a named, verified lead';
  $('#podCoveragePct').textContent = pct + '%';
  $('#podCoverageBar').style.width = pct + '%';
}
function openPod(name) {
  const p = PODS.find(x => x.name === name); if (!p) return;
  const ideas = IDEAS.filter(i => i.pod === p.name);
  const reports = ideas.reduce((s, i) => s + i.reports, 0);
  const tone = { ok: 'label-success', 'at-risk': 'label-warning', critical: 'label-danger' };
  const text = { ok: 'On track', 'at-risk': 'Watch', critical: 'Needs decision' };
  $('#podDetailEyebrow').textContent = 'POD · ' + p.name.toUpperCase();
  $('#podDetailTitle').textContent = p.name;
  $('#podDetailOkr').textContent = p.okr;
  const h = $('#podDetailHealth'); h.className = 'label ' + tone[p.health]; h.innerHTML = '<span class="dot"></span>' + text[p.health];
  $('#podDetailPeople').innerHTML = personRow(p.lead, p.leadVerified, 'Pod lead', true) + personRow(p.pm, true, 'Product mgr', false);
  $('#podDetailStats').innerHTML = podStat(ideas.length, 'ideas') + podStat(reports, 'reports') + podStat(fmt(p.complaints), 'complaint cand.');
  $('#podDetailIdeaCount').textContent = ideas.length + (ideas.length === 1 ? ' idea' : ' ideas');
  $('#podDetailIdeas').innerHTML = ideas.length ? ideas.map((i, k) => ideaCard(i, k)).join('') : '<div class="empty">No idea clusters are assigned to this pod yet.</div>';
  go('pod');
}

/* ================= roadmap ================= */
function renderRoadmap() {
  const colors = { 'Now · W14': 'var(--accent)', 'Next · W15–16': 'var(--info)', 'Later · W17+': 'var(--muted)' };
  $('#roadmapLanes').innerHTML = Object.entries(ROADMAP).map(([lane, items]) =>
    '<div class="lane"><div class="lane-head"><span class="sw" style="background:' + colors[lane] + '"></span><strong style="font-size:13.5px">' + lane + '</strong><span class="meta" style="margin-left:auto">' + items.length + '</span></div>' +
    items.map(it => { const idea = IDEAS.find(i => i.jira === it.jira); return '<button type="button" class="lane-card"' + (idea ? ' data-jira="' + it.jira + '"' : ' disabled') + '><div class="row-between"><span class="mono" style="font-size:11px;color:var(--meta)">' + it.jira + '</span><span class="label label-outline" style="font-size:10px">' + it.pod + '</span></div><div style="font-size:13px;font-weight:500">' + it.title + '</div>' + (idea ? '<div class="row-between"><span class="si-meta">' + idea.reports + ' reports in cluster</span><span class="si-meta">' + idea.priority + '</span></div>' : '') + '<div class="progress"><i style="width:' + it.pct + '%"></i></div></button>'; }).join('') + '</div>').join('');
  const stageTone = { 'In build': 'label-accent', 'Planned': 'label-info', 'Later': 'label-neutral' };
  const demand = IDEAS.slice().sort((a, b) => b.reports - a.reports);
  const maxRep = Math.max.apply(null, demand.map(i => i.reports));
  $('#demandCommit').innerHTML = demand.map(i => '<button type="button" class="commit-row" data-jira="' + i.jira + '"><span class="grow"><span class="cr-title">' + i.title + '</span><br><span class="si-meta">' + i.pod + ' · ' + i.jira + ' · demand ' + i.demand + '/50 · ' + i.effort + ' pts</span></span><span class="cr-demand"><span class="progress"><i style="width:' + Math.round((i.reports / maxRep) * 100) + '%"></i></span><span class="num">' + i.reports + '</span></span><span class="label ' + (stageTone[i.stage] || 'label-neutral') + '">' + i.stage + '</span></button>').join('');
  const committed = IDEAS.filter(i => i.stage === 'In build' || i.stage === 'Planned').length;
  const pct = Math.round((committed / IDEAS.length) * 100);
  $('#roadmapCoverage').textContent = committed + ' of ' + IDEAS.length + ' committed';
  $('#coverageLabel').textContent = 'Customer clusters already in build or planned for this cycle';
  $('#coveragePct').textContent = pct + '%';
  $('#coverageBar').style.width = pct + '%';
  const pts = IDEAS.map(i => '<div class="pt" style="left:' + (18 + (i.effort / 90) * 74) + '%;top:' + (86 - (i.demand / 50) * 74) + '%;width:' + (20 + i.reports) + 'px;height:' + (20 + i.reports) + 'px;background:var(--accent);" data-tip="' + i.title + ' · ' + i.reports + ' reports · ' + i.effort + ' pts">' + i.reports + '</div>').join('');
  $('#demandMatrix').innerHTML = '<div class="grid-line" style="left:50%;top:12px;bottom:44px;width:1px"></div><div class="grid-line" style="top:50%;left:12px;right:12px;height:1px"></div>' + pts +
    '<span class="axis-y">LOW EFFORT</span><span class="axis-x">HIGH DEMAND →</span><div class="chart-tip" id="tipMatrix"></div>';
  bindTips('#demandMatrix', '#tipMatrix');
  $('#shippedList').innerHTML = SHIPPED.map(s => '<div class="stream-row" style="cursor:default">' + badge('jira', 'Jira') + '<div><div class="stream-title">' + s.title + '</div><div class="stream-meta">' + s.jira + '</div></div><span class="label label-success">' + s.when + '</span></div>').join('');
}

/* ================= integrations ================= */
function intCard(o, isQms) {
  const tone = o.tone === 'success' ? 'label-success' : 'label-neutral';
  return '<div class="glass int-card" data-od-id="int-' + o.id + '"><div class="ic-top"><span class="logo-tile">' + (o.id === 'jira' || o.id === 'salesforce' || o.id === 'zendesk' ? '<span style="color:' + brand(o.id) + ';width:22px;height:22px">' + LOGOS[o.id] + '</span>' : '<span class="logo-mono">' + o.mono + '</span>') + '</span><div><div class="ic-name">' + o.name + '</div><span class="label ' + tone + '" style="font-size:10px"><span class="dot"></span>' + o.status + '</span></div></div>' +
    '<p class="ic-desc">' + o.desc + '</p>' +
    '<div class="ic-foot"><span class="meta">' + o.detail + '</span>' + (isQms ? '<button class="btn btn-secondary btn-sm" data-configure="' + o.id + '" data-name="' + o.name + '">Configure (demo)</button>' : '<span class="label label-neutral" style="font-size:10px">demo only</span>') + '</div></div>';
}
function renderIntegrations() {
  $('#qmsGrid').innerHTML = QMS.map(q => intCard(q, true)).join('');
  $('#sourceGrid').innerHTML = SOURCES.map(s => { const c = CONNECTORS.find(x => x.id === s.id) || {}; return '<div class="glass int-card"><div class="ic-top src-row" data-source="' + s.id + '" role="button" tabindex="0" aria-label="View ' + s.name + ' feedback and ideas"><span class="logo-tile" style="color:' + brand(s.id) + '">' + (LOGOS[s.id] || '<span class="logo-mono">AS</span>') + '</span><div><div class="ic-name">' + s.name + '</div><span class="label ' + (c.status === 'warn' ? 'label-warning' : 'label-success') + '" style="font-size:10px"><span class="dot"></span>' + (c.last || 'live') + '</span></div></div><p class="ic-desc">' + (c.kind || 'Feedback source') + ' · ' + s.value + ' records this cycle · ' + (c.mode === 'live' ? 'live' : 'synthetic') + '</p><div class="ic-foot"><button type="button" class="src-link" data-source="' + s.id + '">View records</button><span class="switch ' + (c.status === 'warn' ? '' : 'on') + '" data-toggle-int role="switch" tabindex="0"></span></div></div>'; }).join('');
  $('#destGrid').innerHTML = DESTS.map(d => intCard(d, false)).join('');
  bindSwitches();
}
function bindSwitches() {
  $$('[data-toggle-int]').forEach(s => s.addEventListener('click', () => { toast('Demo toggle — no live effect', 'info'); }));
}

/* ================= data drawer ================= */
function renderData() {
  $('#pipelineStages').innerHTML = PIPELINE.map(p => '<div><div class="row-between" style="font-size:12.5px;margin-bottom:5px"><span>' + p.name + ' <span class="meta">· ' + p.detail + '</span></span><span class="num">' + p.pct + '%</span></div><div class="progress"><i style="width:' + p.pct + '%;background:' + (p.state === 'done' ? 'var(--success)' : 'var(--accent)') + '"></i></div></div>').join('');
  $('#connectorList').innerHTML = CONNECTORS.map(c => { const tone = c.status === 'warn' ? 'label-warning' : 'label-success'; return '<div class="row-between" style="padding:9px 11px;border:1px solid var(--border-soft);border-radius:10px;background:var(--glass-hi)"><div class="row" style="gap:10px">' + badge(c.id, c.name) + '<div><div style="font-size:12.5px;font-weight:500">' + c.name + '</div><div class="meta">' + c.kind + '</div></div></div><div style="text-align:right"><span class="label ' + tone + '" style="font-size:10px"><span class="dot"></span>' + c.last + '</span><div class="meta" style="margin-top:3px">' + c.records + ' rec</div></div></div>'; }).join('');
  $('#techStack').innerHTML = TECH.map(t => '<span class="label label-outline">' + t + '</span>').join('');
  const now = new Date();
  $('#drawerSyncTime').textContent = 'Last sync ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · next in 11 min';
  if (typeof window.renderClassifierPanel === 'function') { try { window.renderClassifierPanel(); } catch (e) {} }
}
function openData() { $('#dataModal').classList.add('on'); renderData(); }
function closeData() { $('#dataModal').classList.remove('on'); }

/* ================= source detail drawer ================= */
const srcStat = (n, l) => '<div class="src-stat"><div class="n num">' + n + '</div><div class="l">' + l + '</div></div>';
function openSource(id) {
  const s = SOURCES.find(x => x.id === id); if (!s) return;
  const c = CONNECTORS.find(x => x.id === id) || {};
  const feed = SOURCE_FEED[id] || [];
  const ideas = IDEAS.filter(i => i.sources.some(x => x[0] === id));
  $('#sourceLogo').innerHTML = '<span style="color:' + brand(id) + ';width:22px;height:22px;display:block">' + (LOGOS[id] || '<span class="logo-mono">' + s.name.slice(0, 2).toUpperCase() + '</span>') + '</span>';
  $('#sourceName').textContent = s.name;
  $('#sourceKind').textContent = (c.kind || 'Feedback source') + ' · ' + (c.mode === 'live' ? 'live connector · last pull ' + (c.last || 'now') : c.status === 'warn' ? 'transcript access mocked · ' + (c.last || '') : 'synthetic slice · last sync ' + (c.last || 'live'));
  $('#sourceStats').innerHTML =
    srcStat(fmt(s.value), 'records this cycle') +
    srcStat(fmt(s.complaints), 'complaint candidates') +
    srcStat(fmt(s.product), 'product feedback') +
    srcStat(String(ideas.length), ideas.length === 1 ? 'linked idea' : 'linked ideas');
  $('#sourceFeed').innerHTML = feed.length ? feed.map(f => '<div class="src-feed-row"><span class="label ' + f.cls + '" style="font-size:10px">' + f.label + '</span><span class="sr-t">' + f.t + '</span><span class="sr-w">' + f.when + '</span></div>').join('') : '<p class="sub" style="font-size:12px">No records in this synthetic slice.</p>';
  $('#sourceIdeas').innerHTML = ideas.length ? ideas.map(i => '<button type="button" class="src-idea-row" data-source-idea="' + i.id + '"><span class="grow"><span class="si-title">' + i.title + '</span><br><span class="si-meta">' + i.jira + ' · ' + i.reports + ' reports · ' + i.pod + '</span></span><span class="label ' + i.jiraClass + '">' + i.jiraStatus + '</span></button>').join('') : '<p class="sub" style="font-size:12px">No idea clusters yet — reports from this source are still below the clustering threshold.</p>';
  $('#sourceDrawer').classList.add('on'); $('#sourceScrim').classList.add('on');
}
function closeSource() { $('#sourceDrawer').classList.remove('on'); $('#sourceScrim').classList.remove('on'); }

/* ================= assistant chat ================= */
let chatScope = 'product';
const CHAT = [
  { who: 'bot', text: 'I’m grounded on the ' + fmt(1873) + ' schema v1.1 records in this cycle. Ask me to pull evidence, cross-check Jira status, or summarise a cluster.', cites: ['schema v1.1', '1,873 records'] }
];
const REPLIES = {
  owner: { text: 'Three ideas still have unverified owners: “Clinician PDF export” (proposed: M. Adeyemi), “Home-screen widget for the AHI score” (proposed: J. Ferreira) and “Contrast and type tokens for therapy charts” (Design System pod). Each needs a human confirmation before it counts as owned.', cites: ['CLIN-770', 'APP-2260', 'DS-0442'] },
  false: { text: 'The false-alarm cluster spans 41 reports across email, App Store and Zendesk over 11 days, all inside the 00:00–05:00 window. It is linked to SAFE-1108 (In Progress) and carries a clinical-risk-without-known-harm flag.', cites: ['email-5043', 'SAFE-1108', 'FTA-2026-0402'] },
  mdr: { text: 'MDR candidates report actual or potential harm: CP-2208 (missed alarm during an apnea event — patient_harm_reported), CP-2185 (overnight power-off with reported harm) and CP-2196 (field-corrective humidifier lot 409-TX). CP-2214 and CP-2191 are lower-confidence candidates with implied clinical risk only.', cites: ['CP-2208', 'CP-2185', 'CP-2196', 'CP-2214'] },
  default: { text: 'Here’s what I found across the demo dataset. The strongest signal is the sync-reliability cluster: 68 reports total across APP-2214 and APP-2015, both in the current sprint, with two enterprise clinic accounts ($340k ARR) behind them.', cites: ['APP-2214', 'APP-2015', 'Zendesk #48219'] }
};
function renderChat() {
  const t = $('#chatThread');
  t.innerHTML = CHAT.map(m => msgHtml(m)).join('');
  t.scrollTop = t.scrollHeight;
}
const msgHtml = m => '<div class="msg ' + (m.who === 'me' ? 'me' : 'bot') + '">' + m.text + (m.cites ? '<div class="cites">' + m.cites.map(c => '<span class="label ' + (m.who === 'me' ? 'label-outline' : 'label-accent') + '" style="font-size:10px">' + c + '</span>').join('') + '</div>' : '') + '</div>';
function setScope(scope) {
  chatScope = scope === 'quality' ? 'quality' : 'product';
  const on = chatScope === 'quality';
  $('#scopeToggle').classList.toggle('on', on);
  $('#scopeToggle').setAttribute('aria-checked', on ? 'true' : 'false');
  $('#scopeBar').classList.toggle('quality', on);
  $$('#scopeToggle .scope-opt').forEach(o => o.classList.toggle('on', (o.dataset.opt === 'quality') === on));
  $('#scopeLabel').innerHTML = '<span class="scope-pulse" aria-hidden="true"></span><span>' + (on
    ? '<b>Product + quality &amp; compliance</b> <span class="sc-sub">· complaint candidates &amp; MDR flags included</span>'
    : '<b>Product feedback</b> only <span class="sc-sub">· quality &amp; compliance excluded</span>') + '</span>';
}
function ask(text) {
  if (!text.trim()) return;
  CHAT.push({ who: 'me', text });
  const thread = $('#chatThread'); thread.insertAdjacentHTML('beforeend', msgHtml({ who: 'me', text }));
  thread.insertAdjacentHTML('beforeend', '<div class="msg bot" id="typing"><span class="typing"><i></i><i></i><i></i></span></div>');
  thread.scrollTop = thread.scrollHeight;
  setTimeout(() => {
    const t = $('#typing'); if (t) t.remove();
    const low = text.toLowerCase();
    const qualityTopic = low.includes('mdr') || low.includes('harm') || low.includes('complaint') || low.includes('quality') || low.includes('compliance');
    let r;
    if (qualityTopic && chatScope === 'product') {
      r = { text: 'That lives in the quality &amp; compliance lane, which is outside the current scope. Flip the scope toggle to “+ Quality” and I’ll pull complaint candidates, potential MDR flags and the FTA rationale with citations.', cites: ['scope: product feedback'] };
    } else {
      r = low.includes('owner') ? REPLIES.owner : low.includes('false') || low.includes('alarm') ? REPLIES.false : low.includes('mdr') || low.includes('harm') ? REPLIES.mdr : REPLIES.default;
    }
    CHAT.push({ who: 'bot', ...r }); thread.insertAdjacentHTML('beforeend', msgHtml({ who: 'bot', ...r })); thread.scrollTop = thread.scrollHeight;
  }, 850);
}

/* ================= nav / routing ================= */
const VALID = ['overview', 'ideas', 'quality', 'qms', 'roadmap', 'pods', 'pod', 'integrations', 'assistant', 'idea'];
function go(view) {
  if (!VALID.includes(view)) view = 'overview';
  $$('.view').forEach(v => v.classList.remove('active'));
  const host = $('#view-' + view); if (host) host.classList.add('active');
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view || (view === 'idea' && n.dataset.view === 'ideas') || (view === 'pod' && n.dataset.view === 'pods')));
  store.set('view', view);
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'assistant') setTimeout(() => { const i = $('#chatInput'); if (i) i.focus(); }, 200);
  if (view === 'quality') renderDeck();
  if (view === 'qms') { renderQms(); renderQualityTable(); }
  if (view === 'pods') renderPods();
}
function openSidebar() { $('#sidebar').classList.add('open'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); }

/* ================= toast ================= */
function toast(text, kind) {
  const icons = { success: '<path d="M5 12l5 5L19 7"/>', danger: '<path d="M6 6l12 12M18 6 6 18"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>' };
  const n = el('div', 'toast ' + (kind || ''), '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (icons[kind] || icons.info) + '</svg><span>' + text + '</span>');
  $('#toasts').appendChild(n); setTimeout(() => { n.style.opacity = '0'; n.style.transform = 'translateY(8px)'; setTimeout(() => n.remove(), 300); }, 3200);
}

/* ================= wiring ================= */
let qualityAge = 0;
function init() {
  renderSources(); renderSplit(); renderTrend(12); renderStream(); renderFreshness();
  renderIdeas(); renderRoadmap(); renderPods(); renderIntegrations(); renderData(); renderChat(); restore();

  $$('.nav-item').forEach(n => n.addEventListener('click', () => go(n.dataset.view)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => go(b.dataset.goto)));
  $$('[data-od-id^="kpi-"] .k-num span[data-count]').forEach(n => { if (!$('#view-overview').classList.contains('active') || true) countUp(n); });

  $('#menuBtn').addEventListener('click', openSidebar);
  $('#dataBtn').addEventListener('click', openData);
  $('#openDataFromOverview').addEventListener('click', openData);
  $('#closeData').addEventListener('click', closeData);
  $('#closeDataFooter').addEventListener('click', closeData);
  $('#dataModal').addEventListener('click', e => { if (e.target.id === 'dataModal') closeData(); });
  $('#closeSource').addEventListener('click', closeSource);
  $('#sourceScrim').addEventListener('click', closeSource);
  $('#sourceIdeas').addEventListener('click', e => { const b = e.target.closest('[data-source-idea]'); if (b) { closeSource(); showIdea(b.dataset.sourceIdea); } });
  document.addEventListener('click', e => { const t = e.target.closest('[data-source]'); if (t && t.dataset.source) { e.preventDefault(); openSource(t.dataset.source); } });
  document.addEventListener('keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const t = e.target.closest && e.target.closest('[data-source]'); if (t && t.dataset.source && t.getAttribute('role') === 'button') { e.preventDefault(); openSource(t.dataset.source); } });
  $('#assistantBtn').addEventListener('click', () => go('assistant'));

  $('#ideaGrid').addEventListener('click', e => { const c = e.target.closest('[data-idea]'); if (c) showIdea(c.dataset.idea); });
  const podGrid = $('#podGrid');
  podGrid.addEventListener('click', e => {
    const idea = e.target.closest('[data-idea]'); if (idea) { showIdea(idea.dataset.idea); return; }
    const card = e.target.closest('[data-pod]'); if (card) openPod(card.dataset.pod);
  });
  podGrid.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-pod]'); if (card && card === e.target) { e.preventDefault(); openPod(card.dataset.pod); }
  });
  const podDetailIdeas = $('#podDetailIdeas');
  if (podDetailIdeas) podDetailIdeas.addEventListener('click', e => { const c = e.target.closest('[data-idea]'); if (c) showIdea(c.dataset.idea); });
  const openJira = e => { const b = e.target.closest('[data-jira]'); if (b) { const idea = IDEAS.find(i => i.jira === b.dataset.jira); if (idea) showIdea(idea.id); } };
  $('#roadmapLanes').addEventListener('click', openJira);
  $('#demandCommit').addEventListener('click', openJira);
  $('#ideasSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('#ideasSeg button').forEach(x => x.classList.remove('on')); b.classList.add('on'); ideaSort = b.dataset.sort; renderIdeas(); });
  $('#ideasDate').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('#ideasDate button').forEach(x => x.classList.remove('on')); b.classList.add('on'); ideaAge = parseInt(b.dataset.age, 10) || 0; renderIdeas(); });
  $('#qmsDate').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('#qmsDate button').forEach(x => x.classList.remove('on')); b.classList.add('on'); qualityAge = parseInt(b.dataset.age, 10) || 0; renderQualityTable(); });

  $('#approveBtn').addEventListener('click', () => act('approve'));
  $('#denyBtn').addEventListener('click', () => act('deny'));
  $('#skipBtn').addEventListener('click', () => act('skip'));
  $('#resetDeckBtn').addEventListener('click', () => { queue = QUALITY.slice(); decisions = []; persist(); renderDeck(); renderDecisionLog(); renderQms(); toast('Deck reset', 'info'); });
  $('#pushQmsBtn').addEventListener('click', () => { const n = decisions.filter(d => d.action === 'approve').length; toast('Exported ' + n + ' packet' + (n === 1 ? '' : 's') + ' to Veeva Vault Quality (sandbox mock)', 'success'); decisions = decisions.filter(d => d.action !== 'approve'); persist(); renderDecisionLog(); renderQms(); });
  $('#exportCsvBtn').addEventListener('click', () => toast('CSV export queued — audit-safe snapshot', 'success'));

  document.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown') return;
    if (!$('#view-quality').classList.contains('active')) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if ($('#intModal').classList.contains('on') || $('#dataModal').classList.contains('on') || $('#sourceScrim').classList.contains('on')) return;
    e.preventDefault();
    act(e.key === 'ArrowRight' ? 'approve' : e.key === 'ArrowLeft' ? 'deny' : 'skip');
  });

  $('#addIntegrationBtn').addEventListener('click', () => openModal('Veeva Vault Quality', 'VV'));
  $('#closeModal').addEventListener('click', closeModal);
  $('#intModal').addEventListener('click', e => { if (e.target.id === 'intModal') closeModal(); });
  $('#testConnBtn').addEventListener('click', () => toast('Demo only — no live tenant is contacted', 'info'));
  $('#saveIntBtn').addEventListener('click', () => { closeModal(); toast('Demo only — no integration was saved', 'info'); });
  $('#modalToggle').addEventListener('click', () => $('#modalToggle').classList.toggle('on'));
  $$('[data-configure]').forEach(b => b.addEventListener('click', () => openModal(b.dataset.name, (QMS.find(q => q.id === b.dataset.configure) || {}).mono || '·')));

  // `#runSyncBtn` is wired by assets/runtime.js to refresh real status.

  $('#chatForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#chatInput').value; $('#chatInput').value = ''; ask(v); });
  $$('.prompt-chip').forEach(c => c.addEventListener('click', () => ask(c.textContent)));
  const sc = $('#scopeToggle');
  sc.addEventListener('click', () => setScope(chatScope === 'product' ? 'quality' : 'product'));
  sc.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setScope(chatScope === 'product' ? 'quality' : 'product'); } });

  const gs = $('#globalSearch');
  gs.addEventListener('input', () => {
    const q = gs.value.trim().toLowerCase();
    $$('#ideaGrid .idea-card').forEach(c => c.classList.toggle('hide', q && !c.dataset.search.includes(q)));
    $$('#triageStream .stream-row').forEach(r => r.classList.toggle('hide', q && !(r.dataset.search || '').includes(q)));
    $$('#qualityTableBody tr').forEach(r => r.classList.toggle('hide', q && !r.textContent.toLowerCase().includes(q)));
  });

  $$('.switch').forEach(s => s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); s.click(); } }));

  const sb = $('#syncBar'); if (sb) { let sp = 0; const iv = setInterval(() => { sp = Math.min(72, sp + 4); sb.style.width = sp + '%'; const sp2 = $('#syncPct'); if (sp2) sp2.textContent = sp + '%'; if (sp >= 72) clearInterval(iv); }, 40); }

  go(store.get('view', 'overview'));
}
function openModal(name, mono) {
  $('#intModalTitle').textContent = name;
  $('#mName').value = name;
  $('#modalLogo').innerHTML = '<span class="logo-mono">' + (mono || '·') + '</span>';
  $('#intModal').classList.add('on');
}
function closeModal() { $('#intModal').classList.remove('on'); }

document.addEventListener('DOMContentLoaded', init);
