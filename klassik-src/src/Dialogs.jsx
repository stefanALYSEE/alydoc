import React, { useEffect, useRef, useState } from 'react';
import { DOCTYPES, dtOf, guessDocType } from './meta.js';
import { sortNodes, store } from './util.js';

export function Modal({ title, children, onClose, footer, wide }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-title">{title}<button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function PromptDialog({ title, label, initial = '', okLabel = 'OK', onOk, onClose, selectStem }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; el.focus();
    const dot = initial.lastIndexOf('.');
    if (selectStem && dot > 0) el.setSelectionRange(0, dot); else el.select();
  }, []);
  const ok = async () => {
    const t = v.trim();
    if (!t || /[\\/]/.test(t)) return;
    setBusy(true);
    try { await onOk(t); onClose(); } catch { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<><button onClick={onClose}>Abbrechen</button><button className="primary" disabled={busy} onClick={ok}>{okLabel}</button></>}>
      <label className="fld"><span>{label}</span><input ref={ref} value={v} onChange={e => setV(e.target.value)} onKeyDown={e => e.key === 'Enter' && ok()} /></label>
    </Modal>
  );
}

export function ConfirmDialog({ title, text, okLabel = 'OK', danger, onOk, onClose }) {
  const [busy, setBusy] = useState(false);
  const ok = async () => { setBusy(true); try { await onOk(); onClose(); } catch { setBusy(false); } };
  return (
    <Modal title={title} onClose={onClose} footer={<><button onClick={onClose}>Abbrechen</button><button className={danger ? 'danger' : 'primary'} disabled={busy} onClick={ok} autoFocus>{okLabel}</button></>}>
      <p style={{ margin: 0, lineHeight: 1.5 }}>{text}</p>
    </Modal>
  );
}

export function TagDialog({ node, existing, onSave, onClose }) {
  const [docType, setDocType] = useState(existing?.docType || guessDocType(node.name));
  const [fields, setFields] = useState(existing?.fields || {});
  const [keywords, setKeywords] = useState((existing?.keywords || []).join(', '));
  const [notes, setNotes] = useState(existing?.notes || '');
  const [busy, setBusy] = useState(false);
  const dt = dtOf(docType);
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ docType, fields, keywords: keywords.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean), notes });
      onClose();
    } catch { setBusy(false); }
  };
  return (
    <Modal title={'Verschlagwortung – ' + node.name} onClose={onClose} footer={<><button onClick={onClose}>Abbrechen</button><button className="primary" disabled={busy} onClick={save}>Speichern</button></>}>
      <label className="fld"><span>Dokumenttyp</span>
        <select value={docType} onChange={e => setDocType(e.target.value)}>{DOCTYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select>
      </label>
      {dt.fields.map(([k, l, t]) => (
        <label key={k} className="fld"><span>{l}</span><input type={t} value={fields[k] || ''} onChange={e => setFields(p => ({ ...p, [k]: e.target.value }))} /></label>
      ))}
      <label className="fld"><span>Stichwörter</span><input value={keywords} placeholder="durch Komma getrennt" onChange={e => setKeywords(e.target.value)} /></label>
      <label className="fld"><span>Notiz</span><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    </Modal>
  );
}

// Ordnerauswahl für „Ablegen“ aus der Postbox: kleiner Archivbaum + zuletzt benutzte Ziele
export function FilingDialog({ node, api, onFile, onClose }) {
  const [name, setName] = useState(node.name);
  const [target, setTarget] = useState(null);
  const [kids, setKids] = useState({});
  const [open, setOpen] = useState(new Set(['']));
  const [busy, setBusy] = useState(false);
  const recent = store.get('klassik_recent_targets', []);

  const load = async key => {
    if (kids[key]) return;
    const list = await api.list(key);
    setKids(p => ({ ...p, [key]: sortNodes(list.filter(n => n.tag === 'folder')) }));
  };
  useEffect(() => { load(''); }, []);
  const toggle = async n => {
    setTarget(n.path);
    const s = new Set(open);
    if (s.has(n.key)) s.delete(n.key); else { s.add(n.key); await load(n.key); }
    setOpen(s);
  };
  const rows = [];
  const walk = (key, depth) => (kids[key] || []).forEach(n => { rows.push({ n, depth }); if (open.has(n.key)) walk(n.key, depth + 1); });
  walk('', 0);

  const ok = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await onFile(target, name.trim() || node.name);
      store.set('klassik_recent_targets', [target, ...recent.filter(r => r !== target)].slice(0, 8));
      onClose();
    } catch { setBusy(false); }
  };
  return (
    <Modal wide title="Dokument ablegen" onClose={onClose} footer={<><span className="muted grow">{target ? 'Ziel: ' + target : 'Bitte Zielordner wählen'}</span><button onClick={onClose}>Abbrechen</button><button className="primary" disabled={!target || busy} onClick={ok}>Ablegen</button></>}>
      <label className="fld"><span>Kurzbezeichnung</span><input value={name} onChange={e => setName(e.target.value)} /></label>
      {recent.length > 0 && <div className="recent"><span className="muted">Zuletzt:</span>{recent.map(r => <button key={r} className={'chip' + (target === r ? ' on' : '')} onClick={() => setTarget(r)} title={r}>{r.split('/').slice(-2).join(' / ')}</button>)}</div>}
      <div className="picker">
        {rows.map(({ n, depth }) => (
          <div key={n.key} className={'pick-row' + (target === n.path ? ' sel' : '')} style={{ paddingLeft: 8 + depth * 16 }} onClick={() => toggle(n)} onDoubleClick={ok}>
            <span className="tw">{open.has(n.key) ? '▾' : '▸'}</span>📁 {n.name}
          </div>
        ))}
        {!kids[''] && <div className="muted" style={{ padding: 8 }}>Lade Ordner …</div>}
      </div>
    </Modal>
  );
}
