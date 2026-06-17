"""CLI entrypoint for the scraper.

Examples
--------
    # The daily scheduled run (full refresh crawl of the WHOLE store taxonomy;
    # upserts dedupe so only NEW reviews/ratings land):
    python -m scraper.run --preset daily --log-dir logs

    # Crawl every category once, capped at 50 each, into Supabase:
    python -m scraper.run --all-categories --max-extensions 50

    # Dry run (no DB writes), just 2 extensions, keep the browser visible:
    python -m scraper.run --max-extensions 2 --no-db --no-headless

    # Real run into Supabase for specific categories:
    python -m scraper.run --categories productivity developer-tools

On Windows you normally don't call this by hand — double-click
``scripts\\run_scraper.cmd`` (it bootstraps the venv, installs Chromium, and
runs the daily preset), or let the scheduled task created by
``scripts\\install_daily_task.cmd`` call it for you.

Must run where the Chrome Web Store is reachable (it is egress-blocked in
Claude-Code-on-the-web). Browsers install automatically via the launcher; by
hand it is `python -m playwright install chromium`.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime

from common.config import settings as default_settings

from .crawl import CrawlOptions, crawl

log = logging.getLogger("scraper")

# Exit codes the launcher / Task Scheduler can read (0 = success).
EXIT_OK = 0
EXIT_ERROR = 1
EXIT_NO_SUPABASE = 2
EXIT_NO_BROWSER = 3
EXIT_STORE_UNREACHABLE = 4


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="scraper.run", description="Chrome Web Store review miner")
    p.add_argument("--preset", choices=["daily"], default=None,
                   help="apply a named run profile. 'daily' = full refresh crawl of every "
                        "configured category (no per-category cap, cache bypassed so new "
                        "reviews/ratings are seen); upserts dedupe, so an extension already "
                        "stored only gains its NEW reviews and is otherwise a no-op. Built "
                        "for the daily scheduled task.")
    p.add_argument("--categories", nargs="+", metavar="SLUG",
                   help="category slugs to crawl (default: TARGET_CATEGORIES from env)")
    p.add_argument("--all-categories", action="store_true",
                   help="discover and crawl the store's WHOLE category taxonomy (from its "
                        "nav), not just --categories. Implied by --preset daily.")
    p.add_argument("--max-extensions", type=int, default=None,
                   help="max extensions per category (0 = no cap; default 25, or 0 under "
                        "--preset daily)")
    p.add_argument("--category-scrolls", type=int, default=40,
                   help="max scroll passes to exhaust a category's extension list "
                        "(default 40; stops early once no new ids appear)")
    p.add_argument("--discovery-patience", type=int, default=3,
                   help="stop scrolling a category after this many passes surface no new "
                        "extensions (default 3)")
    p.add_argument("--review-scrolls", type=int, default=6,
                   help="lazy-load scroll passes on a detail page (default 6)")
    p.add_argument("--no-db", action="store_true",
                   help="dry run: fetch + parse + cache, but do not write to Supabase")
    p.add_argument("--no-headless", action="store_true",
                   help="show the browser window (useful while tuning selectors)")
    p.add_argument("--refresh", action="store_true",
                   help="ignore the cache and re-fetch pages (implied by --preset daily)")
    p.add_argument("--skip-existing", action="store_true",
                   help="skip extensions already stored in the DB (faster resume)")
    p.add_argument("--refresh-after-days", type=int, metavar="N", default=None,
                   help="refresh mode: re-scrape extensions whose last_scraped is older "
                        "than N days, skip fresher ones (implies cache bypass)")
    p.add_argument("--no-robots", action="store_true",
                   help="skip the robots.txt check (use responsibly)")
    p.add_argument("--log-level", default="INFO",
                   help="DEBUG / INFO / WARNING (default INFO)")
    p.add_argument("--log-dir", metavar="DIR", default=None,
                   help="also write a timestamped log file into DIR (e.g. 'logs'). The "
                        "console still shows progress; the file is the record a scheduled "
                        "run leaves behind.")
    return p


def configure_logging(level_name: str, log_dir: str | None) -> str | None:
    """Set up console (+ optional timestamped file) logging. Returns the log path."""
    level = getattr(logging, level_name.upper(), logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    root = logging.getLogger()
    root.setLevel(level)
    # Reset handlers so repeated runs in one process don't stack duplicates.
    for h in list(root.handlers):
        root.removeHandler(h)

    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root.addHandler(console)

    log_path: str | None = None
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        log_path = os.path.join(log_dir, f"scraper-{ts}.log")
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setFormatter(fmt)
        root.addHandler(file_handler)
    return log_path


def resolve_options(args: argparse.Namespace) -> CrawlOptions:
    """Turn parsed args (+ any preset) into CrawlOptions."""
    max_extensions = args.max_extensions
    refresh = args.refresh
    all_categories = args.all_categories

    if args.preset == "daily":
        # Full crawl of the WHOLE store taxonomy, re-checking everything for new
        # reviews. Cache is bypassed so we actually see new reviews; upserts dedupe
        # so an already-stored extension just gains its new reviews and moves on.
        if max_extensions is None:
            max_extensions = 0  # no per-category cap
        refresh = True
        all_categories = True

    if max_extensions is None:
        max_extensions = 25  # the interactive default

    return CrawlOptions(
        categories=args.categories or [],
        all_categories=all_categories,
        max_extensions=max_extensions,
        category_scrolls=args.category_scrolls,
        discovery_patience=args.discovery_patience,
        review_scrolls=args.review_scrolls,
        write_db=not args.no_db,
        headless=not args.no_headless,
        refresh=refresh,
        respect_robots=not args.no_robots,
        skip_existing=args.skip_existing,
        refresh_after_days=args.refresh_after_days,
    )


def explain_failure(exc: Exception) -> int:
    """Translate a known failure into one plain-English line + an exit code.

    Keeps the common 'it errored out and was gross' cases from dumping a raw
    traceback on a scheduled run. Returns the exit code to use.
    """
    msg = str(exc)
    low = msg.lower()

    if "no module named 'playwright'" in low:
        print(
            "\n[ERROR] Playwright isn't installed in this environment.\n"
            "        Fix it once with:\n"
            "            python -m pip install -r requirements.txt\n"
            "            python -m playwright install chromium\n"
            "        (The scripts\\run_scraper.cmd launcher does both for you.)",
            file=sys.stderr,
        )
        return EXIT_NO_BROWSER

    if "playwright install" in low or "executable doesn't exist" in low or \
            "looks like playwright" in low:
        print(
            "\n[ERROR] The Chromium browser Playwright needs isn't installed.\n"
            "        Fix it once with:\n"
            "            python -m playwright install chromium\n"
            "        (The scripts\\run_scraper.cmd launcher does this for you.)",
            file=sys.stderr,
        )
        return EXIT_NO_BROWSER

    if any(s in msg for s in ("ERR_", "net::", "NS_ERROR", "ECONNREFUSED", "403")) or \
            "timeout" in low and "chromewebstore" in low:
        print(
            "\n[ERROR] Couldn't reach the Chrome Web Store.\n"
            "        On your own machine this usually means no internet / a proxy.\n"
            "        Note: the store is egress-blocked inside Claude-Code-on-the-web,\n"
            "        so the scraper must run on your local machine.",
            file=sys.stderr,
        )
        return EXIT_STORE_UNREACHABLE

    log.exception("Unexpected failure: %s", exc)
    return EXIT_ERROR


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    log_path = configure_logging(args.log_level, args.log_dir)
    if log_path:
        log.info("logging to %s", log_path)

    opts = resolve_options(args)

    if args.preset == "daily":
        log.info(
            "preset 'daily': full refresh crawl of the WHOLE category taxonomy "
            "(no cap, cache bypassed); already-stored extensions only gain new reviews"
        )

    # Friendly preflight for the most common stumble: missing Supabase creds.
    if opts.write_db:
        try:
            default_settings.require_supabase()
        except RuntimeError as exc:
            print(
                f"\n[ERROR] {exc}.\n"
                "        Copy .env.example to .env and fill in SUPABASE_URL and the\n"
                "        SUPABASE_SERVICE_ROLE_KEY (the SECRET key, not the publishable one).\n"
                "        Or pass --no-db for a dry run that writes nothing.",
                file=sys.stderr,
            )
            return EXIT_NO_SUPABASE

    try:
        stats = crawl(default_settings, opts)
    except KeyboardInterrupt:
        log.warning("interrupted by user")
        return EXIT_ERROR
    except Exception as exc:  # noqa: BLE001 - translate to a friendly message
        return explain_failure(exc)

    print(f"\nSummary: {stats}")
    if stats.get("extensions", 0) == 0 and stats.get("ids", 0) == 0:
        print(
            "Note: 0 extensions found. If you expected data, check your "
            "--categories / TARGET_CATEGORIES and that the store is reachable."
        )
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
