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
