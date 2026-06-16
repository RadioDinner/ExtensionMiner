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
# A category landing page. `category` may be a single slug ("productivity") or a
# nested path ("productivity/tools") — verify the live taxonomy and set
# TARGET_CATEGORIES accordingly.
CATEGORY_URL = BASE_URL + "/category/extensions/{category}"
# Detail page. The slug is cosmetic; the store redirects to the canonical slug,
# so a placeholder works when crawling by id alone.
DETAIL_URL = BASE_URL + "/detail/{slug}/{ext_id}"

# --- Selectors (tune against the live DOM) ----------------------------------
# Detail page.
SEL_NAME = "h1"
SEL_DESCRIPTION = "section"          # the "Overview" section; refine if noisy
SEL_DETAIL_READY = "h1"              # element whose presence means "page loaded"

# Reviews. A review "card" container, then fields within it. The star rating is
# read from an element carrying an aria-label like "Rated 3 out of 5".
SEL_REVIEW_CARD = "[data-review-id], div[jsname]"   # candidates; tune to one
SEL_REVIEW_STARS = "[aria-label*='out of 5']"
SEL_REVIEW_AUTHOR = "[data-author], h3, h4"
SEL_REVIEW_DATE = "[data-review-date], time"
SEL_REVIEW_BODY = "[data-review-text], p"
# Control that reveals the full review list / loads more.
SEL_REVIEWS_MORE = "text=See all reviews"
