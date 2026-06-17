"""CLI entrypoint for the scraper.

Examples
--------
    # Dry run (no DB writes), just 2 extensions, keep the browser visible:
    python -m scraper.run --max-extensions 2 --no-db --no-headless

    # Real run into Supabase for specific categories:
    python -m scraper.run --categories productivity developer-tools

Must run where the Chrome Web Store is reachable (it is egress-blocked in
Claude-Code-on-the-web). Install browsers once first: `playwright install chromium`.
"""
from __future__ import annotations

import argparse
import logging
import sys

from common.config import settings as default_settings

from .crawl import CrawlOptions, crawl


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="scraper.run", description="Chrome Web Store review miner")
    p.add_argument("--categories", nargs="+", metavar="SLUG",
                   help="category slugs to crawl (default: TARGET_CATEGORIES from env)")
    p.add_argument("--max-extensions", type=int, default=25,
                   help="max extensions per category (0 = no cap; default 25)")
    p.add_argument("--category-scrolls", type=int, default=8,
                   help="lazy-load scroll passes on a category page (default 8)")
    p.add_argument("--review-scrolls", type=int, default=6,
                   help="lazy-load scroll passes on a detail page (default 6)")
    p.add_argument("--no-db", action="store_true",
                   help="dry run: fetch + parse + cache, but do not write to Supabase")
    p.add_argument("--no-headless", action="store_true",
                   help="show the browser window (useful while tuning selectors)")
    p.add_argument("--refresh", action="store_true",
                   help="ignore the cache and re-fetch pages")
    p.add_argument("--skip-existing", action="store_true",
                   help="skip extensions already stored in the DB (faster resume)")
    p.add_argument("--refresh-after-days", type=int, metavar="N", default=None,
                   help="refresh mode: re-scrape extensions whose last_scraped is older "
                        "than N days, skip fresher ones (implies cache bypass)")
    p.add_argument("--no-robots", action="store_true",
                   help="skip the robots.txt check (use responsibly)")
    p.add_argument("--log-level", default="INFO",
                   help="DEBUG / INFO / WARNING (default INFO)")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    opts = CrawlOptions(
        categories=args.categories or [],
        max_extensions=args.max_extensions,
        category_scrolls=args.category_scrolls,
        review_scrolls=args.review_scrolls,
        write_db=not args.no_db,
        headless=not args.no_headless,
        refresh=args.refresh,
        respect_robots=not args.no_robots,
        skip_existing=args.skip_existing,
        refresh_after_days=args.refresh_after_days,
    )
    stats = crawl(default_settings, opts)
    print(f"\nSummary: {stats}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
