# alyDoc - lokaler Outlook-Oeffner (URL-Protokoll alydoc-open:)
#
# Wie ELOoffice: eine abgelegte Mail wird nicht im Browser nachgebaut, sondern
# direkt in Outlook geoeffnet - dort stehen Antworten, Allen antworten,
# Weiterleiten usw. vollstaendig zur Verfuegung.
#
# Aufruf (durch den Browser):  alydoc-open:?p=<URL-kodierter Dropbox-Pfad>
# Beispiel:                    alydoc-open:?p=%2FPostbox%20alysee%2FTest.eml
#
# Der Dropbox-Pfad wird auf die lokal synchronisierte Datei unter $Root
# abgebildet. Erlaubt sind nur .eml und .msg innerhalb von $Root.
# Datei ist bewusst reines ASCII (PowerShell 5.1 liest .ps1 ohne BOM als ANSI).

param([string]$Url = '')

$ErrorActionPreference = 'Stop'

$Root    = 'D:\alysee Dropbox'   # Junction auf D:\Stefan Hoffmann Dropbox
$WaitSec = 20                    # frisch abgelegte Mails brauchen ein paar Sekunden bis zum lokalen Sync
$LogDir  = Join-Path $env:LOCALAPPDATA 'alyDoc'
$LogFile = Join-Path $LogDir 'alydoc-open.log'

function Write-Log([string]$msg) {
    try {
        if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
        Add-Content -Path $LogFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg) -Encoding UTF8
    } catch {}
}

function Fail([string]$msg) {
    Write-Log ('FEHLER: ' + $msg + '  | URL=' + $Url)
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($msg, 'alyDoc - In Outlook oeffnen', 'OK', 'Warning') | Out-Null
    exit 1
}

# ── URL zerlegen ──
$query = $Url -replace '^alydoc-open:/*', ''
$query = $query.TrimStart('?')
$dbxPath = $null
foreach ($pair in ($query -split '&')) {
    $kv = $pair -split '=', 2
    if ($kv.Count -eq 2 -and $kv[0] -eq 'p') { $dbxPath = [uri]::UnescapeDataString($kv[1]) }
}
if (-not $dbxPath) { Fail 'Kein Dateipfad uebergeben.' }

# ── Pfad pruefen ──
if (-not $dbxPath.StartsWith('/')) { Fail ('Ungueltiger Dropbox-Pfad: ' + $dbxPath) }
$segments = $dbxPath.TrimStart('/') -split '/'
if ($segments -contains '..' -or $segments -contains '.') { Fail ('Ungueltiger Dropbox-Pfad: ' + $dbxPath) }

$ext = [System.IO.Path]::GetExtension($dbxPath).ToLowerInvariant()
if ($ext -ne '.eml' -and $ext -ne '.msg') { Fail ('Nur .eml und .msg koennen in Outlook geoeffnet werden: ' + $dbxPath) }

$local = [System.IO.Path]::GetFullPath((Join-Path $Root ($segments -join '\')))
if (-not $local.StartsWith($Root.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail ('Pfad liegt ausserhalb der Dropbox: ' + $local)
}

# ── auf lokalen Sync warten ──
$deadline = (Get-Date).AddSeconds($WaitSec)
while (-not (Test-Path -LiteralPath $local -PathType Leaf)) {
    if ((Get-Date) -gt $deadline) {
        Fail ("Die Datei ist auf diesem Rechner nicht vorhanden:`n`n" + $local +
              "`n`nMoegliche Ursachen: Dropbox synchronisiert noch, oder der Ordner ist per selektiver " +
              "Synchronisierung abgewaehlt. In alyDoc kann die Mail stattdessen heruntergeladen werden.")
    }
    Start-Sleep -Milliseconds 500
}

# ── Outlook finden und oeffnen ──
$outlook = $null
try { $outlook = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\OUTLOOK.EXE').'(default)' } catch {}
if (-not $outlook -or -not (Test-Path -LiteralPath $outlook)) { Fail 'Outlook (klassisch) wurde nicht gefunden.' }

$switch = if ($ext -eq '.eml') { '/eml' } else { '/f' }
Write-Log ('OK: ' + $switch + ' ' + $local)
Start-Process -FilePath $outlook -ArgumentList @($switch, ('"' + $local + '"'))
