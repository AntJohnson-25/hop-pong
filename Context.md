# Project Context: Hop Pong

## Outcome

Table tennis for HopLobby, 1v1 and 2v2 (doubles), third-person, phone and desktop. Inspired by the
user's pickleball game "King of the Dill" (`G:\ICM Workspace\01-Projects\pickleball`): same swipe/timing
feel, same pure-logic split (physics, shots, rules, ai), same tournament idea. Players are always their
own HopLobby avatars. Built on SDK 1.6.0 and the HopLobby rules; HopLobby builds and hosts the source.

## Current status (2026-10-17)

- Project folder created. Research done (docs read: platform-rules, sdk, multiplayer, packaging, avatars,
  assets-and-performance, content-policy, testing checklist). Nothing built yet.

## What carries over from pickleball (pure logic, no DOM; port and retune for table tennis)

`physics.js` (ball flight, drag, spin, bounce, net, prediction; 120 Hz fixed step), `shots.js` (swipe
intent -> launch velocity), `rules.js` (scoring state machine), `ai.js` (3 levels), `tournament.js`,
`input.js` (swipe -> intent), `tests.js` pattern. Do NOT copy: `chars.js` (Mixamo characters and
retargeting) or the Mixamo clip pipeline; the HopLobby avatar has its own 19-bone rig and no swing clips.

## Rules that shape the build (SDK 1.6.0, platform rules)

- Players = their HopLobby avatar (`HopLobby.avatar(id, {format:'glb'})`), no stand-in models. Bots/AI
  opponents may be our own characters. Paddle is our own item attached to the hand bone (allowed). The
  swing is posed procedurally on the avatar's arm bones (like the pickleball paddle swing; hop-spades
  `seats.js` has world-space arm IK that suits any rig). Avatar clips: idle walk run jump fall wave cheer
  shrug sit sit-table.
- Graphics presets are mandatory: read `HopLobby.graphics`, follow `on('graphics')` (pixelRatio cap,
  shadows, effects, particles, drawDistance, textureScale). Potato >= 30 fps on old integrated graphics.
  Never add our own quality setting; may step down on Auto, never above the player's pick.
- Settings go in HopLobby's Esc menu via `HopLobby.menu.set()` (+ key list, up to 4 buttons). No menu
  or settings screen of our own, no Esc key use. `pause`/`resume` stop this player's input.
- Match rules the host picks (points to 7/11/21, best of, serve rotation) = lobby options
  (`init({ lobbyOptions })` and `options` in hoplobby.json, kept identical).
- Keep ~60 px bottom-centre free; touch controls away from it.
- Net: relay only, host-authoritative. 120 Hz sim on host, state at 10-20/s, clients interpolate/predict
  the ball. Host leaves -> new host takes over from last state. `syncState`/`on('state')` for late join
  and reload. Use `HopLobby.now()` for serve timing. No cheating-proof scores: no leaderboard unless
  `server`-written; casual leaderboards from the game are OK but untrusted (decide later).
- No HopLobby logo in HUD, no HopLobby-style title lockup. Credits screen for any third-party asset.
  AI-generated assets disclosed in submission notes. User supplies music (build music slots, SFX minimal).
- Packaging: HopLobby builds our source. `hoplobby.json` with `build.output`, relative paths, everything
  bundled (three.js vendored, SDK from hoplobby.com or unchanged copy), package-lock.json if any npm
  deps, no dotfiles/server code, prefix localStorage keys with `hop-pong:`. Also needs a public https
  demo address (GitHub Pages like Hop Spades) and the source as public repo or zip.
- Budgets: ready() within a few seconds, < ~40 MB before ready, JS < ~5 MB, 60 fps mid laptop.
  Ask for avatars during load, before ready(). Phone/touch welcome.
- Locales en + pt-PT for HUD text.

## Design (defaults, not yet confirmed by the user)

- Game: table tennis, 1v1 and doubles (2v2, alternating hits). Lobby 1-4 players, empty seats = AI.
  Single-player vs AI works (HopLobby standalone and 1-player lobby).
- Camera: third person behind your end of the table, over the shoulder, like pickleball.
- Controls: same as pickleball: swipe/drag aims and powers, release on the timing ring (green = perfect);
  keyboard fallback. Spin choices (topspin/backspin/sidespin) replace pickleball's dink/lob/drop; serve
  rules per ITTF (ball bounces own side then opponent's; let = replay).
- Rules: ITTF-style, 11 points win by 2, serve changes every 2 points, deuce every 1. Lobby option for 7/11/21.
- Modes: Quick match, Tournament bracket (8 entrants) carried over from pickleball. In a lobby the
  tournament fills with the lobby's players + AI.
- Setting: a clubhouse/rec-room table; style of the pickleball park (stylised, friendly).

## Next action

Confirm the design defaults with the user (see open questions), then: scaffold `Work/` (index.html,
vendored three, SDK init/progress/ready, menu.set, graphics), port the pure logic + tests, build the
table, ball, paddle and an avatar test rig.

## Open questions

- Doubles and a lobby tournament: in scope for v1, or 1v1 + AI first?
- Setting/theme: keep the "park" look or a distinct rec-room / cartoon arcade?
- Music: the user adds tracks as before?
- Hosting: GitHub Pages demo repo like Hop Spades (`hop-pong-site`)?
