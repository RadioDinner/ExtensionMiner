from datetime import date, datetime, timezone

from scraper.cache import RawCache
from scraper.crawl import CrawlOptions, merge_reviews
from scraper.models import Extension, Review
from scraper.ratelimit import RateLimiter
from scraper.robots import make_checker
from scraper.run import build_parser, resolve_options


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


def test_skip_existing_flag_wires_through():
    # default off
    assert build_parser().parse_args([]).skip_existing is False
    assert CrawlOptions().skip_existing is False
    # flag turns it on
    args = build_parser().parse_args(["--skip-existing"])
    assert args.skip_existing is True


def test_refresh_after_days_flag_wires_through():
    # default off
    assert build_parser().parse_args([]).refresh_after_days is None
    assert CrawlOptions().refresh_after_days is None
    # parses an int window
    args = build_parser().parse_args(["--refresh-after-days", "30"])
    assert args.refresh_after_days == 30


def test_all_categories_flag_and_daily_preset():
    # default off, both on the parser and the options dataclass
    assert build_parser().parse_args([]).all_categories is False
    assert CrawlOptions().all_categories is False

    # the explicit flag turns it on
    opts = resolve_options(build_parser().parse_args(["--all-categories"]))
    assert opts.all_categories is True

    # the daily preset implies the full taxonomy + no cap + cache bypass
    daily = resolve_options(build_parser().parse_args(["--preset", "daily"]))
    assert daily.all_categories is True
    assert daily.max_extensions == 0
    assert daily.refresh is True


def test_discovery_scroll_knobs_default():
    opts = resolve_options(build_parser().parse_args([]))
    assert opts.category_scrolls == 40       # exhaust-scroll cap
    assert opts.discovery_patience == 3


def test_multi_sort_flag_wires_through():
    # on by default; --no-multi-sort turns it off
    assert build_parser().parse_args([]).multi_sort is True
    assert CrawlOptions().multi_sort is True
    assert build_parser().parse_args(["--no-multi-sort"]).multi_sort is False
    assert resolve_options(build_parser().parse_args(["--no-multi-sort"])).multi_sort is False


def test_merge_reviews_dedupes_across_sorts():
    # Same review under two sort orders must collapse to one (by store id, or by
    # the synthetic content hash when there's no id).
    a = Review(stars=1, author="A", body="needs sync")
    b = Review(stars=5, review_uid="r2", body="great")
    b_again = Review(stars=5, review_uid="r2", body="great")   # dup by store id
    c = Review(stars=3, review_uid="r3", body="ok")
    a_again = Review(stars=1, author="A", body="needs sync")   # dup by content hash

    merged = merge_reviews([[a, b], [b_again, c, a_again]])
    assert len(merged) == 3
    assert {r.dedupe_uid() for r in merged} == {a.dedupe_uid(), "r2", "r3"}
