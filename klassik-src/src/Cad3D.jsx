// 3D-/CAD-Vorschau für alyDoc Klassik (wird erst bei Bedarf nachgeladen).
// Netze: STL, OBJ, PLY, FBX, 3MF, GLB/GLTF, WRL · Rhino: 3DM · B-Rep: STEP/STP, IGES/IGS (OpenCascade-WASM) · 2D: DXF
// Alle Bibliotheken liegen im eigenen Build (three, Loader) bzw. unter ./rhino3dm, ./draco, ./occt – kein CDN.
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js';
import { DxfViewer } from 'dxf-viewer';

const asset = p => new URL(p, document.baseURI).href;
const Z_UP = ['3dm', 'step', 'stp', 'igs', 'iges', 'stl', '3mf'];
const fmt = v => v >= 100 ? Math.round(v).toLocaleString('de-DE') : v.toLocaleString('de-DE', { maximumFractionDigits: 1 });

let occtPromise = null;
function loadOcct() {
  if (!occtPromise) occtPromise = new Promise((res, rej) => {
    const go = () => window.occtimportjs({ locateFile: f => asset('./occt/' + f) }).then(res, rej);
    if (window.occtimportjs) return go();
    const s = document.createElement('script');
    s.src = asset('./occt/occt-import-js.js'); s.onload = go; s.onerror = () => rej(new Error('STEP-Modul nicht geladen'));
    document.head.appendChild(s);
  }).catch(e => { occtPromise = null; throw e; });
  return occtPromise;
}

const parseWith = (loader, ...args) => new Promise((res, rej) => loader.parse(...args, res, rej));

async function buildObject(ext, blob) {
  const buf = await blob.arrayBuffer();
  const blue = () => new THREE.MeshStandardMaterial({ color: 0x5b8fd6, metalness: 0.05, roughness: 0.6, side: THREE.DoubleSide });
  switch (ext) {
    case 'stl': { const g = new STLLoader().parse(buf); g.computeVertexNormals(); return new THREE.Mesh(g, blue()); }
    case 'ply': { const g = new PLYLoader().parse(buf); if (!g.attributes.normal) g.computeVertexNormals(); return new THREE.Mesh(g, g.attributes.color ? new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide }) : blue()); }
    case 'obj': return new OBJLoader().parse(new TextDecoder().decode(buf));
    case 'fbx': return new FBXLoader().parse(buf, '');
    case '3mf': return new ThreeMFLoader().parse(buf);
    case 'wrl': return new VRMLLoader().parse(new TextDecoder().decode(buf), '');
    case 'glb': case 'gltf': {
      const l = new GLTFLoader();
      const d = new DRACOLoader(); d.setDecoderPath(asset('./draco/')); l.setDRACOLoader(d);
      const g = await parseWith(l, buf, '');
      return g.scene;
    }
    case '3dm': {
      // eigener Worker statt Rhino3dmLoader (der friert bei vielen Objekten den Browser ein)
      const r = await new Promise((res, rej) => {
        const w = new Worker(new URL('./rhinoWorker.js', import.meta.url));
        w.onmessage = e => { w.terminate(); e.data.error ? rej(new Error(e.data.error)) : res(e.data); };
        w.onerror = e => { w.terminate(); rej(new Error(e.message || '3DM-Worker fehlgeschlagen')); };
        w.postMessage({ buf, libPath: asset('./rhino3dm/') }, [buf]);
      });
      const group = new THREE.Group();
      for (const m of r.meshes) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
        g.setIndex(new THREE.BufferAttribute(m.idx, 1));
        g.computeVertexNormals();
        const col = m.color === 0 || m.color === 0xffffff ? 0x9aa7b6 : m.color;
        group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, metalness: 0.05, roughness: 0.6, side: THREE.DoubleSide })));
      }
      for (const l of r.lines) {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(l.pos, 3));
        group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: l.color === 0xffffff ? 0x333333 : l.color })));
      }
      group.userData = { units: { Millimeters: 'mm', Centimeters: 'cm', Meters: 'm', Inches: 'Zoll' }[r.units] || '', wire: r.wire };
      return group;
    }
    case 'step': case 'stp': case 'igs': case 'iges': {
      const occt = await loadOcct();
      const u8 = new Uint8Array(buf);
      const r = ext.startsWith('i') ? occt.ReadIgesFile(u8, null) : occt.ReadStepFile(u8, null);
      if (!r.success) throw new Error('Datei konnte nicht gelesen werden');
      const group = new THREE.Group();
      for (const m of r.meshes) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
        if (m.attributes.normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
        else g.computeVertexNormals();
        g.setIndex(m.index.array);
        const col = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color(0x9aa7b6);
        group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, metalness: 0.1, roughness: 0.55, side: THREE.DoubleSide })));
      }
      return group;
    }
    default: throw new Error('Format nicht unterstützt');
  }
}

