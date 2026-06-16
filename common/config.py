"""Shared configuration for ExtensionMiner (scraper + analysis).

Settings come from environment variables, optionally seeded from a local .env.
Importing this module never requires network access or real credentials, so it
is safe to import in tests.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

# Load a local .env if python-dotenv is installed; otherwise rely on the real
# environment. dotenv is optional so the stdlib alone is enough to import this.
try:  # pragma: no cover - trivial import guard
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover
    pass


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    # Supabase (server-side; use the service_role key).
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    # Anthropic Claude API (ranking layer).
    anthropic_api_key: str = ""
    # Scraper politeness.
    rate_limit_seconds: float = 3.0
    cache_dir: str = "data/cache"
    user_agent: str = "ExtensionMiner/0.1 (research)"
    # Target categories to crawl (start small).
    target_categories: list[str] = field(
        default_factory=lambda: ["productivity", "developer-tools"]
    )

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            supabase_url=os.environ.get("SUPABASE_URL", ""),
            supabase_service_role_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
            rate_limit_seconds=float(os.environ.get("SCRAPER_RATE_LIMIT_SECONDS", "3") or 3),
            cache_dir=os.environ.get("SCRAPER_CACHE_DIR", "data/cache"),
            user_agent=os.environ.get("SCRAPER_USER_AGENT", "ExtensionMiner/0.1 (research)"),
            target_categories=_split_csv(
                os.environ.get("TARGET_CATEGORIES", "productivity,developer-tools")
            ),
        )

    def require_supabase(self) -> None:
        missing = [
            name
            for name, value in (
                ("SUPABASE_URL", self.supabase_url),
                ("SUPABASE_SERVICE_ROLE_KEY", self.supabase_service_role_key),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"Missing Supabase env vars: {', '.join(missing)}")

    def require_anthropic(self) -> None:
        if not self.anthropic_api_key:
            raise RuntimeError("Missing ANTHROPIC_API_KEY")


# Convenience singleton built from the current environment.
settings = Settings.from_env()
