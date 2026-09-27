/* Test Flight — real source connectors.
 *
 * Each connector is "live" only when the credentials it needs exist as
 * environment variables (set them in Vercel → Project → Settings → Environment
 * Variables, or a local .env for `vercel dev`). With no credentials the console
 * stays on the synthetic dataset, so a demo never breaks.
 *
 * Nothing here writes to a source system. Fetches are read-only previews:
 * the most recent few items, normalized to { t, when, label, url } so the UI
 * can render them beside the synthetic feed.
 *
 * Security: secrets live only in the serverless runtime. They are never sent
 * to the browser. See docs/connectors.md for the per-vendor setup steps.
 */

const REGISTRY = {
  zoom: {
    name: "Zoom",
    auth: "s2s_oauth",
    env: ["ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"],
    fetch: zoomPreview,
  },
  slack: {
    name: "Slack",
    auth: "bot_token",
    env: ["SLACK_BOT_TOKEN", "SLACK_CHANNEL_ID"],
    fetch: slackPreview,
  },
  gmail: {
    name: "Gmail",
    auth: "oauth2",
    env: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"],
    fetch: gmailPreview,
  },
  zendesk: {
    name: "Zendesk",
    auth: "api_token",
    env: ["ZENDESK_SUBDOMAIN", "ZENDESK_EMAIL", "ZENDESK_API_TOKEN"],
    fetch: zendeskPreview,
  },
  intercom: {
    name: "Intercom",
    auth: "access_token",
    env: ["INTERCOM_ACCESS_TOKEN"],
    fetch: intercomPreview,
  },
  appstore: {
    name: "App store reviews",
    auth: "public",
    env: ["APPSTORE_APP_ID", "APPSTORE_COUNTRY"],
    optionalEnv: ["APPSTORE_COUNTRY"],
    fetch: appStorePreview,
  },
  salesforce: {
    name: "Salesforce",
    auth: "oauth2",
    env: ["SALESFORCE_INSTANCE_URL", "SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET", "SALESFORCE_REFRESH_TOKEN"],
    fetch: null,
  },
};

function has(id) {
  const c = REGISTRY[id];
  if (!c || !c.fetch) return false;
  return c.env.filter((k) => !(c.optionalEnv || []).includes(k)).every((k) => !!process.env[k]);
}

function credentials(id) {
  const c = REGISTRY[id];
  return {
    configured: has(id),
    auth: c ? c.auth : null,
    env: c ? c.env : [],
    missing: c ? c.env.filter((k) => !(c.optionalEnv || []).includes(k) && !process.env[k]) : [],
  };
}

function status() {
  const out = {};
  for (const id of Object.keys(REGISTRY)) out[id] = credentials(id);
  return out;
}

async function preview(id) {
  if (!has(id)) return { ok: false, error: "not_configured", id, ...credentials(id) };
  try {
    const items = await REGISTRY[id].fetch();
    return { ok: true, id, mode: "live", count: items.length, items };
  } catch (err) {
    return { ok: false, id, error: "fetch_failed", detail: String(err && err.message || err) };
  }
}

/* ---------- Zoom (Server-to-Server OAuth) ---------- */
async function zoomToken() {
  const basic = Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64");
  const url = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(process.env.ZOOM_ACCOUNT_ID)}`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Basic ${basic}` } });
  if (!r.ok) throw new Error(`zoom token ${r.status}`);
  const j = await r.json();
  return j.access_token;
}
async function zoomPreview() {
  const token = await zoomToken();
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  const qs = `from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}&page_size=5`;
  const r = await fetch(`https://api.zoom.us/v2/users/me/recordings?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`zoom recordings ${r.status}`);
  const j = await r.json();
  return (j.meetings || []).slice(0, 5).map((m) => ({
    t: `${m.topic} — ${(m.recording_files || []).length} recording file(s)`,
    when: m.start_time ? m.start_time.slice(0, 10) : "",
    label: "Transcript",
    src: "Zoom",
    url: m.share_url || null,
  }));
}

/* ---------- Slack (bot token) ---------- */
async function slackPreview() {
  const auth = await fetch("https://slack.com/api/auth.test", { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
  const aj = await auth.json();
  if (!aj.ok) throw new Error(`slack auth ${aj.error}`);
  const r = await fetch(
    `https://slack.com/api/conversations.history?channel=${encodeURIComponent(process.env.SLACK_CHANNEL_ID)}&limit=5`,
    { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } }
  );
  const j = await r.json();
  if (!j.ok) throw new Error(`slack history ${j.error}`);
  return (j.messages || []).slice(0, 5).map((m) => ({
    t: String(m.text || "").slice(0, 180) || "(attachment)",
    when: m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString().slice(0, 10) : "",
    label: "Product feedback",
    src: `Slack #${aj.team || "channel"}`,
    url: null,
  }));
}

