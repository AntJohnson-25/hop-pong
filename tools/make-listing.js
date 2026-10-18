const fs = require("fs");
const j = JSON.parse(fs.readFileSync("submission.json", "utf8"));
const out = `# Hop Pong: HopLobby listing (draft, edit submission.json then re-run tools/make-listing.js)

Generated from submission.json so the two never drift. Portal limits in brackets.

## Title (2-60)

${j.title}

## Game id (3-24, permanent once used)

${j.gameId}

## Tagline (max 120, ${j.tagline.length} used)

${j.tagline}

## Genre

${j.genre}

## Players

Min ${j.minPlayers}, max ${j.maxPlayers}. Late join: ${j.lateJoin ? "yes" : "no"}.

## Demo address

${j.demoUrl}

## Source

${j.sourceRepo} (hoplobby.json at the root, build.output "Work", no build command)

## Description (40-4000, ${j.description.length} used)

${j.description}

## Contact (optional, max 60)

${j.contact || "(blank)"}

## Notes for the reviewer (max 1000, ${j.notes.length} used)

${j.notes}
`;
fs.writeFileSync("listing.md", out);
console.log("listing.md written");