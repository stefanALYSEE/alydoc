#!/bin/bash
# alyDoc - Outlook-Oeffner, Waechter fuer den Mac
#
# Gegenstueck zu tools/windows/alydoc-open-watcher.ps1. alyDoc legt beim Klick auf
# "In Outlook oeffnen" einen Auftrag per Dropbox-API an:
#   /APPS/alydoc-open-requests/<ms>-<zufall>.json   {"path":"/Ordner/Mail.eml","ts":1726...,"target":"mac"}
# Dieser Waechter sieht die Datei im Dropbox-Ordner des Macs, oeffnet die Mail in
# Outlook und loescht den Auftrag. Auftraege fuer andere Geraete (target != mac)
# bleiben liegen und werden erst nach einer Stunde als Muell entfernt.
#
# Start: launchd-Agent de.alysee.alydoc-open-watcher (siehe install-alydoc-open.sh)

MAX_AGE_SEC=120       # aeltere eigene Auftraege nicht mehr oeffnen (z. B. Mac war im Ruhezustand)
GARBAGE_SEC=3600      # Auftraege egal welchen Ziels nach 1 h entfernen
POLL_SEC=1
LOG_DIR="$HOME/Library/Logs/alyDoc"
LOG_FILE="$LOG_DIR/alydoc-open.log"
mkdir -p "$LOG_DIR"

log() { printf '%s  [mac-waechter] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"; }

# ── Dropbox-Wurzel finden ──
ROOT="$HOME/Library/CloudStorage/Dropbox-StefanHoffmann"
if [ ! -d "$ROOT" ]; then
  for d in "$HOME"/Library/CloudStorage/Dropbox*; do
    if [ -d "$d/APPS" ]; then ROOT="$d"; break; fi
  done
fi
QUEUE="$ROOT/APPS/alydoc-open-requests"

json_get() {  # json_get <datei> <schluessel>  -> Wert oder leer (plutil kann JSON seit macOS 12)
  /usr/bin/plutil -extract "$2" raw -o - "$1" 2>/dev/null
}

now_ms() { echo $(( $(date +%s) * 1000 )); }

file_age_sec() {  # Alter nach Aenderungsdatum
  echo $(( $(date +%s) - $(stat -f %m "$1" 2>/dev/null || date +%s) ))
}

open_mail() {  # open_mail <dropbox-pfad>
  local dbx="$1" rel local ext
  case "$dbx" in /*) ;; *) log "FEHLER: ungueltiger Pfad: $dbx"; return 1 ;; esac
  case "/$dbx/" in */../*|*/./*) log "FEHLER: ungueltiger Pfad: $dbx"; return 1 ;; esac
  ext=$(printf '%s' "${dbx##*.}" | tr '[:upper:]' '[:lower:]')
  if [ "$ext" != "eml" ] && [ "$ext" != "msg" ]; then log "FEHLER: nur .eml/.msg: $dbx"; return 1; fi
  rel="${dbx#/}"
  local="$ROOT/$rel"

  # frisch abgelegte Mails brauchen ggf. ein paar Sekunden bis zum Sync
  local i=0
  while [ ! -e "$local" ] && [ $i -lt 40 ]; do sleep 0.5; i=$((i+1)); done
  if [ ! -e "$local" ]; then
    log "FEHLER: Datei nicht vorhanden (Sync / selektive Synchronisierung?): $local"
    /usr/bin/osascript -e "display notification \"Mail ist auf diesem Mac nicht vorhanden – selektive Synchronisierung?\" with title \"alyDoc\"" >/dev/null 2>&1
    return 1
  fi

  if /usr/bin/open -a "Microsoft Outlook" "$local" 2>>"$LOG_FILE"; then
    log "OK: Outlook $local"
  else
    /usr/bin/open "$local" 2>>"$LOG_FILE" && log "OK (Standard-App, Outlook lehnte ab): $local" || log "FEHLER: konnte nicht oeffnen: $local"
  fi
}

log "gestartet, beobachte $QUEUE"
warned_access=0

while true; do
  if [ -d "$QUEUE" ]; then
    if ! ls "$QUEUE" >/dev/null 2>&1; then
      if [ $warned_access -eq 0 ]; then
        log "KEIN ZUGRIFF auf $QUEUE - Systemeinstellungen > Datenschutz & Sicherheit > Festplattenvollzugriff: /bin/bash erlauben"
        warned_access=1
      fi
    else
      warned_access=0
      for f in "$QUEUE"/*.json; do
        [ -e "$f" ] || continue
        path=$(json_get "$f" path)
        age_file=$(file_age_sec "$f")
        if [ -z "$path" ]; then
          # evtl. noch im Sync - erst nach 1 h als Muell entfernen
          if [ "$age_file" -gt $GARBAGE_SEC ]; then rm -f "$f" && log "entfernt (unlesbar/alt): ${f##*/}"; fi
          continue
        fi
        target=$(json_get "$f" target); [ -z "$target" ] && target="win"
        ts=$(json_get "$f" ts)
        if [ -n "$ts" ]; then age=$(( ( $(now_ms) - ${ts%.*} ) / 1000 )); else age=$age_file; fi

        if [ "$target" != "mac" ]; then
          if [ "$age" -gt $GARBAGE_SEC ]; then rm -f "$f" && log "entfernt (fremd+alt, $target): ${f##*/}"; fi
          continue
        fi

        rm -f "$f" || continue           # erst entfernen = nie doppelt oeffnen
        if [ "$age" -gt $MAX_AGE_SEC ]; then log "verworfen ($age s alt): $path"; continue; fi
        log "Auftrag: $path"
        open_mail "$path"
      done
    fi
  fi
  sleep $POLL_SEC
done
