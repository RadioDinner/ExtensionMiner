"""Centralized Chrome Web Store URLs and CSS selectors.

The Chrome Web Store's markup uses obfuscated, churn-prone class names, and this
project is developed in an environment that cannot reach the live store (HTTP
403), so selectors here are a *best-effort starting point*. Keeping them in ONE
place means adjusting to the live DOM is a quick, single-file edit.

How to tune on first local run:
  1. `python -m scraper.run --max-extensions 2 --no-db --keep-cache`
  2. Open the cached HTML under your cache dir and find the real selectors.
  3. Update the values below; the parsers in scraper/parse.py read from here.

Many numeric/labeled fields (install count, rating, version, "Updated" date) are
parsed from the page's *visible text* via regexes in scraper/parse.py, which is
far more robust to DOM churn than class names — so those need no selector at all.
"""
from __future__ import annotations

# --- URLs -------------------------------------------------------------------
BASE_URL = "https://chromewebstore.google.com"
ROBOTS_URL = f"{BASE_URL}/robots.txt"
# The store homepage carries the full category nav. We read category slugs from
# its links (parse.extract_category_slugs) rather than hardcoding the taxonomy,
# so --all-categories follows the store's own menu and survives reorganizations.
HOME_URL = BASE_URL + "/"
# A category landing page. `category` may be a single slug ("productivity") or a
# nested path ("productivity/tools") — verify the live taxonomy and set
# TARGET_CATEGORIES accordingly.
CATEGORY_URL = BASE_URL + "/category/extensions/{category}"
# Detail page. The slug is cosmetic; the store redirects to the canonical slug,
# so a placeholder works when crawling by id alone.
DETAIL_URL = BASE_URL + "/detail/{slug}/{ext_id}"
# Reviews live on a dedicated sub-page; the detail page itself shows none. Scroll
# this page to lazy-load more reviews.
REVIEWS_URL = DETAIL_URL + "/reviews"

# --- Selectors (tune against the live DOM) ----------------------------------
# Detail page.
SEL_NAME = "h1"
# Fallback only: the description is normally parsed from the page's visible text
# (parse.extract_description, anchored on the "Overview" heading), which is far
# more robust than this CSS selector. Used only when that text anchor is absent.
SEL_DESCRIPTION = "section"
SEL_DETAIL_READY = "h1"              # element whose presence means "page loaded"

# Reviews page (REVIEWS_URL). Each review is one card; the per-review star rating
# carries an aria-label like "1 out of 5 stars". A developer's reply is nested in
# the SAME card with a different body class (`div.fPNqW`), so selecting the review
# body via `div.fzDEpf` naturally excludes the reply.
#
# These classes are obfuscated and churn-prone — if review fields go missing,
# re-tune them here (open a cached reviews_page HTML and find the new classes).
# parse.parse_reviews falls back to a generic heuristic when SEL_REVIEW_CARD
# matches nothing, so a class rename degrades rather than crashes.
SEL_REVIEW_CARD = "section.T7rvce"
SEL_REVIEW_STARS = "[aria-label*='out of 5']"
SEL_REVIEW_AUTHOR = "span.LfYwpe"
SEL_REVIEW_DATE = "span.ydlbEf"
# Review body is a <p class="fzDEpf"> (the developer reply uses a different
# class, .Iu8e1b, so this selects only the reviewer's own text). Tag-agnostic on
# purpose — match by class so a tag change doesn't break it.
SEL_REVIEW_BODY = ".fzDEpf"
# Control that reveals the full review list / loads more.
SEL_REVIEWS_MORE = "text=See all reviews"
