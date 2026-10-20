#!/bin/bash
# alyDoc - Outlook-Oeffner auf dem Mac installieren / entfernen (nur aktueller Benutzer, kein sudo)
#
#   bash tools/mac/install-alydoc-open.sh              # installieren
#   bash tools/mac/install-alydoc-open.sh --uninstall  # entfernen
#
# Was passiert:
#   1. alydoc-open-watcher.sh nach ~/Library/Application Support/alyDoc
#   2. launchd-Agent ~/Library/LaunchAgents/de.alysee.alydoc-open-watcher.plist (Start bei Anmeldung, Neustart bei Absturz)
#   3. alyDoc mit ?nativeopen=1 im Standardbrowser oeffnen -> Funktion in diesem Browser einschalten
#      (Chrome UND Safari getrennt, falls beide genutzt werden - dann die URL im zweiten Browser selbst aufrufen)

set -e

LABEL="de.alysee.alydoc-open-watcher"
TARGET_DIR="$HOME/Library/Application Support/alyDoc"
SCRIPT="$TARGET_DIR/alydoc-open-watcher.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/alyDoc/alydoc-open.log"
APP_URL="https://alydoc.alysee.de/"
DOMAIN="gui/$(id -u)"

if [ "$1" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST" "$SCRIPT" "$TARGET_DIR/alydoc-open-url.sh"
  rm -rf "$HOME/Applications/alyDoc Oeffner.app"
  echo "alydoc-open: entfernt."
  open "${APP_URL}?nativeopen=0"
  exit 0
fi

SRC="$(cd "$(dirname "$0")" && pwd)/alydoc-open-watcher.sh"
[ -f "$SRC" ] || { echo "Waechter nicht gefunden: $SRC"; exit 1; }

mkdir -p "$TARGET_DIR" "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"
cp "$SRC" "$SCRIPT"
chmod +x "$SCRIPT"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SCRIPT</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"

# ── Direkter Weg (seit 2026-10-20): App "alyDoc Oeffner" fuer Links alydoc-open:?p=... ──
# Der Browser ruft die App sofort auf; der Umweg ueber Auftragsdateien in der Dropbox dauerte
# auf dem Mac 3-4 Minuten (Dropbox laedt neue Dateien nur als Platzhalter nach).
URL_SRC="$(cd "$(dirname "$0")" && pwd)/alydoc-open-url.sh"
URL_SCRIPT="$TARGET_DIR/alydoc-open-url.sh"
APP="$HOME/Applications/alyDoc Oeffner.app"
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -f "$URL_SRC" ]; then
  cp "$URL_SRC" "$URL_SCRIPT"; chmod +x "$URL_SCRIPT"
  mkdir -p "$HOME/Applications"
  rm -rf "$APP"
  AS_TMP="$(mktemp -t alydoc-open).applescript"
  cat > "$AS_TMP" <<EOF
on open location theURL
  do shell script "/bin/bash " & quoted form of "$URL_SCRIPT" & " " & quoted form of theURL & " >/dev/null 2>&1 &"
end open location
on run
  display dialog "alyDoc Öffner ist eingerichtet. Er öffnet Mails aus alyDoc direkt in Outlook." buttons {"OK"} default button 1 with title "alyDoc"
end run
EOF
  osacompile -o "$APP" "$AS_TMP"
  rm -f "$AS_TMP"
  PB=/usr/libexec/PlistBuddy
  INFO="$APP/Contents/Info.plist"
  $PB -c "Set :CFBundleIdentifier de.alysee.alydoc-open" "$INFO" 2>/dev/null || $PB -c "Add :CFBundleIdentifier string de.alysee.alydoc-open" "$INFO"
  $PB -c "Add :LSUIElement bool true" "$INFO" 2>/dev/null || true
  $PB -c "Add :CFBundleURLTypes array" "$INFO"
  $PB -c "Add :CFBundleURLTypes:0 dict" "$INFO"
  $PB -c "Add :CFBundleURLTypes:0:CFBundleURLName string de.alysee.alydoc-open" "$INFO"
  $PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$INFO"
  $PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string alydoc-open" "$INFO"
  # Info.plist geaendert -> neu (ad hoc) signieren, sonst startet die App auf Apple Silicon nicht
  codesign --force --deep -s - "$APP" 2>/dev/null || true
  "$LSREG" -f "$APP" >/dev/null 2>&1 || true
  echo "  Oeffner  : $APP (Links alydoc-open:)"
fi

sleep 3
echo "alydoc-open: installiert."
echo "  Waechter : $SCRIPT"
echo "  Agent    : $PLIST"
echo "  Log      : $LOG"
echo "--- letzte Log-Zeilen:"
tail -n 3 "$LOG" 2>/dev/null || true
# nur Meldungen seit diesem Start pruefen (alte Zeilen im Log sind sonst ein Fehlalarm)
if tail -n 3 "$LOG" 2>/dev/null | grep -q "KEIN ZUGRIFF"; then
  echo ""
  echo "!! macOS blockiert den Zugriff auf den Dropbox-Ordner."
  echo "   Systemeinstellungen > Datenschutz & Sicherheit > Festplattenvollzugriff > + > /bin/bash hinzufuegen,"
  echo "   danach: launchctl kickstart -k $DOMAIN/$LABEL"
fi

open "${APP_URL}?nativeopen=1"
