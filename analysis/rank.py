"""Claude-powered opportunity ranking (roadmap Phase 3 — the valuable part).

Pipeline: read extensions + reviews from Supabase -> ask Claude to mine the
reviews (structured output) -> score deterministically -> write `opportunities`.

The scoring (`score_opportunity`) is a pure function and fully unit tested. The
single network call (`analyze_extension`) is isolated so it can be mocked.
"""
from __future__ import annotations

import datetime as _dt
import logging
import math
from typing import Any, Dict, List, Optional

from common.config import Settings
from common.config import settings as default_settings

from . import prompt
from .schema import ExtensionAnalysis

log = logging.getLogger("analysis")

# --- Scoring rubric (tunable). See docs/ROADMAP.md Phase 3. ------------------
W_DEMAND = 45.0          # # independent reviewers w/ the same fixable complaint (heaviest)
W_WTP = 20.0             # explicit "I'd pay / switch" signal present
W_FIXABLE = 15.0         # fixable by a small solo build
W_MARKET = 20.0          # incumbent install count (addressable demand)
ZONE_BONUS = 10.0        # sits in the ~3-star opportunity zone
PENALTY_JUST_BAD = 60.0  # "the whole thing is just bad" / abandoned
PENALTY_BACKEND = 15.0   # fix needs costly backend/AI to maintain

DEMAND_SATURATION = 10   # this many independent reviewers maxes the demand term
INSTALL_CAP = 10_000_000
ZONE_MIN, ZONE_MAX = 2.5, 3.5

# --- Review recency weighting (feature: decay old reviews) -------------------
# Old reviews likely describe old releases, so they count for less when scoring.
# Each bucket is (max_age_days, weight); the first bucket a review falls into
# wins. Anything older than the last bucket gets RECENCY_FLOOR. Tunable.
RECENCY_BUCKETS = [
    (91,   1.00),   # <= ~3 months — freshest, full weight
    (182,  0.85),   # <= ~6 months — slightly lower
    (365,  0.70),   # <= 12 months — a bit lower than 6 months
    (730,  0.50),   # <= 2 years  — lower
    (1095, 0.30),   # <= 3 years  — much lower
]
RECENCY_FLOOR = 0.15  # older than 3 years
# Reviews at/below this star count are treated as "complaints" — the demand
# signal — so recency is judged from how fresh the complaints are.
COMPLAINT_STARS_MAX = 3


def _to_date(value: Any) -> Optional[_dt.date]:
    """Best-effort parse of a review timestamp (ISO str / date / datetime) -> date."""
    if value is None:
        return None
    if isinstance(value, _dt.datetime):
        return value.date()
    if isinstance(value, _dt.date):
        return value
    try:
        return _dt.date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def recency_weight(reviewed_at: Any, *, now: Any = None) -> float:
    """Age-decay weight in [RECENCY_FLOOR, 1.0] for a single review.

    Unknown/future dates return 1.0 (no penalty) — we only ever discount, never
    reward, a review for its age.
    """
    d = _to_date(reviewed_at)
    if d is None:
        return 1.0
    today = _to_date(now) or _dt.date.today()
    age_days = (today - d).days
    if age_days <= 0:
        return 1.0
    for max_age, weight in RECENCY_BUCKETS:
        if age_days <= max_age:
            return weight
    return RECENCY_FLOOR


def recency_factor(
    reviews: List[Dict[str, Any]], *, now: Any = None, complaint_stars_max: int = COMPLAINT_STARS_MAX
) -> float:
    """How fresh is the complaint evidence? (multiplier in [RECENCY_FLOOR, 1.0])

    Averages the per-review decay weight over the extension's *complaint* reviews
    (<= complaint_stars_max stars — the ones that drive the demand signal),
    falling back to all dated reviews. Returns 1.0 when there's nothing dated to
    judge, so an extension with no usable dates is never penalised.
    """
    def _weights(rows: List[Dict[str, Any]]) -> List[float]:
        return [
            recency_weight(r.get("reviewed_at"), now=now)
            for r in rows
            if _to_date(r.get("reviewed_at")) is not None
        ]

    complaints = [
        r for r in reviews
        if r.get("stars") is not None and r.get("stars") <= complaint_stars_max
    ]
    ws = _weights(complaints) or _weights(reviews)
    if not ws:
        return 1.0
    return round(sum(ws) / len(ws), 3)


def _best_cluster(analysis: ExtensionAnalysis):
    """The most promising fixable cluster: WTP signal, then reviewer count, then fixable=yes."""
    fixable = [c for c in analysis.clusters if c.fixable in ("yes", "maybe")]
    if not fixable:
        return None
    return max(
        fixable,
        key=lambda c: (bool(c.wtp_quotes), c.independent_reviewers, c.fixable == "yes"),
    )


