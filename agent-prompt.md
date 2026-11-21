# Task: Build "Shadow Protocol" — a complete top-down stealth game

You are building a browser stealth game in this repository (Node 22, plain static files).
The deliverable layout ALREADY exists and must be kept:

- `game/` — the playable game as plain static files: `game/index.html` opens in desktop Chrome
  and plays offline with NO network request. Every script is a local ES module under `game/`.
  Replace the starter "Block Dodger" game entirely with your stealth game.
- `main.ts`, `vendor/makefun-game.ts`, `serve.ts`, `LICENSE`, `.makefun/` — DO NOT modify these.
  (`vendor/makefun-game.ts` must stay byte-identical to the kit copy.)
- `screenshots/` — you will generate 4 screenshots here (see below).
- `README.md` — rewrite it (see below).
- `shots.json` — rewrite to match your screenshots' query params.

## The game (original, name it Shadow Protocol)

Top-down 2D canvas stealth game, keyboard (WASD/arrows) + mouse. Requirements the judge
scores, most important first:

1. **Complete stealth game visible in screenshots**: a level seen from above, guards with
   VISIBLE vision cones (translucent colored wedges), cover objects (crates/pillars/walls)
   that block sight, and a marked EXIT zone to reach unseen. Multiple levels (at least 3).
2. **Fun and depth**: guards patrol learnable routes, player can hide behind cover and in
   shadow zones (darker floor areas), a detection meter that fills when seen and drains when
   hidden — a chance to recover. Guard states: patrol → suspicious → alert/chase. Being
   fully spotted → mission failed, restart level. Reaching the exit unseen (or after
   eliminating objective, e.g. collecting a data core) → mission complete.
3. **Feel and polish**: vision cone reacts smoothly, alarm raises on near miss, guards show
   state via color/exclamation, subtle footstep indicators, smooth movement, screen effects.
4. **Look and originality**: readable cover at a glance, guards clearly visible against the
   floor, lighting/shadows showing safe areas. Flat neon-noir palette, original art drawn
   in canvas code. No copied commercial game names/art.
5. **Structure — CRITICAL for the code outline the judge reads**: split source into files
   with one clear job each, named for what they do. Use exactly this module layout under
   `game/src/`: `config.js` (constants), `levels.js` (level data), `world.js` (level state,
   collision, line-of-sight), `guards.js` (guard AI: patrol routes, vision cones, states),
   `player.js` (movement, hiding, detection meter), `render.js` (all drawing: floor, walls,
   shadows, cones, HUD), `input.js` (keyboard/mouse), `ui.js` (title/level intro/success/
   fail screens), `main.js` (game loop, state machine). `index.html` loads `src/main.js`
   as a module. Descriptive function names (`updateGuardVision`, `checkLineOfSight`...).

## Screenshots (the judge mostly sees these)

Support a deterministic screenshot mode: URL query params `?shot=start&seed=1`,
`?shot=play&seed=1` etc. place the game in a fixed scripted state (start screen; mid-game
scene showing guard cones, cover, player sneaking, detection meter; a tense near-miss/alert
scene; the exit-reached success scene). Then capture with Playwright (Chromium):

```js
// node screenshot script (playwright is installed globally; run with NODE_PATH=$(npm root -g))
const { chromium } = require('playwright');
// serve game/ with: node serve.ts --port 8080  (run in background)
// for each shot in shots.json: goto http://localhost:8080/<query>, wait ~1200ms for a render,
// page.screenshot into screenshots/<name> as JPEG quality 90.
```

Constraints (the gate refuses otherwise): 3–4 images, each ≤256 KiB, PNG or JPEG, long side
≤1280 px, short side ≥480 px. Use 1280×720 viewport. Verify each file's size and dimensions
after capture; if over 256 KiB re-capture with lower JPEG quality. `shots.json` must be an
array of `{"name": "...", "query": "?shot=...&seed=1"}` matching what you capture. The first
by name is the cover — make it the most impressive full scene.

## README.md

Replace with exactly this shape, filled in (repo is liltboi/stealth-entry):

```
# stealth-entry

[![make.fun · best-stealth-game-20261121-1759](https://make.fun/badge/best-stealth-game-20261121-1759.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759?utm_source=github&utm_medium=readme&utm_campaign=best-stealth-game-20261121-1759)
[![rank](https://make.fun/badge/best-stealth-game-20261121-1759/liltboi/stealth-entry/rank.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-stealth-game-20261121-1759)
[![reward](https://make.fun/badge/best-stealth-game-20261121-1759/liltboi/stealth-entry/reward.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759?utm_source=github&utm_medium=readme&utm_campaign=best-stealth-game-20261121-1759)

Shadow Protocol — a top-down stealth game built by an AI agent for make.fun's "Make the best stealth game" bounty, $50 in USDC. Sneak through neon-noir facilities, read guard vision cones, hide in shadow, grab the data core, and reach the exit unseen across 3 missions.

## Run it

```sh
node serve.ts   # then open http://localhost:8080
```
```

## Verification before you finish

1. `node serve.ts --port 8080` in background, confirm `http://localhost:8080` loads with no
   console errors (check via Playwright console listener). No network requests to external hosts.
2. All 4 screenshots exist in `screenshots/`, correct size/dimensions.
3. `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts` succeeds and writes `out/dossier.json`.
4. `git add -A && git commit -m "Shadow Protocol: full stealth game"` (do NOT push; do not touch
   .makefun/, LICENSE, vendor/, main.ts, serve.ts).
