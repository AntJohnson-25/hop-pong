// The hall: renderer (follows HopLobby's graphics preset), eight courts, the room, balls, camera.
//
// Eight courts (enough for a full lobby of 16) in two rows across an indoor sports hall. Every
// court is the same, so each part (table top, frame, net, barrier boards, mats...) is one
// InstancedMesh with an instance per court: the whole hall is a few dozen draw calls however
// detailed the parts are. The sims run in table-local metres; W.tableOff(n) is where table n is.
// Decoration that only adds polish (crowd, seats, flags, duct rings) sits in W.detail and is
// hidden on the potato and low presets.
import { TABLE } from "./sim/physics.js";
const THREE = globalThis.THREE;

export const W = { scene: null, renderer: null, camera: null, canvas: null, gfx: null, viewSide: 1, shake: 0, camX: 0, focus: 0 };
const BALL_VIS = 0.03;      // drawn a little bigger than the 20 mm radius so it reads from the camera

// Court centres: front row first, the middle courts before the outer ones (a small lobby plays
// in the middle of the hall).
const COLS = [-3.4, 3.4, -10.2, 10.2], ROWS = [6.5, -6.5];
export const TABLES = [];
ROWS.forEach((z) => COLS.forEach((x) => TABLES.push({ x, z })));
const COURT_HW = 3.2, COURT_HL = 5.5;          // barrier boards, from the table centre
const HALL = { hw: 18, hl: 15, h: 10.5 };

W.tableOff = (n) => new THREE.Vector3(TABLES[n].x, 0, TABLES[n].z);

// ---------------------------------------------------------------------------- helpers
function canvasTex(w, h, draw, scale) {
  const c = document.createElement("canvas");
  c.width = Math.max(16, Math.round(w * scale)); c.height = Math.max(16, Math.round(h * scale));
  const g = c.getContext("2d");
  g.scale(c.width / w, c.height / h);
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function std(color, o) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0.02 }, o || {})); }

const _o = new THREE.Object3D();
// A matrix from position, rotation (Euler XYZ) and scale.
function M(x, y, z, rx, ry, rz, sx, sy, sz) {
  _o.position.set(x, y, z); _o.rotation.set(rx || 0, ry || 0, rz || 0); _o.scale.set(sx || 1, sy || sx || 1, sz || sx || 1);
  _o.updateMatrix();
  return _o.matrix.clone();
}
// Many [geometry, matrix] parts into one geometry (position, normal, uv).
function merge(parts) {
  const gs = parts.map(([g, m]) => { const x = g.index ? g.toNonIndexed() : g.clone(); if (m) x.applyMatrix4(m); return x; });
  let n = 0; gs.forEach((x) => { n += x.attributes.position.count; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  gs.forEach((x) => {
    pos.set(x.attributes.position.array, o * 3);
    if (x.attributes.normal) nor.set(x.attributes.normal.array, o * 3);
    if (x.attributes.uv) uv.set(x.attributes.uv.array, o * 2);
    o += x.attributes.position.count; x.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}
// A round rod from a to b (arrays [x, y, z]).
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _qq = new THREE.Quaternion();
function rod(a, b, r, seg) {
  _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]);
  const len = _a.distanceTo(_b);
  const g = new THREE.CylinderGeometry(r, r, len, seg || 10, 1);
  const dir = _b.clone().sub(_a).normalize();
  _qq.setFromUnitVectors(_up, dir);
  const m = new THREE.Matrix4().compose(_a.clone().add(_b).multiplyScalar(0.5), _qq, new THREE.Vector3(1, 1, 1));
  return [g, m];
}
// A rounded rectangle slab: w x d footprint, t thick, corner radius r; lies flat, top at y = t.
function slab(w, d, t, r, bevel, curve) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const b = bevel || 0;
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, t - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: curve || 6 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  return g;
}
// An InstancedMesh with one instance per matrix.
function inst(geo, mat, mats, o) {
  const m = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((x, i) => m.setMatrixAt(i, x));
  m.instanceMatrix.needsUpdate = true;
  m.castShadow = !!(o && o.cast); m.receiveShadow = !(o && o.noReceive);
  if (o && o.colors) { o.colors.forEach((c, i) => m.setColorAt(i, c)); m.instanceColor.needsUpdate = true; }
  m.computeBoundingSphere && m.computeBoundingSphere();
  (o && o.parent ? o.parent : W.scene).add(m);
  return m;
}
// One matrix per court, times a court-local matrix.
function perCourt(local) { return TABLES.map((t) => new THREE.Matrix4().makeTranslation(t.x, 0, t.z).multiply(local || new THREE.Matrix4())); }

// The HopLobby symbol (the hop H with its lifted tile), centred on (0, 0), `h` px tall. Paths
// copied unchanged from the brand kit's logos/svg/hoplobby-icon-on-dark.svg (as in Hop Spades):
// Hop lime on an Ink badge, that variant's intended background, with at least a quarter of its
// height clear all round. Brand rules: never stretched, rotated, recoloured, outlined or retyped.
function hopSymbol(g, h) {
  const k = h / 128, half = Math.hypot(112, 128) / 2 * k, clear = h / 4;
  g.fillStyle = "#141822";
  g.beginPath(); g.arc(0, 0, half + clear, 0, Math.PI * 2); g.fill();
  g.save();
  g.scale(k, k); g.translate(-56, -64);
  g.fillStyle = "#C4F35B";
  g.fill(new Path2D("M10 32H22Q32 32 32 42V64H80V42Q80 32 90 32H102Q112 32 112 42V118Q112 128 102 128H90Q80 128 80 118V96H32V118Q32 128 22 128H10Q0 128 0 118V42Q0 32 10 32Z"));
  g.beginPath();
  if (g.roundRect) g.roundRect(80, 0, 32, 20, 7); else g.rect(80, 0, 32, 20);
  g.fill();
  g.restore();
}
const BADGE_R = (Math.hypot(112, 128) / 2 / 128 + 0.25);    // badge radius per px of symbol height
function badgeTex(tx) {
  return canvasTex(512, 512, (g, w) => { g.translate(w / 2, w / 2); hopSymbol(g, (w / 2) / BADGE_R); }, Math.max(0.5, tx));
}
// Unlit, untoned, so the brand colours stay exact under the hall lights.
function badgeMat(tex) { return new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); }

