-- Test Flight classifier — reconciliation migration (live schema)
-- Project: supabase-teal-ferry (Vercel project glasswing-fda/test-flight-console)
--
-- The 14 tf_* tables already exist and were created out of band. This migration
-- was written AFTER reading the live schema (see ../live-schema.json, captured
-- via GET /api/classifier/schema). It is purely ADDITIVE and idempotent:
--   * it adds the few columns the classifier gate/metrics need that the live
--     tables do not already carry;
--   * it (re)asserts RLS + revokes anon/authenticated;
--   * it adds supporting indexes.
-- It never drops, renames or rewrites existing data. Apply with `supabase db push`
-- or paste into the SQL editor.
--
-- Live column map the API is coded against:
--   tf_normalized_records(id, schema_version, evidence_text, screened_text,
--     source, evidence, context, intake, provenance, eligibility,
--     exclusion_reason, created_at)
--   tf_source_items(id, source_type, native_id, source_url, occurred_at,
--     received_at, payload, synthetic, data_partition, provenance)
--   tf_reference_labels(record_id, label, route, theme_id, potential_mdr,
--     priority_subflags, reason, label_source, adjudicated, added_at)
--   tf_predictions(id, record_id, model_version_id, run_id, complaint_score,
--     threshold, predicted_label, route, confidence, rationale, created_at)
--   tf_model_versions(id, model_family, artifact_uri, artifact_sha256, code_ref,
--     threshold, status, trained_at, promoted_at, notes, created_at)
--   tf_model_runs(id, model_version_id, dataset_version, data_partition,
--     code_ref, parameters, started_at, finished_at, status, metrics,
--     cohort_metrics, artifact_uri)
--   tf_review_decisions(id, record_id, prediction_id, reviewer_id, final_label,
--     final_route, override_reason, notes, decision_at, approved_for_training, revoked_at)
--   tf_training_candidates(id, review_id, candidate_status, weight,
--     dataset_version, used_in_run, created_at)
--   tf_audit_events(id, actor_id, event_type, object_type, object_id, detail, created_at)

-- 1. Partition + split on normalized records ---------------------------------
-- The live table has no partition/split column. Partition currently only exists
-- on tf_source_items.data_partition and tf_model_runs.data_partition. The gate
-- needs a deterministic, indexed column here so the public API can filter
-- server-side. NULL means "not yet assigned" and is treated as NON-PUBLIC
-- (fail closed) until backfilled from the source/provenance shape.
alter table tf_normalized_records add column if not exists data_partition text;
alter table tf_normalized_records add column if not exists split text default 'train';
comment on column tf_normalized_records.data_partition is
  'synthetic | synthetic_train | synthetic_eval | real | real_eval | maude. NULL = not public (fail closed).';
comment on column tf_normalized_records.split is 'train | eval. Locked eval must never enter training.';

-- 2. Run type: the live runs table has no offline/live flag ---------------
alter table tf_model_runs add column if not exists run_type text default 'offline';
comment on column tf_model_runs.run_type is 'offline | live. Offline = exploratory results, not deployed performance.';

-- 3. Split on reference labels (for per-split metrics) --------------------
alter table tf_reference_labels add column if not exists split text;
comment on column tf_reference_labels.split is 'train | eval. Mirrors the record partition when set.';

-- 4. Supporting indexes ----------------------------------------------------
create index if not exists idx_tf_norm_partition   on tf_normalized_records (data_partition, split);
create index if not exists idx_tf_ref_record       on tf_reference_labels (record_id);
create index if not exists idx_tf_pred_run         on tf_predictions (run_id);
create index if not exists idx_tf_pred_record      on tf_predictions (record_id);
create index if not exists idx_tf_review_record    on tf_review_decisions (record_id);
create index if not exists idx_tf_candidate_status on tf_training_candidates (candidate_status);
create index if not exists idx_tf_audit_created    on tf_audit_events (created_at desc);

-- 5. Row Level Security: (re)assert on every table, no anon policies ------
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