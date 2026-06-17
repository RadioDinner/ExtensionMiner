-- 997_extension_successor_links.sql
-- Link a re-published extension (a NEW ext_id) to the older listing it
-- supersedes. The Chrome Web Store ext_id is the primary, decisive identity — a
-- same-id name/website change is just an update, never a duplicate. This is the
-- SECONDARY, multi-point match: the same product re-published under a DIFFERENT
-- ext_id, recognized by agreement on >=2 of {name, developer, website}.
--
-- Non-destructive ("auto-link, keep both"): both rows stay; the newer one points
-- at the older one via successor_of, and successor_points records why.

alter table extensions
  add column if not exists successor_of     bigint references extensions (id) on delete set null,
  add column if not exists successor_points jsonb;

create index if not exists idx_extensions_successor_of on extensions (successor_of);

comment on column extensions.successor_of is
  'Same product as this older listing (different ext_id), matched on >=2 of name/developer/website. Both rows are kept.';
comment on column extensions.successor_points is
  'Which identity fields matched (e.g. ["developer","website"]) when successor_of was set.';
