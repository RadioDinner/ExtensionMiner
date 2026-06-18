"""Supabase client factory and small write helpers.

The supabase package and real credentials are only needed at call time, not at
import time, so this module stays import-safe for tests.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

from common.config import settings


@lru_cache(maxsize=1)
def get_client():
    """Return a cached Supabase client built from the service-role key."""
    settings.require_supabase()
    from supabase import create_client  # imported lazily; tests don't need it

    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def upsert_extension(row: dict[str, Any]) -> dict[str, Any]:
    """Upsert one extension by its Chrome Web Store ext_id; return the stored row."""
    res = get_client().table("extensions").upsert(row, on_conflict="ext_id").execute()
    return res.data[0] if res.data else {}


def existing_ext_ids() -> set[str]:
    """Every ext_id already stored, so a crawl can skip what it has seen before.

    Paginates because PostgREST caps a single response (default 1000 rows).
    """
    client = get_client()
    ids: set[str] = set()
    start, page = 0, 1000
    while True:
        res = client.table("extensions").select("ext_id").range(start, start + page - 1).execute()
        rows = res.data or []
        ids.update(r["ext_id"] for r in rows)
        if len(rows) < page:
            break
        start += page
    return ids


def ext_ids_scraped_since(cutoff_iso: str) -> set[str]:
    """ext_ids whose last_scraped is at/after cutoff_iso — i.e. still "fresh".

    A refresh crawl skips these and re-scrapes everything older. Paginated like
    existing_ext_ids().
    """
    client = get_client()
    ids: set[str] = set()
    start, page = 0, 1000
    while True:
        res = (
            client.table("extensions")
            .select("ext_id")
            .gte("last_scraped", cutoff_iso)
            .range(start, start + page - 1)
            .execute()
        )
        rows = res.data or []
        ids.update(r["ext_id"] for r in rows)
        if len(rows) < page:
            break
        start += page
    return ids


def fetch_extensions_for_matching() -> list[dict[str, Any]]:
    """Every extension's id/ext_id/name/developer/website, for successor linking.

    Paginated like existing_ext_ids() (PostgREST caps a single response).
    """
    client = get_client()
    rows: list[dict[str, Any]] = []
    start, page = 0, 1000
    while True:
        res = (
            client.table("extensions")
            .select("id,ext_id,name,developer,website")
            .range(start, start + page - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page:
            break
        start += page
    return rows


def set_successor(ext_pk: int, predecessor_pk: int, points: list[str]) -> int:
    """Record that extension ext_pk is the same product as the older predecessor_pk."""
    res = (
        get_client()
        .table("extensions")
        .update({"successor_of": predecessor_pk, "successor_points": points})
        .eq("id", ext_pk)
        .execute()
    )
    return len(res.data or [])


def upsert_reviews(rows: list[dict[str, Any]]) -> int:
    """Upsert review rows, deduped on (extension_id, review_uid). Returns count."""
    if not rows:
        return 0
    res = (
        get_client()
        .table("reviews")
        .upsert(rows, on_conflict="extension_id,review_uid")
        .execute()
    )
    return len(res.data or [])


def mark_reviews_helpful(extension_id: int, review_uids: list[str]) -> int:
    """Sticky-flag the given reviews as community-helpful (set true, never false).

    A separate UPDATE (not part of the review upsert) so a later recent-only
    re-scrape can't clear a flag set on a previous Helpful-sort pass.
    """
    if not review_uids:
        return 0
    res = (
        get_client()
        .table("reviews")
        .update({"helpful_ranked": True})
        .eq("extension_id", extension_id)
        .in_("review_uid", list(review_uids))
        .execute()
    )
    return len(res.data or [])


def insert_rating_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    """Append a point-in-time rating/install snapshot for trajectory tracking."""
    res = get_client().table("rating_snapshots").insert(row).execute()
    return res.data[0] if res.data else {}


# --- App settings (small shared key/value config) ---------------------------

RANKING_FORCE_RERUN_KEY = "ranking_force_rerun"


def get_setting(key: str, default: Any = None) -> Any:
    """Read one app_settings JSON value, or `default` if absent/unreadable.

    Resilient by design: if migration 991 isn't applied yet (table missing) the
    read fails and we fall back to `default`, so the ranking layer still runs.
    """
    try:
        res = (
            get_client()
            .table("app_settings")
            .select("value")
            .eq("key", key)
            .limit(1)
            .execute()
        )
    except Exception:  # table not there yet, network, etc. — degrade to default
        return default
    rows = res.data or []
    if not rows:
        return default
    value = rows[0].get("value")
    return default if value is None else value


def set_setting(key: str, value: Any) -> dict[str, Any]:
    """Upsert one app_settings key (value is stored as JSONB)."""
    res = (
        get_client()
        .table("app_settings")
        .upsert({"key": key, "value": value}, on_conflict="key")
        .execute()
    )
    return res.data[0] if res.data else {}


def get_ranking_force_rerun() -> bool:
    """Is the dashboard's "full re-run" override turned on? (default False)."""
    return bool(get_setting(RANKING_FORCE_RERUN_KEY, False))


