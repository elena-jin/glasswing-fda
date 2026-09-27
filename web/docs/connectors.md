# Connecting the real tech stack

The console runs on a **synthetic dataset by default** (fictional company
*Aeris Health*). A source becomes **live** the moment its credentials exist as
environment variables — no code change, no redeploy of the UI. Until then the
source is labelled `synthetic` everywhere in the app.

```
                 ┌─────────────────────────── Vercel env vars (server-side only)
 browser ──GET──▶ /api/bootstrap ──▶ dataset + connector mode (live | synthetic)
         ──GET──▶ /api/connectors ──▶ which env vars exist / are missing
         ──POST─▶ /api/connectors   ──▶ read-only preview from the real source
```

Nothing in this layer **writes** to a source system. Connectors only read the
most recent few items and normalize them to `{ t, when, label, src, url }`.

## Which env vars each connector needs

| id | Auth | Environment variables |
|----|------|-----------------------|
| `zoom` | Server-to-Server OAuth | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` |
| `slack` | Bot token | `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` |
| `gmail` | OAuth 2.0 refresh token | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` |
| `zendesk` | API token | `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN` |
| `intercom` | Access token | `INTERCOM_ACCESS_TOKEN` |
| `appstore` | Public (no key) | `APPSTORE_APP_ID` (+ optional `APPSTORE_COUNTRY`, default `us`) |
| `salesforce` | OAuth 2.0 | `SALESFORCE_INSTANCE_URL`, `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET`, `SALESFORCE_REFRESH_TOKEN` |

`GET /api/connectors` returns, per connector, `{ configured, auth, env, missing }`
so you can see exactly what is still needed.

## Zoom (meeting transcripts)

1. Sign in at <https://marketplace.zoom.us> → **Develop → Build App**.
2. Choose **Server-to-Server OAuth** (no user redirect, ideal for a backend).
3. Name it e.g. `Test Flight Feedback`; copy the **Account ID**,
   **Client ID**, **Client Secret**.
4. Scopes → add `cloud_recording:read:list_user_recordings`,
   `user:read:user` (read-only). Activate the app.
5. Set `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`.

Note: the recordings list is empty until the account has at least one cloud
recording. Use a test meeting, record to the cloud, then re-check.

## Slack (VoC / beta channels)

1. <https://api.slack.com/apps> → **Create New App → From scratch**.
2. **OAuth & Permissions** → Bot token scopes: `channels:history`,
   `channels:read` (add `groups:history` for private channels).
3. Install to the workspace, copy the **Bot User OAuth Token** (`xoxb-…`).
4. Invite the bot to the channel: `/invite @YourApp` in `#voice-of-customer`.
5. Set `SLACK_BOT_TOKEN`. For `SLACK_CHANNEL_ID`, open the channel → copy the
   `C…` id from the URL, or call `conversations.list`.

## Gmail (support inbox)

1. Google Cloud Console → enable the **Gmail API**.
2. **APIs & Services → Credentials → Create OAuth client ID** (type: Web /
   Desktop). Copy client id + secret.
3. Get a **refresh token** with scope `https://www.googleapis.com/auth/gmail.readonly`
   — easiest via the OAuth 2.0 Playground (gear icon → use your own credentials),
   or a one-off loopback flow. Keep it out of git.
4. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`.
   Use a dedicated test inbox, never a mailbox with PHI.

## Zendesk

1. Admin Center → **Apps and integrations → APIs → Zendesk API** → enable
   token access; create an API token.
2. Set `ZENDESK_SUBDOMAIN` (the part before `.zendesk.com`), `ZENDESK_EMAIL`
   (the admin email), `ZENDESK_API_TOKEN`.

## Intercom

1. <https://app.intercom.com> → **Settings → Integrations → Developer Hub** →
   create an app; copy the **Access Token**.
2. Set `INTERCOM_ACCESS_TOKEN`.

## App Store reviews (public)

1. Find the numeric app id in the App Store URL: `.../id1234567890`.
2. Set `APPSTORE_APP_ID` (and `APPSTORE_COUNTRY` if not `us`). No key needed.

## Salesforce (case + account context)

Read-only case pull is left as an adapter stub (`fetch: null`). Wire it when you
have a Connected App with the `api` scope and a refresh token, then set the four
`SALESFORCE_*` variables. Owner/CRM context is always shown as **UNVERIFIED**
until a human confirms it.

## Setting the variables

- **Vercel:** Project → Settings → Environment Variables → add each key for the
  Production (and Preview) environment, then redeploy.
- **Local:** copy `.env.example` to `.env` and run `vercel dev` from the repo
  root. `.env*` is git-ignored — never commit credentials.

## Verifying

```bash
curl -s "$SITE/api/connectors" | python3 -m json.tool      # what is configured
curl -s -X POST "$SITE/api/connectors" -H 'content-type: application/json' \
     -d '{"id":"zoom"}' | python3 -m json.tool             # live preview
```

## Guardrails (unchanged)

- A "complaint" is only a **candidate for human Quality review** — the live
  connectors do not classify, file, or resolve anything.
- No auto-filed MDRs, no writes to a QMS, no PHI. Use test/demo accounts.
- Keep every claim traceable to a source item; the UI shows provenance on each
  evidence quote.