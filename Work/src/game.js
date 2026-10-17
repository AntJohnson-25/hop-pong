// The session: who plays, the match, the tournament, and the network. No DOM, no three.js, so
// tools/net-test.js runs it in Node against a fake relay.
//
// The lobby host is the referee: it runs the Match (src/sim/match.js) and sends snapshots at
// 20 Hz with the events since the last one. Everyone else sends swings (with a sim-time stamp)
// and draws what the host says; the ball is run forward locally between snapshots.
// Net adapter: { me, hostId, isHost(), players(), now(), send(data, to), standalone }
import { Match } from "./sim/match.js";
import { LEVELS } from "./sim/ai.js";
import { stepBall, DT, copyBall } from "./sim/physics.js";
import * as T from "./sim/tournament.js";

export const CPU_NAMES = ["Auntie Dee", "Big Ray", "Tasha", "Marcus", "Unc Lou", "Keisha", "Mei", "Diego"];
const KINDS = ["drive", "push", "lob", "serve", "block", "smash"];
const SEND_EVERY = 0.05;
const num = (v, lim) => typeof v === "number" && isFinite(v) && Math.abs(v) <= (lim || 1e6);
const r3 = (n) => Math.round(n * 1000) / 1000;
const SEAT_ORDER = ["p0", "c0", "p1", "c1"];

function cleanIntent(i) {
  if (!i || typeof i !== "object") return null;
  const o = { kind: KINDS.includes(i.kind) ? i.kind : "drive" };
  o.aim = num(i.aim, 2) ? Math.max(-1, Math.min(1, i.aim)) : 0;
  o.depth = num(i.depth, 2) ? Math.max(0, Math.min(1, i.depth)) : 0.6;
  o.pace = num(i.pace, 2) ? Math.max(0, Math.min(1, i.pace)) : 0.5;
  o.curve = num(i.curve, 2) ? Math.max(-1, Math.min(1, i.curve)) : 0;
  return o;
}

export class Session {
  // opts: { mode: "singles"|"doubles"|"tournament", target, ai }, cb: { onEvent(ev), onSetup(setup), onUi(ui) }
  constructor(net, opts, cb) {
    this.net = net; this.opts = Object.assign({ mode: "singles", target: 11, ai: "medium" }, opts);
    this.cb = cb || {};
    this.setup = null; this.match = null; this.tour = null;
    this.ui = { ph: "wait" };                  // wait | play | result | bracket | done
    this.snap = null; this.snapAt = 0;
    this.plan = null; this.sendT = 0; this.evBuf = [];
    this.queue = []; this.matchNo = 0; this.lastSc = [0, 0];
    this.pos = {}; this.t = 0;
    this.uiTimer = 0;
    this.names = {};
    this.left = false;
  }

  // ---- identity -------------------------------------------------------------------------
  get isHost() { return this.net.isHost(); }
  mySeat() { return this.setup ? (this.setup.seats.find((s) => s.id && s.id === this.net.me) || {}).seat || null : null; }
  seatInfo(seat) { return this.setup ? this.setup.seats.find((s) => s.seat === seat) : null; }
  humanIds() { return this.net.players().map((p) => p.id); }
  nameOf(id) { const p = this.net.players().find((x) => x.id === id); return p ? p.name : (this.names[id] || "Player"); }

  // ---- host: building a table ------------------------------------------------------------
  syncQueue() {
    const ids = this.humanIds();
    this.queue = this.queue.filter((id) => ids.includes(id));
    ids.forEach((id) => { if (!this.queue.includes(id)) this.queue.push(id); });
  }