def _norm_log(value: Optional[int], cap: int) -> float:
    if not value or value <= 0:
        return 0.0
    return min(1.0, math.log10(value) / math.log10(cap))


def score_opportunity(
    ext: Dict[str, Any], analysis: ExtensionAnalysis, *, recency: float = 1.0
) -> Dict[str, Any]:
    """Score an extension and return the fields for the `opportunities` row.

    ``recency`` (in [0, 1], default 1.0 = no discount) down-weights the demand
    term when the driving complaints are old — see ``recency_factor``. It scales
    demand only; market reach, the rating zone and WTP presence are not aged.
    """
    best = _best_cluster(analysis)
    demand = best.independent_reviewers if best else 0
    has_wtp = bool(best and best.wtp_quotes)
    fixability = {"yes": 1.0, "maybe": 0.5}.get(best.fixable, 0.0) if best else 0.0

    rating = ext.get("rating")
    in_zone = rating is not None and ZONE_MIN <= float(rating) <= ZONE_MAX

    raw = (
        W_DEMAND * min(1.0, demand / DEMAND_SATURATION) * recency
        + (W_WTP if has_wtp else 0.0)
        + W_FIXABLE * fixability
        + W_MARKET * _norm_log(ext.get("install_count"), INSTALL_CAP)
        + (ZONE_BONUS if in_zone else 0.0)
        - (PENALTY_JUST_BAD if analysis.overall_just_bad else 0.0)
        - (PENALTY_BACKEND if analysis.needs_heavy_backend else 0.0)
    )

    return {
        "score": round(max(0.0, raw), 1),
        "top_complaint": best.complaint if best else None,
        "complaint_type": best.complaint_type if best else None,
        "fixable": best.fixable if best else None,
        "demand_intensity": demand,
        "recency_weight": round(recency, 3),
        "wtp_evidence": list(best.wtp_quotes) if best else [],
        "build_effort": analysis.build_effort,
        "brief": analysis.brief,
    }


def to_opportunity_row(
    extension_pk: int,
    ext: Dict[str, Any],
    analysis: ExtensionAnalysis,
    model: str,
    *,
    recency: float = 1.0,
) -> Dict[str, Any]:
    scored = score_opportunity(ext, analysis, recency=recency)
    return {
        "extension_id": extension_pk,
        **scored,
        "model": model,
        "details": analysis.model_dump(),
    }


def get_anthropic_client():
    default_settings.require_anthropic()
    import anthropic  # lazy: tests pass a fake client and never import this

    return anthropic.Anthropic(api_key=default_settings.anthropic_api_key)


def analyze_extension(client, ext: Dict[str, Any], reviews: List[Dict[str, Any]], *, model: str) -> ExtensionAnalysis:
    """One structured Claude call -> ExtensionAnalysis. `client` is injected for testing."""
    message = client.messages.parse(
        model=model,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        system=prompt.SYSTEM,
        messages=[{"role": "user", "content": prompt.build_user_prompt(ext, reviews)}],
        output_format=ExtensionAnalysis,
    )
    return message.parsed_output


def rank_all(
    settings: Optional[Settings] = None,
    *,
    limit: int = 25,
    min_reviews: int = 5,
    max_reviews: int = 120,
    write_db: bool = True,
    model: Optional[str] = None,
) -> List[Dict[str, Any]]:
    s = settings or default_settings
    model = model or s.anthropic_model
    s.require_anthropic()
    if write_db:
        s.require_supabase()

    from common import db  # lazy: only needed when actually run

    client = get_anthropic_client()
    rows: List[Dict[str, Any]] = []
    for ext in db.fetch_extensions_for_analysis(limit=limit):
        reviews = db.fetch_reviews_for_extension(ext["id"], limit=max_reviews)
        if len(reviews) < min_reviews:
            log.info("skip '%s' — only %d reviews (< %d)", ext.get("name"), len(reviews), min_reviews)
            continue
        try:
            analysis = analyze_extension(client, ext, reviews, model=model)
        except Exception as exc:  # one bad extension shouldn't kill the run
            log.exception("analysis failed for '%s': %s", ext.get("name"), exc)
            continue
        recency = recency_factor(reviews)
        row = to_opportunity_row(ext["id"], ext, analysis, model, recency=recency)
        if write_db:
            db.upsert_opportunity(row)
        rows.append(row)
        log.info(
            "scored '%s' -> %.1f  (%s; recency x%.2f)",
            ext.get("name"), row["score"], row["top_complaint"], recency,
        )
    return rows
