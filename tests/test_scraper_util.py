from datetime import date, datetime, timezone

from scraper.cache import RawCache
from scraper.models import Extension, Review
from scraper.ratelimit import RateLimiter
from scraper.robots import make_checker


def test_rate_limiter_sleeps_when_too_soon():
    """With an injected clock, the second call must wait the remaining interval."""
    now = {"t": 100.0}
    slept = []
    rl = RateLimiter(2.0, clock=lambda: now["t"], sleep=lambda s: slept.append(s))

    assert rl.wait() == 0.0          # first call: no wait
    now["t"] = 100.5                  # only 0.5s elapsed
    waited = rl.wait()
    assert waited == 1.5             # had to wait 2.0 - 0.5
    assert slept == [1.5]


def test_rate_limiter_no_sleep_when_enough_elapsed():
    now = {"t": 0.0}
    slept = []
    rl = RateLimiter(1.0, clock=lambda: now["t"], sleep=lambda s: slept.append(s))
    rl.wait()
    now["t"] = 5.0
    assert rl.wait() == 0.0
    assert slept == []


def test_raw_cache_roundtrip(tmp_path):
    cache = RawCache(tmp_path)
    assert not cache.has("https://x/y")
    cache.put("https://x/y", "<html>hi</html>")
    assert cache.has("https://x/y")
    assert cache.get("https://x/y") == "<html>hi</html>"
    # distinct keys -> distinct files
    cache.put("https://x/z", "other")
    assert cache.get("https://x/z") == "other"
    assert cache.get("https://x/y") == "<html>hi</html>"


def test_robots_checker_allow_and_deny():
    robots = "User-agent: *\nDisallow: /detail/secret\n"
    allowed = make_checker(robots, "ExtensionMiner/0.1")
    assert allowed("https://chromewebstore.google.com/category/extensions/productivity")
    assert not allowed("https://chromewebstore.google.com/detail/secret/abc")


def test_extension_to_row():
    ext = Extension(
        ext_id="e" * 32,
        name="Demo",
        rating=3.0,
        install_count=1000,
        last_updated=date(2024, 9, 5),
        permissions=["tabs"],
    )
    row = ext.to_row()
    assert row["ext_id"] == "e" * 32
    assert row["last_updated"] == "2024-09-05"
    assert row["permissions"] == ["tabs"]
    assert "last_scraped" in row and row["last_scraped"]  # stamped


def test_review_to_row_and_synthetic_uid():
    when = datetime(2024, 9, 5, tzinfo=timezone.utc)
    r = Review(stars=2, author="Alice", body="if X worked I'd pay", reviewed_at=when)
    uid1 = r.dedupe_uid()
    assert uid1.startswith("syn_")
    # stable across calls
    assert r.dedupe_uid() == uid1
    row = r.to_row(extension_id=7)
    assert row["extension_id"] == 7
    assert row["stars"] == 2
    assert row["review_uid"] == uid1
    assert row["reviewed_at"] == when.isoformat()

    # an explicit store id wins over the synthetic hash
    r2 = Review(stars=5, review_uid="real-id")
    assert r2.dedupe_uid() == "real-id"
