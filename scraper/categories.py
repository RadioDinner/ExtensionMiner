"""The Chrome Web Store extension taxonomy.

Category listing pages live at ``/category/extensions/<group>/<sub>``. Keeping
the whole taxonomy here lets discovery crawl EVERY category (not just the handful
the homepage nav happens to surface) and lets us tag each extension with a clean,
store-matching category name ("Productivity / Tools") instead of a raw slug.

Slugs CONFIRMED against the live store: ``productivity/tools``,
``lifestyle/shopping``, ``lifestyle/entertainment``, ``lifestyle/art``,
``make_chrome_yours/accessibility``. The others are best-effort — if a category
page reports ``0 extensions`` in the run log, its slug below is wrong; fix it
here (one edit, every parser/discovery path reads from this file).
"""
from __future__ import annotations

from typing import List, Optional

# Top-level group slug -> display name.
GROUPS = {
    "productivity": "Productivity",
    "lifestyle": "Lifestyle",
    "make_chrome_yours": "Make Chrome Yours",
}

# Group slug -> [(sub slug, sub display name)]. "# ?" = slug not yet confirmed
# against the live store (verify the URL; the display name is from the store UI).
SUBCATEGORIES = {
    "productivity": [
        ("communication", "Communication"),            # ?
        ("developer-tools", "Developer Tools"),         # ?
        ("education", "Education"),                      # ?
        ("tools", "Tools"),                             # confirmed
        ("workflow-planning", "Workflow & Planning"),   # ?
    ],
    "lifestyle": [
        ("art", "Art & Design"),                        # confirmed
        ("entertainment", "Entertainment"),             # confirmed
        ("games", "Games"),                             # ?
        ("household", "Household"),                      # ?
        ("fun", "Just for Fun"),                        # ?
        ("news", "News & Weather"),                     # ?
        ("shopping", "Shopping"),                        # confirmed
        ("social", "Social Networking"),                # ?
        ("travel", "Travel"),                           # ?
        ("well_being", "Well-being"),                   # ?
    ],
    "make_chrome_yours": [
        ("accessibility", "Accessibility"),             # confirmed
        ("functionality", "Functionality & UI"),        # ?
        ("privacy", "Privacy & Security"),              # ?
    ],
}


def all_category_slugs() -> List[str]:
    """Every ``group/sub`` path in the taxonomy — the full discovery seed list."""
    return [f"{g}/{sub}" for g, subs in SUBCATEGORIES.items() for sub, _ in subs]


# slug path -> "Group / Sub" display name, built once.
_DISPLAY = {
    f"{g}/{sub}": f"{GROUPS[g]} / {disp}"
    for g, subs in SUBCATEGORIES.items()
    for sub, disp in subs
}


def display_for(slug: Optional[str]) -> Optional[str]:
    """Clean "Group / Sub" name for a category slug path.

    Falls back to a tidied version of an unknown slug (e.g. a brand-new store
    category) so nothing is ever lost; returns None for an empty slug.
    """
    if not slug:
        return None
    s = slug.strip().strip("/")
    if not s:
        return None
    if s in _DISPLAY:
        return _DISPLAY[s]
    if s in GROUPS:           # a group-only slug like "productivity"
        return GROUPS[s]
    parts = [
        GROUPS.get(p, p.replace("_", " ").replace("-", " ").title())
        for p in s.split("/")
    ]
    return " / ".join(parts)


def category_from_detail(slugs: List[str]) -> Optional[str]:
    """Best-effort category for an extension from the category links on its detail
    page (used only for extensions found via related links, not a category page).

    Safe by design: returns a category only when EXACTLY ONE known taxonomy path
    appears — so a footer/header nav listing several categories yields None rather
    than a wrong guess. Returns the clean "Group / Sub" display name.
    """
    known: List[str] = []
    seen = set()
    for slug in slugs or []:
        s = (slug or "").strip().strip("/")
        if s in _DISPLAY and s not in seen:
            seen.add(s)
            known.append(s)
    return _DISPLAY[known[0]] if len(known) == 1 else None
