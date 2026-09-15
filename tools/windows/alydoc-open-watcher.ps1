# alyDoc - Outlook-Oeffner, Waechter-Variante (unabhaengig von Chrome)
#
# Hintergrund: Chrome gab den Link alydoc-open: auf dem Precision nicht an Windows
# weiter (kein Dialog, kein Aufruf - Ursache in Chrome nicht sichtbar zu machen).
# Deshalb schreibt alyDoc beim Klick eine kleine Auftragsdatei per Dropbox-API nach
#   /APPS/alyDoc/open-requests/<zeitstempel>-<zufall>.json   {"path": "/Ordner/Mail.eml", "ts": 1726...}
# Dieser Waechter sieht die Datei nach dem Dropbox-Sync, oeffnet die Mail ueber den
# bestehenden Oeffner alydoc-open.ps1 in Outlook und loescht den Auftrag.
#
# Start: unsichtbar per HKCU-Run-Eintrag beim Anmelden (siehe install-alydoc-open.ps1).
# Datei ist bewusst reines ASCII (PowerShell 5.1 liest .ps1 ohne BOM als ANSI).

$ErrorActionPreference = 'Continue'

$Root       = 'D:\alysee Dropbox'
# Normaler Ordner, KEIN geteilter Mount: /APPS/alyDOC ist ein eingehaengter geteilter Ordner, der auf dem
# Precision nicht synchronisiert (Test 2026-09-15: Cloud-Datei kam nach 60 s nicht an).
$QueueDir   = Join-Path $Root 'APPS\alydoc-open-requests'
$Handler    = Join-Path $PSScriptRoot 'alydoc-open.ps1'
$MaxAgeSec  = 120      # aeltere Auftraege (z. B. nach Neustart) nicht mehr ausfuehren
$GarbageSec = 3600     # Auftraege egal welchen Ziels (auch Mac) nach 1 h entfernen
$PollMs     = 700
$LogDir     = Join-Path $env:LOCALAPPDATA 'alyDoc'
$LogFile    = Join-Path $LogDir 'alydoc-open.log'

function Write-Log([string]$msg) {
    try {
        if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
        Add-Content -Path $LogFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  [waechter] ' + $msg) -Encoding UTF8
    } catch {}
}

# Nur eine Instanz: benannter Mutex pro Benutzer
$mutex = New-Object System.Threading.Mutex($false, 'Local\alydoc-open-watcher')
if (-not $mutex.WaitOne(0)) { exit 0 }

if (-not (Test-Path $QueueDir)) { New-Item -ItemType Directory -Path $QueueDir -Force | Out-Null }
Write-Log ('gestartet, beobachte ' + $QueueDir)

function Remove-Request([System.IO.FileInfo]$file, [string]$why) {
    try {
        Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
        if ($why) { Write-Log ('entfernt (' + $why + '): ' + $file.Name) }
        return $true
    } catch { return $false }
}

function Invoke-Request([System.IO.FileInfo]$file) {
    # Dropbox legt Dateien waehrend des Syncs ggf. unter temporaerem Namen an - nur fertige .json
    if ($file.Extension -ne '.json') { return }
    $ageFile = ((Get-Date) - $file.LastWriteTime).TotalSeconds

    # Erst lesen und pruefen, dann loeschen: Auftraege fuer den Mac muessen liegen bleiben.
    $raw = $null
    try { $raw = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8) } catch { return }
    $req = $null
    try { $req = $raw | ConvertFrom-Json } catch {}
    if (-not $req -or -not $req.path) {
        if ($ageFile -gt $GarbageSec) { Remove-Request $file 'unlesbar/alt' | Out-Null }   # evtl. noch im Sync
        return
    }

    $target = if ($req.target) { [string]$req.target } else { 'win' }   # Altauftraege ohne Ziel = Precision
    $ageSec = if ($req.ts) { ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [double]$req.ts) / 1000 } else { $ageFile }

    if ($target -ne 'win') {
        if ($ageSec -gt $GarbageSec) { Remove-Request $file ('fremd+alt, ' + $target) | Out-Null }
        return
    }

    if (-not (Remove-Request $file '')) { return }   # erst entfernen = nie doppelt oeffnen
    if ($ageSec -gt $MaxAgeSec) { Write-Log ('verworfen (' + [int]$ageSec + ' s alt): ' + $req.path); return }

    $url = 'alydoc-open:?p=' + [uri]::EscapeDataString([string]$req.path)
    Write-Log ('Auftrag: ' + $req.path)
    $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Start-Process -FilePath $ps -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $Handler + '"'), ('"' + $url + '"'))
}

while ($true) {
    try {
        Get-ChildItem -LiteralPath $QueueDir -File -Filter '*.json' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime |
            ForEach-Object { Invoke-Request $_ }
    } catch { Write-Log ('Fehler: ' + $_.Exception.Message) }
    Start-Sleep -Milliseconds $PollMs
}
