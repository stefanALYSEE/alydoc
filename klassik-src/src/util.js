export const ext = name => { const i = (name || '').lastIndexOf('.'); return i < 0 ? '' : name.slice(i + 1).toLowerCase(); };

const OFFICE = ['doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'pps', 'ppsx', 'rtf', 'odt', 'ods', 'odp', 'csv'];
const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
const THUMB = ['heic', 'tif', 'tiff'];
export const MODEL3D = ['stl', 'obj', 'ply', 'fbx', '3mf', 'glb', 'gltf', 'wrl', '3dm', 'step', 'stp', 'igs', 'iges'];
const CAD_NONE = ['dwg', 'skp', 'f3d', 'crv', 'sldprt', 'sldasm', 'ipt', 'iam', 'blend', 'max', 'c4d'];
const TEXT = ['txt', 'md', 'json', 'xml', 'log', 'ini', 'html', 'htm'];

export function kindOf(name) {
  const e = ext(name);
  if (e === 'pdf') return 'pdf';
  if (e === 'eml') return 'eml';
  if (MODEL3D.includes(e)) return '3d';
  if (e === 'dxf') return 'dxf';
  if (CAD_NONE.includes(e)) return 'cad';
  if (e === 'msg') return 'msg';
  if (IMG.includes(e)) return 'image';
  if (THUMB.includes(e)) return 'thumb';
  if (OFFICE.includes(e)) return 'office';
  if (TEXT.includes(e)) return 'text';
  return 'other';
}

export const ICON = { '3d': '🧊', dxf: '📐', cad: '📐', folder: '📁', pdf: '📕', eml: '✉️', msg: '✉️', image: '🖼️', thumb: '🖼️', office: '📄', text: '📝', other: '📄' };
export const iconOf = n => n.tag === 'folder' ? ICON.folder : ICON[kindOf(n.name)];

// Dokumentdatum wie in ELO vor den Namen stellen.
// Add-in-Ablagen heißen „2026_09_15_Betreff.eml“ → Datum aus dem Namen, Präfix entfernen.
const RX = /^(\d{4})[_-](\d{2})[_-](\d{2})[_ -]+/;
export function docDate(n) {
  const m = RX.exec(n.name);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return n.modified ? new Date(n.modified) : null;
}
export function displayName(n) { return n.tag === 'folder' ? n.name : n.name.replace(RX, ''); }
export const fmtDate = dt => dt ? dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
export const fmtDateTime = s => s ? new Date(s).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export function fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
}

// ELO-Sortierung: Ordner alphabetisch, darunter Dokumente – neuestes zuerst
export function sortNodes(arr) {
  const folders = arr.filter(n => n.tag === 'folder').sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  const docs = arr.filter(n => n.tag !== 'folder').sort((a, b) => (docDate(b)?.getTime() || 0) - (docDate(a)?.getTime() || 0) || a.name.localeCompare(b.name, 'de'));
  return [...folders, ...docs];
}

export const parentKey = k => k.slice(0, k.lastIndexOf('/'));
export const parentPath = p => p.slice(0, p.lastIndexOf('/'));

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};
