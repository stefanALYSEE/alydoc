/* eslint-disable no-restricted-globals */
// Liest .3dm-Dateien mit rhino3dm im Hintergrund und liefert wenige, nach Farbe gebündelte Puffer zurück.
// Grund: der Three.js-Rhino3dmLoader baut jedes Objekt einzeln im Hauptthread – bei Zeichnungen mit
// 20.000+ Kurven friert der Browser ein (gemessen 2026-10-19 an „FT 114 FR vereinfacht.3dm“).

let rhinoReady = null;

self.onmessage = async e => {
  const { buf, libPath } = e.data;
  try {
    if (!rhinoReady) {
      self.importScripts(libPath + 'rhino3dm.js');
      rhinoReady = self.rhino3dm({ locateFile: f => libPath + f });
    }
    const rhino = await rhinoReady;
    self.postMessage(convert(rhino, new Uint8Array(buf)), collectTransfer(lastResult));
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};

let lastResult = null;
function collectTransfer(r) {
  const t = [];
  for (const m of r.meshes) t.push(m.pos.buffer, m.idx.buffer);
  for (const l of r.lines) t.push(l.pos.buffer);
  return t;
}

function convert(rhino, bytes) {
  const doc = rhino.File3dm.fromByteArray(bytes);
  if (!doc) throw new Error('Keine gültige 3DM-Datei');
  const layers = doc.layers();
  const layerInfo = [];
  for (let i = 0; i < layers.count; i++) { const l = layers.get(i); layerInfo.push({ visible: l.visible, color: l.color }); l.delete(); }

  const objs = doc.objects();
  const byId = new Map();
  for (let i = 0; i < objs.count; i++) byId.set(objs.get(i).attributes().id, i);

  const meshB = new Map(); // farbe → {pos:[], idx:[], base}
  const lineB = new Map(); // farbe → []
  let tris = 0, curves = 0, skipped = 0;

  const colorOf = attr => {
    let c;
    try { c = attr.drawColor(doc); } catch { c = null; }
    if (!c) { const l = layerInfo[attr.layerIndex]; c = l ? l.color : { r: 90, g: 140, b: 210 }; }
    return (c.r << 16) | (c.g << 8) | c.b;
  };
  const tf = (m, x, y, z) => m ? [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]] : [x, y, z];
  const mul = (a, b) => { if (!a) return b; if (!b) return a; const r = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j]; r[i * 4 + j] = s; } return r; };

  function addMesh(mesh, col, M) {
    const v = mesh.vertices(), f = mesh.faces();
    let b = meshB.get(col); if (!b) { b = { pos: [], idx: [] }; meshB.set(col, b); }
    const base = b.pos.length / 3;
    for (let i = 0; i < v.count; i++) { const p = v.get(i); const q = tf(M, p[0], p[1], p[2]); b.pos.push(q[0], q[1], q[2]); }
    for (let i = 0; i < f.count; i++) {
      const q = f.get(i); // [a,b,c,d]; Dreieck wenn c===d
      b.idx.push(base + q[0], base + q[1], base + q[2]); tris++;
      if (q[2] !== q[3]) { b.idx.push(base + q[0], base + q[2], base + q[3]); tris++; }
    }
    v.delete && v.delete(); f.delete && f.delete();
  }

  function curvePts(c) {
    if (c instanceof rhino.LineCurve) return [c.pointAtStart, c.pointAtEnd];
    if (c instanceof rhino.PolylineCurve) { const r = []; for (let i = 0; i < c.pointCount; i++) r.push(c.point(i)); return r; }
    if (c instanceof rhino.PolyCurve) { let r = []; for (let i = 0; i < c.segmentCount; i++) { const s = c.segmentCurve(i); r = r.concat(curvePts(s)); s.delete(); } return r; }
    if (c instanceof rhino.NurbsCurve && c.degree === 1) { const pl = c.tryGetPolyline(); const r = []; for (let i = 0; i < pl.count; i++) r.push(pl.get(i)); pl.delete(); return r; }
    let n = 24;
    if (c instanceof rhino.ArcCurve) n = Math.max(3, Math.min(72, Math.floor(c.angleDegrees / 5)));
    const d = c.domain, r = [];
    for (let j = 0; j <= n; j++) r.push(c.pointAt(d[0] + (j / n) * (d[1] - d[0])));
    return r;
  }
  function addCurve(c, col, M) {
    const pts = curvePts(c);
    let b = lineB.get(col); if (!b) { b = []; lineB.set(col, b); }
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = tf(M, pts[i][0], pts[i][1], pts[i][2]), z = tf(M, pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]);
      b.push(a[0], a[1], a[2], z[0], z[1], z[2]);
    }
    curves++;
  }

  let wire = 0;
  function addEdges(brep, M) {
    const e = brep.edges();
    for (let k = 0; k < e.count; k++) { const c = e.get(k); addCurve(c, 0x2d3a4a, M); curves--; }
    wire++;
  }

  const T = rhino.ObjectType;
  function addGeometry(g, col, M, depth) {
    const t = g.objectType;
    if (t === T.Mesh) addMesh(g, col, M);
    else if (t === T.Brep) {
      const faces = g.faces();
      let any = false;
      for (let j = 0; j < faces.count; j++) { const f = faces.get(j); const m = f.getMesh(rhino.MeshType.Any); if (m) { addMesh(m, col, M); m.delete(); any = true; } f.delete(); }
      faces.delete();
      // Datei ohne Render-Netze („Klein speichern“ / nie schattiert) → rhino3dm kann nicht vernetzen → Kanten als Drahtmodell
      if (!any) addEdges(g, M);
    } else if (t === T.Extrusion) {
      const m = g.getMesh(rhino.MeshType.Any);
      if (m) { addMesh(m, col, M); m.delete(); }
      else { const b = g.toBrep(true); if (b) { addEdges(b, M); b.delete(); } else skipped++; }
    }
    else if (t === T.SubD) { try { const m = rhino.Mesh.createFromSubDControlNet(g, false); if (m) { addMesh(m, col, M); m.delete(); } } catch { skipped++; } }
    else if (t === T.Curve) addCurve(g, col, M);
    else if (t === T.InstanceReference && depth < 8) {
      const xf = g.xform.toFloatArray(true);
      const idefs = doc.instanceDefinitions();
      for (let k = 0; k < idefs.count; k++) {
        const d = idefs.get(k);
        if (d.id !== g.parentIdefId) continue;
        for (const id of d.getObjectIds()) {
          const ix = byId.get(id); if (ix === undefined) continue;
          const o = objs.get(ix); const og = o.geometry(); const oa = o.attributes();
          addGeometry(og, colorOf(oa), mul(M, xf), depth + 1);
        }
      }
    }
  }

  for (let i = 0; i < objs.count; i++) {
    const o = objs.get(i);
    const a = o.attributes();
    if (a.isInstanceDefinitionObject || !a.visible) continue;
    const l = layerInfo[a.layerIndex];
    if (l && !l.visible) continue;
    try { addGeometry(o.geometry(), colorOf(a), null, 0); } catch { skipped++; }
  }

  let units = '';
  try { const u = doc.settings().modelUnitSystem; units = Object.keys(rhino.UnitSystem).find(k => rhino.UnitSystem[k] === u) || ''; } catch { }

  const r = {
    meshes: [...meshB].map(([color, b]) => ({ color, pos: new Float32Array(b.pos), idx: new Uint32Array(b.idx) })),
    lines: [...lineB].map(([color, b]) => ({ color, pos: new Float32Array(b) })),
    tris, curves, skipped, units, wire,
  };
  lastResult = r;
  doc.delete();
  return r;
}
