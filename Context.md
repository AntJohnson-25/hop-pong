# Project Context: Hop Pong

## Outcome

Table tennis for HopLobby, 1v1 and 2v2 (doubles), third-person, phone and desktop. Inspired by the
user's pickleball game "King of the Dill" (`G:\ICM Workspace\01-Projects\pickleball`): same swipe/timing
feel, same pure-logic split (physics, shots, rules, ai), same tournament idea. Players are always their
own HopLobby avatars. Built on SDK 1.6.0 and the HopLobby rules; HopLobby builds and hosts the source.

## Current status (2026-10-17, end of session 1)

User chose scope: **1v1 tournament + doubles** (tournament is singles only). Built and committed (git main):
- `Work/src/sim/` pure logic, all tested: physics, shots (solver + legal serves), rules (singles + doubles
  rotation, hit order, deuce), ai (3 levels, Hard beats Easy 38/40), match (swing timing with late window,
  grace for network, restore/convertToAI/convertToHuman), tournament (8-entrant bracket).
- `Work/src/game.js` Session: host-authoritative, snapshots 20 Hz, swings stamped in sim time, queue/rotation
  for >4 humans, late joiner takes a computer seat, host hand-over, tournament flow.
- Client: world.js (rec room, graphics presets), people.js (HopLobby avatars / our cast, procedural paddle
  swing by IK), input (swipe/keys), hud, audio (synth + music slots), strings (en, pt-PT), main.js (SDK wiring,
  menu.set, lobby options).
- Tests: `node tools/tests.js` (36), `tools/sim-test.js` (AI balance), `tools/net-test.js` (21, fake relay with
  loss/latency, host leaves, tournament). Node = G:\ICM Workspace\tools\node\node.exe.
- Seen in headless Edge (serve: py313 tools\serve.py 8795, `tools\edge.ps1`): singles, doubles, bracket
  overlay, phone portrait, contact ring, GOOD/PERFECT banners. Shots in Notes/shots (git-ignored).
  URL hooks: `?auto=1` computer plays your side, `?g=potato`, `?mode=doubles|tournament`, `?points=7`.
- hoplobby.json validated (players 1-8, lateJoin, 3 options; keep identical to LOBBY_OPTIONS in main.js).

Session 2 (2026-10-17): **full lobby (16)**. maxPlayers 16. The hall has 8 tables (2 rows x 4,
`TABLES` in world.js); game.js Session runs one Match per table on the host, one combined snapshot
(`k:"st", tb:[...]`) at 20 Hz and a `k:"hall"` full state (all tables + tour) — biggest message
measured < 16 KB with 16 players. Everyone plays at once: singles 2 per table, doubles 4, the
computer fills seats; joiners take a computer seat (next to a human first) or open a free table; a
casual table with no humans closes. Tournament draws 16 when >8 humans (round of 16 added), all
live matches of a round at once, bracket waits for the other tables. Focus = your table, else a
watched/live one (camera glides there). HopLobby badge (brand-kit paths, as in Hop Spades) on
each table half + barrier boards + big screen. Room rebuilt as a sports hall: instanced tables
(bevelled top, folding frame, castors), court mats, ITTF boards, umpire desks with live flip
scoreboards, pilasters, night windows, trusses, light fixtures, ducts, raked stands with seats and
a crowd (W.detail: hidden on potato/low). Other tables' players skip arm IK on potato/low.
Tests: tests.js 40, net-test.js 37 (adds 16 singles/doubles/tournament). Shots: Notes/shots/hall-*.png.
Not yet: real-lobby test with 16, frame rate on the user's UHD 600 with 8 tables of avatars.

Session 3 (2026-10-18): real Dev Mode lobby with a 2nd player over a cloudflared tunnel, doubles vs computer
partners: worked. Scoreboard digit fix (world.js, tent faces meet at the ridge). Relay hardening (game.js:
result card only for seated players, `hi` throttled; main.js try/catch; net-test.js test 9 = junk + forged
messages, 46 checks). Pushed to https://github.com/AntJohnson-25/hop-pong (main). Submission package done:
`hoplobby.json` now at the REPO ROOT (build.output "Work"), HANDOFF.md (licences), Work/cover.jpg,
Submission/ (submission.json, listing.md via tools/make-listing.js, screenshots, README.md).
NOT done / not seen: demo host (GitHub Pages from a `gh-pages` copy of Work/, https://antjohnson-25.github.io/hop-pong/),
Potato/Ultra + Esc menu Back to lobby / End game checked live, 16-player frame rate on the UHD 600, hand feel
of swipes on a phone, backhand (always forehand pose), music (user supplies), the draft + Submit.
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

**2026-10-22: second review = changes requested. Paused by the user; nothing started.** Open items (submission
010a9278-8d54-4da3-8f7f-8a1bfa4d77c4):

Must fix
1. Host reload catch-up trusts any player: `hallc` is applied wholesale, so a player can send finished tables with
   made-up results and the host reports them via endGame. Take options from ctx.options, accept only roster ids,
   only tables in 'play' (drop res/done), type-check and clamp scores below the target; ideally wait for two
   matching replies.
2. The rematch branch in advance() for ph 'result' (game.js:276-286) is still reachable via 'adv': it restarts a
   table without endGame and holds off the round's end. Remove it: result cards are final.

Should fix
3. noteLeavers opens a table for a late joiner after the round has ended (game.js:368-371). Skip that once
   roundEnded is set.
4. Remove window.HP and ?auto from the build.

Then push main + gh-pages and prepare_submission with the submissionId (the user presses Submit).

Older plan: Dev Mode test with the user (prepare_dev_mode, serve Work on 127.0.0.1), then fix what real avatars/phones show; then credits/HANDOFF, cover, listing, demo repo, submission. (Old plan: scaffold `Work/` (index.html,
vendored three, SDK init/progress/ready, menu.set, graphics), port the pure logic + tests, build the
table, ball, paddle and an avatar test rig.

## Open questions

- Doubles and a lobby tournament: in scope for v1, or 1v1 + AI first?
- Setting/theme: keep the "park" look or a distinct rec-room / cartoon arcade?
- Music: the user adds tracks as before?
- Hosting: GitHub Pages demo repo like Hop Spades (`hop-pong-site`)?
