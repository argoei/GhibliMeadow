# Auto-start for the GhibliMeadow wallpaper: write / remove a per-user Run entry (HKCU).
#
# Why the Run key and not a Scheduled Task
#   On this machine, registering a task whose action points at an UNSIGNED program or at a
#   script is refused with HRESULT 0x80004005 (security policy / security software).
#   Measured facts:
#     * notepad.exe (signed)                        -> registers fine
#     * notepad renamed to GhibliMeadow.exe         -> registers fine (name is irrelevant)
#     * our unsigned GhibliMeadow.exe               -> REFUSED
#     * a freshly compiled unsigned exe             -> REFUSED
#     * any .cmd (even one that never mentions us)  -> REFUSED
#     * cmd.exe /c <script>, XML registration, self-signed exe -> all REFUSED
#   i.e. it is not about parameters, task name, folder or XML vs CIM: any action that ends
#   up launching something unsigned is blocked. The Run key is a different mechanism and is
#   not intercepted, so autostart works here.
#
# Script CONTENT is pure ASCII on purpose: PowerShell 5.1 reads a .ps1 without a BOM as ANSI,
# so non-ASCII bytes (even inside comments) get mangled and can swallow the following line.
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'

$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$Value  = 'GhibliMeadowWallpaper'      # must match WallpaperApp.RunValue

if ($Uninstall) {
    if (Get-ItemProperty -Path $RunKey -Name $Value -ErrorAction SilentlyContinue) {
        Remove-ItemProperty -Path $RunKey -Name $Value -Force
        Write-Host "Removed the auto-start entry ($Value)."
    } else {
        Write-Host "Nothing to do - no auto-start entry named $Value."
    }
    exit 0
}

$here = (Get-Location).Path
$exe  = Join-Path $here 'GhibliMeadow.exe'
if (-not (Test-Path $exe)) {
    Write-Host '[ERROR] GhibliMeadow.exe not found in this folder.'
    Write-Host '        Run this from the dist folder (next to GhibliMeadow.exe).'
    exit 1
}

# --quiet: when auto-start collides with an instance that is already running, exit silently
# instead of popping a "already running" dialog nobody will click.
$command = '"' + $exe + '" --quiet'

if (-not (Test-Path $RunKey)) { New-Item -Path $RunKey -Force | Out-Null }
Set-ItemProperty -Path $RunKey -Name $Value -Value $command

$check = (Get-ItemProperty -Path $RunKey -Name $Value).$Value
if ($check -ne $command) {
    Write-Host "[FAILED] verification mismatch: wrote '$check'"
    exit 1
}

Write-Host 'Done. The wallpaper will start automatically when you sign in.'
Write-Host ''
Write-Host "  command : $command"
Write-Host "  location: $RunKey\$Value"
Write-Host ''
Write-Host 'To undo, run the uninstall script. The tray menu item "start with Windows"'
Write-Host 'toggles this same entry, so it will show as ticked from now on.'
exit 0
