# Blender workflow

# Project Context: Post-Apo Isometric Grid RPG (Phaser 3 Migration)

## Overview
We are migrating an existing pure-JavaScript isometric post-apocalyptic turn-based RPG from Three.js (`Oldgame/`) to **Phaser 3 + TypeScript + Vite**. All graphics and audio in the original game are procedurally generated in code.

## Status: Amiga port paused (browser version first)
- The A1200 + PiStorm Lite 32 (miniGL) port is **paused**. Backup of that state: branch `backup/amiga-minigl` (commit `74ba0af`); notes in `docs/AMIGA_MINIGL.md`.
- Focus is the **browser version**. New code does not need to follow miniGL limits (textures <= 256 px, integer-only math, 50 Hz ticks, no FPU). Existing fixed-point code in `src/core/frontend/` and `src/core/campaign/region.ts` stays as is; don't rewrite it just to remove that.
- The `?profile=amiga` profile is kept but not maintained.

## Tech Stack & Environment
- **Language:** TypeScript (strict mode).
- **Engine:** Phaser 3 (WebGL/Canvas renderer, NO physics engine needed - pure grid logic).
- **Bundler:** Vite (`npm run dev` / `npm run build`).
- **Audio:** Pure Web Audio API synthesizer (`src/audio/SoundManager.ts`) migrated directly from `Oldgame/`.

## Architecture & Separation of Concerns (CRITICAL)
1. **`src/core/` (Pure Game Logic):**
   - Must contain ZERO Phaser, DOM, or Three.js dependencies.
   - Handles 2D grid coordinates (`gx, gy`), A* pathfinding, turn state machine (`EXPLORATION`, `PLAYER_TURN`, `ENEMY_TURN`, `DIALOGUE`, `INVENTORY`), Action Points (AP), combat math, loot tables, and Line of Sight (Bresenham).
2. **`src/audio/` (Procedural Sound):**
   - Encapsulate all Web Audio API sound synthesis extracted from `Oldgame/`. Expose clean methods (e.g., `playShoot()`, `playStep()`, `playClick()`).
3. **`src/scenes/` (Phaser 3 Rendering & UI):**
   - `WorldScene.ts`: Renders the isometric 2D grid, procedural pixel-art tiles/entities (using `Phaser.GameObjects.Graphics` and `generateTexture()`), path previews, and smooth tweens.
   - `UIScene.ts`: Runs in parallel to render HUD (AP counter, HP/Radiation bars, inventory, combat log, End Turn button).

## Isometric Projection & Pixel Art Rules
1. **Crisp Pixels:** `pixelArt: true`, `roundPixels: true`, base resolution `320x180` or `480x270`.
2. **Isometric Math:** Keep game logic in orthogonal grid coordinates `(gx, gy)`. Convert to screen coordinates only in the rendering layer:
   - `isoX = (gx - gy) * (tileWidth / 2)`
   - `isoY = (gx + gy) * (tileHeight / 2)`
   - Always sort sprite depth (`setDepth`) by `gx + gy` so entities render properly behind/in front of walls.
3. **Procedural Visuals:** Recreate the original Three.js procedural geometry/colors as crisp 2D isometric diamonds, blocks, and sprites via Phaser Graphics.

## Migration Rules (from `Oldgame/`)
- **Source Reference:** Read game rules, stats, combat formulas, map generators, and audio synthesis from `Oldgame/`.
- **Ignore 3D Overhead:** Discard all `THREE.Scene`, `THREE.Mesh`, cameras, and 3D lighting code.
- **Step-by-Step Execution:** Migrate one module at a time. Never rewrite the entire project in a single pass.

## Workflow & Token Economy
- **Do Not Read:** Never read `node_modules/`, `dist/`, or lockfiles unless explicitly asked.
- **Verification:** Run `npm run build` or `npx tsc --noEmit` after structural changes to ensure zero TypeScript errors.
