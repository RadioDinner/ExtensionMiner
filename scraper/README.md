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

> Reviews: the store caps each sort order at ~10 reviews, so by default the
> crawler re-sorts the reviews page (Recent / Helpful / Highest / Lowest rating)
> and merges to get ~25–30 distinct reviews/extension (`--no-multi-sort` to
> disable). Selectors for the sort dropdown are confirmed against the live store.
> Before each snapshot it also clicks every per-review **"See more"** toggle so
> bodies are saved in full (`selectors.REVIEW_EXPAND_TEXTS`). Because **Recent**
> is one of the sorts, running daily accumulates new reviews over time (upserts
> dedupe on `extension_id + review_uid`), growing past the 10-per-sort cap.

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
