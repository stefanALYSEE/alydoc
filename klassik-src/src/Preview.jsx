import React, { useEffect, useRef, useState } from 'react';
import PostalMime from 'postal-mime';
import { kindOf, fmtDateTime, fmtSize, fmtDate, docDate, displayName, downloadBlob, iconOf } from './util.js';
import { dtOf } from './meta.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const addr = a => !a ? '' : (a.name ? `${a.name} <${a.address || ''}>` : a.address || '');
const MAIL_CSS = '<base target="_blank"><style>body{margin:0;padding:14px 18px;font:13px/1.5 "Segoe UI",system-ui,sans-serif;color:#1b1b1b}img{max-width:100%;height:auto}pre{white-space:pre-wrap;font:inherit}</style>';

// pdf.js liegt als globales pdfjsLib vor (../vendor/pdf.min.js)
function pdfLib() {
  const lib = window.pdfjsLib;
  if (lib && !lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.js', document.baseURI).href;
  return lib;
}

function PdfView({ blob }) {
  const ref = useRef(null);
  const [info, setInfo] = useState('');
  useEffect(() => {
    let cancelled = false, doc = null;
    const host = ref.current; host.innerHTML = '';
    (async () => {
      const lib = pdfLib();
      if (!lib) { setInfo('PDF-Anzeige nicht geladen'); return; }
      doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      if (cancelled) return;
      setInfo(doc.numPages + (doc.numPages === 1 ? ' Seite' : ' Seiten'));
      const width = Math.max(300, host.clientWidth - 24);
      for (let i = 1; i <= doc.numPages && !cancelled; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const dpr = window.devicePixelRatio || 1;
        const vp = page.getViewport({ scale: scale * dpr });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        c.style.width = width + 'px'; c.style.height = (vp.height / dpr) + 'px';
        c.className = 'pdf-page';
        host.appendChild(c);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }
    })().catch(e => !cancelled && setInfo('PDF konnte nicht angezeigt werden: ' + e.message));
    return () => { cancelled = true; doc?.destroy?.(); };
  }, [blob]);
  return <div className="pdf-wrap"><div className="pdf-info">{info}</div><div ref={ref} className="pdf-pages" /></div>;
}

function MailView({ mail, frameRef }) {
  const openAtt = a => {
    const blob = new Blob([a.content], { type: a.mimeType || 'application/octet-stream' });
    if (/pdf|image/.test(a.mimeType || '')) window.open(URL.createObjectURL(blob), '_blank');
    else downloadBlob(blob, a.filename || 'Anhang');
  };
  return (
    <div className="mail">
      <table className="mail-head"><tbody>
        <tr><th>Von:</th><td>{mail.from}</td></tr>
        {mail.date && <tr><th>Gesendet:</th><td>{mail.date}</td></tr>}
        {mail.to && <tr><th>An:</th><td>{mail.to}</td></tr>}
        {mail.cc && <tr><th>Cc:</th><td>{mail.cc}</td></tr>}
        <tr><th>Betreff:</th><td><b>{mail.subject}</b></td></tr>
      </tbody></table>
      {mail.atts.length > 0 && (
        <div className="mail-atts">📎 {mail.atts.map((a, i) => (
          <button key={i} className="att" onClick={() => openAtt(a)} title="Öffnen / Speichern">{a.filename || 'Anhang'}{a.content ? ' · ' + fmtSize(a.content.byteLength || a.content.length) : ''}</button>
        ))}</div>
      )}
      <iframe ref={frameRef} className="mail-body" title="Mail" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals" srcDoc={mail.html} />
    </div>
  );
}

async function parseEml(blob) {
  const m = await PostalMime.parse(await blob.arrayBuffer());
  let html = m.html;
  const atts = [];
  for (const a of m.attachments || []) {
    const u8 = new Uint8Array(a.content);
    if (a.contentId && html) {
      const cid = a.contentId.replace(/^<|>$/g, '');
      if (html.includes('cid:' + cid)) { html = html.split('cid:' + cid).join(`data:${a.mimeType};base64,${b64(u8)}`); if (a.disposition === 'inline') continue; }
    }
    atts.push({ filename: a.filename, mimeType: a.mimeType, content: u8 });
  }
  const body = html || `<pre>${esc(m.text || '(kein Text)')}</pre>`;
  return {
    from: addr(m.from), to: (m.to || []).map(addr).join('; '), cc: (m.cc || []).map(addr).join('; '),
    subject: m.subject || '(kein Betreff)', date: m.date ? fmtDateTime(m.date) : '',
    atts, html: MAIL_CSS + body,
  };
}

let msgMod = null;
async function parseMsg(blob) {
  if (!msgMod) msgMod = import(/* @vite-ignore */ new URL('../msgreader.bundle.v2.js', document.baseURI).href).then(m => m.default);
  const MsgReader = await msgMod;
  const reader = new MsgReader(new Uint8Array(await blob.arrayBuffer()));
  const d = reader.getFileData();
  let body = d.bodyHtml || d.bodyHTML;
  if (body && /<\w+[\s>]/.test(body)) {
    body = body.replace(/<meta[^>]+(?:charset|http-equiv\s*=\s*["']?content-type)[^>]*\/?>/gi, '');
    const bm = body.match(/<body[^>]*>([\s\S]*)<\/body>/i); if (bm) body = bm[1];
  } else body = `<pre>${esc(d.body || '(kein Text)')}</pre>`;
  const atts = [];
  for (const a of d.attachments || []) {
    try { const r = reader.getAttachment(a); atts.push({ filename: r.fileName || a.fileName, mimeType: /\.pdf$/i.test(a.fileName || '') ? 'application/pdf' : '', content: r.content }); }
    catch { atts.push({ filename: a.fileName, mimeType: '', content: new Uint8Array() }); }
  }
  const to = (d.recipients || []).map(r => r.name || r.email || r.smtpAddress).filter(Boolean).join('; ');
  const dt = d.clientSubmitTime || d.messageDeliveryTime || d.creationTime;
  return { from: [d.senderName, d.senderEmail && `<${d.senderEmail}>`].filter(Boolean).join(' '), to, cc: '', subject: d.subject || '(kein Betreff)', date: dt ? fmtDateTime(dt) : '', atts, html: MAIL_CSS + body };
}

export default function Preview({ node, api, demo, meta, onAction, registerPrint }) {
  const [state, setState] = useState({ status: 'idle' });
  const frameRef = useRef(null);

  useEffect(() => {
    setState({ status: 'idle' });
    registerPrint?.(null);
    if (!node || node.tag === 'folder') return;
    let cancelled = false;
    const kind = kindOf(node.name);
    setState({ status: 'loading' });
    (async () => {
      let res;
      if (kind === 'pdf') res = { type: 'pdf', blob: await api.download(node.path) };
      else if (kind === 'image') res = { type: 'image', url: URL.createObjectURL(await api.download(node.path)) };
      else if (kind === 'thumb') res = { type: 'image', url: URL.createObjectURL(await api.thumbnail(node.path)) };
      else if (kind === 'eml') res = { type: 'mail', mail: await parseEml(await api.download(node.path)) };
      else if (kind === 'msg') res = { type: 'mail', mail: await parseMsg(await api.download(node.path)) };
      else if (kind === 'office') {
        const b = await api.preview(node.path);
        res = /html/.test(b.type) ? { type: 'html', html: await b.text() } : { type: 'pdf', blob: new Blob([b], { type: 'application/pdf' }) };
      }
      else if (kind === 'text') res = { type: 'text', text: (await (await api.download(node.path)).text()).slice(0, 200000) };
      else if (node.size > 0 && node.size < 30e6 && demo) res = { type: 'text', text: await (await api.download(node.path)).text() };
      else res = { type: 'none' };
      if (!cancelled) setState({ status: 'ok', ...res });
    })().catch(e => !cancelled && setState({ status: 'error', error: e.message }));
    return () => { cancelled = true; };
  }, [node?.key, node?.id]);

  // Drucken: PDF über unsichtbaren iframe, Mails/Text direkt aus dem Vorschau-iframe
  useEffect(() => {
    if (state.status !== 'ok') return;
    if (state.type === 'pdf') {
      registerPrint?.(() => {
        const url = URL.createObjectURL(state.blob);
        const f = document.createElement('iframe');
        f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
        f.src = url; document.body.appendChild(f);
        f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(url, '_blank'); } setTimeout(() => f.remove(), 60000); };
      });
    } else if (state.type === 'mail' || state.type === 'html') {
      registerPrint?.(() => { try { frameRef.current.contentWindow.print(); } catch { } });
    } else if (state.type === 'image' || state.type === 'text') {
      registerPrint?.(() => {
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(state.type === 'image' ? `<img src="${state.url}" style="max-width:100%">` : `<pre style="white-space:pre-wrap;font:12px monospace">${esc(state.text)}</pre>`);
        w.document.close(); setTimeout(() => w.print(), 300);
      });
    }
  }, [state]);

  if (!node) return <div className="pv-empty"><div className="pv-logo">alyDoc</div><div>Eintrag im Archiv anklicken – die Vorschau erscheint hier.</div></div>;

  if (node.tag === 'folder') return (
    <div className="pv-empty"><div className="pv-big">📁</div><div className="pv-title">{node.name}</div><div className="muted">{node.path}</div><div className="muted" style={{ marginTop: 8 }}>Ordner – Doppelklick oder → klappt ihn auf.</div></div>
  );

  const entry = meta.get(node.id);
  return (
    <div className="pv">
      <div className="pv-head">
        <div className="pv-name" title={node.path}>{iconOf(node)} {displayName(node)}</div>
        <div className="pv-sub">{fmtDate(docDate(node))} · {fmtSize(node.size)} · {node.path}</div>
        {entry && (
          <div className="pv-tags">
            <span className="tag strong">{dtOf(entry.docType).label}</span>
            {Object.entries(entry.fields || {}).filter(([, v]) => v).map(([k, v]) => <span key={k} className="tag">{v}</span>)}
            {(entry.keywords || []).map(k => <span key={k} className="tag kw">#{k}</span>)}
          </div>
        )}
      </div>
      <div className="pv-body">
        {state.status === 'loading' && <div className="pv-msg">Lade Vorschau …</div>}
        {state.status === 'error' && <div className="pv-msg err">Vorschau nicht möglich: {state.error}<br /><button onClick={() => onAction('open')}>Datei öffnen</button></div>}
        {state.status === 'ok' && state.type === 'pdf' && <PdfView blob={state.blob} />}
        {state.status === 'ok' && state.type === 'image' && <div className="pv-img"><img src={state.url} alt="" /></div>}
        {state.status === 'ok' && state.type === 'mail' && <MailView mail={state.mail} frameRef={frameRef} />}
        {state.status === 'ok' && state.type === 'html' && <iframe ref={frameRef} className="pv-frame" title="Vorschau" sandbox="allow-same-origin allow-modals" srcDoc={state.html} />}
        {state.status === 'ok' && state.type === 'text' && <pre className="pv-text">{state.text}</pre>}
        {state.status === 'ok' && state.type === 'none' && <div className="pv-msg">Für diesen Dateityp gibt es keine Vorschau.<br /><button onClick={() => onAction('open')}>Datei öffnen / speichern</button></div>}
      </div>
    </div>
  );
}
