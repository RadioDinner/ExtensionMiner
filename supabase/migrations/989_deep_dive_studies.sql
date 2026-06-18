-- =============================================================================
-- 989 — "Deep dive studies" (Layer 2 + Layer 3): skill-driven research uploads.
--
-- The deep-dive system is now LAYERED and GATED:
--   • Layer 0 = automatic review-legitimacy analysis (table `review_analysis`,
--     migration 988) — runs on every Opportunity-Zone extension.
--   • Layer 1 = the existing one-call Claude competitive read (table `deep_dives`,
--     migration 993), run by analysis/deepdive.py.
--   • Layer 2 = a thorough competitor study, run by hand with Claude's
--     deep-research skill. Requires Layer 1 done.
--   • Layer 3 = a financial study (how it makes money, how competitors attack it,
--     free-alternative land-grabs). Requires Layer 2 done.
--
-- Layers 2 and 3 share THIS table (distinguished by `layer`). They are
-- skill-driven: the dashboard generates a ready-to-paste research prompt, the
-- user runs the deep research in a session, exports the PDF, and uploads it back.
-- The upload handler extracts the narrative report + a machine-readable JSON
-- block (structured competitors / opportunities / financials / sources / verdict)
-- and stores both. One row per (extension, layer): queue entry + result record.
--
-- RLS enabled with no policies → service-role only, like every other table.
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists deep_dive_studies (
  id               bigint generated always as identity primary key,
  extension_id     bigint not null references extensions (id) on delete cascade,
  layer            int not null check (layer in (2, 3)),
  status           text not null default 'queued'
                     check (status in ('queued', 'done', 'error')),
  requested_at     timestamptz not null default now(),  -- when it was queued for this layer
  uploaded_at      timestamptz,                          -- when a report was last uploaded
  model            text,                                 -- e.g. 'deep-research'

  prompt           text,                                 -- the generated research brief (stable per ext+layer)

  -- The uploaded report, split into a readable narrative + structured signal.
  report_md        text,                                 -- full narrative report (from the PDF / pasted)
  summary          text,                                 -- short executive summary (from the JSON block)
  recommendation   text,                                 -- build / maybe / avoid
  target_strengths  jsonb not null default '[]'::jsonb,  -- ["..."] what the target does well
  target_weaknesses jsonb not null default '[]'::jsonb,  -- ["..."] where the target is weak
  competitors      jsonb not null default '[]'::jsonb,   -- [{name,url,pricing,users,positioning,strengths,weaknesses}]
  opportunities    jsonb not null default '[]'::jsonb,   -- [{title,detail,evidence,effort}]
  financials       jsonb not null default '{}'::jsonb,   -- Layer 3: {revenue_model, pricing, competitor_attacks, free_alternatives, ...}
  sources          jsonb not null default '[]'::jsonb,   -- URLs consulted

  details          jsonb,                                -- the full parsed JSON block, verbatim
  source_filename  text,                                 -- original uploaded file name
  parse_warning    text,                                 -- set when the JSON block couldn't be parsed
  error            text,                                 -- last failure message when status='error'

  updated_at       timestamptz not null default now(),

  unique (extension_id, layer)
);

create index if not exists deep_dive_studies_lookup_idx on deep_dive_studies (extension_id, layer);
create index if not exists deep_dive_studies_status_idx on deep_dive_studies (layer, status);

drop trigger if exists deep_dive_studies_set_updated_at on deep_dive_studies;
create trigger deep_dive_studies_set_updated_at
  before update on deep_dive_studies
  for each row execute function set_updated_at();

alter table deep_dive_studies enable row level security;
