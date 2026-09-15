# alyDoc - Outlook-Oeffner installieren / entfernen (nur aktueller Benutzer, keine Adminrechte)
#
#   powershell -ExecutionPolicy Bypass -File install-alydoc-open.ps1            # installieren
#   powershell -ExecutionPolicy Bypass -File install-alydoc-open.ps1 -Uninstall # entfernen
#
# Was passiert:
#   1. alydoc-open.ps1 (Oeffner) + alydoc-open-watcher.ps1 (Waechter) nach %LOCALAPPDATA%\alyDoc
#   2. URL-Protokoll alydoc-open: unter HKCU\Software\Classes (Direktaufruf, z. B. aus Explorer/Skripten)
#   3. Waechter per HKCU-Run-Eintrag beim Anmelden starten + sofort starten.
#      Der Waechter oeffnet Mails, die alyDoc als Auftrag nach /APPS/alyDOC/open-requests legt.
#      (Chrome gab alydoc-open: auf dem Precision nicht an Windows weiter - daher dieser Weg.)
#   4. alyDoc mit ?nativeopen=1 im Standardbrowser oeffnen -> Funktion dort einschalten

param([switch]$Uninstall, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'

$Proto    = 'alydoc-open'
$KeyPath  = "HKCU:\Software\Classes\$Proto"
$RunKey   = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunName  = 'alyDoc-Outlook-Oeffner'
$Target   = Join-Path $env:LOCALAPPDATA 'alyDoc'
$Script   = Join-Path $Target 'alydoc-open.ps1'
$Watcher  = Join-Path $Target 'alydoc-open-watcher.ps1'
$AppUrl   = 'https://alydoc.alysee.de/'
$conhost  = Join-Path $env:WINDIR 'System32\conhost.exe'
$ps       = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Stop-Watcher {
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object { $_.CommandLine -match 'alydoc-open-watcher\.ps1' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Uninstall) {
    Stop-Watcher
    if (Test-Path $KeyPath) { Remove-Item -Path $KeyPath -Recurse -Force }
    Remove-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue
    foreach ($f in $Script, $Watcher) { if (Test-Path $f) { Remove-Item -Path $f -Force } }
    Write-Host 'alydoc-open: entfernt.'
    if (-not $NoBrowser) { Start-Process ($AppUrl + '?nativeopen=0') }
    exit 0
}

foreach ($name in 'alydoc-open.ps1', 'alydoc-open-watcher.ps1') {
    if (-not (Test-Path (Join-Path $PSScriptRoot $name))) { throw "Datei nicht gefunden: $name" }
}

New-Item -ItemType Directory -Path $Target -Force | Out-Null
Stop-Watcher
Copy-Item -Path (Join-Path $PSScriptRoot 'alydoc-open.ps1') -Destination $Script -Force
Copy-Item -Path (Join-Path $PSScriptRoot 'alydoc-open-watcher.ps1') -Destination $Watcher -Force

# URL-Protokoll
$command = '"' + $conhost + '" --headless "' + $ps + '" -NoProfile -ExecutionPolicy Bypass -File "' + $Script + '" "%1"'
New-Item -Path $KeyPath -Force | Out-Null
Set-ItemProperty -Path $KeyPath -Name '(default)' -Value 'URL:alyDoc Outlook-Oeffner'
Set-ItemProperty -Path $KeyPath -Name 'URL Protocol' -Value ''
New-Item -Path "$KeyPath\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$KeyPath\shell\open\command" -Name '(default)' -Value $command

# Waechter: Autostart + sofort starten (unsichtbar)
$watchCmd = '"' + $conhost + '" --headless "' + $ps + '" -NoProfile -ExecutionPolicy Bypass -File "' + $Watcher + '"'
Set-ItemProperty -Path $RunKey -Name $RunName -Value $watchCmd
Start-Process -FilePath $conhost -ArgumentList @('--headless', ('"' + $ps + '"'), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $Watcher + '"'))

Write-Host 'alydoc-open: installiert.'
Write-Host "  Oeffner  : $Script"
Write-Host "  Waechter : $Watcher (Autostart: HKCU Run '$RunName')"

if (-not $NoBrowser) { Start-Process ($AppUrl + '?nativeopen=1') }