  // Build the setup for the next game from the queue. pair: [entrantA, entrantB] in tournaments.
  makeSetup(pair) {
    this.syncQueue();
    const mode = this.opts.mode;
    const no = ++this.matchNo;
    let seats = [];
    const ai = this.opts.ai === "rising" ? "medium" : this.opts.ai;
    if (mode === "tournament" && pair) {
      const lvl = T.levelFor(this.tour, this.tour.round);
      pair.forEach((e, i) => {
        const seat = i === 0 ? "p0" : "c0";
        seats.push({ seat, id: e.human ? e.id : null, human: !!e.human, name: e.name, level: lvl, look: Math.max(0, CPU_NAMES.indexOf(e.name)) });
      });
    } else {
      const order = mode === "doubles" ? SEAT_ORDER : ["p0", "c0"];
      order.forEach((seat, i) => {
        const id = this.queue[i] || null;
        seats.push({ seat, id, human: !!id, name: id ? this.nameOf(id) : null, level: ai, look: 0 });
      });
      // Computer players: distinct looks, names from the cast.
      let k = (no * 3) % CPU_NAMES.length;
      seats.forEach((s) => { if (!s.human) { s.look = k; s.name = CPU_NAMES[k]; k = (k + 1) % CPU_NAMES.length; } });
    }
    return { id: no, mode: mode === "doubles" ? "doubles" : "singles", doubles: mode === "doubles", target: this.opts.target, seats, tour: mode === "tournament" ? { round: this.tour.round } : null };
  }

  startMatch(setup) {
    this.setup = setup; this.plan = null; this.lastSc = [0, 0];
    this.match = new Match({
      doubles: setup.doubles, seats: setup.seats.map((s) => ({ seat: s.seat, human: s.human, id: s.id, name: s.name, level: s.level, look: s.look })),
      level: this.opts.ai === "rising" ? "medium" : this.opts.ai, target: setup.target, grace: this.net.standalone || this.soloHuman() ? 0 : 0.14,
      seed: (Date.now() ^ (setup.id * 7919)) & 0x7fffffff, first: Math.random() < 0.5 ? "p" : "c"
    });
    this.ui = { ph: "play" }; this.uiTimer = 0;
    this.pos = {};
    this.cb.onSetup && this.cb.onSetup(setup);
    this.cb.onUi && this.cb.onUi(this.ui);
    this.broadcastFull();
  }

  soloHuman() { return this.setup && this.setup.seats.filter((s) => s.human).length <= 1 && this.net.players().length <= 1; }

  // Host: a new session (mode from options).
  begin() {
    if (!this.isHost) return;
    this.syncQueue();
    if (this.opts.mode === "tournament") {
      const humans = this.queue.slice(0, T.SIZE).map((id) => ({ id, name: this.nameOf(id) }));
      const fill = CPU_NAMES.map((n, i) => ({ id: "cpu" + i, name: n }));
      this.tour = T.newTournament(humans, fill, this.opts.ai, (Date.now() & 0x7fffffff));
      T.settle(this.tour);
      this.nextTourMatch();
    } else {
      this.tour = null;
      this.startMatch(this.makeSetup());
    }
  }

  nextTourMatch() {
    const live = T.liveMatches(this.tour);
    if (!live.length) {
      if (!this.tour.champion) T.playOut(this.tour);
      this.finishTour();
      return;
    }
    this.startMatch(this.makeSetup([live[0].a, live[0].b]));
  }

  finishTour() {
    this.setUi({ ph: "done", tour: this.tour });
  }

  setUi(ui) {
    this.ui = ui; this.uiTimer = 0;
    this.cb.onUi && this.cb.onUi(ui);
    if (this.isHost) this.net.send({ k: "ui", ui }, undefined);
  }

  // ---- host: events from the match --------------------------------------------------------
  handleEvents(evs) {
    for (const e of evs) {
      this.onEvent(e);
      if (e.type === "game") this.matchOver(e);
    }
  }

  matchOver(e) {
    const m = this.match, s = this.setup;
    const sc = [e.score.p, e.score.c];
    const winSide = e.winner;
    const names = (side) => s.seats.filter((x) => x.seat[0] === side).map((x) => x.name);
    const res = { winner: winSide, sc, w: names(winSide), l: names(winSide === "p" ? "c" : "p"), seats: s.seats.map((x) => ({ seat: x.seat, id: x.id, name: x.name })) };
    if (this.opts.mode === "tournament" && this.tour) {
      const a = s.seats.find((x) => x.seat === "p0"), b = s.seats.find((x) => x.seat === "c0");
      const live = T.liveMatches(this.tour).find((l) => (l.a.name === a.name) && (l.b.name === b.name));
      if (live) T.record(this.tour, live.round, live.slot, sc[0], sc[1]);
      this.setUi({ ph: "bracket", tour: this.tour, res });
      this.uiTimer = 0;
    } else {
      this.setUi({ ph: "result", res });
    }
  }

