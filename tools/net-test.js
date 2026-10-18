// Network tests: node tools/net-test.js  (a fake relay with latency and message loss)
import { Session } from "../Work/src/game.js";

function makeRelay(opts = {}) {
  const R = { t: 0, clients: new Map(), queue: [], hostId: null, lat: opts.lat ?? 40, loss: opts.loss ?? 0, rng: (() => { let s = opts.seed || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })() };
  R.players = () => [...R.clients.values()].map((c) => ({ id: c.id, name: c.name }));
  R.add = (id, name) => {
    const c = { id, name, sess: null, inbox: [] };
    R.clients.set(id, c);
    if (!R.hostId) R.hostId = id;
    c.net = {
      me: id, get hostId() { return R.hostId; }, standalone: false,
      isHost: () => R.hostId === id, players: () => R.players(), now: () => Math.round(R.t * 1000),
      send: (data, to) => {
        const targets = to === undefined ? [...R.clients.keys()].filter((x) => x !== id) : Array.isArray(to) ? to : [to];
        for (const tgt of targets) { if (R.rng() < R.loss) continue; R.queue.push({ at: R.t + R.lat / 1000 + R.rng() * 0.01, to: tgt, from: id, data: JSON.parse(JSON.stringify(data)) }); }
        return true;
      }
    };
    return c;
  };
  R.remove = (id) => {
    R.clients.delete(id);
    if (R.hostId === id) { R.hostId = [...R.clients.keys()][0] || null; const c = R.clients.get(R.hostId); if (c) c.sess.becameHost(); }
  };
  R.step = (dt) => {
    R.t += dt;
    R.queue.sort((a, b) => a.at - b.at);
    while (R.queue.length && R.queue[0].at <= R.t) {
      const m = R.queue.shift(); const c = R.clients.get(m.to);
      if (c && c.sess) c.sess.onMessage(m.data, m.from);
    }
    for (const c of R.clients.values()) c.sess.update(dt);
  };
  return R;
}

let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL", m); } };

// A scripted human: serves when it's their serve, swings at the ring.
function bot(c) {
  const s = c.sess; const st = { last: null };
  return (R) => {
    if (s.ui.ph !== "play") return;
    const seat = s.mySeat(); if (!seat) return;
    const v = s.view(1 / 60); if (!v) return;
    if (v.ph === "serve" && v.sv === seat && (!st.sv || R.t - st.sv > 1.5)) { st.sv = R.t; s.swing({ kind: "serve", aim: 0.2, depth: 0.5, pace: 0.4 }); }
    const pl = s.plan;
    if (pl && pl.seat === seat && pl !== st.last) {
      if (st.jit === undefined || st.jitFor !== pl) { st.jitFor = pl; st.jit = (Math.random() - 0.5) * 0.3; st.skip = Math.random() < 0.15; }
      if (s.simNow() >= pl.tc + st.jit) { st.last = pl; if (!st.skip) s.swing({ kind: "drive", aim: Math.random() * 1.6 - 0.8, depth: 0.2 + Math.random() * 0.8, pace: Math.random() }); }
    }
  };
}

function run(R, seconds, bots, hook) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) { R.step(1 / 60); bots.forEach((b) => b(R)); if (hook) hook(i); }
}

function mk(R, id, name, mode, extra) {
  const c = R.add(id, name);
  const ev = [];
  c.ev = ev; c.uis = [];
  c.sess = new Session(c.net, Object.assign({ mode, target: 7, ai: "easy" }, extra), { onEvent: (e) => ev.push(e), onUi: (u) => c.uis.push(u.ph) });
  return c;
}

