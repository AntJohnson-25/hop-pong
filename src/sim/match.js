// One table tennis game (singles or doubles): players, ball, rules, AI and swipe timing.
// Pure: no DOM, no three.js. The view and HUD read this state and drain `events`.
// The same class runs solo (grace 0) and as the host's authority in a lobby (grace > 0 waits a
// moment for a remote player's swing message to arrive).
import { DT, TABLE, makeBall, stepBall, predict, copyBall } from "./physics.js";
import { shotTarget, shotVelocity, serveVelocity, fly } from "./shots.js";
import { Rules, other, rightX, sideOfZ, sideOf } from "./rules.js";
import { LEVELS, aiShot, aiServe, aiQuality } from "./ai.js";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  const u = Math.max(1e-9, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Swing timing windows, seconds from the moment of contact.
export const TIMING = { perfect: 0.05, good: 0.11, ok: 0.2, early: 0.3 };
export const HUMAN_SPEED = 5.0;     // faster than every AI level
export const BASE_Z = 2.15;         // where players wait, from the net
const REACH = 1.2;                  // how far from the contact spot a hit still connects

function makeSeat(spec, doubles) {
  const side = spec.seat[0], s = side === "p" ? 1 : -1;
  const idx = +spec.seat[1];
  const homeX = doubles ? (idx === 0 ? 0.45 : -0.45) * rightX(side) : 0;
  return {
    seat: spec.seat, side, s, idx, homeX,
    human: !!spec.human, id: spec.id || null, name: spec.name || spec.seat,
    lv: spec.human ? null : LEVELS[spec.level || "medium"],
    speed: spec.human ? HUMAN_SPEED : LEVELS[spec.level || "medium"].speed,
    x: homeX, z: s * BASE_Z, tx: homeX, tz: s * BASE_Z
  };
}

export class Match {
  constructor(o = {}) {
    this.doubles = !!o.doubles;
    this.rng = mulberry32(o.seed == null ? (Date.now() & 0xffffffff) : o.seed);
    this.grace = o.grace || 0;
    this.serveDelay = o.serveDelay == null ? 1.1 : o.serveDelay;
    this.pointDelay = o.pointDelay == null ? 1.5 : o.pointDelay;
    const specs = o.seats || (this.doubles
      ? [{ seat: "p0", human: true }, { seat: "p1" }, { seat: "c0" }, { seat: "c1" }]
      : [{ seat: "p0", human: true }, { seat: "c0" }]);
    this.seats = specs.map((sp) => makeSeat({ level: o.level || "medium", ...sp }, this.doubles));
    this.bySeat = {};
    for (const p of this.seats) this.bySeat[p.seat] = p;
    this.rules = new Rules({ doubles: this.doubles, first: o.first || "p", target: o.target || 11 });
    this.ball = makeBall();
    this.t = 0;
    this.acc = 0;
    this.events = [];
    this.plan = null;
    this.rallyT = 0;
    this.phase = "serve";           // serve | rally | point | over
    this.phaseT = 0;
    this.aiServeAt = 0;
    this.frozen = false;
    this.rallies = 0;
    this.beginServe();
  }

  // A human left: the computer takes the seat. A joiner takes a computer seat.
  convertToAI(seat, level) {
    const p = this.bySeat[seat]; if (!p) return;
    p.human = false; p.id = null; p.lv = LEVELS[level] || LEVELS.medium; p.speed = p.lv.speed;
    if (this.plan && this.plan.seat === seat && !this.plan.swing && !this.plan.done) {
      const nxt = this.bySeat[this.afterNext(seat)] || this.seats.find((q) => q.side !== p.side);
      this.plan.intent = aiShot(p.lv, p, nxt, this.plan.cy, this.rng, this.doubles); this.plan.q = aiQuality(p.lv, this.rng);
    }
  }
  convertToHuman(seat, id, name) {
    const p = this.bySeat[seat]; if (!p) return;
    p.human = true; p.id = id; p.name = name || p.name; p.lv = null; p.speed = HUMAN_SPEED;
  }

  // Carry on from a score (a new host taking over).
  restore(p, c) { this.rules.restore(p, c); this.beginServe(); }

  emit(e) { e.t = this.t; this.events.push(e); }
  drain() { const e = this.events; this.events = []; return e; }

  server() { return this.bySeat[this.rules.server]; }
  receiver() { return this.bySeat[this.rules.receiver]; }

  // Where the server holds the ball.
  hand(sv) {
    return { x: sv.x + 0.25 * rightX(sv.side), y: 0.95, z: sv.s * (TABLE.halfL + 0.2) };
  }

  beginServe() {
    this.phase = "serve"; this.phaseT = 0;
    this.plan = null; this.frozen = false; this.rallyT = 0;
    this.rules.startRally();
    const sv = this.server();
    // Doubles: the server serves from their right half; singles from anywhere (centre).
    sv.tx = this.doubles ? this.rules.serveStartSign() * 0.4 : 0;
    sv.tz = sv.s * BASE_Z;
    for (const p of this.seats) if (p !== sv) { p.tx = p.homeX; p.tz = p.s * BASE_Z; }
    // Receiver waits at the matching spot; doubles partners stay out of the way.
    if (this.doubles) {
      const rc = this.receiver();
      rc.tx = this.rules.serveLandSign() * 0.4;
      for (const p of this.seats) {
        if (p !== sv && p !== rc && p.side === sv.side) p.tx = -this.rules.serveStartSign() * 1.1;
        if (p !== sv && p !== rc && p.side === rc.side) p.tx = -this.rules.serveLandSign() * 1.1;
      }
    }
    this.aiServeAt = this.serveDelay + 0.3 + this.rng() * 0.5;
    const h = this.hand(sv);
    Object.assign(this.ball, { x: h.x, y: h.y, z: h.z, vx: 0, vy: 0, vz: 0, t: 0, s: 0 });
    this.emit({ type: "ready", server: sv.seat, receiver: this.rules.receiver, call: this.rules.call(), score: { ...this.rules.score } });
  }

  // ---- input -----------------------------------------------------------------------------
  // A swing by `seat`. intent: { kind, aim, depth, pace, curve }. ts: sim time of release.
  swing(seat, intent, ts = this.t) {
    const p = this.bySeat[seat];
    if (!p) return false;
    if (this.phase === "serve") {
      if (seat !== this.rules.server || this.phaseT < 0.35) return false;
      this.doServe(p, { ...intent, kind: "serve" }, 1);
      return true;
    }
    const pl = this.plan;
    if (this.phase !== "rally" || !pl || pl.done || pl.seat !== seat || pl.swing) return false;
    const d = ts - pl.tc;
    if (Math.abs(d) > TIMING.early) return false;
    const ad = Math.abs(d);
    const q = ad <= TIMING.perfect ? 1 : ad <= TIMING.good ? 0.75 : ad <= TIMING.ok ? 0.45 : 0.2;
    pl.swing = { intent, q, d };
    if (this.t >= pl.tc) this.resolve(pl);
    return true;
  }

  // ---- serving ---------------------------------------------------------------------------
  doServe(sv, intent, q) {
    const rules = this.rules;
    const h = this.hand(sv);
    const p0 = { x: h.x, y: h.y, z: h.z };
    const tg = shotTarget(intent, sv.s, rightX(sv.side), 0.95);
    let tx = tg.tx, tz = tg.tz;
    const e = 1 - q;
    tx += gauss(this.rng) * 0.08 * e; tz += gauss(this.rng) * 0.1 * e;
    if (this.doubles) tx = rules.serveLandSign() * clamp(Math.abs(tx), 0.08, 0.62);
    else tx = clamp(tx, -0.62, 0.62);
    tz = -sv.s * clamp(Math.abs(tz), 0.4, 1.3);
    let best = serveVelocity(p0, tx, tz, tg.t, tg.s, sv.s);
    if (!best) best = serveVelocity(p0, this.doubles ? rules.serveLandSign() * 0.3 : 0, -sv.s * 0.8, 0, 0, sv.s);
    rules.hit(sv.seat, false);
    this.phase = "rally"; this.phaseT = 0; this.rallyT = 0;
    this.rallies++;
    if (!best) {          // should not happen: call it a bad serve
      Object.assign(this.ball, { ...p0, vx: 0, vy: 0, vz: 0, t: 0, s: 0 });
      this.endRally(rules.end(sv.side, "bad serve"));
      return;
    }
    Object.assign(this.ball, { ...p0, vx: best.v.x, vy: best.v.y, vz: best.v.z, t: tg.t, s: tg.s });
    this.afterHit(sv);
    this.emit({ type: "serve", seat: sv.seat, x: p0.x, y: p0.y, z: p0.z, v: best.v, q });
  }

  // ---- the rally -------------------------------------------------------------------------
  makePlan() {
    const rules = this.rules;
    const seat = rules.nextHitter();
    const p = this.bySeat[seat];
    const pr = predict(this.ball, 2.2, 2);
    let pick = null, last = null;
    for (const s of pr.samples) {
      const az = Math.abs(s.z);
      if (az > 3.4) break;
      if (sideOfZ(s.z) !== p.side) continue;
      if (s.b > 1 + (rules.shots === 1 ? 1 : 0)) break;
      last = s;
      if (s.t >= 0.1 && az >= 1.55 && s.y <= 1.7 && (s.vy <= 0 || az >= 2.4)) { pick = s; break; }
    }
    pick = pick || last;
    if (!pick || pick.y < 0.5 || Math.abs(pick.z) < TABLE.halfL) { this.plan = { seat, done: true, none: true }; return; }
    const pl = {
      seat, tc: this.t + pick.t, state: { x: pick.x, y: pick.y, z: pick.z, vx: pick.vx, vy: pick.vy, vz: pick.vz, t: pick.st, s: pick.ss },
      cx: pick.x, cy: pick.y, cz: pick.z, swing: null, done: false
    };
    // Can they get there?
    const reach = p.speed * pick.t + REACH;
    pl.reachable = Math.hypot(p.x - pl.cx, p.z - pl.cz) <= reach;
    p.tx = clamp(pl.cx, -1.6, 1.6); p.tz = clamp(pl.cz, p.s * 1.5, p.s * 3.4);
    if (this.doubles) {
      for (const q of this.seats) if (q !== p && q.side === p.side) { q.tx = clamp(-Math.sign(pl.cx || 1) * 1.0, -1.2, 1.2); q.tz = q.s * (BASE_Z + 0.3); }
    }
    if (!p.human) {
      const nxt = this.bySeat[this.afterNext(seat)] || this.seats.find((q) => q.side !== p.side);
      pl.intent = aiShot(p.lv, p, nxt, pick.y, this.rng, this.doubles);
      pl.q = aiQuality(p.lv, this.rng, Math.hypot(pick.vx, pick.vy, pick.vz), rules.shots);
    }
    this.plan = pl;
    this.emit({ type: "plan", seat, tc: pl.tc, cx: pl.cx, cy: pl.cy, cz: pl.cz, reachable: pl.reachable });
  }

  // Who hits after `seat` (for the AI's aim).
  afterNext(seat) {
    const o = this.rules.hitOrder();
    const i = o.indexOf(seat);
    return o[(i + 1) % o.length];
  }

  resolve(pl) {
    if (!pl || pl.done) return;
    pl.done = true;
    const p = this.bySeat[pl.seat];
    const sw = pl.swing || (p.human ? null : { intent: pl.intent, q: pl.q });
    if (!sw || !pl.reachable) {
      this.emit({ type: "whiff", seat: pl.seat });
      this.frozen = false;
      return;
    }
    const rules = this.rules;
    const e = 1 - sw.q;
    const tg = shotTarget(sw.intent, p.s, rightX(p.side), pl.cy, Math.abs(pl.cz));
    const rng = this.rng;
    const tx = tg.tx + gauss(rng) * 0.22 * e;
    let tz = tg.tz + gauss(rng) * 0.45 * e * -p.s;
    let hs = tg.hs * (1 - 0.3 * e * rng());
    const p0 = { x: pl.state.x, y: pl.state.y, z: pl.state.z };
    const sp = tg.t * (0.6 + 0.4 * sw.q);
    // A clean swing always finds a shot that clears the net and lands on the table (a hard one
    // from far back is slowed down until it does); a sloppy swing may miss.
    let v = null;
    for (let tries = 0; tries < 8; tries++) {
      v = shotVelocity(p0, tx, tz, hs, sp, tg.s, 0.035, tg.minT);
      const l = fly(p0, v, sp, tg.s);
      const good = !l.net && !l.floor && Math.abs(l.x) <= TABLE.halfW && -p.s * l.z > 0.02 && Math.abs(l.z) <= TABLE.halfL;
      if (good || e > 0.3) break;
      hs *= 0.82;
    }
    const over = rules.hit(pl.seat, false);
    this.frozen = false;
    // A hit by a player whose turn it was not is a fault; the ball dies where it was.
    if (over) { this.emit({ type: "hit", seat: pl.seat, kind: tg.kind, q: sw.q, d: sw.d }); this.endRally(over); return; }
    p.x = p.tx = clamp(pl.cx, -1.9, 1.9); p.z = p.tz = pl.cz;
    Object.assign(this.ball, p0, { vx: v.x, vy: v.y, vz: v.z, t: sp, s: tg.s });
    this.emit({ type: "hit", seat: pl.seat, kind: tg.kind, q: sw.q, d: sw.d, x: p0.x, y: p0.y, z: p0.z, v });
    // Catch the ball up to now (the swing message arrived after contact).
    const n = Math.round((this.t - pl.tc) / DT);
    for (let i = 0; i < n && this.phase === "rally"; i++) this.stepBall();
    if (this.phase === "rally") this.afterHit(p);
  }


  // After a hit (or a serve): go home; in doubles step out of the partner's way.
  afterHit(p) {
    p.tx = p.homeX; p.tz = p.s * BASE_Z;
    if (!this.doubles) return;
    const out = (Math.sign(p.x) || rightX(p.side)) * 1.05;
    p.tx = out; p.tz = p.s * (BASE_Z + 0.25);
    for (const q of this.seats) if (q !== p && q.side === p.side) { q.tx = -out * 0.2; q.tz = q.s * BASE_Z; }
  }

  stepBall() {
    const ev = stepBall(this.ball);
    if (!ev) return;
    const rules = this.rules;
    if (ev.type === "bounce") {
      this.emit({ type: "bounce", x: ev.x, z: ev.z });
      const over = rules.bounce(ev.x, ev.z);
      if (over) return this.endRally(over);
      if (sideOfZ(ev.z) !== sideOf(rules.lastHitter)) this.makePlan();
    } else if (ev.type === "net") {
      this.emit({ type: "net", cord: ev.cord });
      const r = rules.net(ev.cord);
      if (r === "let") return this.letServe();
      if (r && r.loser) this.endRally(r);
    } else if (ev.type === "floor") {
      this.emit({ type: "floor", x: ev.x, z: ev.z });
      const over = rules.floor();
      if (over) this.endRally(over);
    }
  }

  letServe() {
    this.emit({ type: "let" });
    this.phase = "point"; this.phaseT = 0; this.letPending = true;
  }

  endRally(over) {
    if (this.phase === "point" || this.phase === "over") return;
    this.plan = null; this.frozen = false;
    const r = this.rules.award();
    this.phase = r.gameOver ? "over" : "point"; this.phaseT = 0; this.letPending = false;
    this.emit({
      type: "point", winner: r.winner, loser: over.loser, reason: r.reason, score: { ...this.rules.score },
      gameOver: r.gameOver, rally: this.rules.shots
    });
    if (r.gameOver) this.emit({ type: "game", winner: r.winner, score: { ...this.rules.score } });
  }

  // ---- time ------------------------------------------------------------------------------
  update(dt) {
    this.acc += dt;
    let guard = 0;
    while (this.acc >= DT && guard++ < 60) { this.acc -= DT; this.step(); }
  }

  step() {
    this.t += DT; this.phaseT += DT;
    this.movePlayers();
    if (this.phase === "serve") {
      const sv = this.server();
      const h = this.hand(sv);
      Object.assign(this.ball, { x: h.x, y: h.y, z: h.z });
      if (!sv.human && this.phaseT >= this.aiServeAt) this.doServe(sv, aiServe(sv.lv, this.rng), aiQuality(sv.lv, this.rng));
    } else if (this.phase === "rally") {
      this.rallyT += DT;
      const pl = this.plan;
      if (pl && !pl.done) {
        if (this.t >= pl.tc) {
          const p = this.bySeat[pl.seat];
          if (!p.human) this.resolve(pl);
          else if (pl.swing) this.resolve(pl);
          // A human's swing may arrive after contact (frame timing, network): the ball flies on,
          // and a swing inside the late window is applied as if at contact (resolve() catches up).
          else if (this.t >= pl.tc + TIMING.ok + this.grace) this.resolve(pl);
        }
      }
      if (this.phase === "rally" && !this.frozen) this.stepBall();
      if (this.rallyT > 45 && this.phase === "rally") this.endRally(this.rules.end(this.rules.serverSide, "timeout"));
    } else if (this.phase === "point") {
      if (this.phaseT >= (this.letPending ? 1.0 : this.pointDelay)) { this.beginServe(); }
    }
  }

  movePlayers() {
    for (const p of this.seats) {
      const dx = p.tx - p.x, dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);
      const step = p.speed * DT;
      if (d <= step) { p.x = p.tx; p.z = p.tz; p.vx = p.vz = 0; }
      else { p.x += dx / d * step; p.z += dz / d * step; p.vx = dx / d * p.speed; p.vz = dz / d * p.speed; }
    }
  }

  // Compact state for the network and the view.
  snapshot() {
    const b = this.ball;
    return {
      t: this.t, ph: this.phase,
      b: [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.t, b.s].map((n) => Math.round(n * 1000) / 1000),
      p: this.seats.map((s) => [Math.round(s.x * 100) / 100, Math.round(s.z * 100) / 100]),
      sc: [this.rules.score.p, this.rules.score.c], sv: this.rules.server, rc: this.rules.receiver
    };
  }
}

export { LEVELS, other };
