"""CLI for the Claude ranking layer.

    # Score the top 25 extensions by installs and write `opportunities`:
    python -m analysis.run

    # Dry run (no DB writes), smaller batch, explicit model:
    python -m analysis.run --limit 5 --no-db --model claude-opus-4-8

Needs ANTHROPIC_API_KEY (and SUPABASE_* unless --no-db). The Anthropic API is
reachable from the web env, so this can run here once data exists in Supabase.

On Windows you normally don't call this by hand — double-click
``scripts\\run_ranker.cmd`` (or its Desktop button), which sets up the venv and
runs this for you.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime

from common.config import settings

from .rank import rank_all

log = logging.getLogger("analysis")

# Exit codes the launcher can read (0 = success).
EXIT_OK = 0
EXIT_ERROR = 1
EXIT_NO_ANTHROPIC = 2
EXIT_NO_SUPABASE = 3


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="analysis.run", description="Claude review-mining ranker")
    p.add_argument("--limit", type=int, default=25, help="extensions to score (by installs)")
    p.add_argument("--min-reviews", type=int, default=5, help="skip extensions with fewer reviews")
    p.add_argument("--max-reviews", type=int, default=120, help="reviews sent to Claude per extension")
    p.add_argument("--model", default=None, help="Anthropic model (default: ANTHROPIC_MODEL or claude-opus-4-8)")
    p.add_argument("--no-db", action="store_true", help="dry run: analyze + score, but don't write opportunities")
    p.add_argument("--monetize", action="store_true",
                   help="also research each extension's monetization (pricing / revenue) with web "
                        "search and write the monetization table (see analysis/monetize.py)")
    p.add_argument("--log-level", default="INFO")
    p.add_argument("--log-dir", metavar="DIR", default=None,
                   help="also write a timestamped log file into DIR (e.g. 'logs'). The "
                        "console still shows progress; the file is the record a button "
                        "run leaves behind.")
    return p


def configure_logging(level_name: str, log_dir: str | None) -> str | None:
    """Console (+ optional timestamped file) logging. Returns the log path."""
    level = getattr(logging, level_name.upper(), logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    root = logging.getLogger()
    root.setLevel(level)
    for h in list(root.handlers):
        root.removeHandler(h)

    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root.addHandler(console)

    log_path: str | None = None
    if log_dir:
        os.makedirs(log_dir, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        log_path = os.path.join(log_dir, f"ranker-{ts}.log")
        fh = logging.FileHandler(log_path, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
    return log_path


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    log_path = configure_logging(args.log_level, args.log_dir)
    if log_path:
        log.info("logging to %s", log_path)

    # Friendly preflight: the two most common stumbles are a missing Anthropic key
    # and (for a real run) missing Supabase creds.
    if not settings.anthropic_api_key:
        print(
            "\n[ERROR] ANTHROPIC_API_KEY isn't set.\n"
            "        The ranking layer calls the Claude API, so add ANTHROPIC_API_KEY\n"
            "        to your .env (get a key at https://console.anthropic.com/).",
            file=sys.stderr,
        )
        return EXIT_NO_ANTHROPIC
    if not args.no_db:
        try:
            settings.require_supabase()
        except RuntimeError as exc:
            print(
                f"\n[ERROR] {exc}.\n"
                "        The ranker reads extensions/reviews and writes the opportunities\n"
                "        table. Fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env,\n"
                "        or pass --no-db for a dry run.",
                file=sys.stderr,
            )
            return EXIT_NO_SUPABASE

    try:
        rows = rank_all(
            settings,
            limit=args.limit,
            min_reviews=args.min_reviews,
            max_reviews=args.max_reviews,
            write_db=not args.no_db,
            model=args.model,
        )
    except KeyboardInterrupt:
        log.warning("interrupted by user")
        return EXIT_ERROR
    except Exception as exc:  # noqa: BLE001 - one friendly line instead of a raw traceback
        log.exception("ranking failed: %s", exc)
        return EXIT_ERROR

    rows.sort(key=lambda r: r["score"], reverse=True)
    print(f"\nTop opportunities ({len(rows)} scored):")
    for r in rows[:20]:
        print(f"  {r['score']:5.1f}  {(r['top_complaint'] or '—')[:80]}")
    if not rows:
        print(
            "\nNote: 0 extensions scored. Most likely none have enough reviews yet "
            f"(--min-reviews={args.min_reviews}). Run the scraper first to collect "
            "reviews, or lower --min-reviews."
        )

    # Optional: also research monetization (pricing / revenue) for the same batch.
    if args.monetize:
        from .monetize import monetize_all

        log.info("researching monetization for up to %d extensions (web search)", args.limit)
        try:
            money = monetize_all(settings, limit=args.limit, write_db=not args.no_db, model=args.model)
            print(f"\nMonetization researched: {len(money)} extensions.")
        except Exception as exc:  # never let monetization sink an otherwise-good ranking run
            log.warning("monetization pass skipped (%s)", exc)

    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
