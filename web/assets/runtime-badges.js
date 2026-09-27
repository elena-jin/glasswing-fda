/* Test Flight  -  runtime badge logic (pure; browser + node testable).
 *
 * These labels are the ONLY source of truth for status shown to the user. No
 * hardcoded "Healthy" / "Synced" strings live in the markup any more.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TF_BADGES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function supabaseBadge(h) {
    if (!h) return { state: 'checking', tone: 'neutral', label: 'Supabase: checking…' };
    if (h.ok === false) return { state: 'error', tone: 'danger', label: 'Supabase: connection error' };
    if (!h.configured) return { state: 'not_connected', tone: 'neutral', label: 'Supabase: not connected' };
    return { state: 'live', tone: 'success', label: 'Supabase: live data connection' };
  }

  function modelBadge(s) {
    if (!s) return { state: 'unknown', tone: 'neutral', label: 'Model: status unknown' };
    if (s.ok === false) return { state: 'unavailable', tone: 'neutral', label: 'Model: offline code only / no runs' };
    if (s.empty) return { state: 'no_runs', tone: 'neutral', label: 'Model: offline code only / no runs' };
    return { state: 'has_runs', tone: 'accent', label: 'Model: ' + (s.count || 0) + ' run(s) recorded' };
  }

  function connectorSummary(c) {
    if (!c || !c.sources) return { state: 'unknown', tone: 'neutral', label: 'Sources: status unknown' };
    const tested = (c.tested_live || []).length;
    const untested = (c.configured_untested || []).length;
    const total = c.sources.length;
    if (tested) return { state: 'tested_live', tone: 'success', label: 'Sources: ' + tested + ' tested live · ' + total + ' total' };
    if (untested) return { state: 'configured_untested', tone: 'warning', label: 'Sources: ' + untested + ' configured, untested · ' + total + ' total' };
    return { state: 'synthetic', tone: 'neutral', label: 'Sources: all synthetic demo / not connected (' + total + ')' };
  }

  const TONE_CLASS = { success: 'label-success', warning: 'label-warning', danger: 'label-danger', neutral: 'label-neutral', accent: 'label-accent' };
  function toneClass(tone) { return TONE_CLASS[tone] || 'label-neutral'; }

  return { supabaseBadge, modelBadge, connectorSummary, toneClass };
});