// ---------------------------------------------------------------------------- setup
W.init = function (canvas, gfx) {
  W.canvas = canvas;
  W.gfx = gfx;
  const r = W.renderer = new THREE.WebGLRenderer({ canvas, antialias: !!gfx.antialias, powerPreference: "high-performance" });
  r.outputColorSpace = THREE.SRGBColorSpace || r.outputColorSpace;
  const sc = W.scene = new THREE.Scene();
  sc.background = new THREE.Color(0x0d1428);
  sc.fog = new THREE.Fog(0x0d1428, 18, 60);
  W.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.05, 80);
  W.detail = new THREE.Group(); sc.add(W.detail);
  const tx = gfx.textureScale || 1;
  W.badge = badgeTex(tx);
  buildLights();
  buildFloor(tx);
  buildWalls(tx);
  buildCeiling();
  buildBleachers();
  buildCourts(tx);
  buildTables(tx);
  buildBalls();
  buildFx();
  W.setFocus(0);
  W.applyGraphics(gfx);
  W.resize();
};

// HopLobby.graphics -> renderer. antialias needs a new context, so it takes effect next load.
W.applyGraphics = function (g) {
  W.gfx = g;
  const r = W.renderer;
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, g.pixelRatio || 1));
  r.shadowMap.enabled = g.shadows !== "off";
  r.shadowMap.type = g.shadows === "soft" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  if (W.sun) {
    W.sun.castShadow = g.shadows !== "off";
    const size = g.shadows === "soft" ? 2048 : 1024;
    if (W.sun.shadow.mapSize.x !== size) { W.sun.shadow.mapSize.set(size, size); if (W.sun.shadow.map) { W.sun.shadow.map.dispose(); W.sun.shadow.map = null; } }
  }
  const dd = Math.max(0.45, g.drawDistance || 1);
  W.camera.far = 80 * Math.max(0.5, dd);
  W.scene.fog.near = 14 + 6 * dd;
  W.scene.fog.far = 62 * dd;
  W.camera.updateProjectionMatrix();
  if (W.trail) W.trail.visible = !!g.effects;
  if (W.sparks) W.sparks.max = Math.round(40 * (g.particles || 0));
  if (W.spot) W.spot.visible = !!g.effects;
  if (W.detail) W.detail.visible = g.effects !== false;
  W.lite = g.effects === false;
  // Materials need to recompile when shadows toggle.
  W.scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } });
  W.resize();
};

W.resize = function () {
  const r = W.renderer; if (!r) return;
  const w = window.innerWidth, h = window.innerHeight;
  r.setSize(w, h, false);
  W.canvas.style.width = w + "px"; W.canvas.style.height = h + "px";
  W.camera.aspect = w / h;
  // Narrow (portrait) screens: a wider vertical field keeps the table in view.
  W.camera.fov = w / h < 1 ? 66 : 54;
  W.camera.updateProjectionMatrix();
  W.portrait = w / h < 1;
};

function buildLights() {
  const sc = W.scene;
  sc.add(new THREE.HemisphereLight(0xe4ecff, 0x3a2c26, 0.95));
  const sun = W.sun = new THREE.DirectionalLight(0xfff2dd, 1.0);
  sun.shadow.camera.left = -5; sun.shadow.camera.right = 5; sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -7;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 24; sun.shadow.bias = -0.0006;
  sc.add(sun); sc.add(sun.target);
  const spot = W.spot = new THREE.SpotLight(0xffffff, 0.9, 20, 0.7, 0.6, 1);
  sc.add(spot); sc.add(spot.target);
}

// Maple sports floor, an aisle runner between the two rows.
function buildFloor(tx) {
  const sc = W.scene;
  const floorTex = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = "#b8864f"; g.fillRect(0, 0, w, h);
    const rows = 16, ph = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -Math.random() * 300;
      while (x < w) {
        const len = 180 + Math.random() * 260;
        const l = 44 + Math.random() * 14, s = 42 + Math.random() * 14;
        g.fillStyle = "hsl(" + (28 + Math.random() * 6) + "," + s + "%," + l + "%)";
        g.fillRect(x, r * ph, len, ph);
        for (let k = 0; k < 6; k++) { g.fillStyle = "rgba(90,50,20," + (Math.random() * 0.08) + ")"; g.fillRect(x, r * ph + Math.random() * ph, len, 1 + Math.random() * 2); }
        g.fillStyle = "rgba(60,35,15,0.55)"; g.fillRect(x, r * ph, 2, ph);
        x += len;
      }
      g.fillStyle = "rgba(60,35,15,0.5)"; g.fillRect(0, r * ph, w, 2);
    }
    const gl = g.createLinearGradient(0, 0, w, h); gl.addColorStop(0, "rgba(255,255,255,0.05)"); gl.addColorStop(1, "rgba(0,0,0,0.05)");
    g.fillStyle = gl; g.fillRect(0, 0, w, h);
  }, tx);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(9, 7.5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL.hw * 2, HALL.hl * 2), std(0xffffff, { map: floorTex, roughness: 0.42, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor);
  // Aisle runner
  const run = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = "#1a2a52"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#C4F35B"; g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4);
  }, tx);
  const runner = new THREE.Mesh(new THREE.BoxGeometry(27, 0.01, 1.4), std(0xffffff, { map: run, roughness: 1 }));
  runner.position.set(0, 0.005, 0); runner.receiveShadow = true; sc.add(runner);
}

