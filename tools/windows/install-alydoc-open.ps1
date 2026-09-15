# alyDoc - Outlook-Oeffner installieren / entfernen (nur aktueller Benutzer, keine Adminrechte)
#
#   powershell -ExecutionPolicy Bypass -File install-alydoc-open.ps1            # installieren
#   powershell -ExecutionPolicy Bypass -File install-alydoc-open.ps1 -Uninstall # entfernen
#
# Was passiert:
#   1. alydoc-open.ps1 wird nach %LOCALAPPDATA%\alyDoc kopiert
#   2. URL-Protokoll alydoc-open: wird unter HKCU\Software\Classes registriert
#      (Start ueber conhost --headless -> kein aufblitzendes Konsolenfenster)
#   3. alyDoc wird mit ?nativeopen=1 im Standardbrowser geoeffnet -> schaltet dort
#      "In Outlook oeffnen" auf den lokalen Oeffner um (Einstellung pro Browser)

param([switch]$Uninstall, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'

$Proto   = 'alydoc-open'
$KeyPath = "HKCU:\Software\Classes\$Proto"
$Target  = Join-Path $env:LOCALAPPDATA 'alyDoc'
$Script  = Join-Path $Target 'alydoc-open.ps1'
$AppUrl  = 'https://alydoc.alysee.de/'

if ($Uninstall) {
    if (Test-Path $KeyPath) { Remove-Item -Path $KeyPath -Recurse -Force }
    if (Test-Path $Script)  { Remove-Item -Path $Script -Force }
    Write-Host 'alydoc-open: entfernt.'
    if (-not $NoBrowser) { Start-Process ($AppUrl + '?nativeopen=0') }
    exit 0
}

$source = Join-Path $PSScriptRoot 'alydoc-open.ps1'
if (-not (Test-Path $source)) { throw "Handler nicht gefunden: $source" }

New-Item -ItemType Directory -Path $Target -Force | Out-Null
Copy-Item -Path $source -Destination $Script -Force

$conhost = Join-Path $env:WINDIR 'System32\conhost.exe'
$ps      = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$command = '"' + $conhost + '" --headless "' + $ps + '" -NoProfile -ExecutionPolicy Bypass -File "' + $Script + '" "%1"'

New-Item -Path $KeyPath -Force | Out-Null
Set-ItemProperty -Path $KeyPath -Name '(default)' -Value 'URL:alyDoc Outlook-Oeffner'
Set-ItemProperty -Path $KeyPath -Name 'URL Protocol' -Value ''
New-Item -Path "$KeyPath\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$KeyPath\shell\open\command" -Name '(default)' -Value $command

Write-Host "alydoc-open: installiert."
Write-Host "  Handler : $Script"
Write-Host "  Befehl  : $command"

if (-not $NoBrowser) { Start-Process ($AppUrl + '?nativeopen=1') }
