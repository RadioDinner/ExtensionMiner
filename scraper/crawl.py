"""Crawl orchestration: categories -> extension ids -> detail + reviews -> DB.

Run via ``python -m scraper.run`` (see scraper/run.py). The pure parsing lives in
scraper/parse.py; this module wires fetching, parsing, and persistence together.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

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
    max_extensions: int = 25          # per category; 0 = no cap
    category_scrolls: int = 8         # lazy-load passes on a category page
    review_scrolls: int = 6           # lazy-load passes on a detail page
    write_db: bool = True
    headless: bool = True
    refresh: bool = False             # ignore cache, re-fetch
    respect_robots: bool = True


def build_browser(s: Settings, opts: CrawlOptions) -> CWSBrowser:
    robots_allowed = None
    if opts.respect_robots:
        try:
            robots_allowed = make_checker(fetch_robots(s.user_agent), s.user_agent)
        except Exception as exc:  # network/parse issues shouldn't hard-fail the run
            log.warning("Could not load robots.txt (%s); proceeding without it", exc)
    return CWSBrowser(
        cache=RawCache(s.cache_dir),
        rate_limiter=RateLimiter(s.rate_limit_seconds),
        user_agent=s.user_agent,
        headless=opts.headless,
        robots_allowed=robots_allowed,
        refresh=opts.refresh,
    )


def collect_extension_ids(
    browser: CWSBrowser, category: str, *, max_extensions: int, scrolls: int
) -> List[str]:
    html, _ = browser.fetch(parse.category_url(category), scrolls=scrolls)
    ids = parse.extract_extension_ids(html)
    return ids[:max_extensions] if max_extensions else ids


def scrape_extension(
    browser: CWSBrowser, ext_id: str, *, category: Optional[str] = None, review_scrolls: int = 6
) -> Tuple[Extension, List[Review]]:
    # Detail page: metadata + description. Reviews are NOT here.
    html, text = browser.fetch(
        parse.detail_url(ext_id),
        wait_selector=selectors.SEL_DETAIL_READY,
        scrolls=2,
    )
    ext = parse.parse_detail(html, ext_id, page_text=text)
    if category:
        ext.store_category = category

    # Reviews live on a dedicated sub-page; scroll it to lazy-load more.
    reviews_html, _ = browser.fetch(
        parse.reviews_url(ext_id),
        wait_selector=selectors.SEL_DETAIL_READY,
        scrolls=review_scrolls,
    )
    return ext, parse.parse_reviews(reviews_html)


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
    if not opts.categories:
        opts.categories = list(s.target_categories)
    if opts.write_db:
        s.require_supabase()

    stats = {"categories": 0, "ids": 0, "extensions": 0, "reviews": 0}
    with build_browser(s, opts) as browser:
        for category in opts.categories:
            ids = collect_extension_ids(
                browser, category, max_extensions=opts.max_extensions, scrolls=opts.category_scrolls
            )
            stats["categories"] += 1
            stats["ids"] += len(ids)
            log.info("category '%s' -> %d extensions", category, len(ids))
            for ext_id in ids:
                try:
                    ext, reviews = scrape_extension(
                        browser, ext_id, category=category, review_scrolls=opts.review_scrolls
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
                log.info(
                    "  %s '%s' rating=%s installs=%s reviews=%d%s",
                    ext_id, ext.name, ext.rating, ext.install_count, len(reviews),
                    "" if opts.write_db else " (dry-run)",
                )
    log.info("done: %s", stats)
    return stats
