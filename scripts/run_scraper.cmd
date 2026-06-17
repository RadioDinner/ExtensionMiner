@echo off
setlocal EnableExtensions
REM ===========================================================================
REM  ExtensionMiner - one-click scraper launcher (Windows)
REM ---------------------------------------------------------------------------
REM  Double-click this file to run the scraper now. The Windows scheduled task
REM  created by install_daily_task.cmd also calls it (with the "unattended" arg)
REM  every day.
REM
REM  First run is slow: it creates a private .venv, installs the Python
REM  dependencies, and downloads the Chromium browser. After that it's quick.
REM  Nothing here depends on PowerShell or an activated environment, so it works
REM  the same whether you double-click it or Task Scheduler runs it.
REM ===========================================================================

REM "unattended" (passed by the scheduled task) means: don't pause at the end.
set "UNATTENDED="
if /i "%~1"=="unattended" set "UNATTENDED=1"

REM --- Move to the repo root (this script lives in scripts\) ------------------
cd /d "%~dp0.." || goto :fail
set "REPO=%CD%"

REM --- Sanity check: are we actually inside the ExtensionMiner repo? ----------
REM  The launcher must live in the repo's scripts\ folder. If someone copies
REM  just this .cmd somewhere else (e.g. Downloads), bail out NOW with a clear
REM  message instead of half-building a venv in the wrong place.
if not exist "%REPO%\requirements.txt" goto :norepo
if not exist "%REPO%\scraper\run.py"   goto :norepo

REM ===========================================================================
REM  EDITABLE KNOBS - change RUN_ARGS if you want different behavior.
REM  Default = the "daily" preset: a full refresh crawl of the categories in
REM  your .env (TARGET_CATEGORIES). Upserts dedupe, so an extension already in
REM  the database only gains its NEW reviews and otherwise moves on.
REM
REM  Other examples:
REM    set "RUN_ARGS=--preset daily --categories productivity --log-dir logs"
REM    set "RUN_ARGS=--max-extensions 5 --no-db --log-dir logs"   (quick dry test)
REM ===========================================================================
set "RUN_ARGS=--preset daily --log-dir logs"

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
if not exist "%STAMP%" (
  echo [setup] Installing Python dependencies ^(first run - a few minutes^) ...
  "%VPY%" -m pip install --upgrade pip || goto :fail
  "%VPY%" -m pip install -r "%REPO%\requirements.txt" || goto :fail
  echo [setup] Downloading the Chromium browser for Playwright ...
  "%VPY%" -m playwright install chromium || goto :fail
  > "%STAMP%" echo ok
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
