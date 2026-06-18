-- =============================================================================
-- 988 — "Layer 0" review-legitimacy analysis.
--
-- Layer 0 is the cheap, AUTOMATIC pre-screen that runs on every extension in the
-- Opportunity Zone (analysis/layer0.py). It is NOT a web deep-dive — it just
-- reads the reviews we already have, weighted toward the most RECENT and most
-- HELPFUL ones, and judges WHY the rating is what it is.
--
-- The point: a mid/low rating is only an *opportunity* if it comes from real,
-- fixable product problems. If an extension is 3★ because kids review-bombed it,
-- or a competitor brigaded it, or the complaints are off-topic, then there's no
-- product gap to exploit — so Layer 0 marks it low-legitimacy and the dashboard
-- DEMOTES it in the zone (legitimacy multiplies the zone ranking).
--
-- One row per extension. RLS enabled with no policies → service-role only.
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists review_analysis (
  id               bigint generated always as identity primary key,
  extension_id     bigint not null unique references extensions (id) on delete cascade,
  status           text not null default 'done'
                     check (status in ('done', 'error')),
  analyzed_at      timestamptz not null default now(),
  model            text,
  reviews_analyzed int,                                   -- how many reviews fed the analysis

  -- How much of the negativity is REAL, fixable product pain (1.0) vs noise such
  -- as review-bombing / off-topic / competitor attacks (→ 0.0). Used as the zone
  -- ranking multiplier, so low-legitimacy extensions sink out of the top 25.
  legitimacy       real not null default 1.0
                     check (legitimacy >= 0 and legitimacy <= 1),
  -- The dominant reason the rating looks the way it does.
  primary_cause    text,    -- product_issues | review_bombing | competitor_attack | off_topic | mixed | praise
  verdict          text,    -- one-line "why the reviews are good/bad"
  summary          text,    -- a short paragraph of reasoning
  categories       jsonb not null default '[]'::jsonb,    -- [{cause, share, note}] breakdown of the negativity
  sentiment_note   text,    -- recent-vs-older trajectory in plain words

  details          jsonb,   -- full structured Layer0Report dump
  error            text,    -- last failure message when status='error'

  updated_at       timestamptz not null default now()
);

create index if not exists review_analysis_legitimacy_idx on review_analysis (legitimacy);

drop trigger if exists review_analysis_set_updated_at on review_analysis;
create trigger review_analysis_set_updated_at
  before update on review_analysis
  for each row execute function set_updated_at();

alter table review_analysis enable row level security;
