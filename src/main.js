// Rally Hall: boot, HopLobby wiring (menu, graphics, settings, relay), the frame loop and the effects.
import { W } from "./world.js";
import { Person, loadAvatarBuffer } from "./people.js";
import { Session } from "./game.js";
import { Input } from "./input.js";
import { HUD } from "./hud.js";
import { A } from "./audio.js";
import { setLocale, t } from "./strings.js";
import { BASE_Z } from "./sim/match.js";
const THREE = globalThis.THREE;
const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Match rules the host picks in the lobby (kept identical in hoplobby.json "options").
export const LOBBY_OPTIONS = [
  { key: "mode", label: { en: "Mode", "pt-PT": "Modo" }, type: "choice", default: "singles",
    choices: [{ value: "singles", label: "Singles" }, { value: "doubles", label: "Doubles (2 v 2)" }, { value: "tournament", label: "Tournament (up to 16)" }] },
  { key: "points", label: { en: "Game to", "pt-PT": "Jogo até" }, type: "choice", default: 11,
    choices: [{ value: 7, label: "7" }, { value: 11, label: "11" }, { value: 21, label: "21" }] },
  { key: "ai", label: { en: "Computer skill", "pt-PT": "Nível do computador" }, type: "choice", default: "rising",
    choices: [{ value: "easy", label: "Easy" }, { value: "medium", label: "Medium" }, { value: "hard", label: "Hard" }, { value: "rising", label: "Rising (tougher each round)" }] }
];

const GFX = {
  potato: { level: "potato", pixelRatio: 0.7, shadows: "off", antialias: false, effects: false, particles: 0.25, drawDistance: 0.45, textureScale: 0.5 },
  low: { level: "low", pixelRatio: 1, shadows: "off", antialias: true, effects: false, particles: 0.5, drawDistance: 0.65, textureScale: 0.5 },
  medium: { level: "medium", pixelRatio: 1.25, shadows: "simple", antialias: true, effects: true, particles: 0.75, drawDistance: 0.8, textureScale: 1 },
  high: { level: "high", pixelRatio: 1.5, shadows: "soft", antialias: true, effects: true, particles: 1, drawDistance: 1, textureScale: 1 },
  ultra: { level: "ultra", pixelRatio: 2, shadows: "soft", antialias: true, effects: true, particles: 1, drawDistance: 1, textureScale: 1 }
};

// persons: the people at your table (state.people[focus]); people[n] = { persons, sig } per table.
const state = { S: null, people: [], persons: {}, focus: -1, mySeat: null, prefs: { ring: true, hudScale: 1, swipe: 1 }, last: 0, hudKey: "", hints: 0, serves: 0, wait: false, lastUi: null, paused: false };

// ---------------------------------------------------------------------------- HopLobby (or a stub)
const inLobby = typeof HopLobby !== "undefined";
const HL = inLobby ? HopLobby : null;
function hlNow() { return HL && HL.now ? HL.now() : Date.now(); }

// The round's players: HopLobby's roster (who readied up, plus late joiners it adds), or the whole lobby on a
// page without sessions. Lobby members outside the roster wait in HopLobby's lobby: no seat, not in the results.
function rosterPlayers() {
  if (!HL || !HL.players || !HL.players.length) return null;
  const s = HL.session && HL.session.get ? HL.session.get() : HL.context && HL.context.session;
  const r = s && Array.isArray(s.roster) && s.roster.length ? s.roster : null;
  return r ? HL.players.filter((p) => r.includes(p.id)) : HL.players;
}

function makeNet(ctx) {
  const me = ctx.playerId || "me";
  return {
    me, standalone: !!ctx.standalone,
    get hostId() { return HL && HL.context ? HL.context.hostId : me; },
    isHost: () => (HL ? !!HL.isHost : true),
    players: () => { const r = rosterPlayers(); return r ? r.map((p) => ({ id: p.id, name: p.name })) : [{ id: me, name: t("you") }]; },
    now: hlNow,
    send: (d, to) => (HL ? HL.send(d, to) : false)
  };
}

