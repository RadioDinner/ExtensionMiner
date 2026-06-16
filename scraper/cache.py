"""On-disk cache of raw fetched responses.

Caching is a politeness requirement (the roadmap calls it out): never re-fetch
what we already have. Keys are logical strings (usually a URL); files are sharded
by a hash prefix to keep directories small. A ``.key`` sidecar records the
original key for debuggability.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional, Union


class RawCache:
    def __init__(self, base_dir: Union[str, Path]) -> None:
        self.base = Path(base_dir)

    def _path(self, key: str, ext: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
        return self.base / digest[:2] / f"{digest}.{ext}"

    def has(self, key: str, ext: str = "html") -> bool:
        return self._path(key, ext).exists()

    def get(self, key: str, ext: str = "html") -> Optional[str]:
        path = self._path(key, ext)
        return path.read_text("utf-8") if path.exists() else None

    def put(self, key: str, content: str, ext: str = "html") -> Path:
        path = self._path(key, ext)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, "utf-8")
        path.with_suffix(".key").write_text(key, "utf-8")
        return path