  // Host: from the result card / bracket to the next game.
  advance() {
    if (!this.isHost) { this.net.send({ k: "adv" }, this.net.hostId); return; }
    const ph = this.ui.ph;
    if (ph === "bracket") this.nextTourMatch();
    else if (ph === "result") {
      // Winners stay, losers go to the back of the queue.
      const res = this.ui.res;
      if (res && this.queue.length > (this.opts.mode === "doubles" ? 4 : 2)) {
        const lose = res.winner === "p" ? "c" : "p";
        const losers = res.seats.filter((x) => x.seat[0] === lose && x.id).map((x) => x.id);
        this.queue = this.queue.filter((id) => !losers.includes(id)).concat(losers);
      }
      this.startMatch(this.makeSetup());
    } else if (ph === "done") this.begin();
  }

  // ---- host: tick -------------------------------------------------------------------------
  update(dt) {
    this.t += dt;
    if (!this.isHost) { this.clientTick(dt); return; }
    if (!this.match && this.ui.ph === "wait") { if (this.net.players().length) this.begin(); return; }
    if (this.match && this.ui.ph === "play") {
      this.match.update(dt);
      const evs = this.match.drain();
      this.handleEvents(evs);
      evs.forEach((e) => this.evBuf.push(this.packEvent(e)));
      this.sendT += dt;
      if (this.sendT >= SEND_EVERY) { this.sendT = 0; this.sendSnapshot(); }
      this.noteLeavers();
    } else if (this.ui.ph === "bracket") {
      this.uiTimer += dt;
      if (this.uiTimer > 9) this.advance();
    }
  }

  // A seat whose human left the lobby becomes a computer player.
  noteLeavers() {
    const ids = this.humanIds();
    for (const s of this.setup.seats) {
      if (s.human && !ids.includes(s.id)) {
        s.human = false; s.id = null;
        this.match.convertToAI(s.seat, s.level || "medium");
        if (this.tour) { const e = this.tour.draw.find((d) => d.name === s.name); if (e) e.human = false; }
        this.broadcastFull();
      }
    }
    // A joiner takes over a computer seat (not in a tournament).
    if (this.opts.mode !== "tournament") {
      this.syncQueue();
      const seated = this.setup.seats.filter((s) => s.human).map((s) => s.id);
      const waiting = this.queue.filter((id) => !seated.includes(id));
      if (waiting.length) {
        const free = this.setup.seats.find((s) => !s.human);
        if (free) {
          const id = waiting[0]; free.human = true; free.id = id; free.name = this.nameOf(id);
          this.match.convertToHuman(free.seat, id, free.name);
          this.broadcastFull();
        }
      }
    }
  }

  packEvent(e) {
    const o = { type: e.type, t: r3(e.t) };
    for (const k of ["seat", "server", "receiver", "kind", "reason", "winner", "loser", "gameOver", "cord", "reachable", "call"]) if (e[k] !== undefined) o[k] = e[k];
    for (const k of ["x", "y", "z", "q", "d", "tc", "cx", "cy", "cz", "rally"]) if (e[k] !== undefined) o[k] = r3(e[k]);
    if (e.v) o.v = [r3(e.v.x), r3(e.v.y), r3(e.v.z)];
    if (e.score) o.score = [e.score.p, e.score.c];
    return o;
  }

