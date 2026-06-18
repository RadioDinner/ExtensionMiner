"""Crawl orchestration: categories -> extension ids -> detail + reviews -> DB.

Run via ``python -m scraper.run`` (see scraper/run.py). The pure parsing lives in
scraper/parse.py; this module wires fetching, parsing, and persistence together.
"""
from __future__ import annotations

import logging
import queue
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional, Tuple

from common.config import Settings
from common.config import settings as default_settings

from . import categories, parse, selectors
from .browser import CWSBrowser, RobotsDisallowed
from .cache import RawCache
from .models import Extension, Review
from .ratelimit import RateLimiter
from .robots import fetch_robots, make_checker

log = logging.getLogger("scraper")


@dataclass
class CrawlOptions:
    categories: List[str] = field(default_factory=list)
    all_categories: bool = False      # discover & crawl the WHOLE store taxonomy
    max_extensions: int = 25          # per category; 0 = no cap
    category_scrolls: int = 40        # max scroll passes to exhaust a category page
    discovery_patience: int = 3       # stop after N scrolls that surface no new ids
    review_scrolls: int = 6           # lazy-load passes on a detail page
    multi_sort: bool = True           # re-sort reviews to gather past the ~10/sort cap
    load_more_max: int = 40           # max "Load more" clicks per sort (0 disables)
    follow_related: bool = False      # graph-crawl: enqueue each page's related ids
    max_total: int = 0                # cap on total extensions discovered (0 = no cap)
    concurrency: int = 1              # parallel browser workers draining the frontier
    write_db: bool = True
    headless: bool = True
    refresh: bool = False             # ignore cache, re-fetch
    respect_robots: bool = True
    skip_existing: bool = False       # skip ext_ids already stored in the DB
    refresh_after_days: Optional[int] = None  # re-scrape rows older than N days; skip fresher
    rate_limit_seconds: Optional[float] = None  # override Settings.rate_limit_seconds when set
    # Opportunity-zone review gate: only spend the (expensive) review fetch on
    # extensions whose overall rating sits in the zone. Out-of-zone extensions
    # still get their metadata + rating snapshot saved — just no reviews.
    reviews_zone_only: bool = False
    zone_min: float = 2.5
    zone_max: float = 3.5
    # Freshness skip: if we already have >= this many reviews saved for an
    # extension AND its rating_count hasn't grown since the last scrape, skip the
    # (expensive) review fetch. 0 disables the optimization.
    skip_reviews_if_saved: int = 0


def should_fetch_reviews(
    rating: Optional[float], *, zone_only: bool, zone_min: float, zone_max: float
) -> bool:
    """Decide whether to scrape an extension's reviews (pure; unit-tested).

    When the zone gate is off, always fetch. When it's on, fetch only if the
    overall rating is known and inside [zone_min, zone_max]; an unknown (None)
    rating is treated as out-of-zone (we can't confirm it's a target, so don't
    pay the review cost).
    """
    if not zone_only:
        return True
    if rating is None:
        return False
    return zone_min <= float(rating) <= zone_max


def reviews_are_fresh(
    current_rating_count: Optional[int],
    prior_rating_count: Optional[int],
    saved_review_count: Optional[int],
    *,
    min_saved: int,
) -> bool:
    """Can we skip the review fetch because we already have them and nothing's new?

    True (skip) only when the feature is enabled (``min_saved`` > 0), we already
    have at least ``min_saved`` reviews saved, and the store's rating_count hasn't
    grown since our last scrape (new ratings are the proxy for new reviews). Any
    unknown count → False (fetch, to be safe). Pure; unit-tested.
    """
    if min_saved <= 0:
        return False
    if saved_review_count is None or saved_review_count < min_saved:
        return False
    if current_rating_count is None or prior_rating_count is None:
        return False
    return current_rating_count <= prior_rating_count


def build_browser(s: Settings, opts: CrawlOptions) -> CWSBrowser:
    robots_allowed = None
    if opts.respect_robots:
        try:
            robots_allowed = make_checker(fetch_robots(s.user_agent), s.user_agent)
        except Exception as exc:  # network/parse issues shouldn't hard-fail the run
            log.warning("Could not load robots.txt (%s); proceeding without it", exc)
    # A refresh run must re-fetch (not serve stale cached HTML) for the pages it
    # decides to re-scrape, so bypass the cache when a freshness window is set.
    refresh = opts.refresh or opts.refresh_after_days is not None
    rate_seconds = opts.rate_limit_seconds if opts.rate_limit_seconds is not None else s.rate_limit_seconds
    return CWSBrowser(
        cache=RawCache(s.cache_dir),
        rate_limiter=RateLimiter(rate_seconds),
        user_agent=s.user_agent,
        headless=opts.headless,
        robots_allowed=robots_allowed,
        refresh=refresh,
    )


