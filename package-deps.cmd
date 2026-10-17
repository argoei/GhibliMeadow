@echo off
rem Build the dependency distribution zip for GhibliMeadow.
rem Keep this file ASCII-only (non-ASCII in a .cmd gets mangled under Git Bash).
rem
rem Input : deps\windowsdesktop-runtime-8.0.32-win-x64.exe
rem         deps\MicrosoftEdgeWebview2Setup.exe
rem Output: release\GhibliMeadow-Deps-8.0.32-win-x64.zip
setlocal
cd /d "%~dp0"

set RT=deps\windowsdesktop-runtime-8.0.32-win-x64.exe
set WV2=deps\MicrosoftEdgeWebview2Setup.exe
set STAGE=release\deps-staging
set OUT=release\GhibliMeadow-Deps-8.0.32-win-x64.zip

if not exist "%RT%" (
  echo [FAILED] missing %RT%
  exit /b 1
)
if not exist "%WV2%" (
  echo [FAILED] missing %WV2%
  exit /b 1
)

if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%"

copy /y "%RT%" "%STAGE%\" >nul
copy /y "%WV2%" "%STAGE%\" >nul
copy /y "installer\install-deps.cmd" "%STAGE%\" >nul
copy /y "installer\README-deps.txt" "%STAGE%\" >nul

if exist "%OUT%" del /q "%OUT%"
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%OUT%' -Force"
if errorlevel 1 (
  echo [FAILED] packaging error
  exit /b 1
)

echo Done. Dependency package: %OUT%
