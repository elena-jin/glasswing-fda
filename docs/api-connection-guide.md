# API connection guide — "Where product feedback comes from"

> Source: Instinct hosted file `file-01M3F79MY659D07CD727A5KPHY` (title: *Where product feedback comes from*),
> public preview: https://files.instinct.com/file-01M3F79MY659D07CD727A5KPHY
> Snapshot captured 2026-09-26 for the weekend build. Lists the real APIs, scopes,
> webhooks, rate limits and honest fallbacks for each feedback source, plus the
> store/classifier/destination wiring and the end-to-end demo path.

## Start here
The fast path is one real intake plus a seeded dataset, not six rushed integrations. Run a Next.js approval queue on Vercel, import selected v1.3 records (schema v1.1) into a local fixture or Supabase, connect a dedicated Gmail inbox or one Slack development workspace, then send approved product feedback to a demo Jira project. Keep the other provider screens explicitly marked as synthetic fixtures until credentials, scopes and tenant permissions are tested. Never put API secrets in the browser bundle or this public page.

### The Quality boundary
Current build plan · Dataset v1.3 · Separate MAUDE stress set · Label rubric · Complaint/MDR criteria · Team repository.
- [Current build plan](https://docs.google.com/document/d/17-EiNFrVUSx5IhAOpgpbRqSdip3z43U6UON7MdbacKs/edit)
- [Dataset v1.3](https://drive.google.com/file/d/1nDVeHHPvCvbMmNpUMDrRn_rMdULGZiiN/view?usp=drivesdk&authuser=skhizarkashif%40gmail.com)
- [Separate MAUDE stress set](https://drive.google.com/file/d/15PKPFaaFprKhbey4sktcmXmLD4xVyQQH/view?usp=drivesdk&authuser=skhizarkashif%40gmail.com)
- [Label rubric](https://docs.google.com/document/d/1EI0Lv22yiv1tW-5ug7JP5y92TYkPXBcH7_tvjpMbfb8/edit)
- [Complaint/MDR criteria](https://docs.google.com/document/d/1t7T9wuO5pwriyNiiH-iLn-p5AKFqDOpztnPgUWeCU18/edit)
- [Team repository](https://github.com/elena-jin/glasswing-fda)

## Data contract and orchestration
- 1. Acquire — Take a source-native ID, URL, timestamp, actor and exact excerpt. Preserve the raw item and its permissions. An event webhook is a wake-up signal; retrieve the full item by API after verifying its signature. Poll by cursor when there is no webhook.
- 2. Normalize — Map into the current v1.1 input schema, including source_type and provenance. Validate required fields, keep unknown speaker or device version unknown, and dedupe by source + ID + fragment. Keep original text separate from inferred values.
- 3. Classify — Return classification (complaint / product_feedback / excluded), route, theme_id, review_required, reason, potential_mdr and priority_subflags. Reject malformed output. Log model version, prompt/rubric version, timestamp and reviewer action.
- 4. Review and hand off — Quality sees possible complaint and potential MDR candidates; Product sees feedback. Human approval precedes any Jira or QMS write. Preserve evidence links and an immutable decision event. A mock QMS export is not a real QMS integration.
The current v1.3 combined dataset has 1,873 records: 1,402 train and 471 held-out eval. It preserves the original v1.1 input schema and all 1,693 v1.2 records and splits, then adds 180 hard boundary records (115 complaint, 65 product_feedback; 150 authored adversarial and 30 real MAUDE narratives). Ninety of the new records are held out, including all 30 real cases; 30 contrast pairs stay wholly within their respective split. Train only on split=train. Keep eval out of training and threshold tuning. The separate 214-report MAUDE stress set is eval-only and is not included in the 1,873; it is complaint-only, selected rather than representative, and cannot test false alarms. Real MAUDE narratives are unverified allegations, their labels are provisional human-review routing candidates, and automated redaction is not a privacy guarantee. Report scores separately; repeated synthetic wording and a thin real mixed set do not establish deployment accuracy. Seed only a small synthetic subset into vendor demo accounts, never real MAUDE narratives.
- [v1.3 combined dataset](https://drive.google.com/file/d/1nDVeHHPvCvbMmNpUMDrRn_rMdULGZiiN/view?usp=drivesdk&authuser=skhizarkashif%40gmail.com)
- [214-report MAUDE stress set](https://drive.google.com/file/d/15PKPFaaFprKhbey4sktcmXmLD4xVyQQH/view?usp=drivesdk&authuser=skhizarkashif%40gmail.com)

## Source APIs
- 1. Salesforce Cases and EmailMessage — OAuth 2.0 Connected App (or current External Client App configuration) in a developer org; least-privilege API access. REST /services/data/vXX.X/query?q=... for SOQL, /sobjects/Case/{id}; related EmailMessage where permitted. Change Data Capture/Platform Events can push changes if configured, otherwise poll SystemModstamp. Developer org is the test path; exact objects and fields vary by tenant. API budget is org/edition/license dependent: inspect the Limits resource and Sforce-Limit-Info header, handle 403/429 and backoff. Do not create a production customer connector from a demo org.
- 2. Zendesk tickets and comments — OAuth or scoped API token in a trial/test tenant. GET /api/v2/tickets/{id}.json and /api/v2/tickets/{id}/comments.json; incremental ticket and ticket-event exports with cursor/time watermark for catch-up. Ticket-event webhooks notify a receiver, then fetch full ticket. Suite Team/Growth/Professional/Enterprise Support API examples: 200/400/400/700 requests per minute; incremental exports have a separate 10/min limit. Observe response rate headers and Retry-After. A temporary trial may expire; a sandbox is plan-dependent.
- 3. Intercom conversations or tickets (Zendesk alternative) — Use an app access token for your own private development workspace; use OAuth with read conversations/read tickets scopes for a public multi-workspace app. GET https://api.intercom.io/conversations with cursor pagination and GET /conversations/{id} for message parts (up to 500 returned); GET /tickets/{id} or POST /tickets/search where the tenant uses tickets. Pass an explicit Intercom-Version header and preserve conversation/ticket ID, contact, timestamps, body and part authorship. Subscribe to conversation.user.replied / conversation.admin.replied or ticket.created webhooks, verify X-Hub-Signature, then fetch the full item; polling paginated conversations is fine for a small demo. A free US-only development workspace is available for test apps, but cannot become production, has a 20 contact limit and no outbound email/push. The documented default is 10,000 API calls/min/app and 25,000/min/workspace, allocated in 10-second windows; handle 429 and the rate headers. Seed a few synthetic conversations only, or mock this branch if no dev workspace is set up.
- 4. Granola meeting notes — Bearer API key, scoped to visible notes. GET https://public-api.granola.ai/v1/notes with date cursor; GET /v1/notes/{note_id}?include=transcript, or paginated /transcript for large notes. The API returns notes only once both AI summary and transcript are generated. Webhooks on Business/Enterprise notify note changes. API keys require Business membership (workspace keys can be admin-managed); this is not a free-demo assumption. Published burst 25/5s, sustained 5/s; 429 on excess. Mock Granola if no qualifying plan and authorized synthetic note.
- 5. Dedicated feedback Gmail — Create/use a dedicated inbox with Google OAuth 2.0 and the narrowest Gmail read scope; users.messages.list/get and users.history.list for messages, IDs, headers, MIME and thread. For push, users.watch → Cloud Pub/Sub → history.list; renew the watch at least every seven days and recover from missed push with periodic history sync. Poll messages.list for a weekend demo if Pub/Sub setup takes too long. Quota uses per-method units rather than one universal requests/minute number; see official table. Do not use a personal or work inbox as customer feedback without separate permission; use synthetic messages only.
- 6. Slack feedback channel — Workspace app OAuth with least-privilege channel history and event scopes. Subscribe to message events (or Socket Mode in development), verify signing secret and dedupe event_id; fetch thread context via conversations.replies and history if needed. Slack event delivery needs a timely acknowledgement and retry-safe processing. Rate limits are per-method tiers and 429 Retry-After; internal customer-built apps are not subject to the new 1/min history cap that applies to newly distributed unlisted commercial apps. Use a private test workspace/channel and synthetic posts.
- 7. Zoom Meetings recordings — Meeting-host/user OAuth or server-to-server OAuth where the account admin grants scopes. recording.completed webhook, then GET /users/{userId}/recordings or /meetings/{meetingId}/recordings for cloud recording files; identify transcript VTT and meeting chat TXT if produced. Cloud recording and transcription depend on account plan, host settings and consent, so a free Basic demo cannot presume transcripts. Verify webhook authenticity, retry downloads and use response rate headers/429. Mock a consented synthetic transcript when recording is unavailable.
- [Salesforce REST](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_rest.htm)
- [OAuth](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_oauth_and_connected_apps.htm)
- [Case fields](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_case.htm)
- [limits](https://developer.salesforce.com/blogs/2024/11/api-limits-and-monitoring-your-api-usage)
- [Zendesk tickets](https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/)
- [incremental exports](https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/)
- [webhooks](https://developer.zendesk.com/api-reference/webhooks/introduction/)
- [limits](https://developer.zendesk.com/api-reference/introduction/rate-limits/)
- [Intercom conversations](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/listconversations)
- [retrieve/parts](https://developers.intercom.com/docs/references/2.14/rest-api/api.intercom.io/conversations/retrieveconversation)
- [tickets](https://developers.intercom.com/docs/references/2.14/rest-api/api.intercom.io/tickets)
- [webhook topics and signatures](https://developers.intercom.com/docs/references/webhooks/webhook-models)
- [free developer workspace](https://developers.intercom.com/docs/build-an-integration/getting-started)
- [OAuth](https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/setting-up-oauth)
- [rate limits](https://developers.intercom.com/docs/references/rest-api/errors/rate-limiting)
- [Granola access, limits and examples](https://docs.granola.ai/introduction)
- [note/transcript](https://docs.granola.ai/api-reference/get-note)
- [webhooks](https://docs.granola.ai/webhooks)
- [Gmail push](https://developers.google.com/workspace/gmail/api/guides/push)
- [scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [quota](https://developers.google.com/workspace/gmail/api/reference/quota)
- [Slack events](https://api.slack.com/events-api)
- [history](https://api.slack.com/methods/conversations.history)
- [rate limits](https://api.slack.com/apis/rate-limits)
- [2025 exception](https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq)
- [Zoom webhooks](https://developers.zoom.us/docs/api/webhooks/)
- [cloud recording](https://developers.zoom.us/docs/build/cloud-recording/)
- [OAuth](https://developers.zoom.us/docs/internal-apps/s2s-oauth/)
- [limits](https://developers.zoom.us/docs/api/rate-limits/)

## Store, model and destinations
- 1. Supabase/Postgres (optional) — Use a free development project if persistence matters; PostgREST exposes /rest/v1/{table} with project URL and publishable/anon key. Row-level security protects user-facing access; service-role keys only server-side. Database webhooks/realtime can update queue screens, or simply refetch. Free plan quotas and inactivity behavior can change; inspect current plan before relying on it. SQLite or local JSON is faster for a static mock.
- 2. Classifier API — The current plan has David building the classifier; there is no confirmed deployed model endpoint. Define a server-only POST /api/classify receiving one v1.3 dataset input (schema v1.1) and returning the seven rubric fields. Start with a deterministic fixture lookup or a validated model response, then swap David's endpoint. If using Anthropic Messages API, pass x-api-key and anthropic-version from the server, POST /v1/messages, validate structured output and log token/usage; API is metered and has tier/model-specific request and token limits, so no charge-bearing calls without approval. AI SDK is an application library, not a provider key or a standalone model API.
- 3. Jira Product handoff — Jira Cloud free demo project if available. OAuth 2.0 3LO (or API token for an internal prototype only) and POST /rest/api/3/issue with project, issuetype, summary and Atlassian Document Format description; GET the issue after writing. Only human-approved product items go here, with source/evidence IDs, never sensitive transcript text by default. No webhook needed for one-way demo; Jira webhooks are useful for status sync later. Limits include points, bursts and tenant-specific budgets: honor 429 Retry-After, not a hardcoded requests/minute assumption.
- 4. Vercel frontend — Connect the existing GitHub team repo to a Vercel project; a deployment can be Git-triggered, or use bearer token and Vercel Deployments REST API. Set server-only environment variables in the project, never NEXT_PUBLIC_ for provider secrets. Hobby tier can support a noncommercial hackathon mockup, subject to published plan/usage limits; do not upgrade or add a card. Vercel deploy webhooks are for deployment events, not customer intake. The live team's hosting account and repo permissions must be confirmed before connecting.
- 5. QMS handoff — No QMS vendor or authorized tenant has been selected, so there is no universal endpoint, OAuth scope, sandbox, webhook or rate limit to document honestly. Build an export packet JSON + review audit event and show a disabled/clearly labeled 'QMS export (mock)' action. If a specific eQMS is named later, inspect its vendor API, contract, tenant roles, test environment and approved write workflow before turning on a connector.
- [Supabase auto API](https://supabase.com/docs/guides/api)
- [RLS/security](https://supabase.com/docs/guides/api/securing-your-api)
- [Anthropic Messages](https://docs.anthropic.com/en/api/messages)
- [model-specific rate limits](https://docs.anthropic.com/en/api/rate-limits)
- [API pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
- [AI SDK structured output](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- [Jira issues API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)
- [rate limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)
- [Vercel REST](https://vercel.com/docs/rest-api)
- [tokens](https://vercel.com/docs/accounts/access-tokens)
- [environment variables](https://vercel.com/docs/rest-api/projects/create-one-or-more-environment-variables)
- [limits](https://vercel.com/docs/limits)

## The weekend demo path
- 1. Make the repository the source of truth — Use the team's existing glasswing-fda repo, after confirming collaborator rights and who owns the Vercel project. OpenCode gets the README, build plan, this guide, schema, rubric and dataset. Do not start a second repo or deploy into someone else's account by assumption.
- 2. Seed a controlled fixture — Read dataset v1.3 (input schema v1.1), select a handful of synthetic train records with different labels and a cross-source story; do not expose the held-out eval labels in an app that purports to score the model. Store synthetic source payloads with reserved example identities and explicit 'Synthetic demo data' badges. Import into local JSON or a free Supabase dev project if persistence is useful.
- 3. Prove one real connector — Best first live path: a dedicated feedback Gmail test inbox with two synthetic messages and OAuth, or a private Slack dev channel with an internal app. For Gmail, polling is sufficient for a weekend; for Slack, event subscription is useful but needs a reachable endpoint. Show its source ID and link in the review queue. Never connect a personal/work inbox or private meeting notes as a shortcut.
- 4. Keep expensive/blocked feeds honest — Salesforce developer org and Zendesk trial can be seeded only if signup succeeds and terms permit; an Intercom developer workspace is a free alternative for a few synthetic support conversations. Otherwise use adapter-shaped fixtures. Granola API needs Business; Zoom cloud transcripts need recording entitlements and settings. Mock them with source-specific payloads, labeled synthetic. Do not claim real sync from a provider you never connected.
- 5. Demonstrate the decision — Normalize → classify → show exact quote, uncertain fields, reasoning and potential_mdr flag → human approves or overrides. Product approval can write one synthetic Jira issue in a demo project; Quality approval creates a downloadable mock packet only. Re-read the issue after the write and capture the audit event. A replay button should be idempotent.
- 6. Deploy without leaking secrets — Next.js UI on Vercel with server routes for provider calls, env vars in project settings, preview deployment inspected on mobile and desktop. Use rate-limit backoff, scoped synthetic accounts, and a visible connector-status panel: live/test fixture/not configured. No paid Anthropic usage, SaaS upgrade or real provider signup that requests a card without a separate decision.