def build_worker_browser(
    s: Settings, opts: CrawlOptions, shared_rate_limiter: Optional[RateLimiter]
) -> CWSBrowser:
    """A browser for one worker, wired to share ONE rate limiter across workers.

    Concurrency speeds the crawl by overlapping the slow on-page work (scrolling,
    "Load more", "Show more"); the navigation rate stays polite because every
    worker's ``goto`` passes through the SAME rate limiter, so the aggregate
    request spacing is unchanged no matter how high ``--concurrency`` goes. The
    on-disk cache is already shared by directory, so only the limiter needs
    sharing. (The fake browser used in tests has no ``rate_limiter`` attribute,
    so it's left untouched.)
    """
    browser = build_browser(s, opts)
    if shared_rate_limiter is not None and hasattr(browser, "rate_limiter"):
        browser.rate_limiter = shared_rate_limiter
    return browser


def discover_categories(browser: CWSBrowser) -> List[str]:
    """The full category taxonomy to crawl.

    Starts from the canonical taxonomy in ``scraper/categories.py`` (every
    ``group/sub`` the store defines) so coverage doesn't depend on the homepage
    nav, which only surfaces a rotating handful. Any *extra* category slug the nav
    happens to expose is appended too, so a brand-new store category is still
    picked up. Never empty (always at least the canonical list).
    """
    canonical = categories.all_category_slugs()
    try:
        html, _ = browser.fetch(selectors.HOME_URL, scrolls=2)
    except Exception as exc:  # discovery must never hard-fail the crawl
        log.warning("category nav fetch failed (%s); using the canonical taxonomy only", exc)
        return canonical
    nav = parse.extract_category_slugs(html)
    extra = [s for s in nav if s not in canonical]
    log.info(
        "category taxonomy: %d canonical + %d extra from nav = %d total",
        len(canonical), len(extra), len(canonical) + len(extra),
    )
    return canonical + extra


def collect_extension_ids(
    browser: CWSBrowser, category: str, *, max_extensions: int, opts: "CrawlOptions"
) -> List[str]:
    """Every extension id a category page is willing to lazy-load (capped).

    Uses progressive scrolling to exhaust the list rather than a fixed number of
    passes. A non-refresh run reuses the cached category HTML if present.
    """
    url = parse.category_url(category)
    if not browser.refresh and browser.cache.has(url, "html"):
        ids = parse.extract_extension_ids(browser.cache.get(url, "html") or "")
    else:
        ids = browser.collect_scrolling(
            url,
            parse.extract_extension_ids,
            max_scrolls=opts.category_scrolls,
            patience=opts.discovery_patience,
            load_more_texts=selectors.CATEGORY_LOAD_MORE_TEXTS,
        )
    return ids[:max_extensions] if max_extensions else ids


def merge_reviews(labeled_review_lists: Iterable[Tuple[str, Iterable[Review]]]) -> List[Review]:
    """De-dupe reviews gathered across sort passes; flag the helpful ones.

    Input is ``(sort_key, [Review, ...])`` per pass. Reviews are keyed by
    dedupe_uid (store id, else a content hash of author/date/body — the same key
    the DB unique index uses), so the same review seen under two sorts collapses
    to one row. Any review that appeared under the ``"helpful"`` sort gets its
    ``helpful`` flag set (OR-ed across passes), even if it was first seen under
    "recent".
    """
    out: dict = {}
    for key, reviews in labeled_review_lists:
        is_helpful = key == "helpful"
        for r in reviews:
            uid = r.dedupe_uid()
            existing = out.get(uid)
            if existing is None:
                if is_helpful:
                    r.helpful = True
                out[uid] = r
            elif is_helpful:
                existing.helpful = True
    return list(out.values())


