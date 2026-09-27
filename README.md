# Prism

Prism turns scattered patient feedback from support channels into a human-reviewed
FDA-complaint queue plus pod-owned product ideas mapped to the roadmap, for Quality /
postmarket and product leads at connected medical-device companies.

Live: **https://test-flight-console-pearl.vercel.app/** (repository: `glasswing-fda`)

## How it works

1. **Collect.** Source adapters cover Salesforce, email, Zendesk, Slack, Zoom/Granola
   transcripts, Intercom, app-store reviews and public scrapers.
2. **Standardize.** An OpenCode-hosted model normalizes each raw item into one JSON
   record (schema v1.1) and strips PII before the item reaches any model.
3. **Classify.** A trained ModernBERT + MLP classifier labels each item `complaint`
   or `product_feedback`.
4. **Quality path.** Complaint candidates go to a human reviewer who either
   **approves** (routes a packet toward a QMS such as Veeva) or **denies** (returns it
   to product feedback). Nothing is filed automatically.
5. **Product path.** Product feedback, combined with company structure (pods and a
   feature map), is grouped by OpenCode into **ideas**, each owned by one pod, and
   mapped against the product team's **Jira roadmap** as evidence.
6. **Ask.** An assistant lets teams chat over the feedback with recency and
   post-launch filters and citations back to source records.

AI flags and drafts. Humans make every FDA / compliance decision.

## Real vs mocked

| Area | Status | Notes |
| --- | --- | --- |
| Console app (`web/`) | **Live** | Vercel, root directory `web`, no build step, auto-deploys on push to `main`. |
| Supabase data | **Live** | `tf_*` tables; partitions `train` / `validation` / `locked_eval` / `maude_stress`; synthetic rows labeled. Public APIs return only synthetic `train`/`validation`/`demo`. |
| Grounded chat | **Live** | Groq `openai/gpt-oss-20b` with citations; server-side scope gate; returns "I don't know" when evidence is weak. |
| Braintrust tracing | **Live (opt-in)** | Metadata only: request id, scope, citation ids, model, tokens, latency, score. Trace-only, no prompt/output text. |
| Review / retrain loop | **Live (human-gated)** | Reviewers reclassify complaint vs product; corrections queue a retraining request. Training runs server-side behind a held-out eval gate; a human promotes. |
| Classifier eval (`model/`) | **Offline** | ModernBERT + MLP: 99.43% recall on a 1,300-case locked dev test, threshold 0.167. Dev data, not production performance; the model is not deployed live. |
| Source connectors | **Mocked** | Synthetic demo data. Badges report `stub`, `configured, untested`, or `not connected`; credential values are never returned. |

## Repo layout

| Path | Contents |
| --- | --- |
| `web/` | The app and its serverless functions (`web/api/*`). `web/data/dataset.json` is the seed; `web/scripts/gen_dataset.py` regenerates it. |
| `assistant/` | Grounded assistant backend (retrieval over classified feedback). |
| `normalizer/` | Normalization layer: raw reports to schema v1.1, PII screening. |
| `pipeline/` | Source-adapter standardization layer and intake gate. |
| `model/` | Offline classifier experiments and artifacts (ModernBERT/Jev). |
| `braintrust/` | Evaluation harness (synthetic-only dataset, citation/refusal scorers). |
| `docs/` | Reference notes, rubrics, and data-boundary documentation. |

## Setup

- **Deploy.** Vercel project with **root directory = `web`**, framework preset
  **Other**, no build step. Pushing to `main` auto-deploys.
- **Local.** From the repository root: `npx vercel dev`.
- **Environment.** All variables are listed in `web/.env.example` (Supabase,
  Groq chat, Braintrust, smoke token). Set them in Vercel project settings for
  Production and Preview. Nothing is committed.
- **Tests.** `cd web && npm test`.

## Guardrails

- No PHI. Records are synthetic and public/de-identified; the app is a synthetic demo.
- No real evaluation texts are committed to the repository.
- No automatic MDR or legal determinations. Every complaint and quality decision is
  made by a human.
- No API keys, tokens, or secrets in the repository or in client code.