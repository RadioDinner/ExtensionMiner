"""A tiny thread-safe rate limiter for polite crawling."""
from __future__ import annotations

import threading
import time
from typing import Callable, Optional


class RateLimiter:
    """Ensure successive ``wait()`` calls are at least ``min_interval`` apart.

    The clock and sleep functions are injectable so the timing logic is unit
    testable without real delays.
    """

    def __init__(
        self,
        min_interval: float,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.min_interval = max(0.0, float(min_interval))
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._last: Optional[float] = None

    def wait(self) -> float:
        """Block as needed; return the number of seconds actually slept."""
        with self._lock:
            now = self._clock()
            if self._last is None:
                self._last = now
                return 0.0
            delay = self.min_interval - (now - self._last)
            if delay > 0:
                self._sleep(delay)
                self._last = self._clock()
                return delay
            self._last = now
            return 0.0
