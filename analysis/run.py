"""CLI for the Claude ranking layer.

    # Score the top 25 extensions by installs and write `opportunities`:
    python -m analysis.run

    # Dry run (no DB writes), smaller batch, explicit model:
    python -m analysis.run --limit 5 --no-db --model claude-opus-4-8

Needs ANTHROPIC_API_KEY (and SUPABASE_* unless --no-db). The Anthropic API is
reachable from the web env, so this can run here once data exists in Supabase.
"""
from __future__ import annotations

import argparse
import logging
import sys

from common.config import settings

from .rank import rank_all


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="analysis.run", description="Claude review-mining ranker")
    p.add_argument("--limit", type=int, default=25, help="extensions to score (by installs)")
    p.add_argument("--min-reviews", type=int, default=5, help="skip extensions with fewer reviews")
    p.add_argument("--max-reviews", type=int, default=120, help="reviews sent to Claude per extension")
    p.add_argument("--model", default=None, help="Anthropic model (default: ANTHROPIC_MODEL or claude-opus-4-8)")
    p.add_argument("--no-db", action="store_true", help="dry run: analyze + score, but don't write opportunities")
    p.add_argument("--log-level", default="INFO")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    rows = rank_all(
        settings,
        limit=args.limit,
        min_reviews=args.min_reviews,
        max_reviews=args.max_reviews,
        write_db=not args.no_db,
        model=args.model,
    )
    rows.sort(key=lambda r: r["score"], reverse=True)
    print(f"\nTop opportunities ({len(rows)} scored):")
    for r in rows[:20]:
        print(f"  {r['score']:5.1f}  {(r['top_complaint'] or '—')[:80]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