export function Model3D({ blob, ext }) {
  const host = useRef(null);
  const api = useRef(null);
  const [state, setState] = useState({ s: 'loading' });
  const [mode, setMode] = useState('rotate');
  const [edges, setEdges] = useState(['step', 'stp', 'igs', 'iges'].includes(ext));
  const edgesOnRef = useRef(edges); edgesOnRef.current = edges;

  useEffect(() => {
    let disposed = false, raf = 0, ro = null, renderer = null;
    const el = host.current;
    (async () => {
      const obj = await buildObject(ext, blob);
      if (disposed) return;
      const zUp = Z_UP.includes(ext);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf2f3f5);
      const w = el.clientWidth || 600, h = el.clientHeight || 400;
      const camera = new THREE.PerspectiveCamera(40, w / h, 0.01, 1e7);
      if (zUp) camera.up.set(0, 0, 1);
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(w, h);
      el.innerHTML = ''; el.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.6);
      camera.add(key); key.position.set(1, 1, 2); scene.add(camera);

      // Materialien ohne Texturen/fast unsichtbar → einheitlich einfärben (alyDoc-Erfahrung FBX/3DM)
      let tris = 0, curves = 0;
      obj.updateMatrixWorld(true);
      const lineBuckets = new Map(); // Farbe → Segmentpunkte (Welt-Koordinaten)
      const drop = [];
      const v = new THREE.Vector3();
      obj.traverse(c => {
        if (c.isMesh) {
          c.visible = true;
          if (c.geometry && !c.geometry.attributes.normal) c.geometry.computeVertexNormals();
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          if (ext === 'fbx' || mats.some(m => !m || (m.transparent && m.opacity < 0.05) || (m.map && !m.map.image))) {
            c.material = new THREE.MeshStandardMaterial({ color: 0x5b8fd6, roughness: 0.6, side: THREE.DoubleSide });
          } else mats.forEach(m => { if (m) m.side = THREE.DoubleSide; });
          const g = c.geometry;
          tris += g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3;
        } else if (c.isLine && c.geometry?.attributes.position) {
          // Rhino-Zeichnungen haben oft zehntausende Einzelkurven → zu wenigen LineSegments zusammenfassen
          const pos = c.geometry.attributes.position, idx = c.geometry.index;
          const col = (c.material?.color?.getHex?.() ?? 0x333333);
          const arr = lineBuckets.get(col) || []; lineBuckets.set(col, arr);
          const pt = i => { v.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld); arr.push(v.x, v.y, v.z); };
          const n = idx ? idx.count : pos.count, get = i => idx ? idx.getX(i) : i;
          if (c.isLineSegments) for (let i = 0; i < n; i++) pt(get(i));
          else for (let i = 0; i + 1 < n; i++) { pt(get(i)); pt(get(i + 1)); }
          if (c.isLineLoop && n > 2) { pt(get(n - 1)); pt(get(0)); }
          drop.push(c); curves++;
        }
      });
      drop.forEach(c => { c.parent?.remove(c); c.geometry?.dispose(); });
      for (const [col, arr] of lineBuckets) {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        // reines Weiß wäre auf hellem Grund unsichtbar
        scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col === 0xffffff ? 0x333333 : col })));
      }
      scene.add(obj);

      let edgeLines = null; // Kanten erst bei Bedarf berechnen (teuer)
      const edgesOk = tris > 0 && tris < 300000;
      const buildEdges = () => {
        if (edgeLines) return edgeLines;
        edgeLines = [];
        obj.traverse(c => {
          if (!c.isMesh) return;
          const l = new THREE.LineSegments(new THREE.EdgesGeometry(c.geometry, 25), new THREE.LineBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.55 }));
          l.matrixAutoUpdate = false; l.matrix.copy(c.matrixWorld);
          scene.add(l); edgeLines.push(l);
        });
        return edgeLines;
      };

      const ctrl = new OrbitControls(camera, renderer.domElement);
      ctrl.enableDamping = true; ctrl.dampingFactor = 0.1; ctrl.zoomSpeed = 1.3;
      ctrl.screenSpacePanning = true;
      let grid = null, box, size, center, sz, iso, need = true;
      const setView = dir => { camera.position.copy(center).add(dir.clone().normalize().multiplyScalar(sz * 1.5)); ctrl.target.copy(center); ctrl.update(); need = true; };
      // Bounding-Box, Raster und Ausgangsansicht (auch nach „Kippen“ neu)
      const fit = () => {
        if (grid) scene.remove(grid);
        box = new THREE.Box3(); scene.traverse(c => { if ((c.isMesh || c.isLineSegments) && c !== grid && c.visible && !edgeLines?.includes(c)) box.expandByObject(c); });
        size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
        center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
        sz = Math.max(size.length(), 1e-6);
        grid = new THREE.GridHelper(sz * 2, 20, 0xc4c9d0, 0xdde1e6);
        if (zUp) { grid.rotation.x = Math.PI / 2; grid.position.set(center.x, center.y, box.min.z); }
        else grid.position.set(center.x, box.min.y, center.z);
        scene.add(grid);
        camera.near = sz / 2000; camera.far = sz * 200; camera.updateProjectionMatrix();
        ctrl.minDistance = sz * 0.02; ctrl.maxDistance = sz * 20;
        // flache Zeichnung (z. B. 2D-Kontur in Rhino) → direkt draufschauen
        const d = [size.x, size.y, size.z], mx = Math.max(...d), flat = d.findIndex(x => x < mx * 0.01);
        iso = flat === 0 ? new THREE.Vector3(1, 0, 0) : flat === 1 ? new THREE.Vector3(0, zUp ? -1 : 1, zUp ? 0 : 0.001) : flat === 2 ? new THREE.Vector3(0, zUp ? -0.001 : 0, 1)
          : zUp ? new THREE.Vector3(0.9, -1.1, 0.75) : new THREE.Vector3(0.9, 0.7, 1.1);
        setView(iso);
      };
      fit();

      // nur zeichnen, wenn sich etwas bewegt (spart CPU bei großen Modellen)
      ctrl.addEventListener('change', () => { need = true; });
      const loop = () => { if (disposed) return; raf = requestAnimationFrame(loop); ctrl.update(); if (need) { need = false; renderer.render(scene, camera); } };
      loop();
      ro = new ResizeObserver(() => { const nw = el.clientWidth, nh = el.clientHeight; if (!nw || !nh) return; camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh); need = true; });
      ro.observe(el);

      const front = zUp ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, 1);
      const top = zUp ? new THREE.Vector3(0, -0.001, 1) : new THREE.Vector3(0, 1, 0.001);
      const side = new THREE.Vector3(1, 0, 0);
      api.current = {
        ctrl, front: () => setView(front), top: () => setView(top), side: () => setView(side), iso: () => setView(iso),
        zoom: f => { const off = camera.position.clone().sub(ctrl.target).multiplyScalar(f); camera.position.copy(ctrl.target).add(off); ctrl.update(); need = true; },
        edges: on => { if (!edgesOk) return; if (on) buildEdges(); edgeLines?.forEach(l => { l.visible = on; }); need = true; },
        // Modell um 90° kippen, falls es auf der Seite/kopfüber liegt (Achskonvention je CAD-Programm verschieden)
        tilt: () => {
          scene.children.filter(c => c !== camera && c !== grid && !c.isLight).forEach(c => {
            c.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2)); c.updateMatrixWorld(true);
          });
          if (edgeLines) { edgeLines.forEach(l => scene.remove(l)); edgeLines = null; api.current.edges(edgesOnRef.current); }
          fit();
        },
      };
      api.current.edges(edgesOnRef.current);
      // Maße in Dateieinheiten (bei Möbel-CAD meist mm)
      const dims = zUp ? [size.x, size.y, size.z] : [size.x, size.z, size.y];
      const u = obj.userData?.units;
      setState({ s: 'ok', info: `${dims.map(fmt).join(' × ')}${u ? ' ' + u : ''} (B × T × H${u ? '' : ', Dateieinheiten'})` + (obj.userData?.wire ? ' · Drahtmodell (Datei ohne Render-Netze)' : '') + (tris ? ` · ${Math.round(tris).toLocaleString('de-DE')} Dreiecke` : '') + (curves ? ` · ${curves.toLocaleString('de-DE')} Kurven` : ''), edgesAvail: edgesOk });
    })().catch(e => { console.error('3D', e); if (!disposed) setState({ s: 'error', msg: e.message }); });
    return () => {
      disposed = true; cancelAnimationFrame(raf); ro?.disconnect();
      if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); }
      api.current = null;
    };
  }, [blob, ext]);

  // linke Maustaste: drehen / verschieben / zoomen (wie alyDoc-Toolbar)
  useEffect(() => {
    const c = api.current?.ctrl; if (!c) return;
    const M = THREE.MOUSE;
    c.mouseButtons = mode === 'pan' ? { LEFT: M.PAN, MIDDLE: M.DOLLY, RIGHT: M.ROTATE }
      : mode === 'zoom' ? { LEFT: M.DOLLY, MIDDLE: M.DOLLY, RIGHT: M.PAN }
        : { LEFT: M.ROTATE, MIDDLE: M.DOLLY, RIGHT: M.PAN };
  }, [mode, state.s]);
  useEffect(() => { api.current?.edges(edges); }, [edges, state.s]);

  const B = ({ t, on, onClick, children }) => <button title={t} className={'v3-b' + (on ? ' on' : '')} onClick={onClick}>{children}</button>;
  return (
    <div className="v3">
      <div ref={host} className="v3-canvas" />
      {state.s === 'loading' && <div className="v3-over">3D-Modell wird aufbereitet …{['step', 'stp', 'igs', 'iges'].includes(ext) && <><br /><span className="muted">STEP/IGES: beim ersten Mal wird der CAD-Kern geladen (7 MB)</span></>}</div>}
      {state.s === 'error' && <div className="v3-over err">3D-Vorschau nicht möglich: {state.msg}</div>}
      {state.s === 'ok' && (<>
        <div className="v3-bar">
          <B t="Linke Maus: drehen" on={mode === 'rotate'} onClick={() => setMode('rotate')}>⟳</B>
          <B t="Linke Maus: verschieben" on={mode === 'pan'} onClick={() => setMode('pan')}>✥</B>
          <B t="Linke Maus: zoomen" on={mode === 'zoom'} onClick={() => setMode('zoom')}>🔍</B>
          <span className="v3-sep" />
          <B t="Vergrößern" onClick={() => api.current?.zoom(0.8)}>＋</B>
          <B t="Verkleinern" onClick={() => api.current?.zoom(1.25)}>－</B>
          <span className="v3-sep" />
          <B t="Vorderansicht" onClick={() => api.current?.front()}>V</B>
          <B t="Draufsicht" onClick={() => api.current?.top()}>D</B>
          <B t="Seitenansicht" onClick={() => api.current?.side()}>S</B>
          <B t="Isometrie / Ausgangsansicht" onClick={() => api.current?.iso()}>⌂</B>
          <B t="Modell um 90° kippen (liegt es auf der Seite?)" onClick={() => api.current?.tilt()}>↻</B>
          {state.edgesAvail && <><span className="v3-sep" /><B t="Kanten ein/aus" on={edges} onClick={() => setEdges(v => !v)}>▱</B></>}
        </div>
        <div className="v3-info">{state.info}</div>
      </>)}
    </div>
  );
}

