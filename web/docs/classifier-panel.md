# Classifier panel — data status

Adds a **Classifier** section to the Data status popup that reads the linked
Supabase project (`supabase-teal-ferry`) through serverless functions, plus the
server-side data layer, migrations and tests behind it.

> This PR builds the **read + review + request** path. It does **not** run the
> model and does **not** claim the pipeline is running. See *Blockers*.

## What was built

| File | Purpose |
| --- | --- |
| `api/_lib/supabase.js` | Server-only PostgREST client (service-role key from env). Also `introspect()` for schema recon. |
| `api/_lib/partitions.js` | The partition gate: public=synthetic only; internal=all; MAUDE recall-only; locked eval blocked from training. |
| `api/_lib/metrics.js` | Pure confusion-matrix / precision / recall / specificity / FN math with honest empty states and provenance. |
| `api/_lib/db.js` | Tolerant query helpers (missing table → honest `{ok:false,error}`). |
| `api/classifier/summary.js` | Per-run metrics for runs that exist; offline labelled; MAUDE recall-only. |
| `api/classifier/records.js` | Partition-filtered record list. |
| `api/classifier/record.js` | One record: provenance, text, reference, predictions, reviews, candidate status. |
| `api/classifier/review.js` | Save review/correction + audit event; optional pending training candidate. |
| `api/classifier/candidates.js` | List / approve / revoke training candidates (locked eval refused). |
| `api/classifier/retrain.js` | Enqueue an immutable retraining request with a held-out eval gate. |
| `api/classifier/schema.js` | Guarded (`x-tf-admin`) live-schema recon. |
| `assets/classifier.js` | The panel UI (metrics cards, record list, detail, review form, candidate + retrain actions). |
| `supabase/migrations/0001_classifier_schema.sql` | Idempotent, additive schema reconciliation for the 14 `tf_*` tables. |
| `tests/*.test.js` | 24 tests incl. partition leakage, review writes, training approval, metrics provenance. |

Wire-up: `assets/app.js` `renderData()` calls `window.renderClassifierPanel()`;
`index.html` adds the panel markup + `assets/classifier.js`.

## Security model

- **Service-role key is server-only.** `api/_lib/supabase.js` runs inside
  serverless functions; `assets/classifier.js` only calls `/api/classifier/*`.
  No key or token is ever sent to the browser.
