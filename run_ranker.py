"""Convenience entry point so `python run_ranker.py ...` works from the repo root.

Runs the Claude ranking layer (analysis/) — reads extensions + reviews from
Supabase, mines the reviews with Claude, and writes the `opportunities` table.
This shim avoids the `python analysis/run.py` relative-import gotcha. Both work:

    python run_ranker.py --limit 25 --log-dir logs
    python -m analysis.run --limit 25 --log-dir logs

On Windows, prefer the one-click launcher: scripts\\run_ranker.cmd
Needs ANTHROPIC_API_KEY (and SUPABASE_* unless --no-db) in your .env.
"""
from __future__ import annotations

import os
import sys

try:
    from analysis.run import main
except ModuleNotFoundError as exc:
    # Almost always: launched with a Python that doesn't have the deps (e.g. the
    # system `python` instead of the project's .venv). Point the way out.
    _venv_py = os.path.join(".venv", "Scripts", "python.exe") if os.name == "nt" \
        else os.path.join(".venv", "bin", "python")
    _has_venv = os.path.exists(_venv_py)
    print(
        f"\n[ERROR] Missing dependency: {exc.name}.\n"
        "        You're running with a Python that doesn't have the project's\n"
        "        packages installed (probably the system `python`, not the .venv).\n"
        + (
            "        Use the project's venv instead:\n"
            f"            {_venv_py} run_ranker.py ...\n"
            if _has_venv else
            "        Install the dependencies first:\n"
            "            python -m pip install -r requirements.txt\n"
        )
        + "        On Windows, scripts\\run_ranker.cmd sets up the venv + deps for you.",
        file=sys.stderr,
    )
    sys.exit(3)

if __name__ == "__main__":
    sys.exit(main())
