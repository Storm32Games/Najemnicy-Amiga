# PYŁ I RDZA — Najemnicy  (design + module contracts)

Browser RPG, post-apocalyptic, Pathfinder 2e (Remaster) rules adapted (no magic: tech, chems, cybernetics).
Three.js (r170, `vendor/three.module.min.js`), plain ES modules, NO build step, NO image/audio files:
every graphic is drawn in code (canvas → `THREE.CanvasTexture` with `NearestFilter`, or geometry),
every sound is synthesized with WebAudio. All player-facing text in **Polish**.
Studio logo at boot: **STORM 32**.

## World
Earth after a global nuclear war. Surviving technology is rare and precious. The cities are ruins full
of mutated fauna and **Szabrownicy** (raiders: degenerate, brutal gangs — the main obstacle in the ruins).
On the wastelands live the **Nomadzi** (hardened wanderers & traders; survive thanks to knowing the wastes).
Other survivors try to rebuild life in the city: the settlement **Przystań** (built in an old train depot
in the ruined metropolis **Nowa Huta-7**... name freely: the city is "Martwe Miasto" / ruins = "Rdzawisko").
Player = a 4-person crew of **Najemnicy** (mercenaries) operating from Przystań, taking **zlecenia**
(contracts) for rewards (Złom = currency, gear, reputation). Main arc: the raider warlord **Kostucha**
(boss of gang "Żelazne Szczęki") terrorises the region; 3 story contracts unlock as reputation grows;
killing her = victory screen. Side contracts are generated (repeatable).

## Visual style
"HD-2D pixel art": scenes are composed on a **640×360 design grid** (`W, H` / `Engine.W/H`) and rendered at a
selectable resolution (Opcje → Rozdzielczość): Klasyczna 640×360 (thick pixels, the old look), HD 1280×720,
HD+ 1600×900, Full HD 1920×1080, QHD 2560×1440, 4K 3840×2160, or **Automatyczna** (default: the largest of HD…QHD
whose height fits the physical pixel height of the game area, re-evaluated on window resize/fullscreen).
Above 640×360 the 3D geometry/lighting is crisp while pixel-art textures and sprites (NearestFilter) are simply
magnified; the post pass scales its pixel effects (bloom radius, dither cell, scanlines, grain) with the resolution.
The canvas is CSS-scaled with nearest-neighbour when the magnification is ≥1.9× or integer, smoothly otherwise.
3D low-poly geometry with pixel textures, billboard pixel sprites for characters,
fog, warm dusty light, toxic green accents, rust/amber palette. UI = DOM overlay (`#ui`) with
chunky pixel panels (CSS in index.html: `.panel`, `.btn`, `.btn.primary`, `.btn.danger`, colors
`--amber --rust --toxic --blood --steel --good --bad --dim`). Use `em` units in UI.

## Directory / ownership
| path | owner |
|---|---|
| `index.html`, `src/main.js`, `src/core/*` | lead (do not edit; ask in your report if you need a change) |
| `src/rules/*` | Agent RULES |
| `src/gfx/*` | Agent GFX |
| `src/audio/*` | Agent AUDIO |
| `src/scenes/{logo,intro,title,recruit,hub,worldmap,debrief,gameover,victory}.js`, `src/data/*` | Agent META |
| `src/scenes/mission.js`, `src/mission/*` | Agent MISSION |

Other modules are written **in parallel**. Code strictly against the contracts below. Each module
starts as a working stub, so the game runs at all times. Never change another agent's files.
Import paths are relative (e.g. from `src/scenes/x.js`: `import { THREE } from '../core/engine.js'`).
Always import THREE via `src/core/engine.js` (`export { THREE }`) or `vendor/three.module.min.js` – the same module.

