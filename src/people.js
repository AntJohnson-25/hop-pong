// The players on court. Humans are their own HopLobby avatar (platform rule); the computer players
// are our own cast (assets/bot-N.glb). Both are 19-bone rigs. The paddle is ours: it is posed
// procedurally in the hand (two-bone IK to a hand path built from the ball's contact point).
import { parseAvatar, ik, HEAD, CHEST } from "./rig.js";
import { TABLE } from "./sim/physics.js";
const THREE = globalThis.THREE;

export const BOTS = [
  { name: "Auntie Dee", h: 1.66 }, { name: "Big Ray", h: 1.86 }, { name: "Tasha", h: 1.68 }, { name: "Marcus", h: 1.80 },
  { name: "Unc Lou", h: 1.74 }, { name: "Keisha", h: 1.63 }, { name: "Mei", h: 1.58 }, { name: "Diego", h: 1.72 }
];
const SKEL_H = 1.72;     // top of the head on our cast's skeleton
const BUF = {};          // bot GLB buffers

function fetchBuf(file, attempt) {
  return fetch(file + (attempt ? "?retry=" + attempt : "")).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .catch((err) => { if (attempt < 3) return new Promise((ok) => setTimeout(ok, 500 * (attempt + 1))).then(() => fetchBuf(file, attempt + 1)); throw err; });
}
export function loadBotBuffer(i) {
  if (!BUF[i]) BUF[i] = fetchBuf("assets/bot-" + i + ".glb", 0);
  return BUF[i];
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const ease = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;

function makePaddle() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xc89b5a, roughness: 0.7 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.1, 10), wood);
  handle.position.y = -0.05;
  const rub = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
  const blade = new THREE.Group();
  const faceA = new THREE.Mesh(new THREE.CylinderGeometry(0.083, 0.083, 0.004, 28), rub(0xd9322f));
  const faceB = new THREE.Mesh(new THREE.CylinderGeometry(0.083, 0.083, 0.004, 28), rub(0x15171d));
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.006, 28), wood);
  [faceA, faceB, core].forEach((m) => { m.rotation.x = Math.PI / 2; });
  faceA.position.z = 0.005; faceB.position.z = -0.005;
  blade.add(core, faceA, faceB);
  blade.position.y = 0.075;
  g.add(handle, blade);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function nameTag(text) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const g = c.getContext("2d");
  g.font = "bold 30px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  const w = Math.min(244, g.measureText(text).width + 28);
  g.fillStyle = "rgba(10,16,34,0.72)"; g.beginPath(); g.roundRect ? g.roundRect(128 - w / 2, 10, w, 44, 14) : g.rect(128 - w / 2, 10, w, 44); g.fill();
  g.fillStyle = "#fff"; g.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(0.56, 0.14, 1);
  return s;
}

export class Person {
  // spec: { seat, side, human, hl (HopLobby player id for avatars), name, look (bot index),
  // off (where their table is; sim positions are table-local) }
  constructor(scene, spec) {
    this.scene = scene;
    this.off = spec.off ? spec.off.clone() : new THREE.Vector3();
    this.lite = false;           // no arm IK (a far table on a low preset)
    this.seat = spec.seat; this.side = spec.side; this.s = spec.side === "p" ? 1 : -1;
    this.right = spec.side === "p" ? 1 : -1;       // world x of their right hand
    this.human = !!spec.human; this.hl = spec.hl || null; this.look = spec.look || 0; this.name = spec.name || spec.seat;
    this.root = new THREE.Group(); this.root.visible = false; scene.add(this.root);
    this.paddle = makePaddle(); this.paddle.visible = false; scene.add(this.paddle);
    this.e = null; this.mixer = null; this.acts = {}; this.state = "idle";
    this.sw = null; this.ikW = 0; this.vx = 0; this.vz = 0; this.yaw = this.s > 0 ? 0 : Math.PI;
    this.tag = null; this.scale = 1; this.ready = false; this.failed = false;
    this.set(spec.tagText);
  }

