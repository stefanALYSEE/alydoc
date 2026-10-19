// Verschlagwortung – kompatibel zum Index von alyDoc (/.alydoc_index.json, Schlüssel = Dropbox-Datei-ID).
// Speichern lädt den Index immer frisch und führt nur den eigenen Eintrag ein,
// damit alyDoc und alyDoc Klassik sich nicht gegenseitig überschreiben.

export const MD_FILE = '/.alydoc_index.json';

export const DOCTYPES = [
  { key: 'allgemein', label: 'Allgemein', fields: [['betreff', 'Betreff', 'text'], ['datum', 'Dokumentdatum', 'date']] },
  { key: 'rechnung', label: 'Rechnung', fields: [['korrespondent', 'Lieferant / Kunde', 'text'], ['belegnr', 'Rechnungs-Nr.', 'text'], ['datum', 'Belegdatum', 'date'], ['betrag', 'Betrag (€)', 'number']] },
  { key: 'angebot', label: 'Angebot', fields: [['korrespondent', 'Kunde', 'text'], ['belegnr', 'Angebots-Nr.', 'text'], ['datum', 'Datum', 'date'], ['betrag', 'Betrag (€)', 'number']] },
  { key: 'projekt', label: 'Projekt', fields: [['projekt', 'Projektname', 'text'], ['korrespondent', 'Kunde', 'text'], ['status', 'Status', 'text'], ['datum', 'Datum', 'date']] },
  { key: 'lieferant', label: 'Lieferant', fields: [['korrespondent', 'Firma', 'text'], ['kategorie', 'Kategorie', 'text'], ['ansprech', 'Ansprechpartner', 'text']] },
  { key: 'vertrag', label: 'Vertrag', fields: [['korrespondent', 'Vertragspartner', 'text'], ['datum', 'Beginn', 'date'], ['ende', 'Ende', 'date']] },
  { key: 'korrespondenz', label: 'Korrespondenz', fields: [['korrespondent', 'Von / An', 'text'], ['betreff', 'Betreff', 'text'], ['datum', 'Datum', 'date']] },
];
export const dtOf = k => DOCTYPES.find(d => d.key === k) || DOCTYPES[0];

export function guessDocType(name) {
  const n = (name || '').toLowerCase();
  if (/rechnung|invoice|\bre\d|fattura/.test(n)) return 'rechnung';
  if (/angebot|\bag\d|offer|quotation/.test(n)) return 'angebot';
  if (/vertrag|contract/.test(n)) return 'vertrag';
  if (/\.(eml|msg)$/.test(n)) return 'korrespondenz';
  return 'allgemein';
}

export function createMeta(api, demo) {
  let cache = null;
  const blank = () => ({ version: 1, docs: {} });
  async function fetchFresh() {
    if (demo) return cache || blank();
    try {
      const txt = await (await api.download(MD_FILE)).text();
      const j = JSON.parse(txt);
      if (!j.docs) j.docs = {};
      return j;
    } catch { return blank(); }
  }
  return {
    async load() { cache = await fetchFresh(); return cache; },
    get(id) { return (id && cache?.docs?.[id]) || null; },
    all() { return cache?.docs || {}; },
    async set(id, entry) {
      const fresh = await fetchFresh();
      fresh.docs[id] = { ...(fresh.docs[id] || {}), ...entry, updatedAt: new Date().toISOString() };
      if (!demo) await api.upload(MD_FILE, JSON.stringify(fresh), 'overwrite');
      cache = fresh;
      return fresh.docs[id];
    },
    async movePath(id, node) {
      if (!cache?.docs?.[id]) return;
      await this.set(id, { name: node.name, path_display: node.path, path_lower: node.key });
    },
    search(q) {
      const ql = (q || '').toLowerCase().trim();
      if (!ql) return [];
      const out = [];
      for (const [id, e] of Object.entries(this.all())) {
        const hay = [e.name, dtOf(e.docType).label, e.notes, ...(e.keywords || []), ...Object.values(e.fields || {})].join(' ').toLowerCase();
        if (hay.includes(ql)) out.push({ id, ...e });
      }
      return out;
    },
  };
}
