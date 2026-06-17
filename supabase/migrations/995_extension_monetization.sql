-- 995_extension_monetization.sql
-- Monetization / pricing intel per extension (feature: "is it making money?").
--
-- Written by the Claude monetization-research agent (analysis/monetize.py), which
-- web-searches each extension for its pricing plans + user base and estimates
-- revenue. One row per extension; the dashboard reads it to show paid/free/
-- freemium and an estimated monthly income alongside the store metrics.
--
-- Migrations count DOWN from 999 (see CLAUDE.md). RLS on, no policies ->
-- service_role only, matching every other table.

create table if not exists monetization (
  id                            bigint generated always as identity primary key,
  extension_id                  bigint not null unique references extensions (id) on delete cascade,
  pricing_model                 text check (pricing_model in
                                  ('free', 'freemium', 'paid', 'subscription', 'ads', 'unknown')),
  makes_money                   boolean,                 -- best guess: does it generate revenue?
  has_paid_tier                 boolean,                 -- any paid/premium tier or subscription?
  price_min_usd                 numeric,                 -- lowest paid price point (monthly for subs)
  price_max_usd                 numeric,                 -- highest paid price point (monthly for subs)
  estimated_users               bigint,                  -- estimated active user base
  estimated_monthly_revenue_usd numeric,                 -- point estimate, USD/month
  revenue_low_usd               numeric,                 -- low end of the monthly estimate
  revenue_high_usd              numeric,                 -- high end of the monthly estimate
  confidence                    text check (confidence in ('low', 'medium', 'high')),
  monetization_summary          text,                    -- one or two sentences
  pricing_notes                 text,                    -- tiers found + basis for the estimate
  sources                       jsonb not null default '[]'::jsonb,  -- URLs consulted
  model                         text,                    -- Claude model used
  researched_at                 timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists monetization_revenue_idx
  on monetization (estimated_monthly_revenue_usd desc nulls last);

drop trigger if exists monetization_set_updated_at on monetization;
create trigger monetization_set_updated_at
  before update on monetization
  for each row execute function set_updated_at();

alter table monetization enable row level security;
