// The session: the hall of tables, who plays where, the matches, the tournament, and the network.
// No DOM, no three.js, so tools/net-test.js runs it in Node against a fake relay.
//
// The hall has MAX_TABLES tables, enough for a full HopLobby lobby (16): eight singles or four
// doubles at once. The lobby host is the referee: it runs a Match (src/sim/match.js) on every
// table in use and sends one snapshot for all of them at 20 Hz, with each table's events since
// the last one. Everyone else sends swings (with a sim-time stamp) and draws what the host says;
// the balls are run forward locally between snapshots.
//
// "Your table" is the one you sit at; a player with no seat watches one (focus()). The getters
// setup / ui / plan / match and view() / simNow() are for that table.
// Net adapter: { me, hostId, isHost(), players(), now(), send(data, to), standalone }
import { Match } from "./sim/match.js";
import { LEVELS } from "./sim/ai.js";
import { stepBall, DT, copyBall } from "./sim/physics.js";
import * as T from "./sim/tournament.js";

export const CPU_NAMES = ["Auntie Dee", "Big Ray", "Tasha", "Marcus", "Unc Lou", "Keisha", "Mei", "Diego",
  "Nana Jo", "Tre", "Priya", "Coach K", "Rosa", "Dante", "Lil Mo", "Ingrid"];
export const MAX_TABLES = 8;
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

// One table: its game (setup + the host's Match) and what a client last heard about it.
class Table {
  constructor(n) { this.n = n; this.clear(); }
  clear() {
    this.setup = null; this.match = null; this.ui = { ph: "idle" };   // idle | play | result | bracket | done
    this.snap = null; this.plan = null; this.evBuf = []; this.pos = {}; this.lastSc = [0, 0];
  }
  humans() { return this.setup ? this.setup.seats.filter((s) => s.human && s.id) : []; }
  has(id) { return !!this.setup && this.ui.ph !== "idle" && this.setup.seats.some((s) => s.id && s.id === id); }
}

export class Session {
  // opts: { mode: "singles"|"doubles"|"tournament", target, ai }
  // cb: { onEvent(ev, n), onSetup(setup | null, fresh, n), onUi(ui, n) }  (n = table number)
  constructor(net, opts, cb) {
    this.net = net; this.opts = Object.assign({ mode: "singles", target: 11, ai: "medium" }, opts);
    this.cb = cb || {};
    this.tables = [];
    for (let i = 0; i < MAX_TABLES; i++) this.tables.push(new Table(i));
    this.tour = null; this.tourT = 0;
    this.queue = []; this.matchNo = 0;
    this.sendT = 0; this.t = 0; this.helloT = -9;
    this.names = {};
    this.begun = false;
    this.watch = 0;
  }

  // ---- identity -------------------------------------------------------------------------
  get isHost() { return this.net.isHost(); }
  humanIds() { return this.net.players().map((p) => p.id); }
  nameOf(id) { const p = this.net.players().find((x) => x.id === id); return p ? p.name : (this.names[id] || "Player"); }
  myTable() { return this.tables.find((tb) => tb.has(this.net.me)) || null; }
  // The table you sit at, else the one you were watching, else a live one.
  focus() {
    const mine = this.myTable();
    if (mine) { this.watch = mine.n; return mine; }
    const w = this.tables[this.watch];
    if (w && w.ui.ph !== "idle") return w;
    const live = this.tables.find((tb) => tb.ui.ph === "play");
    if (live) { this.watch = live.n; return live; }
    return w || this.tables[0];
  }
  get setup() { return this.focus().setup; }
  get ui() { return this.focus().ui; }
  get plan() { return this.focus().plan; }
  get match() { return this.focus().match; }
  mySeat() { const tb = this.myTable(); return tb ? tb.setup.seats.find((s) => s.id === this.net.me).seat : null; }
  active() { return this.tables.filter((tb) => tb.setup && tb.ui.ph !== "idle"); }
  playing() { return this.tables.filter((tb) => tb.ui.ph === "play").length; }

  // ---- host: building tables -------------------------------------------------------------
  syncQueue() {
    const ids = this.humanIds();
    this.queue = this.queue.filter((id) => ids.includes(id));
    ids.forEach((id) => { if (!this.queue.includes(id)) this.queue.push(id); });
  }

