"""Convenience entry point so `python run_scraper.py ...` works from the repo root.

This exists purely to avoid the classic gotcha of running `python scraper/run.py`
directly, which fails with a relative-import error. Both of these work:

    python run_scraper.py --preset daily --log-dir logs
    python -m scraper.run  --preset daily --log-dir logs

On Windows, prefer the one-click launcher: scripts\\run_scraper.cmd
"""
from __future__ import annotations

import os
import sys

try:
    from scraper.run import main
except ModuleNotFoundError as exc:
    # Almost always: this was launched with a Python that doesn't have the deps
    # (e.g. the system `python` instead of the project's .venv). Point the way out
    # instead of dumping a bare ImportError traceback.
    _venv_py = os.path.join(".venv", "Scripts", "python.exe") if os.name == "nt" \
        else os.path.join(".venv", "bin", "python")
    _has_venv = os.path.exists(_venv_py)
    print(
        f"\n[ERROR] Missing dependency: {exc.name}.\n"
        "        You're running with a Python that doesn't have the scraper's\n"
        "        packages installed (probably the system `python`, not the project\n"
        "        virtual environment).\n"
        + (
            "        Use the project's venv instead:\n"
            f"            {_venv_py} run_scraper.py ...\n"
            if _has_venv else
            "        Install the dependencies first:\n"
            "            python -m pip install -r requirements.txt\n"
            "            python -m playwright install chromium\n"
        )
        + "        On Windows, the one-click scripts\\run_scraper.cmd does all of\n"
          "        this (venv + deps + Chromium) for you.",
        file=sys.stderr,
    )
    sys.exit(3)

if __name__ == "__main__":
    sys.exit(main())
