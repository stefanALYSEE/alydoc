// Demo-Backend (?demo=1): gleiche Schnittstelle wie dropbox.js, alles im Speicher.
// Dient zum Testen der Oberfläche ohne Dropbox-Login.

const now = Date.now();
const d = days => new Date(now - days * 864e5).toISOString();

const EML = (subj, from, body) => [
  `From: ${from}`, 'To: Stefan Hoffmann <stefan@alysee.de>', `Subject: ${subj}`,
  `Date: ${new Date(now - 3 * 864e5).toUTCString()}`, 'MIME-Version: 1.0',
  'Content-Type: text/html; charset=utf-8', '', `<p>Hallo Stefan,</p><p>${body}</p><p>Viele Grüße</p>`,
].join('\r\n');

const files = {};
const add = (path, tag, ageDays, text) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  files[path.toLowerCase()] = { id: 'id:' + Math.random().toString(36).slice(2), name, path, key: path.toLowerCase(), tag, size: text ? text.length : 0, modified: d(ageDays), text };
};

[
  ['/Alysee_GmbH', 'folder'], ['/Alysee_GmbH/Aufträge 2026', 'folder'], ['/Alysee_GmbH/Aufträge 2026/BibiG Klassenräume', 'folder'],
  ['/Alysee_GmbH/Aufträge 2026/BibiG Klassenräume/Brado', 'folder'], ['/Alysee_GmbH/Aufträge 2026/BibiG Klassenräume/PMO', 'folder'],
  ['/Alysee_GmbH/Aufträge 2026/Schriever BVB Kantine', 'folder'], ['/Alysee_GmbH/Lieferanten', 'folder'], ['/Alysee_GmbH/Lieferanten/Brado', 'folder'],
  ['/Hoffmann Privat', 'folder'], ['/Posteingang', 'folder'], ['/Projekte 2026', 'folder'],
].forEach(([p, t]) => add(p, t, 30));

add('/Alysee_GmbH/Aufträge 2026/BibiG Klassenräume/Brado/2026_08_07_AW_ Bestellung BibiG.eml', 'file', 2, EML('AW: Bestellung BibiG', 'Alexander Marchesan <alex@brado.it>', 'die Bestellung ist eingegangen, Liefertermin KW 45.'));
add('/Alysee_GmbH/Aufträge 2026/BibiG Klassenräume/Brado/2026_07_31_INVOICE N. 2161.eml', 'file', 9, EML('INVOICE N. 2161 HOFFMANN', 'Amministrazione <amm@brado.it>', 'anbei die Rechnung 2161.'));
add('/Alysee_GmbH/Aufträge 2026/BibiG Klassenräume/Brado/Delivery note 2024-01-0005248.txt', 'file', 12, 'Lieferschein 2024-01-0005248\n\n20 St. Juno Kunststoffsitz SDP231AD1\n10 St. K276BLOOM/AP');
add('/Alysee_GmbH/Aufträge 2026/BibiG Klassenräume/Brado/2026_06_25_Bestellung BibiG.eml', 'file', 50, EML('Bestellung BibiG', 'Stefan Hoffmann <stefan@alysee.de>', 'nachfolgend bestellen wir: 20 St. Juno Kunststoffsitz.'));
add('/Alysee_GmbH/Aufträge 2026/BibiG Klassenräume/PMO/Auftragsbestätigung PMO.txt', 'file', 40, 'Auftragsbestätigung PMO\nPos. 1  40 Schalen');
add('/Alysee_GmbH/Aufträge 2026/Schriever BVB Kantine/AB261460.txt', 'file', 14, 'Auftragsbestätigung AB261460');
add('/Posteingang/Scan_2026-10-17.txt', 'file', 1, 'Eingescannter Brief – noch nicht abgelegt.');
add('/Posteingang/Rechnung Telekom 10-2026.txt', 'file', 0, 'Telekom Rechnung Oktober 2026\nBetrag 49,95 €');

const parentOf = k => k.slice(0, k.lastIndexOf('/'));
const pause = (ms = 120) => new Promise(r => setTimeout(r, ms));
const clone = n => { const { text, ...rest } = n; return { ...rest }; };

export const demo = {
  async list(path) {
    await pause();
    const k = (path || '').toLowerCase();
    return Object.values(files).filter(f => parentOf(f.key) === k).map(clone);
  },
  async download(path) {
    await pause();
    const f = files[path.toLowerCase()];
    if (!f) throw new Error('nicht gefunden');
    return new Blob([f.text || ''], { type: 'application/octet-stream' });
  },
  async preview() { throw new Error('Im Demo nicht verfügbar'); },
  async thumbnail() { throw new Error('Im Demo nicht verfügbar'); },
  async upload(path, data) {
    const text = typeof data === 'string' ? data : '(Datei)';
    add(path, 'file', 0, text);
    return clone(files[path.toLowerCase()]);
  },
  async move(fromPath, toFolder, name) {
    const fk = fromPath.toLowerCase();
    const to = (toFolder === '/' ? '' : toFolder) + '/' + name;
    for (const k of Object.keys(files)) {
      if (k === fk || k.startsWith(fk + '/')) {
        const f = files[k]; delete files[k];
        const np = to + f.path.slice(fromPath.length);
        f.path = np; f.key = np.toLowerCase(); f.name = np.slice(np.lastIndexOf('/') + 1); files[f.key] = f;
      }
    }
    return clone(files[to.toLowerCase()]);
  },
  async rename(fromPath, newName) { return demo.move(fromPath, parentOf(fromPath) || '', newName); },
  async mkdir(parent, name) { const p = (parent || '') + '/' + name; add(p, 'folder', 0); return clone(files[p.toLowerCase()]); },
  async remove(path) {
    const fk = path.toLowerCase();
    for (const k of Object.keys(files)) if (k === fk || k.startsWith(fk + '/')) delete files[k];
  },
  async tempLink() { throw new Error('Im Demo nicht verfügbar'); },
  async search(q) {
    await pause();
    const ql = q.toLowerCase();
    return Object.values(files).filter(f => f.name.toLowerCase().includes(ql) || (f.text || '').toLowerCase().includes(ql)).map(clone);
  },
  async exists(path) { return !!files[path.toLowerCase()]; },
};
