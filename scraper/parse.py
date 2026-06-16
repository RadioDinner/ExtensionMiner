"""Parsing for Chrome Web Store pages.

Two kinds of parsing live here:

* **Deterministic text parsers** (install count, rating, rating count, star
  labels, dates, extension-id extraction). These do not depend on the store's
  class names — they read numbers/labels from visible text or stable URL shapes,
  so they are robust and fully unit tested.

* **DOM parsers** (`parse_detail`, `parse_reviews`). These read structure from
  the rendered HTML using the selectors in ``scraper/selectors.py`` and are a
  best-effort starting point that may need a quick selector tweak against the
  live DOM (this project can't reach the store to verify).
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import List, Optional

from bs4 import BeautifulSoup

from . import selectors
from .models import Extension, Review

# --- Number helpers ---------------------------------------------------------

_SUFFIX_MULT = {"": 1, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}


def _num_with_suffix(num: str, suffix: str) -> Optional[int]:
    try:
        value = float(num.replace(",", ""))
    except ValueError:
        return None
    mult = _SUFFIX_MULT.get(suffix.upper())
    if mult is None:
        return None
    return int(value * mult)


_INSTALL_RE = re.compile(r"([\d.,]+)\s*([KkMmBb]?)\s*\+?\s*users", re.I)


def parse_install_count(text: Optional[str]) -> Optional[int]:
    """'10,000+ users' -> 10000 ; '1.2M users' -> 1200000."""
    if not text:
        return None
    m = _INSTALL_RE.search(text)
    return _num_with_suffix(m.group(1), m.group(2)) if m else None


_RATING_OUT_OF_5 = re.compile(r"(\d(?:\.\d+)?)\s*out of\s*5", re.I)
_BARE_RATING = re.compile(r"^\s*(\d(?:\.\d+)?)\s*$")


def parse_rating(text: Optional[str]) -> Optional[float]:
    """'Rated 4.2 out of 5' or '4.2' -> 4.2 (clamped to 0–5)."""
    if not text:
        return None
    m = _RATING_OUT_OF_5.search(text) or _BARE_RATING.match(text)
    if not m:
        return None
    value = float(m.group(1))
    return round(value, 1) if 0 <= value <= 5 else None


_COUNT_RE = re.compile(r"([\d.,]+)\s*([KkMmBb]?)\s*(?:ratings|reviews)", re.I)


def parse_rating_count(text: Optional[str]) -> Optional[int]:
    """'1.2K ratings' -> 1200 ; '3,456 ratings' -> 3456."""
    if not text:
        return None
    m = _COUNT_RE.search(text)
    return _num_with_suffix(m.group(1), m.group(2)) if m else None


def parse_star_label(text: Optional[str]) -> Optional[int]:
    """Star rating from a label, rounded to an int 1–5. 'Rated 3 out of 5' -> 3."""
    if not text:
        return None
    m = _RATING_OUT_OF_5.search(text)
    if m:
        stars = int(round(float(m.group(1))))
    else:
        m2 = re.search(r"(\d)\s*stars?", text, re.I)
        if not m2:
            return None
        stars = int(m2.group(1))
    return stars if 1 <= stars <= 5 else None


_VERSION_RE = re.compile(r"Version\s*:?\s*([0-9][0-9A-Za-z.\-_]*)", re.I)


def parse_version(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    m = _VERSION_RE.search(text)
    return m.group(1) if m else None


# --- Date helpers -----------------------------------------------------------

_REL_RE = re.compile(r"(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago", re.I)
_REL_DAYS = {
    "second": 0,
    "minute": 0,
    "hour": 0,
    "day": 1,
    "week": 7,
    "month": 30,
    "year": 365,
}


def _parse_relative(text: str, *, today: Optional[date] = None) -> Optional[date]:
    m = _REL_RE.search(text)
    if not m:
        return None
    today = today or date.today()
    return today - timedelta(days=int(m.group(1)) * _REL_DAYS[m.group(2).lower()])


def parse_date(text: Optional[str], *, today: Optional[date] = None) -> Optional[date]:
    """Parse 'Updated Sep 5, 2024', 'September 5, 2024', or '2 weeks ago'."""
    if not text:
        return None
    cleaned = re.sub(r"(?i)^\s*(updated|added)\s*", "", text.strip())
    rel = _parse_relative(cleaned, today=today)
    if rel:
        return rel
    try:
        from dateutil import parser as dtparser  # lazy; optional at import time

        return dtparser.parse(cleaned, fuzzy=True).date()
    except Exception:
        return None


# --- Extension-id extraction ------------------------------------------------

# Chrome Web Store extension ids are 32 chars, each in a–p.
_ID_WITH_SLUG = re.compile(r"/detail/[^\s\"'/]+/([a-p]{32})")
_ID_BARE = re.compile(r"/detail/([a-p]{32})")


def extract_extension_ids(html: Optional[str]) -> List[str]:
    """All distinct extension ids referenced by /detail/ links, in page order."""
    out: List[str] = []
    seen = set()
    for pattern in (_ID_WITH_SLUG, _ID_BARE):
        for m in pattern.finditer(html or ""):
            ext_id = m.group(1)
            if ext_id not in seen:
                seen.add(ext_id)
                out.append(ext_id)
    return out


def detail_url(ext_id: str, slug: str = "x") -> str:
    return selectors.DETAIL_URL.format(slug=slug, ext_id=ext_id)


def category_url(category: str) -> str:
    return selectors.CATEGORY_URL.format(category=category.strip("/"))


# --- DOM parsers (best-effort; tune selectors against the live store) -------


def _text(node) -> Optional[str]:
    if node is None:
        return None
    value = node.get_text(" ", strip=True)
    return value or None


def parse_detail(html: str, ext_id: str, *, page_text: Optional[str] = None) -> Extension:
    """Build an Extension from a rendered detail page.

    Numeric/labeled fields are pulled from ``page_text`` (visible text) when
    available — more robust than class names. ``html`` is used for the name,
    description, and links.
    """
    soup = BeautifulSoup(html or "", "lxml")
    text = page_text if page_text is not None else soup.get_text(" ", strip=True)

    name = _text(soup.select_one(selectors.SEL_NAME)) or ext_id

    # Links: classify anchors by surrounding label text.
    website = support_url = privacy_url = None
    for a in soup.find_all("a", href=True):
        label = (a.get_text(" ", strip=True) or "").lower()
        href = a["href"]
        if not href.startswith("http"):
            continue
        if website is None and "website" in label:
            website = href
        elif support_url is None and "support" in label:
            support_url = href
        elif privacy_url is None and ("privacy" in label or "privacy" in href):
            privacy_url = href

    icon = soup.find("img")
    icon_url = icon.get("src") if icon and icon.get("src", "").startswith("http") else None

    return Extension(
        ext_id=ext_id,
        name=name,
        developer=_developer_from_text(text),
        summary=None,
        description=_text(soup.select_one(selectors.SEL_DESCRIPTION)),
        install_count=parse_install_count(text),
        install_count_raw=_first_match(_INSTALL_RE, text),
        rating=parse_rating(text),
        rating_count=parse_rating_count(text),
        version=parse_version(text),
        last_updated=parse_date(_updated_phrase(text)),
        website=website,
        support_url=support_url,
        privacy_url=privacy_url,
        listing_url=detail_url(ext_id),
        icon_url=icon_url,
        price=None,
        permissions=[],
        raw=None,
    )


def _first_match(pattern: re.Pattern, text: str) -> Optional[str]:
    m = pattern.search(text or "")
    return m.group(0) if m else None


_DEVELOPER_RE = re.compile(r"offered by\s+([^\n]+)", re.I)


def _developer_from_text(text: str) -> Optional[str]:
    m = _DEVELOPER_RE.search(text or "")
    if not m:
        return None
    # Some layouts pack several fields on one line; cut at a run of 2+ spaces.
    value = re.split(r"\s{2,}", m.group(1).strip())[0].strip()
    return value or None


_UPDATED_RE = re.compile(r"Updated[:\s]+([A-Za-z0-9,\s]+?\d{4}|\d+\s+\w+\s+ago)", re.I)


def _updated_phrase(text: str) -> Optional[str]:
    m = _UPDATED_RE.search(text or "")
    return m.group(0) if m else None


def parse_reviews(html: str) -> List[Review]:
    """Extract reviews from rendered HTML.

    Heuristic: any element carrying a star aria-label ('… out of 5') is treated
    as a review's rating; its enclosing card supplies author/date/body. Selectors
    live in scraper/selectors.py — tune them on first local run.
    """
    soup = BeautifulSoup(html or "", "lxml")
    reviews: List[Review] = []
    seen_bodies = set()

    for star_node in soup.select(selectors.SEL_REVIEW_STARS):
        stars = parse_star_label(star_node.get("aria-label") or star_node.get_text(" ", strip=True))
        if stars is None:
            continue
        card = _nearest_card(star_node)
        author = _text(card.select_one(selectors.SEL_REVIEW_AUTHOR)) if card else None
        date_text = _text(card.select_one(selectors.SEL_REVIEW_DATE)) if card else None
        body = _text(card.select_one(selectors.SEL_REVIEW_BODY)) if card else None

        # Avoid emitting the same review twice when selectors overlap.
        dedupe_key = (author, body)
        if body and dedupe_key in seen_bodies:
            continue
        seen_bodies.add(dedupe_key)

        reviews.append(
            Review(
                review_uid=(card.get("data-review-id") if card else None),
                author=author,
                stars=stars,
                body=body,
                reviewed_at=parse_date(date_text),
                language=None,
                helpful_count=None,
                raw=None,
            )
        )
    return reviews


def _nearest_card(node):
    """Walk up to the nearest plausible review-card ancestor (or the parent)."""
    for parent in node.parents:
        if parent.name in ("article", "li"):
            return parent
        if parent.has_attr("data-review-id") or parent.has_attr("jsname"):
            return parent
    return node.parent
