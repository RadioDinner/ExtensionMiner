"""Multi-point identity matching for extensions.

Why this exists
---------------
The Chrome Web Store ``ext_id`` is permanent and globally unique, so it is the
PRIMARY key: the same extension changing its name, website, rating, etc. is just
an update of the same row — it never creates a duplicate. So the common
"the name changed" case is already handled by the ext_id upsert.

This module is the SECONDARY check, for the one case ext_id can't cover: the
*same product re-published under a DIFFERENT ext_id* (a developer deletes and
re-uploads, or migrates listings). There we fall back to scoring overlap across
a few identifying "points" — name, developer, website — and treat a strong
overlap as "probably the same product".

Everything here is pure (no DB, no network) so it's easy to unit-test; callers
decide what to DO with a match (flag for review vs. link vs. merge).
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

# The identity "points" we compare (besides ext_id, which is decisive on its own).
MATCH_FIELDS = ("name", "developer", "website")
DEFAULT_THRESHOLD = 2  # how many points must agree to call it the same product


def _normalize(value: Optional[str]) -> str:
    """Lowercase + strip URL chrome + collapse to alphanumerics.

    So "Save to Pinterest" == "save to pinterest", and
    "https://www.Pinterest.com/" == "pinterest.com".
    """
    if not value:
        return ""
    s = str(value).lower().strip()
    s = re.sub(r"^https?://", "", s)
    s = re.sub(r"^www\.", "", s)
    s = re.sub(r"[/?#].*$", "", s)          # drop path/query/fragment for URLs
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def matching_points(a: Dict[str, Any], b: Dict[str, Any]) -> List[str]:
    """The identity fields (name/developer/website) that agree between a and b.

    Only fields present and non-empty on BOTH sides can match, so a missing
    website never counts as agreement.
    """
    hits: List[str] = []
    for field in MATCH_FIELDS:
        av, bv = _normalize(a.get(field)), _normalize(b.get(field))
        if av and bv and av == bv:
            hits.append(field)
    return hits


def is_same_extension(a: Dict[str, Any], b: Dict[str, Any], *, threshold: int = DEFAULT_THRESHOLD) -> bool:
    """True if a and b are the same store listing.

    Same ext_id => definitely the same (decisive). Otherwise, the same product
    under a different id when at least ``threshold`` other points agree.
    """
    if a.get("ext_id") and a.get("ext_id") == b.get("ext_id"):
        return True
    return len(matching_points(a, b)) >= threshold


def find_successor_match(
    candidate: Dict[str, Any],
    existing: List[Dict[str, Any]],
    *,
    threshold: int = DEFAULT_THRESHOLD,
) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    """Find an existing row that is probably the same product as ``candidate`` but
    carries a DIFFERENT ext_id (a re-publish/successor).

    Rows sharing the candidate's ext_id are skipped — those are the normal upsert
    path, not a successor. Returns ``(best_row, matching_fields)`` or ``(None, [])``
    when nothing clears ``threshold``. Ties break toward the most points.
    """
    best_row: Optional[Dict[str, Any]] = None
    best_hits: List[str] = []
    cand_id = candidate.get("ext_id")
    for row in existing:
        if cand_id and row.get("ext_id") == cand_id:
            continue
        hits = matching_points(candidate, row)
        if len(hits) > len(best_hits):
            best_row, best_hits = row, hits
    if len(best_hits) >= threshold:
        return best_row, best_hits
    return None, []


def _row_id(row: Dict[str, Any]) -> Optional[int]:
    try:
        return int(row.get("id"))
    except (TypeError, ValueError):
        return None


def link_successors(
    rows: List[Dict[str, Any]], *, threshold: int = DEFAULT_THRESHOLD
) -> List[Tuple[int, int, List[str]]]:
    """Find same-product pairs across DIFFERENT ext_ids in a set of extension rows.

    Each row needs ``id`` (the DB primary key), ``ext_id`` and the match fields.
    Returns ``[(successor_id, predecessor_id, matched_fields), ...]`` where the
    newer listing (higher ``id``) is the successor of the older (lower ``id``).
    Each successor links to at most one predecessor — its strongest match.

    Efficient via blocking: rows are grouped by each normalized field, and only
    rows that already share a field are compared. Any genuine >=2-point pair
    shares at least one field, so nothing is missed, but we avoid the full O(n^2).
    """
    blocks: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        for field in MATCH_FIELDS:
            v = _normalize(r.get(field))
            if v:
                blocks[(field, v)].append(r)

    # Score each candidate pair once (a pair can co-occur in several blocks).
    scored: Dict[Tuple[str, str], Tuple[Dict[str, Any], Dict[str, Any], List[str]]] = {}
    for group in blocks.values():
        if len(group) < 2:
            continue
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                ai, bi = a.get("ext_id"), b.get("ext_id")
                if ai and ai == bi:
                    continue
                key = tuple(sorted((str(ai), str(bi))))
                if key in scored:
                    continue
                hits = matching_points(a, b)
                if len(hits) >= threshold:
                    scored[key] = (a, b, hits)

    # Direction: older (lower id) = predecessor, newer (higher id) = successor.
    links: Dict[int, Tuple[int, List[str]]] = {}
    for a, b, hits in scored.values():
        ida, idb = _row_id(a), _row_id(b)
        if ida is None or idb is None or ida == idb:
            continue
        pred_id, succ_id = (ida, idb) if ida < idb else (idb, ida)
        current = links.get(succ_id)
        if current is None or len(hits) > len(current[1]):
            links[succ_id] = (pred_id, hits)

    return [(succ_id, pred_id, hits) for succ_id, (pred_id, hits) in links.items()]
