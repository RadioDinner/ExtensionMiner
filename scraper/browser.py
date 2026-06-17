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

    def collect_scrolling(
        self,
        url: str,
        extract: Callable[[str], List[str]],
        *,
        max_scrolls: int = 40,
        patience: int = 3,
        scroll_pause_ms: int = 1_200,
        wait_selector: Optional[str] = None,
    ) -> List[str]:
        """Navigate once, then scroll progressively to exhaust a lazy-loading list.

        After each scroll, ``extract`` is run on the live HTML and any new items
        are accumulated (de-duped, first-seen order). Scrolling stops when
        ``extract`` yields nothing new for ``patience`` consecutive scrolls, or
        after ``max_scrolls``. Just ONE navigation happens (polite); this is how
        we pull *every* extension a category page is willing to lazy-load, rather
        than a fixed number of scrolls. The final HTML is cached for debugging.
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
            if harvest() == 0:
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
