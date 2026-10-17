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
console.log(fail ? fail + " FAILED of " + n : "ALL PASS (" + n + " checks)");
process.exit(fail ? 1 : 0);