function gfxNow() {
  if (Q.get("g") && GFX[Q.get("g")]) return GFX[Q.get("g")];
  return (HL && HL.graphics) || GFX.high;
}

// ---------------------------------------------------------------------------- people
function side(seat) { return seat[0]; }
// The people at table n. Rebuilt only when who sits where changes (a new game, a joiner, a leaver).
function buildPeople(setup, fresh, n) {
  const tp = state.people[n] || (state.people[n] = { persons: {}, sig: "" });
  const sig = setup ? setup.id + "|" + setup.seats.map((s) => s.seat + ":" + (s.human ? s.id : "cpu" + s.look) + ":" + s.name).join(",") : "";
  if (sig === tp.sig) return;
  tp.sig = sig;
  Object.values(tp.persons).forEach((p) => p.dispose());
  tp.persons = {};
  if (n === state.focus) state.persons = tp.persons;
  if (!setup) { W.setTableBall(n, null); W.setScore(n, null); return; }
  const net = state.S.net;
  const loads = [];
  setup.seats.forEach((s) => {
    const mine = s.id && s.id === net.me;
    const p = new Person(W.scene, { seat: s.seat, side: side(s.seat), human: s.human, hl: s.id, name: s.name, look: s.look, tagText: mine ? s.name + " ★" : s.name, off: W.tableOff(n) });
    p.ikW = 1;
    tp.persons[s.seat] = p;
    loads.push(p.load().catch((err) => { console.warn("person", n, s.seat, err && err.message); }));
  });
  if (n === state.S.focus().n) {
    state.wait = true;
    HUD.wait(t("loadChars"));
    Promise.all(loads).then(() => { state.wait = false; HUD.wait(null); });
  }
  state.hudKey = "";
}

// Your table changed (a new game somewhere else, knocked out, a seat at another table).
function refocus(n) {
  state.focus = n;
  state.persons = (state.people[n] && state.people[n].persons) || {};
  W.setFocus(n);
  state.hudKey = "";
  onUi(state.S.tables[n].ui, n);
}

function dirOf(e, seat) {
  const s = side(seat) === "p" ? 1 : -1;
  if (e && e.v) { const v = new THREE.Vector3(e.v[0] ?? e.v.x, 0, e.v[2] ?? e.v.z); if (v.lengthSq() > 0.01) return v.normalize(); }
  return new THREE.Vector3(0, 0, -s);
}