// Walls with pilasters, wainscot and high windows; banners, a big screen.
function buildWalls(tx) {
  const sc = W.scene, H = HALL.h, X = HALL.hw, Z = HALL.hl;
  const wallTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = "#26324f"; g.fillRect(0, 0, w, h);
    // block wall courses
    for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? -32 : 0; x < w; x += 64) {
      g.fillStyle = "rgba(255,255,255," + (0.02 + Math.random() * 0.03) + ")"; g.fillRect(x + 2, y + 2, 60, 28);
    }
  }, tx);
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  const wallMat = std(0xffffff, { map: wallTex, roughness: 0.95 });
  const wall = (w, x, z, ry) => {
    const t = wallTex.clone(); t.needsUpdate = true; t.repeat.set(w / 4, H / 4);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat.clone()); m.material.map = t;
    m.position.set(x, H / 2, z); m.rotation.y = ry; m.receiveShadow = true; sc.add(m);
  };
  wall(X * 2, 0, -Z, 0); wall(X * 2, 0, Z, Math.PI); wall(Z * 2, -X, 0, Math.PI / 2); wall(Z * 2, X, 0, -Math.PI / 2);

  // Pilasters with a base and a capital, the wainscot between them.
  const pil = merge([
    [new THREE.BoxGeometry(0.6, H, 0.32), M(0, H / 2, 0)],
    [new THREE.BoxGeometry(0.78, 0.5, 0.44), M(0, 0.25, 0)],
    [new THREE.BoxGeometry(0.74, 0.18, 0.42), M(0, 0.55, 0)],
    [new THREE.BoxGeometry(0.8, 0.3, 0.46), M(0, H - 1.6, 0)],
    [new THREE.CylinderGeometry(0.05, 0.05, 1.0, 12), M(0, 7.6, 0.22, Math.PI / 2)],
    [new THREE.SphereGeometry(0.12, 16, 10), M(0, 7.6, 0.62)]
  ]);
  const pilMats = [], winMats = [], wainMats = [];
  const along = (len, step) => { const out = []; for (let p = -len + step; p < len - 0.1; p += step) out.push(p); return out; };
  along(X, 4).forEach((x) => { pilMats.push(M(x, 0, -Z + 0.16), M(x, 0, Z - 0.16, 0, Math.PI)); });
  along(Z, 4).forEach((z) => { pilMats.push(M(-X + 0.16, 0, z, 0, Math.PI / 2), M(X - 0.16, 0, z, 0, -Math.PI / 2)); });
  inst(pil, std(0x34436a, { roughness: 0.7 }), pilMats, { cast: false });
  // windows between pilasters (back and front walls only: the sides are behind the stands)
  const winX = []; for (let x = -X + 2; x < X - 1; x += 4) winX.push(x);
  winX.forEach((x) => { if (Math.abs(x) > 4.5) winMats.push(M(x, 6.6, -Z + 0.06)); winMats.push(M(x, 6.6, Z - 0.06, 0, Math.PI)); });   // the big screen hides the middle of the back wall
  along(Z, 4).map((z) => z - 2).concat([Z - 2]).forEach((z) => { winMats.push(M(-X + 0.06, 6.9, z, 0, Math.PI / 2), M(X - 0.06, 6.9, z, 0, -Math.PI / 2)); });
  const frame = merge([
    [new THREE.BoxGeometry(3.0, 0.14, 0.14), M(0, 1.2, 0)], [new THREE.BoxGeometry(3.0, 0.2, 0.22), M(0, -1.2, 0.04)],
    [new THREE.BoxGeometry(0.14, 2.4, 0.14), M(-1.43, 0, 0)], [new THREE.BoxGeometry(0.14, 2.4, 0.14), M(1.43, 0, 0)],
    [new THREE.BoxGeometry(0.06, 2.3, 0.08), M(-0.48, 0, 0)], [new THREE.BoxGeometry(0.06, 2.3, 0.08), M(0.48, 0, 0)],
    [new THREE.BoxGeometry(2.9, 0.06, 0.08), M(0, 0.35, 0)]
  ]);
  inst(frame, std(0xb9c2d6, { metalness: 0.6, roughness: 0.4 }), winMats);
  const glass = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#08112c"); gr.addColorStop(0.7, "#173064"); gr.addColorStop(1, "#5b4a6e");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = "rgba(255,255,255," + (0.3 + Math.random() * 0.6) + ")"; g.fillRect(Math.random() * w, Math.random() * h * 0.6, 1.5, 1.5); }
    for (let i = 0; i < 18; i++) { const bw = 8 + Math.random() * 22, bh = 10 + Math.random() * 40; g.fillStyle = "#0a0f22"; g.fillRect(Math.random() * w, h - bh, bw, bh); }
  }, tx);
  inst(new THREE.PlaneGeometry(2.86, 2.38), new THREE.MeshBasicMaterial({ map: glass }), winMats.map((m) => m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.03))));
  // wainscot: padded wall panels low down
  const wain = merge([[new THREE.BoxGeometry(3.3, 1.2, 0.08), M(0, 0.62, 0)], [new THREE.BoxGeometry(3.4, 0.08, 0.14), M(0, 1.26, 0.02)]]);
  winX.forEach((x) => { wainMats.push(M(x, 0, -Z + 0.05), M(x, 0, Z - 0.05, 0, Math.PI)); });
  inst(wain, std(0x1b3a73, { roughness: 0.9 }), wainMats);

  // Banners and the big screen.
  const banner = canvasTex(1024, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "#c4f35b"); gr.addColorStop(1, "#ffb84a");
    g.fillStyle = "#101a38"; g.fillRect(0, 0, w, h);
    g.fillStyle = gr; g.font = "900 150px Impact, Arial Black, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("TABLE TENNIS", w / 2, h / 2 + 6);
  }, tx);
  const bn = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: banner }));
  bn.position.set(0, 3.2, Z - 0.1); bn.rotation.y = Math.PI; sc.add(bn);
  const screen = canvasTex(1024, 448, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#0e1a3d"); gr.addColorStop(1, "#1d0f33");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.save(); g.translate(170, h / 2); hopSymbol(g, 150); g.restore();
    g.font = "900 140px Impact, Arial Black, sans-serif"; g.textBaseline = "middle";
    const tg = g.createLinearGradient(330, 0, w, 0); tg.addColorStop(0, "#c4f35b"); tg.addColorStop(1, "#ffb84a");
    g.fillStyle = tg; g.fillText("HOP PONG", 330, h / 2 - 40);
    g.fillStyle = "#e9eefc"; g.font = "700 54px system-ui, sans-serif"; g.fillText("OPEN  ·  8 TABLES", 336, h / 2 + 80);
  }, tx);
  const scrBox = new THREE.Mesh(new THREE.BoxGeometry(8.4, 3.9, 0.5), std(0x111522, { metalness: 0.5, roughness: 0.5 }));
  scrBox.position.set(0, 4.6, -Z + 0.3); sc.add(scrBox);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.5), new THREE.MeshBasicMaterial({ map: screen, toneMapped: false }));
  scr.position.set(0, 4.6, -Z + 0.56); sc.add(scr);
}

