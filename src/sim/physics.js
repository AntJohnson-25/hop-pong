// Table tennis ball physics and trajectory prediction. Pure: no DOM, no three.js.
//
// Metres. The net is the plane z = 0; the "p" side is z > 0 facing -z, the "c" side is z < 0
// facing +z. y is up (world height, floor = 0). Spin: t = topspin (+) / backspin (-), s = sidespin.

export const TABLE = {
  halfW: 0.7625,     // 1.525 m wide
  halfL: 1.37,       // 2.74 m long
  top: 0.76,         // playing surface height
  netH: 0.1525,      // net above the surface
  netHalfW: 0.9125   // net posts stand 15.25 cm outside the sidelines
};

export const BALL = {
  r: 0.02,           // 40 mm ball
  g: 9.81,
  drag: 0.11,        // quadratic air drag, 1/m
  magT: 0.42,        // topspin: extra downward accel per unit spin, per m/s
  magS: 0.30,        // sidespin curve
  eTable: 0.9,       // vertical restitution on the table
  fric: 0.94,        // horizontal speed kept on a table bounce
  kickT: 1.6,        // m/s forward kick per unit topspin on a table bounce
  kickS: 1.1         // m/s sideways kick per unit sidespin
};

export const DT = 1 / 120;

export const netTop = () => TABLE.top + TABLE.netH;

export function onTable(x, z, eps = 0) {
  return Math.abs(x) <= TABLE.halfW + eps && Math.abs(z) <= TABLE.halfL + eps;
}

export function makeBall() {
  return { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, t: 0, s: 0 };
}

export function copyBall(b) {
  return { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, t: b.t, s: b.s };
}

// One fixed step. Returns null or an event:
//   { type: "bounce", x, z }    on the table
//   { type: "net", cord }       cord: true = clipped the tape and dribbled over (a let on serve)
//   { type: "floor", x, z }     hit the floor / anything that is not the table
export function stepBall(b, dt = DT) {
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  const k = BALL.drag * sp;
  b.vx -= b.vx * k * dt;
  b.vz -= b.vz * k * dt;
  b.vy -= (BALL.g + b.vy * k + BALL.magT * b.t * sp) * dt;
  // Sidespin curves the ball sideways (cross product with up).
  b.vx += BALL.magS * b.s * b.vz * dt;
  b.vz -= BALL.magS * b.s * b.vx * dt;
  const z0 = b.z, x0 = b.x, y0 = b.y;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  let ev = null;
  // Net: did the ball's centre cross z = 0 this step?
  if ((z0 > 0) !== (b.z > 0) && z0 !== 0) {
    const u = z0 / (z0 - b.z);
    const xc = x0 + (b.x - x0) * u, yc = y0 + (b.y - y0) * u;
    const top = netTop();
    if (Math.abs(xc) < TABLE.netHalfW && yc - BALL.r < top && yc > TABLE.top - 0.2) {
      if (yc > top - BALL.r * 0.7) {
        // Clipped the tape: it trickles over, slowed and popped up.
        b.vz *= 0.3; b.vx *= 0.5; b.vy = Math.abs(b.vy) * 0.2 + 0.7;
        b.y = Math.max(b.y, top + BALL.r);
        b.t = 0; b.s = 0;
        ev = { type: "net", cord: true };
      } else {
        // Into the net: it drops dead on the hitter's side.
        const sgn = z0 > 0 ? 1 : -1;
        b.z = sgn * BALL.r * 1.5;
        b.vz = -b.vz * 0.1; b.vx *= 0.2; b.vy = Math.min(b.vy, 0) * 0.3;
        b.t = 0; b.s = 0;
        ev = { type: "net", cord: false };
      }
    }
  }
  if (!ev && b.vy < 0) {
    const floor = TABLE.top + BALL.r;
    if (b.y <= floor && y0 > floor - 0.15 && onTable(b.x, b.z, BALL.r * 0.5)) {
      b.y = floor;
      b.vy = -b.vy * BALL.eTable;
      const d = b.vz >= 0 ? 1 : -1;
      b.vx *= BALL.fric; b.vz *= BALL.fric;
      b.vz += d * BALL.kickT * b.t;
      b.vx += BALL.kickS * b.s;
      b.t *= 0.55; b.s *= 0.6;
      ev = { type: "bounce", x: b.x, z: b.z };
    } else if (b.y <= BALL.r) {
      b.y = BALL.r;
      b.vy = -b.vy * 0.7;
      b.vx *= 0.8; b.vz *= 0.8;
      ev = { type: "floor", x: b.x, z: b.z };
    }
  }
  return ev;
}

// Fly a copy of the ball forward. Samples every step until `maxBounces` table bounces, a floor
// hit or maxT. Each sample: { t, x, y, z, vx, vy, vz, b } where b = table bounces so far.
export function predict(ball, maxT = 3, maxBounces = 2) {
  const b = copyBall(ball);
  const samples = [];
  const bounces = [];
  let n = 0, net = false, floor = false;
  for (let t = DT; t <= maxT; t += DT) {
    const ev = stepBall(b);
    if (ev && ev.type === "bounce") { n++; bounces.push({ t, x: ev.x, z: ev.z }); }
    if (ev && ev.type === "net" && !ev.cord) net = true;
    if (ev && ev.type === "floor") floor = true;
    samples.push({ t, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, st: b.t, ss: b.s, b: n });
    if (n >= maxBounces || floor || net) break;
  }
  return { samples, bounces, net, floor };
}