  // Computer names in use at other tables (so the hall has no twins).
  usedNames(except) {
    const s = new Set();
    this.tables.forEach((tb) => { if (tb !== except && tb.setup) tb.setup.seats.forEach((x) => { if (!x.human) s.add(x.name); }); });
    return s;
  }

  // The setup for a game at table tb. ids: humans in seat order (p0, c0, p1, c1); pair: [entrantA,
  // entrantB] in tournaments.
  makeSetup(tb, ids, pair) {
    const mode = this.opts.mode;
    const no = ++this.matchNo;
    const seats = [];
    const ai = this.opts.ai === "rising" ? "medium" : this.opts.ai;
    if (pair) {
      const lvl = T.levelFor(this.tour, this.tour.round);
      pair.forEach((e, i) => {
        const seat = i === 0 ? "p0" : "c0";
        seats.push({ seat, id: e.human ? e.id : null, human: !!e.human, name: e.name, level: lvl, look: Math.max(0, CPU_NAMES.indexOf(e.name)) });
      });
    } else {
      const order = mode === "doubles" ? SEAT_ORDER : ["p0", "c0"];
      order.forEach((seat, i) => {
        const id = (ids && ids[i]) || null;
        seats.push({ seat, id, human: !!id, name: id ? this.nameOf(id) : null, level: ai, look: 0 });
      });
      // Computer players: distinct looks, names from the cast that no other table is using.
      const used = this.usedNames(tb);
      let k = (no * 3 + tb.n * 5) % CPU_NAMES.length;
      seats.forEach((s) => {
        if (s.human) return;
        for (let g = 0; g < CPU_NAMES.length && used.has(CPU_NAMES[k]); g++) k = (k + 1) % CPU_NAMES.length;
        s.look = k; s.name = CPU_NAMES[k]; used.add(s.name); k = (k + 1) % CPU_NAMES.length;
      });
    }
    return {
      id: no, n: tb.n, mode: mode === "doubles" ? "doubles" : "singles", doubles: mode === "doubles", target: pair ? T.roundsOf(this.tour)[this.tour.round].target : this.opts.target, seats,
      tour: pair ? { round: this.tour.round, slot: pair.slot } : null
    };
  }

  newMatch(setup, grace, seed) {
    return new Match({
      doubles: setup.doubles, seats: setup.seats.map((s) => ({ seat: s.seat, human: s.human, id: s.id, name: s.name, level: s.level, look: s.look })),
      level: this.opts.ai === "rising" ? "medium" : this.opts.ai, target: setup.target, grace,
      seed, first: Math.random() < 0.5 ? "p" : "c"
    });
  }

  // Host: a game at table tb. The caller broadcasts.
  startMatch(tb, setup) {
    tb.clear();
    tb.setup = setup;
    const solo = this.net.standalone || (setup.seats.filter((s) => s.human).length <= 1 && this.net.players().length <= 1);
    tb.match = this.newMatch(setup, solo ? 0 : 0.14, (Date.now() ^ (setup.id * 7919)) & 0x7fffffff);
    tb.ui = { ph: "play" };
    this.cb.onSetup && this.cb.onSetup(setup, true, tb.n);
    this.cb.onUi && this.cb.onUi(tb.ui, tb.n);
  }

  clearTable(tb) {
    if (!tb.setup && tb.ui.ph === "idle") return;
    tb.clear();
    this.cb.onSetup && this.cb.onSetup(null, true, tb.n);
    this.cb.onUi && this.cb.onUi(tb.ui, tb.n);
  }

  // Host: a new session (mode from options). Everyone gets a table: two to a table in singles,
  // four in doubles, the computer filling the empty seats.
  begin() {
    if (!this.isHost) return;
    this.begun = true;
    this.syncQueue();
    this.tables.forEach((tb) => this.clearTable(tb));
    if (this.opts.mode === "tournament") {
      const humans = this.queue.slice(0, T.MAX_SIZE).map((id) => ({ id, name: this.nameOf(id) }));
      const fill = CPU_NAMES.map((n, i) => ({ id: "cpu" + i, name: n }));
      this.tour = T.newTournament(humans, fill, this.opts.ai, (Date.now() & 0x7fffffff));
      T.settle(this.tour);
      this.startRound();
      return;
    }
    this.tour = null;
    const per = this.opts.mode === "doubles" ? 4 : 2;
    const ids = this.queue.slice();
    const n = Math.max(1, Math.min(MAX_TABLES, Math.ceil(ids.length / per)));
    for (let i = 0; i < n; i++) { const tb = this.tables[i]; this.startMatch(tb, this.makeSetup(tb, ids.slice(i * per, i * per + per))); }
    this.broadcastFull();
  }

