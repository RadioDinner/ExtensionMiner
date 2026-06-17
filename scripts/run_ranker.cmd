@echo off
setlocal EnableExtensions
REM ===========================================================================
REM  ExtensionMiner - one-click Claude ANALYSIS launcher (Windows)
REM ---------------------------------------------------------------------------
REM  Double-click this file (or its Desktop shortcut) to run ALL the Claude
REM  analysis tasks at once over the extensions + reviews you've scraped:
REM    1. RANKING      - mines reviews for fixable complaints + "I'd pay" signals,
REM                      scores each extension, writes the `opportunities` table.
REM    2. MONETIZATION - web-searches each extension's pricing and estimates
REM                      monthly revenue, writes the `monetization` table.
REM    3. DEEP DIVE    - processes the hand-picked deep-dive POOL: for each
REM                      extension you queued on the dashboard, researches the
REM                      reviews + competitors and writes the `deep_dives` table.
REM  (This is the analysis step - it does NOT scrape; run the scraper first so
REM  there are reviews to analyze.)
REM
REM  Before running, it AUTO-UPDATES the code (git pull of the latest) so you're
REM  always on the newest version - while keeping your .env and the .venv (those
REM  are git-ignored, so updating never touches them). It shares the same .venv
REM  the scraper uses; no browser download is needed for ranking.
REM
REM  Needs ANTHROPIC_API_KEY (and SUPABASE_*) in your .env.
REM ===========================================================================

REM "unattended" means: don't pause at the end (for a scheduled run).
set "UNATTENDED="
if /i "%~1"=="unattended" set "UNATTENDED=1"

REM --- Move to the repo root (this script lives in scripts\) ------------------
cd /d "%~dp0.." || goto :fail
set "REPO=%CD%"

REM --- Sanity check: are we actually inside the ExtensionMiner repo? ----------
if not exist "%REPO%\requirements.txt" goto :norepo
if not exist "%REPO%\analysis\run.py"  goto :norepo

REM ===========================================================================
REM  EDITABLE KNOBS
REM  RUN_ARGS     - what to run. Default = ALL Claude tasks on the top 25
REM                 extensions by installs: ranking (--> opportunities),
REM                 monetization research (--monetize --> monetization) AND the
REM                 deep-dive pool (--deep-dive --> deep_dives). Tweak it:
REM                   --limit 50      do more extensions
REM                   (drop --monetize) ranking only, no web-search/pricing pass
REM                   (drop --deep-dive) skip the queued deep-dive pool
REM                   --no-db         dry run, write nothing
REM                 Heads-up: --monetize and --deep-dive web-search per extension,
REM                 so they cost more and take longer than ranking alone. The
REM                 deep dive only touches extensions you queued on the dashboard.
REM  AUTO_UPDATE  - 1 = git pull the latest code before running; 0 = don't.
REM  UPDATE_BRANCH- which branch to track (main is the canonical, current one).
REM ===========================================================================
set "RUN_ARGS=--monetize --deep-dive --log-dir logs"
set "AUTO_UPDATE=1"
set "UPDATE_BRANCH=main"

REM --- Auto-update: pull the latest code (keeps .env / .venv) -----------------
set "CODE_CHANGED="
if not "%AUTO_UPDATE%"=="1" goto :after_update
if not exist "%REPO%\.git" (
  echo [update] Not a git clone here; skipping auto-update, running local copy.
  goto :after_update
)
where git >nul 2>nul
if errorlevel 1 (
  echo [update] git not found on PATH; skipping auto-update, running local copy.
  goto :after_update
)
REM Never hang on a credential prompt (matters for an unattended run).
set "GIT_TERMINAL_PROMPT=0"
echo [update] Checking for the latest code ^(%UPDATE_BRANCH%^) ...
git rev-parse HEAD > "%TEMP%\em_old_head_r.txt" 2>nul
git fetch --quiet origin %UPDATE_BRANCH%
if errorlevel 1 (
  echo [update] Couldn't reach the remote ^(offline?^); running the local copy.
  goto :after_update
)
git checkout --quiet %UPDATE_BRANCH% >nul 2>&1
git reset --hard origin/%UPDATE_BRANCH%
git rev-parse HEAD > "%TEMP%\em_new_head_r.txt" 2>nul
fc /b "%TEMP%\em_old_head_r.txt" "%TEMP%\em_new_head_r.txt" >nul 2>&1
if errorlevel 1 (
  set "CODE_CHANGED=1"
  echo [update] Updated to the latest %UPDATE_BRANCH%.
) else (
  echo [update] Already up to date.
)
:after_update