def scrape_extension(
    browser: CWSBrowser,
    ext_id: str,
    *,
    category: Optional[str] = None,
    review_scrolls: int = 6,
    multi_sort: bool = True,
    load_more_max: int = 40,
    reviews_zone_only: bool = False,
    zone_min: float = 2.5,
    zone_max: float = 3.5,
    should_skip_reviews=None,
) -> Tuple[Extension, List[Review], List[str]]:
    """Scrape one extension. Returns (extension, reviews, related_ext_ids).

    ``related_ext_ids`` are other extension ids linked from the detail page (the
    "related"/"more from" sections) — the fuel for graph discovery.

    When ``reviews_zone_only`` is set, the (expensive) review sub-page is only
    fetched for extensions whose overall rating is in [zone_min, zone_max];
    out-of-zone extensions return no reviews (metadata is still scraped).

    ``should_skip_reviews``, if given, is called with the freshly-parsed
    ``Extension`` AFTER the zone gate; returning True skips the review fetch (used
    for the "we already have its reviews and nothing's new" optimization). The
    callback owns any DB lookup, keeping this function free of DB imports.
    """
    # Detail page: metadata + description. Reviews are NOT here.
    html, text = browser.fetch(
        parse.detail_url(ext_id),
        wait_selector=selectors.SEL_DETAIL_READY,
        scrolls=2,
    )
    ext = parse.parse_detail(html, ext_id, page_text=text)
    # Tag with a clean, store-matching category name. Prefer the category page we
    # found it under (reliable); for related-only finds (no crawl category), fall
    # back to the detail page's own category breadcrumb when it's unambiguous.
    if category:
        ext.store_category = categories.display_for(category)
    else:
        ext.store_category = categories.category_from_detail(parse.extract_category_slugs(html))
    related = [i for i in parse.extract_extension_ids(html) if i != ext_id]

    # Opportunity-zone gate: skip the costly review fetch for out-of-zone (or
    # unrated) extensions. We still return the extension + related so its metadata
    # and rating snapshot are saved and it can re-qualify on a later crawl.
    if not should_fetch_reviews(
        ext.rating, zone_only=reviews_zone_only, zone_min=zone_min, zone_max=zone_max
    ):
        log.debug(
            "  %s rating=%s outside zone [%s, %s] — skipping reviews",
            ext_id, ext.rating, zone_min, zone_max,
        )
        return ext, [], related

    # Freshness skip: we already have this extension's reviews and there's no sign
    # of new ones (caller decides, via a cheap DB lookup).
    if should_skip_reviews is not None and should_skip_reviews(ext):
        log.debug("  %s reviews already saved and no new ratings — skipping reviews", ext_id)
        return ext, [], related

    # Reviews live on a dedicated sub-page; the store caps each sort at ~10, so we
    # re-sort (Recent + Helpful) and merge to gather more. A non-refresh run
    # reuses the cached snapshot.
    reviews_url = parse.reviews_url(ext_id)
    if not browser.refresh and browser.cache.has(reviews_url, "html"):
        reviews = parse.parse_reviews(browser.cache.get(reviews_url, "html") or "")
    elif multi_sort:
        snapshots = browser.fetch_review_sorts(
            reviews_url,
            selectors.REVIEW_SORTS,
            trigger_selector=selectors.SEL_REVIEW_SORT_TRIGGER,
            option_selector=selectors.SEL_REVIEW_SORT_OPTION,
            expand_texts=selectors.REVIEW_EXPAND_TEXTS,
            load_more_texts=selectors.REVIEW_LOAD_MORE_TEXTS,
            load_more_max=load_more_max,
            scrolls=review_scrolls,
            wait_selector=selectors.SEL_DETAIL_READY,
        )
        reviews = merge_reviews((key, parse.parse_reviews(html)) for key, html in snapshots)
    else:
        reviews_html, _ = browser.fetch(
            reviews_url, wait_selector=selectors.SEL_DETAIL_READY, scrolls=review_scrolls
        )
        reviews = parse.parse_reviews(reviews_html)
    return ext, reviews, related


