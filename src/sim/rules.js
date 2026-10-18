// Table tennis rules (singles and doubles): a pure state machine, no DOM, no physics.
//
// Sides are "p" (z > 0) and "c" (z < 0). Seats are "p0", "p1", "c0", "c1" (singles uses 0 only).
// Scoring: games to `target` (11), win by 2. The server changes every 2 points, every point from
// target-1 all. Doubles: the server serves diagonally into the receiver's right half, and players
// hit in turn: server, receiver, server's partner, receiver's partner, and round again.
import { TABLE, onTable } from "./physics.js";

export const other = (s) => (s === "p" ? "c" : "p");
export const sideOfZ = (z) => (z > 0 ? "p" : "c");
// World x sign of a side's right hand: "p" faces -z (right = +x), "c" faces +z (right = -x).
export const rightX = (s) => (s === "p" ? 1 : -1);
export const sideOf = (seat) => seat[0];

// The cycle of (server, receiver) seats for a game.
export function serveCycle(doubles, first = "p") {
  const A = first, B = other(first);
  if (!doubles) return [[A + "0", B + "0"], [B + "0", A + "0"]];
  return [[A + "0", B + "0"], [B + "0", A + "1"], [A + "1", B + "1"], [B + "1", A + "0"]];
}

export class Rules {
  constructor({ doubles = false, first = "p", target = 11 } = {}) {
    this.doubles = doubles;
    this.target = target;
    this.cycle = serveCycle(doubles, first);
    this.slot = 0;
    this.points = 0;
    this.score = { p: 0, c: 0 };
    this.winner = null;
    this.startRally();
  }

  get server() { return this.cycle[this.slot % this.cycle.length][0]; }
  get receiver() { return this.cycle[this.slot % this.cycle.length][1]; }
  get serverSide() { return sideOf(this.server); }
  get deuce() { return this.score.p >= this.target - 1 && this.score.c >= this.target - 1; }

  // Hit order within a rally: server, receiver, server's partner, receiver's partner, ...
  hitOrder() {
    const S = this.server, R = this.receiver;
    if (!this.doubles) return [S, R];
    const partner = (x) => x[0] + (x[1] === "0" ? "1" : "0");
    return [S, R, partner(S), partner(R)];
  }

  // Who must hit next (hit number `n` of this rally, 0 = the serve).
  nextHitter() {
    const o = this.hitOrder();
    return o[this.shots % o.length];
  }

  // Doubles serves go to the receiver's right half: the world-x sign that the serve must land in.
  // The server's own right half is the one the serve starts from; it lands in the receiver's right.
  serveLandSign() {
    if (!this.doubles) return 0;
    const r = this.receiver[0];
    // The receiver's right half as seen by them: x sign = rightX(r) (they face the net).
    return rightX(r);
  }

  // World x sign of the server's right half (where the doubles serve starts).
  serveStartSign() { return rightX(this.serverSide); }

  startRally() {
    this.shots = 0;                 // hits so far (the serve is the first)
    this.lastHitter = null;
    this.bounces = { p: 0, c: 0 };  // table bounces on each half since the last hit
    this.over = null;               // { loser, winner, reason } once decided
    this.letCalled = false;
  }

  call() {
    return this.score[this.serverSide] + "-" + this.score[other(this.serverSide)];
  }

  // `seat` hits the ball. volley: it has not bounced on their side since the last hit.
  hit(seat, volley = false) {
    if (this.over) return this.over;
    const side = sideOf(seat);
    if (this.shots > 0 && volley) return this.end(side, "volley");
    if (this.doubles && seat !== this.nextHitter()) return this.end(side, "out of turn");
    this.shots++;
    this.lastHitter = seat;
    this.bounces.p = 0; this.bounces.c = 0;
    return null;
  }

  // The ball bounced on the table at (x, z).
  bounce(x, z) {
    if (this.over || !this.lastHitter) return null;
    const side = sideOfZ(z), hitter = sideOf(this.lastHitter);
    if (this.shots === 1) {
      // The serve: first own half, then the opponent's.
      if (this.bounces[hitter] === 0) {
        if (side !== hitter) return this.end(hitter, "bad serve");
        this.bounces[side]++;
        return null;
      }
      if (side === hitter) return this.end(hitter, "bad serve");
      if (this.doubles && x * this.serveLandSign() < -0.005) return this.end(hitter, "wrong half");
      this.bounces[side]++;
      return null;
    }
    if (side === hitter) {
      // Short of the net on their own half.
      return this.end(hitter, "own half");
    }
    this.bounces[side]++;
    if (this.bounces[side] >= 2) return this.end(side, "two bounces");
    return null;
  }

  // The ball hit the floor / left the table area without a (valid) bounce on the far half.
  floor() {
    if (this.over || !this.lastHitter) return null;
    const hitter = sideOf(this.lastHitter), opp = other(hitter);
    if (this.shots === 1 && this.bounces[hitter] === 0) return this.end(hitter, "bad serve");
    if (this.bounces[opp] === 0) return this.end(hitter, "missed the table");
    return this.end(opp, "missed");
  }

  // The ball hit the net. Returns "let" on a serve that clipped the cord (replay).
  net(cord) {
    if (this.over || !this.lastHitter) return null;
    if (cord) {
      if (this.shots === 1) { this.letCalled = true; return "let"; }
      return null;
    }
    return this.end(sideOf(this.lastHitter), "net");
  }

  // The receiving side never reached the ball (no swing / whiff).
  whiff(seat) {
    if (this.over) return this.over;
    return this.end(sideOf(seat), "missed");
  }

  end(loser, reason) {
    this.over = { loser, winner: other(loser), reason };
    return this.over;
  }

  // Rebuild the serve position from a score (a new host taking over mid-game).
  restore(p, c) {
    this.score = { p, c };
    this.points = p + c;
    const d = 2 * (this.target - 1);
    this.slot = Math.floor(Math.min(this.points, d) / 2) + Math.max(0, this.points - d);
    this.winner = null;
    this.startRally();
  }

  // Apply a let: replay the serve, nothing changes.
  replayLet() { this.startRally(); }

  // Apply the decided rally to the score.
  award() {
    const r = this.over;
    if (!r) throw new Error("rally not over");
    this.score[r.winner]++;
    this.points++;
    if (this.deuce || this.points % 2 === 0) this.slot++;
    const a = this.score.p, b = this.score.c;
    if ((a >= this.target || b >= this.target) && Math.abs(a - b) >= 2) this.winner = a > b ? "p" : "c";
    return { winner: r.winner, reason: r.reason, gameOver: !!this.winner };
  }
}

export { TABLE, onTable };
