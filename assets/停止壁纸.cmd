@echo off
rem Stop GhibliMeadow wallpaper
taskkill /IM GhibliMeadow.exe /F >nul 2>&1
if errorlevel 1 (
  echo GhibliMeadow is not running.
) else (
  echo Stopped. Desktop background restored.
)
