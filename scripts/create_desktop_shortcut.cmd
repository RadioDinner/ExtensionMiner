@echo off
setlocal EnableExtensions
REM ===========================================================================
REM  ExtensionMiner - put a "Run ExtensionMiner Scraper" button on your Desktop
REM ---------------------------------------------------------------------------
REM  Run this ONCE. It creates a Desktop shortcut that points at run_scraper.cmd
REM  in this folder. After that, just double-click the Desktop icon to run the
REM  scraper - you never have to open the repo folder again. (The shortcut keeps
REM  pointing at the real file in the repo, so it always runs in the right place.)
REM ===========================================================================

set "TARGET=%~dp0run_scraper.cmd"
set "WORKDIR=%~dp0"

if not exist "%TARGET%" (
  echo [ERROR] Can't find run_scraper.cmd next to this script.
  echo         Keep this file in the repo's scripts\ folder and run it from there.
  pause
  exit /b 1
)

echo Creating a Desktop shortcut to:
echo   %TARGET%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([System.IO.Path]::Combine($ws.SpecialFolders('Desktop'),'Run ExtensionMiner Scraper.lnk')); $lnk.TargetPath = '%TARGET%'; $lnk.WorkingDirectory = '%WORKDIR%'; $lnk.IconLocation = 'shell32.dll,137'; $lnk.Description = 'Run the ExtensionMiner Chrome Web Store scraper'; $lnk.Save()"

if errorlevel 1 (
  echo.
  echo [ERROR] Could not create the shortcut.
  pause
  exit /b 1
)

echo Done. Look for "Run ExtensionMiner Scraper" on your Desktop.
echo Double-click it any time to run the scraper - no need to open this folder.
echo.
pause
