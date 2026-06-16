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


def insert_rating_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    """Append a point-in-time rating/install snapshot for trajectory tracking."""
    res = get_client().table("rating_snapshots").insert(row).execute()
    return res.data[0] if res.data else {}


# --- Ranking layer reads/writes --------------------------------------------

def fetch_extensions_for_analysis(limit: int = 25) -> list[dict[str, Any]]:
    """Extensions to score, most-installed first."""
    res = (
        get_client()
        .table("extensions")
        .select("id,ext_id,name,store_category,rating,rating_count,install_count")
        .order("install_count", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


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
