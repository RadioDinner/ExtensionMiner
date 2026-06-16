"""robots.txt awareness. Respect the store's crawl rules by default."""
from __future__ import annotations

import urllib.robotparser as robotparser
from typing import Callable


def make_checker(robots_txt: str, user_agent: str) -> Callable[[str], bool]:
    """Return ``allowed(url) -> bool`` for the given robots.txt body.

    A blank/unparseable body is treated as "allow all" — the caller decides
    whether that is acceptable.
    """
    parser = robotparser.RobotFileParser()
    parser.parse((robots_txt or "").splitlines())

    def allowed(url: str) -> bool:
        try:
            return parser.can_fetch(user_agent, url)
        except Exception:
            return True

    return allowed


def fetch_robots(user_agent: str, *, timeout: float = 15.0) -> str:
    """Fetch the live store robots.txt (requires network to the store)."""
    import requests  # imported lazily; only needed at crawl time

    from .selectors import ROBOTS_URL

    resp = requests.get(ROBOTS_URL, headers={"User-Agent": user_agent}, timeout=timeout)
    resp.raise_for_status()
    return resp.text
