-- Glasswing Test Flight demo schema v1. Private by default: no browser roles.
BEGIN;
CREATE TABLE IF NOT EXISTS public.tf_source_items (
 id text PRIMARY KEY, source_type text NOT NULL, native_id text, source_url text,
 occurred_at timestamptz, received_at timestamptz NOT NULL DEFAULT now(),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb, synthetic boolean NOT NULL,
 data_partition text NOT NULL CHECK (data_partition IN ('demo','train','validation','locked_eval','maude_stress')),
 provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
 UNIQUE (source_type,native_id,data_partition)
);
CREATE TABLE IF NOT EXISTS public.tf_normalized_records (
 id text PRIMARY KEY REFERENCES public.tf_source_items(id), schema_version text NOT NULL,
 evidence_text text NOT NULL, screened_text text, source jsonb NOT NULL,
 evidence jsonb NOT NULL, context jsonb NOT NULL DEFAULT '{}'::jsonb,
 intake jsonb NOT NULL DEFAULT '{}'::jsonb, provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
 eligibility boolean NOT NULL, exclusion_reason text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tf_model_versions (
 id text PRIMARY KEY, model_family text NOT NULL, artifact_uri text, artifact_sha256 text,
 code_ref text, threshold numeric CHECK (threshold BETWEEN 0 AND 1),
 status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','validated','active','retired')),
 trained_at timestamptz, promoted_at timestamptz,
 notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tf_model_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_version_id text REFERENCES public.tf_model_versions(id),
 dataset_version text NOT NULL, data_partition text NOT NULL CHECK(data_partition IN ('train','validation','locked_eval','maude_stress','demo')),
 code_ref text, parameters jsonb NOT NULL DEFAULT '{}'::jsonb, started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz, status text NOT NULL DEFAULT 'pending', metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
 cohort_metrics jsonb NOT NULL DEFAULT '{}'::jsonb, artifact_uri text
);
CREATE TABLE IF NOT EXISTS public.tf_predictions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id text NOT NULL REFERENCES public.tf_normalized_records(id),
 model_version_id text NOT NULL REFERENCES public.tf_model_versions(id), run_id uuid REFERENCES public.tf_model_runs(id),
 complaint_score numeric CHECK(complaint_score BETWEEN 0 AND 1), threshold numeric CHECK(threshold BETWEEN 0 AND 1),
 predicted_label text NOT NULL CHECK(predicted_label IN ('complaint','product_feedback','excluded')),
 route text NOT NULL CHECK(route IN ('quality_review','product_review','excluded','human_review')),
 confidence numeric CHECK(confidence BETWEEN 0 AND 1), rationale jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(record_id,model_version_id,run_id)
);
CREATE TABLE IF NOT EXISTS public.tf_reference_labels (
 record_id text PRIMARY KEY REFERENCES public.tf_normalized_records(id),
 label text CHECK(label IN ('complaint','product_feedback','excluded')),
 route text, theme_id text, potential_mdr boolean, priority_subflags jsonb NOT NULL DEFAULT '{}'::jsonb,
 reason text, label_source text NOT NULL DEFAULT 'provisional_dataset',
 adjudicated boolean NOT NULL DEFAULT false, added_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tf_review_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id text NOT NULL REFERENCES public.tf_normalized_records(id),
 prediction_id uuid REFERENCES public.tf_predictions(id), reviewer_id text,
 final_label text NOT NULL CHECK(final_label IN ('complaint','product_feedback','excluded')),
 final_route text NOT NULL CHECK(final_route IN ('quality_review','product_review','excluded')),
 override_reason text, notes text, decision_at timestamptz NOT NULL DEFAULT now(),
 approved_for_training boolean NOT NULL DEFAULT false, revoked_at timestamptz,
 UNIQUE(record_id,decision_at)
);
CREATE TABLE IF NOT EXISTS public.tf_training_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), review_id uuid NOT NULL UNIQUE REFERENCES public.tf_review_decisions(id),
 candidate_status text NOT NULL DEFAULT 'pending' CHECK(candidate_status IN ('pending','approved','rejected','used')),
 weight numeric NOT NULL DEFAULT 1 CHECK(weight>0), dataset_version text, used_in_run uuid REFERENCES public.tf_model_runs(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tf_themes (
 id text PRIMARY KEY, title text NOT NULL, summary text, owner_hint text, owner_verified boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'proposed', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tf_theme_evidence (
 theme_id text REFERENCES public.tf_themes(id), record_id text REFERENCES public.tf_normalized_records(id),
 PRIMARY KEY(theme_id,record_id)
);
CREATE TABLE IF NOT EXISTS public.tf_product_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), theme_id text REFERENCES public.tf_themes(id),
 reviewer_id text, approved_at timestamptz, jira_issue_key text, jira_issue_url text,
 status text NOT NULL DEFAULT 'draft', payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tf_quality_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id text NOT NULL UNIQUE REFERENCES public.tf_normalized_records(id),
 reviewer_id text, decision text, potential_mdr boolean, reportability_status text NOT NULL DEFAULT 'undetermined',
 rationale text, reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tf_qms_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quality_review_id uuid NOT NULL REFERENCES public.tf_quality_reviews(id),
 approved_by text, approved_at timestamptz, external_qms_id text, status text NOT NULL DEFAULT 'draft',
 screened_payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tf_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id text, event_type text NOT NULL,
 object_type text NOT NULL, object_id text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tf_source_partition_idx ON public.tf_source_items(data_partition, synthetic);
CREATE INDEX IF NOT EXISTS tf_predictions_record_idx ON public.tf_predictions(record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tf_review_record_idx ON public.tf_review_decisions(record_id, decision_at DESC);
CREATE INDEX IF NOT EXISTS tf_labels_label_idx ON public.tf_reference_labels(label);
DO $$DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY[
 'tf_source_items','tf_normalized_records','tf_model_versions','tf_model_runs','tf_predictions',
 'tf_reference_labels','tf_review_decisions','tf_training_candidates','tf_themes','tf_theme_evidence',
 'tf_product_handoffs','tf_quality_reviews','tf_qms_handoffs','tf_audit_events'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',n);
 END LOOP; END$$;
COMMIT;
