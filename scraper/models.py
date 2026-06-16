"""Dataclasses mirroring the `extensions` and `reviews` tables.

``to_row()`` produces a dict ready for a Supabase upsert (JSON-serializable:
dates -> ISO strings, timestamps -> ISO strings).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional


def _iso_date(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _iso_dt(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Extension:
    ext_id: str
    name: str
    developer: Optional[str] = None
    store_category: Optional[str] = None
    summary: Optional[str] = None
    description: Optional[str] = None
    install_count: Optional[int] = None
    install_count_raw: Optional[str] = None
    rating: Optional[float] = None
    rating_count: Optional[int] = None
    version: Optional[str] = None
    last_updated: Optional[date] = None
    website: Optional[str] = None
    support_url: Optional[str] = None
    privacy_url: Optional[str] = None
    listing_url: Optional[str] = None
    icon_url: Optional[str] = None
    price: Optional[str] = None
    permissions: List[str] = field(default_factory=list)
    raw: Optional[Dict[str, Any]] = None

    def to_row(self) -> Dict[str, Any]:
        return {
            "ext_id": self.ext_id,
            "name": self.name,
            "developer": self.developer,
            "store_category": self.store_category,
            "summary": self.summary,
            "description": self.description,
            "install_count": self.install_count,
            "install_count_raw": self.install_count_raw,
            "rating": self.rating,
            "rating_count": self.rating_count,
            "version": self.version,
            "last_updated": _iso_date(self.last_updated),
            "website": self.website,
            "support_url": self.support_url,
            "privacy_url": self.privacy_url,
            "listing_url": self.listing_url,
            "icon_url": self.icon_url,
            "price": self.price,
            "permissions": self.permissions,
            "raw": self.raw,
            "last_scraped": _now_iso(),
        }


@dataclass
class Review:
    stars: int
    review_uid: Optional[str] = None
    author: Optional[str] = None
    body: Optional[str] = None
    reviewed_at: Optional[Any] = None  # date | datetime | str
    language: Optional[str] = None
    helpful_count: Optional[int] = None
    raw: Optional[Dict[str, Any]] = None

    def dedupe_uid(self) -> str:
        """Stable id for the review. Use the store's id if we have one; else a
        content hash of (author, date, body) so re-runs upsert instead of
        duplicating (the reviews unique index keys on this column)."""
        if self.review_uid:
            return self.review_uid
        h = hashlib.sha256()
        for part in (self.author, _iso_dt(self.reviewed_at), self.body):
            h.update((part or "").encode("utf-8"))
            h.update(b"\x00")
        return "syn_" + h.hexdigest()[:24]

    def to_row(self, extension_id: int) -> Dict[str, Any]:
        return {
            "extension_id": extension_id,
            "review_uid": self.dedupe_uid(),
            "author": self.author,
            "stars": self.stars,
            "body": self.body,
            "reviewed_at": _iso_dt(self.reviewed_at),
            "language": self.language,
            "helpful_count": self.helpful_count,
            "raw": self.raw,
        }
