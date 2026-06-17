-- 996_reviews_helpful_flag.sql
-- Flag reviews that the community marked as helpful. We detect these by
-- re-reading the reviews page sorted by "Helpful": a review that surfaces there
-- is one other users upvoted. Stored as a sticky boolean (set true, never
-- auto-cleared), so it's a durable lead signal — complaints people agree with,
-- fixes people are asking for, etc.

alter table reviews
  add column if not exists helpful_ranked boolean not null default false;

create index if not exists idx_reviews_helpful_ranked
  on reviews (helpful_ranked) where helpful_ranked;

comment on column reviews.helpful_ranked is
  'True if this review appeared under the store''s "Helpful" sort (community-upvoted). Sticky: set true, never cleared on re-scrape.';
