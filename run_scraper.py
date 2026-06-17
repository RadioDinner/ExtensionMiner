"""Convenience entry point so `python run_scraper.py ...` works from the repo root.

This exists purely to avoid the classic gotcha of running `python scraper/run.py`
directly, which fails with a relative-import error. Both of these work:

    python run_scraper.py --preset daily --log-dir logs
    python -m scraper.run  --preset daily --log-dir logs

On Windows, prefer the one-click launcher: scripts\\run_scraper.cmd
"""
from __future__ import annotations

import sys

from scraper.run import main

if __name__ == "__main__":
    sys.exit(main())