## Core API (lead)
```js
import { Engine, THREE, W, H } from '../core/engine.js';
Engine.renderer           // THREE.WebGLRenderer, pixelRatio = Engine.pixelScale, size W×H design px (shadows: BasicShadowMap)
Engine.render(scene, cam) // renders through the post pipeline (gfx/post.js); scales shadow maps of the scene's lights
Engine.pixelScale         // render px per design px (1, 2, 2.5, 3, 4, 6); Engine.RW/RH = real render size
Engine.px(n)              // design px -> render px
Engine.onResize(cb)       // cb({width, height, scale, preset}) after a resolution change; returns unsubscribe
Engine.setResolution(id|'auto'), RES_PRESETS, Engine.preset, Engine.resMode
Engine.typing(ev)         // true while a text input has focus (scene onKey is NOT called then)
// Resolution rules for scene code: THREE.Points sizes (sizeAttenuation:false) and getSize()/viewports are in
// design px automatically (pixelRatio). GL lines are always 1 real px -> use thin meshes for visible lines.
// DOM sizes must be em/% (never fixed px tied to 640×360). Shadow map sizes: give the 640×360 value (e.g. 1024);
// Engine.render multiplies it (×2 HD, ×3 FHD, ×4 QHD, max 4096).

import { Settings } from '../core/settings.js';
Settings.open() -> Promise (resolved on close)  // options modal: resolution, fullscreen, UI size, retro effects
                                                 // (scanlines/grain/dither), audio volumes; localStorage
                                                 // 'pyl-i-rdza-settings-v1' (separate from the save); `?res=fhd` URL override
Engine.pointerNDC(ev)     // THREE.Vector2 NDC
Engine.canvas

import { UI } from '../core/ui.js';
UI.root, UI.clear(), UI.el(tag, props, ...children), UI.add(node, parent?), UI.panel(posCss, ...children)
UI.button(label, onClick, {class, title, disabled}), UI.toast(msg), await UI.modal({title, body, buttons:[{label,value,class}]})
UI.tooltip(el, htmlOrFn), UI.pixCanvas(canvas, cssWidth)

import { Game } from '../core/game.js';
Game.goto(sceneName, params)   // exits current scene, clears UI overlay, enters next
Game.state                     // campaign state (below); Game.save(), Game.load(), Game.hasSave(), Game.newGame()
Game.quickParty()              // dev: 4 premade characters + contract board
```
### Scene object contract
Each scene file `export default { ... }` an object with optional members:
`enter(params)`, `exit()`, `update(dt, time)`, `scene` (THREE.Scene) + `camera` (rendered automatically
each frame via Engine.render) or `render(Engine)` for custom rendering, and input handlers
`onPointerDown(ev, ndc)`, `onPointerMove(ev, ndc)`, `onPointerUp(ev, ndc)`, `onWheel(ev, ndc)`, `onKey(ev)`
(dispatched from the canvas; DOM UI buttons handle their own events). `exit()` must dispose/stop
timers. UI overlay is cleared automatically on scene change.
Dev shortcut: `index.html?scene=<name>&k=v` skips to a scene with a quick party (params passed to enter).

### Game.state
```js
{ version:1, party:[Character x<=4], scrap:120, day:1, rep:{nomads:0, survivors:0},
  stash:[ItemInstance], contracts:[Contract], completed:[contractId], story:0, flags:{}, log:[] }
```

