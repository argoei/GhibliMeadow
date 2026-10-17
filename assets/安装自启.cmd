@echo off
rem Enable auto-start: writes a per-user Run entry so the wallpaper launches at sign-in.
rem The logic lives in autostart.ps1 next to this file -- see its header for why a Run key
rem is used instead of a Scheduled Task on this machine.
rem Script CONTENT is ASCII on purpose; only the file NAME is Chinese.
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1"
rem Compare ERRORLEVEL as a string: "if errorlevel 1" only inspects the low byte, so a
rem large exit code (e.g. the script host's 0xFFFF0000) would be misread as success.
if not "%ERRORLEVEL%"=="0" (
  echo.
  echo [FAILED] Could not enable auto-start. See the message above.
)

pause