def persist(ext: Extension, reviews: List[Review], *, write_db: bool) -> int:
    """Upsert the extension + its reviews. Returns # reviews written."""
    if not write_db:
        return 0
    from common import db  # imported lazily so dry runs need no supabase package

    stored = db.upsert_extension(ext.to_row())
    ext_pk = stored.get("id")
    if ext_pk is None:
        log.warning("No id returned for %s; skipping its reviews", ext.ext_id)
        return 0
    written = db.upsert_reviews([r.to_row(ext_pk) for r in reviews])
    # Sticky "helpful" flag for reviews seen under the Helpful sort (separate
    # monotonic UPDATE so a later recent-only re-scrape never clears it).
    helpful_uids = [r.dedupe_uid() for r in reviews if getattr(r, "helpful", False)]
    if helpful_uids:
        try:
            db.mark_reviews_helpful(ext_pk, helpful_uids)
        except Exception as exc:  # most likely: migration 996 not applied yet
            log.warning(
                "could not flag helpful reviews for %s (%s); apply migration "
                "996_reviews_helpful_flag.sql", ext.ext_id, exc,
            )
    db.insert_rating_snapshot(
        {
            "extension_id": ext_pk,
            "rating": ext.rating,
            "rating_count": ext.rating_count,
            "install_count": ext.install_count,
        }
    )
    return written