## RULES API — `src/rules/index.js` (pure JS, no DOM/THREE; must also run in Node)
Data + functions, all exported by name from `src/rules/index.js`:
```js
// dice
makeRng(seed?) -> () => float [0,1)        // seeded mulberry32; default Math.random
d(sides, rng?) -> int                        // 1..sides
roll(expr, rng?) -> {total, rolls:[int], expr, mod}   // "2d6+3", "1d8", "1d4-1"
// checks — degrees: 0 krytyczna porażka, 1 porażka, 2 sukces, 3 krytyczny sukces
check(mod, dc, rng?) -> {d20, mod, total, dc, degree, nat20, nat1}   // ±10 rule + nat20/nat1 step
DEGREE_NAMES[degree] -> 'Krytyczny sukces' ...
dcForLevel(level) -> PF2e level-based DC table (lvl0:14, 1:15, 2:16, 3:18 ...)
PROF_NAMES = ['Nieszkolony','Wyszkolony','Ekspert','Mistrz','Legenda']; profBonus(rank, level)  // 0 | 2/4/6/8+level

// content (objects keyed by id; every entry has Polish `name` and `desc`)
ATTRS = ['str','dex','con','int','wis','cha'], ATTR_NAMES {str:'Siła',dex:'Zręczność',con:'Kondycja',int:'Inteligencja',wis:'Mądrość',cha:'Charyzma'}
SKILLS {athletics:{name:'Atletyka',attr:'str'}, acrobatics, stealth, thievery, crafting(Technika), medicine, survival, perception?, intimidation, diplomacy, society?, nature(Natura) ...}
ANCESTRIES {id:{name, desc, hp, attrBoosts, attrFlaw?, speed, traits, look hints}} // >=4: human (Człowiek), mutant (Mutant), cyborg (Cyborg), nomad-born (Dziecko Pustkowi)...
CLASSES {id:{name, desc, role, keyAttr, hpPerLevel, prof:{...}, startGear:[itemIds], abilities:[abilityIds], color:'#hex'}}
   // >=6: soldier(Żołnierz~Fighter), scout(Zwiadowca~Ranger), medic(Medyk), techie(Technik~Inventor), scavenger(Szczur~Rogue), brute(Brutal~Barbarian)
ITEMS {id:{id,name,desc,type:'weapon'|'armor'|'shield'|'consumable'|'junk'|'tech'|'ammo', price, level, icon:'pistol'|'rifle'|...,
       weapon?:{damage:'1d8', dmgType:'P'|'S'|'B'|'fire'|'acid'|'elec', range:0|squares, category:'simple'|'martial'|'advanced', hands:1|2, traits:[], ammo?, group, sfx:'shot_pistol'|...},
       armor?:{ac, dexCap, checkPenalty, speedPenalty, category:'light'|'medium'|'heavy'},
       consumable?:{effect:'heal'|'buff'|'damage'|..., amount:'2d8+5', actions, target:'self'|'ally'|'enemy'|'area', range, radius}}}
ABILITIES {id:{id,name,desc, actions:1|2|3|0(free)|'reaction', target:'enemy'|'ally'|'self'|'area'|'none', range:squares(1=melee),
       radius?, uses?:'encounter'|'day'|null, icon:string, fx:'shot'|'melee'|'heal'|'explosion'|'buff'|'shout',
       resolve(ctx) -> AbilityResult}}
   // ctx = {user, targets:[Character], rng, mapIndex (0,1,2 multiple-attack count this turn), cell?}
   // AbilityResult = {log:[string], events:[{type:'damage'|'heal'|'miss'|'condition'|'crit', target, amount?, condition?, degree?}],
   //                   attack:boolean (true → increments MAP), d20?:checkResult (main roll, for the dice UI)}
   // resolve() MUTATES characters (hp, conditions) via applyDamage/heal/addCondition.
ENEMIES {id:{name,desc, level, hp, ac, saves:{fort,ref,will}, perception, speed, attacks:[{name, bonus, damage, dmgType, range, traits, sfx}],
          abilities?:[abilityIds], ai:'melee'|'ranged'|'beast'|'coward'|'boss', xp?, loot:[{id,chance,qty}], look:{...} , faction:'raider'|'mutant'|'beast'|'machine'}}
   // >= 12: raider thugs/shooters/psycho/chief, Kostucha (boss), mutated rats/dogs/bugs, ghoul-like mutant, rogue drone/robot, etc.

// characters
createCharacter({name, ancestry, classId, attrs?, look?, bio?, level?}) -> Character
createEnemy(templateId, {levelAdj?:-1|0|1}?) -> Character (isEnemy:true)
newItem(id, qty=1) -> ItemInstance {uid, id, qty}
getStat(ch, key) -> int   // 'ac','perception','fortitude','reflex','will','classDC','speed', or any skill id; includes conditions/armor
getAttackBonus(ch, weapon(ItemDef|attack), mapIndex) -> int
getWeapon(ch) -> ItemDef or enemy attack;  getWeapons(ch) -> list (enemies: their attacks)
strike(attacker, defender, {weapon?, mapIndex=0, rng, bonus=0, damageBonus=0}) -> AbilityResult (mutates defender)
applyDamage(ch, amount, type?) -> {dealt, downed, dead}    // 0 HP → dying 1 (+wounded) for PCs; enemies die at 0
heal(ch, amount) -> healed;  addCondition(ch, id, value=1); removeCondition(ch, id); hasCondition(ch, id)
CONDITIONS {off_guard:{name:'Odsłonięty'}, frightened:'Przerażony', prone:'Powalony', bleeding(persistent), burning, poisoned/sickened, stunned:'Ogłuszony', slowed, dying:'Umierający', wounded:'Ranny', hidden:'Ukryty', raised_shield, in_cover:'W osłonie', ...}
startTurn(ch, rng) -> {log, actions:int(3 - stunned/slowed), events}   // persistent dmg, dying recovery checks
endTurn(ch, rng) -> {log, events}                                       // frightened -1 etc.
rollInitiative(ch, rng) -> checkResult-like {total, d20}
skillCheck(ch, skillId, dc, rng) -> checkResult
recoveryCheck(ch, rng)
isAlive(ch), isDown(ch) (dying/unconscious), canAct(ch)
longRest(ch)  // full HP, clear conditions except wounded→0, refresh uses
addXP(ch, xp) -> levelsGained (1000 XP per level, max 10); levelUp(ch) recalcs HP/prof (auto choices)
encounterXP(partyLevel, enemies) -> int (PF2e XP per creature level diff: -4:10 -3:15 -2:20 -1:30 0:40 +1:60 +2:80 +3:120 +4:160)
summarize(ch) -> [string] short stat lines for tooltips
```
### Character (plain JSON-serializable object — it is saved in localStorage!)
```js
{ id, name, ancestry, classId, level, xp, isEnemy:false, templateId?,
  attrs:{str,dex,con,int,wis,cha},          // modifiers (-1..+4/5)
  maxHp, hp, tempHp,
  prof:{ perception, fortitude, reflex, will, classDC, skills:{id:rank}, attacks:{simple,martial,advanced,unarmed}, defense:{unarmored,light,medium,heavy} },
  equipment:{ weapon:ItemInstance|null, weapon2:ItemInstance|null, armor:ItemInstance|null, shield:ItemInstance|null },
  inventory:[ItemInstance], abilities:[abilityId], uses:{abilityId:remaining},
  conditions:{ id:value },                    // e.g. {frightened:1, dying:1, bleeding:'1d6'}
  speed: 5,                                    // squares (1 square = 5 ft)
  look:{ body:'light'|'medium'|'heavy', skin:'#hex', hair:'#hex', hairStyle:int, cloth:'#hex', accent:'#hex', mask?:bool, mutation?:bool, cyber?:bool },
  bio:'' }
```
No functions inside characters (must survive JSON). Methods live in rules functions.

