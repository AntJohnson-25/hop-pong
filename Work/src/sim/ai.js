// Computer opponents and partners. Pure. Difficulty sets speed, aim error and how clever the shots are.
// The AI is beatable on purpose: the human's auto-move is faster than every level.
import { TABLE } from "./physics.js";
import { rightX } from "./rules.js";

export const LEVELS = {
  // err: spread of the swing quality (bigger = sloppier); pace: shot power range; smart: uses placement.
  easy:   { name: "Easy",   speed: 3.2, err: 0.9,  pErr: 0.30, pace: [0.1, 0.4],  smart: 0,   spin: 0.0 },
  medium: { name: "Medium", speed: 4.0, err: 0.55, pErr: 0.18, pace: [0.25, 0.65], smart: 0.5, spin: 0.5 },
  hard:   { name: "Hard",   speed: 4.7, err: 0.3,  pErr: 0.075, pace: [0.4, 0.85], smart: 1,   spin: 1.0 }
};

const rnd = (rng, a, b) => a + (b - a) * rng();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function gauss(rng) {
  const u = Math.max(1e-9, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Swing quality 0..1 for an AI swing (1 = perfect).
export function aiQuality(lv, rng, inc = 6, shots = 0) {
  // inc: speed of the ball being returned; fast balls are easier to miss.
  if (rng() < lv.pErr * (0.4 + inc / 9) * (1 + shots / 10)) return 0.05;
  return clamp(1 - Math.abs(gauss(rng)) * lv.err * 0.6, 0.1, 1);
}

// The shot: { kind, aim, depth, pace, curve } (aim in the hitter's frame, +1 = their right).
// me: { side, x, z }; opp: the player who will hit next on the other side { x, z }.
export function aiShot(lv, me, opp, contactY, rng, dbl = false) {
  const r = rightX(me.side);
  const aimAt = (worldX) => clamp(worldX / (0.64 * r), -1, 1);
  const pace = rnd(rng, lv.pace[0], lv.pace[1]);
  const high = contactY > TABLE.top + 0.34;
  const away = clamp(-Math.sign(opp.x || rnd(rng, -1, 1)) * rnd(rng, 0.25, 0.7), -0.7, 0.7) * (dbl ? 0.45 : 1);
  const curve = lv.spin > 0 && rng() < 0.25 * lv.spin ? rnd(rng, -0.8, 0.8) : 0;
  if (high && lv.smart > 0 && rng() < 0.5 + 0.4 * lv.smart) {
    return { kind: "drive", aim: aimAt(away), depth: rnd(rng, 0.4, 0.9), pace: rnd(rng, 0.75, 1), curve: 0 };
  }
  if (contactY < TABLE.top + 0.1 && rng() < 0.45) {
    return { kind: "push", aim: rnd(rng, -0.6, 0.6), depth: rnd(rng, 0.1, 0.6), pace: rnd(rng, 0.2, 0.6), curve: 0 };
  }
  if (lv.smart > 0 && rng() < 0.08 * lv.smart) {
    return { kind: "lob", aim: rnd(rng, -0.5, 0.5), depth: rnd(rng, 0.3, 0.9), pace: 0.4, curve: 0 };
  }
  if (lv.smart === 0) {
    return { kind: "drive", aim: rnd(rng, -0.5, 0.5), depth: rnd(rng, 0.45, 0.85), pace, curve: 0 };
  }
  return { kind: "drive", aim: aimAt(away), depth: rnd(rng, 0.45, 1.0), pace, curve };
}

// A serve: short or long, either corner; deliberate rather than clever.
export function aiServe(lv, rng) {
  return { kind: "serve", aim: rnd(rng, -0.8, 0.8), depth: rnd(rng, 0.2, 0.95), pace: rnd(rng, lv.pace[0], lv.pace[1]), curve: 0 };
}
