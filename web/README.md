# Test Flight — Quality &amp; Product Console

A frontend + serverless foundation for turning scattered device and companion-app
feedback into traceable **Quality** and **Product** workflows. This is the
exported, deployable version of the design prototype: same UI, split into a
maintainable structure with a backend integration layer ready to connect.

```
test-flight-app/
├── index.html              # app shell (markup only)
├── assets/
│   ├── styles.css          # full design system + component CSS
│   ├── app.js              # all application logic and rendering
│   ├── data.js             # embedded synthetic dataset (schema v1.1)
│   ├── tf.config.js        # runtime config — flip demo to live here
│   └── backend.js          # fetches /api/bootstrap and hydrates the UI
├── data/
│   └── dataset.json        # single copy of the seed dataset (API reads this)
├── api/                    # Vercel serverless functions (zero dependencies)
│   ├── bootstrap.js  health.js  ideas.js  quality.js
│   ├── qms.js  assistant.js  sources.js  integrations.js
│   └── _lib/{data,http}.js
├── docs/api-contract.md    # endpoint-by-endpoint contract
├── vercel.json  package.json  .env.example  .gitignore
└── README.md
```

**Live (production):** https://test-flight-console-pearl.vercel.app

## Deploy to Vercel

This repo is connected to the Vercel project **`glasswing-fda/test-flight-console`**
with **Root Directory = `web`**, so any push to `main` auto-deploys. To deploy by
hand, run from the **repo root** (not `web/`):

```bash
vercel --prod
```

The project has **no build step and no dependencies** — Vercel serves the static
files and turns everything under `api/` into Node serverless functions.

```bash
cd test-flight-app
npx vercel          # preview deployment
npx vercel --prod   # production
```

Or, from the Vercel dashboard: **Add New → Project → import the repo**, set the
**Root Directory** to `test-flight-app`, and deploy. Framework preset: **Other**.

Run it locally with the same routing as production:

```bash
npx vercel dev
```

## Demo mode vs. live mode

Out of the box the console renders the embedded synthetic dataset and makes no
network calls, so a plain static deploy is fully functional.

To run against a backend, edit **`assets/tf.config.js`**:

```js
window.TF_CONFIG = {
  live: true,          // fetch from the API on load
  apiBase: '',         // '' = same origin (Vercel). Or 'https://api.yourco.com'
  requestTimeoutMs: 8000
};
```

On load, `assets/backend.js` calls `GET /api/bootstrap`, hands the payload to
`TF_DATA.apply()`, and re-renders every view. If the request fails for any
reason it silently falls back to the embedded data — the UI never shows a
broken state.

## Where the real system plugs in

The endpoints in `api/` currently return the seed dataset from
`data/dataset.json`. Replace the body of each handler with your real reads and
the frontend keeps working, because the response shape is unchanged.

| Pipeline stage (brief)      | Replace this                                    |
|-----------------------------|--------------------------------------------------|
| Raw sources                 | `api/sources.js` — Salesforce, Zendesk, email, Slack, Zoom, app reviews |
| AI normalization (v1.1)     | `api/bootstrap.js` — return normalized records   |
| David's classifier          | `api/quality.js` — serve complaint candidates + rationale |
| Quality path (human review) | `api/quality.js` POST — persist reviewer decisions |
| QMS export                  | `api/qms.js` POST — call Veeva/MasterControl/… with real credentials |
| Product path (idea → Jira)  | `api/ideas.js` — theme model output + Jira sync  |
| Assistant                   | `api/assistant.js` — grounded retrieval over the records |

`docs/api-contract.md` documents every request/response, including the field
mapping back to the schema v1.1 data contract.

## Guardrails baked into the demo

- A **"complaint" is only a candidate** for human Quality review — never an
  automated MDR or legal determination.
- The QMS export is a **mock**; the response says so explicitly. Keep the
  human-approval gate in front of any real write.
- No PHI and no live QMS integration are claimed anywhere.
- Owner and CRM mappings are marked **unverified** until a human confirms them.

Set real credentials in `.env` (copy `.env.example`). Never commit `.env`.

## Data model

The dataset follows the brief's **schema v1.1** input contract: `source`,
`evidence`, `context`, `intake`, `provenance`, plus a classifier `label` with
`classification`, `route`, `theme_id`, `review_required`, `potential_mdr` and
`priority_subflags`. Reviewer decisions are kept separate from model output, as
the brief requires. Totals: **1,658 records → 786 product · 624 complaint
candidates · 248 excluded at intake.**