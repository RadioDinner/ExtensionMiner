# scraper/

DIY, polite Chrome Web Store crawler (Playwright). Enumerates extensions in your
target categories, pulls metadata + reviews, and upserts them into Supabase.

> ⚠️ **Run this locally.** The Chrome Web Store is egress-blocked (HTTP 403) in
> the Claude-Code-on-the-web environment, so the crawl must run on your machine
> (or an environment whose network policy can reach the store). The schema and
> the ranking layer work fine in the web env.

## Easiest path (Windows): one click

Don't want to touch a terminal? Double-click **`scripts\run_scraper.cmd`** — it
creates the venv, installs deps + Chromium on first run, crawls, writes to
Supabase, and quits. Double-click **`scripts\install_daily_task.cmd`** once to
run it automatically every day. Full guide:
[`docs/RUNNING_THE_SCRAPER.md`](../docs/RUNNING_THE_SCRAPER.md).

## Setup (manual / non-Windows)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium          # one-time: download the browser
cp .env.example .env                 # then fill in SUPABASE_* (and ANTHROPIC_API_KEY)
```

## Run

```bash
# 1) Dry run first — fetch + parse + cache, no DB writes, visible browser.
python -m scraper.run --max-extensions 2 --no-db --no-headless

# 2) Real run into Supabase for chosen categories.
python -m scraper.run --categories productivity developer-tools --max-extensions 25

# 3) The daily preset (full refresh crawl; only new reviews land). This is what
#    the one-click launcher and the scheduled task run.
python -m scraper.run --preset daily --log-dir logs
```

Useful flags: `--preset daily` (full refresh crawl of the **whole** taxonomy +
related graph), `--all-categories` (discover & crawl every category from the
store nav), `--follow-related` (graph-crawl past category pages via each
extension's related links), `--max-total N` (cap total discovered),
`--no-db` (dry run), `--no-headless` (watch it), `--refresh` (ignore cache),
`--skip-existing`, `--refresh-after-days N`, `--log-dir DIR`, `--no-robots`,
`--log-level DEBUG`, `--category-scrolls` (max passes to exhaust a category) /
`--discovery-patience` (stop after N empty passes) / `--review-scrolls`.

> Discovery: `--all-categories` reads the category list from the store's own nav
> and scrolls each until no new extensions appear; `--follow-related` then turns
> the crawl into a breadth-first graph walk over "related" links, which reaches
> far more than category pages alone (those are capped and partly curated). There
> is still no public index of *all* extensions, so 100% isn't guaranteed.

> Reviews: the crawler re-sorts the reviews page (Recent / Helpful / Highest /
> Lowest rating) and merges, de-duped on `extension_id + review_uid`. Per sort it
> clicks **"Load more"** until exhausted (`--load-more-max`, default 40) to
> paginate past the first ~10, expands every per-review **"Show more"** so bodies
> save in full, and snapshots. Because **Recent** is a sort, running daily
> accumulates new reviews over time. Any review that appears under the **Helpful**
> sort is sticky-flagged `helpful_ranked` (community-upvoted — a lead on
> agreed-upon complaints); requires migration **996**. `--no-multi-sort` falls
> back to a single default-sort pass.

> Tip: never run `python scraper/run.py` directly — relative imports break.
> Use `python -m scraper.run …` or the top-level `python run_scraper.py …`.

## Tuning selectors (important on first run)

This module was written without live access to the store, so the **DOM
selectors are a best-effort starting point**. The robust parts — install-count /
rating / version / date parsing and extension-id extraction — read from visible
text or URL shapes and need no tuning. The detail/review **structure** may need a
quick adjustment:

1. Run the dry run above; raw HTML is cached under `SCRAPER_CACHE_DIR`
   (default `data/cache/`).
2. Open a cached `*.html`, find the real review-card / author / date / body
   selectors.
3. Edit **`scraper/selectors.py`** only — every parser reads from there.
4. Re-run with `--refresh` off (it reparses the cache for free).

**Review sort control (for multi-sort):** open a reviews page, click the sort
dropdown, and inspect it. Set `SEL_REVIEW_SORT_TRIGGER` (the dropdown button),
`SEL_REVIEW_SORT_OPTION_ROLE` (the ARIA role of each choice, usually `option` or
`menuitem`), and the visible `REVIEW_SORTS` labels in `scraper/selectors.py`. If
these don't match, multi-sort silently falls back to one default-sort pass.

## Extension identity / duplicates

The Chrome `ext_id` is permanent and unique, so it's the primary key — a same-id
name/website change is just an update, never a duplicate. The **secondary**
multi-point matcher (`scraper/identity.py`) catches the one case `ext_id` can't:
the *same product re-published under a different `ext_id`*. It links the newer
listing to the older one (`successor_of`) when **≥2 of {name, developer,
website}** agree — non-destructively (both rows kept). `--preset daily` runs the
pass after each crawl; or run it on demand:

```bash
python -m scraper.successors            # link (needs migration 997 applied)
python -m scraper.successors --dry-run  # just report candidates
```

> Requires `supabase/migrations/997_extension_successor_links.sql` to be applied
> (adds `successor_of` + `successor_points`). If it isn't, the linking step logs
> a note and is skipped — the crawl itself is unaffected.

## Layout

| File | Role |
|------|------|
| `selectors.py` | URLs + CSS selectors (the one file to tune) |
| `parse.py` | Pure parsers (text → numbers/dates/ids) + DOM → models |
| `models.py` | `Extension` / `Review` dataclasses → Supabase rows |
| `ratelimit.py` | Thread-safe min-interval limiter |
| `cache.py` | On-disk raw-response cache (never re-fetch) |
| `robots.py` | robots.txt awareness |
| `browser.py` | Playwright fetcher (cache + rate-limit + robots) |
| `crawl.py` | Orchestration: categories → ids → detail/reviews → DB |
| `run.py` | CLI (`python -m scraper.run`) |

## Politeness / ToS

Reviews are public, but be a good citizen: the default rate limit is 3s between
navigations (`SCRAPER_RATE_LIMIT_SECONDS`), responses are cached, robots.txt is
respected by default, and an identifying User-Agent is sent. Keep scraped
reviews **internal** (decision support), per `docs/ROADMAP.md`.
