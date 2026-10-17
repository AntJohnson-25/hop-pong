// The rec room: renderer (follows HopLobby's graphics preset), table, net, ball, camera.
import { TABLE } from "./sim/physics.js";
const THREE = globalThis.THREE;

export const W = { scene: null, renderer: null, camera: null, canvas: null, gfx: null, viewSide: 1, shake: 0, camX: 0 };
const BALL_VIS = 0.03;      // drawn a little bigger than the 20 mm radius so it reads from the camera

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

const MAT = {};
function std(color, o) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0.02 }, o || {})); }

W.init = function (canvas, gfx) {
  W.canvas = canvas;
  W.gfx = gfx;
  const r = W.renderer = new THREE.WebGLRenderer({ canvas, antialias: !!gfx.antialias, powerPreference: "high-performance" });
  r.outputColorSpace = THREE.SRGBColorSpace || r.outputColorSpace;
  const sc = W.scene = new THREE.Scene();
  sc.background = new THREE.Color(0x0b1226);
  sc.fog = new THREE.Fog(0x0b1226, 14, 40);
  W.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.05, 60);
  buildRoom(gfx.textureScale || 1);
  buildTable(gfx.textureScale || 1);
  buildBall();
  buildFx();
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
  W.camera.far = 60 * Math.max(0.5, g.drawDistance || 1);
  W.scene.fog.far = 40 * Math.max(0.55, g.drawDistance || 1);
  W.camera.updateProjectionMatrix();
  if (W.trail) W.trail.visible = !!g.effects;
  if (W.sparks) W.sparks.max = Math.round(40 * (g.particles || 0));
  if (W.spot) W.spot.visible = !!g.effects;
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
  W.camera.fov = w / h < 1 ? 72 : 54;
  W.camera.updateProjectionMatrix();
  W.portrait = w / h < 1;
};

function buildRoom(tx) {
  const sc = W.scene;
  sc.add(new THREE.HemisphereLight(0xdde8ff, 0x2a2430, 0.85));
  const sun = W.sun = new THREE.DirectionalLight(0xfff2dd, 1.0);
  sun.position.set(3, 7, 2);
  sun.shadow.camera.left = -5; sun.shadow.camera.right = 5; sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -7;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 20; sun.shadow.bias = -0.0006;
  sc.add(sun); sc.add(sun.target);
  const spot = W.spot = new THREE.SpotLight(0xffffff, 0.9, 20, 0.7, 0.6, 1);
  spot.position.set(0, 6, 0); spot.target.position.set(0, 0.7, 0);
  sc.add(spot); sc.add(spot.target);

  // Floor: sports court green with a darker apron, plus a lighter play-area rectangle.
  const floorTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = "#1f6b4f"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.05)"; g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * w / 8, 0); g.lineTo(i * w / 8, h); g.stroke(); }
    for (let i = 0; i < 4000; i++) { g.fillStyle = "rgba(255,255,255," + (Math.random() * 0.03) + ")"; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }, tx);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(5, 8);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(22, 34), std(0xffffff, { map: floorTex, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor);
  // Play-area border line
  const line = new THREE.Mesh(new THREE.RingGeometry(0, 1, 4, 1), new THREE.MeshBasicMaterial({ visible: false }));
  sc.add(line);

  // Barriers around the play area (ITTF-style boards), dark blue with a white stripe.
  const bTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = "#16315e"; g.fillRect(0, 0, w, h); g.fillStyle = "#ffffff"; g.fillRect(0, h * 0.62, w, 3);
    g.fillStyle = "#e8b94a"; g.font = "bold 28px sans-serif"; g.textAlign = "center"; g.fillText("HOP  PONG", w / 2, h * 0.5);
  }, tx);
  const bm = std(0xffffff, { map: bTex });
  const mk = (w, d, x, z, ry) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.75, d), bm);
    m.position.set(x, 0.375, z); m.rotation.y = ry || 0; m.castShadow = true; m.receiveShadow = true; sc.add(m);
  };
  mk(8.2, 0.08, 0, -7.2); mk(8.2, 0.08, 0, 7.2);
  mk(14.4, 0.08, -4.1, 0, Math.PI / 2); mk(14.4, 0.08, 4.1, 0, Math.PI / 2);

  // Back wall and side walls with banners and light panels.
  const wallMat = std(0x1a2547, { roughness: 1 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(26, 8), wallMat);
  back.position.set(0, 4, -11); sc.add(back);
  const front = back.clone(); front.position.z = 11; front.rotation.y = Math.PI; sc.add(front);
  [-1, 1].forEach((s) => {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(22, 8), wallMat);
    side.position.set(s * 8.5, 4, 0); side.rotation.y = -s * Math.PI / 2; sc.add(side);
  });
  const banner = canvasTex(1024, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "#c4f35b"); gr.addColorStop(1, "#ffb84a");
    g.fillStyle = "#101a38"; g.fillRect(0, 0, w, h);
    g.fillStyle = gr; g.font = "900 150px Impact, Arial Black, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("TABLE TENNIS", w / 2, h / 2 + 6);
  }, tx);
  const bn = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshBasicMaterial({ map: banner }));
  bn.position.set(0, 3.7, -10.95); sc.add(bn);
  // Ceiling light bars
  const lm = new THREE.MeshBasicMaterial({ color: 0xfff6dc });
  for (let z = -6; z <= 6; z += 4) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(5, 0.08, 0.3), lm); bar.position.set(0, 6.2, z); sc.add(bar);
  }
}

