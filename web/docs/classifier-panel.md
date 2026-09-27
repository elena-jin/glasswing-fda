# Classifier panel — data status

A **Classifier** section inside the existing **Data status** popup, served by
server-only functions over the linked Supabase project (`supabase-teal-ferry`).
Built against the **actual live schema** (`supabase/glasswing_live_schema_reference.sql`,
reference only — already applied), not a proposed one.

> Builds the read / internal-review / request layer. It does **not** train,
> deploy a model, or run a retraining worker.

## Live schema facts the code obeys

- `tf_normalized_records.id` is **text**, a FK to `tf_source_items.id` (the dataset
  record id). Columns: `schema_version, evidence_text, screened_text, source,
  evidence, context, intake, provenance, eligibility, exclusion_reason, created_at`.
  **No partition, split, case_id, source_item_id or text_screened.**
- **`tf_source_items` owns `data_partition` and `synthetic`.** Live values:
  `train` (1,386 synthetic), `validation` (430 synthetic), `locked_eval`
  (57 real-source), `maude_stress` (214 real-source) — 2,087 rows.
- `tf_reference_labels.record_id` (text PK FK) holds `label/route/potential_mdr/...`.
- `tf_predictions` / `tf_review_decisions` key on `record_id`.
- `tf_model_runs` uses `model_version_id, dataset_version, data_partition,
  parameters, status, metrics`; `data_partition` is a **single** value.
- `tf_training_candidates` hangs off `review_id` (unique FK) with
  `candidate_status IN (pending,approved,rejected,used)`.

## Files

| File | Purpose |
| --- | --- |
| `api/_lib/supabase.js` | Server-only PostgREST client (service-role key) + schema introspection. |
| `api/_lib/partitions.js` | The gate: public = synthetic AND `data_partition IN (train,validation,demo)`; locked_eval/maude_stress internal-only and never trainable; MAUDE recall-only; internal write guard. |
| `api/_lib/metrics.js` | Pure confusion/recall/specificity/FN with honest empty states + provenance. |
| `api/_lib/db.js` | Tolerant queries; joins records to their source item for partition/synthetic. |
| `api/_lib/classifier/*` + `api/classifier.js` | One serverless function routed by `?resource=` (Hobby 12-function cap; external paths preserved by a `vercel.json` rewrite). |
| `assets/classifier.js` | Panel UI. Read-only for the public audience. |
| `tests/*.test.js` | 27 tests: leakage, anonymous writes, training gate, metrics provenance, router. |
| `supabase/glasswing_live_schema_reference.sql`, `supabase/live-schema.json` | Reference DDL + introspected column names. **No migration is needed** — the live schema already supports this (partition lives on source items). |

## Security model

- **No leakage of real-source text.** Public reads are filtered server-side by
  joining to `tf_source_items` and requiring `synthetic = true AND data_partition
  IN ('train','validation','demo')`. Detail, metrics and error paths never
  serialize a `locked_eval` / `maude_stress` row (`record` returns 403 before
  shaping text).
- **No anonymous writes.** `review`, `candidates` (GET and POST) and `retrain`
  require `TF_INTERNAL_TOKEN` **and** a matching `x-tf-internal` header. With no
  token configured they **fail closed** (401). The reviewer id comes from the
  trusted `x-tf-reviewer` header — never from the request body.
- **Service-role key is server-only**; the browser only calls `/api/classifier/*`.
- **No fabrication / no auto-actions:** no synthetic predictions or run metrics,
  no model auto-promotion, no QMS/Jira writes, and a candidate label is never
  treated as a legal complaint/MDR decision.

## Write-auth blocker (explicit)

There is **no real auth/SSO yet**. The internal token is a stopgap so writes are
not public. Real reviewer identity requires an auth proxy/SSO that sets
`x-tf-internal` + `x-tf-reviewer`; until then the panel is read-only for the
public demo and writes fail closed.

## Setup

1. Env already present on Vercel: `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`. Add `TF_INTERNAL_TOKEN` to enable internal
   review (unset ⇒ writes 401). Optional `TF_ADMIN_TOKEN` enables
   `/api/classifier/schema` (else 404).
2. No DB migration required. To expose synthetic rows to the public demo they
   must exist with `synthetic = true` and a public `data_partition`.
3. Tests: `cd web && npm test`.

## Not claimed

The pipeline is not running end to end. There is no retraining worker and no
model API; `/retrain` only writes a `status="pending"` request. Model artifacts
live under `../model/` and are offline-only. ModernBERT/Jev numbers from those
exploratory scripts are **not** live performance and are not hardcoded anywhere.