"""Playwright-backed fetcher: polite, cached navigation of the Chrome Web Store.

The store is a JS-heavy SPA whose reviews load via XHR/scroll, so a headless
browser is the reliable DIY path. Playwright is imported lazily (inside the
context manager) so importing this module never requires it to be installed.

Politeness, all in one place: a fresh isolated context (incognito-equivalent), a
custom User-Agent, a rate limiter between navigations, robots.txt checks, and an
on-disk raw cache so a page is never fetched twice.
"""
from __future__ import annotations

from typing import Callable, List, Optional, Tuple

from .cache import RawCache
from .ratelimit import RateLimiter


class RobotsDisallowed(Exception):
    """Raised when robots.txt forbids fetching a URL."""


class CWSBrowser:
    def __init__(
        self,
        *,
        cache: RawCache,
        rate_limiter: RateLimiter,
        user_agent: str,
        headless: bool = True,
        robots_allowed: Optional[Callable[[str], bool]] = None,
        refresh: bool = False,
        nav_timeout_ms: int = 30_000,
    ) -> None:
        self.cache = cache
        self.rate_limiter = rate_limiter
        self.user_agent = user_agent
        self.headless = headless
        self.robots_allowed = robots_allowed
        self.refresh = refresh
        self.nav_timeout_ms = nav_timeout_ms
        self._pw = None
        self._browser = None
        self._context = None
        self._page = None

    def __enter__(self) -> "CWSBrowser":
        from playwright.sync_api import sync_playwright  # lazy import

        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=self.headless)
        self._context = self._browser.new_context(user_agent=self.user_agent)
        self._page = self._context.new_page()
        self._page.set_default_timeout(self.nav_timeout_ms)
        return self

    def __exit__(self, *exc) -> None:
        for closer in (self._context, self._browser):
            try:
                if closer:
                    closer.close()
            except Exception:
                pass
        try:
            if self._pw:
                self._pw.stop()
        except Exception:
            pass

    def fetch(
        self,
        url: str,
        *,
        cache_key: Optional[str] = None,
        wait_selector: Optional[str] = None,
        scrolls: int = 0,
        scroll_pause_ms: int = 1_200,
    ) -> Tuple[str, str]:
        """Return ``(html, visible_text)`` for ``url``, using the cache first."""
        key = cache_key or url
        if not self.refresh and self.cache.has(key, "html"):
            return self.cache.get(key, "html") or "", self.cache.get(key, "txt") or ""

        if self.robots_allowed is not None and not self.robots_allowed(url):
            raise RobotsDisallowed(url)

        self.rate_limiter.wait()
        self._page.goto(url, wait_until="domcontentloaded")
        if wait_selector:
            try:
                self._page.wait_for_selector(wait_selector)
            except Exception:
                pass
        for _ in range(max(0, scrolls)):
            self._page.mouse.wheel(0, 20_000)
            self._page.wait_for_timeout(scroll_pause_ms)

        html = self._page.content()
        try:
            text = self._page.inner_text("body")
        except Exception:
            text = ""
        self.cache.put(key, html, "html")
        self.cache.put(key, text, "txt")
        return html, text

    def _scroll_page(self, scrolls: int, scroll_pause_ms: int) -> None:
        for _ in range(max(0, scrolls)):
            self._page.mouse.wheel(0, 20_000)
            self._page.wait_for_timeout(scroll_pause_ms)

    def _expand_reviews(self, expand_texts: Optional[List[str]], max_clicks: int = 600) -> int:
        """Click every per-review "See more"/"Show more" toggle so bodies aren't
        truncated. Matched by exact visible text; clicking a toggle flips it to
        "See less", so re-querying the same text naturally walks to the next
        still-collapsed review. Defensive: any failure just stops early."""
        clicked = 0
        for text in expand_texts or []:
            sel = f'text="{text}"'
            while clicked < max_clicks:
                try:
                    el = self._page.query_selector(sel)
                except Exception:
                    break
                if el is None:
                    break
                try:
                    el.click(timeout=800)
                    clicked += 1
                    self._page.wait_for_timeout(60)
                except Exception:
                    break
        return clicked

    def _load_all_reviews(self, load_more_texts: Optional[List[str]], *,
                          max_clicks: int = 40, pause_ms: int = 1_200) -> int:
        """Click the reviews "Load more" button until it's gone (or the cap).

        Logged-out/incognito reviews pages paginate with a button rather than pure
        infinite scroll, so this pulls every review the store will serve for the
        current sort — well past the ~10 first shown. Nudges the scroll each round
        so the button stays reachable and lazy content keeps loading. Defensive:
        any failure just stops."""
        clicks = 0
        texts = load_more_texts or []
        if not texts:
            return 0
        while clicks < max_clicks:
            self._page.mouse.wheel(0, 24_000)
            self._page.wait_for_timeout(400)
            btn = None
            for text in texts:
                try:
                    btn = self._page.query_selector(f'text="{text}"')
                except Exception:
                    btn = None
                if btn is not None:
                    break
            if btn is None:
                break
            try:
                btn.scroll_into_view_if_needed(timeout=1_000)
                btn.click(timeout=2_000)
                clicks += 1
                self._page.wait_for_timeout(pause_ms)
            except Exception:
                break
        return clicks

    def _click_more(self, texts: Optional[List[str]], *, pause_ms: int = 1_200) -> bool:
        """Click the first visible "Load more"/"Show more" button if present.

        Category grids (and some lists) paginate with a button rather than pure
        infinite scroll, so scrolling alone stops at the first batch. Matched by
        exact visible text (robust to class churn); best-effort and defensive —
        returns False (a no-op) if no such button is on the page."""
        for text in texts or []:
            try:
                btn = self._page.query_selector(f'text="{text}"')
            except Exception:
                btn = None
            if btn is None:
                continue
            try:
                btn.scroll_into_view_if_needed(timeout=1_000)
                btn.click(timeout=1_500)
                self._page.wait_for_timeout(pause_ms)
                return True
            except Exception:
                continue
        return False

    def _apply_review_sort(self, label: str, trigger_selector: str, option_selector: str) -> bool:
        """Open the sort dropdown and pick the option titled ``label``.

        Returns True if a sort option was clicked. Best-effort and defensive: any
        failure (control absent / classes changed) returns False so the caller
        falls back to whatever sort is already shown.
        """
        try:
            trigger = self._page.query_selector(trigger_selector)
            if trigger is None:
                return False
            trigger.click()
            self._page.wait_for_timeout(500)
        except Exception:
            return False
        # Prefer the exact title= CSS selector (precise); fall back to accessible
        # name / visible text if the markup differs.
        css = option_selector.format(label=label.replace('"', '\\"'))
        for attempt in (
            lambda: self._page.click(css, timeout=2_000),
            lambda: self._page.get_by_role("option", name=label, exact=True).first.click(timeout=2_000),
            lambda: self._page.get_by_text(label, exact=True).first.click(timeout=2_000),
        ):
            try:
                attempt()
                self._page.wait_for_timeout(1_000)  # let the list re-render
                return True
            except Exception:
                continue
        return False

    def fetch_review_sorts(
        self,
        url: str,
        sorts: List[Tuple[str, str]],
        *,
        trigger_selector: str,
        option_selector: str,
        expand_texts: Optional[List[str]] = None,
        load_more_texts: Optional[List[str]] = None,
        load_more_max: int = 40,
        scrolls: int = 6,
        scroll_pause_ms: int = 1_200,
        wait_selector: Optional[str] = None,
    ) -> List[Tuple[str, str]]:
        """Snapshot a reviews page under several sort orders, fully paginated.

        Navigates once; for the default sort and then each ``(key, label)`` sort
        it scrolls, clicks "Load more" until exhausted, expands every "Show more",
        and snapshots. Returns ``[(sort_key, html), ...]`` (the default snapshot
        keyed ``"default"``) so callers can tell which reviews came from, e.g.,
        the ``"helpful"`` sort. Degrades to just the default snapshot if the sort
        control can't be driven.
        """
        if self.robots_allowed is not None and not self.robots_allowed(url):
            raise RobotsDisallowed(url)

        self.rate_limiter.wait()
        self._page.goto(url, wait_until="domcontentloaded")
        if wait_selector:
            try:
                self._page.wait_for_selector(wait_selector)
            except Exception:
                pass

        def load_and_snapshot(key: str) -> Tuple[str, str]:
            self._scroll_page(scrolls, scroll_pause_ms)
            self._load_all_reviews(load_more_texts, max_clicks=load_more_max, pause_ms=scroll_pause_ms)
            self._expand_reviews(expand_texts)
            return key, self._page.content()

        snapshots: List[Tuple[str, str]] = [load_and_snapshot("default")]
        for key, label in sorts:
            if self._apply_review_sort(label, trigger_selector, option_selector):
                snapshots.append(load_and_snapshot(key))

        try:
            self.cache.put(url, self._page.content(), "html")
            self.cache.put(url, self._page.inner_text("body"), "txt")
        except Exception:
            pass
        return snapshots

    def collect_scrolling(
        self,
        url: str,
        extract: Callable[[str], List[str]],
        *,
        max_scrolls: int = 40,
        patience: int = 3,
        scroll_pause_ms: int = 1_200,
        wait_selector: Optional[str] = None,
        load_more_texts: Optional[List[str]] = None,
    ) -> List[str]:
        """Navigate once, then scroll progressively to exhaust a lazy-loading list.

        After each scroll (and a best-effort ``load_more_texts`` button click, for
        grids that paginate by button instead of pure infinite scroll), ``extract``
        is run on the live HTML and any new items are accumulated (de-duped,
        first-seen order). Scrolling stops when ``extract`` yields nothing new for
        ``patience`` consecutive scrolls, or after ``max_scrolls``. Just ONE
        navigation happens (polite); this is how we pull *every* extension a
        category page is willing to surface. The final HTML is cached for debugging.
        """
        if self.robots_allowed is not None and not self.robots_allowed(url):
            raise RobotsDisallowed(url)

        self.rate_limiter.wait()
        self._page.goto(url, wait_until="domcontentloaded")
        if wait_selector:
            try:
                self._page.wait_for_selector(wait_selector)
            except Exception:
                pass

        seen: set = set()
        ordered: List[str] = []

        def harvest() -> int:
            added = 0
            for item in extract(self._page.content()):
                if item not in seen:
                    seen.add(item)
                    ordered.append(item)
                    added += 1
            return added

        harvest()  # whatever rendered before the first scroll
        stale = 0
        for _ in range(max(1, max_scrolls)):
            self._page.mouse.wheel(0, 24_000)
            self._page.wait_for_timeout(scroll_pause_ms)
            # Grids that paginate by button won't load more on scroll alone; click
            # "Load more" if present (no-op when the page infinite-scrolls instead).
            clicked = self._click_more(load_more_texts, pause_ms=scroll_pause_ms)
            added = harvest()
            if added == 0 and not clicked:
                stale += 1
                if stale >= max(1, patience):
                    break
            else:
                stale = 0

        try:
            self.cache.put(url, self._page.content(), "html")
            self.cache.put(url, self._page.inner_text("body"), "txt")
        except Exception:
            pass
        return ordered