  // Tournament: every live match of the round, one table each, all at once.
  startRound() {
    const live = T.liveMatches(this.tour);
    if (!live.length) {
      if (!this.tour.champion) T.playOut(this.tour);
      this.finishTour();
      return;
    }
    this.tables.forEach((tb) => this.clearTable(tb));
    live.slice(0, MAX_TABLES).forEach((m, i) => {
      const pair = [m.a, m.b]; pair.slot = m.slot;
      this.startMatch(this.tables[i], this.makeSetup(this.tables[i], null, pair));
    });
    this.tourT = 0;
    this.broadcastFull();
  }

  finishTour() {
    const tbs = this.tables.filter((tb) => tb.setup);
    tbs.forEach((tb) => { tb.match = null; tb.ui = { ph: "done" }; this.cb.onUi && this.cb.onUi(tb.ui, tb.n); });
    this.broadcastFull();
  }

  setUi(tb, ui) {
    tb.ui = ui;
    this.cb.onUi && this.cb.onUi(ui, tb.n);
    if (this.isHost) this.net.send({ k: "ui", n: tb.n, ui, tour: this.tour || undefined }, undefined);
  }

  // ---- host: events from the matches ------------------------------------------------------
  handleEvents(tb, evs) {
    for (const e of evs) {
      this.onEvent(tb, e);
      if (e.type === "game") this.matchOver(tb, e);
    }
  }

  matchOver(tb, e) {
    const s = tb.setup;
    const sc = [e.score.p, e.score.c];
    const winSide = e.winner;
    const names = (side) => s.seats.filter((x) => x.seat[0] === side).map((x) => x.name);
    const res = { winner: winSide, sc, w: names(winSide), l: names(winSide === "p" ? "c" : "p"), seats: s.seats.map((x) => ({ seat: x.seat, id: x.id, name: x.name })) };
    tb.lastSc = sc;
    if (this.tour && s.tour) {
      T.record(this.tour, s.tour.round, s.tour.slot, sc[0], sc[1]);
      this.tourT = 0;
      this.setUi(tb, { ph: "bracket", res });
      // Everyone waiting in the bracket sees the new result.
      this.tables.forEach((x) => { if (x !== tb && x.ui.ph === "bracket") this.setUi(x, x.ui); });
    } else {
      this.setUi(tb, { ph: "result", res });
    }
  }

  // From the result card / bracket to the next game. n: the table (your own by default).
  advance(n) {
    if (!this.isHost) { this.net.send({ k: "adv", n: this.focus().n }, this.net.hostId); return; }
    const tb = n == null ? this.focus() : this.tables[n];
    if (!tb) return;
    const ph = tb.ui.ph;
    if (ph === "bracket") { if (!this.playing()) this.startRound(); }
    else if (ph === "result") {
      // A rematch at the same table, with anyone waiting for a seat.
      this.syncQueue();
      const order = tb.setup.doubles ? SEAT_ORDER : ["p0", "c0"];
      const ids = order.map((seat) => { const s = tb.setup.seats.find((x) => x.seat === seat); return s && s.human && this.queue.includes(s.id) ? s.id : null; }).filter(Boolean);
      const per = order.length;
      for (const id of this.waiting()) if (ids.length < per) ids.push(id);
      if (!ids.length) { this.clearTable(tb); this.broadcastFull(); return; }
      this.startMatch(tb, this.makeSetup(tb, ids));
      this.broadcastFull();
    } else if (ph === "done") this.begin();
  }

  // Lobby players with no seat at any table.
  waiting() {
    this.syncQueue();
    const seated = new Set();
    this.tables.forEach((tb) => tb.humans().forEach((s) => { if (tb.ui.ph !== "idle") seated.add(s.id); }));
    return this.queue.filter((id) => !seated.has(id));
  }

