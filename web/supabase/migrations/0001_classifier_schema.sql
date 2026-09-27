-- Test Flight classifier schema — reconciliation migration
-- Project: supabase-teal-ferry (linked to Vercel project glasswing-fda/test-flight-console)
--
-- STATUS: this migration is written to be idempotent and ADDITIVE so it can be
-- applied safely whether the tables already exist (they do — 14 tables were
-- created out of band) or not. It does NOT drop or rename anything.
--
-- ACTION REQUIRED (blocker, see docs/classifier-panel.md): the live column
-- layout could not be read from the build environment because Vercel masks the
-- service-role key. Run `select * from information_schema.columns where
-- table_name like 'tf_%'` against the live DB, or apply this migration with
-- `supabase db push`, then diff. `alter table ... add column if not exists`
-- makes the second run a no-op if the live schema already matches.
--
-- Security: RLS is enabled on every table and NO policies are granted to `anon`
-- or `authenticated`. The public site therefore cannot read any of this. All
-- reads/writes go through serverless functions using the service-role key.

create extension if not exists pgcrypto;

-- 1. Raw source items (as ingested, before normalization) ---------------------
create table if not exists tf_source_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  native_id text,
  occurred_at timestamptz,
  provenance jsonb default '{}'::jsonb,
  synthetic boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. Normalized records (schema v1.1/v1.2 input to the classifier) ------------
create table if not exists tf_normalized_records (
  id uuid primary key default gen_random_uuid(),
  source_item_id uuid references tf_source_items(id) on delete set null,
  case_id text unique,
  schema_version text default '1.1',
  text_screened text,            -- screened text only; never raw PHI
  product text,
  app_version text,
  partition text not null default 'synthetic',  -- synthetic | synthetic_train | synthetic_eval | real | real_eval | maude
  split text default 'train',    -- train | eval
  synthetic boolean not null default true,
  created_at timestamptz not null default now()
);

-- 3. Reference (human) labels -------------------------------------------------
create table if not exists tf_reference_labels (
  id uuid primary key default gen_random_uuid(),
  normalized_record_id uuid references tf_normalized_records(id) on delete cascade,
  label text not null,           -- complaint | product_feedback | excluded
  potential_mdr boolean default false,
  theme_id text,
  split text default 'train',
  rater text,
  created_at timestamptz not null default now()
);

-- 4. Model versions (immutable) ----------------------------------------------
create table if not exists tf_model_versions (
  id text primary key,           -- e.g. modernbert-gate-v1
  family text,
  notes text,
  is_promoted boolean not null default false,
  created_at timestamptz not null default now()
);

-- 5. Model runs (offline or live; immutable artifacts) ------------------------
create table if not exists tf_model_runs (
  id uuid primary key default gen_random_uuid(),
  model_version text references tf_model_versions(id) on delete set null,
  run_type text not null default 'offline',   -- offline | live
  eval_split text,
  threshold numeric,
  metrics jsonb default '{}'::jsonb,          -- confusion matrix etc.
  status text not null default 'requested',   -- requested | running | succeeded | failed
  artifact_uri text,
  created_by text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- 6. Predictions --------------------------------------------------------------
create table if not exists tf_predictions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references tf_model_runs(id) on delete cascade,
  normalized_record_id uuid references tf_normalized_records(id) on delete cascade,
  predicted_label text not null,
  confidence numeric,
  threshold numeric,
  route text,
  created_at timestamptz not null default now()
);

-- 7. Human review decisions (audit trail of overrides) ------------------------
create table if not exists tf_review_decisions (
  id uuid primary key default gen_random_uuid(),
  normalized_record_id uuid references tf_normalized_records(id) on delete cascade,
  prediction_id uuid references tf_predictions(id) on delete set null,
  reviewer text not null,
  decision text not null,        -- agree | override
  corrected_label text,
  reason text,
  created_at timestamptz not null default now()
);

