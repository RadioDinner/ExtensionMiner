"""Detect and link the same product re-published under a different ext_id.

The Chrome ext_id is the primary identity (same id => just an update). This pass
is the secondary, multi-point match: it scans the stored extensions and links a
newer listing to the older one it supersedes when >=2 of {name, developer,
website} agree — non-destructively (both rows are kept; the newer one gets a
``successor_of`` pointer). Requires migration 997.

    python -m scraper.successors            # link
    python -m scraper.successors --dry-run  # just report
"""
from __future__ import annotations

import argparse
import logging
import sys

from common.config import settings as default_settings

from . import identity

log = logging.getLogger("successors")


def run(threshold: int = identity.DEFAULT_THRESHOLD, *, write: bool = True) -> dict:
    default_settings.require_supabase()
    from common import db  # lazy: only needed here, keeps imports test-safe

    rows = db.fetch_extensions_for_matching()
    links = identity.link_successors(rows, threshold=threshold)
    log.info("found %d successor link(s) among %d extensions", len(links), len(rows))

    written = 0
    by_id = {r.get("id"): r for r in rows}
    for succ_id, pred_id, hits in links:
        s = by_id.get(succ_id, {})
        p = by_id.get(pred_id, {})
        log.info(
            "  '%s' (%s) is successor_of '%s' (%s) on %s",
            s.get("name"), s.get("ext_id"), p.get("name"), p.get("ext_id"), ",".join(hits),
        )
        if write:
            try:
                written += db.set_successor(succ_id, pred_id, hits)
            except Exception as exc:  # most likely: migration 997 not applied yet
                log.error(
                    "could not write successor link (%s). Apply migration "
                    "997_extension_successor_links.sql to your Supabase project.", exc,
                )
                break
    return {"extensions": len(rows), "links": len(links), "written": written}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        prog="scraper.successors",
        description="Link the same product re-published under different ext_ids",
    )
    p.add_argument("--threshold", type=int, default=identity.DEFAULT_THRESHOLD,
                   help="how many of name/developer/website must agree (default 2)")
    p.add_argument("--dry-run", action="store_true", help="report links, write nothing")
    p.add_argument("--log-level", default="INFO")
    args = p.parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    stats = run(threshold=args.threshold, write=not args.dry_run)
    print(f"\nSummary: {stats}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
