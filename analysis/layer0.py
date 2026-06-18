"""Layer 0 — automatic review-legitimacy analysis (the deep-dive pre-screen).

The deep-dive tool is layered:

    Layer 0  (this module)  automatic   reads the reviews → why is the rating
                                        what it is? is it a *real* opportunity?
    Layer 1  (deepdive.py)  headless    one Claude pass: review read + first
                                        competitor look.
    Layer 2  (skill-driven) manual      deep competitor study (deep research).
    Layer 3  (skill-driven) manual      financial study (deep research).

Layer 0 is the cheap, automatic gate. It runs on every extension in the
Opportunity Zone and does NOT touch the web — it only reads the reviews we
already scraped, weighted toward the most RECENT and most HELPFUL ones, and
judges WHY the rating looks the way it does.

The point: a mid/low rating is only an *opportunity* if it comes from real,
fixable product problems. If an extension is 3★ because kids review-bombed it,
or a competitor brigaded it, or the complaints are off-topic, there's no product
gap to exploit. Layer 0 captures that as a ``legitimacy`` score in [0, 1] which
the dashboard uses as a zone-ranking multiplier — so low-legitimacy extensions
sink out of the working top-25.

``classify_reviews`` is the single network call (isolated for testing);
``legitimacy_from_categories`` and ``to_review_analysis_row`` are pure helpers
that are unit tested directly.
"""
from __future__ import annotations

import argparse
import logging
import sys
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from common.config import Settings
from common.config import settings as default_settings

from .rank import get_anthropic_client

log = logging.getLogger("analysis")

# The causes Layer 0 sorts the negativity into. Only `product_issues` is a real,
# fixable opportunity; the rest are noise that should DEMOTE the extension.
Cause = Literal[
    "product_issues",     # genuine, fixable product complaints — the real signal
    "review_bombing",     # coordinated/ off-topic 1★ piling (e.g. kids who hate school)
    "competitor_attack",  # suspicious negativity that smells like a rival brigading
    "off_topic",          # rants unrelated to the product's quality
    "praise",             # positive — not negativity at all
    "mixed",              # genuinely mixed / unclear
]
PrimaryCause = Cause

# How much each cause counts as a *real, fixable* opportunity (the legitimacy
# weight). product_issues = fully legit; praise is neutral (not negativity);
# the noise causes drag legitimacy toward 0.
CAUSE_LEGITIMACY = {
    "product_issues": 1.0,
    "mixed": 0.5,
    "praise": 1.0,        # a well-liked product simply isn't a zone target either way
    "off_topic": 0.15,
    "competitor_attack": 0.1,
    "review_bombing": 0.0,
}


class CauseShare(BaseModel):
    """One slice of why the reviews read the way they do."""

    cause: Cause = Field(description="Which bucket this slice of the reviews falls into.")
    share: float = Field(
        ge=0.0, le=1.0,
        description="Fraction of the NEGATIVE/critical reviews driven by this cause (0..1). "
        "Shares across the negativity should roughly sum to 1.",
    )
    note: str = Field(default="", description="One concrete sentence of evidence for this slice.")


class Layer0Report(BaseModel):
    """Why is this extension's rating what it is — and is it a real opportunity?"""

    verdict: str = Field(
        description="One line: WHY the reviews are good or bad (e.g. 'low rating is a real "
        "sync-bug complaint' vs 'review-bombed by students, product is fine')."
    )
    primary_cause: PrimaryCause = Field(
        description="The single dominant cause of the rating."
    )
    categories: List[CauseShare] = Field(
        default_factory=list,
        description="Breakdown of the negativity by cause, with evidence. Empty only if there is "
        "essentially no negativity to explain.",
    )
    summary: str = Field(
        description="A short paragraph reasoning about the rating: what's real and fixable vs. "
        "noise, grounded in the reviews provided (lean on recent + helpful ones)."
    )
    sentiment_note: str = Field(
        default="",
        description="Plain-words trajectory: are recent reviews better or worse than older ones?",
    )
    legitimacy: Optional[float] = Field(
        default=None,
        ge=0.0, le=1.0,
        description="OPTIONAL override in [0,1]: how much the rating reflects real, fixable product "
        "problems (1.0) vs. noise like review-bombing (0.0). Leave null to let it be computed "
        "from the category breakdown.",
    )


