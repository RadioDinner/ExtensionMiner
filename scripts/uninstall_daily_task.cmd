@echo off
setlocal EnableExtensions
REM Removes the daily scheduled task created by install_daily_task.cmd.

set "TASKNAME=ExtensionMiner Daily Scrape"

echo Removing scheduled task "%TASKNAME%" ...
schtasks /Delete /F /TN "%TASKNAME%"
if errorlevel 1 (
  echo.
  echo [note] The task may not exist, or you need to "Run as administrator".
)
echo.
pause
