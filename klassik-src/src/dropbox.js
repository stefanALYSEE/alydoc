// Dropbox-Anbindung für alyDoc Klassik.
// Nutzt dieselben localStorage-Schlüssel wie alyDoc (index.html) → ein Login für beide Oberflächen.

export const APP_KEY = '2gz5l15uzq63ppy';
const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

let token = null, refresh = null, expires = 0, rootNs = null;
try {
  token = localStorage.getItem('alydoc_dbx_token') || null;
  refresh = localStorage.getItem('alydoc_dbx_refresh') || null;
  expires = parseInt(localStorage.getItem('alydoc_dbx_expires') || '0', 10);
  rootNs = localStorage.getItem('alydoc_dbx_root_ns') || null;
} catch { /* privater Modus */ }

export const hasToken = () => !!token;

export function setToken(t, r, expiresIn) {
  token = t; refresh = r || refresh; expires = Date.now() + (parseInt(expiresIn || 14400, 10)) * 1000;
  try {
    localStorage.setItem('alydoc_dbx_token', token);
    if (refresh) localStorage.setItem('alydoc_dbx_refresh', refresh);
    localStorage.setItem('alydoc_dbx_expires', String(expires));
  } catch { }
}

export function signOut() {
  token = null; refresh = null; expires = 0; rootNs = null;
  try { ['alydoc_dbx_token', 'alydoc_dbx_refresh', 'alydoc_dbx_expires', 'alydoc_dbx_root_ns'].forEach(k => localStorage.removeItem(k)); } catch { }
}

// HTTP-Header müssen ASCII sein → Umlaute in Pfaden als \uXXXX
const headerJson = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
const pathRoot = () => rootNs ? { 'Dropbox-API-Path-Root': headerJson({ '.tag': 'namespace_id', namespace_id: rootNs }) } : {};

async function tryRefresh() {
  if (!refresh) return false;
  try {
    const b = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: APP_KEY });
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b.toString() });
    if (!r.ok) return false;
    const d = await r.json();
    if (!d.access_token) return false;
    setToken(d.access_token, null, d.expires_in);
    return true;
  } catch { return false; }
}
async function ensure() { if (expires && expires - Date.now() < 60000) await tryRefresh(); }

const isRootErr = (s, t) => s === 422 || ((s === 409 || s === 400) && /path_root|invalid_root/i.test(t || ''));

// Konto ohne Path-Root abfragen → Team-Namespace setzen (Selbstheilung wie alyDoc v3.x)
export async function initAccount() {
  const acc = await rpc('/users/get_current_account', null, { noPathRoot: true });
  const ns = acc?.root_info?.root_namespace_id ? String(acc.root_info.root_namespace_id) : null;
  if (ns && ns !== rootNs) { rootNs = ns; try { localStorage.setItem('alydoc_dbx_root_ns', ns); } catch { } }
  return acc;
}

export async function rpc(path, arg, opts = {}) {
  await ensure();
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.noPathRoot ? {} : pathRoot()) },
    body: JSON.stringify(arg ?? null),
  });
  if (r.status === 401) { if (await tryRefresh()) return rpc(path, arg, opts); throw new Error('Anmeldung abgelaufen – bitte neu anmelden'); }
  const t = await r.text();
  let d; try { d = t ? JSON.parse(t) : {}; } catch { d = { raw: t }; }
  if (!r.ok) {
    if (!opts.noPathRoot && !opts.healed && isRootErr(r.status, t)) { rootNs = null; await initAccount(); return rpc(path, arg, { ...opts, healed: true }); }
    const err = new Error((d.error_summary || t || r.status).toString());
    err.status = r.status; err.summary = d.error_summary || '';
    throw err;
  }
  return d;
}

async function content(endpoint, arg, body) {
  await ensure();
  const r = await fetch(CONTENT + endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Dropbox-API-Arg': headerJson(arg), ...(body !== undefined ? { 'Content-Type': 'application/octet-stream' } : {}), ...pathRoot() },
    body,
  });
  if (r.status === 401) { if (await tryRefresh()) return content(endpoint, arg, body); throw new Error('Anmeldung abgelaufen – bitte neu anmelden'); }
  if (!r.ok) { const t = await r.text(); throw new Error(endpoint + ' ' + r.status + ': ' + t.slice(0, 200)); }
  return r;
}

// ── Mapping Dropbox-Eintrag → Knoten ──────────────────────────────────────────
export function toNode(e) {
  const md = e.metadata?.metadata || e.metadata || e;
  const tag = md['.tag'] === 'folder' ? 'folder' : 'file';
  return {
    id: md.id,
    name: md.name,
    path: md.path_display,
    key: md.path_lower,
    tag,
    size: md.size || 0,
    modified: md.client_modified || md.server_modified || null,
  };
}

export async function list(path) {
  let res = await rpc('/files/list_folder', { path: path || '', include_deleted: false, limit: 2000 });
  const out = res.entries.map(toNode);
  while (res.has_more) {
    res = await rpc('/files/list_folder/continue', { cursor: res.cursor });
    out.push(...res.entries.map(toNode));
  }
  return out;
}

export async function download(path) { return (await content('/files/download', { path })).blob(); }

// Office → PDF (oder HTML bei Tabellen) über Dropbox selbst, kein Drittanbieter
export async function preview(path) {
  const r = await content('/files/get_preview', { path });
  return r.blob();
}
export async function thumbnail(path) {
  const r = await content('/files/get_thumbnail_v2', { resource: { '.tag': 'path', path }, format: 'jpeg', size: 'w2048h1536', mode: 'fitone_bestfit' });
  return r.blob();
}

export async function upload(path, data, mode = 'add') {
  const body = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const r = await content('/files/upload', { path, mode, autorename: mode === 'add', mute: false }, body);
  return toNode(await r.json());
}

export async function move(fromPath, toFolder, name) {
  const to = (toFolder === '/' ? '' : toFolder) + '/' + name;
  const r = await rpc('/files/move_v2', { from_path: fromPath, to_path: to, autorename: true });
  return toNode(r);
}
export async function rename(fromPath, newName) {
  const parent = fromPath.slice(0, fromPath.lastIndexOf('/'));
  const r = await rpc('/files/move_v2', { from_path: fromPath, to_path: parent + '/' + newName, autorename: false });
  return toNode(r);
}
export async function mkdir(parent, name) {
  const r = await rpc('/files/create_folder_v2', { path: (parent || '') + '/' + name, autorename: true });
  return toNode(r);
}
// delete_v2 → landet in „Gelöschte Dateien“ der Dropbox und ist wiederherstellbar
export async function remove(path) { await rpc('/files/delete_v2', { path }); }

export async function tempLink(path) { return (await rpc('/files/get_temporary_link', { path })).link; }

export async function search(query, max = 100) {
  const r = await rpc('/files/search_v2', { query, options: { max_results: max, file_status: 'active', filename_only: false } });
  return (r.matches || []).map(m => toNode(m.metadata));
}

export async function exists(path) {
  try { await rpc('/files/get_metadata', { path }); return true; }
  catch (e) { if (e.status === 409) return false; throw e; }
}
