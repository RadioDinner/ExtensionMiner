"""Tests for common.config — runs with the stdlib alone (no network/creds)."""
from common.config import Settings


def test_settings_from_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "svc-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("SCRAPER_RATE_LIMIT_SECONDS", "1.5")
    monkeypatch.setenv("TARGET_CATEGORIES", "productivity, developer-tools , ")

    s = Settings.from_env()

    assert s.supabase_url == "https://example.supabase.co"
    assert s.rate_limit_seconds == 1.5
    # whitespace trimmed, empty trailing item dropped
    assert s.target_categories == ["productivity", "developer-tools"]
    s.require_supabase()   # should not raise
    s.require_anthropic()  # should not raise


def test_require_supabase_raises_when_missing():
    s = Settings(supabase_url="", supabase_service_role_key="")
    try:
        s.require_supabase()
    except RuntimeError as exc:
        assert "SUPABASE_URL" in str(exc)
    else:
        raise AssertionError("expected RuntimeError when Supabase env is missing")


def test_defaults_are_sane():
    s = Settings()
    assert s.rate_limit_seconds == 3.0
    assert s.target_categories == ["productivity", "developer-tools"]
