-- =============================================================================
-- 998_reviews_unique_constraint.sql  —  fix review upsert dedup target
--
-- NUMBERING: migrations count DOWN from 999. 999 is foundational; this is the
-- next migration (998).
--
-- WHY: common/db.upsert_reviews() upserts with on_conflict=(extension_id,
-- review_uid). The foundational schema backed that with a PARTIAL unique index
-- (`reviews_uid_uniq ... where review_uid is not null`). PostgreSQL cannot use a
-- partial index as an ON CONFLICT arbiter unless the statement repeats the WHERE
-- predicate, and PostgREST's on_conflict only passes column names — so upserts
-- failed with 42P10 "no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- review_uid is ALWAYS populated by the scraper (models.Review.dedupe_uid()
-- returns the store id or a synthetic content hash), so a FULL unique constraint
-- on (extension_id, review_uid) preserves the exact dedup semantics while being a
-- valid ON CONFLICT target.
-- =============================================================================

-- Replace the partial unique index with a full unique constraint.
drop index if exists reviews_uid_uniq;

alter table reviews
  add constraint reviews_extension_uid_key unique (extension_id, review_uid);
