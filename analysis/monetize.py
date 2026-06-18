"""Claude-powered monetization research (feature: "is this extension making money?").

For each extension, Claude uses the **web search** server tool to find its pricing
plans (free / freemium / paid / subscription / ads), gauge its user base, and
estimate monthly revenue, returning a structured ``MonetizationProfile``. Results
are written to the ``monetization`` table the dashboard reads.

Run it standalone (``python -m analysis.monetize``) or fold it into a ranking run
(``python -m analysis.run --monetize``). Needs ANTHROPIC_API_KEY (+ SUPABASE_*
unless --no-db); the web search tool runs server-side on Anthropic's
infrastructure, so this works from any network the Anthropic API is reachable on.

The single network call (``research_monetization``) is isolated so tests can inject
a fake client; ``to_monetization_row`` is a pure mapping.
"""
from __future__ import annotations

import argparse
import logging
import sys
from typing import Any, Dict, List, Literal, Optional

from common.config import Settings
from common.config import settings as default_settings

from pydantic import BaseModel, Field

from .rank import get_anthropic_client

log = logging.getLogger("analysis")

# Web search + fetch server tools (run on Anthropic's infra). The _20260209
# versions add dynamic filtering and are supported on claude-opus-4-8.
WEB_TOOLS = [
    {"type": "web_search_20260209", "name": "web_search"},
    {"type": "web_fetch_20260209", "name": "web_fetch"},
]

PricingModel = Literal["free", "freemium", "paid", "subscription", "ads", "unknown"]
Confidence = Literal["low", "medium", "high"]


class MonetizationProfile(BaseModel):
    """Structured monetization intel for one extension (Claude web-search output)."""

    pricing_model: PricingModel = Field(
        description="How the extension is monetized. 'freemium' = free with a paid tier; "
        "'ads' = ad-supported; 'unknown' if research is inconclusive."
    )
    makes_money: bool = Field(
        description="Best judgment whether this extension generates revenue (paid tiers, "
        "subscriptions, ads, etc.). False for purely free/hobby extensions."
    )
    has_paid_tier: bool = Field(description="True if there is any paid/premium tier or subscription.")
    price_min_usd: float = Field(
        description="Lowest paid price point in USD (monthly figure for subscriptions). 0 if free/unknown."
    )
    price_max_usd: float = Field(
        description="Highest paid price point in USD (monthly figure for subscriptions). 0 if free/unknown."
    )
    estimated_users: int = Field(
        description="Best estimate of the active user base. Use the Chrome Web Store install "
        "count as a prior and adjust from research. 0 if unknown."
    )
    estimated_monthly_revenue_usd: float = Field(
        description="Point estimate of monthly revenue in USD (users x conversion x price, or "
        "ad revenue). 0 if free/unknown. Be conservative and explain the basis in pricing_notes."
    )
    revenue_low_usd: float = Field(description="Low end of the monthly-revenue estimate range, USD.")
    revenue_high_usd: float = Field(description="High end of the monthly-revenue estimate range, USD.")
    confidence: Confidence = Field(description="Confidence in the revenue estimate given the evidence found.")
    monetization_summary: str = Field(
        description="One or two sentences: how it makes money and roughly how much."
    )
    pricing_notes: str = Field(
        description="The pricing tiers/plans found and the assumptions behind the revenue estimate "
        "(assumed conversion rate, ARPU, etc.). Say so if you couldn't find pricing."
    )
    sources: List[str] = Field(
        default_factory=list,
        description="URLs actually consulted (pricing pages, the listing, articles). Never invent URLs.",
    )


SYSTEM = (
    "You are a market analyst estimating whether a Chrome extension makes money and how much.\n\n"
    "Use web search to find the extension's pricing (its website/pricing page, the Chrome Web "
    "Store listing, reviews, articles). Determine the pricing model (free / freemium / paid / "
    "subscription / ad-supported) and the price points. Then estimate monthly revenue from the "
    "user base and a plausible paid-conversion rate (or ad RPM) — state every assumption.\n\n"
    "Be conservative and honest about uncertainty: give a low–high range and a confidence level, "
    "and set pricing_model='unknown' / makes_money=false when you genuinely can't tell. NEVER "
    "invent prices, user numbers, or source URLs — only cite pages you actually consulted."
)