// Steel trusses across the hall, purlins, hanging light fixtures and air ducts.
function buildCeiling() {
  const sc = W.scene, X = HALL.hw, Z = HALL.hl, H = HALL.h;
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(X * 2, Z * 2), std(0x151b2c, { roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = H; sc.add(ceil);
  // A Pratt truss spanning x, top chord at y 10, bottom at 8.9.
  const top = 10.0, bot = 8.9, parts = [];
  parts.push(rod([-X, top, 0], [X, top, 0], 0.07, 10), rod([-X + 1, bot, 0], [X - 1, bot, 0], 0.06, 10));
  for (let x = -X + 1; x <= X - 1 + 0.01; x += 1.5) {
    parts.push(rod([x, bot, 0], [x, top, 0], 0.03, 8));
    if (x + 1.5 <= X - 1 + 0.01) parts.push(rod(x < 0 ? [x, top, 0] : [x, bot, 0], x < 0 ? [x + 1.5, bot, 0] : [x + 1.5, top, 0], 0.025, 8));
  }
  const truss = merge(parts);
  const steel = std(0x7d8798, { metalness: 0.7, roughness: 0.45 });
  const tz = []; for (let z = -Z + 3; z < Z - 1; z += 4) tz.push(z);
  inst(truss, steel, tz.map((z) => M(0, 0, z)));
  const purl = rod([0, 10.15, -Z], [0, 10.15, Z], 0.05, 8);
  const purlinGeo = merge([purl]);
  const px = []; for (let x = -X + 1.5; x < X; x += 3) px.push(M(x, 0, 0));
  inst(purlinGeo, steel, px);
  // Light fixtures over every court: a housing, two cables, a glowing panel.
  const fix = merge([
    [new THREE.BoxGeometry(1.6, 0.12, 0.42), M(0, 0, 0)],
    [new THREE.BoxGeometry(1.64, 0.04, 0.46), M(0, 0.07, 0)],
    rod([-0.6, 0.06, 0], [-0.6, 10 - 8.1, 0], 0.008, 6), rod([0.6, 0.06, 0], [0.6, 10 - 8.1, 0], 0.008, 6)
  ]);
  const fixM = [];
  TABLES.forEach((t) => [-1.2, 1.2].forEach((dx) => [-2.4, 0, 2.4].forEach((dz) => fixM.push(M(t.x + dx, 8.1, t.z + dz, 0, Math.PI / 2)))));
  [-13, 0, 13].forEach((x) => fixM.push(M(x, 8.1, 0)));
  inst(fix, std(0x2a2f3a, { metalness: 0.6, roughness: 0.5 }), fixM);
  inst(new THREE.PlaneGeometry(1.5, 0.34), new THREE.MeshBasicMaterial({ color: 0xfff7e6 }), fixM.map((m) => m.clone().multiply(M(0, -0.065, 0, Math.PI / 2))));
  // Round air ducts down each side, with flange rings.
  const duct = new THREE.CylinderGeometry(0.55, 0.55, Z * 2 - 1, 40, 1, true);
  duct.rotateX(Math.PI / 2);
  inst(duct, std(0xa6adb8, { metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }), [M(-13.5, 9.1, 0), M(13.5, 9.1, 0)]);
  const ring = new THREE.TorusGeometry(0.57, 0.035, 8, 40);
  const rings = []; for (let z = -Z + 1.5; z < Z - 1; z += 2) rings.push(M(-13.5, 9.1, z), M(13.5, 9.1, z));
  inst(ring, std(0x8a929e, { metalness: 0.8, roughness: 0.4 }), rings, { parent: W.detail });
  // Hanging flags in team colours.
  const flagTex = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, h * 0.12, w, 10); g.fillRect(0, h * 0.82, w, 10);
    g.beginPath(); g.moveTo(0, h); g.lineTo(w / 2, h - 50); g.lineTo(w, h); g.fillStyle = "#151b2c"; g.fill();
  }, 1);
  const cols = [0xc4f35b, 0x2d5bd1, 0xffb84a, 0xe8466a, 0x1fb5a8, 0xf2f2f2];
  const fm = [], fc = [];
  for (let x = -14; x <= 14; x += 4) [-1, 1].forEach((s, k) => { fm.push(M(x + (k ? 2 : 0), 7.3, s * 12.9)); fc.push(new THREE.Color(cols[(fm.length) % cols.length])); });
  inst(new THREE.PlaneGeometry(1.1, 3.0), std(0xffffff, { map: flagTex, side: THREE.DoubleSide, roughness: 0.9 }), fm, { parent: W.detail, colors: fc });
}

