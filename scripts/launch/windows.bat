@echo off
REM Temple Lapsai - double-click this file to play.
REM It starts the little local server and opens the game in your browser.
REM Closing this window stops the game.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Temple Lapsai needs Node.js to run, and it is not installed.
  echo Install the LTS build from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if "%PORT%"=="" set PORT=8080
echo Starting Temple Lapsai on http://localhost:%PORT% ...
start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"
node server.js
pause