## GFX API — `src/gfx/index.js` (+ `src/gfx/post.js`)
```js
createPost(renderer, W, H) -> {render(scene, camera)}          // in post.js: dither/palette/vignette/scanline pass
createActorSprite(desc) -> ActorSprite
   // desc = Character | {classId, look} | {templateId(enemy id)} ; derives appearance from classId/templateId/look
   // ActorSprite: { object3d (THREE.Object3D, ~1.7 units tall human, feet at y=0, billboard-facing camera),
   //   play(anim:'idle'|'walk'|'attack'|'shoot'|'hurt'|'die'|'cast'), setFacing(dirX), update(dt), setHighlight(null|'#hex'),
   //   setSelected(bool) (ring under feet), dispose() }
portraitCanvas(desc, size=64) -> HTMLCanvasElement   // pixel-art bust portrait (same desc as above), deterministic
itemIcon(itemIdOrDef, size=32) -> HTMLCanvasElement  // weapons, armor, stims, grenades, junk, tech
abilityIcon(iconName, size=24) -> HTMLCanvasElement
tileMaterial(type) -> THREE.Material   // 'sand','asphalt','asphalt_cracked','rubble','concrete','dirt','toxic','grass_dead','metal','tiles'
createProp(type, {seed}?) -> THREE.Object3D // 1×1 tile footprint centered at origin, base y=0, castShadow on:
   // 'wall','wall_broken','pillar','car','bus','barrel','barrel_toxic','crate','debris','lamp','tree_dead','tent','campfire',
   // 'terminal','sandbags','container','fence','skeleton','scrap_pile','generator','door','tank_trap','sign','antenna'
createBuilding({w, d, h, ruined, seed}) -> THREE.Object3D   // ruin of w×d tiles, h floors (1 floor ≈ 2.5 units)
setupAtmosphere(scene, mood) -> {update(dt)}   // mood 'day'|'dusk'|'night'|'toxic'|'storm': lights, fog, sky dome, dust particles
Effects: spawnEffect(scene, type, pos(THREE.Vector3), opts?) // 'muzzle','blood','spark','explosion','heal','dust','smoke','fire','buff'
         spawnTracer(scene, from, to, color?);  floatText(scene, text, pos, color='#fff');  updateEffects(dt)  (call each frame)
drawPixelText(ctx, text, x, y, {color, scale=1, shadow}) ; measurePixelText(text, scale) // built-in 5×7 bitmap font incl. Polish letters
showD20Roll({d20, mod, total, dc, degree, label}) -> Promise   // animated 3D icosahedron in a small DOM overlay canvas (≈0.9 s),
                                                                 // settles showing d20, then shows "14 + 7 = 21 vs KP 18 — Sukces"; resolves when done
PALETTE {…} named colors
```

## AUDIO API — `src/audio/audio.js`
```js
Audio.init()                  // create AudioContext (called on first user gesture; safe to call repeatedly)
Audio.sfx(name, {vol, pitch}?) // no-op before init. names: 'click','hover','dice','hit','miss','crit','melee','shot_pistol',
   // 'shot_rifle','shot_shotgun','shot_smg','shot_laser','explosion','heal','step','levelup','coin','buy','error','death',
   // 'scream','growl','door','pickup','geiger','logo','typewriter','turn','victory','defeat','alarm','radio'
Audio.music(track)            // crossfade; tracks: 'logo','intro','title','town','wastes','ruins','combat','boss','victory','defeat', null=stop
Audio.ambience(name)          // 'wind','ruins','town','none'
Audio.setVolume({master, music, sfx})   Audio.muted
```
All generated procedurally (oscillators, noise buffers, filters, convolver reverb, procedural sequencer).

