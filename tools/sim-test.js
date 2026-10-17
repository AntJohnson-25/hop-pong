import { Match } from "../Work/src/sim/match.js";
function play(opts) {
  const seats = opts.doubles ? ["p0","p1","c0","c1"] : ["p0","c0"];
  const m = new Match({ ...opts, seats: seats.map(s => ({ seat: s, human: false, level: s[0]==="p" ? opts.lp : opts.lc })), serveDelay: 0.2, pointDelay: 0.1 });
  const reasons = {}; let rallies = [], pts = 0, lets = 0, whiffs = 0;
  let guard = 0;
  while (m.phase !== "over" && guard++ < 400000) {
    m.update(1/60);
    for (const e of m.drain()) {
      if (e.type === "point") { reasons[e.reason] = (reasons[e.reason]||0)+1; rallies.push(e.rally); pts++; }
      if (e.type === "let") lets++;
      if (e.type === "whiff") whiffs++;
    }
  }
  return { m, reasons, rallies, lets, whiffs, done: m.phase === "over" };
}
const agg = {}; let games = 0, stuck = 0, rl = [], wins = {p:0,c:0}, mx = 0;
for (const doubles of [false, true]) {
  for (const [lp, lc] of [["easy","easy"],["medium","medium"],["hard","hard"],["hard","easy"]]) {
    let res = {}, len = [], w = 0, n = 40, sc = 0;
    for (let i = 0; i < n; i++) {
      const r = play({ doubles, seed: 1000 + i, lp, lc, level: "medium" });
      if (!r.done) { stuck++; continue; }
      games++; w += r.m.rules.winner === "p" ? 1 : 0; sc += r.m.rules.score.p + r.m.rules.score.c;
      for (const k in r.reasons) res[k] = (res[k]||0) + r.reasons[k];
      len.push(...r.rallies);
    }
    const avg = len.sort((a,b)=>a-b)[len.length>>1];
    console.log((doubles?"D ":"S ")+lp+" v "+lc, "p wins", w+"/"+n, "avg pts", (sc/n).toFixed(1), "median hits/rally", avg.toFixed(1), JSON.stringify(res));
  }
}
console.log("games", games, "stuck", stuck);
