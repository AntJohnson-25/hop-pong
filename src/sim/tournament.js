// The tournament: a single-elimination 1v1 bracket of 8 entrants, or 16 when more than 8 people
// are in the lobby. Pure, no DOM; plain JSON so it fits in a relay message (syncState) and a
// cloud save.
//
// Entrants are { id, name, human, level } (humans are lobby players, the rest are computer
// players that fill the draw). A match with a human in it is played for real (the host runs a
// Match, one table each, all at once); AI-vs-AI matches are decided by a quick rally sim under
// the real rules.
import { Rules } from "./rules.js";
import { mulberry32 } from "./match.js";

// All rounds a 16 draw plays; an 8 draw starts at the quarterfinal.
export const ROUNDS = [
  { name: "ROUND OF 16", short: "R16", target: 7 },
  { name: "QUARTERFINAL", short: "QF", target: 7 },
  { name: "SEMIFINAL", short: "SF", target: 7 },
  { name: "FINAL", short: "F", target: 11 }
];
export const SIZE = 8, MAX_SIZE = 16;
const STRENGTH = { easy: 0, medium: 1, hard: 2 };

export function roundsOf(t) { return ROUNDS.slice(ROUNDS.length - Math.log2((t && t.size) || SIZE)); }

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// humans: [{ id, name }]; fillers: [{ id, name }] computer names to draw from.
// ai: "easy" | "medium" | "hard" | "rising" (the computer players get tougher each round).
export function newTournament(humans, fillers, ai = "rising", seed = (Date.now() & 0x7fffffff)) {
  const rng = mulberry32(seed);
  const size = humans.length > SIZE ? MAX_SIZE : SIZE;
  const hs = humans.slice(0, size);
  const need = size - hs.length;
  if (fillers.length < need) throw new Error("need " + need + " computer players");
  const cs = shuffle(fillers.slice(), rng).slice(0, need);
  const draw = shuffle([
    ...hs.map((h) => ({ id: h.id, name: h.name, human: true })),
    ...cs.map((c) => ({ id: c.id, name: c.name, human: false }))
  ], rng);
  const t = { v: 2, size, ai, seed, draw, round: 0, results: [], champion: null };
  t.results = roundsOf(t).map(() => []);
  return t;
}

// Computer skill for round r (Rising: easy early, medium in the semis, hard in the final).
export function levelFor(t, r) {
  if (t.ai === "rising") return ["easy", "medium", "hard"][Math.max(0, r - (roundsOf(t).length - 3))];
  return t.ai;
}

function byId(t, id) { return t.draw.find((e) => e.id === id) || null; }
export function matches(t, r) {
  const prev = r === 0 ? null : t.results[r - 1];
  const n = (t.size || SIZE) >> (r + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = r === 0 ? t.draw[i * 2] : (prev[i * 2] ? byId(t, prev[i * 2].w) : null);
    const b = r === 0 ? t.draw[i * 2 + 1] : (prev[i * 2 + 1] ? byId(t, prev[i * 2 + 1].w) : null);
    out.push({ round: r, slot: i, a, b, res: t.results[r][i] || null });
  }
  return out;
}

// Matches of the current round that need real play (a human is in them) and are undecided.
export function liveMatches(t) {
  if (t.champion) return [];
  return matches(t, t.round).filter((m) => !m.res && m.a && m.b && (m.a.human || m.b.human));
}

// One simulated match to `target` (win by 2): { sa, sb, w } where w is the winner's id.
export function simMatch(a, b, target, level, rng) {
  const la = a.human ? 1 : STRENGTH[a.level || level] ?? 1;
  const lb = b.human ? 1 : STRENGTH[b.level || level] ?? 1;
  const pa = Math.max(0.2, Math.min(0.8, 0.5 + 0.12 * (la - lb)));
  const R = new Rules({ doubles: false, first: rng() < 0.5 ? "p" : "c", target });
  for (let n = 0; n < 600 && !R.winner; n++) {
    R.end(rng() < pa ? "c" : "p", "sim");
    R.award();
    R.startRally();
  }
  return { sa: R.score.p, sb: R.score.c, w: R.winner === "p" ? a.id : b.id };
}

// Record a played match (scores for a and b), then sim the rest that can be simmed and advance.
export function record(t, round, slot, sa, sb) {
  if (round !== t.round) return t;
  const m = matches(t, round)[slot];
  if (!m || m.res || !m.a || !m.b) return t;
  t.results[round][slot] = { sa, sb, w: sa > sb ? m.a.id : m.b.id };
  return settle(t);
}

// Sim every undecided match with no human, and move to the next round when a round is whole.
export function settle(t) {
  const rng = mulberry32(t.seed + 1000 * (t.round + 1));
  const rounds = roundsOf(t);
  for (let guard = 0; guard < rounds.length && !t.champion; guard++) {
    const ms = matches(t, t.round);
    ms.forEach((m) => {
      if (!m.res && m.a && m.b && !m.a.human && !m.b.human) {
        t.results[t.round][m.slot] = simMatch(m.a, m.b, rounds[t.round].target, levelFor(t, t.round), rng);
      }
    });
    // Humans who are no longer in (or were never needed) cannot hold the bracket up: a match
    // between a human and a computer player stays live until someone records it.
    const done = matches(t, t.round).every((m) => m.res);
    if (!done) break;
    if (t.round === rounds.length - 1) { t.champion = t.results[t.round][0].w; break; }
    t.round++;
  }
  return t;
}

// When no human is left in the draw the rest of the bracket is simulated so it names a champion.
export function humansLeft(t) {
  const alive = new Set();
  matches(t, t.round).forEach((m) => { if (!m.res) { if (m.a && m.a.human) alive.add(m.a.id); if (m.b && m.b.human) alive.add(m.b.id); } });
  return alive.size > 0;
}

export function playOut(t) {
  const rng = mulberry32(t.seed + 77);
  const rounds = roundsOf(t);
  for (let guard = 0; guard < 8 && !t.champion; guard++) {
    matches(t, t.round).forEach((m) => {
      if (!m.res && m.a && m.b) t.results[t.round][m.slot] = simMatch(m.a, m.b, rounds[t.round].target, levelFor(t, t.round), rng);
    });
    settle(t);
  }
  return t;
}

export function eliminated(t, id) {
  for (let r = 0; r < roundsOf(t).length; r++) {
    for (const m of matches(t, r)) {
      if (m.res && (m.a.id === id || m.b.id === id) && m.res.w !== id) return r;
    }
  }
  return -1;
}

export function entrantName(t, id) { const e = byId(t, id); return e ? e.name : "?"; }
