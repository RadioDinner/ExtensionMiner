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


def reviews_url(ext_id: str, slug: str = "x") -> str:
    return selectors.REVIEWS_URL.format(slug=slug, ext_id=ext_id)


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

    # Prefer the visible-text "Overview" body (robust to DOM churn); fall back to
    # the CSS-selected section only if the text anchor isn't found.
    description = extract_description(text) or _text(soup.select_one(selectors.SEL_DESCRIPTION))

    return Extension(
        ext_id=ext_id,
        name=name,
        developer=extract_developer(text, name),
        summary=extract_summary(description),
        description=description,
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


_OFFERED_BY_RE = re.compile(r"offered by\s+([^\n]+)", re.I)
# The Details panel lists "Developer" on its own line, value on the next line.
_DEV_LABEL_RE = re.compile(r"(?im)^[ \t]*Developer[ \t]*\n+[ \t]*([^\n]+)")
# When a publisher gives no company name, the Details "Developer" block leads
# with one of these field labels instead — reject them and use the title line.
_DEV_LABEL_STOP = {"website", "email", "phone", "address", "support"}


def _publisher_after_name(text: str, name: Optional[str]) -> Optional[str]:
    """The publisher line shown directly under the extension title."""
    if not name:
        return None
    lines = [ln.strip() for ln in (text or "").splitlines()]
    for i, line in enumerate(lines):
        if line != name:
            continue
        for nxt in lines[i + 1 : i + 4]:
            if not nxt:
                continue
            low = nxt.lower()
            if low == "featured" or nxt.startswith("(") or nxt[0].isdigit() or "out of 5" in low:
                continue
            return nxt
        break
    return None


def extract_developer(text: str, name: Optional[str] = None) -> Optional[str]:
    """Best-effort developer/publisher from the detail page's visible text.

    Tries, in order: a legacy "offered by X" line; the Details "Developer"
    label; the publisher line shown under the title (used when the Details block
    leads with a Website/Email field instead of a company name).
    """
    if not text:
        return None
    m = _OFFERED_BY_RE.search(text)
    if m:
        return re.split(r"\s{2,}", m.group(1).strip())[0].strip() or None
    m = _DEV_LABEL_RE.search(text)
    if m:
        value = m.group(1).strip()
        if value and value.lower() not in _DEV_LABEL_STOP:
            return value
    return _publisher_after_name(text, name)


# The Overview body sits between the "Overview" heading and the trailing chrome
# ("See more" toggle, the ratings summary, or the "Details" panel).
_DESCRIPTION_RE = re.compile(
    r"\bOverview\b\s*(.*?)\s*(?:\bSee more\b|\bSee all reviews\b|\bDetails\b|\d(?:\.\d)?\s*out of\s*5)",
    re.S | re.I,
)


def extract_description(text: str) -> Optional[str]:
    """The extension's Overview/description from the page's visible text."""
    if not text:
        return None
    m = _DESCRIPTION_RE.search(text)
    if not m:
        return None
    body = re.sub(r"[ \t]+", " ", m.group(1)).strip()
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body or None


def extract_summary(description: Optional[str]) -> Optional[str]:
    """A short summary: the first sentence/line of the description."""
    if not description:
        return None
    first = re.split(r"(?<=[.!?])\s|\n", description.strip(), maxsplit=1)[0].strip()
    return first[:300] or None


_UPDATED_RE = re.compile(r"Updated[:\s]+([A-Za-z0-9,\s]+?\d{4}|\d+\s+\w+\s+ago)", re.I)


def _updated_phrase(text: str) -> Optional[str]:
    m = _UPDATED_RE.search(text or "")
    return m.group(0) if m else None


def parse_reviews(html: str) -> List[Review]:
    """Extract reviews from a rendered reviews-page.

    Primary path: iterate the review cards (``selectors.SEL_REVIEW_CARD``) and
    read author/date/stars/body from each. A developer reply nested in the same
    card is excluded because the review body selector targets only the review's
    own body element.

    Fallback: if no cards match (e.g. the store's classes changed), drop to a
    generic star-aria-label heuristic so a class rename degrades instead of
    returning nothing.
    """
    soup = BeautifulSoup(html or "", "lxml")
    cards = soup.select(selectors.SEL_REVIEW_CARD)
    if cards:
        return _reviews_from_cards(cards)
    return _reviews_generic(soup)


def _reviews_from_cards(cards) -> List[Review]:
    reviews: List[Review] = []
    seen = set()
    for card in cards:
        star = card.select_one(selectors.SEL_REVIEW_STARS)
        stars = parse_star_label(star.get("aria-label") if star else None)
        if stars is None:
            continue
        author = _text(card.select_one(selectors.SEL_REVIEW_AUTHOR))
        body = _text(card.select_one(selectors.SEL_REVIEW_BODY))
        date_text = _text(card.select_one(selectors.SEL_REVIEW_DATE))

        dedupe_key = (author, body)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        reviews.append(
            Review(
                review_uid=card.get("data-review-id"),
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


# Generic fallback selectors (used only when SEL_REVIEW_CARD matches nothing).
_GENERIC_AUTHOR = "[data-author], h3, h4"
_GENERIC_DATE = "[data-review-date], time"
_GENERIC_BODY = "[data-review-text], p"


def _reviews_generic(soup) -> List[Review]:
    reviews: List[Review] = []
    seen_bodies = set()
    for star_node in soup.select(selectors.SEL_REVIEW_STARS):
        stars = parse_star_label(star_node.get("aria-label") or star_node.get_text(" ", strip=True))
        if stars is None:
            continue
        card = _nearest_card(star_node)
        author = _text(card.select_one(_GENERIC_AUTHOR)) if card else None
        date_text = _text(card.select_one(_GENERIC_DATE)) if card else None
        body = _text(card.select_one(_GENERIC_BODY)) if card else None

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