  set(tagText) {
    if (this.tag) { this.root.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); }
    this.tag = nameTag(tagText || this.name);
    this.root.add(this.tag);
    this.tag.position.y = 1.9;
  }

  // Fetch and build the character. Resolves when it is on screen (or has failed to a bot).
  load() {
    const useAvatar = this.human && this.hl && typeof HopLobby !== "undefined" && HopLobby.context && !HopLobby.context.standalone;
    const get = useAvatar ? HopLobby.avatar(this.hl, { format: "glb" }) : loadBotBuffer(this.look % BOTS.length);
    return get.then((buf) => parseAvatar(buf)).then((e) => this.build(e, !useAvatar)).catch((err) => {
      // An avatar that will not load: fall back to a bot so the match can go on (the bot is only a stand-in).
      if (useAvatar && !this.fellBack) { this.fellBack = true; this.hl = null; return loadBotBuffer(this.look % BOTS.length).then(parseAvatar).then((e) => this.build(e, true)); }
      this.failed = true; throw err;
    });
  }

  build(e, bot) {
    this.e = e;
    const scene = e.gltf.scene;
    this.root.add(scene);
    this.scale = bot ? (BOTS[this.look % BOTS.length].h / SKEL_H) : (e.height > 2.3 || e.height < 1.0 ? 1.62 / e.height : 1);
    scene.scale.setScalar(this.scale);
    this.mixer = new THREE.AnimationMixer(scene);
    ["idle", "walk", "run", "cheer", "shrug", "wave"].forEach((k) => {
      const c = e.clips[k]; if (!c) return;
      const a = this.mixer.clipAction(c); a.enabled = true;
      if (k === "cheer" || k === "shrug" || k === "wave") { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; }
      this.acts[k] = a;
    });
    if (this.acts.idle) { this.acts.idle.play(); this.cur = "idle"; }
    this.root.visible = true; this.paddle.visible = true;
    this.ready = true;
    this.root.updateMatrixWorld(true);
  }

  // A one-shot emote (cheer / shrug / wave) over the body; the arms are free while it plays.
  emote(kind, secs) {
    const a = this.acts[kind]; if (!a) return;
    a.reset().setEffectiveWeight(1).play();
    this.emoteUntil = secs;           // seconds left
    this.ikW = 0;
  }

  // The ball is about to be hit: where and how (set from the sim's plan / hit / serve events).
  // c is table-local.
  plan(tc, c, dir) { this.sw = { tc, c: c.clone().add(this.off), dir: dir.clone(), kind: "drive", hit: false }; }
  hit(t, c, dir, kind) { this.sw = { tc: t, c: c.clone().add(this.off), dir: dir.clone(), kind: kind || "drive", hit: true }; }

  // Hand path around the contact point; u = seconds from contact.
  handTarget(out, u, base) {
    const sw = this.sw, s = this.s;
    const dir = sw.dir, c = sw.c;
    const push = sw.kind === "push" || sw.kind === "block", lob = sw.kind === "lob";
    // Backswing point: behind and below (forehand drive), higher for a lob, short for a push.
    const back = _w.copy(c).addScaledVector(dir, push ? -0.28 : lob ? -0.4 : -0.55);
    back.y += push ? 0.02 : lob ? -0.28 : -0.22;
    back.x += this.right * 0.1;
    const fwd = _v.copy(c).addScaledVector(dir, push ? 0.2 : 0.38);
    fwd.y += push ? -0.06 : lob ? 0.5 : 0.22;
    if (u < -0.5) return false;
    if (u < 0) { out.copy(base).lerp(back, ease((u + 0.5) / 0.5)); return true; }
    if (u < 0.1) { out.copy(back).lerp(c, ease(u / 0.1)); return true; }
    if (u < 0.3) { out.copy(c).lerp(fwd, ease((u - 0.1) / 0.2)); return true; }
    if (u < 0.65) { out.copy(fwd).lerp(base, ease((u - 0.3) / 0.35)); return true; }
    return false;
  }

  update(dt, simT, sim, phase) {
    if (!this.ready) return;
    const root = this.root, s = this.s;
    // Place: the contact is on the right-hand side of the body.
    const tx = sim.x - this.right * 0.5, tz = sim.z + s * 0.3;
    const dx = tx - root.position.x, dz = tz - root.position.z;
    this.vx = dt > 0 ? dx / dt : 0; this.vz = dt > 0 ? dz / dt : 0;
    root.position.set(tx + this.off.x, 0, tz + this.off.z);
    // Face the net, turning a little toward where they are running.
    const sp = Math.hypot(sim.vx || 0, sim.vz || 0);
    const target = s > 0 ? 0 : Math.PI;
    const lean = sp > 0.4 ? Math.atan2(-(sim.vx || 0), -(sim.vz || 0) * (s > 0 ? 1 : -1)) : target;
    const want = target + (sp > 0.4 ? Math.max(-0.5, Math.min(0.5, Math.atan2(sim.vx || 0, 4) * -s * 0.0)) : 0);
    this.yaw += (want - this.yaw) * Math.min(1, dt * 8);
    root.rotation.y = this.yaw;
    // Locomotion clips
    const want2 = sp > 2.6 ? "run" : sp > 0.5 ? "walk" : "idle";
    if (want2 !== this.cur && this.acts[want2] && !(this.emoteUntil > 0)) {
      const a = this.acts[want2], b = this.acts[this.cur];
      a.reset().play(); if (b) a.crossFadeFrom(b, 0.18, false);
      this.cur = want2;
    }
    if (this.acts[this.cur] && this.cur !== "idle") this.acts[this.cur].timeScale = Math.max(0.6, Math.min(1.6, sp / (this.cur === "run" ? 4 : 1.6)));
    if (this.emoteUntil > 0) { this.emoteUntil -= dt; if (this.emoteUntil <= 0) { this.ikW = 1; ["cheer", "shrug", "wave"].forEach((k) => { if (this.acts[k]) this.acts[k].fadeOut(0.2); }); } }
    this.mixer.update(dt);
    root.updateMatrixWorld(true);
    if (this.lite) { this.paddle.position.copy(root.position).add(_v.set(this.right * 0.3, 0.95, -s * 0.3)); return; }
    this.pose(simT, phase);
  }

  pose(simT, phase) {
    const e = this.e, rig = e.rig, s = this.s;
    const rest = new THREE.Vector3();
    if (!rig) { this.paddle.position.copy(this.root.position).add(_v.set(this.right * 0.3, 1.0, -s * 0.3)); return; }
    const chest = rig[CHEST].getWorldPosition(_v).clone();
    const fwd = new THREE.Vector3(0, 0, -s), right = new THREE.Vector3(this.right, 0, 0);
    const sc = this.scale;
    // Ready position: paddle out in front, a little to the right, elbow bent.
    rest.copy(chest).addScaledVector(fwd, 0.36 * sc).addScaledVector(right, 0.2 * sc); rest.y -= 0.2 * sc;
    const hand = new THREE.Vector3().copy(rest);
    let on = phase !== "over";
    let faceN = fwd.clone(), tilt = 0;
    if (this.sw) {
      const u = simT - this.sw.tc;
      if (this.handTarget(hand, u, rest)) { faceN.copy(this.sw.dir); tilt = this.sw.kind === "push" ? 0.5 : this.sw.kind === "lob" ? 0.8 : -0.25; }
      else hand.copy(rest);
    }
    if (this.ikW > 0.001 && on) {
      const pole = new THREE.Vector3().copy(chest).addScaledVector(right, 0.5).addScaledVector(fwd, -0.15); pole.y -= 0.55;
      ik(e, "R", hand, pole, this.ikW);
    }
    // The other hand: relaxed in front, loosely following.
    if (this.ikW > 0.001 && on && !(this.sw && this.sw.kind === "serve")) {
      const lt = new THREE.Vector3().copy(chest).addScaledVector(fwd, 0.3 * sc).addScaledVector(right, -0.28 * sc); lt.y -= 0.32 * sc;
      const lpole = new THREE.Vector3().copy(chest).addScaledVector(right, -0.5).addScaledVector(fwd, -0.1); lpole.y -= 0.55;
      ik(e, "L", lt, lpole, 0.8 * this.ikW);
    }
    // The paddle sits in the right hand; its face points where the shot goes.
    const hb = rig[8];
    hb.getWorldPosition(this.paddle.position);
    const n = faceN.clone(); n.y += tilt * 0.4; n.normalize();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize();
    if (up.lengthSq() < 0.01) up.set(0, 0, 1);
    _m.lookAt(new THREE.Vector3(), n.clone().negate(), up);
    // blade face normal is local +z; lookAt points -z at target, so aim -z at -n.
    this.paddle.quaternion.setFromRotationMatrix(_m);
    this.paddle.rotateX(0.0);
    if (!(this.ikW > 0.001 && on)) { this.paddle.position.copy(hand); }
  }

  dispose() {
    this.scene.remove(this.root); this.scene.remove(this.paddle);
    if (this.mixer) this.mixer.stopAllAction();
  }
}
