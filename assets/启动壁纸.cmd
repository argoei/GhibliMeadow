@echo off
rem GhibliMeadow wallpaper launcher
cd /d "%~dp0"
if not exist "GhibliMeadow.exe" (
  echo [ERROR] GhibliMeadow.exe not found in this folder.
  pause
  exit /b 1
)
start "" "GhibliMeadow.exe"
exit /b 0
