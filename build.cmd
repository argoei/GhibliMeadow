@echo off
rem Rebuild: publish to dist and copy launcher scripts
setlocal
cd /d "%~dp0"
dotnet publish src\GhibliMeadow -c Release -o dist
if errorlevel 1 (
  echo [FAILED] build error
  exit /b 1
)
copy /y "assets\*.cmd" "dist\" >nul
rem autostart.ps1 is the logic behind the two auto-start .cmd wrappers.
copy /y "assets\*.ps1" "dist\" >nul
echo Done. Portable build is in dist\
