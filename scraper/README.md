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
related graph), `--use-saved-settings` (drive the crawl from the dashboard — see
below), `--all-categories` (discover & crawl every category from the store nav),
`--follow-related` (graph-crawl past category pages via each extension's related
links), `--concurrency N` (parallel browser workers; see below), `--max-total N`
(cap total discovered), `--no-db` (dry run), `--no-headless` (watch it),
`--refresh` (ignore cache), `--skip-existing`, `--refresh-after-days N`,
`--log-dir DIR`, `--no-robots`, `--log-level DEBUG`, `--category-scrolls` (max
passes to exhaust a category) / `--discovery-patience` (stop after N empty
passes) / `--review-scrolls`.

> **Dashboard-driven runs (`--use-saved-settings`).** Instead of CLI flags, the
> crawl can read its settings from the dashboard's **Scraper settings** tab
> (`/scraper-settings`), stored in `app_settings.scraper_settings` (migration
> **991**). Set the categories, caps, concurrency, politeness, and the
> **opportunity-zone review gate** there, then run
> `python -m scraper.run --use-saved-settings` (this is what the **Run Scraper**
> button now does). Run-environment flags (`--no-db`, `--no-headless`,
> `--no-robots`, `--log-*`) still apply on top.
>
> **Opportunity-zone review gate** (the big speedup). With *“Only save reviews
> for in-zone extensions”* on, the scraper fetches each extension's cheap detail
> page, and only pays the **expensive review fetch** when the overall rating is
> inside the zone (default 2.5–3.5★). Out-of-zone extensions still get their
> metadata + rating snapshot saved, so they're tracked and can re-qualify later —
> you just skip the bulk of review fetches. Set it in the Scraper settings tab.
>
> **Skip already-saved reviews** (`--skip-reviews-if-saved N`, or the *“Skip
> reviews if ≥ N already saved”* setting). Before fetching reviews, the scraper
> checks (one cheap query) whether it already has ≥ N saved reviews for the
> extension **and** the store's `rating_count` hasn't grown since the last scrape
> — if so, there are no new ratings (hence no new reviews) and it skips the fetch.
> Great for repeat/refresh crawls: only extensions with fresh activity re-fetch
> reviews. The run summary reports how many were skipped this way
> (`reviews_fresh`). 0 = off.

> Concurrency: `--concurrency N` runs N browser workers that drain the discovery
> frontier in parallel (default **1**; **4** under `--preset daily`). Each worker
> is its own headless Chromium (~200–300 MB RAM) — but they all share **one**
> rate limiter, so raising N speeds the crawl by overlapping the slow on-page work
> ("Load more" / "Show more" / scrolling) **without** raising the request rate.
> For an all-night full-store run, bump it (e.g. `--concurrency 8`); watch RAM.

> Discovery: `--all-categories` crawls the **whole taxonomy** defined in
> `scraper/categories.py` (every `group/sub` the store has — Productivity,
> Lifestyle, Make Chrome Yours), plus any extra slug the homepage nav happens to
> expose. Each category page is exhausted by scrolling **and** clicking a "Load
> more" button (`CATEGORY_LOAD_MORE_TEXTS`) until no new extensions appear,
> because the grid paginates by button, not pure infinite scroll (a category that
> only ever yields ~30 ids is the tell that the button text needs tuning — see
> below; a category reporting `0 extensions` means its slug in `categories.py` is
> wrong). `--follow-related` then turns the crawl into a breadth-first graph walk
> over "related" links — fanning out past the category seeds. There is still no
> public index of *all* extensions, so 100% isn't guaranteed.
>
> Categorization: every extension is tagged with a clean, store-matching name
> ("Productivity / Tools") via `categories.display_for()` — taken from the
> category page it was found on (reliable), or, for related-only finds, from the
> detail page's own breadcrumb when unambiguous. The slug→name map lives in
> `scraper/categories.py`.

> Reviews: the crawler re-sorts the reviews page (**Recent** + **Helpful** — the
> two sorts that carry signal) and merges, de-duped on `extension_id +
> review_uid`. Per sort it clicks **"Load more"** until exhausted
> (`--load-more-max`, default 40) to paginate past the first ~10, expands every
> per-review **"Show more"** so bodies save in full, and snapshots. Because
> **Recent** is a sort, running daily accumulates new reviews over time (and the
> full "Load more" list brings the low-star complaints through, so the old
> Highest/Lowest-rating passes were dropped). Any review that appears under the
> **Helpful** sort is sticky-flagged `helpful_ranked` (community-upvoted — a lead
> on agreed-upon complaints); requires migration **996**. `--no-multi-sort` falls
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

**Category "Load more" (for discovery):** if every category stops at the same
small number (~30) of extensions, the grid is paginating behind a button the bot
isn't clicking. Scroll to the bottom of a category page, read the button's exact
visible text, and add it to `CATEGORY_LOAD_MORE_TEXTS` in `scraper/selectors.py`.
If instead there's a numbered pager (1 2 3 … Next), that needs a small code change
in `CWSBrowser.collect_scrolling` — note it and pass along the DOM.

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
