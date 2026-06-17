"""Claude-powered "deep dive" research for a hand-picked pool of extensions.

This is the expensive, opt-in counterpart to the per-extension ranking pass. The
dashboard lets you add an extension to a **pool** (the ``deep_dives`` table,
migration 993); this module processes the *queued* rows only — so the costly
review + competitor research runs on a few hand-picked targets, not the whole
catalog.

For each queued extension Claude does one structured, web-search-backed call:
read the reviews deeply (recurring problems + sentiment trajectory), research the
**competitors** that exist, and judge the opportunity. The result is written back
to the same row (``status='done'``) and shown on the detail page.

Run it standalone (``python -m analysis.deepdive``) or fold it into a ranking run
(``python -m analysis.run --deep-dive``). Needs ANTHROPIC_API_KEY (+ SUPABASE_*).
The single network call (``research_deep_dive``) is isolated so tests can inject a
fake client; ``to_deep_dive_row`` is a pure mapping.
"""
from __future__ import annotations

import argparse
import logging
import sys
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from common.config import Settings
from common.config import settings as default_settings

from .monetize import WEB_TOOLS  # reuse the web_search/web_fetch server tools
from .rank import get_anthropic_client

log = logging.getLogger("analysis")

Recommendation = Literal["build", "maybe", "avoid"]


class Competitor(BaseModel):
    """One competing product found while researching the extension."""

    name: str = Field(description="Competitor product/extension name.")
    url: str = Field(default="", description="Its homepage or store listing, if found. Never invent URLs.")
    pricing: str = Field(default="", description="How it's priced, e.g. 'free', '$5/mo', 'freemium'.")
    strengths: str = Field(default="", description="What it does well / where it beats the target.")
    weaknesses: str = Field(default="", description="Where it falls short — the opening to exploit.")


class DeepDiveReport(BaseModel):
    """Comprehensive structured research for one extension (Claude web-search output)."""

    what_it_is: str = Field(
        description="Plain overview of what the extension is and does, for someone new to it."
    )
    review_summary: str = Field(
        description="A deep read of the reviews: the recurring problems, what users love, and how "
        "sentiment has moved over time (improving / declining). Ground it in the reviews provided."
    )
    competitors: List[Competitor] = Field(
        default_factory=list,
        description="The real competing products you found via web search (not invented). "
        "Empty list if you genuinely couldn't find any.",
    )
    opportunity: str = Field(
        description="The gap a new entrant could exploit and how to win — the fixable pain plus the "
        "competitive angle. Be concrete."
    )
    recommendation: Recommendation = Field(
        description="Overall verdict on building a competitor: 'build' (clear opening), 'maybe' "
        "(mixed), or 'avoid' (crowded / not worth it)."
    )
    sources: List[str] = Field(
        default_factory=list,
        description="URLs actually consulted (competitor pages, articles, the listing). Never invent URLs.",
    )


SYSTEM = (
    "You are a product strategist doing deep competitive research on ONE Chrome extension a "
    "founder is considering building a competitor against.\n\n"
    "Do two things thoroughly:\n"
    "1. READ THE REVIEWS provided — surface the recurring, fixable problems, what users value, "
    "and whether sentiment is improving or declining. Don't invent complaints.\n"
    "2. RESEARCH THE COMPETITORS with web search — find the real alternative products, how they "
    "price, and where each is strong or weak. Only cite pages you actually consulted; never "
    "invent competitors, prices, or URLs.\n\n"
    "Then judge the opportunity honestly: where's the gap, how would a small new entrant win, and "
    "is it worth building (build / maybe / avoid)? Be concrete and skeptical."
)


def build_user_prompt(ext: Dict[str, Any], reviews: List[Dict[str, Any]]) -> str:
    lines = [
        f"Extension: {ext.get('name')}",
        f"Category: {ext.get('store_category') or 'unknown'}",
        f"Rating: {ext.get('rating')} ({ext.get('rating_count')} ratings)    "
        f"Installs: {ext.get('install_count')}",
    ]
    if ext.get("website"):
        lines.append(f"Developer website: {ext.get('website')}")
    if ext.get("ext_id"):
        lines.append(f"Store listing: https://chromewebstore.google.com/detail/{ext.get('ext_id')}")
    lines += ["", "Reviews (stars | date | text):"]
    for r in reviews:
        body = " ".join((r.get("body") or "").split())
        lines.append(f"- {r.get('stars')}★ | {r.get('reviewed_at') or '?'} | {body}")
    lines += [
        "",
        "Do a deep dive: read these reviews for the recurring fixable problems and the sentiment "
        "trajectory, then web-search the competing products (pricing, strengths, weaknesses). "
        "Finish with the concrete opportunity for a new entrant and a build/maybe/avoid verdict. "
        "Cite the pages you used.",
    ]
    return "\n".join(lines)


