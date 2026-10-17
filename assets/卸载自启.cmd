@echo off
rem Undo auto-start: removes the per-user Run entry written by the install script.
rem Script CONTENT is ASCII on purpose; only the file NAME is Chinese.
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1" -Uninstall
rem Compare ERRORLEVEL as a string -- see the note in the install script.
if not "%ERRORLEVEL%"=="0" (
  echo.
  echo [FAILED] Could not remove auto-start. See the message above.
)

pause
