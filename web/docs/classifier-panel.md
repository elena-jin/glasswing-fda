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

## Migration review — `0001_classifier_schema.sql`

- **Additive + idempotent**: `create table if not exists` and only adds indexes,
  RLS enable and `revoke`s. It never drops or renames.
- **RLS**: enabled on all 14 tables, **no** `anon`/`authenticated` policies and
  explicit `revoke` → the publishable key reads nothing. Service role bypasses.
- **Verify before/after.** Apply with `supabase db push` (or paste into the SQL
  editor), then diff against the live columns (see below).

## Setup steps

1. **Env (Vercel → Project → Settings → Environment Variables; both Production
   and Preview).** Already present per the task: `SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Optional:
   - `TF_INTERNAL_TOKEN` — enables the internal audience (real/MAUDE). Unset ⇒
     everything is public/synthetic-only.
   - `TF_ADMIN_TOKEN` — enables `/api/classifier/schema`. Unset ⇒ endpoint 404s.
2. **Apply the migration**: `supabase db push` (or run the SQL in the Supabase
   SQL editor). Confirm RLS is on for all `tf_*` tables.
3. **Local**: copy `.env.example`, fill Supabase vars, run `vercel dev` from the
   repo root, open **Data status → Classifier**.
4. **Tests**: `cd web && npm test`.

## Blockers (explicit)

1. **Live schema not readable from the build environment.** Vercel masks secret
   values on `vercel env pull`, so the service key was unavailable locally and
   the 14 tables could not be introspected before writing migrations. The
   migration is written additively so it is safe either way, but it **must be
   reconciled**: run
   `select table_name, column_name, data_type from information_schema.columns where table_name like 'tf_%' order by 1,2`
   and diff against `0001_classifier_schema.sql`, then patch.
   (Alternative: set `TF_ADMIN_TOKEN`, deploy a Preview, and
   `GET /api/classifier/schema` with header `x-tf-admin: <token>`.)
2. **No retraining worker.** `POST /api/classifier/retrain` only writes a
   `status=requested` row. A server-side job (queue + container, not Vercel
   functions) must consume it, run ModernBERT/Jev offline, write an immutable
   `tf_model_runs` artifact, and pass the held-out eval gate. Not in this PR.
3. **No real auth/SSO.** `reviewer` / `actor` are self-declared. Review writes
   are partition-gated, but real reviewer identity needs SSO + RBAC.
4. **Model numbers are not live.** ModernBERT (99.4% recall / 87% specificity)
   and Jev (99.3% / 93%) come from exploratory Drive scripts. They are **not**
   hardcoded anywhere here; the panel shows only metrics computed from
   `tf_predictions` that exist.
5. **Synthetic data load.** The panel is correct when empty (honest states).
   Once the synthetic rows are loaded, metrics/predictions will populate.

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