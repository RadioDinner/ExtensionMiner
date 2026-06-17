"""Crawl orchestration: categories -> extension ids -> detail + reviews -> DB.

Run via ``python -m scraper.run`` (see scraper/run.py). The pure parsing lives in
scraper/parse.py; this module wires fetching, parsing, and persistence together.
"""
from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional, Tuple

from common.config import Settings
from common.config import settings as default_settings

from . import parse, selectors
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
    follow_related: bool = False      # graph-crawl: enqueue each page's related ids
    max_total: int = 0                # cap on total extensions discovered (0 = no cap)
    write_db: bool = True
    headless: bool = True
    refresh: bool = False             # ignore cache, re-fetch
    respect_robots: bool = True
    skip_existing: bool = False       # skip ext_ids already stored in the DB
    refresh_after_days: Optional[int] = None  # re-scrape rows older than N days; skip fresher


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
    return CWSBrowser(
        cache=RawCache(s.cache_dir),
        rate_limiter=RateLimiter(s.rate_limit_seconds),
        user_agent=s.user_agent,
        headless=opts.headless,
        robots_allowed=robots_allowed,
        refresh=refresh,
    )


def discover_categories(browser: CWSBrowser) -> List[str]:
    """Read the store's category taxonomy from its homepage nav.

    Returns every ``/category/extensions/<slug>`` the nav links to, so a crawl
    follows the store's own menu instead of a hardcoded list. Empty on failure
    (the caller falls back to the configured categories).
    """
    try:
        html, _ = browser.fetch(selectors.HOME_URL, scrolls=2)
    except Exception as exc:  # discovery must never hard-fail the crawl
        log.warning("category discovery failed (%s); using configured categories", exc)
        return []
    slugs = parse.extract_category_slugs(html)
    log.info("discovered %d categories from the store nav", len(slugs))
    return slugs


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
        )
    return ids[:max_extensions] if max_extensions else ids


def merge_reviews(review_lists: Iterable[Iterable[Review]]) -> List[Review]:
    """De-dupe reviews gathered across multiple sort passes, keyed by dedupe_uid.

    The store id wins when present; otherwise a content hash of (author, date,
    body) — the same key the DB unique index uses — so the same review seen under
    two sort orders collapses to one row.
    """
    out: dict = {}
    for lst in review_lists:
        for r in lst:
            out.setdefault(r.dedupe_uid(), r)
    return list(out.values())


def scrape_extension(
    browser: CWSBrowser,
    ext_id: str,
    *,
    category: Optional[str] = None,
    review_scrolls: int = 6,
    multi_sort: bool = True,
) -> Tuple[Extension, List[Review], List[str]]:
    """Scrape one extension. Returns (extension, reviews, related_ext_ids).

    ``related_ext_ids`` are other extension ids linked from the detail page (the
    "related"/"more from" sections) — the fuel for graph discovery.
    """
    # Detail page: metadata + description. Reviews are NOT here.
    html, text = browser.fetch(
        parse.detail_url(ext_id),
        wait_selector=selectors.SEL_DETAIL_READY,
        scrolls=2,
    )
    ext = parse.parse_detail(html, ext_id, page_text=text)
    if category:
        ext.store_category = category
    related = [i for i in parse.extract_extension_ids(html) if i != ext_id]

    # Reviews live on a dedicated sub-page; the store caps each sort at ~10, so we
    # re-sort (recent/helpful/highest/lowest) and merge to gather more. A
    # non-refresh run reuses the cached snapshot.
    reviews_url = parse.reviews_url(ext_id)
    if not browser.refresh and browser.cache.has(reviews_url, "html"):
        reviews = parse.parse_reviews(browser.cache.get(reviews_url, "html") or "")
    elif multi_sort:
        snapshots = browser.fetch_review_sorts(
            reviews_url,
            [label for _, label in selectors.REVIEW_SORTS],
            trigger_selector=selectors.SEL_REVIEW_SORT_TRIGGER,
            option_selector=selectors.SEL_REVIEW_SORT_OPTION,
            expand_texts=selectors.REVIEW_EXPAND_TEXTS,
            scrolls=review_scrolls,
            wait_selector=selectors.SEL_DETAIL_READY,
        )
        reviews = merge_reviews(parse.parse_reviews(h) for h in snapshots)
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

    stats = {"categories": 0, "ids": 0, "extensions": 0, "reviews": 0, "skipped": 0}

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

    with build_browser(s, opts) as browser:
        # Resolve which categories to crawl. --all-categories follows the store's
        # own nav (the whole taxonomy); otherwise use what was asked for, falling
        # back to the configured TARGET_CATEGORIES.
        if opts.all_categories:
            categories = discover_categories(browser) or opts.categories or list(s.target_categories)
        else:
            categories = opts.categories or list(s.target_categories)
        log.info("crawling %d categories", len(categories))

        # Seed a frontier from the category pages, then (optionally) grow it by
        # following each extension's "related" links — a breadth-first graph crawl
        # that reaches far more than category pages alone expose.
        frontier: deque = deque()
        discovered: set = set()

        def enqueue(ext_id: str, category: Optional[str]) -> bool:
            if ext_id in discovered:
                return False
            if opts.max_total and len(discovered) >= opts.max_total:
                return False
            discovered.add(ext_id)
            frontier.append((ext_id, category))
            stats["ids"] += 1
            return True

        for category in categories:
            ids = collect_extension_ids(
                browser, category, max_extensions=opts.max_extensions, opts=opts
            )
            stats["categories"] += 1
            new_here = sum(1 for ext_id in ids if enqueue(ext_id, category))
            log.info(
                "category '%s' -> %d extensions (%d new; frontier=%d)",
                category, len(ids), new_here, len(frontier),
            )

        while frontier:
            ext_id, category = frontier.popleft()
            if ext_id in seen:
                stats["skipped"] += 1
                continue
            seen.add(ext_id)
            try:
                ext, reviews, related = scrape_extension(
                    browser, ext_id, category=category,
                    review_scrolls=opts.review_scrolls, multi_sort=opts.multi_sort,
                )
            except RobotsDisallowed:
                log.warning("robots.txt disallows %s; skipping", ext_id)
                continue
            except Exception as exc:  # one bad page shouldn't kill the crawl
                log.exception("failed to scrape %s: %s", ext_id, exc)
                continue
            written = persist(ext, reviews, write_db=opts.write_db)
            stats["extensions"] += 1
            stats["reviews"] += written if opts.write_db else len(reviews)
            new_related = 0
            if opts.follow_related:
                new_related = sum(1 for rid in related if enqueue(rid, None))
            log.info(
                "  %s '%s' rating=%s installs=%s reviews=%d%s [+%d related, frontier=%d]",
                ext_id, ext.name, ext.rating, ext.install_count, len(reviews),
                "" if opts.write_db else " (dry-run)", new_related, len(frontier),
            )
    stats["discovered"] = len(discovered)
    log.info("done: %s", stats)
    return stats