function buildTable(tx) {
  const sc = W.scene;
  const top = TABLE.top, hw = TABLE.halfW, hl = TABLE.halfL;
  const tex = canvasTex(512, 1024, (g, w, h) => {
    g.fillStyle = "#1b5fae"; g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, "rgba(255,255,255,0.06)"); grd.addColorStop(1, "rgba(0,0,0,0.1)");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#ffffff"; g.lineWidth = 7;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.lineWidth = 4; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,0.35)"; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  }, tx);
  const topM = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.04, hl * 2),
    [std(0x0f3f77), std(0x0f3f77), std(0xffffff, { map: tex, roughness: 0.35 }), std(0x0f3f77), std(0x0f3f77), std(0x0f3f77)]);
  topM.position.y = top - 0.02; topM.castShadow = true; topM.receiveShadow = true; sc.add(topM);
  const legM = std(0x2b2f3a, { metalness: 0.4 });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, top - 0.04, 0.06), legM);
    l.position.set(sx * (hw - 0.12), (top - 0.04) / 2, sz * (hl - 0.22)); l.castShadow = true; sc.add(l);
  });
  // Net with posts
  const netTex = canvasTex(256, 32, (g, w, h) => {
    g.fillStyle = "rgba(10,10,10,0.55)"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 1;
    for (let x = 0; x <= w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, 4);
  }, tx);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.netHalfW * 2, TABLE.netH), new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide }));
  net.position.set(0, top + TABLE.netH / 2, 0); sc.add(net);
  [-1, 1].forEach((s) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, TABLE.netH + 0.02, 8), std(0x222222));
    p.position.set(s * TABLE.netHalfW, top + TABLE.netH / 2, 0); p.castShadow = true; sc.add(p);
  });
}

function buildBall() {
  const sc = W.scene;
  const b = W.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_VIS, 16, 12), new THREE.MeshStandardMaterial({ color: 0xfff7e8, emissive: 0x554a30, roughness: 0.4 }));
  b.castShadow = true; sc.add(b);
  const sh = W.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sc.add(sh);
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
  const M = 40;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(M * 3), 3));
  const pts = W.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffe9a0, size: 0.04, transparent: true, opacity: 0.9, depthWrite: false }));
  pts.frustumCulled = false; pts.max = M; pts.p = []; sc.add(pts);
  // The contact ring: a billboard that closes in on the spot where you should swing.
  const ring = W.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  ring.renderOrder = 10; ring.visible = false; sc.add(ring);
  const dot = W.ringDot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), new THREE.MeshBasicMaterial({ color: 0xc4f35b, transparent: true, opacity: 0.8, depthTest: false }));
  dot.renderOrder = 10; dot.visible = false; sc.add(dot);
}