def research_deep_dive(
    client, ext: Dict[str, Any], reviews: List[Dict[str, Any]], *, model: str
) -> DeepDiveReport:
    """One web-search-backed Claude call -> DeepDiveReport. ``client`` injected for testing."""
    message = client.messages.parse(
        model=model,
        max_tokens=20000,
        thinking={"type": "adaptive"},
        tools=WEB_TOOLS,
        system=SYSTEM,
        messages=[{"role": "user", "content": build_user_prompt(ext, reviews)}],
        output_format=DeepDiveReport,
    )
    return message.parsed_output


def to_deep_dive_row(extension_pk: int, report: DeepDiveReport, model: str) -> Dict[str, Any]:
    """Pure mapping: DeepDiveReport -> a `deep_dives` row marked done."""
    return {
        "extension_id": extension_pk,
        "status": "done",
        "model": model,
        "what_it_is": report.what_it_is,
        "review_summary": report.review_summary,
        "competitors": [c.model_dump() for c in report.competitors],
        "opportunity": report.opportunity,
        "recommendation": report.recommendation,
        "sources": list(report.sources),
        "error": None,
        "details": report.model_dump(),
    }


def deep_dive_all(
    settings: Optional[Settings] = None,
    *,
    limit: int = 25,
    max_reviews: int = 120,
    model: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Process the queued deep-dive pool: research each, write results back.

    Always writes (the queue lives in the DB); there's no dry-run mode because the
    pool is read from Supabase. Returns the rows written.
    """
    s = settings or default_settings
    model = model or s.anthropic_model
    s.require_anthropic()
    s.require_supabase()

    from common import db  # lazy: only needed when actually run

    queue = db.fetch_deep_dive_queue(limit=limit)
    if not queue:
        log.info("deep-dive pool is empty — nothing queued.")
        return []

    client = get_anthropic_client()
    rows: List[Dict[str, Any]] = []
    for item in queue:
        ext = item.get("extensions") or {}
        ext_pk = item.get("extension_id")
        name = ext.get("name") or ext_pk
        reviews = db.fetch_reviews_for_extension(ext_pk, limit=max_reviews)
        try:
            report = research_deep_dive(client, ext, reviews, model=model)
        except Exception as exc:  # one bad extension shouldn't kill the run
            log.exception("deep dive failed for '%s': %s", name, exc)
            db.mark_deep_dive_error(ext_pk, str(exc))
            continue
        row = to_deep_dive_row(ext_pk, report, model)
        db.upsert_deep_dive(row)
        rows.append(row)
        log.info(
            "deep-dived '%s' -> %s (%d competitors)",
            name, report.recommendation, len(report.competitors),
        )
    return rows


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="analysis.deepdive", description="Claude deep-dive researcher (pool)")
    p.add_argument("--limit", type=int, default=25, help="max queued extensions to process this run")
    p.add_argument("--max-reviews", type=int, default=120, help="reviews sent to Claude per extension")
    p.add_argument("--model", default=None, help="Anthropic model (default: ANTHROPIC_MODEL or claude-opus-4-8)")
    p.add_argument("--log-level", default="INFO")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    if not default_settings.anthropic_api_key:
        print(
            "\n[ERROR] ANTHROPIC_API_KEY isn't set — the deep-dive researcher calls the "
            "Claude API (web search).\n        Add it to your .env "
            "(https://console.anthropic.com/).",
            file=sys.stderr,
        )
        return 2
    rows = deep_dive_all(default_settings, limit=args.limit, max_reviews=args.max_reviews, model=args.model)
    print(f"\nDeep dives completed: {len(rows)}")
    for r in rows[:20]:
        print(f"  [{r.get('recommendation'):5}] {(r.get('what_it_is') or '')[:70]}")
    if not rows:
        print(
            "\nNote: nothing was queued. Open an extension on the dashboard and click "
            "'Add to deep-dive pool', then run this again."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
