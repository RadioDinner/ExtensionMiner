-- =============================================================================
-- 991 — app_settings: a tiny key/value config table the dashboard and the
-- ranking layer share.
--
-- Feature: make the ranking layer incremental by default (only score newly added
-- extensions + process the deep-dive queue), with a dashboard TOGGLE that forces
-- a full re-run "across the board". The toggle's state lives here so the Python
-- ranking layer reads it at run time and behaves accordingly.
--
--   ranking_force_rerun (jsonb bool):
--     false -> incremental: skip extensions already scored/monetized (default).
--     true  -> full re-run: re-analyze the whole top-N, overwriting existing rows.
--
-- One row per key; value is JSONB so future settings can be any shape. RLS on
-- with no policies -> service-role only, like every other table. Idempotent.
-- =============================================================================

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists app_settings_set_updated_at on app_settings;
create trigger app_settings_set_updated_at
  before update on app_settings
  for each row execute function set_updated_at();

-- Seed the only setting used today (default OFF = incremental). on conflict keeps
-- a value the user has already toggled.
insert into app_settings (key, value)
values ('ranking_force_rerun', 'false'::jsonb)
on conflict (key) do nothing;

comment on table app_settings is
  'Small shared key/value config (JSONB values). ranking_force_rerun toggles the '
  'ranking layer between incremental (new only) and a full re-run across the top-N.';

alter table app_settings enable row level security;