# --- Ranking layer reads/writes --------------------------------------------

def fetch_extensions_for_analysis(limit: int = 25) -> list[dict[str, Any]]:
    """Extensions to score, most-installed first."""
    res = (
        get_client()
        .table("extensions")
        .select("id,ext_id,name,store_category,rating,rating_count,install_count,website")
        .order("install_count", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def _fetch_extension_ids(table: str) -> set[int]:
    """All extension_ids present in `table` (paginated). Empty set if unreadable.

    Used to make the ranking/monetization passes incremental — these are the
    extensions already done, so a normal run can skip them. Resilient to a missing
    optional table (e.g. monetization before migration 995): returns an empty set
    so "nothing done yet" -> everything is treated as new.
    """
    ids: set[int] = set()
    try:
        client = get_client()
        start, page = 0, 1000
        while True:
            res = client.table(table).select("extension_id").range(start, start + page - 1).execute()
            rows = res.data or []
            ids.update(r["extension_id"] for r in rows if r.get("extension_id") is not None)
            if len(rows) < page:
                break
            start += page
    except Exception:
        return set()
    return ids


def fetch_scored_extension_ids() -> set[int]:
    """extension_ids that already have an `opportunities` row (already ranked)."""
    return _fetch_extension_ids("opportunities")


def fetch_monetized_extension_ids() -> set[int]:
    """extension_ids that already have a `monetization` row (already researched)."""
    return _fetch_extension_ids("monetization")


def fetch_reviews_for_extension(extension_id: int, limit: int = 120) -> list[dict[str, Any]]:
    """Most recent reviews for one extension (recent reviews carry the live signal)."""
    res = (
        get_client()
        .table("reviews")
        .select("stars,body,reviewed_at")
        .eq("extension_id", extension_id)
        .order("reviewed_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def upsert_opportunity(row: dict[str, Any]) -> dict[str, Any]:
    """Upsert one scored opportunity (one row per extension)."""
    res = get_client().table("opportunities").upsert(row, on_conflict="extension_id").execute()
    return res.data[0] if res.data else {}


def upsert_monetization(row: dict[str, Any]) -> dict[str, Any]:
    """Upsert one extension's monetization profile (one row per extension)."""
    res = get_client().table("monetization").upsert(row, on_conflict="extension_id").execute()
    return res.data[0] if res.data else {}


# --- Deep-dive pool (hand-picked extensions for comprehensive research) ------

def queue_deep_dive(extension_pk: int) -> dict[str, Any]:
    """Add an extension to the deep-dive pool (or re-queue a done/errored one).

    Upserts a `deep_dives` row to status='queued' without clobbering any prior
    result columns, so re-queueing keeps the last research visible until the
    next run overwrites it.
    """
    res = (
        get_client()
        .table("deep_dives")
        .upsert(
            {"extension_id": extension_pk, "status": "queued", "error": None},
            on_conflict="extension_id",
        )
        .execute()
    )
    return res.data[0] if res.data else {}


def remove_deep_dive(extension_pk: int) -> int:
    """Remove an extension from the deep-dive pool entirely."""
    res = get_client().table("deep_dives").delete().eq("extension_id", extension_pk).execute()
    return len(res.data or [])


def fetch_deep_dive_queue(limit: int = 25) -> list[dict[str, Any]]:
    """Queued pool entries (oldest request first) with their extension joined in."""
    res = (
        get_client()
        .table("deep_dives")
        .select(
            "extension_id,requested_at,"
            "extensions(id,ext_id,name,store_category,rating,rating_count,install_count,website)"
        )
        .eq("status", "queued")
        .order("requested_at", desc=False)
        .limit(limit)
        .execute()
    )
    return res.data or []


def upsert_deep_dive(row: dict[str, Any]) -> dict[str, Any]:
    """Write a completed deep-dive result (one row per extension)."""
    res = get_client().table("deep_dives").upsert(row, on_conflict="extension_id").execute()
    return res.data[0] if res.data else {}


def mark_deep_dive_error(extension_pk: int, message: str) -> int:
    """Flag a queued deep dive as failed so it doesn't silently re-run forever."""
    res = (
        get_client()
        .table("deep_dives")
        .update({"status": "error", "error": message[:2000]})
        .eq("extension_id", extension_pk)
        .execute()
    )
    return len(res.data or [])