export function Dxf2D({ blob }) {
  const host = useRef(null);
  const [state, setState] = useState({ s: 'loading' });
  useEffect(() => {
    let viewer = null, disposed = false;
    const url = URL.createObjectURL(blob);
    (async () => {
      // Alte deutsche DXF (bis AutoCAD 2006) sind ANSI_1252 – Codepage aus dem Header lesen
      const head = new TextDecoder('latin1').decode(await blob.slice(0, 20000).arrayBuffer());
      const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/i.exec(head);
      const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d+)/i.exec(head);
      const utf8 = ver && +ver[1] >= 1021;
      viewer = new DxfViewer(host.current, {
        clearColor: new THREE.Color('#ffffff'), autoResize: true, colorCorrection: true, antialias: true,
        fileEncoding: utf8 || !cp ? 'utf-8' : 'windows-' + cp[1],
      });
      await viewer.Load({ url, fonts: [asset('./fonts/DejaVuSans.ttf')] });
      if (!disposed) setState({ s: 'ok', layers: [...viewer.GetLayers()].length });
    })().catch(e => { console.error('DXF', e); if (!disposed) setState({ s: 'error', msg: e.message }); });
    return () => { disposed = true; try { viewer?.Destroy(); } catch { } URL.revokeObjectURL(url); };
  }, [blob]);
  return (
    <div className="v3">
      <div className="v3-canvas"><div ref={host} style={{ width: "100%", height: "100%" }} /></div>
      {state.s === 'loading' && <div className="v3-over">Zeichnung wird aufbereitet …</div>}
      {state.s === 'error' && <div className="v3-over err">DXF-Vorschau nicht möglich: {state.msg}</div>}
      {state.s === 'ok' && <div className="v3-info">DXF · {state.layers} Layer · Mausrad = Zoom, ziehen = verschieben</div>}
    </div>
  );
}
