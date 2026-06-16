-- =============================================================================
-- 999_initial_schema.sql  —  ExtensionMiner foundational schema
--
-- NOTE ON NUMBERING: migrations in this project count DOWN from 999. 999 is the
-- OLDEST / foundational migration; the next new migration is 998_*.sql, then
-- 997_*.sql, and so on. Do NOT use "highest + 1".
--
-- This schema is the spine of the pipeline:
--   scraper  -> writes  extensions, reviews, rating_snapshots
--   analysis -> writes  opportunities  (Claude ranking output)
--   dashboard-> reads   everything (server-side, via the service role)
--
-- SECURITY: Row Level Security is ENABLED with NO policies on every table, so
-- only the service_role key (used server-side) can read/write. This keeps
-- scraped reviews internal by default, per the roadmap. Add explicit policies
-- later if/when a public read surface is wanted.
-- =============================================================================

-- Keep an updated_at column fresh on write.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- categories — store categories and (later) derived/clustered categories.
-- -----------------------------------------------------------------------------
create table if not exists categories (
  id          bigint generated always as identity primary key,
  slug        text not null unique,
  name        text not null,
  kind        text not null default 'store' check (kind in ('store', 'derived')),
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- extensions — one row per Chrome Web Store extension.
-- -----------------------------------------------------------------------------
create table if not exists extensions (
  id                bigint generated always as identity primary key,
  ext_id            text not null unique,            -- Chrome Web Store extension id
  name              text not null,
  developer         text,
  store_category    text,                            -- raw store category label
  category_id       bigint references categories (id) on delete set null,
  summary           text,
  description       text,
  install_count     bigint,                          -- parsed (e.g. 10000)
  install_count_raw text,                            -- raw string (e.g. "10,000+ users")
  rating            numeric(2, 1),                   -- overall average, 1.0–5.0
  rating_count      integer,
  version           text,
  last_updated      date,                            -- store's "Updated" date
  website           text,
  support_url       text,
  privacy_url       text,
  listing_url       text,
  icon_url          text,
  price             text,                            -- 'free' / 'paid' / price label
  permissions       jsonb not null default '[]'::jsonb,
  raw               jsonb,                           -- full parsed blob for reprocessing
  first_seen        timestamptz not null default now(),
  last_scraped      timestamptz,
  updated_at        timestamptz not null default now()
);

create index if not exists extensions_rating_idx        on extensions (rating);
create index if not exists extensions_install_count_idx  on extensions (install_count);
create index if not exists extensions_category_id_idx    on extensions (category_id);
-- The opportunity zone: mid-rated + high-install. Speeds the dashboard's core query.
create index if not exists extensions_opportunity_idx    on extensions (rating, install_count);

drop trigger if exists extensions_set_updated_at on extensions;
create trigger extensions_set_updated_at
  before update on extensions
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- reviews — one row per review. The primary signal source: when / what / stars.
-- -----------------------------------------------------------------------------
create table if not exists reviews (
  id            bigint generated always as identity primary key,
  extension_id  bigint not null references extensions (id) on delete cascade,
  review_uid    text,                                -- store's review id, if available
  author        text,
  stars         smallint not null check (stars between 1 and 5),  -- how many stars
  body          text,                                -- what
  reviewed_at   timestamptz,                         -- when
  language      text,
  helpful_count integer,
  raw           jsonb,
  scraped_at    timestamptz not null default now()
);

-- Dedupe on the store's review id when we have one.
create unique index if not exists reviews_uid_uniq
  on reviews (extension_id, review_uid)
  where review_uid is not null;

create index if not exists reviews_extension_id_idx on reviews (extension_id);
create index if not exists reviews_stars_idx        on reviews (stars);
create index if not exists reviews_reviewed_at_idx  on reviews (reviewed_at);

-- -----------------------------------------------------------------------------
-- rating_snapshots — optional time series so we can track an extension's
-- rating / install trajectory over time.
-- -----------------------------------------------------------------------------
create table if not exists rating_snapshots (
  id            bigint generated always as identity primary key,
  extension_id  bigint not null references extensions (id) on delete cascade,
  captured_at   timestamptz not null default now(),
  rating        numeric(2, 1),
  rating_count  integer,
  install_count bigint
);

create index if not exists rating_snapshots_ext_idx on rating_snapshots (extension_id, captured_at);

-- -----------------------------------------------------------------------------
-- opportunities — derived/scored targets from the Claude ranking layer
-- (Phase 3). One row per extension; the dashboard's "fix-and-flip" shortlist.
-- -----------------------------------------------------------------------------
create table if not exists opportunities (
  id               bigint generated always as identity primary key,
  extension_id     bigint not null unique references extensions (id) on delete cascade,
  score            numeric,                          -- overall opportunity score
  top_complaint    text,
  complaint_type   text check (complaint_type in
                     ('missing_feature', 'bug', 'pricing', 'abandonment', 'other')),
  fixable          text check (fixable in ('yes', 'no', 'maybe')),
  demand_intensity integer,                          -- # independent reviewers, same complaint
  wtp_evidence     jsonb not null default '[]'::jsonb,  -- verbatim "I'd pay if…" quotes
  build_effort     text,                             -- rough build-effort guess
  brief            text,                             -- one-paragraph opportunity brief
  model            text,                             -- Claude model used
  details          jsonb,                            -- full structured analysis output
  analyzed_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists opportunities_score_idx on opportunities (score desc);

drop trigger if exists opportunities_set_updated_at on opportunities;
create trigger opportunities_set_updated_at
  before update on opportunities
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- Lock everything down: RLS on, no policies -> service_role only.
-- -----------------------------------------------------------------------------
alter table categories       enable row level security;
alter table extensions       enable row level security;
alter table reviews          enable row level security;
alter table rating_snapshots enable row level security;
alter table opportunities    enable row level security;