// ---------------------------------------------------------------------------- events -> effects
// Every table's players swing and react; the sounds, sparks and banners are for your table only.
function onEvent(e, n) {
  const tp = state.people[n];
  if (n !== state.focus) {
    const person = tp && e.seat && tp.persons[e.seat];
    if ((e.type === "hit" || e.type === "serve") && person && e.x !== undefined) person.hit(e.t, new THREE.Vector3(e.x, e.y, e.z), dirOf(e, e.seat), e.type === "serve" ? "serve" : e.kind);
    else if (e.type === "plan" && person) person.plan(e.tc, new THREE.Vector3(e.cx, e.cy, e.cz), new THREE.Vector3(0, 0, side(e.seat) === "p" ? -1 : 1));
    else if (e.type === "point" && e.gameOver && tp) Object.values(tp.persons).forEach((p) => { if (p.ready && p.side === e.winner) p.emote("cheer", 1.6); });
    return;
  }
  const S = state.S, P = state.persons, my = state.mySeat;
  const person = e.seat && P[e.seat];
  switch (e.type) {
    case "serve":
    case "hit": {
      if (person) {
        const c = new THREE.Vector3(e.x, e.y, e.z);
        person.hit(e.t, c, dirOf(e, e.seat), e.type === "serve" ? "serve" : e.kind);
        if (e.type === "serve") person.sw.tc = e.t;
      }
      const sp = e.v ? Math.hypot(e.v[0] ?? e.v.x, e.v[1] ?? e.v.y, e.v[2] ?? e.v.z) : 8;
      A.hit(clamp(sp / 22, 0, 1), e.q === 1);
      if (e.x !== undefined) W.sparkAt(e.x, e.y, e.z, e.q === 1 ? 10 : 5);
      if (e.type === "hit" && e.seat === my && e.d !== undefined) {
        const ad = Math.abs(e.d);
        if (ad <= 0.05) HUD.banner(t("perfect"), "good", 650);
        else if (ad <= 0.11) HUD.banner(t("good"), "warm", 500);
        else HUD.banner(e.d < 0 ? t("early") : t("late"), "bad", 550);
        if (ad <= 0.05) W.shake = 0.01;
      }
      break;
    }
    case "plan": {
      if (person) person.plan(e.tc, new THREE.Vector3(e.cx, e.cy, e.cz), new THREE.Vector3(0, 0, side(e.seat) === "p" ? -1 : 1));
      if (e.seat === my && state.hints < 6) { state.hints++; showRallyHint(); }
      break;
    }
    case "whiff": if (e.seat === my) HUD.banner(t("miss"), "bad", 700); break;
    case "bounce": A.bounce(5); W.sparkAt(e.x, 0.78, e.z, 2); break;
    case "net": A.net(); break;
    case "floor": A.thud(); break;
    case "let": HUD.toast(t("let"), 1800); break;
    case "ready": {
      HUD.banner("", "", 1);
      if (my && e.server === my) { state.serves++; if (state.serves <= 4) HUD.hint(touch() ? t("serveHint") : t("serveHintKey")); } else HUD.hint(null);
      break;
    }
    case "point": {
      HUD.hint(null);
      const mySide = my ? side(my) : null;
      HUD.pointBanner(e, mySide);
      A.chime(!mySide || e.winner === mySide);
      Object.values(P).forEach((p) => {
        if (!p.ready) return;
        if (p.side === e.winner) setTimeout(() => p.emote("cheer", 1.6), 150 + Math.random() * 250);
        else if (Math.random() < 0.7) setTimeout(() => p.emote("shrug", 1.4), 300 + Math.random() * 300);
      });
      break;
    }
    default: break;
  }
  void S;
}
function touch() { return !!(HL && HL.device && HL.device.touch) || "ontouchstart" in window; }
function showRallyHint() { HUD.hint(touch() ? t("rallyHint") : t("rallyHintKey")); setTimeout(() => HUD.hint(null), 2800); }

function onUi(ui, n) {
  const S = state.S;
  if (n !== undefined && n !== S.focus().n) return;
  state.lastUi = ui;
  const mySide = S.mySeat() ? side(S.mySeat()) : null;
  HUD.overlays(ui, { mySide, myId: S.net.me, tour: S.tour, busy: S.playing() });
  Input.enabled = !state.paused && (!ui || ui.ph === "play");
  if (ui && ui.ph === "result") A.music("results"); else A.music("play");
}

// ---------------------------------------------------------------------------- frame
function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - state.last) / 1000, 0, 0.1);
  state.last = now;
  const S = state.S;
  if (S.focus().n !== state.focus) refocus(S.focus().n);
  S.update(dt);
  const F = S.focus();
  if (F.n !== state.focus) refocus(F.n);
  state.mySeat = S.mySeat();
  W.viewSide = state.mySeat && side(state.mySeat) === "c" ? -1 : 1;
  // The other tables: their players and balls, the live scores on every court.
  for (const tb of S.tables) {
    if (tb === F || !tb.setup) continue;
    const ov = S.view(dt, tb);
    const tp = state.people[tb.n];
    if (!ov || !tp) continue;
    ov.seats.forEach((st) => { const p = tp.persons[st.seat]; if (p) { p.lite = !!W.lite; p.update(dt, ov.t, st, ov.ph); } });
    W.setTableBall(tb.n, tb.ui.ph === "play" && ov.ph !== "point" && ov.ph !== "over" ? ov.ball : null);
    W.setScore(tb.n, ov.sc);
  }
  const v = S.view(dt, F);
  if (!v) { W.setTableBall(F.n, null); W.placeCamera(null, dt); W.render(); return; }
  W.setScore(F.n, v.sc);
  const my = state.mySeat, simT = v.t;
  let me = null;
  v.seats.forEach((st) => {
    const p = state.persons[st.seat];
    if (p) { p.lite = false; p.update(dt, simT, st, v.ph); }
    if (st.seat === my) me = st;
  });
  W.setBall(v.ball, dt);
  W.placeCamera(me, dt);
  // The ring on the spot you should swing at.
  const pl = S.plan;
  if (pl && my && pl.seat === my && state.prefs.ring && S.ui.ph === "play") W.setRing(true, pl.cx, pl.cy, pl.cz, pl.tc - S.simNow());
  else W.setRing(false);
  hudTick(v);
  W.render();
}