def build_user_prompt(ext: Dict[str, Any]) -> str:
    lines = [
        f"Extension: {ext.get('name')}",
        f"Category: {ext.get('store_category') or 'unknown'}",
        f"Chrome Web Store installs: {ext.get('install_count')}    "
        f"Rating: {ext.get('rating')} ({ext.get('rating_count')} ratings)",
    ]
    if ext.get("website"):
        lines.append(f"Developer website: {ext.get('website')}")
    if ext.get("ext_id"):
        lines.append(
            f"Store listing: https://chromewebstore.google.com/detail/{ext.get('ext_id')}"
        )
    lines += [
        "",
        "Research this extension's monetization: find its pricing plans, judge whether it makes "
        "money and how, and estimate its monthly revenue with a low–high range. Show your "
        "assumptions and cite the pages you used.",
    ]
    return "\n".join(lines)


def research_monetization(
    client, ext: Dict[str, Any], *, model: str
) -> MonetizationProfile:
    """One web-search-backed Claude call -> MonetizationProfile. ``client`` injected for testing."""
    message = client.messages.parse(
        model=model,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        tools=WEB_TOOLS,
        system=SYSTEM,
        messages=[{"role": "user", "content": build_user_prompt(ext)}],
        output_format=MonetizationProfile,
    )
    return message.parsed_output


def to_monetization_row(extension_pk: int, profile: MonetizationProfile, model: str) -> Dict[str, Any]:
    return {"extension_id": extension_pk, **profile.model_dump(), "model": model}


def monetize_all(
    settings: Optional[Settings] = None,
    *,
    limit: int = 25,
    write_db: bool = True,
    model: Optional[str] = None,
    force: Optional[bool] = None,
) -> List[Dict[str, Any]]:
    """Research monetization for the top-N extensions.

    Incremental like the ranker: ``force`` None reads the dashboard toggle
    (``ranking_force_rerun``); False skips extensions that already have a
    ``monetization`` row; True re-researches the whole top-N. Under ``--no-db``
    it defaults to True.
    """
    s = settings or default_settings
    model = model or s.anthropic_model
    s.require_anthropic()
    if write_db:
        s.require_supabase()

    from common import db  # lazy: only needed when actually run
    from .rank import select_for_analysis

    if force is None:
        force = db.get_ranking_force_rerun() if write_db else True

    candidates = db.fetch_extensions_for_analysis(limit=limit)
    done_ids = set() if (force or not write_db) else db.fetch_monetized_extension_ids()
    todo = select_for_analysis(candidates, done_ids, force=force)
    log.info(
        "monetization: %d of %d candidates (%s)",
        len(todo), len(candidates),
        "full re-run — override ON" if force else "incremental — newly added only",
    )

    client = get_anthropic_client()
    rows: List[Dict[str, Any]] = []
    for ext in todo:
        try:
            profile = research_monetization(client, ext, model=model)
        except Exception as exc:  # one bad extension shouldn't kill the run
            log.exception("monetization research failed for '%s': %s", ext.get("name"), exc)
            continue
        row = to_monetization_row(ext["id"], profile, model)
        if write_db:
            try:
                db.upsert_monetization(row)
            except Exception as exc:  # most likely: migration 995 not applied yet
                log.warning(
                    "could not write monetization for '%s' (%s); apply migration "
                    "995_extension_monetization.sql", ext.get("name"), exc,
                )
        rows.append(row)
        log.info(
            "monetized '%s' -> %s, ~$%s/mo (%s confidence)",
            ext.get("name"), profile.pricing_model,
            round(profile.estimated_monthly_revenue_usd), profile.confidence,
        )
    return rows


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="analysis.monetize", description="Claude monetization researcher")
    p.add_argument("--limit", type=int, default=25, help="extensions to research (by installs)")
    p.add_argument("--model", default=None, help="Anthropic model (default: ANTHROPIC_MODEL or claude-opus-4-8)")
    p.add_argument("--no-db", action="store_true", help="dry run: research, but don't write the monetization table")
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
            "\n[ERROR] ANTHROPIC_API_KEY isn't set — the monetization researcher calls the "
            "Claude API (web search).\n        Add it to your .env "
            "(https://console.anthropic.com/).",
            file=sys.stderr,
        )
        return 2
    rows = monetize_all(default_settings, limit=args.limit, write_db=not args.no_db, model=args.model)
    rows.sort(key=lambda r: r.get("estimated_monthly_revenue_usd") or 0, reverse=True)
    print(f"\nMonetization (researched {len(rows)}):")
    for r in rows[:20]:
        print(f"  ~${round(r.get('estimated_monthly_revenue_usd') or 0):>9,}/mo  {r.get('pricing_model'):11}  {(r.get('monetization_summary') or '')[:70]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
