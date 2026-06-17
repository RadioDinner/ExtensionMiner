-- =============================================================================
-- 994 — Recency weighting for the ranking layer.
--
-- Feature: "decay old reviews". The ranker now down-weights an extension's
-- demand signal when the driving complaints are old (old reviews likely
-- describe old releases). `recency_weight` stores the multiplier (in
-- [0.15, 1.0]) that was applied when scoring, so the dashboard can show how
-- fresh the complaint evidence behind a score is.
--
-- Scoring/ranking only — every review is still stored regardless of age.
-- Idempotent: safe to re-run.
-- =============================================================================

alter table opportunities
  add column if not exists recency_weight numeric;

comment on column opportunities.recency_weight is
  'Demand recency multiplier in [0.15, 1.0] applied at scoring time: average '
  'age-decay weight over the extension''s complaint reviews (1.0 = fresh, lower '
  '= the complaints driving the score are old).';