- **Partition filtering is server-side.** The public demo can only receive the
  synthetic partitions. Requesting a non-visible partition returns **403**, not
  an empty list (so a gate failure can't be mistaken for "no data").
- **Internal audience fails closed.** Without `TF_INTERNAL_TOKEN`, `audience()`
  is always `public`. Real/non-synthetic eval text requires the internal token.
- **No auto-actions.** No model promotion, no QMS/Jira record creation, no
  training — those are queued or human-gated.

## Migration review — `0001_classifier_reconciliation.sql`

Written **after** reading the live schema (captured to `supabase/live-schema.json`
via the guarded `/api/classifier/schema` endpoint). The 14 `tf_*` tables already
existed with a different layout than a green-field design would use, so this
migration is a **reconciliation**, not a creation:

- **Additive + idempotent**: `add column if not exists` only. It never drops,
  renames or rewrites data.
- **What it adds** (the few columns the gate/metrics need that the live tables
  lack): `tf_normalized_records.data_partition`, `tf_normalized_records.split`,
  `tf_model_runs.run_type`, `tf_reference_labels.split`; plus supporting indexes.
- **RLS**: (re)enabled on all 14 tables; `revoke all ... from anon, authenticated`
  → the publishable key reads nothing. Service role bypasses.
- **NULL `data_partition` is treated as non-public (fail closed)** until
  backfilled from the source/provenance shape.

Live column mapping the API is coded against (from `live-schema.json`):
`tf_normalized_records(screened_text, evidence_text, context, provenance, data_partition*, split*)`,
`tf_reference_labels(record_id, label, potential_mdr, split*)`,
`tf_predictions(record_id, run_id, model_version_id, predicted_label, confidence, threshold, route)`,
`tf_review_decisions(record_id, reviewer_id, final_label, override_reason, decision_at)`,
`tf_training_candidates(review_id, candidate_status)`,
`tf_model_runs(model_version_id, dataset_version, data_partition, parameters, metrics, run_type*)`,
`tf_audit_events(actor_id, event_type, object_type, object_id, detail)`. (*) added here.

## Setup steps

1. **Env (Vercel → Project → Settings → Environment Variables; both Production
   and Preview).** Already present per the task: `SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Optional:
   - `TF_INTERNAL_TOKEN` — enables the internal audience (real/MAUDE). Unset ⇒
     everything is public/synthetic-only.
   - `TF_ADMIN_TOKEN` — enables `/api/classifier/schema`. Unset ⇒ endpoint 404s.
2. **Apply the migration**: `supabase db push` (or run the SQL in the Supabase
   SQL editor). Confirm RLS is on for all `tf_*` tables.
3. **Backfill `data_partition`** on existing normalized records (from the
   source/provenance shape) so the public filter can see synthetic rows.
4. **Local**: copy `.env.example`, fill Supabase vars, run `vercel dev` from the
   repo root, open **Data status → Classifier**.
5. **Tests**: `cd web && npm test`.

## Verified against the live database

Preview deployment probed against `supabase-teal-ferry` (public audience):

| Call | Result |
| --- | --- |
| `GET /api/classifier/summary` | `{ok:true, runs:[], empty:true, reason:"no_runs"}` — honest, no fake numbers |
| `GET /api/classifier/records` | `{ok:true, data:[], error:"supabase_400"}` — **because `data_partition` does not exist until migration 0001 is applied** |
| `GET /api/classifier/candidates` | `{ok:true, count:0, empty:true}` — table read fine |
| `GET /api/classifier/schema` without token | **404** (fail closed) |
| `GET /api/classifier/record` without id | **400** |
| `GET /api/classifier?resource=nope` | **404** |

So the layer is wired to the real DB and degrades honestly; the only thing
standing between it and populated records is applying migration 0001 and
backfilling `data_partition`.

## Blockers (explicit)

1. **Migration 0001 not yet applied.** Verified live: `tf_normalized_records`
   has no `data_partition`/`split`, so `records` returns `supabase_400` until the
   migration runs and partitions are backfilled. (Pipeline not claimed running.)
2. **No retraining worker.** `POST /api/classifier/retrain` only writes a
   `status="requested"` row. A server-side job (queue + container, not Vercel
   functions) must consume it, run ModernBERT/Jev offline, write an immutable
   `tf_model_runs` artifact, and pass the held-out eval gate.
3. **No real auth/SSO.** `reviewer` / `actor` are self-declared. Review writes
   are partition-gated, but real reviewer identity needs SSO + RBAC.
4. **Model numbers are not live.** ModernBERT (99.4% recall / 87% specificity)
   and Jev (99.3% / 93%) come from exploratory Drive scripts. They are **not**
   hardcoded anywhere here; the panel shows only metrics computed from
   `tf_predictions` that exist.
5. **Synthetic data load + partition backfill** pending.

## API contract (added)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/classifier/summary` | per-run confusion matrix + metrics; offline labelled; empty state |
| GET | `/api/classifier/records?limit&offset&partition&split&label` | partition-filtered (public ⇒ synthetic) |
| GET | `/api/classifier/record?id=` | one record + predictions + reviews + candidate |
| POST | `/api/classifier/review` | `{normalized_record_id, reviewer, decision, corrected_label?, reason?, create_candidate?}` |
| GET/POST | `/api/classifier/candidates` | list; `{id, action: approve\|revoke, actor}` |
| POST | `/api/classifier/retrain` | `{eval_split, train_partitions?, model_version?, created_by}` → 202 request |
| GET | `/api/classifier/schema` | guarded recon (`x-tf-admin`) |

## Not claimed

The pipeline is **not** running end to end. This is the reviewable read/review/
request layer, its tests, the migration, and a precise list of what remains.