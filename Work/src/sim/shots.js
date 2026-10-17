// Shot solver: an intent (aim, depth, pace, kind) -> a launch velocity that lands where it was
// aimed and clears the net. Pure.
import { BALL, TABLE, DT, stepBall, copyBall, netTop } from "./physics.js";

// Fly from p0 with velocity v until the first table bounce, floor hit or net hit.
// Returns { x, z, t, netY, netX, net, floor, bounced }.
export function fly(p0, v, t, s, maxT = 4) {
  const b = { x: p0.x, y: p0.y, z: p0.z, vx: v.x, vy: v.y, vz: v.z, t, s };
  let netY = null, netX = 0;
  for (let k = 1; k * DT < maxT; k++) {
    const z0 = b.z, x0 = b.x, y0 = b.y;
    const ev = stepBall(b);
    if (netY === null && (z0 > 0) !== (b.z > 0) && z0 !== 0) {
      const u = z0 / (z0 - b.z);
      netY = y0 + (b.y - y0) * u; netX = x0 + (b.x - x0) * u;
    }
    if (ev && ev.type === "net" && !ev.cord) return { x: b.x, z: b.z, t: k * DT, netY, netX, net: true };
    if (ev && ev.type === "bounce") return { x: b.x, z: b.z, t: k * DT, netY, netX, bounced: true };
    if (ev && ev.type === "floor") return { x: b.x, z: b.z, t: k * DT, netY, netX, floor: true };
  }
  return { x: b.x, z: b.z, t: maxT, netY, netX, floor: true };
}

// Velocity that lands on (tx, tz) from p0 in about T seconds, with spin (t, s).
export function solve(p0, tx, tz, T, t = 0, s = 0) {
  const g = BALL.g, yEnd = TABLE.top + BALL.r;
  const v = { x: (tx - p0.x) / T, z: (tz - p0.z) / T, y: (yEnd - p0.y + 0.5 * g * T * T) / T };
  for (let i = 0; i < 16; i++) {
    const land = fly(p0, v, t, s);
    const ex = tx - land.x, ez = tz - land.z;
    if (Math.abs(ex) < 0.012 && Math.abs(ez) < 0.012) break;
    const tt = Math.max(0.15, land.t);
    v.x += ex / tt; v.z += ez / tt;
  }
  return v;
}

// Launch velocity for a shot to (tx, tz) at about horizontal speed hs (m/s). Lengthens the flight
// until the ball clears the net by `clear` metres; minT forces a slow high arc (lobs).
export function shotVelocity(p0, tx, tz, hs, t = 0, s = 0, clear = 0.035, minT = 0.2) {
  const dist = Math.hypot(tx - p0.x, tz - p0.z);
  let T = Math.max(minT, dist / hs);
  let v = null;
  for (let i = 0; i < 26; i++) {
    v = solve(p0, tx, tz, T, t, s);
    const land = fly(p0, v, t, s);
    if (!land.net && (land.netY === null || land.netY - BALL.r > netTop() + clear)) break;
    T *= 1.07;
  }
  return v;
}

// A serve: the ball first bounces on the server's own half, then crosses and lands near (tx, tz).
// Scans launch angle and speed (azimuth corrected for x) and keeps the legal serve that lands
// closest to the target. Returns { v, err, bounce } or null.
function simServe(p0, v, t, s, side) {
  const b = { x: p0.x, y: p0.y, z: p0.z, vx: v.x, vy: v.y, vz: v.z, t, s };
  let bounces = 0, netY = null, first = null;
  for (let k = 0; k < 700; k++) {
    const z0 = b.z, y0 = b.y;
    const ev = stepBall(b);
    if (netY === null && (z0 > 0) !== (b.z > 0) && z0 !== 0) {
      const u = z0 / (z0 - b.z); netY = y0 + (b.y - y0) * u;
    }
    if (!ev) continue;
    if (ev.type === "net" && !ev.cord) return null;
    if (ev.type === "floor") return null;
    if (ev.type === "bounce") {
      bounces++;
      if (bounces === 1) { if (Math.sign(ev.z) !== side) return null; first = ev; }
      if (bounces === 2) {
        if (netY === null || netY - BALL.r < netTop() + 0.015) return null;
        return { x: ev.x, z: ev.z, first };
      }
    }
  }
  return null;
}

export function serveVelocity(p0, tx, tz, t, s, side) {
  let best = null;
  for (let a = 0; a < 9; a++) {
    const ang = (3 + a * 6) * Math.PI / 180;          // below horizontal
    for (let sp = 0; sp < 14; sp++) {
      const speed = 2.2 + sp * 0.6;
      const hz = Math.cos(ang) * speed, vy = -Math.sin(ang) * speed;
      let vx = (tx - p0.x) / 1.2 * hz / Math.max(0.5, Math.abs(tz - p0.z)) * 1.0;
      let r = null;
      for (let it = 0; it < 3; it++) {
        const v = { x: vx, y: vy, z: -side * hz };
        r = simServe(p0, v, t, s, side);
        if (!r) break;
        const ex = tx - r.x;
        if (Math.abs(ex) < 0.02) break;
        vx += ex * 0.9;
      }
      if (!r) continue;
      const v = { x: vx, y: vy, z: -side * hz };
      const r2 = simServe(p0, v, t, s, side);
      if (!r2) continue;
      const err = Math.hypot(r2.x - tx, r2.z - tz);
      if (!best || err < best.err) best = { v, err, bounce: { x: r2.first.x, z: r2.first.z } };
    }
  }
  return best;
}
// Intent -> target and pace. side: the hitter's z sign (+1 / -1); right: world x of the hitter's
// right (+1 or -1). aim is in the hitter's frame (+1 = their right). contactY: ball height.
// Returns { tx, tz, hs, t, s, kind, minT }.
export function shotTarget(intent, side, right, contactY, dist = 2) {
  const aim = Math.max(-1, Math.min(1, intent.aim || 0));
  const depth = Math.max(0, Math.min(1, intent.depth == null ? 0.6 : intent.depth));
  const pace = Math.max(0, Math.min(1, intent.pace == null ? 0.5 : intent.pace));
  const curve = Math.max(-1, Math.min(1, intent.curve || 0));
  let kind = intent.kind || "drive", dz, hs, t = 0, minT = 0.2, ax = 0.64;
  const high = contactY > TABLE.top + 0.34;
  if (kind === "push") { dz = 0.3 + depth * 0.7; hs = 3.4 + pace * 2.2; t = -(0.55 + pace * 0.3); }
  else if (kind === "lob") { dz = 0.95 + depth * 0.32; hs = 5 + pace * 1.5; t = 0.2; minT = 0.95; ax = 0.55; }
  else if (kind === "serve") { dz = 0.55 + depth * 0.75; hs = 3.6 + pace * 2.5; t = pace > 0.6 ? 0.3 : -0.4; }
  else if (high && pace > 0.35 && dist < 2.6) { kind = "smash"; dz = 0.65 + depth * 0.45; hs = 14 + pace * 8; t = 0.15; }
  else if (pace < 0.2 && depth < 0.4) { kind = "block"; dz = 0.3 + depth * 0.6; hs = 4.2 + pace * 3; t = 0.05; }
  else { kind = "drive"; dz = 0.55 + depth * 0.75; hs = 6.5 + pace * 8.5; t = 0.4 + pace * 0.45; }
  return { tx: aim * right * ax, tz: -side * dz, hs, t, s: curve * 0.6, kind, minT };
}

export { copyBall, stepBall, TABLE };