SYSTEM = (
    "You are a review-forensics analyst. For ONE Chrome extension, you are given its rating and a "
    "sample of its reviews. Decide WHY the rating is what it is.\n\n"
    "Weight the most RECENT and most HELPFUL (community-upvoted) reviews most heavily — they reflect "
    "the current product and the complaints people actually agree with.\n\n"
    "Sort the negativity into causes:\n"
    "- product_issues: genuine, fixable problems with the product (the real opportunity).\n"
    "- review_bombing: coordinated or off-topic 1★ piling — e.g. students angry at a school filter, "
    "brigades, rage unrelated to product quality.\n"
    "- competitor_attack: negativity that looks like a rival astroturfing.\n"
    "- off_topic: rants that aren't about the product's quality.\n"
    "- praise / mixed as appropriate.\n\n"
    "The job that matters: a mid/low rating is only a real OPPORTUNITY if it comes from genuine, "
    "fixable product problems. If the rating is dragged down by review-bombing or noise, say so — "
    "that extension is NOT a good target even though its stars look low. Be skeptical and concrete; "
    "ground every claim in the reviews provided. Do not invent complaints."
)


def _sort_for_weighting(reviews: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Most-helpful-then-most-recent first, so the heaviest signal heads the prompt."""
    def key(r: Dict[str, Any]):
        helpful_ranked = 1 if r.get("helpful_ranked") else 0
        helpful_count = r.get("helpful_count") or 0
        reviewed_at = str(r.get("reviewed_at") or "")
        return (helpful_ranked, helpful_count, reviewed_at)

    return sorted(reviews, key=key, reverse=True)


def build_user_prompt(ext: Dict[str, Any], reviews: List[Dict[str, Any]]) -> str:
    rating = ext.get("rating")
    lines = [
        f"Extension: {ext.get('name')}",
        f"Category: {ext.get('store_category') or 'unknown'}",
        f"Store rating: {rating} ({ext.get('rating_count')} ratings)    "
        f"Installs: {ext.get('install_count')}",
        "",
        "Reviews below are ordered most-helpful / most-recent first — weight the top ones most.",
        "(stars | date | 👍 helpful | text)",
    ]
    for r in _sort_for_weighting(reviews):
        body = " ".join((r.get("body") or "").split())
        helpful = "👍" if r.get("helpful_ranked") else (str(r.get("helpful_count")) if r.get("helpful_count") else "")
        lines.append(f"- {r.get('stars')}★ | {r.get('reviewed_at') or '?'} | {helpful} | {body}")
    lines += [
        "",
        "Explain why this rating is what it is. Sort the negativity into causes (product_issues / "
        "review_bombing / competitor_attack / off_topic / mixed / praise) with a share and evidence, "
        "give a one-line verdict, a short reasoning paragraph, and the recent-vs-older trajectory. "
        "Remember: only genuine, fixable product problems make this a real opportunity.",
    ]
    return "\n".join(lines)


def legitimacy_from_categories(report: Layer0Report) -> float:
    """Compute legitimacy in [0,1] from the cause breakdown (model override wins).

    A share-weighted average of each cause's legitimacy weight. With no breakdown
    we fall back to the primary cause, then to 1.0 (neutral — never penalise on no
    evidence). Pure: unit tested.
    """
    if report.legitimacy is not None:
        return round(max(0.0, min(1.0, report.legitimacy)), 3)

    cats = [c for c in report.categories if c.cause != "praise"]
    total = sum(c.share for c in cats)
    if total > 0:
        weighted = sum(CAUSE_LEGITIMACY.get(c.cause, 0.5) * c.share for c in cats)
        return round(max(0.0, min(1.0, weighted / total)), 3)

    # No usable breakdown — lean on the primary cause, defaulting to neutral.
    return round(CAUSE_LEGITIMACY.get(report.primary_cause, 1.0), 3)


def classify_reviews(
    client, ext: Dict[str, Any], reviews: List[Dict[str, Any]], *, model: str
) -> Layer0Report:
    """One structured Claude call (no web tools) -> Layer0Report. ``client`` injected for tests."""
    message = client.messages.parse(
        model=model,
        max_tokens=8000,
        thinking={"type": "adaptive"},
        system=SYSTEM,
        messages=[{"role": "user", "content": build_user_prompt(ext, reviews)}],
        output_format=Layer0Report,
    )
    return message.parsed_output


def to_review_analysis_row(
    extension_pk: int, report: Layer0Report, model: str, *, reviews_analyzed: int
) -> Dict[str, Any]:
    """Pure mapping: Layer0Report -> a `review_analysis` row marked done."""
    return {
        "extension_id": extension_pk,
        "status": "done",
        "model": model,
        "reviews_analyzed": reviews_analyzed,
        "legitimacy": legitimacy_from_categories(report),
        "primary_cause": report.primary_cause,
        "verdict": report.verdict,
        "summary": report.summary,
        "categories": [c.model_dump() for c in report.categories],
        "sentiment_note": report.sentiment_note,
        "error": None,
        "details": report.model_dump(),
    }


def layer0_all(
    settings: Optional[Settings] = None,
    *,
    limit: int = 25,
    min_reviews: int = 5,
    max_reviews: int = 120,
    model: Optional[str] = None,
    force: Optional[bool] = None,
) -> List[Dict[str, Any]]:
    """Run Layer 0 over the Opportunity Zone extensions; write `review_analysis`.

    ``force`` controls incremental vs. full re-run (mirrors the ranking layer):
      * None  -> read the dashboard toggle (``ranking_force_rerun``).
      * True  -> re-analyze every zone extension.
      * False -> only zone extensions with no `review_analysis` row yet.
    """
    s = settings or default_settings
    model = model or s.anthropic_model
    s.require_anthropic()
    s.require_supabase()

    from common import db  # lazy: only needed when actually run

    if force is None:
        force = db.get_ranking_force_rerun()

    candidates = db.fetch_zone_extensions(limit=limit)
    done_ids = set() if force else db.fetch_review_analyzed_extension_ids()
    todo = [e for e in candidates if force or e.get("id") not in done_ids]
    log.info(
        "layer 0: %d of %d zone extensions (%s)",
        len(todo), len(candidates),
        "full re-run" if force else "incremental — un-analyzed only",
    )

    client = get_anthropic_client()
    rows: List[Dict[str, Any]] = []
    for ext in todo:
        reviews = db.fetch_reviews_for_layer0(ext["id"], limit=max_reviews)
        if len(reviews) < min_reviews:
            log.info("layer0 skip '%s' — only %d reviews (< %d)", ext.get("name"), len(reviews), min_reviews)
            continue
        try:
            report = classify_reviews(client, ext, reviews, model=model)
        except Exception as exc:  # one bad extension shouldn't kill the run
            log.exception("layer 0 failed for '%s': %s", ext.get("name"), exc)
            db.mark_review_analysis_error(ext["id"], str(exc))
            continue
        row = to_review_analysis_row(ext["id"], report, model, reviews_analyzed=len(reviews))
        db.upsert_review_analysis(row)
        rows.append(row)
        log.info(
            "layer0 '%s' -> legitimacy %.2f (%s): %s",
            ext.get("name"), row["legitimacy"], row["primary_cause"], (row["verdict"] or "")[:70],
        )
    return rows


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="analysis.layer0", description="Layer 0 review-legitimacy pre-screen")
    p.add_argument("--limit", type=int, default=25, help="zone extensions to analyze (by installs)")
    p.add_argument("--min-reviews", type=int, default=5, help="skip extensions with fewer reviews")
    p.add_argument("--max-reviews", type=int, default=120, help="reviews sent to Claude per extension")
    p.add_argument("--model", default=None, help="Anthropic model (default: ANTHROPIC_MODEL or claude-opus-4-8)")
    p.add_argument("--force", action="store_true", help="re-analyze every zone extension (ignore the toggle)")
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
            "\n[ERROR] ANTHROPIC_API_KEY isn't set — Layer 0 calls the Claude API.\n"
            "        Add it to your .env (https://console.anthropic.com/).",
            file=sys.stderr,
        )
        return 2
    force = True if args.force else None
    rows = layer0_all(
        default_settings, limit=args.limit, min_reviews=args.min_reviews,
        max_reviews=args.max_reviews, model=args.model, force=force,
    )
    print(f"\nLayer 0 analyzed: {len(rows)} zone extensions.")
    for r in rows[:20]:
        print(f"  legit {r['legitimacy']:.2f}  [{r['primary_cause']:16}] {(r['verdict'] or '')[:60]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
