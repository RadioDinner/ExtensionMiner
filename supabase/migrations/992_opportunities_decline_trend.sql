-- =============================================================================
-- 992 — Decline / complaint-trend detection for the ranking layer.
--
-- Feature: target extensions that are getting WEAKER. The ranker now compares a
-- recent review window against a prior one and records how much an extension is
-- declining, so the dashboard can surface weakening incumbents as prime targets.
--
--   decline_score   in [0, 1]: 0 = steady/improving, 1 = severe decline.
--   recent_rating   avg stars in the recent (~6mo) window.
--   baseline_rating avg stars in the prior (~6–18mo) window.
--   complaint_trend in [0, 1]: rise in the share of negative (<=2*) reviews.
--
-- A small decline bonus is also folded into `score`. Computed from per-review
-- timestamps + stars we already store — no new scraping. Idempotent.
-- =============================================================================

alter table opportunities
  add column if not exists decline_score   numeric,
  add column if not exists recent_rating   numeric,
  add column if not exists baseline_rating numeric,
  add column if not exists complaint_trend numeric;

-- Sort the dashboard by who's declining fastest.
create index if not exists opportunities_decline_idx on opportunities (decline_score desc);

comment on column opportunities.decline_score is
  'How much the extension is declining in [0,1] (0 = steady/improving, 1 = '
  'severe): blends the recent-vs-baseline rating drop with the rise in negative '
  'reviews. A small bonus of this also feeds the overall score.';
