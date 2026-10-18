// The DOM on top of the canvas: score, banners, hints, the bracket and the result card.
import { t, reason } from "./strings.js";
import * as T from "./sim/tournament.js";
const $ = (id) => document.getElementById(id);

export const HUD = { timers: {} };

HUD.init = function (h) {
  HUD.h = h;      // { advance(), leave() }
  $("brGo").onclick = () => h.advance();
  $("resAgain").onclick = () => h.advance();
  $("resLeave").onclick = () => h.leave();
};

HUD.show = function (on) { $("hud").hidden = !on; };
HUD.progress = function (f, msg) { $("lfill").style.width = Math.round(f * 100) + "%"; if (msg) $("lmsg").textContent = msg; };
HUD.hideLoading = function () { $("loading").hidden = true; };

function flash(el, text, cls, ms) {
  el.textContent = text;
  el.className = el.className.split(" ")[0] + " on" + (cls ? " " + cls : "");
  clearTimeout(HUD.timers[el.id]);
  HUD.timers[el.id] = setTimeout(() => { el.className = el.className.split(" ")[0]; }, ms);
}
HUD.banner = (text, cls, ms) => flash($("banner"), text, cls, ms || 900);
HUD.toast = (text, ms) => flash($("toast"), text, "", ms || 2200);
HUD.hint = function (text) { const e = $("hint"); if (!text) { e.className = "hint"; return; } e.textContent = text; e.className = "hint on"; };
HUD.wait = function (text) { const e = $("wait"); e.hidden = !text; if (text) e.textContent = text; };
HUD.scale = function (s) { $("score").style.transform = "scale(" + s + ")"; $("score").style.transformOrigin = "left top"; };

// names: { p: "Ann & Bob", c: "Tasha" }, sc: [p, c], serverSide: "p"|"c", target, table: number
// shown when more than one table is in play (0 = don't show)
HUD.score = function (names, sc, serverSide, target, mySide, table) {
  $("nameP").textContent = names.p; $("nameC").textContent = names.c;
  $("valP").textContent = sc[0]; $("valC").textContent = sc[1];
  $("rowP").classList.toggle("serving", serverSide === "p"); $("rowC").classList.toggle("serving", serverSide === "c");
  const dz = sc[0] >= target - 1 && sc[1] >= target - 1;
  const gp = Math.max(sc[0], sc[1]) >= target - 1 && !dz;
  const info = dz ? t("deuce") : gp ? t("gamePoint") : t("firstTo", target);
  $("sinfo").textContent = table ? t("table", table) + "  ·  " + info : info;
  void mySide;
};

// ctx: { mySide, myId, tour, busy (tables still playing) }
HUD.overlays = function (ui, ctx) {
  const br = $("bracket"), rs = $("result");
  br.hidden = rs.hidden = true;
  if (!ui) return;
  if (ui.ph === "result") {
    const r = ui.res;
    $("resTitle").textContent = ctx.mySide ? (r.winner === ctx.mySide ? t("youWin") : t("youLose", r.w.join(" & "))) : t("won", r.w.join(" & "));
    $("resBody").innerHTML = "";
    const rowP = row(r.seats.filter((s) => s.seat[0] === "p").map((s) => s.name).join(" & "), r.sc[0], r.winner === "p");
    const rowC = row(r.seats.filter((s) => s.seat[0] === "c").map((s) => s.name).join(" & "), r.sc[1], r.winner === "c");
    $("resBody").append(rowP, rowC);
    $("resAgain").textContent = t("again"); $("resLeave").textContent = t("leave");
    $("resAgain").hidden = false;
    rs.hidden = false;
  } else if ((ui.ph === "bracket" || ui.ph === "done") && ctx.tour) {
    const tour = ctx.tour;
    $("brTitle").textContent = ui.ph === "done" && tour.champion ? t("champion", T.entrantName(tour, tour.champion)) : t("bracket");
    const grid = $("brGrid"); grid.innerHTML = "";
    const rounds = T.roundsOf(tour), names = t("round");
    grid.classList.toggle("big", rounds.length > 3);
    for (let r = 0; r < rounds.length; r++) {
      const col = document.createElement("div"); col.className = "bcol";
      const h = document.createElement("h3"); h.textContent = names[names.length - rounds.length + r].toUpperCase(); col.append(h);
      T.matches(tour, r).forEach((m) => {
        const box = document.createElement("div"); box.className = "bm" + (!m.res && m.a && m.b && r === tour.round && (m.a.human || m.b.human) ? " live" : "");
        [m.a, m.b].forEach((e, i) => {
          const l = document.createElement("div"); l.className = "bl";
          const won = m.res && e && m.res.w === e.id, lost = m.res && e && m.res.w !== e.id;
          if (won) l.classList.add("w"); if (lost) l.classList.add("l");
          if (e && e.id === ctx.myId) l.classList.add("me");
          const n = document.createElement("span"); n.textContent = e ? e.name : t("tbd");
          const s = document.createElement("span"); s.textContent = m.res ? (i === 0 ? m.res.sa : m.res.sb) : "";
          l.append(n, s); box.append(l);
        });
        col.append(box);
      });
      grid.append(col);
    }
    const mine = ui.res && ui.res.seats.some((s) => s.id === ctx.myId);
    const out = tour && T.eliminated(tour, ctx.myId) >= 0;
    const others = ui.ph === "bracket" && ctx.busy > 0;
    $("brNote").textContent = ui.ph === "done" ? (tour.champion === ctx.myId ? t("youChamp") : "") : others ? t("othersPlaying", ctx.busy) : (out ? t("eliminated") : mine ? "" : "");
    $("brGo").textContent = ui.ph === "done" ? t("again") : t("continue");
    $("brGo").hidden = others;
    br.hidden = false;
  }
};

function row(name, score, win) {
  const d = document.createElement("div"); d.className = "res-row" + (win ? " win" : "");
  const a = document.createElement("span"); a.textContent = name;
  const b = document.createElement("b"); b.textContent = score;
  d.append(a, b);
  return d;
}

HUD.pointBanner = function (e, mySide) {
  const mine = mySide ? e.winner === mySide : null;
  const txt = mine === null ? t("point", reason(e.reason)) : mine ? t("yourPoint") : t("theirPoint");
  HUD.banner(txt, mine === null ? "warm" : mine ? "good" : "bad", 1400);
  HUD.toast(reason(e.reason), 1800);
};
