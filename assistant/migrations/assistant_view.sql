-- Assistant read model: one flat, queryable view over classified feedback.
-- Adjust table/column names to match your Supabase schema (this assumes the
-- pipeline writes `standardized` records and `classifications` results).
--
--   standardized(id, source->>type, evidence->>text, context->>product_hint,
--                context->>version, occurred_at, reported_customer)
--   classifications(record_id, classification, route, theme_id, review_required,
--                   reason, potential_mdr, priority_subflags, created_at)
--
-- Expose only what the assistant needs, and never raw PHI.

create or replace view assistant_feedback_view as
select
  s.id                              as id,
  c.classification                  as classification,
  c.route                           as route,
  c.theme_id                        as theme_id,
  c.potential_mdr                   as potential_mdr,
  c.priority_subflags               as priority_subflags,
  s.occurred_at                     as occurred_at,
  s.source->>'type'                 as source_type,
  s.evidence->>'text'               as evidence_text,
  s.context->>'product_hint'        as product_hint,
  s.context->>'version'             as version,
  s.context->>'reported_customer'   as reported_customer,
  c.created_at                      as created_at
from classifications c
join standardized s on s.id = c.record_id
where c.classification in ('product_feedback', 'complaint');

-- Row Level Security: the backend uses a service key; the browser never touches
-- this view directly (the assistant calls the backend).
-- alter view assistant_feedback_view owner to postgres;
-- grant select on assistant_feedback_view to service_role;

-- Helpful indexes for the assistant's filters:
-- create index if not exists idx_classifications_classification on classifications(classification);
-- create index if not exists idx_standardized_occurred_at on standardized(occurred_at desc);
-- create index if not exists idx_classifications_theme on classifications(theme_id);