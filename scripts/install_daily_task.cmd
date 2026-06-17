@echo off
setlocal EnableExtensions
REM ===========================================================================
REM  ExtensionMiner - register the daily scheduled task (Windows)
REM ---------------------------------------------------------------------------
REM  Double-click this ONCE to make Windows run the scraper every day. It calls
REM  run_scraper.cmd (in this same folder) with the "unattended" flag so it
REM  won't pause waiting for a keypress.
REM
REM  By default the task runs only while you are logged in. To run it whether or
REM  not you're logged on, see docs\RUNNING_THE_SCRAPER.md ("run when logged off").
REM ===========================================================================

set "TASKNAME=ExtensionMiner Daily Scrape"

REM --- EDIT THIS: 24-hour HH:MM start time for the daily run ------------------
set "RUNTIME=03:00"

set "SCRIPT=%~dp0run_scraper.cmd"

echo Creating daily task "%TASKNAME%" to run at %RUNTIME% ...
echo   command: "%SCRIPT%" unattended
echo.
schtasks /Create /F /TN "%TASKNAME%" /SC DAILY /ST %RUNTIME% /TR "\"%SCRIPT%\" unattended"
if errorlevel 1 (
  echo.
  echo [ERROR] Could not create the scheduled task.
  echo         If it says "Access is denied", right-click this file and choose
  echo         "Run as administrator", then try again.
  pause
  exit /b 1
)

echo.
echo Done. The scraper will run every day at %RUNTIME%.
echo.
echo   View it:    schtasks /Query  /TN "%TASKNAME%" /V /FO LIST
echo   Run now:    schtasks /Run    /TN "%TASKNAME%"
echo   Remove it:  double-click uninstall_daily_task.cmd
echo.
pause
