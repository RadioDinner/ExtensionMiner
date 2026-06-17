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


def test_follow_related_flag_and_daily_preset():
    # off by default; explicit flag and the daily preset both enable it
    assert build_parser().parse_args([]).follow_related is False
    assert CrawlOptions().follow_related is False
    assert resolve_options(build_parser().parse_args(["--follow-related"])).follow_related is True
    daily = resolve_options(build_parser().parse_args(["--preset", "daily"]))
    assert daily.follow_related is True
    # --max-total bounds a graph crawl
    assert resolve_options(build_parser().parse_args(["--max-total", "500"])).max_total == 500


def test_merge_reviews_dedupes_across_sorts():
    # Same review under two sort orders must collapse to one (by store id, or by
    # the synthetic content hash when there's no id). Input is (sort_key, reviews).
    a = Review(stars=1, author="A", body="needs sync")
    b = Review(stars=5, review_uid="r2", body="great")
    b_again = Review(stars=5, review_uid="r2", body="great")   # dup by store id
    c = Review(stars=3, review_uid="r3", body="ok")
    a_again = Review(stars=1, author="A", body="needs sync")   # dup by content hash

    merged = merge_reviews([("recent", [a, b]), ("lowest", [b_again, c, a_again])])
    assert len(merged) == 3
    assert {r.dedupe_uid() for r in merged} == {a.dedupe_uid(), "r2", "r3"}


def test_merge_reviews_flags_helpful_and_or_s_across_sorts():
    # A review under "recent" that ALSO appears under "helpful" gets flagged,
    # de-duped to one row. Reviews only under "recent" stay unflagged.
    r_recent = Review(stars=2, review_uid="r1", body="if sync worked I'd pay")
    r_recent_only = Review(stars=4, review_uid="r2", body="nice")
    r_helpful_same = Review(stars=2, review_uid="r1", body="if sync worked I'd pay")  # same as r1
    r_helpful_new = Review(stars=1, review_uid="r3", body="constant crashes")

    merged = merge_reviews([
        ("recent", [r_recent, r_recent_only]),
        ("helpful", [r_helpful_same, r_helpful_new]),
    ])
    flags = {r.dedupe_uid(): r.helpful for r in merged}
    assert flags == {"r1": True, "r2": False, "r3": True}


# --- Graph-crawl (follow-related BFS) via a fake browser --------------------

ID_A, ID_B, ID_C = "a" * 32, "b" * 32, "c" * 32
_DETAILS = {
    ID_A: f'<html><body><h1>A</h1><a href="/detail/x/{ID_C}">c</a></body></html>',
    ID_B: "<html><body><h1>B</h1></body></html>",
    ID_C: f'<html><body><h1>C</h1><a href="/detail/x/{ID_A}">a</a></body></html>',
}


class _FakeCache:
    def has(self, *a, **k):
        return False

    def get(self, *a, **k):
        return None

    def put(self, *a, **k):
        return None


class _FakeBrowser:
    """Minimal stand-in: category seeds [A, B]; A links to C; C links back to A."""

    refresh = True
    cache = _FakeCache()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def collect_scrolling(self, url, extract, **kw):
        return [ID_A, ID_B]

    def fetch(self, url, **kw):
        if url.endswith("/reviews"):
            return "<html></html>", ""
        ext_id = url.rstrip("/").split("/")[-1]
        return _DETAILS.get(ext_id, "<html><body><h1>?</h1></body></html>"), ""


def _crawl_with_fake(monkeypatch, **opt_kwargs):
    import scraper.crawl as crawlmod
    from common.config import Settings

    monkeypatch.setattr(crawlmod, "build_browser", lambda s, o: _FakeBrowser())
    opts = crawlmod.CrawlOptions(
        categories=["productivity"], write_db=False, respect_robots=False,
        multi_sort=False, **opt_kwargs,
    )
    return crawlmod.crawl(Settings(), opts)


def test_crawl_follows_related_graph(monkeypatch):
    # Seeds A,B; A->C via related; C->A (already seen). All three get scraped.
    stats = _crawl_with_fake(monkeypatch, follow_related=True)
    assert stats["extensions"] == 3
    assert stats["discovered"] == 3


def test_crawl_without_related_stays_on_seeds(monkeypatch):
    stats = _crawl_with_fake(monkeypatch, follow_related=False)
    assert stats["extensions"] == 2          # only the category seeds A, B
    assert stats["discovered"] == 2