  sendSnapshot(to) {
    const m = this.match; if (!m) return;
    const b = m.ball;
    const msg = {
      k: "st", id: this.setup.id, hn: this.net.now(), t: r3(m.t + m.acc), ph: m.phase, fz: m.frozen ? 1 : 0,
      b: [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.t, b.s].map(r3),
      p: m.seats.map((s) => [r3(s.x), r3(s.z), r3(s.vx || 0), r3(s.vz || 0)]),
      sc: [m.rules.score.p, m.rules.score.c], sv: m.rules.server, rc: m.rules.receiver,
      ev: this.evBuf
    };
    this.evBuf = [];
    this.net.send(msg, to);
  }

  broadcastFull(to) {
    if (!this.isHost || !this.setup) return;
    this.net.send({ k: "setup", setup: this.setup, ui: this.ui, tour: this.tour, opts: this.opts, sc: this.match ? [this.match.rules.score.p, this.match.rules.score.c] : this.lastSc }, to);
  }

  // ---- messages ---------------------------------------------------------------------------
  onMessage(d, from) {
    if (!d || typeof d !== "object") return;
    if (this.isHost) {
      if (d.k === "hi") this.broadcastFull(from);
      else if (d.k === "sw") this.hostSwing(d, from);
      else if (d.k === "adv") { if (this.ui.ph === "result" || this.ui.ph === "bracket" || this.ui.ph === "done") this.advance(); }
      return;
    }
    if (from !== this.net.hostId) return;
    if (d.k === "setup") this.applySetup(d);
    else if (d.k === "ui") { this.ui = d.ui || this.ui; this.cb.onUi && this.cb.onUi(this.ui); }
    else if (d.k === "st") this.applySnapshot(d);
  }

  hostSwing(d, from) {
    const m = this.match; if (!m || !this.setup) return;
    if (d.id !== this.setup.id) return;
    const s = this.setup.seats.find((x) => x.seat === d.seat);
    if (!s || !s.human || s.id !== from) return;
    const intent = cleanIntent(d.i);
    if (!intent || !num(d.ts, 1e6)) return;
    const now = m.t + m.acc;
    if (Math.abs(d.ts - now) > 1.0) return;
    m.swing(d.seat, intent, d.ts);
  }

  // ---- client side ------------------------------------------------------------------------
  hello() { if (!this.isHost) this.net.send({ k: "hi" }, this.net.hostId); }

  applySetup(d) {
    if (!d.setup) return;
    if (d.opts) this.opts = Object.assign(this.opts, d.opts);
    const fresh = !this.setup || this.setup.id !== d.setup.id;
    this.setup = d.setup; this.tour = d.tour || null;
    if (d.ui) this.ui = d.ui;
    if (d.sc) this.lastSc = d.sc;
    if (fresh) { this.snap = null; this.plan = null; this.pos = {}; }
    this.cb.onSetup && this.cb.onSetup(this.setup, fresh);
    this.cb.onUi && this.cb.onUi(this.ui);
  }

  applySnapshot(d) {
    if (!this.setup || d.id !== this.setup.id) { this.hello(); return; }
    this.snap = d; this.snapAt = this.t;
    this.lastSc = d.sc;
    if (Array.isArray(d.ev)) for (const e of d.ev) this.onEvent(e);
  }

  clientTick(dt) {
    if (!this.setup && this.t - (this.helloT || -9) > 1.5) { this.helloT = this.t; this.hello(); }
  }

  // ---- shared: events ---------------------------------------------------------------------
  onEvent(e) {
    if (e.type === "plan") this.plan = { seat: e.seat, tc: e.tc, cx: e.cx, cy: e.cy, cz: e.cz, reachable: e.reachable };
    else if (e.type === "hit" || e.type === "whiff" || e.type === "point" || e.type === "ready" || e.type === "serve" || e.type === "let") this.plan = null;
    this.cb.onEvent && this.cb.onEvent(e);
  }

  // ---- local input ------------------------------------------------------------------------
  // Sim time "now" as the host sees it.
  simNow() {
    if (this.isHost) return this.match ? this.match.t + this.match.acc : 0;
    if (!this.snap) return 0;
    return this.snap.t + Math.max(0, Math.min(0.3, (this.net.now() - this.snap.hn) / 1000));
  }