-- 8. Training candidates (approved manually; blocked from locked eval) --------
create table if not exists tf_training_candidates (
  id uuid primary key default gen_random_uuid(),
  normalized_record_id uuid references tf_normalized_records(id) on delete cascade,
  proposed_label text not null,
  status text not null default 'pending',  -- pending | approved | revoked | used
  created_by text,
  approved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 9. Themes -------------------------------------------------------------------
create table if not exists tf_themes (
  id text primary key,
  name text not null,
  description text
);

-- 10. Theme evidence ----------------------------------------------------------
create table if not exists tf_theme_evidence (
  id uuid primary key default gen_random_uuid(),
  theme_id text references tf_themes(id) on delete cascade,
  normalized_record_id uuid references tf_normalized_records(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 11. Product handoffs (Jira) -------------------------------------------------
create table if not exists tf_product_handoffs (
  id uuid primary key default gen_random_uuid(),
  normalized_record_id uuid references tf_normalized_records(id) on delete cascade,
  destination text not null default 'jira',
  jira_key text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

-- 12. Quality reviews ---------------------------------------------------------
create table if not exists tf_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  normalized_record_id uuid references tf_normalized_records(id) on delete cascade,
  decision text not null,
  reviewer text,
  notes text,
  decided_at timestamptz not null default now()
);

-- 13. QMS handoffs (mock until a real tenant exists) --------------------------
create table if not exists tf_qms_handoffs (
  id uuid primary key default gen_random_uuid(),
  normalized_record_id uuid references tf_normalized_records(id) on delete cascade,
  provider text,
  packet_id text,
  status text,
  human_approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- 14. Audit events (append-only) ---------------------------------------------
create table if not exists tf_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor text,
  action text not null,
  entity text,
  entity_id text,
  detail jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Indexes for the access patterns the panel uses -----------------------------
create index if not exists idx_tf_norm_partition on tf_normalized_records (partition, split);
create index if not exists idx_tf_pred_run on tf_predictions (run_id);
create index if not exists idx_tf_pred_record on tf_predictions (normalized_record_id);
create index if not exists idx_tf_ref_record on tf_reference_labels (normalized_record_id);
create index if not exists idx_tf_review_record on tf_review_decisions (normalized_record_id);
create index if not exists idx_tf_candidates_status on tf_training_candidates (status);
create index if not exists idx_tf_audit_created on tf_audit_events (created_at desc);

-- Row Level Security: enabled everywhere, no anon/authenticated policies.
-- Service role bypasses RLS; the public API keys get nothing.
alter table tf_source_items        enable row level security;
alter table tf_normalized_records  enable row level security;
alter table tf_reference_labels    enable row level security;
alter table tf_model_versions      enable row level security;
alter table tf_model_runs          enable row level security;
alter table tf_predictions         enable row level security;
alter table tf_review_decisions    enable row level security;
alter table tf_training_candidates enable row level security;
alter table tf_themes              enable row level security;
alter table tf_theme_evidence      enable row level security;
alter table tf_product_handoffs    enable row level security;
alter table tf_quality_reviews     enable row level security;
alter table tf_qms_handoffs        enable row level security;
alter table tf_audit_events        enable row level security;

revoke all on tf_source_items        from anon, authenticated;
revoke all on tf_normalized_records  from anon, authenticated;
revoke all on tf_reference_labels    from anon, authenticated;
revoke all on tf_model_versions      from anon, authenticated;
revoke all on tf_model_runs          from anon, authenticated;
revoke all on tf_predictions         from anon, authenticated;
revoke all on tf_review_decisions    from anon, authenticated;
revoke all on tf_training_candidates from anon, authenticated;
revoke all on tf_themes              from anon, authenticated;
revoke all on tf_theme_evidence      from anon, authenticated;
revoke all on tf_product_handoffs    from anon, authenticated;
revoke all on tf_quality_reviews     from anon, authenticated;
revoke all on tf_qms_handoffs        from anon, authenticated;
revoke all on tf_audit_events        from anon, authenticated;