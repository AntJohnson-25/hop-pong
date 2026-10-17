// Logic tests: node tools/tests.js
import { Rules, serveCycle } from "../Work/src/sim/rules.js";
import { Match } from "../Work/src/sim/match.js";
import { shotTarget, shotVelocity, fly, serveVelocity } from "../Work/src/sim/shots.js";
import { newTournament, matches, liveMatches, record, settle, playOut, humansLeft } from "../Work/src/sim/tournament.js";

let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " got " + JSON.stringify(a) + " want " + JSON.stringify(b));

// -- serve rotation
eq(serveCycle(false).map(x => x.join(">")), ["p0>c0", "c0>p0"], "singles cycle");
eq(serveCycle(true).map(x => x.join(">")), ["p0>c0", "c0>p1", "p1>c1", "c1>p0"], "doubles cycle");
{
  const R = new Rules({ doubles: false, target: 11 });
  const servers = [];
  for (let i = 0; i < 8; i++) { servers.push(R.server); R.end("c", "x"); R.award(); R.startRally(); }
  eq(servers, ["p0","p0","c0","c0","p0","p0","c0","c0"], "singles serves change every 2 points");
  const D = new Rules({ doubles: true, target: 11 });
  const s2 = [];
  for (let i = 0; i < 8; i++) { s2.push(D.server); D.end("p", "x"); D.award(); D.startRally(); }
  eq(s2, ["p0","p0","c0","c0","p1","p1","c1","c1"], "doubles serves change every 2 points");
}
// -- deuce: serve changes every point from 10-10
{
  const R = new Rules({ doubles: false, target: 11 });
  for (let i = 0; i < 10; i++) { R.end("c", "x"); R.award(); R.startRally(); R.end("p", "x"); R.award(); R.startRally(); }
  eq([R.score.p, R.score.c], [10, 10], "10-10");
  const a = R.server; R.end("c", "x"); R.award(); R.startRally();
  ok(R.server !== a, "deuce serve changes each point");
  ok(!R.winner, "no winner at 11-10");
  R.end("c", "x"); R.award();
  eq(R.winner, "p", "win by 2");
}
// -- hit order in doubles
{
  const D = new Rules({ doubles: true });
  eq(D.hitOrder(), ["p0", "c0", "p1", "c1"], "doubles hit order");
  D.hit("p0"); eq(D.nextHitter(), "c0", "after serve");
  D.hit("c0"); eq(D.nextHitter(), "p1", "partner next");
  const over = D.hit("c1");
  ok(over && over.loser === "c" && over.reason === "out of turn", "out of turn fault");
}
// -- serve legality
{
  const R = new Rules({ doubles: true }); R.hit("p0");
  ok(!R.bounce(0.3, 0.5), "own half first");
  ok(R.bounce(0.3, -0.5)?.reason === "wrong half", "diagonal needed: p serves into c's right (x<0)");
  const R2 = new Rules({ doubles: true }); R2.hit("p0"); R2.bounce(0.3, 0.5);
  ok(!R2.bounce(-0.3, -0.5), "correct diagonal");
  const R3 = new Rules({ doubles: false }); R3.hit("p0");
  ok(R3.bounce(0.1, -0.5)?.reason === "bad serve", "serve must bounce own half first");
  const R4 = new Rules({}); R4.hit("p0"); R4.bounce(0, 0.5);
  eq(R4.net(true), "let", "serve cord = let");
}
// -- rally rules
{
  const R = new Rules({}); R.hit("p0"); R.bounce(0, 0.5); R.bounce(0, -0.5); R.hit("c0");
  ok(R.bounce(0, 0.5) === null, "return lands");
  ok(R.bounce(0, 0.6) ?.reason === "two bounces", "double bounce loses for the side it bounced on");
  const F = new Rules({}); F.hit("p0"); F.bounce(0, 0.5); F.bounce(0, -0.5); F.hit("c0");
  eq(F.floor().reason, "missed the table", "return that misses the table");
}
// -- solver
{
  const p0 = { x: 0.1, y: 1.0, z: 2.0 };
  let bad = 0;
  for (const kind of ["drive", "push", "lob", "block", "smash"]) for (const aim of [-1, 0, 1]) for (const depth of [0, 0.5, 1]) for (const pace of [0, 0.5, 1]) {
    const tg = shotTarget({ kind, aim, depth, pace }, 1, 1, kind === "smash" ? 1.3 : 1.0);
    const v = shotVelocity(p0, tg.tx, tg.tz, tg.hs, tg.t, tg.s, 0.035, tg.minT);
    const l = fly(p0, v, tg.t, tg.s);
    if (l.net || l.floor || Math.abs(l.x) > 0.7 || l.z > -0.05 || l.z < -1.37 || (Math.hypot(l.x - tg.tx, l.z - tg.tz) > 0.05 && !(kind === "push" || kind === "block"))) { bad++; console.log("bad", kind, aim, depth, pace, l.net?"net":l.floor?"floor":"", l.x.toFixed(2), l.z.toFixed(2), "want", tg.tx.toFixed(2), tg.tz.toFixed(2), tg.hs.toFixed(1)); }
  }
  ok(bad === 0, "all shots clear the net and land on the table (on target unless a short soft shot is infeasible) (" + bad + " bad)");
  for (const side of [1, -1]) {
    let fails = 0;
    for (const tx of [-0.5, 0, 0.5]) for (const dz of [0.5, 0.9, 1.25]) {
      const h = { x: 0.2, y: 0.95, z: side * 1.57 };
      const r = serveVelocity(h, tx, -side * dz, 0.3, 0, side);
      if (!r || r.err > 0.12) fails++;
    }
    ok(fails <= 1, "serves land near target from side " + side + " (" + fails + " fails)");
  }
}
// -- a human match: scripted perfect swings win rallies; timing windows
{
  const m = new Match({ seed: 3, level: "easy", serveDelay: 0.1, pointDelay: 0.05, seats: [{ seat: "p0", human: true }, { seat: "c0", level: "easy" }] });
  let served = false, swung = 0, points = 0, whiffs = 0, guard = 0;
  while (m.phase !== "over" && guard++ < 200000) {
    m.update(1 / 60);
    if (m.phase === "serve" && m.rules.server === "p0" && m.phaseT > 0.5) m.swing("p0", { kind: "serve", aim: 0.2, depth: 0.5, pace: 0.4 });
    const pl = m.plan;
    if (m.phase === "rally" && pl && !pl.done && pl.seat === "p0" && !pl.swing && m.t >= pl.tc - 0.01) {
      if (m.swing("p0", { kind: "drive", aim: -0.3, depth: 0.6, pace: 0.5 }, pl.tc)) swung++;
    }
    for (const e of m.drain()) { if (e.type === "point") points++; if (e.type === "whiff") whiffs++; }
  }
  ok(m.phase === "over", "scripted human match ends");
  ok(swung > 5, "human swings were accepted (" + swung + ")");
  ok(points >= 11, "points played " + points);
}
// -- timing: a swing 0.5 s off is refused
{
  const m = new Match({ seed: 9, level: "easy", serveDelay: 0.05, seats: [{ seat: "p0", human: true }, { seat: "c0" }] });
  let rejected = null, g = 0;
  while (g++ < 60000 && rejected === null) {
    m.update(1 / 60);
    if (m.phase === "serve" && m.rules.server === "p0" && m.phaseT > 0.4) m.swing("p0", { kind: "serve", aim: 0, depth: 0.5, pace: 0.4 });
    const pl = m.plan;
    if (m.phase === "rally" && pl && !pl.done && pl.seat === "p0") rejected = m.swing("p0", { kind: "drive" }, pl.tc - 0.5);
  }
  eq(rejected, false, "swing 0.5 s early is ignored");
}
// -- network grace: a late swing message still hits and the ball is caught up
{
  const m = new Match({ seed: 4, level: "easy", grace: 0.15, serveDelay: 0.05, pointDelay: 0.05, seats: [{ seat: "p0", human: true }, { seat: "c0" }] });
  let late = 0, g = 0;
  while (g++ < 120000 && late < 3) {
    m.update(1 / 120);
    if (m.phase === "serve" && m.rules.server === "p0" && m.phaseT > 0.4) m.swing("p0", { kind: "serve", aim: 0, depth: 0.5, pace: 0.4 });
    const pl = m.plan;
    if (m.phase === "rally" && pl && !pl.done && pl.seat === "p0" && m.t >= pl.tc + 0.08 && !pl.swing) {
      if (m.swing("p0", { kind: "drive", aim: 0, depth: 0.5, pace: 0.4 }, pl.tc + 0.01)) late++;
    }
    m.drain();
  }
  ok(late >= 1, "late swing messages accepted within the grace (" + late + ")");
}
// -- tournament
{
  const humans = [{ id: "h1", name: "Ant" }, { id: "h2", name: "Bea" }];
  const fillers = "A B C D E F G H".split(" ").map((x) => ({ id: "a" + x, name: x }));
  const t = newTournament(humans, fillers, "rising", 42);
  eq(t.draw.length, 8, "draw of 8");
  ok(t.draw.filter((e) => e.human).length === 2, "two humans");
  settle(t);
  let live = liveMatches(t);
  ok(live.length >= 1 && live.length <= 2, "live matches in QF " + live.length);
  for (const m of live) record(t, 0, m.slot, 7, 3);
  ok(t.round === 1 && matches(t, 1).every((m) => m.a && m.b), "round 2 drawn");
  for (let g = 0; g < 4 && !t.champion; g++) {
    for (const m of liveMatches(t)) record(t, t.round, m.slot, 7, 2);
    if (!liveMatches(t).length && !t.champion) playOut(t);
  }
  ok(!!t.champion, "bracket names a champion");
  const t2 = newTournament([{ id: "h1", name: "Ant" }], fillers, "hard", 7);
  const l = liveMatches(t2); ok(l.length === 1, "one human = one live match");
  record(t2, 0, l[0].slot, l[0].a.human ? 3 : 7, l[0].a.human ? 7 : 3);
  ok(!humansLeft(t2) || liveMatches(t2).length === 0, "human out");
  playOut(t2); ok(!!t2.champion, "playOut crowns someone after the human loses");
}
console.log(fail ? fail + " FAILED of " + n : "ALL PASS (" + n + " checks)");
process.exit(fail ? 1 : 0);