  swing(intent) {
    const seat = this.mySeat();
    if (!seat || !this.setup || this.ui.ph !== "play") return false;
    const ts = this.simNow();
    if (this.isHost) return this.match ? this.match.swing(seat, cleanIntent(intent), ts) : false;
    this.net.send({ k: "sw", id: this.setup.id, seat, i: intent, ts: r3(ts) }, this.net.hostId);
    return true;
  }

  // ---- what to draw -----------------------------------------------------------------------
  // dt: frame seconds. Returns { t, ph, ball, seats:[{seat,x,z,vx,vz}], sc, sv, rc, fz } or null.
  view(dt) {
    if (!this.setup) return null;
    if (this.isHost && this.match) {
      const m = this.match, b = m.ball;
      return { t: m.t + m.acc, ph: m.phase, ball: b, fz: m.frozen, sc: [m.rules.score.p, m.rules.score.c], sv: m.rules.server, rc: m.rules.receiver,
        seats: m.seats.map((s) => ({ seat: s.seat, x: s.x, z: s.z, vx: s.vx || 0, vz: s.vz || 0 })) };
    }
    const sn = this.snap;
    if (!sn) return { t: 0, ph: "serve", ball: { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, t: 0, s: 0 }, fz: false, sc: this.lastSc || [0, 0], sv: "p0", rc: "c0",
      seats: this.setup.seats.map((s) => ({ seat: s.seat, x: 0, z: (s.seat[0] === "p" ? 2.15 : -2.15), vx: 0, vz: 0 })) };
    const el = Math.max(0, Math.min(0.3, (this.net.now() - sn.hn) / 1000));
    // Ball: the host's, run forward by the time since the snapshot (no events).
    const ball = { x: sn.b[0], y: sn.b[1], z: sn.b[2], vx: sn.b[3], vy: sn.b[4], vz: sn.b[5], t: sn.b[6], s: sn.b[7] };
    if (!sn.fz && sn.ph === "rally") { const n = Math.round(el / DT); for (let i = 0; i < n; i++) stepBall(ball); }
    const seats = this.setup.seats.map((s, i) => {
      const tgt = sn.p[i] || [0, 0, 0, 0];
      let p = this.pos[s.seat];
      if (!p) p = this.pos[s.seat] = { x: tgt[0], z: tgt[1] };
      const k = Math.min(1, dt * 16);
      const ox = p.x, oz = p.z;
      p.x += (tgt[0] + tgt[2] * el - p.x) * k; p.z += (tgt[1] + tgt[3] * el - p.z) * k;
      return { seat: s.seat, x: p.x, z: p.z, vx: dt > 0 ? (p.x - ox) / dt : 0, vz: dt > 0 ? (p.z - oz) / dt : 0 };
    });
    return { t: sn.t + el, ph: sn.ph, ball, fz: !!sn.fz, sc: sn.sc, sv: sn.sv, rc: sn.rc, seats };
  }

  // ---- host change / reloads --------------------------------------------------------------
  // The old host left: carry on from the last state we saw.
  becameHost() {
    if (!this.isHost) return;
    if (this.setup && this.ui.ph === "play") {
      const setup = this.setup;
      this.match = new Match({ doubles: setup.doubles, seats: setup.seats.map((s) => ({ seat: s.seat, human: s.human, id: s.id, name: s.name, level: s.level, look: s.look })),
        level: this.opts.ai === "rising" ? "medium" : this.opts.ai, target: setup.target, grace: 0.14, seed: Date.now() & 0x7fffffff });
      this.match.restore(this.lastSc[0], this.lastSc[1]);
      this.plan = null;
      this.syncQueue();
      this.noteLeavers();
      this.broadcastFull();
    } else if (!this.setup) this.begin();
    else this.broadcastFull();
  }

  // What a late joiner / reloader needs.
  stateFor() { return this.setup ? { setup: this.setup, ui: this.ui, tour: this.tour, opts: this.opts, sc: this.lastSc } : undefined; }
  restore(d) { if (d && d.setup) this.applySetup(d); }
}

export { LEVELS, copyBall };