def crawl(settings: Optional[Settings] = None, opts: Optional[CrawlOptions] = None) -> dict:
    s = settings or default_settings
    opts = opts or CrawlOptions()
    if opts.write_db:
        s.require_supabase()

    stats = {"categories": 0, "ids": 0, "extensions": 0, "reviews": 0, "skipped": 0, "reviews_fresh": 0}
    stats_lock = threading.Lock()

    def bump(key: str, n: int = 1) -> None:
        with stats_lock:
            stats[key] += n

    # `seen` short-circuits work: ids already scraped this run (cross-category
    # duplicates), plus — depending on options — ids we should not re-scrape:
    #   --refresh-after-days N : skip ids scraped within the last N days (re-scrape older)
    #   --skip-existing        : skip every id already in the DB
    seen: set = set()
    if opts.refresh_after_days is not None:
        from common import db  # lazy: dry runs without supabase still import this module

        cutoff = (datetime.now(timezone.utc) - timedelta(days=opts.refresh_after_days)).isoformat()
        seen = db.ext_ids_scraped_since(cutoff)
        log.info(
            "refresh mode: %d extensions scraped in the last %d day(s) will be skipped; "
            "older ones get re-scraped",
            len(seen), opts.refresh_after_days,
        )
    elif opts.skip_existing:
        from common import db  # lazy: dry runs without supabase still import this module

        seen = db.existing_ext_ids()
        log.info("skip-existing: %d extensions already in the DB will be skipped", len(seen))
    seen_lock = threading.Lock()

    # One rate limiter shared by every worker so the aggregate navigation rate
    # stays polite no matter how high --concurrency goes (see build_worker_browser).
    rate_seconds = opts.rate_limit_seconds if opts.rate_limit_seconds is not None else s.rate_limit_seconds
    shared_rl = RateLimiter(rate_seconds)

    # The frontier is a thread-safe queue. With --follow-related, workers push
    # newly discovered ids back onto it as they run, so completion is detected via
    # queue.join() (every queued id task_done) + one stop sentinel per worker.
    frontier: "queue.Queue" = queue.Queue()
    discovered: set = set()
    discovered_lock = threading.Lock()

    def enqueue(ext_id: str, category: Optional[str]) -> bool:
        with discovered_lock:
            if ext_id in discovered:
                return False
            if opts.max_total and len(discovered) >= opts.max_total:
                return False
            discovered.add(ext_id)
        bump("ids")
        frontier.put((ext_id, category))
        return True

    # --- Seed phase (serial, one browser): resolve categories and fill the
    # frontier from each category page before the workers start draining it.
    # --all-categories follows the store's own nav (the whole taxonomy); otherwise
    # use what was asked for, falling back to the configured TARGET_CATEGORIES.
    # Running this in the main thread also surfaces a broken browser environment
    # (no Playwright / no Chromium) up to main() before any worker spins up.
    with build_worker_browser(s, opts, shared_rl) as browser:
        if opts.all_categories:
            categories = discover_categories(browser) or opts.categories or list(s.target_categories)
        else:
            categories = opts.categories or list(s.target_categories)
        log.info("crawling %d categories", len(categories))
        for category in categories:
            # Tell the operator when a count came from the on-disk cache rather
            # than a fresh fetch — otherwise a stale cached list (e.g. "32") looks
            # like a live discovery result. (Cache is bypassed under --refresh /
            # --preset daily.)
            from_cache = (not browser.refresh) and browser.cache.has(
                parse.category_url(category), "html"
            )
            ids = collect_extension_ids(
                browser, category, max_extensions=opts.max_extensions, opts=opts
            )
            bump("categories")
            new_here = sum(1 for ext_id in ids if enqueue(ext_id, category))
            log.info(
                "category '%s' -> %d extensions (%d new; frontier=%d)%s",
                category, len(ids), new_here, frontier.qsize(),
                " [cached — pass --refresh to re-fetch]" if from_cache else "",
            )

    # --- Process phase: N worker threads, each with its OWN browser (Playwright's
    # sync API is thread-affine, so a browser can't be shared across threads),
    # drain the frontier in parallel. Concurrency overlaps the slow on-page work
    # (scroll / "Load more" / "Show more"); the shared rate limiter keeps the
    # request rate polite.
    # Freshness skip: when enabled (and writing to the DB), a cheap per-extension
    # lookup lets us skip re-fetching reviews we already have when no new ratings
    # have appeared. Built once; the closure counts each skip into stats.
    skip_reviews_pred = None
    if opts.skip_reviews_if_saved > 0 and opts.write_db:
        from common import db  # lazy: only needed when the optimization is on

        def skip_reviews_pred(ext: Extension) -> bool:
            try:
                prior = db.fetch_review_freshness(ext.ext_id)
            except Exception as exc:  # a lookup hiccup must never skip a real fetch
                log.debug("freshness lookup failed for %s (%s); fetching reviews", ext.ext_id, exc)
                return False
            if prior is None:
                return False
            fresh = reviews_are_fresh(
                ext.rating_count, prior.get("rating_count"), prior.get("review_count"),
                min_saved=opts.skip_reviews_if_saved,
            )
            if fresh:
                bump("reviews_fresh")
            return fresh

    def process_one(browser: CWSBrowser, ext_id: str, category: Optional[str]) -> None:
        with seen_lock:
            if ext_id in seen:
                bump("skipped")
                return
            seen.add(ext_id)
        try:
            ext, reviews, related = scrape_extension(
                browser, ext_id, category=category,
                review_scrolls=opts.review_scrolls, multi_sort=opts.multi_sort,
                load_more_max=opts.load_more_max,
                reviews_zone_only=opts.reviews_zone_only,
                zone_min=opts.zone_min, zone_max=opts.zone_max,
                should_skip_reviews=skip_reviews_pred,
            )
            written = persist(ext, reviews, write_db=opts.write_db)
        except RobotsDisallowed:
            log.warning("robots.txt disallows %s; skipping", ext_id)
            return
        except Exception as exc:  # one bad page must never kill a worker
            log.exception("failed to scrape %s: %s", ext_id, exc)
            return
        bump("extensions")
        bump("reviews", written if opts.write_db else len(reviews))
        new_related = 0
        if opts.follow_related:
            new_related = sum(1 for rid in related if enqueue(rid, None))
        log.info(
            "  %s '%s' rating=%s installs=%s reviews=%d%s [+%d related, frontier=%d]",
            ext_id, ext.name, ext.rating, ext.install_count, len(reviews),
            "" if opts.write_db else " (dry-run)", new_related, frontier.qsize(),
        )

    n_workers = max(1, opts.concurrency)
    launch_failures = {"n": 0}
    lf_lock = threading.Lock()

    def drain_frontier() -> None:
        """Mark every queued item done without processing — releases queue.join()
        if (and only if) no worker could start a browser, so the run can't hang."""
        while True:
            try:
                frontier.get_nowait()
            except queue.Empty:
                return
            frontier.task_done()

    def worker() -> None:
        try:
            with build_worker_browser(s, opts, shared_rl) as browser:
                while True:
                    item = frontier.get()
                    try:
                        if item is None:  # stop sentinel
                            return
                        process_one(browser, *item)
                    finally:
                        frontier.task_done()
        except Exception as exc:  # reaching here = the browser couldn't start
            log.exception("crawl worker could not start: %s", exc)
            with lf_lock:
                launch_failures["n"] += 1
                all_failed = launch_failures["n"] >= n_workers
            if all_failed:
                drain_frontier()

    log.info("processing frontier (%d queued) with %d worker(s)", frontier.qsize(), n_workers)
    workers = [
        threading.Thread(target=worker, name=f"crawl-{i}", daemon=True)
        for i in range(n_workers)
    ]
    for t in workers:
        t.start()
    frontier.join()                 # block until every queued id (incl. related) is done
    for _ in workers:
        frontier.put(None)          # one stop sentinel per worker
    for t in workers:
        t.join()

    stats["discovered"] = len(discovered)
    log.info("done: %s", stats)
    return stats
