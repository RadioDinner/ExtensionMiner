"""Structured-output schema for the Claude review-mining layer.

Claude returns one ``ExtensionAnalysis`` per extension via ``messages.parse``.
Keep the field set small and gradeable — the scorer in ``analysis/rank.py``
turns this into an opportunity score.
"""
from __future__ import annotations

from typing import List, Literal

from pydantic import BaseModel, Field

ComplaintType = Literal["missing_feature", "bug", "pricing", "abandonment", "other"]
Fixable = Literal["yes", "no", "maybe"]


class ReviewCluster(BaseModel):
    """A recurring complaint shared across multiple reviews."""

    complaint: str = Field(description="The specific recurring complaint, in one sentence.")
    complaint_type: ComplaintType
    fixable: Fixable = Field(
        description="Could a small third-party / replacement extension plausibly fix this?"
    )
    independent_reviewers: int = Field(
        description="How many DISTINCT reviewers raised this complaint (count, not a guess)."
    )
    wtp_quotes: List[str] = Field(
        default_factory=list,
        description="Verbatim quotes signalling 'I'd pay / switch / use it if fixed'. Empty if none. Never invent quotes.",
    )


class ExtensionAnalysis(BaseModel):
    what_it_does: str = Field(
        description="Plain one- or two-sentence overview of what this extension is and does, "
        "for someone who's never seen it. Describe its core function — not the complaints."
    )
    clusters: List[ReviewCluster] = Field(default_factory=list)
    overall_just_bad: bool = Field(
        description="True if the product is fundamentally bad or abandoned with no salvageable demand — an anti-signal, not an opportunity."
    )
    needs_heavy_backend: bool = Field(
        description="True if the main fixes would require a costly backend / AI infrastructure to build and maintain."
    )
    build_effort: str = Field(
        description="Rough solo-build effort for a v1 fix, e.g. '20-40 hrs'."
    )
    brief: str = Field(
        description="One-paragraph opportunity brief: the gap, the demand evidence, and the angle to beat it."
    )
