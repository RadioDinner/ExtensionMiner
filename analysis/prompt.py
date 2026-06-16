"""Prompt construction for the review-mining layer."""
from __future__ import annotations

from typing import Any, Dict, List

SYSTEM = (
    "You are a product analyst mining public Chrome Web Store reviews to find "
    "'fix-and-flip' opportunities: extensions with real demand but unhappy users, "
    "where a small competitor could fix the problem and win.\n\n"
    "Be skeptical. 'It's just bad' and 'abandoned, nobody cares' are NOT "
    "opportunities — set overall_just_bad=true for those. The signal you want is "
    "'love the idea, hate the execution': a recurring, plausibly-fixable complaint "
    "PLUS people who say they'd pay, switch, or keep using it if it were fixed.\n\n"
    "Group complaints into clusters, count how many INDEPENDENT reviewers raise each, "
    "and quote willingness-to-pay/switch signals VERBATIM — never invent or paraphrase "
    "a quote. If there are no such quotes, return an empty list."
)


def build_user_prompt(ext: Dict[str, Any], reviews: List[Dict[str, Any]]) -> str:
    lines = [
        f"Extension: {ext.get('name')}",
        f"Category: {ext.get('store_category') or 'unknown'}",
        f"Overall rating: {ext.get('rating')}    Ratings: {ext.get('rating_count')}    Installs: {ext.get('install_count')}",
        "",
        "Reviews (stars | date | text):",
    ]
    for r in reviews:
        body = " ".join((r.get("body") or "").split())
        lines.append(f"- {r.get('stars')}★ | {r.get('reviewed_at') or '?'} | {body}")
    lines += [
        "",
        "Identify the recurring FIXABLE complaints, how many independent reviewers raise "
        "each, and any verbatim willingness-to-pay / switch signals. Then judge whether "
        "this is a real opportunity or just a bad/abandoned product.",
    ]
    return "\n".join(lines)
