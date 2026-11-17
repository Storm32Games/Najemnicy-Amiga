# 

# Project Context: Post-Apo Isometric Grid RPG (Phaser 3 Migration)

## Overview

We are migrating an existing pure-JavaScript isometric post-apocalyptic turn-based RPG from Three.js (`Oldgame/`) to **Phaser 3 + TypeScript + Vite**. All graphics and audio in the original game are procedurally generated in code.

## Status: Amiga port active (browser version paused)

- The A1200 + PiStorm Lite 32 (miniGL) port is **active again** and is the focus. Earlier port work: branch `backup/amiga-minigl` (commit `74ba0af`); notes and hardware limits in `docs/AMIGA_MINIGL.md`.
- New code must follow the miniGL limits: textures power-of-two, max 256x256, no shaders, no render-to-texture; integer/fixed-point math only (Q12/Q8, no FPU); logic in 50 Hz ticks (`TickClock`); menus usable with joystick/keyboard. Follow the existing patterns in `src/core/frontend/` and `src/core/campaign/region.ts`.
- The `?profile=amiga` profile is maintained again; check changes with it.
- Full logic spec for the C99 port (rules, combat, AI, map generator, campaign, float -\> integer notes): `docs/AMIGA_PORT_SPEC.md`. Data tables and test vectors for the port: `node tools/amiga/export_data.ts` -\> `amiga/data/`; C headers: `node tools/amiga/gen_headers.ts` -\> `amiga/src/data/gamedata.{h,c}`; C test vectors: `node tools/amiga/gen_test_vectors.ts` -\> `amiga/tests/vectors_*.h`. All game logic is ported to C in `amiga/src/core/` and checked byte-for-byte against TS by trace tests (`node tools/amiga/trace_*.ts` regenerates references); status and test list: `docs/AMIGA_PORT_SPEC.md` sections 23-24, checked by `make -C amiga test` and `make -C amiga m68k` (m68k-amigaos-gcc in /opt/amiga/bin). Re-run both after any rules/data change.
- Screens (logo, intro, title menu, recruit, hub) are in `amiga/src/app/` on the `r2d` renderer; their backgrounds are baked from the real game (`node tools/amiga/bake_scenes.ts` -\> `python3 tools/amiga/pack_scenes.py` -\> `amiga/gfx/`), see `docs/AMIGA_PORT_SPEC.md` section 25. Write Polish strings in new screen files as UTF-8 and run `python3 tools/amiga/latin2_literals.py <file.c>` afterwards. Check screens on the Mac with `make -C amiga build/gl_host` (screenshots) and the Amiga build with `make -C amiga amiga-app`.
- The **browser version is paused**: no new browser-only features or browser-specific polish. Keep it building (`npm run build`), since it is the reference the port is written against.

## Tech Stack \& Environment

- **Language:** TypeScript (strict mode).
- **Engine:** Phaser 3 (WebGL/Canvas renderer, NO physics engine needed - pure grid logic).
- **Bundler:** Vite (`npm run dev` / `npm run build`).
- **Audio:** Pure Web Audio API synthesizer (`src/audio/SoundManager.ts`) migrated directly from `Oldgame/`.

## Architecture \& Separation of Concerns (CRITICAL)

1. **`src/core/`** **(Pure Game Logic):**
    - Must contain ZERO Phaser, DOM, or Three.js dependencies.
    - Handles 2D grid coordinates (`gx, gy`), A\* pathfinding, turn state machine (`EXPLORATION`, `PLAYER_TURN`, `ENEMY_TURN`, `DIALOGUE`, `INVENTORY`), Action Points (AP), combat math, loot tables, and Line of Sight (Bresenham).
2. **`src/audio/`** **(Procedural Sound):**
    - Encapsulate all Web Audio API sound synthesis extracted from `Oldgame/`. Expose clean methods (e.g., `playShoot()`, `playStep()`, `playClick()`).
3. **`src/scenes/`** **(Phaser 3 Rendering \& UI):**
    - `WorldScene.ts`: Renders the isometric 2D grid, procedural pixel-art tiles/entities (using `Phaser.GameObjects.Graphics` and `generateTexture()`), path previews, and smooth tweens.
    - `UIScene.ts`: Runs in parallel to render HUD (AP counter, HP/Radiation bars, inventory, combat log, End Turn button).