function hudTick(v) {
  const S = state.S, setup = S.setup;
  if (!setup) return;
  const names = { p: [], c: [] };
  setup.seats.forEach((s) => names[s.seat[0]].push(s.id && s.id === S.net.me ? t("you") : s.name));
  const many = S.active().length > 1;
  const key = [names.p.join("&"), names.c.join("&"), v.sc[0], v.sc[1], v.sv, setup.target, many ? v.n : ""].join("|");
  if (key !== state.hudKey) {
    state.hudKey = key;
    HUD.score({ p: names.p.join(" & "), c: names.c.join(" & ") }, v.sc, v.sv ? v.sv[0] : "p", setup.target, state.mySeat ? side(state.mySeat) : null, many ? v.n + 1 : 0);
  }
  HUD.show(true);
  if (!state.mySeat && S.ui.ph === "play" && !state.wait) HUD.wait(t("spectate")); else if (!state.wait) HUD.wait(null);
}


// ---------------------------------------------------------------------------- boot
async function boot() {
  HUD.progress(0.05, t("loading"));
  const defaults = { mode: Q.get("mode") || "singles", points: +(Q.get("points") || 11), ai: Q.get("ai") || "rising" };
  let ctx;
  if (HL) {
    try { ctx = await HL.init({ build: "0.1.0", lobbyOptions: LOBBY_OPTIONS, options: defaults }); } catch (err) { console.warn("HopLobby.init failed", err); }
  }
  if (!ctx) ctx = { playerId: "me", hostId: "me", standalone: true, locale: "en", options: defaults, players: [{ id: "me", name: "You", isHost: true, isYou: true }] };
  setLocale(ctx.locale);
  document.documentElement.lang = ctx.locale || "en";
  HUD.progress(0.15, t("loading"));

  const gfx = gfxNow();
  W.init($("view"), gfx);
  window.addEventListener("resize", () => W.resize());
  HUD.progress(0.4, t("loadSound"));

  // Settings and keys live in HopLobby's Esc menu.
  let prefs = null;
  if (HL && HL.menu) {
    try {
      prefs = await HL.menu.set({
        settings: [
          { key: "ring", label: { en: t("s_aimAssist"), "pt-PT": "Mostrar o anel de contacto" }, type: "toggle", default: true },
          { key: "swipe", label: { en: t("s_swipe"), "pt-PT": "Controlos de deslize" }, type: "range", min: 0.6, max: 1.6, step: 0.1, default: 1 },
          { key: "hudScale", label: { en: t("s_hudScale"), "pt-PT": "Tamanho do ecrã" }, type: "range", min: 0.8, max: 1.4, step: 0.05, default: 1 }
        ],
        controls: [
          { title: "Swing", keys: [{ keys: ["Space", "Enter"], action: "Drive (topspin)" }, { keys: ["Z", "X"], action: "Push (backspin)" }, { keys: ["C"], action: "Lob" }, { keys: ["Space", "Enter"], action: "Serve" }] },
          { title: "Aim", keys: [{ keys: ["←", "→"], action: "Direction" }, { keys: ["A", "D"], action: "Direction" }, { keys: ["↑", "↓"], action: "Depth" }, { keys: ["W", "S"], action: "Depth" }, { keys: ["Shift"], action: "Hard hit" }] }
        ],
        controlsNote: "You are moved to the ball for you. Time your swing to the ring: green is perfect. On a touchscreen: swipe up to hit, tap to push, swipe down to lob.",
        shared: ["graphics", "audio", "touch", "shake"]
      });
    } catch (err) { console.warn("menu.set", err); }
  }
  applyPrefs(prefs || (HL && HL.prefs) || {});
  if (HL) {
    HL.on("prefs", (p) => applyPrefs(p));
    HL.on("graphics", (g) => W.applyGraphics(g));
    HL.on("settings", (s) => applySettings(s));
    HL.on("pause", () => { state.paused = true; Input.enabled = false; });
    HL.on("resume", () => { state.paused = false; Input.enabled = !state.lastUi || state.lastUi.ph === "play"; });
    applySettings(HL.settings);
  }

  // The session
  const o = ctx.options || defaults;
  const net = makeNet(ctx);
  const S = state.S = new Session(net, { mode: o.mode || "singles", target: +o.points || 11, ai: o.ai || "rising" }, {
    onEvent, onUi,
    onSetup: (setup, fresh, n) => buildPeople(setup, fresh, n),
    // The round is over: HopLobby shows the results and runs the rematch (no play-again of our own).
    onRoundEnd: (entries) => { if (HL && HL.isHost && entries.length) { try { HL.endGame({ title: "Rally Hall", entries }); } catch (err) { console.warn("endGame", err); } } }
  });
  S.net = net;
  // The host's frame was reloaded mid-round: pick the hall back up from the other players instead of starting over.
  if (HL && ctx.joinedLate && net.isHost()) S.awaitResume();
  Input.init($("view"), $("swipe"), (intent) => { A.unlock(); S.swing(intent); });
  window.addEventListener("pointerdown", () => { A.unlock(); A.music("play"); }, { once: true });
  window.addEventListener("keydown", () => { A.unlock(); A.music("play"); }, { once: true });
  A.loadTracks();
  HUD.init({ advance: () => S.advance(), leave: () => { if (HL) HL.exit(); else location.reload(); } });
  if (HL) {
    HL.on("message", (d, from) => { try { S.onMessage(d, from); } catch (err) { console.warn("bad message from", from, err); } });
    HL.on("host", () => { if (HL.isHost) S.becameHost(); });
    HL.on("state", (st) => S.restore(st));
    HL.on("relay", (status) => { if (status === "open") S.hello(); });
    HL.on("options", (opts) => { if (HL.isHost && S.setup) { S.opts.mode = opts.mode || S.opts.mode; S.opts.target = +opts.points || S.opts.target; S.opts.ai = opts.ai || S.opts.ai; } });
    if (HL.syncState) HL.syncState(() => S.stateFor());
  }

  HUD.progress(0.8, t("loadChars"));
  // Every player's avatar, downloaded once before ready() (seats and tables reuse it). A slow one doesn't hold up
  // the round: after 10 s it keeps loading behind the table's own loading card.
  if (HL && !ctx.standalone) {
    const ids = (rosterPlayers() || []).map((p) => p.id);
    let done = 0;
    await Promise.race([
      Promise.all(ids.map((id) => loadAvatarBuffer(id).catch(() => null).then(() => HUD.progress(0.8 + 0.2 * (++done) / ids.length, t("loadChars"))))),
      new Promise((ok) => setTimeout(ok, 10000))
    ]);
  }
  W.render();
  HUD.progress(1);
  HUD.hideLoading();
  if (HL) HL.ready();
  if (!net.isHost()) S.hello();
  requestAnimationFrame((n) => { state.last = n; frame(n); });
}

function applyPrefs(p) {
  Object.assign(state.prefs, p || {});
  Input.sens = +state.prefs.swipe || 1;
  HUD.scale(+state.prefs.hudScale || 1);
}
function applySettings(s) {
  if (!s) return;
  const a = s.audio || {};
  A.setVolumes({ master: a.master ?? 0.8, music: a.music ?? 0.6, sfx: a.sfx ?? 0.75, muted: !!a.muted });
  W.noShake = s.shake === false || !!(HL && HL.device && HL.device.reducedMotion);
}

boot().catch((err) => { console.error(err); try { HUD.progress(0, String(err && err.message || err)); if (HL && HL.reportError) HL.reportError(err, "boot"); } catch (_) { /* nothing */ } });
void BASE_Z;
