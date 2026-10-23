@echo off
rem Build the wallpaper, then pack dist into a single portable zip.
rem Script body is ASCII on purpose: a .cmd whose *content* has non-ASCII
rem gets mangled when it is launched from Git Bash (only the file NAME may be Chinese).
setlocal
cd /d "%~dp0"

call build.cmd
if errorlevel 1 (
  echo [FAILED] build error
  exit /b 1
)

set OUT=GhibliMeadow-v1.1.0-win-x64.zip
if exist "%OUT%" del /q "%OUT%"

rem Zip the CONTENTS of dist (not the dist folder itself), so unzipping
rem gives a ready-to-run folder instead of a nested one.
powershell -NoProfile -Command "Compress-Archive -Path 'dist\*' -DestinationPath '%OUT%' -Force"
if errorlevel 1 (
  echo [FAILED] packaging error
  exit /b 1
)

echo Done. Package: %OUT%