// Raked stands down both sides: concrete steps, moulded seats, rails, and a crowd.
function buildBleachers() {
  const TIERS = 6, D = 0.72, R = 0.42, X0 = 13.8, LEN = 26;
  const steps = [], seats = [], fans = [], heads = [], fanC = [], headC = [];
  const skins = [0x5a3a26, 0x8d5a3b, 0xc68a5e, 0xe6b48f, 0x3b2619, 0xf1c9a5];
  const shirts = [0xc4f35b, 0x2d5bd1, 0xffb84a, 0xe8466a, 0x1fb5a8, 0xf2f2f2, 0x222831, 0x8b5cf6];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  [-1, 1].forEach((s) => {
    for (let i = 0; i < TIERS; i++) {
      const xc = s * (X0 + D * i + D / 2), top = R * (i + 1);
      steps.push(M(xc, top / 2, 0, 0, 0, 0, 1, top, 1));
      for (let z = -LEN / 2 + 0.6; z <= LEN / 2 - 0.6; z += 0.56) {
        if (Math.abs(z) < 1.0) continue;               // the stairway
        const ry = s > 0 ? -Math.PI / 2 : Math.PI / 2;
        seats.push(M(xc - s * 0.05, top, z, 0, ry));
        if (rnd() < 0.42) {
          fans.push(M(xc + s * 0.02, top + 0.42, z, 0, 0, s * (rnd() - 0.5) * 0.12));
          heads.push(M(xc + s * 0.02 - s * (rnd() * 0.04), top + 0.84, z + (rnd() - 0.5) * 0.04));
          fanC.push(new THREE.Color(shirts[Math.floor(rnd() * shirts.length)]));
          headC.push(new THREE.Color(skins[Math.floor(rnd() * skins.length)]));
        }
      }
    }
  });
  const stepGeo = new THREE.BoxGeometry(D, 1, LEN);
  inst(stepGeo, std(0x5d6474, { roughness: 0.95 }), steps, { cast: false });
  // A moulded seat: pan, curved back, pedestal.
  const pan = slab(0.44, 0.4, 0.05, 0.08, 0.012, 5);
  const back = slab(0.44, 0.36, 0.04, 0.08, 0.01, 5);
  back.rotateX(Math.PI / 2 - 0.18); back.translate(0, 0.36, -0.22);
  const seat = merge([[pan, M(0, 0.06, 0)], [back, null], [new THREE.CylinderGeometry(0.035, 0.05, 0.08, 10), M(0, 0.03, -0.05)]]);
  const seatC = seats.map((_, i) => new THREE.Color([0x2d5bd1, 0x2d5bd1, 0x1e3f99, 0xc4f35b][Math.floor(i / 44) % 4]));
  inst(seat, std(0xffffff, { roughness: 0.55 }), seats, { parent: W.detail, colors: seatC });
  inst(new THREE.CapsuleGeometry(0.17, 0.34, 4, 10), std(0xffffff, { roughness: 0.9 }), fans, { parent: W.detail, colors: fanC });
  inst(new THREE.SphereGeometry(0.11, 14, 10), std(0xffffff, { roughness: 0.7 }), heads, { parent: W.detail, colors: headC });
  // Rails: along the front of the stands and up the back.
  const rails = [];
  [-1, 1].forEach((s) => {
    const xf = s * (X0 - 0.05), xb = s * (X0 + D * TIERS - 0.1), yb = R * TIERS + 1.0;
    rails.push(rod([xf, 1.0, -LEN / 2], [xf, 1.0, -1.0], 0.03, 10), rod([xf, 1.0, 1.0], [xf, 1.0, LEN / 2], 0.03, 10));
    rails.push(rod([xb, yb, -LEN / 2], [xb, yb, LEN / 2], 0.03, 10));
    for (let z = -LEN / 2; z <= LEN / 2 + 0.01; z += 2) {
      if (Math.abs(z) < 1.0) continue;
      rails.push(rod([xf, 0, z], [xf, 1.0, z], 0.025, 8), rod([xb, R * TIERS, z], [xb, yb, z], 0.025, 8));
    }
    // stair handrails
    [-0.9, 0.9].forEach((dz) => rails.push(rod([s * X0, 1.0, dz], [s * (X0 + D * TIERS), R * TIERS + 1.0, dz], 0.025, 8)));
  });
  inst(merge(rails), std(0xc9ced8, { metalness: 0.8, roughness: 0.3 }), [new THREE.Matrix4()]);
  // stair treads
  const treads = [];
  [-1, 1].forEach((s) => { for (let i = 0; i < TIERS * 2; i++) treads.push(M(s * (X0 + D / 4 + i * D / 2), R / 2 * (i + 1) / 2 + 0.0, 0, 0, 0, 0, 1, R / 2 * (i + 1), 1)); });
  inst(new THREE.BoxGeometry(D / 2, 1, 1.8), std(0x4a5060, { roughness: 0.9 }), treads);
}

