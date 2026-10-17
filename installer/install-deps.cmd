@echo off
rem GhibliMeadow runtime dependency installer.
rem Installs .NET 8 Desktop Runtime and Edge WebView2 Runtime silently.
rem Keep this file ASCII-only.
setlocal
cd /d "%~dp0"

echo ============================================
echo  GhibliMeadow - runtime dependencies
echo ============================================
echo.

echo [1/2] .NET 8 Desktop Runtime 8.0.32 (x64)
if exist "windowsdesktop-runtime-8.0.32-win-x64.exe" (
  "windowsdesktop-runtime-8.0.32-win-x64.exe" /install /quiet /norestart
  echo   exit code: %ERRORLEVEL%
) else (
  echo   MISSING: windowsdesktop-runtime-8.0.32-win-x64.exe
)
echo.

echo [2/2] Microsoft Edge WebView2 Runtime
if exist "MicrosoftEdgeWebview2Setup.exe" (
  "MicrosoftEdgeWebview2Setup.exe" /silent /install
  echo   exit code: %ERRORLEVEL%
) else (
  echo   MISSING: MicrosoftEdgeWebview2Setup.exe
)
echo.

echo Done. Now run GhibliMeadow-Setup-1.0.0.exe
echo If the runtime was just installed, a reboot may be required.
pause
