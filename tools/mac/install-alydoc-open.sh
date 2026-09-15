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
  rm -f "$PLIST" "$SCRIPT"
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

sleep 3
echo "alydoc-open: installiert."
echo "  Waechter : $SCRIPT"
echo "  Agent    : $PLIST"
echo "  Log      : $LOG"
echo "--- letzte Log-Zeilen:"
tail -n 3 "$LOG" 2>/dev/null || true
if grep -q "KEIN ZUGRIFF" "$LOG" 2>/dev/null; then
  echo ""
  echo "!! macOS blockiert den Zugriff auf den Dropbox-Ordner."
  echo "   Systemeinstellungen > Datenschutz & Sicherheit > Festplattenvollzugriff > + > /bin/bash hinzufuegen,"
  echo "   danach: launchctl kickstart -k $DOMAIN/$LABEL"
fi

open "${APP_URL}?nativeopen=1"