// Each court: a red sports mat, barrier boards round it, the umpire's desk with a flip
// scoreboard (live score, see W.setScore), towel boxes at the ends.
function buildCourts(tx) {
  const matTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#7a2a27"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) { g.fillStyle = "rgba(" + (Math.random() < 0.5 ? "0,0,0" : "255,255,255") + "," + (Math.random() * 0.05) + ")"; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }, tx);
  matTex.wrapS = matTex.wrapT = THREE.RepeatWrapping; matTex.repeat.set(3, 5);
  inst(new THREE.BoxGeometry(COURT_HW * 2 + 0.2, 0.012, COURT_HL * 2 + 0.2), std(0xffffff, { map: matTex, roughness: 0.75 }), perCourt(M(0, 0.006, 0)), { cast: false });

  // Barrier boards: 1.4 m long, 0.7 m tall, on feet. Two prints alternate.
  const word = canvasTex(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#1b3b72"); gr.addColorStop(1, "#11285a");
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = "#ffffff"; g.fillRect(0, h - 26, w, 6);
    const tg = g.createLinearGradient(0, 0, w, 0); tg.addColorStop(0, "#c4f35b"); tg.addColorStop(1, "#ffb84a");
    g.fillStyle = tg; g.font = "900 96px Impact, Arial Black, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("HOP PONG", w / 2, h * 0.44);
  }, tx);
  const badgeBoard = canvasTex(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#1b3b72"); gr.addColorStop(1, "#11285a");
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = "#ffffff"; g.fillRect(0, h - 26, w, 6);
    g.save(); g.translate(w / 2, h * 0.44); hopSymbol(g, 120); g.restore();
  }, tx);
  const board = merge([
    [new THREE.BoxGeometry(1.38, 0.66, 0.035), M(0, 0.37, 0)],
    [new THREE.BoxGeometry(0.06, 0.04, 0.4), M(-0.6, 0.02, 0)], [new THREE.BoxGeometry(0.06, 0.04, 0.4), M(0.6, 0.02, 0)]
  ]);
  const boardsA = [], boardsB = [];
  let k = 0;
  const put = (x, z, ry) => { (k++ % 2 ? boardsB : boardsA).push(M(x, 0, z, 0, ry)); };
  TABLES.forEach((t) => {
    for (let i = 0; i < 8; i++) { const z = -COURT_HL + 0.7 + i * 1.4; put(t.x - COURT_HW, t.z + z, Math.PI / 2); put(t.x + COURT_HW, t.z + z, -Math.PI / 2); }
    for (let i = 0; i < 5; i++) { const x = -2.8 + i * 1.4; put(t.x + x, t.z - COURT_HL, 0); put(t.x + x, t.z + COURT_HL, Math.PI); }
  });
  inst(board, std(0xffffff, { map: word, roughness: 0.7 }), boardsA, { cast: true });
  inst(board, std(0xffffff, { map: badgeBoard, roughness: 0.7 }), boardsB, { cast: true });

  // Umpire's desk on the right of the table (seen from the p end), with a chair.
  const desk = merge([
    [new THREE.BoxGeometry(0.9, 0.04, 0.5), M(0, 0.74, 0)],
    [new THREE.BoxGeometry(0.88, 0.6, 0.03), M(0, 0.42, -0.23)],
    [new THREE.BoxGeometry(0.03, 0.72, 0.48), M(-0.43, 0.36, 0)], [new THREE.BoxGeometry(0.03, 0.72, 0.48), M(0.43, 0.36, 0)]
  ]);
  const deskAt = M(2.3, 0, 0, 0, Math.PI / 2);
  inst(desk, std(0x1d2c55, { roughness: 0.6 }), perCourt(deskAt), { cast: true });
  const chair = merge([
    [slab(0.42, 0.42, 0.05, 0.06, 0.01, 4), M(0, 0.45, 0)],
    [new THREE.BoxGeometry(0.42, 0.4, 0.04), M(0, 0.72, 0.2, -0.1)],
    rod([-0.18, 0, -0.18], [-0.18, 0.45, -0.18], 0.012, 6), rod([0.18, 0, -0.18], [0.18, 0.45, -0.18], 0.012, 6),
    rod([-0.18, 0, 0.18], [-0.18, 0.92, 0.2], 0.012, 6), rod([0.18, 0, 0.18], [0.18, 0.92, 0.2], 0.012, 6)
  ]);
  inst(chair, std(0x2b2f3a, { metalness: 0.4, roughness: 0.6 }), perCourt(M(2.8, 0, 0, 0, Math.PI / 2)), { parent: W.detail, cast: true });
  // Towel boxes at each end corner.
  const towel = merge([[new THREE.BoxGeometry(0.4, 0.5, 0.3), M(0, 0.25, 0)], [new THREE.BoxGeometry(0.34, 0.06, 0.24), M(0, 0.52, 0)]]);
  inst(towel, std(0x2d5bd1, { roughness: 0.8 }), perCourt(M(-2.7, 0, 4.9)).concat(perCourt(M(2.7, 0, -4.9))), { parent: W.detail });

  // The flip scoreboards: a tent of two faces on the desk, each half of one canvas per court.
  W.scoreCv = []; W.scoreTex = []; W.scoreKey = [];
  const faceA = new THREE.PlaneGeometry(0.52, 0.34), faceB = new THREE.PlaneGeometry(0.52, 0.34);
  [faceA, faceB].forEach((g, i) => { const uv = g.attributes.uv; for (let j = 0; j < uv.count; j++) uv.setX(j, uv.getX(j) * 0.5 + i * 0.5); });
  TABLES.forEach((t, n) => {
    const c = document.createElement("canvas"); c.width = 512; c.height = 168;
    const tex = new THREE.CanvasTexture(c); if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    W.scoreCv.push(c); W.scoreTex.push(tex); W.scoreKey.push("");
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const back = std(0x111522, { roughness: 0.6 });
    [[faceA, 0.08, -0.6], [faceB, -0.08, Math.PI + 0.6]].forEach(([g, dz, ry]) => {
      const f = new THREE.Mesh(g, mat); f.position.set(t.x + 2.3, 0.96, t.z + dz); f.rotation.set(0, ry, 0); W.scene.add(f);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.38, 0.02), back); b.position.copy(f.position); b.rotation.copy(f.rotation); b.translateZ(-0.012); W.scene.add(b);
    });
    W.setScore(n, null);
  });
}

// Table n's scoreboard: sc = [p, c] or null for an idle table.
W.setScore = function (n, sc) {
  const key = sc ? sc[0] + ":" + sc[1] : "-";
  if (!W.scoreCv || W.scoreKey[n] === key) return;
  W.scoreKey[n] = key;
  const c = W.scoreCv[n], g = c.getContext("2d");
  [0, 1].forEach((half) => {
    const x0 = half * 256;
    g.fillStyle = "#0c1020"; g.fillRect(x0, 0, 256, 168);
    g.fillStyle = "#C4F35B"; g.font = "800 26px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("TABLE " + (n + 1), x0 + 128, 22);
    const a = sc ? (half ? sc[1] : sc[0]) : "–", b = sc ? (half ? sc[0] : sc[1]) : "–";
    [[a, 70], [b, 186]].forEach(([v, cx]) => {
      g.fillStyle = "#f4f4f0"; g.fillRect(x0 + cx - 50, 46, 100, 110);
      g.fillStyle = "#c9c9c4"; g.fillRect(x0 + cx - 50, 100, 100, 2);
      g.fillStyle = "#151515"; g.font = "900 84px Impact, Arial Black, sans-serif"; g.fillText(String(v), x0 + cx, 104);
    });
  });
  W.scoreTex[n].needsUpdate = true;
};