  // ---- host: tick -------------------------------------------------------------------------
  update(dt) {
    this.t += dt;
    if (!this.isHost) { this.clientTick(dt); return; }
    if (!this.begun) { if (this.net.players().length) this.begin(); return; }
    for (const tb of this.tables) {
      if (!tb.match || tb.ui.ph !== "play") continue;
      tb.match.update(dt);
      const evs = tb.match.drain();
      evs.forEach((e) => tb.evBuf.push(this.packEvent(e)));
      this.handleEvents(tb, evs);
    }
    this.sendT += dt;
    if (this.sendT >= SEND_EVERY) { this.sendT = 0; this.sendSnapshot(); }
    this.noteLeavers();
    // The bracket moves on by itself a while after the round's last match.
    if (this.tour && !this.tour.champion && !this.playing() && this.tables.some((tb) => tb.ui.ph === "bracket")) {
      this.tourT += dt;
      if (this.tourT > 9) this.startRound();
    }
  }

  // A seat whose human left the lobby becomes a computer player; a joiner takes a computer seat
  // (next to or across from another human if there is one) or opens a new table.
  noteLeavers() {
    const ids = this.humanIds();
    for (const tb of this.tables) {
      if (!tb.setup) continue;
      let changed = false;
      for (const s of tb.setup.seats) {
        if (s.human && !ids.includes(s.id)) {
          s.human = false; s.id = null;
          if (tb.match && tb.ui.ph === "play") tb.match.convertToAI(s.seat, s.level || "medium");
          if (this.tour) { const e = this.tour.draw.find((d) => d.name === s.name); if (e) e.human = false; }
          changed = true;
        }
      }
      // Nobody left at a casual table: close it.
      if (changed && !this.tour && !tb.humans().length) { this.clearTable(tb); this.broadcastFull(); continue; }
      if (changed) { this.cb.onSetup && this.cb.onSetup(tb.setup, false, tb.n); this.broadcastFull(); }
    }
    if (this.opts.mode === "tournament") return;
    for (const id of this.waiting()) {
      let best = null;
      for (const tb of this.tables) {
        if (!tb.setup || (tb.ui.ph !== "play" && tb.ui.ph !== "result")) continue;
        const order = tb.setup.doubles ? SEAT_ORDER : ["p0", "c0"];
        const free = order.map((seat) => tb.setup.seats.find((x) => x.seat === seat)).find((x) => x && !x.human);
        if (!free) continue;
        const h = tb.humans().length;
        if (!best || h > best.h) best = { tb, free, h };
      }
      if (best) {
        const { tb, free } = best;
        free.human = true; free.id = id; free.name = this.nameOf(id);
        if (tb.match && tb.ui.ph === "play") tb.match.convertToHuman(free.seat, id, free.name);
        this.cb.onSetup && this.cb.onSetup(tb.setup, false, tb.n);
      } else {
        const tb = this.tables.find((x) => x.ui.ph === "idle");
        if (!tb) break;                 // every table full: they watch
        this.startMatch(tb, this.makeSetup(tb, [id]));
      }
      this.broadcastFull();
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

  // One message for every table in play (and any table with events still to tell).
  sendSnapshot(to) {
    const tbs = [];
    for (const tb of this.tables) {
      const m = tb.match;
      if (!m || !tb.setup || (tb.ui.ph !== "play" && !tb.evBuf.length)) continue;
      const b = m.ball;
      tbs.push({
        n: tb.n, id: tb.setup.id, t: r3(m.t + m.acc), ph: m.phase, fz: m.frozen ? 1 : 0,
        b: [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.t, b.s].map(r3),
        p: m.seats.map((s) => [r3(s.x), r3(s.z), r3(s.vx || 0), r3(s.vz || 0)]),
        sc: [m.rules.score.p, m.rules.score.c], sv: m.rules.server, rc: m.rules.receiver,
        ev: tb.evBuf
      });
      tb.evBuf = [];
    }
    if (tbs.length) this.net.send({ k: "st", hn: this.net.now(), tb: tbs }, to);
  }

  // Every table in use, the bracket and the options: what a joiner, a reloader or a new host needs.
  hallState() {
    return {
      tables: this.tables.filter((tb) => tb.setup).map((tb) => ({ n: tb.n, setup: tb.setup, ui: tb.ui, sc: tb.match ? [tb.match.rules.score.p, tb.match.rules.score.c] : tb.lastSc })),
      tour: this.tour, opts: this.opts
    };
  }
  broadcastFull(to) {
    if (!this.isHost) return;
    this.net.send(Object.assign({ k: "hall" }, this.hallState()), to);
  }

  // ---- messages ---------------------------------------------------------------------------
  onMessage(d, from) {
    if (!d || typeof d !== "object") return;
    if (this.isHost) {
      if (d.k === "hi") this.broadcastFull(from);
      else if (d.k === "sw") this.hostSwing(d, from);
      else if (d.k === "adv") {
        const tb = this.tables[d.n | 0];
        if (tb && (tb.ui.ph === "result" || tb.ui.ph === "bracket" || tb.ui.ph === "done")) this.advance(tb.n);
      }
      return;
    }
    if (from !== this.net.hostId) return;
    if (d.k === "hall") this.applyHall(d);
    else if (d.k === "ui") {
      const tb = this.tables[d.n | 0]; if (!tb || !d.ui) return;
      if (d.tour) this.tour = d.tour;
      tb.ui = d.ui; this.cb.onUi && this.cb.onUi(tb.ui, tb.n);
    } else if (d.k === "st") this.applySnapshot(d);
  }

  hostSwing(d, from) {
    const tb = this.tables.find((x) => x.setup && x.match && x.setup.id === d.id);
    if (!tb || tb.ui.ph !== "play") return;
    const m = tb.match;
    const s = tb.setup.seats.find((x) => x.seat === d.seat);
    if (!s || !s.human || s.id !== from) return;
    const intent = cleanIntent(d.i);
    if (!intent || !num(d.ts, 1e6)) return;
    const now = m.t + m.acc;
    if (Math.abs(d.ts - now) > 1.0) return;
    m.swing(d.seat, intent, d.ts);
  }

  // ---- client side ------------------------------------------------------------------------
  hello() {
    if (this.isHost || this.t - this.helloT < 0.5) return;
    this.helloT = this.t;
    this.net.send({ k: "hi" }, this.net.hostId);
  }

  applyHall(d) {
    if (!d || !Array.isArray(d.tables)) return;
    if (d.opts) this.opts = Object.assign(this.opts, d.opts);
    this.tour = d.tour || null;
    const seen = new Set();
    for (const e of d.tables) {
      const tb = this.tables[e && e.n | 0];
      if (!tb || !e.setup) continue;
      seen.add(tb.n);
      const fresh = !tb.setup || tb.setup.id !== e.setup.id;
      if (fresh) tb.clear();
      tb.setup = e.setup;
      if (e.ui) tb.ui = e.ui;
      if (e.sc) tb.lastSc = e.sc;
      this.cb.onSetup && this.cb.onSetup(tb.setup, fresh, tb.n);
      this.cb.onUi && this.cb.onUi(tb.ui, tb.n);
    }
    this.tables.forEach((tb) => { if (!seen.has(tb.n)) this.clearTable(tb); });
  }

  applySnapshot(d) {
    if (!Array.isArray(d.tb)) return;
    for (const s of d.tb) {
      const tb = this.tables[s && s.n | 0];
      if (!tb) continue;
      if (!tb.setup || tb.setup.id !== s.id) { this.hello(); continue; }
      s.hn = d.hn;
      tb.snap = s; tb.lastSc = s.sc;
      if (Array.isArray(s.ev)) for (const e of s.ev) this.onEvent(tb, e);
    }
  }

  clientTick() {
    if (!this.tables.some((tb) => tb.setup) && this.t - this.helloT > 1.5) this.hello();
  }

  // ---- shared: events ---------------------------------------------------------------------
  onEvent(tb, e) {
    if (e.type === "plan") tb.plan = { seat: e.seat, tc: e.tc, cx: e.cx, cy: e.cy, cz: e.cz, reachable: e.reachable };
    else if (e.type === "hit" || e.type === "whiff" || e.type === "point" || e.type === "ready" || e.type === "serve" || e.type === "let") tb.plan = null;
    this.cb.onEvent && this.cb.onEvent(e, tb.n);
  }

  // ---- local input ------------------------------------------------------------------------
  // Sim time "now" at a table as the host sees it.
  simNow(tb) {
    tb = tb || this.focus();
    if (this.isHost) return tb.match ? tb.match.t + tb.match.acc : 0;
    if (!tb.snap) return 0;
    return tb.snap.t + Math.max(0, Math.min(0.3, (this.net.now() - tb.snap.hn) / 1000));
  }

  swing(intent) {
    const tb = this.myTable();
    const seat = this.mySeat();
    if (!tb || !seat || tb.ui.ph !== "play") return false;
    const ts = this.simNow(tb);
    if (this.isHost) return tb.match ? tb.match.swing(seat, cleanIntent(intent), ts) : false;
    this.net.send({ k: "sw", id: tb.setup.id, seat, i: intent, ts: r3(ts) }, this.net.hostId);
    return true;
  }

  // ---- what to draw -----------------------------------------------------------------------
  // A table's state for the view (your table by default). dt: frame seconds.
  // Returns { n, t, ph, ball, seats:[{seat,x,z,vx,vz}], sc, sv, rc, fz } or null.
  view(dt, tb) {
    tb = tb || this.focus();
    if (!tb.setup) return null;
    if (this.isHost && tb.match) {
      const m = tb.match, b = m.ball;
      return { n: tb.n, t: m.t + m.acc, ph: m.phase, ball: b, fz: m.frozen, sc: [m.rules.score.p, m.rules.score.c], sv: m.rules.server, rc: m.rules.receiver,
        seats: m.seats.map((s) => ({ seat: s.seat, x: s.x, z: s.z, vx: s.vx || 0, vz: s.vz || 0 })) };
    }
    const sn = tb.snap;
    if (!sn) return { n: tb.n, t: 0, ph: "serve", ball: { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, t: 0, s: 0 }, fz: false, sc: tb.lastSc || [0, 0], sv: "p0", rc: "c0",
      seats: tb.setup.seats.map((s) => ({ seat: s.seat, x: 0, z: (s.seat[0] === "p" ? 2.15 : -2.15), vx: 0, vz: 0 })) };
    const el = Math.max(0, Math.min(0.3, (this.net.now() - sn.hn) / 1000));
    // Ball: the host's, run forward by the time since the snapshot (no events).
    const ball = { x: sn.b[0], y: sn.b[1], z: sn.b[2], vx: sn.b[3], vy: sn.b[4], vz: sn.b[5], t: sn.b[6], s: sn.b[7] };
    if (!sn.fz && sn.ph === "rally" && tb.ui.ph === "play") { const n = Math.round(el / DT); for (let i = 0; i < n; i++) stepBall(ball); }
    const seats = tb.setup.seats.map((s, i) => {
      const tgt = sn.p[i] || [0, 0, 0, 0];
      let p = tb.pos[s.seat];
      if (!p) p = tb.pos[s.seat] = { x: tgt[0], z: tgt[1] };
      const k = Math.min(1, dt * 16);
      const ox = p.x, oz = p.z;
      p.x += (tgt[0] + tgt[2] * el - p.x) * k; p.z += (tgt[1] + tgt[3] * el - p.z) * k;
      return { seat: s.seat, x: p.x, z: p.z, vx: dt > 0 ? (p.x - ox) / dt : 0, vz: dt > 0 ? (p.z - oz) / dt : 0 };
    });
    return { n: tb.n, t: sn.t + el, ph: sn.ph, ball, fz: !!sn.fz, sc: sn.sc, sv: sn.sv, rc: sn.rc, seats };
  }

  // ---- host change / reloads --------------------------------------------------------------
  // The old host left: carry on every table from the last state we saw.
  becameHost() {
    if (!this.isHost) return;
    const any = this.tables.some((tb) => tb.setup);
    if (!any) { this.begin(); return; }
    this.begun = true;
    this.matchNo = Math.max(this.matchNo, ...this.tables.map((tb) => (tb.setup ? tb.setup.id : 0)));
    for (const tb of this.tables) {
      if (!tb.setup || tb.ui.ph !== "play") continue;
      tb.match = this.newMatch(tb.setup, 0.14, (Date.now() + tb.n) & 0x7fffffff);
      tb.match.restore(tb.lastSc[0], tb.lastSc[1]);
      tb.plan = null;
    }
    this.syncQueue();
    this.noteLeavers();
    this.broadcastFull();
  }

  // What a late joiner / reloader needs.
  stateFor() { return this.tables.some((tb) => tb.setup) ? this.hallState() : undefined; }
  restore(d) { if (d && d.tables) this.applyHall(d); }
}

export { LEVELS, copyBall };
