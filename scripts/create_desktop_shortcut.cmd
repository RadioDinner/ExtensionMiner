@echo off
setlocal EnableExtensions
REM ===========================================================================
REM  ExtensionMiner - put the run buttons on your Desktop
REM ---------------------------------------------------------------------------
REM  Run this ONCE. It creates two Desktop shortcuts pointing at the launchers in
REM  this folder:
REM    * "Run ExtensionMiner Scraper"  -> run_scraper.cmd  (scrape the store)
REM    * "Run ExtensionMiner Ranking"  -> run_ranker.cmd   (Claude opportunity
REM                                                          ranking)
REM  After that, just double-click the Desktop icons - you never have to open the
REM  repo folder again. (The shortcuts keep pointing at the real files in the
REM  repo, so they always run in the right place.)
REM ===========================================================================

set "WORKDIR=%~dp0"
set "SCRAPER=%~dp0run_scraper.cmd"
set "RANKER=%~dp0run_ranker.cmd"

if not exist "%SCRAPER%" (
  echo [ERROR] Can't find run_scraper.cmd next to this script.
  echo         Keep this file in the repo's scripts\ folder and run it from there.
  pause
  exit /b 1
)

echo Creating Desktop shortcuts...
echo   %SCRAPER%
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([System.IO.Path]::Combine($ws.SpecialFolders('Desktop'),'Run ExtensionMiner Scraper.lnk')); $lnk.TargetPath = '%SCRAPER%'; $lnk.WorkingDirectory = '%WORKDIR%'; $lnk.IconLocation = 'shell32.dll,137'; $lnk.Description = 'Run the ExtensionMiner Chrome Web Store scraper'; $lnk.Save()"
if errorlevel 1 (
  echo.
  echo [ERROR] Could not create the scraper shortcut.
  pause
  exit /b 1
)

if exist "%RANKER%" (
  echo   %RANKER%
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([System.IO.Path]::Combine($ws.SpecialFolders('Desktop'),'Run ExtensionMiner Ranking.lnk')); $lnk.TargetPath = '%RANKER%'; $lnk.WorkingDirectory = '%WORKDIR%'; $lnk.IconLocation = 'shell32.dll,43'; $lnk.Description = 'Run all ExtensionMiner Claude analysis (ranking + monetization)'; $lnk.Save()"
  if errorlevel 1 (
    echo.
    echo [WARN] Created the scraper shortcut but could not create the ranking one.
  )
) else (
  echo [WARN] run_ranker.cmd not found next to this script; skipping the ranking shortcut.
)

echo.
echo Done. Look on your Desktop for:
echo   "Run ExtensionMiner Scraper"  - scrape the Chrome Web Store
echo   "Run ExtensionMiner Ranking"  - all Claude analysis (ranking + monetization)
echo Double-click either any time - no need to open this folder.
echo.
pause