// The tables: a bevelled top with the court lines and the HopLobby badge on each half, an apron,
// a folding steel undercarriage on castors, the net and its post clamps. One instance per court.
function buildTables(tx) {
  const top = TABLE.top, hw = TABLE.halfW, hl = TABLE.halfL;
  const body = merge([
    [slab(hw * 2, hl * 2, 0.026, 0.02, 0.005, 6), M(0, top - 0.026, 0)],
    // apron under the edge
    [new THREE.BoxGeometry(0.012, 0.06, hl * 2 - 0.1), M(-hw + 0.03, top - 0.056, 0)], [new THREE.BoxGeometry(0.012, 0.06, hl * 2 - 0.1), M(hw - 0.03, top - 0.056, 0)],
    [new THREE.BoxGeometry(hw * 2 - 0.1, 0.06, 0.012), M(0, top - 0.056, -hl + 0.03)], [new THREE.BoxGeometry(hw * 2 - 0.1, 0.06, 0.012), M(0, top - 0.056, hl - 0.03)],
    [new THREE.BoxGeometry(hw * 2 - 0.1, 0.06, 0.012), M(0, top - 0.056, -0.012)], [new THREE.BoxGeometry(hw * 2 - 0.1, 0.06, 0.012), M(0, top - 0.056, 0.012)]
  ]);
  inst(body, std(0x0f3f77, { roughness: 0.5 }), perCourt(), { cast: true });

  const surf = canvasTex(512, 1024, (g, w, h) => {
    g.fillStyle = "#1b5fae"; g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, "rgba(255,255,255,0.06)"); grd.addColorStop(1, "rgba(0,0,0,0.1)");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#ffffff"; g.lineWidth = 7;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.lineWidth = 4; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,0.35)"; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  }, tx);
  const sg = new THREE.PlaneGeometry(hw * 2 - 0.006, hl * 2 - 0.006); sg.rotateX(-Math.PI / 2);
  inst(sg, std(0xffffff, { map: surf, roughness: 0.35 }), perCourt(M(0, top + 0.0006, 0)), { cast: false });
  // The badge in the middle of each half, upright for the player at that end.
  const bg = new THREE.CircleGeometry(0.2, 48); bg.rotateX(-Math.PI / 2);
  const badges = perCourt(M(-hw / 2, top + 0.0016, hl / 2)).concat(perCourt(M(hw / 2, top + 0.0016, -hl / 2, 0, Math.PI)));
  const bm = inst(bg, badgeMat(W.badge), badges, { noReceive: true });
  bm.renderOrder = 2;

  // Undercarriage: per half, two legs with braces to a centre spine, a crossbar, castors.
  const steel = [], rubber = [];
  [-1, 1].forEach((sz) => {
    const zl = sz * (hl - 0.32), zc = sz * 0.35;
    [-1, 1].forEach((sx) => {
      const x = sx * (hw - 0.16);
      steel.push(rod([x, 0.1, zl], [x, top - 0.06, zl], 0.022, 16));
      steel.push(rod([x, 0.32, zl], [sx * 0.1, top - 0.1, zc], 0.014, 12));
      // castor: fork, wheel, hub
      steel.push([new THREE.BoxGeometry(0.05, 0.05, 0.05), M(x, 0.085, zl)]);
      rubber.push([new THREE.TorusGeometry(0.035, 0.016, 10, 20), M(x, 0.05, zl + 0.01, 0, Math.PI / 2)]);
      steel.push([new THREE.CylinderGeometry(0.018, 0.018, 0.04, 12), M(x, 0.05, zl + 0.01, 0, 0, Math.PI / 2)]);
    });
    steel.push(rod([-(hw - 0.16), 0.32, zl], [hw - 0.16, 0.32, zl], 0.016, 12));
    steel.push(rod([-(hw - 0.16), top - 0.07, zl], [hw - 0.16, top - 0.07, zl], 0.018, 12));
    steel.push([new THREE.BoxGeometry(0.06, 0.04, hl - 0.2), M(-0.1, top - 0.08, sz * hl / 2)], [new THREE.BoxGeometry(0.06, 0.04, hl - 0.2), M(0.1, top - 0.08, sz * hl / 2)]);
    // folding hinge
    steel.push([new THREE.CylinderGeometry(0.03, 0.03, 0.3, 16), M(0, top - 0.1, sz * 0.12, 0, 0, Math.PI / 2)]);
  });
  inst(merge(steel), std(0x2b2f3a, { metalness: 0.55, roughness: 0.4 }), perCourt(), { cast: true });
  inst(merge(rubber), std(0x111111, { roughness: 0.9 }), perCourt(), { cast: false });

  // Net with posts and clamps
  const netTex = canvasTex(256, 32, (g, w, h) => {
    g.fillStyle = "rgba(10,10,10,0.55)"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 1;
    for (let x = 0; x <= w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, 4);
  }, tx);
  inst(new THREE.PlaneGeometry(TABLE.netHalfW * 2, TABLE.netH), new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }), perCourt(M(0, top + TABLE.netH / 2, 0)));
  const posts = [];
  [-1, 1].forEach((s) => {
    posts.push([new THREE.CylinderGeometry(0.012, 0.012, TABLE.netH + 0.02, 16), M(s * TABLE.netHalfW, top + TABLE.netH / 2, 0)]);
    posts.push([new THREE.SphereGeometry(0.016, 12, 8), M(s * TABLE.netHalfW, top + TABLE.netH + 0.012, 0)]);
    posts.push([new THREE.BoxGeometry(0.16, 0.035, 0.05), M(s * (hw + 0.05), top - 0.01, 0)]);
    posts.push([new THREE.BoxGeometry(0.03, 0.08, 0.05), M(s * (hw + 0.005), top - 0.03, 0)]);
    posts.push([new THREE.CylinderGeometry(0.01, 0.01, 0.06, 10), M(s * (hw - 0.03), top - 0.05, 0)]);
  });
  inst(merge(posts), std(0x222222, { metalness: 0.5, roughness: 0.4 }), perCourt(), { cast: true });
}

function buildBalls() {
  const sc = W.scene;
  W.balls = []; W.ballShadows = [];
  const geo = new THREE.SphereGeometry(BALL_VIS, 16, 12), mat = new THREE.MeshStandardMaterial({ color: 0xfff7e8, emissive: 0x554a30, roughness: 0.4 });
  const sgeo = new THREE.CircleGeometry(0.03, 16);
  TABLES.forEach(() => {
    const b = new THREE.Mesh(geo, mat); b.castShadow = true; b.visible = false; sc.add(b);
    const sh = new THREE.Mesh(sgeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.visible = false; sc.add(sh);
    W.balls.push(b); W.ballShadows.push(sh);
  });
}

// Trail, sparks, the contact ring.
function buildFx() {
  const sc = W.scene;
  const N = 24;
  const tg = new THREE.BufferGeometry();
  tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const trail = W.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.5 }));
  trail.frustumCulled = false; trail.userData.N = N; trail.userData.pts = []; sc.add(trail);
  // Sparks: one Points object, a pool.
  const M2 = 40;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(M2 * 3), 3));
  const pts = W.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffe9a0, size: 0.04, transparent: true, opacity: 0.9, depthWrite: false }));
  pts.frustumCulled = false; pts.max = M2; pts.p = []; sc.add(pts);
  // The contact ring: a billboard that closes in on the spot where you should swing.
  const ring = W.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  ring.renderOrder = 10; ring.visible = false; sc.add(ring);
  const dot = W.ringDot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), new THREE.MeshBasicMaterial({ color: 0xc4f35b, transparent: true, opacity: 0.8, depthTest: false }));
  dot.renderOrder = 10; dot.visible = false; sc.add(dot);
}

