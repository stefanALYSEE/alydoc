import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as dbx from './dropbox.js';
import { demo as demoApi } from './demo.js';
import { createMeta } from './meta.js';
import Preview from './Preview.jsx';
import { PromptDialog, ConfirmDialog, TagDialog, FilingDialog } from './Dialogs.jsx';
import { sortNodes, iconOf, displayName, docDate, fmtDate, kindOf, parentKey, parentPath, downloadBlob, store } from './util.js';

export const BUILD = 'Klassik 1.2 · 2026-10-19';
const PB_RX = /^(postbox|posteingang)/i;
const OPEN_QUEUE = '/APPS/alydoc-open-requests';
const ROW_H = 22;
const isDemo = new URLSearchParams(location.search).has('demo');
const api = isDemo ? demoApi : dbx;

// ── Login ───────────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState(isDemo || dbx.hasToken() ? 'app' : 'login');
  useEffect(() => {
    const onMsg = e => {
      if (e.origin !== location.origin) return;
      try {
        const m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (m?.type === 'auth_success' && m.token) { dbx.setToken(m.token, m.refresh, m.expires_in); setPhase('app'); }
      } catch { }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  if (phase === 'login') return (
    <div className="login">
      <div className="login-card">
        <div className="pv-logo">alyDoc <span>Klassik</span></div>
        <p>Archiv in Dropbox – bedient wie ELOoffice.</p>
        <button className="primary big" onClick={() => { if (!window.open(new URL('../auth.html', location.href).href, 'alydoc_auth', 'width=480,height=650')) alert('Popup blockiert – bitte erlauben.'); }}>Mit Dropbox anmelden</button>
        <p className="muted small">Bist du in alyDoc schon angemeldet, gilt die Anmeldung hier automatisch.</p>
        <a className="small" href="?demo=1">Demo ohne Anmeldung ansehen</a>
      </div>
    </div>
  );
  return <Main onSignOut={() => { dbx.signOut(); setPhase('login'); }} />;
}

// ── Hauptfenster ─────────────────────────────────────────────────────────────
function Main({ onSignOut }) {
  const meta = useMemo(() => createMeta(api, isDemo), []);
  const [, setMetaTick] = useState(0);
  const [account, setAccount] = useState(null);
  const [view, setView] = useState('archiv');
  const [tab, setTab] = useState('start');
  const [children, _setChildren] = useState({});
  const childrenRef = useRef({});
  const setChildren = fn => { childrenRef.current = typeof fn === 'function' ? fn(childrenRef.current) : fn; _setChildren(childrenRef.current); };
  const [expanded, setExpanded] = useState(() => new Set(store.get('klassik_expanded', [])));
  const [selected, setSelected] = useState(null);       // im Archiv gewählter Eintrag
  const [focusNode, setFocusNode] = useState(null);     // Eintrag in Postbox/Suche/Klemmbrett
  const [cut, setCut] = useState(null);
  const [klemm, setKlemm] = useState(() => store.get('klassik_klemmbrett', []));
  const [dialog, setDialog] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [toast, setToast] = useState(null);
  const [treeW, setTreeW] = useState(() => store.get('klassik_tree_w', 440));
  const [showPreview, setShowPreview] = useState(() => store.get('klassik_preview', true));
  const [fullPv, setFullPv] = useState(false);
  const [history, setHistory] = useState({ list: [], pos: -1 });
  const [inbox, setInbox] = useState(null);
  // Postbox = frei wählbarer Eingangsordner der obersten Ebene (Postbox alysee, Postbox Privat, Posteingang …)
  const [postbox, setPostbox] = useState(() => store.get('klassik_postbox', null));
  const POSTBOX = postbox || '/Postbox alysee';
  const pbChoices = (children[''] || []).filter(n => n.tag === 'folder' && PB_RX.test(n.name));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const printRef = useRef(null);
  const fileInput = useRef(null);
  const treeRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const dragNode = useRef(null);
  const [dropKey, setDropKey] = useState(null);
  const hoverTimer = useRef(null);

  const say = (text, kind = 'i') => { setToast({ text, kind, t: Date.now() }); };
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.kind === 'e' ? 6000 : 3000); return () => clearTimeout(t); }, [toast]);
  const fail = (e, what) => { console.error(what, e); say(what + ': ' + (e.summary || e.message), 'e'); e._shown = true; throw e; };

  useEffect(() => { store.set('klassik_expanded', [...expanded].slice(-300)); }, [expanded]);
  useEffect(() => { store.set('klassik_klemmbrett', klemm); }, [klemm]);
  useEffect(() => { store.set('klassik_tree_w', treeW); }, [treeW]);
  useEffect(() => { store.set('klassik_preview', showPreview); }, [showPreview]);

  // ── Laden ──
  const loadKids = useCallback(async (key, path, force) => {
    if (!force && childrenRef.current[key]) return childrenRef.current[key];
    try {
      const list = sortNodes(await api.list(path));
      setChildren(p => ({ ...p, [key]: list }));
      return list;
    } catch (e) {
      setChildren(p => ({ ...p, [key]: [] }));
      if (e.status === 409) { setExpanded(s => { const n = new Set(s); n.delete(key); return n; }); return []; }
      say('Ordner konnte nicht geladen werden: ' + (e.summary || e.message), 'e');
      return [];
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (!isDemo) { try { setAccount(await dbx.initAccount()); } catch (e) { say('Dropbox: ' + e.message, 'e'); if (/abgelaufen/.test(e.message)) { onSignOut(); return; } } }
      await Promise.all([meta.load().then(() => setMetaTick(t => t + 1)), loadKids('', '')]);
      // aufgeklappte Ordner der letzten Sitzung nachladen (flach zuerst)
      const keys = [...expanded].sort((a, b) => a.split('/').length - b.split('/').length);
      for (const k of keys) {
        const par = childrenRef.current[parentKey(k)];
        const n = par?.find(x => x.key === k);
        if (n) await loadKids(k, n.path); else setExpanded(s => { const x = new Set(s); x.delete(k); return x; });
      }
      const last = store.get('klassik_last', null);
      if (last) reveal(last, true);
    })();
  }, []);

  // ── Baum flach machen (für Anzeige, Tastatur, Virtualisierung) ──
  const rows = useMemo(() => {
    const out = [];
    const walk = (key, depth) => {
      const list = children[key];
      if (!list) { out.push({ loading: true, depth, key: key + '#l' }); return; }
      if (!list.length && depth > 0) out.push({ empty: true, depth, key: key + '#e' });
      for (const n of list) {
        out.push({ n, depth, key: n.key });
        if (n.tag === 'folder' && expanded.has(n.key)) walk(n.key, depth + 1);
      }
    };
    walk('', 0);
    return out;
  }, [children, expanded]);

  const findNode = key => { const par = childrenRef.current[parentKey(key)]; return par?.find(x => x.key === key) || null; };

  const select = (n, fromHistory) => {
    setSelected(n);
    if (n) store.set('klassik_last', n.path);
    if (n && !fromHistory) setHistory(h => { const list = [...h.list.slice(0, h.pos + 1), n.path].slice(-50); return { list, pos: list.length - 1 }; });
  };

  const toggle = async (n, forceOpen) => {
    if (n.tag !== 'folder') return;
    const open = expanded.has(n.key);
    if (open && !forceOpen) { setExpanded(s => { const x = new Set(s); x.delete(n.key); return x; }); return; }
    setExpanded(s => new Set(s).add(n.key));
    await loadKids(n.key, n.path);
  };

  // Pfad im Baum aufklappen und markieren (Suche, Klemmbrett, Start)
  const reveal = async (path, quiet) => {
    const segs = path.split('/').filter(Boolean);
    let key = '', p = '', node = null;
    const toOpen = [];
    for (let i = 0; i < segs.length; i++) {
      const list = await loadKids(key, p);
      node = list.find(x => x.name.toLowerCase() === segs[i].toLowerCase());
      if (!node) { if (!quiet) say('Nicht mehr vorhanden: ' + path, 'e'); return; }
      if (i < segs.length - 1) { toOpen.push(node.key); key = node.key; p = node.path; }
    }
    setExpanded(s => { const x = new Set(s); toOpen.forEach(k => x.add(k)); return x; });
    for (const k of toOpen) { const n = findNode(k); if (n) await loadKids(k, n.path); }
    setView('archiv');
    select(node);
    setTimeout(() => scrollToKey(node.key), 50);
  };

  const scrollToKey = key => {
    const el = treeRef.current; if (!el) return;
    const idx = rowsRef.current.findIndex(r => r.key === key);
    if (idx < 0) return;
    const top = idx * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top - ROW_H * 2;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top - el.clientHeight + ROW_H * 3;
  };
  const rowsRef = useRef(rows); rowsRef.current = rows;

  useEffect(() => {
    const el = treeRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el); return () => ro.disconnect();
  }, [view]);

  // ── Aktionen ──
  const current = view === 'archiv' ? selected : focusNode;
  const folderOf = n => !n ? { path: '', key: '' } : n.tag === 'folder' ? n : { path: parentPath(n.path), key: parentKey(n.key) };

  const refreshKey = async key => {
    if (key === '' || childrenRef.current[key]) {
      const n = key === '' ? { path: '' } : findNode(key);
      if (n) await loadKids(key, n.path, true);
    }
  };

  const afterMove = async (oldNode, newNode) => {
    // aufgeklappte Unterordner umschlüsseln
    if (oldNode.tag === 'folder') setExpanded(s => { const x = new Set(); s.forEach(k => x.add(k === oldNode.key || k.startsWith(oldNode.key + '/') ? newNode.key + k.slice(oldNode.key.length) : k)); return x; });
    await refreshKey(parentKey(oldNode.key));
    await refreshKey(parentKey(newNode.key));
    setKlemm(k => k.map(x => x.key === oldNode.key ? newNode : x));
    if (meta.get(oldNode.id)) meta.movePath(oldNode.id, newNode).catch(() => { });
  };

  const moveTo = async (n, folder) => {
    if (!n || !folder || folder.tag !== 'folder' && folder.key !== '') return;
    if (parentKey(n.key) === folder.key) return;
    if (folder.key === n.key || folder.key.startsWith(n.key + '/')) { say('Ein Ordner kann nicht in sich selbst verschoben werden', 'e'); return; }
    try {
      const nn = await api.move(n.path, folder.path, n.name);
      await afterMove(n, nn);
      say(`„${n.name}“ → ${folder.name || 'Archiv'}`, 's');
      if (view === 'archiv') {
        // Ziel aufklappen, damit das verschobene Dokument sichtbar markiert ist
        if (folder.key) { setExpanded(s => new Set(s).add(folder.key)); await loadKids(folder.key, folder.path); }
        select(nn); setTimeout(() => scrollToKey(nn.key), 50);
      }
      return nn;
    } catch (e) { fail(e, 'Verschieben fehlgeschlagen'); }
  };

  const nativeOpen = () => { try { return localStorage.getItem('alydoc_native_open') === '1'; } catch { return false; } };

  const openInOutlook = async n => {
    const target = /Macintosh|Mac OS X/.test(navigator.userAgent) ? 'mac' : 'win';
    await api.upload(`${OPEN_QUEUE}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`, JSON.stringify({ path: n.path, ts: Date.now(), target }));
    say('Wird in Outlook geöffnet … (wenige Sekunden)');
  };

  const uploadFiles = async (files, folder) => {
    const list = [...files];
    if (!list.length) return;
    say(`Lade ${list.length} Datei(en) hoch …`);
    let ok = 0;
    for (const f of list) {
      try { await api.upload((folder.path || '') + '/' + f.name, f); ok++; }
      catch (e) { say(`${f.name}: ${e.message}`, 'e'); }
    }
    await refreshKey(folder.key);
    if (folder.key && !expanded.has(folder.key)) setExpanded(s => new Set(s).add(folder.key));
    if (folder.path?.toLowerCase() === POSTBOX.toLowerCase()) loadInbox();
    say(`${ok} von ${list.length} Datei(en) abgelegt in ${folder.name || folder.path || 'Archiv'}`, ok ? 's' : 'e');
  };

  const act = async (name, n = current) => {
    setCtx(null);
    try {
      switch (name) {
        case 'open': {
          if (!n || n.tag === 'folder') { if (n) toggle(n); return; }
          const k = kindOf(n.name);
          if ((k === 'eml' || k === 'msg') && nativeOpen() && !isDemo) return openInOutlook(n);
          const blob = await api.download(n.path);
          if (k === 'pdf' || k === 'image') window.open(URL.createObjectURL(new Blob([blob], { type: k === 'pdf' ? 'application/pdf' : blob.type })), '_blank');
          else downloadBlob(blob, n.name);
          return;
        }
        case 'download': if (n && n.tag !== 'folder') downloadBlob(await api.download(n.path), n.name); return;
        case 'print': if (printRef.current) printRef.current(); else say('Für diesen Eintrag ist kein Druck möglich'); return;
        case 'outlook': return openInOutlook(n);
        case 'mkdir': {
          const parent = folderOf(n);
          setDialog(<PromptDialog title="Neuer Ordner" label={'in ' + (parent.path || 'Archiv (oberste Ebene)')} okLabel="Anlegen" onClose={() => setDialog(null)}
            onOk={async name => { try { const nn = await api.mkdir(parent.path, name); if (parent.key) { setExpanded(s => new Set(s).add(parent.key)); } await loadKids(parent.key, parent.path, true); select(nn); setView('archiv'); say('Ordner angelegt', 's'); } catch (e) { fail(e, 'Ordner anlegen fehlgeschlagen'); } }} />);
          return;
        }
        case 'rename':
          if (!n) return;
          setDialog(<PromptDialog title="Umbenennen" label="Neuer Name" initial={n.name} selectStem={n.tag !== 'folder'} okLabel="Umbenennen" onClose={() => setDialog(null)}
            onOk={async name => { if (name === n.name) return; try { const nn = await api.rename(n.path, name); await afterMove(n, nn); if (view === 'archiv') select(nn); else setFocusNode(nn); if (view === 'postbox') loadInbox(); say('Umbenannt', 's'); } catch (e) { fail(e, 'Umbenennen fehlgeschlagen'); } }} />);
          return;
        case 'delete':
          if (!n) return;
          setDialog(<ConfirmDialog title="Löschen" danger okLabel="Löschen" onClose={() => setDialog(null)}
            text={<>„<b>{n.name}</b>“ {n.tag === 'folder' ? 'mit allem Inhalt ' : ''}löschen?<br /><span className="muted">Wiederherstellbar über „Gelöschte Dateien“ in Dropbox.</span></>}
            onOk={async () => {
              try {
                const rowsNow = rowsRef.current; const idx = rowsNow.findIndex(r => r.key === n.key);
                await api.remove(n.path);
                await refreshKey(parentKey(n.key));
                setKlemm(k => k.filter(x => x.key !== n.key));
                if (view === 'archiv') { const nb = rowsNow[idx + 1]?.n && !rowsNow[idx + 1].n.key.startsWith(n.key + '/') ? rowsNow[idx + 1].n : rowsNow[idx - 1]?.n; select(nb || null); }
                else { setFocusNode(null); if (view === 'postbox') loadInbox(); if (view === 'suche') setResults(r => r?.filter(x => x.key !== n.key)); }
                say('Gelöscht', 's');
              } catch (e) { fail(e, 'Löschen fehlgeschlagen'); }
            }} />);
          return;
        case 'cut': if (n) { setCut(n); say(`„${n.name}“ ausgeschnitten – Zielordner wählen und „Einfügen“`); } return;
        case 'paste': {
          if (!cut) return;
          const f = folderOf(n);
          const folder = f.key === '' ? { key: '', path: '', name: 'Archiv', tag: 'folder' } : (f.tag ? f : findNode(f.key));
          const nn = await moveTo(cut, folder);
          if (nn) setCut(null);
          return;
        }
        case 'klemm':
          if (!n) return;
          if (klemm.some(x => x.key === n.key)) { setKlemm(k => k.filter(x => x.key !== n.key)); say('Vom Klemmbrett entfernt'); }
          else { setKlemm(k => [n, ...k]); say('Auf das Klemmbrett gelegt', 's'); }
          return;
        case 'tag':
          if (!n || n.tag === 'folder') return;
          setDialog(<TagDialog node={n} existing={meta.get(n.id)} onClose={() => setDialog(null)}
            onSave={async v => { try { await meta.set(n.id, { ...v, name: n.name, path_display: n.path, path_lower: n.key }); setMetaTick(t => t + 1); say('Verschlagwortung gespeichert', 's'); } catch (e) { fail(e, 'Speichern fehlgeschlagen'); } }} />);
          return;
        case 'file':
          if (!n || n.tag === 'folder') return;
          setDialog(<FilingDialog node={n} api={api} onClose={() => setDialog(null)}
            onFile={async (target, name) => {
              try {
                const idx = (inbox || []).findIndex(x => x.key === n.key);
                const nn = await api.move(n.path, target, name);
                await afterMove(n, nn);
                // wie ELO: gleich das nächste Postbox-Dokument zur Bearbeitung zeigen
                const rest = await loadInbox();
                setFocusNode(rest[Math.min(Math.max(idx, 0), rest.length - 1)] || null);
                say(<>Abgelegt in <b>{target}</b> <button className="linkbtn" onClick={() => reveal(nn.path)}>Im Archiv zeigen</button></>, 's');
              } catch (e) { fail(e, 'Ablegen fehlgeschlagen'); }
            }} />);
          return;
        case 'upload': fileInput.current.dataset.target = JSON.stringify(view === 'postbox' ? { path: POSTBOX, key: POSTBOX.toLowerCase(), name: 'Postbox' } : folderOf(n)); fileInput.current.click(); return;
        case 'refresh':
          if (view === 'postbox') return loadInbox();
          if (!n) return loadKids('', '', true);
          await refreshKey(folderOf(n).key); say('Aktualisiert');
          return;
        case 'reveal': if (n) reveal(n.path); return;
        case 'home': setView('archiv'); select(null); treeRef.current && (treeRef.current.scrollTop = 0); return;
        case 'back': case 'fwd': {
          const pos = history.pos + (name === 'back' ? -1 : 1);
          if (pos < 0 || pos >= history.list.length) return;
          setHistory(h => ({ ...h, pos }));
          const path = history.list[pos];
          const segs = path.split('/').filter(Boolean); let key = '', p = '', node = null;
          for (let i = 0; i < segs.length; i++) { const list = await loadKids(key, p); node = list.find(x => x.name.toLowerCase() === segs[i].toLowerCase()); if (!node) return; if (i < segs.length - 1) { setExpanded(s => new Set(s).add(node.key)); key = node.key; p = node.path; } }
          setView('archiv'); select(node, true); setTimeout(() => scrollToKey(node.key), 50);
          return;
        }
        default:
      }
    } catch (e) { if (!e._shown) say(e.message, 'e'); }
  };

  // ── Postbox ──
  const loadInbox = async () => {
    try {
      if (!(await api.exists(POSTBOX))) { setInbox(false); return []; }
      const list = sortNodes(await api.list(POSTBOX)).filter(n => n.tag !== 'folder');
      setInbox(list);
      return list;
    } catch (e) { say('Postbox: ' + e.message, 'e'); setInbox([]); return []; }
  };
  useEffect(() => { loadInbox(); }, [POSTBOX]);
  useEffect(() => {
    if (postbox || !children['']) return;
    const c = pbChoices.find(n => /^postbox alysee$/i.test(n.name)) || pbChoices[0];
    if (c && c.path !== POSTBOX) setPostbox(c.path);
  }, [children['']]);
  const choosePostbox = p => { setPostbox(p); store.set('klassik_postbox', p); setFocusNode(null); setInbox(null); };

  // ── Suche ──
  const runSearch = async e => {
    e?.preventDefault();
    const q = query.trim(); if (!q) return;
    setSearching(true); setFocusNode(null);
    try {
      const fromIndex = meta.search(q).filter(x => x.path_display).map(x => ({ id: x.id, name: x.name, path: x.path_display, key: x.path_lower, tag: 'file', size: 0, modified: x.updatedAt, fromIndex: true }));
      const found = await api.search(q);
      const seen = new Set(found.map(f => f.key));
      setResults([...fromIndex.filter(x => !seen.has(x.key)), ...found]);
    } catch (err) { say('Suche fehlgeschlagen: ' + err.message, 'e'); setResults([]); }
    setSearching(false);
  };

  // ── Tastatur im Baum (wie Windows-Explorer / ELO) ──
  const onTreeKey = e => {
    if (dialog) return;
    const list = rowsRef.current.filter(r => r.n);
    const idx = selected ? list.findIndex(r => r.key === selected.key) : -1;
    const go = i => { const r = list[Math.max(0, Math.min(list.length - 1, i))]; if (r) { select(r.n); scrollToKey(r.key); } };
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); go(idx + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); go(idx - 1); }
    else if (k === 'PageDown') { e.preventDefault(); go(idx + Math.floor(viewH / ROW_H)); }
    else if (k === 'PageUp') { e.preventDefault(); go(idx - Math.floor(viewH / ROW_H)); }
    else if (k === 'Home') { e.preventDefault(); go(0); }
    else if (k === 'End') { e.preventDefault(); go(list.length - 1); }
    else if (k === 'ArrowRight' && selected?.tag === 'folder') { e.preventDefault(); if (!expanded.has(selected.key)) toggle(selected); else go(idx + 1); }
    else if (k === 'ArrowLeft' && selected) {
      e.preventDefault();
      if (selected.tag === 'folder' && expanded.has(selected.key)) toggle(selected);
      else { const p = findNode(parentKey(selected.key)); if (p) { select(p); scrollToKey(p.key); } }
    }
    else if (k === 'Enter') { e.preventDefault(); act('open', selected); }
    else if (k === 'F2') { e.preventDefault(); act('rename', selected); }
    else if (k === 'Delete') { e.preventDefault(); act('delete', selected); }
    else if (e.ctrlKey && k.toLowerCase() === 'x') { e.preventDefault(); act('cut', selected); }
    else if (e.ctrlKey && k.toLowerCase() === 'v') { e.preventDefault(); act('paste', selected); }
    else if (e.ctrlKey && k.toLowerCase() === 'p') { e.preventDefault(); act('print', selected); }
  };
  useEffect(() => {
    const g = e => {
      if (e.key === 'Escape' && fullPv && !dialog) { setFullPv(false); }
      else if (e.key === 'F5') { e.preventDefault(); act('refresh'); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setView('suche'); setTimeout(() => document.getElementById('q')?.focus(), 30); }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); act('back'); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); act('fwd'); }
    };
    window.addEventListener('keydown', g); return () => window.removeEventListener('keydown', g);
  });

  // ── Drag & Drop ──
  const dragStart = (e, n) => { dragNode.current = n; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.path); };
  const canDrop = (e, folder) => folder?.tag === 'folder' && (dragNode.current ? dragNode.current.key !== folder.key && !folder.key.startsWith(dragNode.current.key + '/') : [...e.dataTransfer.types].includes('Files'));
  const dragOver = (e, folder) => {
    if (!canDrop(e, folder)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragNode.current ? 'move' : 'copy';
    if (dropKey !== folder.key) {
      setDropKey(folder.key);
      clearTimeout(hoverTimer.current);
      if (!expanded.has(folder.key)) hoverTimer.current = setTimeout(() => toggle(folder, true), 900);
    }
  };
  const drop = async (e, folder) => {
    e.preventDefault(); clearTimeout(hoverTimer.current); setDropKey(null);
    const n = dragNode.current; dragNode.current = null;
    if (n) await moveTo(n, folder).catch(() => { });
    else if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files, folder);
  };
  const dragEnd = () => { dragNode.current = null; setDropKey(null); clearTimeout(hoverTimer.current); };

  const openCtx = (e, n) => {
    e.preventDefault();
    if (view === 'archiv') select(n); else setFocusNode(n);
    setCtx({ x: Math.min(e.clientX, innerWidth - 230), y: Math.min(e.clientY, innerHeight - 380), n });
  };
  useEffect(() => { if (!ctx) return; const c = () => setCtx(null); window.addEventListener('click', c); window.addEventListener('blur', c); return () => { window.removeEventListener('click', c); window.removeEventListener('blur', c); }; }, [ctx]);

  // ── Splitter ──
  const startSplit = e => {
    e.preventDefault();
    const x0 = e.clientX, w0 = treeW;
    const mv = ev => setTreeW(Math.max(240, Math.min(innerWidth - 320, w0 + ev.clientX - x0)));
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };

  // ── Darstellung ──
  const cur = current;
  const isFile = cur && cur.tag !== 'folder';
  const isMail = isFile && /^(eml|msg)$/.test(kindOf(cur.name));
  const inKlemm = cur && klemm.some(x => x.key === cur.key);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
  const last = Math.min(rows.length, first + Math.ceil(viewH / ROW_H) + 20);

  const renderRow = (r, list) => {
    const n = r.n;
    const sel = list ? focusNode?.key === n.key : selected?.key === n.key;
    const open = expanded.has(n.key);
    return (
      <div key={r.key || (n.key + n.id)} className={'row' + (sel ? ' sel' : '') + (cut?.key === n.key ? ' cut' : '') + (dropKey === n.key ? ' drop' : '')}
        style={list ? undefined : { paddingLeft: 4 + r.depth * 18, position: 'absolute', top: r.i * ROW_H, left: 0, right: 0 }}
        draggable onDragStart={e => dragStart(e, n)} onDragEnd={dragEnd}
        onDragOver={list ? undefined : e => dragOver(e, n)} onDragLeave={() => dropKey === n.key && setDropKey(null)} onDrop={list ? undefined : e => drop(e, n)}
        onClick={() => list ? setFocusNode(n) : select(n)}
        onDoubleClick={() => list ? (n.tag === 'folder' || view === 'suche' || view === 'klemmbrett' ? reveal(n.path) : act('open', n)) : (n.tag === 'folder' ? toggle(n) : act('open', n))}
        onContextMenu={e => openCtx(e, n)} title={n.path}>
        {!list && <span className="tw" onClick={e => { e.stopPropagation(); toggle(n); }}>{n.tag === 'folder' ? (open ? '▾' : '▸') : ''}</span>}
        <span className="ic">{iconOf(n)}</span>
        {n.tag !== 'folder' && <span className="dt">{fmtDate(docDate(n))}</span>}
        <span className="nm">{displayName(n)}</span>
        {meta.get(n.id) && <span className="mk" title="verschlagwortet">●</span>}
        {list && view !== 'postbox' && <span className="pth">{parentPath(n.path)}</span>}
      </div>
    );
  };

  const RB = ({ icon, label, onClick, disabled, active }) => (
    <button className={'rb' + (active ? ' on' : '')} onClick={onClick} disabled={disabled}><span className="rbi">{icon}</span><span className="rbl">{label}</span></button>
  );
  const Small = ({ icon, label, onClick, disabled }) => <button className="rs" onClick={onClick} disabled={disabled}><span>{icon}</span>{label}</button>;

  const listView = (items, empty) => (
    <div className="list">{items.length ? items.map(n => renderRow({ n }, true)) : <div className="list-empty">{empty}</div>}</div>
  );

  return (
    <div className="app" onDragOver={e => e.preventDefault()} onDrop={e => e.preventDefault()}>
      <div className="titlebar">
        <span className="brand">alyDoc <b>Klassik</b></span>
        <span className="tb-path">{isDemo ? 'Demo-Archiv' : account?.name?.display_name ? 'Dropbox · ' + account.name.display_name : 'Dropbox'}</span>
        <span className="grow" />
        <a className="tb-link" href="../index.html">Zur bisherigen alyDoc-Ansicht</a>
        {!isDemo && <button className="tb-btn" onClick={onSignOut}>Abmelden</button>}
      </div>

      <div className="ribbon">
        <div className="tabs">
          <button className="file-tab">alyDoc</button>
          {[['start', 'START'], ['ansicht', 'ANSICHT']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {tab === 'start' && (
          <div className="groups">
            <div className="grp"><div className="grp-b">
              <RB icon="⬅" label="Zurück" onClick={() => act('back')} disabled={history.pos <= 0} />
              <div className="stack">
                <Small icon="📌" label={inKlemm ? 'Vom Klemmbrett nehmen' : 'Auf das Klemmbrett legen'} onClick={() => act('klemm')} disabled={!cur} />
                <Small icon="🏠" label="Archivanfang" onClick={() => act('home')} />
                <Small icon="🔄" label="Aktualisieren (F5)" onClick={() => act('refresh')} />
              </div>
            </div><div className="grp-l">Navigation</div></div>
            <div className="grp"><div className="grp-b">
              <RB icon="📤" label={<>Dokument<br />hochladen</>} onClick={() => act('upload')} />
              <RB icon="📁" label={<>Neuer<br />Ordner</>} onClick={() => act('mkdir')} disabled={view !== 'archiv'} />
            </div><div className="grp-l">Neu</div></div>
            <div className="grp"><div className="grp-b">
              <RB icon="👁" label={<>Öffnen</>} onClick={() => act('open')} disabled={!isFile} />
              <RB icon="🖨" label={<>Drucken</>} onClick={() => act('print')} disabled={!isFile} />
              {isMail && nativeOpen() && <RB icon="📧" label={<>In Outlook<br />öffnen</>} onClick={() => act('outlook')} />}
            </div><div className="grp-l">Ansicht</div></div>
            <div className="grp"><div className="grp-b">
              <RB icon="🏷" label={<>Verschlag-<br />wortung</>} onClick={() => act('tag')} disabled={!isFile} />
              {view === 'postbox' && <RB icon="📥" label={<>Ablegen…</>} onClick={() => act('file')} disabled={!isFile} />}
            </div><div className="grp-l">Verschlagwortung</div></div>
            <div className="grp"><div className="grp-b">
              <div className="stack">
                <Small icon="✂" label="Ausschneiden (Strg+X)" onClick={() => act('cut')} disabled={!cur} />
                <Small icon="📋" label={cut ? 'Einfügen: ' + cut.name.slice(0, 22) : 'Einfügen (Strg+V)'} onClick={() => act('paste')} disabled={!cut || view !== 'archiv'} />
                <Small icon="✏" label="Umbenennen (F2)" onClick={() => act('rename')} disabled={!cur} />
              </div>
            </div><div className="grp-l">Bearbeiten</div></div>
            <div className="grp"><div className="grp-b">
              <RB icon="❌" label="Löschen" onClick={() => act('delete')} disabled={!cur} />
            </div><div className="grp-l">Löschen</div></div>
          </div>
        )}
        {tab === 'ansicht' && (
          <div className="groups">
            <div className="grp"><div className="grp-b">
              <RB icon="🪟" label={<>Vorschau<br />anzeigen</>} active={showPreview} onClick={() => setShowPreview(v => !v)} />
              <RB icon="⤒" label={<>Alles<br />zuklappen</>} onClick={() => { setExpanded(new Set()); select(null); }} />
            </div><div className="grp-l">Fenster</div></div>
            <div className="grp"><div className="grp-b">
              <RB icon="⬇" label={<>Datei<br />speichern</>} onClick={() => act('download')} disabled={!isFile} />
              <RB icon="🔗" label={<>Pfad<br />kopieren</>} onClick={() => { navigator.clipboard?.writeText(cur.path); say('Pfad kopiert'); }} disabled={!cur} />
            </div><div className="grp-l">Datei</div></div>
            <div className="grp"><div className="grp-b small-help">
              <div><b>Tastatur:</b> ↑ ↓ blättern · → aufklappen · ← zuklappen · Enter öffnen · F2 umbenennen · Entf löschen · Strg+X / Strg+V verschieben · Strg+F suchen · Alt+← zurück</div>
              <div><b>Maus:</b> Dokument auf Ordner ziehen = verschieben · Dateien aus dem Explorer auf einen Ordner ziehen = hochladen</div>
            </div><div className="grp-l">Hilfe</div></div>
          </div>
        )}
      </div>

      <div className="work">
        <nav className="nav">
          {[['archiv', '🗄', 'Archiv'], ['klemmbrett', '📌', 'Klemmbrett'], ['postbox', '📥', 'Postbox'], ['suche', '🔍', 'Suchen']].map(([k, i, l]) => (
            <button key={k} className={view === k ? 'on' : ''} onClick={() => { setView(k); setFocusNode(null); if (k === 'postbox') loadInbox(); if (k === 'suche') setTimeout(() => document.getElementById('q')?.focus(), 30); }}>
              <span className="ni">{i}</span><span>{l}</span>
              {k === 'postbox' && inbox?.length > 0 && <span className="badge">{inbox.length}</span>}
              {k === 'klemmbrett' && klemm.length > 0 && <span className="badge gray">{klemm.length}</span>}
            </button>
          ))}
        </nav>

        <div className="left" style={{ width: showPreview ? treeW : undefined, flex: showPreview ? 'none' : 1 }}>
          {view === 'archiv' && (
            <div className="tree" ref={treeRef} tabIndex={0} onKeyDown={onTreeKey} onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
              onDragOver={e => { if (!dragNode.current && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); }}
              onDrop={e => { if (e.target === e.currentTarget && e.dataTransfer.files?.length) { e.preventDefault(); uploadFiles(e.dataTransfer.files, folderOf(selected)); } }}
              onContextMenu={e => { if (e.target === e.currentTarget) { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, n: null }); } }}>
              <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
                {rows.slice(first, last).map((r, j) => {
                  const i = first + j;
                  if (r.loading || r.empty) return <div key={r.key} className="row ghost" style={{ position: 'absolute', top: i * ROW_H, left: 0, right: 0, paddingLeft: 26 + r.depth * 18 }}>{r.loading ? 'lade …' : '(leer)'}</div>;
                  return renderRow({ ...r, i });
                })}
              </div>
            </div>
          )}
          {view === 'klemmbrett' && (<>
            <div className="pane-head">Klemmbrett <span className="muted">– Doppelklick zeigt den Eintrag im Archiv</span></div>
            {listView(klemm, 'Leer. Eintrag markieren → „Auf das Klemmbrett legen“.')}
          </>)}
          {view === 'postbox' && (<>
            <div className="pane-head">Postbox
              <select className="pb-sel" value={POSTBOX} onChange={e => choosePostbox(e.target.value)}>
                {[...new Set([POSTBOX, ...pbChoices.map(n => n.path)])].map(p => <option key={p} value={p}>{p.replace(/^\//, '')}</option>)}
              </select><span className="grow" /><button onClick={() => act('upload')}>Hochladen</button></div>
            {inbox === false
              ? <div className="list-empty">Ordner {POSTBOX} gibt es noch nicht.<br /><button className="primary" onClick={async () => { await api.mkdir('', POSTBOX.slice(1)); await loadKids('', '', true); loadInbox(); }}>Postbox anlegen</button></div>
              : <div className="list" onDragOver={e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files, { path: POSTBOX, key: POSTBOX.toLowerCase(), name: 'Postbox' }); }}>
                {inbox === null ? <div className="list-empty">Lade …</div> : inbox.length === 0 ? <div className="list-empty">Postbox ist leer.<br /><span className="muted">Dateien hierher ziehen oder „Hochladen“.</span></div>
                  : inbox.map(n => renderRow({ n }, true))}
              </div>}
            {focusNode && view === 'postbox' && <div className="pane-foot"><button className="primary" onClick={() => act('file')}>📥 Ablegen …</button><button onClick={() => act('tag')}>🏷 Verschlagworten</button><button onClick={() => act('rename')}>✏ Umbenennen</button></div>}
          </>)}
          {view === 'suche' && (<>
            <form className="search" onSubmit={runSearch}>
              <input id="q" value={query} onChange={e => setQuery(e.target.value)} placeholder="Dateiname, Inhalt, Stichwort, Kunde …" />
              <button className="primary" disabled={searching}>{searching ? '…' : 'Suchen'}</button>
            </form>
            {results === null ? <div className="list-empty muted">Sucht in Dateinamen, Dateiinhalten (Dropbox) und in der Verschlagwortung.</div>
              : listView(results, 'Nichts gefunden.')}
            {results?.length > 0 && <div className="pane-foot muted">{results.length} Treffer · Doppelklick = im Archiv zeigen</div>}
          </>)}
        </div>

        {showPreview && <div className="split" onMouseDown={startSplit} />}
        {showPreview && (
          <div className={'right' + (fullPv ? ' full' : '')}>
            <Preview node={cur} api={api} demo={isDemo} meta={meta} onAction={a => act(a)} registerPrint={fn => { printRef.current = fn; }} full={fullPv} onFull={() => setFullPv(v => !v)} />
          </div>
        )}
      </div>

      <div className="status">
        <span>{cur ? cur.path : { archiv: 'Archiv', klemmbrett: 'Klemmbrett', postbox: 'Postbox ' + POSTBOX, suche: 'Suche' }[view]}</span>
        <span className="grow" />
        {cut && <span className="st-cut">✂ {cut.name}</span>}
        <span className="muted">{BUILD}</span>
      </div>

      {ctx && (
        <div className="ctx" style={{ left: ctx.x, top: ctx.y }} onClick={e => e.stopPropagation()}>
          {ctx.n ? (<>
            {ctx.n.tag === 'folder'
              ? <button onClick={() => view === 'archiv' ? act('open', ctx.n) : act('reveal', ctx.n)}>📂 {view === 'archiv' && expanded.has(ctx.n.key) ? 'Zuklappen' : 'Öffnen'}</button>
              : <button onClick={() => act('open', ctx.n)}>👁 Öffnen</button>}
            {view !== 'archiv' && <button onClick={() => act('reveal', ctx.n)}>🗄 Im Archiv zeigen</button>}
            {view === 'postbox' && ctx.n.tag !== 'folder' && <button onClick={() => act('file', ctx.n)}>📥 Ablegen …</button>}
            {ctx.n.tag !== 'folder' && /^(eml|msg)$/.test(kindOf(ctx.n.name)) && nativeOpen() && <button onClick={() => act('outlook', ctx.n)}>📧 In Outlook öffnen</button>}
            {ctx.n.tag !== 'folder' && <button onClick={() => act('download', ctx.n)}>⬇ Datei speichern</button>}
            <hr />
            {view === 'archiv' && <button onClick={() => act('mkdir', ctx.n)}>📁 {ctx.n.tag === 'folder' ? 'Neuer Unterordner' : 'Neuer Ordner'}</button>}
            {view === 'archiv' && ctx.n.tag === 'folder' && <button onClick={() => act('upload', ctx.n)}>📤 Hierher hochladen</button>}
            {ctx.n.tag !== 'folder' && <button onClick={() => act('tag', ctx.n)}>🏷 Verschlagwortung</button>}
            <button onClick={() => act('klemm', ctx.n)}>📌 {klemm.some(x => x.key === ctx.n.key) ? 'Vom Klemmbrett nehmen' : 'Auf das Klemmbrett'}</button>
            <hr />
            <button onClick={() => act('cut', ctx.n)}>✂ Ausschneiden</button>
            {cut && view === 'archiv' && <button onClick={() => act('paste', ctx.n)}>📋 Einfügen ({cut.name.slice(0, 20)})</button>}
            <button onClick={() => act('rename', ctx.n)}>✏ Umbenennen</button>
            <button className="danger" onClick={() => act('delete', ctx.n)}>❌ Löschen</button>
          </>) : (<>
            <button onClick={() => act('mkdir', null)}>📁 Neuer Ordner (oberste Ebene)</button>
            <button onClick={() => act('refresh', null)}>🔄 Aktualisieren</button>
          </>)}
        </div>
      )}

      {dialog}
      {toast && <div className={'toast ' + toast.kind}>{toast.text}</div>}
      <input ref={fileInput} type="file" multiple hidden onChange={e => { const t = JSON.parse(e.target.dataset.target || '{}'); uploadFiles(e.target.files, t); e.target.value = ''; }} />
    </div>
  );
}