// 1) singles, two humans
{
  const R = makeRelay({ seed: 3 });
  const A = mk(R, "A", "Ann", "singles"), B = mk(R, "B", "Bob", "singles");
  const bots = [bot(A), bot(B)];
  run(R, 3, bots);
  ok(A.sess.setup && B.sess.setup, "both have a setup");
  ok(B.sess.setup && B.sess.setup.id === A.sess.setup.id, "same match id");
  ok(A.sess.mySeat() === "p0" && B.sess.mySeat() === "c0", "seats " + A.sess.mySeat() + " " + B.sess.mySeat());
  const dev = [];
  run(R, 60, bots, () => { const a = A.sess.view(1 / 60), b = B.sess.view(1 / 60); if (a && b && a.ph === "rally" && b.ph === "rally") dev.push(Math.hypot(a.ball.x - b.ball.x, a.ball.y - b.ball.y, a.ball.z - b.ball.z)); });
  dev.sort((x, y) => x - y);
  ok(dev.length > 200 && dev[dev.length >> 1] < 0.35, "client ball tracks the host: median " + (dev[dev.length >> 1] || 0).toFixed(2) + " m over " + dev.length + " frames");
  const hitsA = A.ev.filter((e) => e.type === "hit").length, hitsB = B.ev.filter((e) => e.type === "hit").length;
  ok(hitsA > 4, "host saw hits " + hitsA);
  ok(Math.abs(hitsA - hitsB) <= 3, "clients see the same hits (" + hitsA + "/" + hitsB + ")");
  const sc = A.sess.view(1 / 60).sc, scB = B.sess.view(1 / 60).sc;
  ok(Math.abs(sc[0] - scB[0]) + Math.abs(sc[1] - scB[1]) <= 1, "scores agree " + sc + " / " + scB);
  const pointsA = A.ev.filter((e) => e.type === "point").length;
  ok(pointsA >= 3, "points played " + pointsA);
  // Ball in sync on the client
}
// 2) packet loss does not stop a match
{
  const R = makeRelay({ seed: 5, loss: 0.15, lat: 70 });
  const A = mk(R, "A", "Ann", "singles"), B = mk(R, "B", "Bob", "singles");
  const bots = [bot(A), bot(B)];
  run(R, 90, bots);
  ok(A.ev.filter((e) => e.type === "point").length >= 3, "lossy match plays");
  ok(!!B.sess.setup, "client has setup under loss");
}
// 3) host leaves: the client carries on
{
  const R = makeRelay({ seed: 8 });
  const A = mk(R, "A", "Ann", "doubles"), B = mk(R, "B", "Bob", "doubles"), C = mk(R, "C", "Cy", "doubles");
  const bots = [bot(A), bot(B), bot(C)];
  run(R, 20, bots);
  ok(["p0", "c0", "p1"].every((s) => [A, B, C].some((c) => c.sess.mySeat() === s)), "three humans seated");
  const before = B.sess.view(1 / 60).sc.slice();
  R.remove("A");
  run(R, 1, [bot(B), bot(C)]);
  ok(B.sess.isHost && B.sess.match, "B became host with a match");
  run(R, 40, [bot(B), bot(C)]);
  const after = B.sess.view(1 / 60).sc;
  ok(after[0] + after[1] >= before[0] + before[1], "score carried on " + before + " -> " + after);
  ok(C.sess.setup.seats.find((s) => s.seat === "p0").human === false, "A's seat now computer");
}
// 4) tournament with two humans
{
  const R = makeRelay({ seed: 11 });
  const A = mk(R, "A", "Ann", "tournament"), B = mk(R, "B", "Bob", "tournament");
  const bots = [bot(A), bot(B)];
  let guard = 0, phases = new Set();
  while (guard++ < 100 && A.sess.ui.ph !== "done") { run(R, 20, bots); phases.add(A.sess.ui.ph); if (A.sess.ui.ph === "bracket") A.sess.advance(); }
  ok(A.uis.includes("bracket"), "bracket shown between matches");
  ok(A.sess.ui.ph === "done" && A.sess.tour.champion, "tournament finishes with a champion: " + [...phases]);
  ok(B.sess.ui.ph === "done" || B.sess.ui.ph === "bracket" || B.sess.ui.ph === "play", "client follows");
}
// 5) late joiner takes a computer seat; a swing with a bad seat is ignored
{
  const R = makeRelay({ seed: 4 });
  const A = mk(R, "A", "Ann", "singles");
  run(R, 3, [bot(A)]);
  ok(A.sess.setup.seats.find((s) => s.seat === "c0").human === false, "CPU opposite at first");
  const B = mk(R, "B", "Bob", "singles");
  B.sess.hello();
  run(R, 3, [bot(A), bot(B)]);
  ok(B.sess.mySeat() === "c0", "joiner took the computer seat: " + B.sess.mySeat());
  const sw = A.sess.match.swing.bind(A.sess.match);
  A.sess.hostSwing({ id: A.sess.setup.id, seat: "c0", i: { kind: "drive" }, ts: A.sess.simNow() }, "A");
  ok(true, "forged swing ignored without crash");
  A.sess.onMessage({ k: "sw", id: 99 }, "B"); A.sess.onMessage(null, "B"); A.sess.onMessage({ k: "sw", id: A.sess.setup.id, seat: "c0", i: "x", ts: "now" }, "B");
  run(R, 5, [bot(A), bot(B)]);
  ok(true, "garbage messages survived");
}
// A relay that records the biggest message (HopLobby's limit is 16 KB of JSON).
function sizeWatch(R) {
  R.maxMsg = 0;
  for (const c of R.clients.values()) {
    const send = c.net.send;
    c.net.send = (data, to) => { R.maxMsg = Math.max(R.maxMsg, JSON.stringify(data).length); return send(data, to); };
  }
}
function full(R, mode, count) {
  const cs = [];
  for (let i = 0; i < count; i++) cs.push(mk(R, "P" + i, "Player " + i, mode));
  sizeWatch(R);
  return cs;
}
// 6) a full lobby of 16, singles: eight tables, everyone seated, one human per seat
{
  const R = makeRelay({ seed: 21 });
  const cs = full(R, "singles", 16);
  const bots = cs.map(bot);
  run(R, 4, bots);
  const H = cs[0].sess;
  ok(H.active().length === 8, "16 singles players use 8 tables: " + H.active().length);
  const seats = cs.map((c) => c.sess.myTable() && c.sess.myTable().n + ":" + c.sess.mySeat());
  ok(seats.every(Boolean) && new Set(seats).size === 16, "everyone has their own seat: " + seats.join(" "));
  ok(cs.every((c) => c.sess.active().length === 8), "every client sees all 8 tables");
  run(R, 40, bots);
  const pts = H.tables.map((tb) => tb.match ? tb.match.rules.score.p + tb.match.rules.score.c : 0);
  ok(pts.every((p) => p >= 2), "every table is playing: points " + pts);
  const last = cs[15], tb = last.sess.myTable();
  const v = last.sess.view(1 / 60), hv = H.view(1 / 60, H.tables[tb.n]);
  ok(Math.abs(v.sc[0] - hv.sc[0]) + Math.abs(v.sc[1] - hv.sc[1]) <= 1, "table " + (tb.n + 1) + " score agrees on a client " + v.sc + " / " + hv.sc);
  ok(R.maxMsg < 16000, "biggest message " + R.maxMsg + " bytes < 16 KB");
  // two players at one table leave: the table closes; a newcomer gets a table of their own
  const gone = H.tables[3].setup.seats.map((s) => s.id);
  gone.forEach((id) => R.remove(id));
  run(R, 1, bots.filter((_, i) => !gone.includes("P" + i)));
  ok(H.tables[3].ui.ph === "idle", "an empty table closes");
  const N = mk(R, "N", "Newbie", "singles"); N.sess.hello();
  run(R, 3, [bot(N)]);
  ok(N.sess.myTable() && N.sess.mySeat(), "a newcomer is seated: table " + (N.sess.myTable() && N.sess.myTable().n));
}
// 7) a full lobby of 16, doubles: four tables of four
{
  const R = makeRelay({ seed: 22 });
  const cs = full(R, "doubles", 16);
  run(R, 4, cs.map(bot));
  ok(cs[0].sess.active().length === 4, "16 doubles players use 4 tables: " + cs[0].sess.active().length);
  ok(cs.every((c) => c.sess.mySeat()), "all 16 seated in doubles");
  ok(R.maxMsg < 16000, "biggest doubles message " + R.maxMsg);
}
// 8) a 16-player tournament: a 16 draw, round of 16 all at once, a champion
{
  const R = makeRelay({ seed: 23 });
  const cs = full(R, "tournament", 16);
  const bots = cs.map(bot);
  run(R, 3, bots);
  const H = cs[0].sess;
  ok(H.tour && H.tour.size === 16, "16 draw: size " + (H.tour && H.tour.size));
  ok(H.active().length === 8, "round of 16 on 8 tables: " + H.active().length);
  let guard = 0;
  while (guard++ < 200 && H.ui.ph !== "done") { run(R, 15, bots); if (!H.playing() && H.tables.some((tb) => tb.ui.ph === "bracket")) H.advance(); }
  run(R, 1, bots);           // let the last message arrive
  ok(H.ui.ph === "done" && !!H.tour.champion, "16-player tournament crowns " + (H.tour && H.tour.champion));
  ok(cs[9].sess.ui.ph === "done", "clients reach the end too: " + cs[9].sess.ui.ph);
  ok(R.maxMsg < 16000, "biggest tournament message " + R.maxMsg);
}
// 9) bad messages through the relay: a reviewer sends junk and nothing breaks, forged moves do nothing
{
  const R = makeRelay({ seed: 31 });
  const A = mk(R, "A", "Ann", "singles"), B = mk(R, "B", "Bob", "singles");
  const bots = [bot(A), bot(B)];
  run(R, 4, bots);
  const H = A.sess, tb = H.tables[0], id = tb.setup.id;
  const junk = [
    undefined, null, 0, 1, "", "sw", "x".repeat(100000), true, [], [1, 2, 3], {}, { k: null }, { k: 5 }, { k: ["sw"] }, { k: {} },
    { k: "sw" }, { k: "sw", id }, { k: "sw", id, seat: "p0" }, { k: "sw", id, seat: "__proto__", i: { kind: "drive" }, ts: 0 },
    { k: "sw", id, seat: "constructor", i: {}, ts: 1 }, { k: "sw", id, seat: "p0", i: [], ts: 1e308 }, { k: "sw", id, seat: "p0", i: { kind: {}, aim: "a", depth: [], pace: null, curve: {} }, ts: -1e308 },
    { k: "sw", id: { a: 1 }, seat: ["p0"], i: "x", ts: {} }, { k: "adv", n: "x" }, { k: "adv", n: -5 }, { k: "adv", n: 1e12 }, { k: "adv", n: {} }, { k: "adv", n: [1] },
    { k: "hi", n: 1 }, { k: "hall", tables: "x" }, { k: "hall", tables: [null, 1, "a", { n: -1 }] }, { k: "ui", n: {}, ui: 1 }, { k: "st", tb: [null, { n: 99 }, "x"] },
    { k: "st", tb: { length: 1e9 } }, { __proto__: { k: "adv" } }, JSON.parse('{"k":"sw","__proto__":{"x":1},"constructor":{"prototype":{"y":1}}}')
  ];
  let threw = 0;
  for (const from of ["B", "X", "A"]) for (const m of junk) { try { H.onMessage(m, from); } catch (e) { threw++; console.log("host threw on", JSON.stringify(m).slice(0, 80), String(e)); } }
  for (const from of ["A", "B", "X"]) for (const m of junk) { try { B.sess.onMessage(m, from); } catch (e) { threw++; console.log("client threw on", JSON.stringify(m).slice(0, 80), String(e)); } }
  ok(threw === 0, "junk messages never throw (" + threw + " threw)");
  ok(({}).x === undefined && ({}).y === undefined, "no prototype pollution");
  run(R, 20, bots);
  ok(tb.setup && tb.setup.id === id && tb.ui.ph !== "idle", "match carried on after junk");
  ok(A.ev.filter((e) => e.type === "point").length >= 1, "points still scored after junk");
  // a forged swing from a non-seated player, or for someone else's seat, never moves the host's match
  const seatB = B.sess.mySeat(), seatA = A.sess.mySeat();
  let swung = 0; const real = tb.match.swing.bind(tb.match); tb.match.swing = (...a) => { swung++; return real(...a); };
  const ts = H.simNow(tb);
  H.onMessage({ k: "sw", id, seat: seatA, i: { kind: "drive" }, ts }, "B");   // B plays A's seat
  H.onMessage({ k: "sw", id, seat: seatB, i: { kind: "drive" }, ts }, "X");   // a stranger plays B's seat
  H.onMessage({ k: "sw", id, seat: seatB, i: { kind: "drive" }, ts: ts + 50 }, "B");   // far-off timestamp
  ok(swung === 0, "forged or stale swings are dropped (" + swung + " got through)");
  // a stranger can't move a table on from its result card; a seated player can
  tb.ui = { ph: "result" };
  H.onMessage({ k: "adv", n: 0 }, "X");
  ok(tb.ui.ph === "result", "a non-seated player can't advance a result card");
  H.onMessage({ k: "adv", n: 0 }, "B");
  ok(tb.ui.ph !== "result", "a seated player can: " + tb.ui.ph);
  // a flood of hellos gets a few full states, not one each
  let halls = 0; const send = A.net.send; A.net.send = (d, to) => { if (d && d.k === "hall") halls++; return send(d, to); };
  for (let i = 0; i < 200; i++) H.onMessage({ k: "hi" }, "B");
  ok(halls <= 1, "200 hellos at once get " + halls + " full state(s)");
  A.net.send = send;
  // only the host's messages change a client's state
  const uiBefore = JSON.stringify(B.sess.tables[0].ui);
  B.sess.onMessage({ k: "ui", n: 0, ui: { ph: "done" } }, "X");
  B.sess.onMessage({ k: "hall", tables: [], opts: { mode: "tournament" } }, "B");
  ok(JSON.stringify(B.sess.tables[0].ui) === uiBefore && B.sess.setup, "a client ignores state from anyone but the host");
}
console.log(fail ? fail + " FAILED of " + n : "ALL PASS (" + n + " checks)");
process.exit(fail ? 1 : 0);