## Isometric Projection \& Pixel Art Rules

1. **Crisp Pixels:** `pixelArt: true`, `roundPixels: true`. Scene coordinates use the `480x270` design grid (`BASE_W x BASE_H`).
    - **Default resolution: 1920x1080** (Full HD = design grid x4). Scaling goes both ways from it: down to **HD 1280x720** and **640x480**, up to **QHD 2560x1440** and **4K 3840x2160**. These five presets are the resolution choices in Options (`RES_PRESETS` in `src/scenes/ui/Settings.ts`; URL `?res=640x480|hd|fhd|qhd|4k`).
    - The canvas is the preset size; `ZOOM = min(canvasW / 480, canvasH / 270)` and can be fractional (HD 2.67, QHD 5.33). Non-16:9 presets (640x480) are letterboxed: cameras get a centered `480x270 * ZOOM` viewport (`fitViewport` / `VX, VY, VW, VH` in `Kit.ts`). Never assume canvas size = `BASE * ZOOM` or that `ZOOM` is an integer; use `CANVAS_W/H` for full-canvas layers.
2. **Isometric Math:** Keep game logic in orthogonal grid coordinates `(gx, gy)`. Convert to screen coordinates only in the rendering layer:
    - `isoX = (gx - gy) * (tileWidth / 2)`
    - `isoY = (gx + gy) * (tileHeight / 2)`
    - Always sort sprite depth (`setDepth`) by `gx + gy` so entities render properly behind/in front of walls.
3. **Procedural Visuals:** Recreate the original Three.js procedural geometry/colors as crisp 2D isometric diamonds, blocks, and sprites via Phaser Graphics.

## Migration Rules (from `Oldgame/`)

- **`Oldgame/`** **was removed from the repo (2026-11-16).** The last commit that contains it is `58aaef7`; read a file from history with `git show 58aaef7:Oldgame/<path>` (fetch that commit first in a shallow clone). Comments in `src/` and `tests/` that cite `Oldgame/...` paths refer to that state.
- **Source Reference:** Read game rules, stats, combat formulas, map generators, and audio synthesis from `Oldgame/` (in history, see above).
- **Ignore 3D Overhead:** Discard all `THREE.Scene`, `THREE.Mesh`, cameras, and 3D lighting code.
- **Step-by-Step Execution:** Migrate one module at a time. Never rewrite the entire project in a single pass.

## Workflow \& Token Economy

- **Do Not Read:** Never read `node_modules/`, `dist/`, or lockfiles unless explicitly asked.
- **Verification:** Run `npm run build` or `npx tsc --noEmit` after structural changes to ensure zero TypeScript errors.

## Session Start: Unmerged Work From Other Chats

Every cloud chat starts from a fresh clone of `main` on its own `ccr-*` branch, so work from earlier chats is invisible until merged.

- **At the start of each session**, run `git fetch origin` and list remote branches with commits not in `main` (`git log --oneline origin/main..origin/<branch>` for each `origin/ccr-*` and other feature branches; skip `backup/*`).
- If any exist, show the user each branch with its commit subjects and **ask whether to merge them into the current branch before starting work**. Do not merge without the user's answer.
- At the end of a chat, remind the user to merge the open PR so the next chat sees the changes.

## Pull Requests: Create Automatically

The user wants a PR to `main` after every pushed change, without being asked (standing permission).

- After each commit + push to the session's `ccr-*` branch, check whether that branch has an **open** PR to `main`. If it does, the new commits are already in it (update its title/description if the scope changed). If not (none yet, or the previous one was merged/closed), **create a new PR** right away.
- Before creating, run `git log --oneline origin/main..HEAD` so the PR describes only commits not yet in `main`. If the branch's previous PR was merged, fast-forward the branch to `origin/main` first (`git merge --ff-only origin/main`) when it has no unmerged commits.
- PR description in Polish: sections **Zmiany** and **Testy** (what was run: `tsc`, `build`, Playwright checks), plus any limitations.
- Give the user the PR link in the reply. Do not merge PRs yourself.
