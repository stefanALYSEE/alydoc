#!/bin/bash
# alyDoc - Outlook-Oeffner (Mac, direkter Weg)
#
# Wird von der App "alyDoc Oeffner" aufgerufen, wenn der Browser einen Link
#   alydoc-open:?p=<url-kodierter Dropbox-Pfad>
# oeffnet. Ersetzt auf dem Mac den Umweg ueber Auftragsdateien in der Dropbox:
# die kamen per Dropbox-Sync erst nach 3-4 Minuten an (gemessen 2026-10-20).
#
#   alydoc-open-url.sh 'alydoc-open:?p=%2FOrdner%2FMail.eml'

LOG_DIR="$HOME/Library/Logs/alyDoc"
LOG_FILE="$LOG_DIR/alydoc-open.log"
mkdir -p "$LOG_DIR"
log() { printf '%s  [mac-link] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"; }
notify() { /usr/bin/osascript -e "display notification \"$1\" with title \"alyDoc\"" >/dev/null 2>&1; }

ROOT="$HOME/Library/CloudStorage/Dropbox-StefanHoffmann"
if [ ! -d "$ROOT" ]; then
  for d in "$HOME"/Library/CloudStorage/Dropbox*; do
    if [ -d "$d/APPS" ]; then ROOT="$d"; break; fi
  done
fi

url="$1"
q="${url#*\?}"                      # alles nach dem ?
p=""
IFS='&' read -r -a parts <<< "$q"
for kv in "${parts[@]}"; do
  case "$kv" in p=*) p="${kv#p=}" ;; esac
done
# URL-Dekodierung: + -> Leerzeichen, %XX -> Byte
p="${p//+/ }"
# %XX per sed in \xXX wandeln (Ersetzung in ${..//..} behandelt \ je nach bash-Version anders)
dbx=$(printf '%b' "$(printf '%s' "$p" | /usr/bin/sed 's/%/\\x/g')")

case "$dbx" in /*) ;; *) log "FEHLER: ungueltiger Pfad: $dbx"; exit 1 ;; esac
case "/$dbx/" in */../*|*/./*) log "FEHLER: ungueltiger Pfad: $dbx"; exit 1 ;; esac
ext=$(printf '%s' "${dbx##*.}" | tr '[:upper:]' '[:lower:]')
if [ "$ext" != "eml" ] && [ "$ext" != "msg" ]; then log "FEHLER: nur .eml/.msg: $dbx"; exit 1; fi

local_path="$ROOT/${dbx#/}"
log "Link: $dbx"

# Frisch abgelegte Mails sind ggf. noch nicht im Ordnerbaum angekommen
i=0
while [ ! -e "$local_path" ] && [ $i -lt 30 ]; do sleep 0.5; i=$((i+1)); done
if [ ! -e "$local_path" ]; then
  log "FEHLER: Datei nicht vorhanden: $local_path"
  notify "Mail ist auf diesem Mac (noch) nicht vorhanden – Dropbox synchronisiert?"
  exit 1
fi

# Nur-online-Datei: Outlook loest den Download selbst aus (Vordergrund-Zugriff, schnell)
if /usr/bin/open -a "Microsoft Outlook" "$local_path" 2>>"$LOG_FILE"; then
  log "OK: Outlook $local_path"
else
  /usr/bin/open "$local_path" 2>>"$LOG_FILE" && log "OK (Standard-App): $local_path" || { log "FEHLER: konnte nicht oeffnen: $local_path"; notify "Mail konnte nicht geöffnet werden"; }
fi
