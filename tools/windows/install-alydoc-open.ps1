# alyDoc - Outlook-Oeffner installieren / entfernen (nur aktueller Benutzer, keine Adminrechte)
#
#   powershell -ExecutionPolicy Bypass -File install-alydoc-open.ps1            # installieren
#   powershell -ExecutionPolicy Bypass -File install-alydoc-open.ps1 -Uninstall # entfernen
#
# Was passiert:
#   1. alydoc-open.ps1 (Oeffner) + alydoc-open-watcher.ps1 (Waechter) nach %USERPROFILE%\Scripts\alyDoc
#   2. URL-Protokoll alydoc-open: unter HKCU\Software\Classes (Direktaufruf, z. B. aus Explorer/Skripten)
#   3. Waechter per Aufgabenplanung beim Anmelden starten, zusaetzlich alle 15 Min nachstarten
#      (Selbstheilung; doppelte Instanzen beendet der Mutex im Waechter sofort) + sofort starten.
#      Der Waechter oeffnet Mails, die alyDoc als Auftrag nach /APPS/alydoc-open-requests legt.
#   4. alyDoc mit ?nativeopen=1 im Standardbrowser oeffnen -> Funktion dort einschalten
#
# WICHTIG - NICHT aus einer verpackten App heraus starten (Claude Desktop, Store-Apps):
#   Solche Apps bekommen ein virtualisiertes %LOCALAPPDATA% und eine virtualisierte HKCU. Am 2026-09-15
#   landeten Dateien und Registry-Eintraege dadurch unsichtbar unter
#   %LOCALAPPDATA%\Packages\<App>\LocalCache\Local\alyDoc. Windows sah beim Anmelden nichts: der
#   Waechter startete nach dem naechsten Neustart nicht mehr und alydoc-open: war nie registriert.
#   Deshalb liegt das Ziel jetzt unter %USERPROFILE%\Scripts, und der Installer prueft die Umleitung.

param([switch]$Uninstall, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'

$Proto    = 'alydoc-open'
$KeyPath  = "HKCU:\Software\Classes\$Proto"
$RunKey   = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunName  = 'alyDoc-Outlook-Oeffner'   # Altlast aus der Run-Key-Zeit, wird entfernt
$TaskName = 'alyDoc Outlook-Oeffner'
$Target   = Join-Path $env:USERPROFILE 'Scripts\alyDoc'
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
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    foreach ($f in $Script, $Watcher) { if (Test-Path $f) { Remove-Item -Path $f -Force } }
    Write-Host 'alydoc-open: entfernt.'
    if (-not $NoBrowser) { Start-Process ($AppUrl + '?nativeopen=0') }
    exit 0
}

foreach ($name in 'alydoc-open.ps1', 'alydoc-open-watcher.ps1') {
    if (-not (Test-Path (Join-Path $PSScriptRoot $name))) { throw "Datei nicht gefunden: $name" }
}

New-Item -ItemType Directory -Path $Target -Force | Out-Null

# Laeuft der Installer in einer verpackten App (Claude Desktop, Store-App), wird der Zielordner
# umgeleitet. Alles, was danach folgt, waere fuer Windows unsichtbar - dann lieber abbrechen.
$redirect = (Get-Item -LiteralPath $Target -Force).Target
if ($redirect) {
    throw ("Der Zielordner wird umgeleitet nach: $redirect`n" +
           "Der Installer laeuft offenbar in einer verpackten App (Claude Desktop, Store-App).`n" +
           "Bitte in einem normalen PowerShell-Fenster (Win+X -> Terminal) erneut ausfuehren.")
}

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

# Waechter: Autostart per Aufgabenplanung. Der frühere HKCU-Run-Eintrag hat nicht getragen (siehe Kopf)
# und wird entfernt. Zweiter Ausloeser alle 15 Min = Selbstheilung, falls der Waechter einmal stirbt;
# eine zweite Instanz beendet sich sofort ueber den Mutex im Waechter.
Remove-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue

$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Startet den alyDoc-Waechter (In Outlook oeffnen).</Description></RegistrationInfo>
  <Principals><Principal id="Author"><UserId>$env:USERDOMAIN\$env:USERNAME</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle><WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>P30D</ExecutionTimeLimit><Priority>7</Priority>
  </Settings>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$env:USERDOMAIN\$env:USERNAME</UserId></LogonTrigger>
    <TimeTrigger><Enabled>true</Enabled><StartBoundary>2026-01-01T00:05:00</StartBoundary><Repetition><Interval>PT15M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></TimeTrigger>
  </Triggers>
  <Actions Context="Author"><Exec><Command>$ps</Command><Arguments>-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$Watcher"</Arguments></Exec></Actions>
</Task>
"@
Register-ScheduledTask -TaskName $TaskName -Xml $taskXml -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host 'alydoc-open: installiert.'
Write-Host "  Oeffner  : $Script"
Write-Host "  Waechter : $Watcher (Autostart: Aufgabenplanung '$TaskName')"

if (-not $NoBrowser) { Start-Process ($AppUrl + '?nativeopen=1') }
