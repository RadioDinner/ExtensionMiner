-- =============================================================================
-- 993 — "Deep dive research" pool.
--
-- Lets the user hand-pick a small pool of extensions to research deeply with the
-- Claude layer, instead of burning tokens deep-diving every extension. The
-- dashboard's detail page queues an extension here; the deep-dive analysis task
-- (analysis/deepdive.py) processes the 'queued' rows and writes the results
-- back (competitors, a deep review read, the opportunity verdict).
--
-- One row per extension: it is both the queue entry and the result record.
-- RLS enabled with no policies → service-role only, like every other table.
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists deep_dives (
  id             bigint generated always as identity primary key,
  extension_id   bigint not null unique references extensions (id) on delete cascade,
  status         text not null default 'queued'
                   check (status in ('queued', 'done', 'error')),
  requested_at   timestamptz not null default now(),  -- when it was added to the pool
  analyzed_at    timestamptz,                          -- when the deep dive last completed
  model          text,                                 -- Claude model used

  what_it_is     text,                                 -- plain overview from the deep dive
  review_summary text,                                 -- deep read of the reviews (recurring problems, trajectory)
  competitors    jsonb not null default '[]'::jsonb,   -- [{name,url,pricing,strengths,weaknesses}]
  opportunity    text,                                 -- the gap + how a new entrant wins
  recommendation text,                                 -- build / maybe / avoid
  sources        jsonb not null default '[]'::jsonb,   -- URLs consulted during research
  error          text,                                 -- last failure message when status='error'
  details        jsonb,                                -- full structured DeepDiveReport dump

  updated_at     timestamptz not null default now()
);

-- The processor pulls the queue by status.
create index if not exists deep_dives_status_idx on deep_dives (status);

drop trigger if exists deep_dives_set_updated_at on deep_dives;
create trigger deep_dives_set_updated_at
  before update on deep_dives
  for each row execute function set_updated_at();

alter table deep_dives enable row level security;
