// Sound. Music first: you supply the soundtrack (music/tracks.json: menu, play, results). Then a few
// quiet effects made in code: paddle tick, table tock, net thud, a soft chime for a point.
// No cartoon sounds. Volumes follow HopLobby's settings (master x music / sfx, muted).
export const A = { ctx: null, vol: { master: 0.8, music: 0.6, sfx: 0.75, muted: false }, tracks: { menu: [], play: [], results: [] }, buffers: {}, cur: null, curKey: "", idx: 0 };

A.unlock = function () {
  if (A.ctx) { if (A.ctx.state === "suspended") A.ctx.resume(); return; }
  const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
  A.ctx = new C();
  A.master = A.ctx.createGain(); A.master.connect(A.ctx.destination);
  A.musicGain = A.ctx.createGain(); A.musicGain.connect(A.master);
  A.sfxGain = A.ctx.createGain(); A.sfxGain.connect(A.master);
  const n = A.ctx.sampleRate;
  A.noise = A.ctx.createBuffer(1, n, n);
  const d = A.noise.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  A.apply();
};
A.setVolumes = function (v) { if (v) Object.assign(A.vol, v); A.apply(); };
A.apply = function () {
  if (!A.ctx) return;
  A.master.gain.value = A.vol.muted ? 0 : A.vol.master;
  A.musicGain.gain.value = A.vol.music;
  A.sfxGain.gain.value = A.vol.sfx;
};

A.loadTracks = function () {
  return fetch("music/tracks.json").then((r) => (r.ok ? r.json() : {})).then((j) => {
    ["menu", "play", "results"].forEach((k) => { A.tracks[k] = Array.isArray(j[k]) ? j[k].filter((x) => typeof x === "string") : []; });
  }).catch(() => { /* no music is fine */ });
};
function buffer(file) {
  if (!A.buffers[file]) {
    A.buffers[file] = fetch("music/" + file).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((b) => new Promise((ok, no) => A.ctx.decodeAudioData(b, ok, no))).catch(() => null);
  }
  return A.buffers[file];
}
// Play (loop) the next track of a slot, fading the old one out.
A.music = function (slot) {
  if (!A.ctx || A.curKey === slot) return;
  A.curKey = slot;
  const list = A.tracks[slot] || [];
  if (A.cur) { const old = A.cur; old.g.gain.cancelScheduledValues(0); old.g.gain.setTargetAtTime(0, A.ctx.currentTime, 0.4); setTimeout(() => { try { old.src.stop(); } catch (_) { /* done */ } }, 1800); A.cur = null; }
  if (!list.length) return;
  const file = list[(A.idx++) % list.length];
  buffer(file).then((buf) => {
    if (!buf || A.curKey !== slot) return;
    const src = A.ctx.createBufferSource(); src.buffer = buf; src.loop = slot !== "results";
    const g = A.ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(1, A.ctx.currentTime, 0.6);
    src.connect(g); g.connect(A.musicGain); src.start();
    A.cur = { src, g };
  });
};

function env(g, t0, peak, dur) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); }
function burst(t0, dur, peak, lo, hi) {
  const s = A.ctx.createBufferSource(); s.buffer = A.noise; s.loop = true;
  const f = A.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = (lo + hi) / 2; f.Q.value = 0.9;
  const g = A.ctx.createGain(); env(g, t0, peak, dur);
  s.connect(f); f.connect(g); g.connect(A.sfxGain); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
}
function tone(t0, f0, f1, dur, peak, type) {
  const o = A.ctx.createOscillator(); o.type = type || "sine"; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
  const g = A.ctx.createGain(); env(g, t0, peak, dur);
  o.connect(g); g.connect(A.sfxGain); o.start(t0); o.stop(t0 + dur + 0.02);
}
// Paddle on ball: a dry tick. power 0..1.
A.hit = function (power, perfect) {
  if (!A.ctx) return; const t = A.ctx.currentTime, p = 0.25 + 0.5 * (power || 0.5);
  burst(t, 0.05, p, 1800, 5200); tone(t, 1500 + (perfect ? 300 : 0), 900, 0.05, p * 0.5);
};
A.bounce = function (v) { if (!A.ctx) return; const t = A.ctx.currentTime, p = Math.min(0.5, 0.12 + (v || 4) * 0.03); tone(t, 620, 380, 0.045, p); burst(t, 0.025, p * 0.5, 2500, 6000); };
A.net = function () { if (!A.ctx) return; const t = A.ctx.currentTime; burst(t, 0.12, 0.3, 200, 900); tone(t, 180, 90, 0.1, 0.2); };
A.thud = function () { if (!A.ctx) return; const t = A.ctx.currentTime; tone(t, 150, 70, 0.08, 0.25); };
A.chime = function (good) {
  if (!A.ctx) return; const t = A.ctx.currentTime;
  if (good) { tone(t, 660, 660, 0.18, 0.18); tone(t + 0.09, 880, 880, 0.25, 0.18); } else { tone(t, 330, 300, 0.25, 0.14); }
};
