@echo off
setlocal EnableExtensions
REM ===========================================================================
REM  ExtensionMiner - one-click scraper launcher (Windows)
REM ---------------------------------------------------------------------------
REM  Double-click this file (or its Desktop shortcut) to run the scraper now. The
REM  Windows scheduled task created by install_daily_task.cmd also calls it (with
REM  the "unattended" arg) every day.
REM
REM  Before running, it AUTO-UPDATES the code (git pull of the latest) so you're
REM  always on the newest scraper - while keeping your .env, the .venv, and the
REM  cache (those are git-ignored, so updating never touches them). A full
REM  re-clone would wipe all three and re-download Chromium every time, which is
REM  why we pull instead.
REM
REM  First run is slow: it creates a private .venv, installs the Python
REM  dependencies, and downloads the Chromium browser. After that it's quick.
REM ===========================================================================

REM "unattended" (passed by the scheduled task) means: don't pause at the end.
set "UNATTENDED="
if /i "%~1"=="unattended" set "UNATTENDED=1"

REM --- Move to the repo root (this script lives in scripts\) ------------------
cd /d "%~dp0.." || goto :fail
set "REPO=%CD%"

REM --- Sanity check: are we actually inside the ExtensionMiner repo? ----------
if not exist "%REPO%\requirements.txt" goto :norepo
if not exist "%REPO%\scraper\run.py"   goto :norepo

REM ===========================================================================
REM  EDITABLE KNOBS
REM  RUN_ARGS     - what to run. Default = --use-saved-settings: the crawl is
REM                 driven by the dashboard's "Scraper settings" tab (categories,
REM                 caps, concurrency, the opportunity-zone review gate, etc.).
REM                 Set it there, then click this. Alternatives:
REM                   --preset daily   full-store crawl (ignores the dashboard)
REM                   (add your own CLI flags for a one-off manual run)
REM  AUTO_UPDATE  - 1 = git pull the latest code before running; 0 = don't.
REM  UPDATE_BRANCH- which branch to track (main is the canonical, always-current
REM                 one).
REM ===========================================================================
set "RUN_ARGS=--use-saved-settings --log-dir logs"
set "AUTO_UPDATE=1"
set "UPDATE_BRANCH=main"

REM --- Auto-update: pull the latest code (keeps .env / .venv / cache) ---------
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
REM Never hang on a credential prompt (matters for the unattended scheduled run).
set "GIT_TERMINAL_PROMPT=0"
echo [update] Checking for the latest scraper code ^(%UPDATE_BRANCH%^) ...
git rev-parse HEAD > "%TEMP%\em_old_head.txt" 2>nul
git fetch --quiet origin %UPDATE_BRANCH%
if errorlevel 1 (
  echo [update] Couldn't reach the remote ^(offline?^); running the local copy.
  goto :after_update
)
git checkout --quiet %UPDATE_BRANCH% >nul 2>&1
git reset --hard origin/%UPDATE_BRANCH%
git rev-parse HEAD > "%TEMP%\em_new_head.txt" 2>nul
fc /b "%TEMP%\em_old_head.txt" "%TEMP%\em_new_head.txt" >nul 2>&1
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

REM --- Install dependencies + Chromium once (a stamp file marks "done") -------
set "STAMP=%VENV%\.deps-ok"
set "FIRST_RUN="
if not exist "%STAMP%" set "FIRST_RUN=1"
if defined FIRST_RUN (
  echo [setup] Installing Python dependencies ^(first run - a few minutes^) ...
  "%VPY%" -m pip install --upgrade pip || goto :fail
  "%VPY%" -m pip install -r "%REPO%\requirements.txt" || goto :fail
  echo [setup] Downloading the Chromium browser for Playwright ...
  "%VPY%" -m playwright install chromium || goto :fail
  > "%STAMP%" echo ok
)

REM --- After an auto-update, refresh deps in case requirements.txt changed ----
if not defined FIRST_RUN if defined CODE_CHANGED (
  echo [setup] Code updated - refreshing Python dependencies ...
  "%VPY%" -m pip install -q -r "%REPO%\requirements.txt"
)

REM --- Friendly .env check before we bother launching a browser --------------
if not exist "%REPO%\.env" (
  echo [WARN] No .env file found in %REPO%.
  echo        Copy .env.example to .env and fill in SUPABASE_URL and the
  echo        SUPABASE_SERVICE_ROLE_KEY ^(the SECRET key^) before a real run.
)

echo.
echo [run] %VPY% -m scraper.run %RUN_ARGS%
echo.
"%VPY%" -m scraper.run %RUN_ARGS%
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [done] Scraper finished OK. Logs are in %REPO%\logs
) else (
  echo [done] Scraper exited with code %RC%. See the message above; full log in %REPO%\logs
)

if not defined UNATTENDED pause
exit /b %RC%

:norepo
echo.
echo [ERROR] This doesn't look like the ExtensionMiner repo.
echo         I looked here:  %REPO%
echo         ...but couldn't find requirements.txt and scraper\run.py.
echo.
echo         run_scraper.cmd has to stay INSIDE the repo's "scripts" folder.
echo         If you copied just this file out (e.g. to Downloads), move it back
echo         into your cloned ExtensionMiner\scripts\ folder - or pull the latest
echo         branch so it's already there - then double-click it from there.
echo.
echo         (You can delete any stray ".venv" folder this left in %CD%.)
if not defined UNATTENDED pause
exit /b 1

:fail
echo.
echo [ERROR] Setup failed - see the message above.
if not defined UNATTENDED pause
exit /b 1
