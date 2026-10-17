// Reading a rigged glTF character and posing its arms in world space. Works for HopLobby's 19-bone
// avatars and for our own cast (same skeleton shape), whatever their bone names or axes.
// (Ported from Hop Spades' seats.js.)
const THREE = globalThis.THREE;

// Bone names aren't documented: the root bone is the hips, the highest bone the head, chains off the
// head-to-hips path are the arms (right = +X, the model faces -Z), chains off the hips the legs.
export function readRig(bones) {
  if (bones.length < 10) return null;
  const isBone = (o) => o && o.isBone;
  const kids = (b) => b.children.filter(isBone);
  const wp = new Map();
  bones.forEach((b) => wp.set(b, b.getWorldPosition(new THREE.Vector3())));
  const count = (b) => { let n = 1; kids(b).forEach((k) => { n += count(k); }); return n; };
  const roots = bones.filter((b) => !isBone(b.parent)).sort((a, b) => count(b) - count(a));
  const hips = roots[0];
  if (!hips) return null;
  const under = []; (function walk(b) { under.push(b); kids(b).forEach(walk); })(hips);
  const head = under.slice().sort((a, b) => wp.get(b).y - wp.get(a).y)[0];
  const path = [];
  for (let b = head; b; b = isBone(b.parent) ? b.parent : null) { path.push(b); if (b === hips) break; }
  if (path[path.length - 1] !== hips) return null;
  const onPath = new Set(path);
  const chain = (b) => { const c = [b]; let k = kids(b); while (k.length) { k.sort((x, y) => count(y) - count(x)); c.push(k[0]); k = kids(k[0]); } return c; };
  const arms = [], legs = [];
  path.forEach((b) => kids(b).forEach((k) => { if (!onPath.has(k)) (b === hips ? legs : arms).push(chain(k)); }));
  if (arms.length < 2 || legs.length < 2) return null;
  const side = (c) => wp.get(c[Math.min(c.length - 1, 2)]).x;
  arms.sort((a, b) => side(b) - side(a));
  legs.sort((a, b) => side(b) - side(a));
  const armR = arms[0], armL = arms[arms.length - 1], legR = legs[0], legL = legs[legs.length - 1];
  if (armR.length < 3 || armL.length < 3 || legR.length < 3 || legL.length < 3) return null;
  const arm = (c) => { const n = c.length; return [n >= 4 ? c[n - 4] : null, c[n - 3], c[n - 2], c[n - 1]]; };
  const leg = (c) => [c[0], c[1], c[2]];
  const chest = armR[0].parent;
  const ci = path.indexOf(chest);
  if (ci < 0) return null;
  const lower = path.slice(ci + 1, path.length - 1), upper = path.slice(1, ci);
  const a = arm(armR), b = arm(armL), l = leg(legR), m = leg(legL);
  return [hips, lower.length ? lower[lower.length - 1] : null, chest, upper.length ? upper[upper.length - 1] : null, head,
    a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3], l[0], l[1], l[2], m[0], m[1], m[2]];
}
export const HIPS = 0, SPINE = 1, CHEST = 2, NECK = 3, HEAD = 4;
export const ARM = { R: [5, 6, 7, 8], L: [9, 10, 11, 12] };

// Parse a GLB buffer into { gltf, clips, bones, rest..., rig, height, minY }.
export function parseAvatar(buf) {
  return new THREE.GLTFLoader().parseAsync(buf.slice(0), "").then((gltf) => {
    const e = { gltf, clips: {} };
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    e.height = Math.max(0.5, box.max.y - Math.min(0, box.min.y));
    e.minY = box.min.y;
    gltf.animations.forEach((a) => { e.clips[a.name.toLowerCase().replace(/^.*\|/, "")] = a; });
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    const bones = [];
    scene.traverse((o) => { if (o.isBone) bones.push(o); });
    e.bones = bones;
    e.rig = readRig(bones);
    return e;
  });
}

// ---- world-space bone helpers
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Quaternion();
const _af = new THREE.Vector3(), _ad = new THREE.Vector3(), _ab = new THREE.Vector3();
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _s = new THREE.Vector3(), _e = new THREE.Vector3(), _h = new THREE.Vector3(), _t = new THREE.Vector3(),
  _d = new THREE.Vector3(), _pl = new THREE.Vector3(), _el = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Rotate a bone by `angle` about a world axis.
export function rotWorld(bone, axis, angle) {
  if (!bone || !angle) return;
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(_q);
  _q2.setFromAxisAngle(axis, angle).multiply(_q);
  bone.parent.getWorldQuaternion(_p);
  bone.quaternion.copy(_p.invert().multiply(_q2));
}
// Swing a bone so the direction from it to `tipNow` points along `dirWant` (world).
export function aim(bone, tipNow, dirWant, w) {
  _ad.copy(dirWant).normalize();
  const from = _af.copy(tipNow).sub(bone.getWorldPosition(_ab)).normalize();
  _q2.setFromUnitVectors(from, _ad);
  bone.getWorldQuaternion(_q);
  const want = _q2.multiply(_q);
  bone.parent.getWorldQuaternion(_p);
  const local = _p.invert().multiply(want);
  if (w >= 1) bone.quaternion.copy(local); else bone.quaternion.slerp(local, w);
  bone.updateWorldMatrix(false, true);
}
// Two-bone IK: put the hand of the arm at `target`, the elbow toward `pole`.
export function ik(e, side, target, pole, w) {
  const ch = ARM[side];
  const up = e.rig[ch[1]], lo = e.rig[ch[2]], hd = e.rig[ch[3]];
  if (!up || !lo || !hd || w <= 0.001) return;
  up.updateWorldMatrix(true, true);
  up.getWorldPosition(_s); lo.getWorldPosition(_e); hd.getWorldPosition(_h);
  const a = _s.distanceTo(_e), b = _e.distanceTo(_h);
  _d.copy(target).sub(_s);
  let c = _d.length();
  c = clamp(c, Math.abs(a - b) + 0.01, a + b - 0.005);
  _d.normalize();
  const cosA = clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  _pl.copy(pole).sub(_s);
  _pl.addScaledVector(_d, -_pl.dot(_d)).normalize();
  _el.copy(_s).addScaledVector(_d, a * cosA).addScaledVector(_pl, a * sinA);
  const t = _t.copy(_s).addScaledVector(_d, c);
  aim(up, _e, _v.copy(_el).sub(_s), w);
  lo.getWorldPosition(_e); hd.getWorldPosition(_h);
  aim(lo, _h, _w.copy(t).sub(_e), w);
}
