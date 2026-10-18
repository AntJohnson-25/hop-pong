# Hop Pong: submission package

| File | What it is |
|---|---|
| `submission.json` | Arguments for the HopLobby MCP `prepare_submission` call. **Edit this.** Drop its `_comment` key before sending. |
| `listing.md` | Every form field as readable text. Generated: `node tools/make-listing.js` from the repo root's Submission folder. |
| `screenshots/` | Three 1920x1080 shots with no HUD (singles, doubles, tournament). `Work/cover.jpg` is the singles one (16:9). |
| `../hoplobby.json` | The manifest at the source root: players 1-16, late join, 3 lobby options, `build.output "Work"`, no build command. Passed `validate_manifest`. |
| `../HANDOFF.md` | Credits and licences (three.js MIT, own code, own bot models, no music). |

## Before pressing Submit (in order)

1. Demo address live: https://antjohnson-25.github.io/hop-pong/ (GitHub Pages from the `gh-pages` branch, a copy of `Work/`).
   To update it after a change: re-copy `Work/` into a clean temp repo, add `.nojekyll`, force-push to `gh-pages`.
2. Dev Mode test from that address (`prepare_dev_mode` with the Pages URL), ideally with Potato and Ultra.
3. `prepare_submission` with `submission.json` saves a DRAFT on the portal.
4. On the portal: check every field, tick the 10 confirmations, press Submit.

## The 10 confirmations

1. Rights to all code, art, audio, music: yes (see `HANDOFF.md`).
2. Uses the SDK (1.6.0), waits for `init()`, works in the frame: yes.
3. Full source, public GitHub repo, builds what the demo runs: yes (no build step, `Work/` is the output).
4. Players are their HopLobby avatars: yes (bots only fill empty seats).
5. Anything that matters is checked by the host, not trusted from a browser: yes; no scores, rewards, saves or store.
6. No ads, trackers, outside sign-ins/payments, personal data: none.
7. Content policy: table tennis, no gambling or money.
8. Performance budgets: 5.1 MB total, 0.9 MB JS. Frame rate with 16 players not measured on a weak laptop.
9. Graphics presets: follows `HopLobby.graphics`; Potato still unverified live.
10. Agree HopLobby may review, list and embed it.

## Not verified live yet

Potato and Ultra in a real lobby, Esc menu Back to lobby / End game, a second launch starting fresh, frame rate with a full hall.
