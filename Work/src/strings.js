// All player-facing text, English and European Portuguese (HopLobby locales).
const S = {
  en: {
    loading: "Setting up the table…", loadChars: "Meeting the players…", loadSound: "Tuning the room…",
    you: "You", partner: "Partner", cpu: "CPU",
    serveHint: "Swipe up to serve  ·  tap for a short one", serveHintKey: "Space to serve  ·  ← → aim  ·  ↑ ↓ depth",
    rallyHint: "Swipe up as the ring closes", rallyHintKey: "Space as the ring closes  ·  Z push  ·  C lob",
    spectate: "Watching", waitTurn: "Next up: you play after this game", waitPlayers: "Waiting for players…",
    perfect: "PERFECT!", good: "GOOD", late: "LATE", early: "EARLY", miss: "MISS", let: "LET — serve again",
    point: "Point: {0}", yourPoint: "Your point", theirPoint: "Their point", deuce: "Deuce",
    gamePoint: "Game point", server: "serving", firstTo: "First to {0}",
    reasons: {
      "missed the table": "Long or wide", "own half": "Short — on their own side", "two bounces": "Two bounces", "net": "Into the net",
      "missed": "Missed it", "bad serve": "Bad serve", "wrong half": "Serve to the wrong half", "volley": "Volley", "out of turn": "Out of turn", "timeout": "Rally timed out"
    },
    won: "{0} wins!", youWin: "You win!", youLose: "{0} win", gameOver: "Game over",
    again: "Play again", leave: "Leave table", next: "Next match", continue: "Continue",
    bracket: "Tournament", champion: "Champion: {0}", youChamp: "You are the champion!", eliminated: "You are out. The bracket plays on.",
    round: ["Quarterfinal", "Semifinal", "Final"], tbd: "TBD", vs: "vs",
    nextUp: "Next: {0} vs {1}", yourMatch: "Your match", watching: "Watching {0} vs {1}",
    s_mode: "Mode", s_singles: "Singles", s_doubles: "Doubles (2 v 2)", s_tournament: "Tournament (8 players)",
    s_points: "Game to", s_ai: "Computer skill", s_easy: "Easy", s_medium: "Medium", s_hard: "Hard", s_rising: "Rising",
    s_swipe: "Swipe controls", s_aimAssist: "Show landing ring", s_hudScale: "HUD size", s_leftHand: "Left-handed paddle",
    c_swing: "Swing", c_serve: "Serve", c_aim: "Aim", c_depth: "Depth", c_push: "Push (backspin)", c_lob: "Lob", c_power: "Hard hit",
    c_move: "Move", c_move2: "automatic",
    ctlNote: "You are moved to the ball for you. Time your swing to the ring: green is perfect.",
    cpuN: "CPU {0}"
  },
  "pt-PT": {
    loading: "A preparar a mesa…", loadChars: "A conhecer os jogadores…", loadSound: "A afinar a sala…",
    you: "Tu", partner: "Parceiro", cpu: "CPU",
    serveHint: "Desliza para cima para servir  ·  toca para um serviço curto", serveHintKey: "Espaço para servir  ·  ← → direção  ·  ↑ ↓ profundidade",
    rallyHint: "Desliza para cima quando o anel fechar", rallyHintKey: "Espaço quando o anel fechar  ·  Z corte  ·  C balão",
    spectate: "A assistir", waitTurn: "A seguir: jogas depois deste jogo", waitPlayers: "À espera de jogadores…",
    perfect: "PERFEITO!", good: "BOM", late: "TARDE", early: "CEDO", miss: "FALHOU", let: "LET — repetir serviço",
    point: "Ponto: {0}", yourPoint: "Ponto teu", theirPoint: "Ponto deles", deuce: "Empate",
    gamePoint: "Ponto de jogo", server: "serve", firstTo: "O primeiro a {0}",
    reasons: {
      "missed the table": "Longo ou largo", "own half": "Curto — no próprio lado", "two bounces": "Dois ressaltos", "net": "Na rede",
      "missed": "Falhou", "bad serve": "Mau serviço", "wrong half": "Serviço para o lado errado", "volley": "Volley", "out of turn": "Fora de vez", "timeout": "Ponto demasiado longo"
    },
    won: "{0} ganha!", youWin: "Ganhaste!", youLose: "{0} ganham", gameOver: "Fim do jogo",
    again: "Jogar outra vez", leave: "Sair da mesa", next: "Próximo jogo", continue: "Continuar",
    bracket: "Torneio", champion: "Campeão: {0}", youChamp: "És o campeão!", eliminated: "Estás fora. O quadro continua.",
    round: ["Quartos de final", "Meias-finais", "Final"], tbd: "A definir", vs: "vs",
    nextUp: "A seguir: {0} vs {1}", yourMatch: "O teu jogo", watching: "A ver {0} vs {1}",
    s_mode: "Modo", s_singles: "Singulares", s_doubles: "Pares (2 v 2)", s_tournament: "Torneio (8 jogadores)",
    s_points: "Jogo até", s_ai: "Nível do computador", s_easy: "Fácil", s_medium: "Médio", s_hard: "Difícil", s_rising: "A subir",
    s_swipe: "Controlos de deslize", s_aimAssist: "Mostrar o anel de contacto", s_hudScale: "Tamanho do ecrã", s_leftHand: "Raquete na mão esquerda",
    c_swing: "Remate", c_serve: "Serviço", c_aim: "Direção", c_depth: "Profundidade", c_push: "Corte (efeito atrás)", c_lob: "Balão", c_power: "Remate forte",
    c_move: "Mover", c_move2: "automático",
    ctlNote: "Tu és movido até à bola. Faz o remate com o anel: verde é perfeito.",
    cpuN: "CPU {0}"
  }
};
let loc = "en";
export function setLocale(l) { loc = S[l] ? l : "en"; }
export function t(key, ...args) {
  let v = (S[loc] && S[loc][key] !== undefined) ? S[loc][key] : S.en[key];
  if (typeof v !== "string") return v === undefined ? key : v;
  args.forEach((a, i) => { v = v.replace("{" + i + "}", a); });
  return v;
}
export function reason(r) { const m = (S[loc].reasons || S.en.reasons); return m[r] || S.en.reasons[r] || r; }