W.sparkAt = function (x, y, z, n) {
  const s = W.sparks; if (!s || !s.max) return;
  n = Math.min(n || 8, s.max);
  for (let i = 0; i < n; i++) {
    if (s.p.length >= s.max) s.p.shift();
    const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 0.3;
    s.p.push({ x, y, z, vx: Math.cos(a) * 1.4, vy: u * 1.6 + 0.6, vz: Math.sin(a) * 1.4, life: 0.35 + Math.random() * 0.2 });
  }
};

// Put the ball and its shadow/trail in place.
W.setBall = function (b, dt) {
  W.ball.position.set(b.x, b.y, b.z);
  const over = Math.abs(b.x) <= TABLE.halfW && Math.abs(b.z) <= TABLE.halfL;
  const gy = over ? TABLE.top + 0.003 : 0.003;
  W.ballShadow.position.set(b.x, gy, b.z);
  const h = Math.max(0, b.y - gy);
  W.ballShadow.scale.setScalar(Math.max(0.6, 1.4 - h * 0.5));
  W.ballShadow.material.opacity = Math.max(0.12, 0.45 - h * 0.15);
  const tr = W.trail;
  if (tr.visible) {
    const pts = tr.userData.pts, N = tr.userData.N;
    pts.unshift(b.x, b.y, b.z);
    if (pts.length > N * 3) pts.length = N * 3;
    const a = tr.geometry.attributes.position.array;
    for (let i = 0; i < N; i++) {
      const k = Math.min(i, pts.length / 3 - 1) * 3;
      a[i * 3] = pts[k] ?? b.x; a[i * 3 + 1] = pts[k + 1] ?? b.y; a[i * 3 + 2] = pts[k + 2] ?? b.z;
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

// The contact ring: u = 0 at contact (ring closed on the dot), grows with time before.
W.setRing = function (on, x, y, z, secondsToGo, quality) {
  W.ring.visible = W.ringDot.visible = !!on;
  if (!on) return;
  const k = Math.max(0, Math.min(1, secondsToGo / 0.6));
  const sc = 0.07 + k * 0.38;
  W.ring.position.set(x, y, z); W.ringDot.position.set(x, y, z);
  W.ring.quaternion.copy(W.camera.quaternion); W.ringDot.quaternion.copy(W.camera.quaternion);
  W.ring.scale.setScalar(sc);
  const near = Math.abs(secondsToGo) <= 0.06;
  W.ring.material.color.setHex(near ? 0x6bff7a : secondsToGo < 0 ? 0xff6b6b : 0xffffff);
  W.ring.material.opacity = secondsToGo < -0.12 ? 0 : 0.95;
};

// Behind the player's end of the table, over the shoulder, looking down the table.
W.placeCamera = function (me, dt) {
  const s = W.viewSide;
  const cam = W.camera;
  const tx = me ? Math.max(-1.4, Math.min(1.4, me.x * s)) : 0;       // follows you sideways
  W.camX += (tx - W.camX) * Math.min(1, dt * 4);
  const high = W.portrait ? 3.4 : 2.85, back = W.portrait ? 5.8 : 5.3;
  cam.position.set(W.camX * s * 0.9 + s * 0.0, high, s * back);
  const look = new THREE.Vector3(W.camX * s * 0.5, W.portrait ? 0.45 : 0.5, -s * 0.8);
  if (W.shake > 0.001) {
    cam.position.x += (Math.random() - 0.5) * W.shake; cam.position.y += (Math.random() - 0.5) * W.shake;
    W.shake *= Math.pow(0.001, dt);
  }
  cam.lookAt(look);
  if (W.spot) { W.spot.position.set(0, 6, 0); }
};

W.render = function () { W.renderer.render(W.scene, W.camera); };
W.BALL_VIS = BALL_VIS;