## META scenes (Agent META)
- `logo`: STORM 32 animated logo (3D, pixel, lightning) ~5 s, click skips → `intro`
- `intro`: story slides with animated pixel/3D backgrounds (bombs, ruins, nomads, raiders, Przystań), typewriter text; skip → `title`
- `title`: menu Nowa gra (→ recruit), Kontynuuj (if save → hub), Opcje (Settings.open()), Autorzy
- `recruit`: choose 4 of ~10 premade mercs (`src/data/recruits.js` RECRUITS: [{name, ancestry, classId, attrs?, look, bio}]),
   portrait + stats + bio; the name can be typed or rolled ("Losuj", `src/data/names.js`); confirm →
   party = the previewed characters with chosen names (`recruitId` = recruit id), contracts generated → `hub`
- Names (`src/data/names.js`): `generateName({ancestry, classId, gender, taken})`, `sanitizeName`, `checkName`,
   `plainName`/`shortName`. Typed names keep only letters/digits/space/-/./one pair of "quotes", max 24 chars,
   unique in the party (so they are safe to put into HTML strings). Renaming later: hub → Drużyna → "Zmień imię".
   Tavern/fallen tracking uses `recruitId` (`flags.fallenIds`), not names.
- `hub` (Przystań): 3D town scene + menu: Tablica zleceń (contracts → `worldmap` to travel), Handlarz Nomadów (buy/sell),
   Lecznica (heal for Złom / rest = next day, long rest), Drużyna (character sheets, equipment swap, level-up info, rename), Opcje, Zapisz
- `worldmap`: 3D pixel map of region; travel to the selected contract location; possible random encounter/event
   (skill check events, d20 rolls) → `Game.goto('mission', {contract})`
- `debrief`: results from mission → rewards (XP via addXP, Złom, items, rep), level-ups shown, story advance, save → `hub`
- `gameover` (TPK), `victory` (Kostucha defeated) with credits.
`src/data/contracts.js`: `generateContracts(state) -> [Contract]`, `STORY_CONTRACTS`.
```js
Contract = { id, title, giver, faction:'survivors'|'nomads', desc, type:'eliminate'|'retrieve'|'rescue'|'hunt'|'boss',
  level, biome:'ruins'|'wastes'|'industrial'|'bunker', mood:'day'|'dusk'|'night'|'toxic'|'storm',
  enemies:[enemyTemplateId,...] (groups placed by mission), objective:{ type, itemId?, count? },
  reward:{ scrap, xp, items:[itemId], rep:{nomads?, survivors?} }, story?:bool, travelDays:1 }
```

## MISSION scene (Agent MISSION) — `src/scenes/mission.js`, helpers in `src/mission/`
`enter({contract})` (contract object or id from Game.state.contracts). Builds a procedural tactical map
(grid ~20×20 to 28×28, biome-specific tiles/props/buildings via GFX), isometric-ish orthographic camera at 45°
(rotate Q/E, zoom wheel, pan WASD/drag), party sprites, enemy groups. Exploration mode (click to move party
leader, followers trail, fog of war) → when enemies see the party: **combat** (initiative = Perception,
PF2e 3-action economy, MAP, strikes, movement Stride=1 action up to speed, Step, Take Cover, Raise Shield,
class abilities, consumables, cover/flanking=off-guard, line of sight), enemy AI, every d20 roll shown
via `showD20Roll` + combat log. Objectives (kill all / find item at marker / rescue NPC / kill boss), loot
crates with skill checks (Thievery/Crafting/Athletics), extraction tile. End → `Game.goto('debrief',
{contract, result:'success'|'fail'|'retreat', xp, loot:[ItemInstance], scrap, casualties:[names]})`;
TPK → `gameover`. Exposes `window.__mission` for automated tests: `{state, winNow(), loseNow(), autoTurn()}`.

## Testing
`node tools/snap.mjs "?scene=hub" /path/out.png 3000 [script.js]` — serves the game, opens headless Chrome
(WebGL via SwiftShader), prints console/page errors, takes a screenshot (view it with the Read tool).
`script.js` is page-side JS (may be async, may `return` JSON) for clicking/driving.
Rules tests in Node: `node src/rules/selftest.mjs`.
Use the scratchpad dir given in your prompt for screenshots.