REM --- Find a Python interpreter ---------------------------------------------
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY ( where python >nul 2>nul && set "PY=python" )
if not defined PY (
  echo [ERROR] Python was not found on your PATH.
  echo         Install Python 3.11+ from https://www.python.org/downloads/
  echo         During install, tick "Add python.exe to PATH", then run this again.
  goto :fail
)

REM --- Create the virtual environment on first run ---------------------------
set "VENV=%REPO%\.venv"
set "VPY=%VENV%\Scripts\python.exe"
if not exist "%VPY%" (
  echo [setup] Creating a private virtual environment in .venv ...
  %PY% -m venv "%VENV%" || goto :fail
)

REM --- Install dependencies once (no Chromium needed for ranking) -------------
REM  Deps are ready if the scraper already set up this venv (its .deps-ok stamp
REM  implies requirements.txt is installed) or we installed them here before. We
REM  use a SEPARATE ranker stamp so we never imply Chromium is installed - the
REM  scraper manages that with its own stamp.
set "STAMP=%VENV%\.deps-ok"
set "RSTAMP=%VENV%\.ranker-deps-ok"
set "FIRST_RUN="
if not exist "%STAMP%" if not exist "%RSTAMP%" set "FIRST_RUN=1"
if defined FIRST_RUN (
  echo [setup] Installing Python dependencies ^(first run - a few minutes^) ...
  "%VPY%" -m pip install --upgrade pip || goto :fail
  "%VPY%" -m pip install -r "%REPO%\requirements.txt" || goto :fail
  > "%RSTAMP%" echo ok
)

REM --- After an auto-update, refresh deps in case requirements.txt changed ----
if not defined FIRST_RUN if defined CODE_CHANGED (
  echo [setup] Code updated - refreshing Python dependencies ...
  "%VPY%" -m pip install -q -r "%REPO%\requirements.txt"
)

REM --- Friendly .env check ----------------------------------------------------
if not exist "%REPO%\.env" (
  echo [WARN] No .env file found in %REPO%.
  echo        Copy .env.example to .env and set ANTHROPIC_API_KEY ^(and the
  echo        SUPABASE_* keys^) before running the ranker.
)

echo.
echo [run] %VPY% -m analysis.run %RUN_ARGS%
echo.
"%VPY%" -m analysis.run %RUN_ARGS%
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [done] Claude analysis finished OK. Opportunities + monetization + deep dives updated; logs are in %REPO%\logs
) else (
  echo [done] Claude analysis exited with code %RC%. See the message above; full log in %REPO%\logs
)

if not defined UNATTENDED pause
exit /b %RC%

:norepo
echo.
echo [ERROR] This doesn't look like the ExtensionMiner repo.
echo         I looked here:  %REPO%
echo         ...but couldn't find requirements.txt and analysis\run.py.
echo.
echo         run_ranker.cmd has to stay INSIDE the repo's "scripts" folder.
echo         If you copied just this file out (e.g. to Downloads), move it back
echo         into your cloned ExtensionMiner\scripts\ folder - or pull the latest
echo         branch so it's already there - then double-click it from there.
echo.
if not defined UNATTENDED pause
exit /b 1

:fail
echo.
echo [ERROR] Setup failed - see the message above.
if not defined UNATTENDED pause
exit /b 1
