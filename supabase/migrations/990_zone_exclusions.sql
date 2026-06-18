-- =============================================================================
-- 990 — zone_exclusions: extensions the user has dismissed from the opportunity
-- zone (with a reason), so they stop showing in the curated top-25.
--
-- Feature: curate the opportunity zone. The dashboard's zone card gets a per-row
-- "Remove from zone" control (reason: Too large / Too complex / Uninterested /
-- Publisher owned, e.g. Chrome Remote Desktop — 35M installs, Google-owned). A
-- dismissed extension drops out and the zone backfills with the next candidate so
-- the working list stays at 25. Dismissals are reversible (restore to the pool).
--
-- One row per extension: its presence means "dismissed". RLS on, no policies ->
-- service-role only, like every other table. Idempotent.
-- =============================================================================

create table if not exists zone_exclusions (
  id           bigint generated always as identity primary key,
  extension_id bigint not null unique references extensions (id) on delete cascade,
  reason       text,                                  -- why it was dismissed
  dismissed_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists zone_exclusions_ext_idx on zone_exclusions (extension_id);

drop trigger if exists zone_exclusions_set_updated_at on zone_exclusions;
create trigger zone_exclusions_set_updated_at
  before update on zone_exclusions
  for each row execute function set_updated_at();

comment on table zone_exclusions is
  'Extensions dismissed from the opportunity-zone view (with a reason). Presence '
  '= dismissed; the dashboard excludes these and backfills the zone to keep 25.';

alter table zone_exclusions enable row level security;