/* ---------- Gmail (OAuth refresh token) ---------- */
async function gmailToken() {
  const body = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  if (!r.ok) throw new Error(`gmail token ${r.status}`);
  return (await r.json()).access_token;
}
async function gmailPreview() {
  const token = await gmailToken();
  const h = { Authorization: `Bearer ${token}` };
  const list = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=newer_than:30d", { headers: h });
  if (!list.ok) throw new Error(`gmail list ${list.status}`);
  const ids = ((await list.json()).messages || []).slice(0, 5);
  const items = [];
  for (const { id } of ids) {
    const m = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=Date`, { headers: h });
    if (!m.ok) continue;
    const j = await m.json();
    const hdr = Object.fromEntries((j.payload && j.payload.headers || []).map((x) => [x.name, x.value]));
    items.push({ t: hdr.Subject || "(no subject)", when: hdr.Date ? new Date(hdr.Date).toISOString().slice(0, 10) : "", label: "Email", src: "Gmail", url: null });
  }
  return items;
}

/* ---------- Zendesk (API token) ---------- */
async function zendeskPreview() {
  const basic = Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString("base64");
  const r = await fetch(`https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets.json?sort_by=updated_at&sort_order=desc&per_page=5`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!r.ok) throw new Error(`zendesk ${r.status}`);
  const j = await r.json();
  return (j.tickets || []).slice(0, 5).map((t) => ({
    t: t.subject || t.description || `Ticket #${t.id}`,
    when: t.updated_at ? t.updated_at.slice(0, 10) : "",
    label: "Ticket",
    src: `Zendesk #${t.id}`,
    url: t.url || null,
  }));
}

/* ---------- Intercom ---------- */
async function intercomPreview() {
  const r = await fetch("https://api.intercom.io/conversations?order=desc&sort=updated_at", {
    headers: { Authorization: `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`, "Intercom-Version": "2.11" },
  });
  if (!r.ok) throw new Error(`intercom ${r.status}`);
  const j = await r.json();
  return (j.data || []).slice(0, 5).map((c) => ({
    t: (c.source && (c.source.body || c.source.subject)) || `Conversation ${c.id}`,
    when: c.updated_at ? new Date(c.updated_at * 1000).toISOString().slice(0, 10) : "",
    label: "In-app",
    src: "Intercom",
    url: null,
  }));
}

/* ---------- Apple App Store reviews (public RSS) ---------- */
async function appStorePreview() {
  const country = process.env.APPSTORE_COUNTRY || "us";
  const r = await fetch(`https://itunes.apple.com/${country}/rss/customerreviews/page=1/id=${encodeURIComponent(process.env.APPSTORE_APP_ID)}/sortby=mostrecent/json`);
  if (!r.ok) throw new Error(`appstore ${r.status}`);
  const j = await r.json();
  const entries = ((j.feed || {}).entry) || [];
  return entries.slice(1, 6).map((e) => ({
    t: String((e["im:rating"] && e["im:rating"].label ? `[${e["im:rating"].label}★] ` : "") + ((e.content && e.content.label) || e.title.label)).slice(0, 180),
    when: e.updated ? e.updated.label.slice(0, 10) : "",
    label: "App review",
    src: "App store · iOS",
    url: e.link ? e.link.attributes.href : null,
  }));
}

module.exports = { REGISTRY, has, credentials, status, preview };