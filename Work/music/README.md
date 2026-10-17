# Soundtrack (yours)

Drop MP3s (or OGG/M4A) in this folder and list them in `tracks.json`:

```json
{
  "menu": ["rooftop-menu.mp3"],
  "play": ["groove-1.mp3", "groove-2.mp3"],
  "results": ["win.mp3"]
}
```

- `menu` plays behind the menu, `play` during a game (a different play track each game, looping),
  `results` on the game-over card. Tracks fade in and out.
- Empty lists are fine: the game plays the city ambience and card sounds only.
- Volume follows HopLobby's Music setting and the in-game Music slider.
- Note the tool and licence of each track in `../../HANDOFF.md` (submission review asks).