// ---------------------------------------------------------------------------- per frame
// Your table (or the one you watch): the camera, the key light and the effects follow it.
W.setFocus = function (n) {
  W.focus = n;
  W.off = W.tableOff(n);
  if (!W.camOff) W.camOff = W.off.clone();
  W.sun.position.set(W.off.x + 3, 9, W.off.z + 2); W.sun.target.position.copy(W.off);
  W.spot.position.set(W.off.x, 6, W.off.z); W.spot.target.position.set(W.off.x, 0.7, W.off.z);
  W.trail.userData.pts = [];
  W.sparks.p = [];
};

W.sparkAt = function (x, y, z, n) {
  const s = W.sparks; if (!s || !s.max) return;
  x += W.off.x; z += W.off.z;
  n = Math.min(n || 8, s.max);
  for (let i = 0; i < n; i++) {
    if (s.p.length >= s.max) s.p.shift();
    const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 0.3;
    s.p.push({ x, y, z, vx: Math.cos(a) * 1.4, vy: u * 1.6 + 0.6, vz: Math.sin(a) * 1.4, life: 0.35 + Math.random() * 0.2 });
  }
};

// A table's ball (table-local b) and its shadow; null hides them.
W.setTableBall = function (n, b) {
  const m = W.balls[n], sh = W.ballShadows[n];
  m.visible = sh.visible = !!b;
  if (!b) return;
  const t = TABLES[n];
  m.position.set(b.x + t.x, b.y, b.z + t.z);
  const over = Math.abs(b.x) <= TABLE.halfW && Math.abs(b.z) <= TABLE.halfL;
  const gy = over ? TABLE.top + 0.003 : 0.016;
  sh.position.set(b.x + t.x, gy, b.z + t.z);
  const h = Math.max(0, b.y - gy);
  sh.scale.setScalar(Math.max(0.6, 1.4 - h * 0.5));
  sh.material.opacity = Math.max(0.12, 0.45 - h * 0.15);
};

// Your table's ball, with the trail and sparks.
W.setBall = function (b, dt) {
  W.setTableBall(W.focus, b);
  const ox = W.off.x, oz = W.off.z;
  const tr = W.trail;
  if (tr.visible) {
    const pts = tr.userData.pts, N = tr.userData.N;
    pts.unshift(b.x + ox, b.y, b.z + oz);
    if (pts.length > N * 3) pts.length = N * 3;
    const a = tr.geometry.attributes.position.array;
    for (let i = 0; i < N; i++) {
      const k = Math.min(i, pts.length / 3 - 1) * 3;
      a[i * 3] = pts[k] ?? b.x + ox; a[i * 3 + 1] = pts[k + 1] ?? b.y; a[i * 3 + 2] = pts[k + 2] ?? b.z + oz;
    }
    tr.geometry.attributes.position.needsUpdate = true;
    const sp = Math.hypot(b.vx || 0, b.vy || 0, b.vz || 0);
    tr.material.opacity = Math.min(0.55, sp / 18);
  }
  const s = W.sparks;
  if (s && s.p.length) {
    const arr = s.geometry.attributes.position.array;
    for (let i = s.p.length - 1; i >= 0; i--) {
      const p = s.p[i]; p.life -= dt; p.vy -= 6 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.life <= 0) s.p.splice(i, 1);
    }
    for (let i = 0; i < s.max; i++) {
      const p = s.p[i];
      arr[i * 3] = p ? p.x : 0; arr[i * 3 + 1] = p ? p.y : -10; arr[i * 3 + 2] = p ? p.z : 0;
    }
    s.geometry.attributes.position.needsUpdate = true;
  }
};

// The contact ring (table-local): u = 0 at contact (ring closed on the dot), grows with time before.
W.setRing = function (on, x, y, z, secondsToGo) {
  W.ring.visible = W.ringDot.visible = !!on;
  if (!on) return;
  const k = Math.max(0, Math.min(1, secondsToGo / 0.6));
  const sc = 0.07 + k * 0.38;
  W.ring.position.set(x + W.off.x, y, z + W.off.z); W.ringDot.position.copy(W.ring.position);
  W.ring.quaternion.copy(W.camera.quaternion); W.ringDot.quaternion.copy(W.camera.quaternion);
  W.ring.scale.setScalar(sc);
  const near = Math.abs(secondsToGo) <= 0.06;
  W.ring.material.color.setHex(near ? 0x6bff7a : secondsToGo < 0 ? 0xff6b6b : 0xffffff);
  W.ring.material.opacity = secondsToGo < -0.12 ? 0 : 0.95;
};

// Behind the player's end of the table, over the shoulder, looking down the table. Moving to
// another table glides there.
W.placeCamera = function (me, dt) {
  const s = W.viewSide;
  const cam = W.camera;
  W.camOff.lerp(W.off, Math.min(1, dt * 3));
  const tx = me ? Math.max(-1.4, Math.min(1.4, me.x * s)) : 0;       // follows you sideways
  W.camX += (tx - W.camX) * Math.min(1, dt * 4);
  const high = W.portrait ? 2.5 : 2.85, back = W.portrait ? 5.0 : 5.3;
  cam.position.set(W.camOff.x + W.camX * s * 0.9, high, W.camOff.z + s * back);
  const look = new THREE.Vector3(W.camOff.x + W.camX * s * 0.5, W.portrait ? 0.9 : 0.5, W.camOff.z - s * (W.portrait ? 1.6 : 0.8));
  if (W.shake > 0.001) {
    cam.position.x += (Math.random() - 0.5) * W.shake; cam.position.y += (Math.random() - 0.5) * W.shake;
    W.shake *= Math.pow(0.001, dt);
  }
  cam.lookAt(look);
};

W.render = function () { W.renderer.render(W.scene, W.camera); };
W.BALL_VIS = BALL_VIS;