def test_crawl_max_total_caps_discovery(monkeypatch):
    # Cap at 2: the related C is never enqueued.
    stats = _crawl_with_fake(monkeypatch, follow_related=True, max_total=2)
    assert stats["discovered"] == 2
    assert stats["extensions"] == 2


def test_crawl_parallel_follows_related_graph(monkeypatch):
    # Same A->C->A graph, but drained by several workers at once. The thread-safe
    # discovered/seen guards mean every node is still scraped exactly once.
    stats = _crawl_with_fake(monkeypatch, follow_related=True, concurrency=3)
    assert stats["extensions"] == 3
    assert stats["discovered"] == 3


def test_concurrency_flag_wires_through():
    # serial by default; the daily preset parallelizes; an explicit value wins.
    assert build_parser().parse_args([]).concurrency is None
    assert CrawlOptions().concurrency == 1
    assert resolve_options(build_parser().parse_args([])).concurrency == 1
    assert resolve_options(build_parser().parse_args(["--preset", "daily"])).concurrency == 4
    assert resolve_options(build_parser().parse_args(["--concurrency", "8"])).concurrency == 8
    assert resolve_options(
        build_parser().parse_args(["--preset", "daily", "--concurrency", "12"])
    ).concurrency == 12


def test_review_sorts_are_recent_and_helpful_only():
    # We pull only the two sorts that carry signal (no highest/lowest passes).
    from scraper import selectors

    assert [key for key, _ in selectors.REVIEW_SORTS] == ["recent", "helpful"]


def test_category_taxonomy_covers_the_store_groups():
    from scraper import categories

    slugs = categories.all_category_slugs()
    assert len(slugs) == 18  # productivity(5) + lifestyle(10) + make_chrome_yours(3)
    for confirmed in (
        "productivity/tools", "lifestyle/shopping", "lifestyle/art",
        "lifestyle/entertainment", "make_chrome_yours/accessibility",
    ):
        assert confirmed in slugs


def test_category_display_for():
    from scraper import categories

    assert categories.display_for("productivity/tools") == "Productivity / Tools"
    assert categories.display_for("make_chrome_yours/accessibility") == "Make Chrome Yours / Accessibility"
    assert categories.display_for("productivity") == "Productivity"   # group-only slug
    assert categories.display_for(None) is None
    # an unknown slug is tidied, never dropped
    assert categories.display_for("newgroup/cool-stuff") == "Newgroup / Cool Stuff"


def test_category_from_detail_is_safe():
    from scraper import categories

    # exactly one known category -> use it
    assert categories.category_from_detail(["productivity/tools"]) == "Productivity / Tools"
    # ambiguous (nav lists several) -> None, never a wrong guess
    assert categories.category_from_detail(["productivity/tools", "lifestyle/shopping"]) is None
    # nothing recognizable -> None
    assert categories.category_from_detail(["weird/thing"]) is None
    assert categories.category_from_detail([]) is None


def test_scrape_extension_normalizes_category():
    from scraper.crawl import scrape_extension

    class _Cache:
        def has(self, *a, **k):
            return False

        def get(self, *a, **k):
            return None

    class _Browser:
        refresh = True
        cache = _Cache()

        def fetch(self, url, **kw):
            if url.endswith("/reviews"):
                return "<html></html>", ""
            return "<html><body><h1>X</h1></body></html>", ""

    ext, _, _ = scrape_extension(_Browser(), "a" * 32, category="productivity/tools", multi_sort=False)
    assert ext.store_category == "Productivity / Tools"


def test_collect_extension_ids_passes_category_load_more():
    # Discovery must hand the category "Load more" texts to collect_scrolling so a
    # button-paginated grid isn't capped at its first ~30 by scrolling alone.
    import scraper.crawl as crawlmod
    from scraper import selectors

    captured = {}

    class _RecCache:
        def has(self, *a, **k):
            return False

        def get(self, *a, **k):
            return None

    class _RecBrowser:
        refresh = True
        cache = _RecCache()

        def collect_scrolling(self, url, extract, **kw):
            captured.update(kw)
            return ["x" * 32]

    ids = crawlmod.collect_extension_ids(
        _RecBrowser(), "productivity", max_extensions=0, opts=crawlmod.CrawlOptions()
    )
    assert ids == ["x" * 32]
    assert captured.get("load_more_texts") == selectors.CATEGORY_LOAD_MORE_TEXTS
