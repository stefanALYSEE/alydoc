# alyDoc Klassik

React-Oberfläche (Vite) für das Dropbox-Archiv, bedient wie ELOoffice 11:

- **Ein Baum** mit Ordnern *und* Dokumenten (Datum vorne, neuestes zuerst) – keine getrennte Dateiliste
- **Einfachklick = Vorschau** rechts (PDF, Bilder, `.eml`, `.msg`, Word/Excel/PowerPoint über Dropbox-PDF-Rendition, Text)
- Linke Leiste **Archiv · Klemmbrett · Postbox · Suchen**, Ribbon mit großen Schaltflächen, Pfad in der Statuszeile
- Tastatur wie im Explorer (↑ ↓ → ← Enter F2 Entf Strg+X/V Strg+F F5 Alt+←)
- Ziehen auf Ordner = verschieben; Dateien aus dem Explorer auf Ordner = hochladen
- Postbox = Dropbox-Ordner `/Posteingang`, „Ablegen…“ mit Ordnerwahl und zuletzt benutzten Zielen
- Verschlagwortung im gemeinsamen Index `/.alydoc_index.json` (kompatibel zu alyDoc)

Läuft unter `https://alydoc.alysee.de/klassik/` – gleiche Domain wie alyDoc, daher gemeinsamer Dropbox-Login
(localStorage `alydoc_dbx_*`) und Anmeldung über `../auth.html`. pdf.js und MSGReader kommen aus dem
bestehenden Repo (`../vendor/pdf.min.js`, `../msgreader.bundle.v2.js`).

## Bauen

```bash
cd klassik-src
npm install
npm run build      # schreibt nach ../klassik (wird mit eingecheckt, GitHub Pages baut nicht)
```

Testen ohne Dropbox: `…/klassik/?demo=1`. Lokal: Repo-Wurzel statisch ausliefern (`python -m http.server 8765`)
und `http://localhost:8765/klassik/?demo=1` öffnen.

Bei jedem Deploy `BUILD` in `src/App.jsx` hochzählen (wird in der Statuszeile angezeigt).
