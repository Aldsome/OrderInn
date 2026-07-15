@echo off
setlocal
cd /d "%~dp0"

set PORT=8000

echo Starting OrderInn on http://localhost:%PORT%/index.html
start "" "http://localhost:%PORT%/index.html"

python -m http.server %PORT%
if errorlevel 1 (
    echo.
    echo Python not found on PATH. Install Python or run this from a shell where "python" works.
    pause
)

endlocal
