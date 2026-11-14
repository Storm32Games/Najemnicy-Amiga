// @ts-nocheck
// Kod przeniesiony 1:1 z Oldgame/src/gfx/icons.js (rysowanie na płótnie 2D, bez Three.js). Nie jest sprawdzany typami.
// Pixel icons for items (32x32 design) and abilities (24x24 badges). Matched by keywords in id/icon/type/name.
import { Pix, mkCanvas, shade, mix, outlineRegion, scaleCanvas } from './util';

const norm = (s) => String(s || '').toLowerCase().replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź|ż/g, 'z');
const has = (s, ...k) => k.some(x => s.includes(x));
const cache = new Map();

// metal bar helper: horizontal bar with top highlight and bottom shade
function bar(p, x, y, w, h, c) { p.r(x, y, w, h, c); p.r(x, y, w, 1, shade(c, 1.5)); if (h > 2) p.r(x, y + h - 1, w, 1, shade(c, 0.6)); }
function vbar(p, x, y, w, h, c) { p.r(x, y, w, h, c); p.r(x, y, 1, h, shade(c, 1.45)); if (w > 2) p.r(x + w - 1, y, 1, h, shade(c, 0.6)); }
const STEEL = '#8a929a', DARK = '#3c4249', WOOD = '#7a4a28', BRASS = '#c9a043', RUST = '#a4562c';

const ITEM = {
  pistol(p) { bar(p, 6, 10, 18, 5, '#8a929a'); bar(p, 24, 11, 3, 3, DARK); p.r(10, 10, 8, 1, '#c0c8cc'); vbar(p, 8, 15, 5, 9, WOOD); p.r(8, 22, 5, 2, shade(WOOD, 0.6)); p.r(13, 15, 4, 1, DARK); p.r(14, 16, 1, 3, DARK); p.r(6, 9, 2, 1, DARK); p.r(22, 9, 2, 1, DARK); },
  revolver(p) { ITEM.pistol(p); p.ell(15, 12, 4, 4, '#6a727a'); p.ell(15, 12, 2, 2, DARK); p.px(14, 11, '#c0c8cc'); },
  rifle(p) { vbar(p, 2, 13, 8, 7, WOOD); p.r(2, 19, 8, 1, shade(WOOD, 0.55)); bar(p, 10, 12, 10, 4, DARK); bar(p, 20, 13, 10, 2, STEEL); vbar(p, 14, 16, 3, 7, '#2a2f34'); p.r(12, 10, 6, 2, '#4a525a'); p.px(29, 12, '#aab'); p.r(20, 11, 1, 2, DARK); },
  sniper(p) { ITEM.rifle(p); bar(p, 11, 8, 9, 3, '#2a2f34'); p.r(12, 9, 2, 1, '#6ac4e8'); p.r(17, 9, 2, 1, '#6ac4e8'); p.r(14, 11, 2, 1, DARK); },
  shotgun(p) { vbar(p, 2, 13, 9, 7, shade(WOOD, 0.9)); bar(p, 11, 12, 18, 3, STEEL); bar(p, 11, 15, 18, 2, DARK); vbar(p, 17, 17, 6, 3, WOOD); p.r(16, 17, 8, 1, shade(WOOD, 0.5)); p.px(29, 12, '#ddd'); },
  smg(p) { bar(p, 5, 11, 17, 5, '#555d66'); bar(p, 22, 12, 7, 2, STEEL); vbar(p, 12, 16, 4, 10, '#2a2f34'); vbar(p, 7, 16, 4, 6, DARK); p.r(2, 12, 4, 3, DARK); p.r(8, 10, 8, 1, '#8a929a'); p.r(18, 12, 2, 2, '#d8a030'); },
  laser(p) { bar(p, 4, 11, 16, 6, '#e8e4d8'); bar(p, 20, 12, 8, 3, '#46f2c8'); p.r(5, 12, 10, 1, '#fff'); vbar(p, 7, 17, 5, 7, '#c8c4b8'); p.r(14, 13, 4, 2, '#2a8a78'); p.r(28, 13, 2, 1, '#bffff0'); p.px(10, 14, '#46f2c8'); p.r(20, 10, 4, 1, '#2a8a78'); },
  bow(p) { p.line(10, 4, 20, 16, WOOD, 2); p.line(20, 16, 10, 28, WOOD, 2); p.line(10, 4, 10, 28, '#e6dcc0', 1); p.line(11, 16, 26, 16, '#c9a043', 1); p.px(27, 16, '#ddd'); p.r(24, 15, 2, 3, '#ccc'); },
  knife(p) { p.line(8, 24, 25, 7, '#d8e0e4', 4); p.line(8, 24, 25, 7, '#fff', 1); p.line(9, 25, 26, 8, '#8a929a', 1); p.line(6, 26, 10, 22, '#4a2c18', 4); p.r(10, 21, 4, 4, '#2a2f34'); p.px(24, 7, '#fff'); },
  machete(p) { p.line(10, 22, 26, 5, '#c8d0d4', 5); p.line(10, 22, 26, 5, '#f4f8fa', 2); p.line(12, 24, 27, 7, '#7a828a', 1); p.line(5, 27, 10, 22, '#4a2c18', 4); p.r(8, 21, 5, 4, '#2a2f34'); },
  pipe(p) { p.line(6, 26, 25, 7, RUST, 5); p.line(5, 25, 24, 6, '#d08a50', 1); p.line(7, 27, 26, 8, shade(RUST, 0.55), 1); p.r(23, 4, 5, 5, '#6a3a1c'); p.px(26, 3, '#ccc'); p.px(28, 6, '#ccc'); p.px(22, 4, '#ccc'); },
  hammer(p) { p.line(7, 27, 21, 11, WOOD, 3); p.line(6, 26, 20, 10, '#a8703a', 1); p.r(16, 4, 12, 9, '#777f88'); p.r(16, 4, 12, 2, '#c0c8cc'); p.r(16, 11, 12, 2, '#444b52'); p.r(14, 6, 2, 5, '#444b52'); p.px(27, 5, '#fff'); },
  axe(p) { p.line(7, 27, 22, 6, WOOD, 3); p.line(6, 26, 21, 5, '#a8703a', 1); p.r(15, 4, 12, 9, '#8a929a'); p.r(22, 6, 6, 6, '#d0d8dc'); p.r(15, 4, 12, 1, '#c0c8cc'); p.r(26, 8, 3, 3, '#e8f0f4'); },
  scythe(p) { p.line(8, 28, 20, 5, '#3a2418', 2); p.line(20, 5, 28, 8, '#dde4e8', 3); p.line(28, 8, 26, 14, '#aab', 2); },
  armor(p) { p.r(7, 7, 18, 20, '#6a7a52'); p.r(7, 7, 18, 3, '#8a9a6a'); p.r(2, 7, 7, 6, '#586444'); p.r(23, 7, 7, 6, '#586444'); p.r(2, 7, 7, 1, '#8a9a6a'); p.r(23, 7, 7, 1, '#8a9a6a'); p.r(12, 5, 8, 3, '#2a2a20'); p.r(9, 14, 5, 5, '#586444'); p.r(18, 14, 5, 5, '#586444'); p.r(9, 14, 5, 1, '#8a9a6a'); p.r(18, 14, 5, 1, '#8a9a6a'); p.r(7, 22, 18, 3, '#3a4230'); p.px(15, 12, '#c9a043'); p.r(7, 7, 2, 20, '#7a8a62'); p.r(23, 7, 2, 20, '#4a5638'); },
  helmet(p) { p.ell(16, 16, 11, 9, '#6a7650'); p.r(5, 17, 22, 4, '#6a7650'); p.r(5, 20, 22, 2, '#3a4230'); p.r(8, 9, 10, 2, '#a0b07a'); p.r(14, 11, 4, 2, '#c9a043'); },
  vest(p) { ITEM.armor(p); p.r(10, 20, 4, 4, '#3a3a30'); p.r(18, 20, 4, 4, '#3a3a30'); },
  shield(p) { p.r(6, 4, 20, 4, '#8a929a'); for (let y = 0; y < 18; y++) { const w = Math.round(20 - Math.max(0, y - 8) * 1.1); p.r(16 - w / 2, 8 + y, w, 1, y % 9 < 1 ? '#c0c8cc' : '#6a727a'); } p.r(6, 4, 20, 1, '#d8e0e4'); p.r(14, 8, 4, 16, '#4a525a'); p.r(8, 12, 16, 3, '#4a525a'); p.px(16, 13, '#c9a043'); p.r(7, 8, 2, 8, '#8a929a'); },
  stim(p) { p.line(6, 26, 20, 12, '#d8e0e4', 4); p.line(7, 25, 19, 13, '#46f2c8', 2); p.r(19, 7, 6, 6, '#8a929a'); p.line(22, 6, 27, 1, '#8a929a', 1); p.line(21, 12, 24, 15, '#aab', 1); p.px(9, 23, '#bffff0'); p.r(4, 24, 3, 3, '#444b52'); p.r(18, 10, 7, 2, '#444b52'); },
  bandage(p) { p.r(4, 10, 24, 12, '#e8e2d0'); p.r(4, 10, 24, 2, '#fff'); p.r(4, 20, 24, 2, '#b8b2a0'); p.r(13, 8, 6, 16, '#d8d2c0'); p.r(14, 12, 4, 8, '#c43d2f'); p.r(12, 14, 8, 4, '#c43d2f'); p.r(14, 12, 4, 1, '#e8665a'); },
  medkit(p) { p.r(4, 10, 24, 16, '#d8d2c0'); p.r(4, 10, 24, 2, '#fff'); p.r(4, 24, 24, 2, '#a8a290'); p.r(11, 6, 10, 4, '#6a727a'); p.r(13, 4, 6, 3, '#8a929a'); p.r(13, 14, 6, 8, '#c43d2f'); p.r(11, 16, 10, 4, '#c43d2f'); p.r(13, 14, 6, 1, '#e8665a'); },
  grenade(p) { p.ell(16, 19, 8, 9, '#556244'); p.ell(16, 19, 7, 8, '#6a7a54'); for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) p.r(11 + x * 4, 14 + y * 4, 3, 3, '#445034'); p.r(10, 13, 3, 1, '#9aaa80'); p.r(13, 8, 6, 4, '#8a929a'); p.r(13, 8, 6, 1, '#c0c8cc'); p.line(19, 8, 25, 5, '#c9a043', 1); p.r(23, 3, 6, 4, 0); p.ell(25, 6, 3, 3, 0); p.line(24, 7, 21, 11, '#aab', 1); p.r(22, 3, 4, 3, '#8a929a'); },
  molotov(p) { p.r(13, 4, 6, 3, '#c9a043'); p.r(14, 7, 4, 4, '#3a6a3a'); p.ell(16, 19, 8, 9, '#3a6a3a'); p.ell(16, 19, 6, 7, '#58a058'); p.r(11, 15, 3, 8, '#9ae09a'); p.r(8, 20, 16, 4, '#d8a030'); p.px(17, 3, '#ff7a1e'); p.r(14, 0, 6, 3, '#ffb830'); p.r(15, 1, 4, 2, '#ff7a1e'); p.px(16, 0, '#fff0a0'); p.r(14, 3, 4, 3, '#e0e0c0'); },
  smoke(p) { p.r(10, 12, 12, 15, '#6a727a'); p.r(10, 12, 12, 2, '#9aa2aa'); p.r(10, 24, 12, 3, '#3c4249'); p.r(13, 8, 6, 4, '#8a929a'); p.r(14, 5, 4, 3, '#c0c8cc'); p.ell(8, 4, 5, 3, '#c8ccd0'); p.ell(18, 2, 6, 3, '#dde0e4'); p.ell(25, 5, 4, 3, '#aab0b4'); p.r(12, 17, 8, 5, '#d8d2c0'); p.r(14, 18, 4, 3, '#6a727a'); },
  antirad(p) { p.r(9, 9, 14, 17, '#e8a030'); p.r(9, 9, 14, 2, '#ffcf60'); p.r(9, 24, 14, 2, '#a86a10'); p.r(11, 5, 10, 4, '#e0e0d8'); p.r(11, 5, 10, 1, '#fff'); p.ell(16, 17, 5, 5, '#2a2a20'); p.px(16, 17, '#ffd24a'); p.r(15, 12, 3, 3, '#ffd24a'); p.r(11, 18, 3, 3, '#ffd24a'); p.r(19, 18, 3, 3, '#ffd24a'); p.ell(16, 17, 2, 2, '#2a2a20'); p.px(16, 17, '#ffd24a'); },
  food(p) { p.ell(16, 18, 10, 4, '#8a7a5a'); p.r(6, 10, 20, 15, '#b0905a'); p.r(6, 10, 20, 2, '#d8b878'); p.ell(16, 10, 10, 3, '#c9a868'); p.ell(16, 10, 8, 2, '#8a929a'); p.r(6, 22, 20, 3, '#7a6034'); p.r(8, 14, 16, 6, '#c43d2f'); p.r(8, 14, 16, 1, '#e0605a'); p.r(10, 16, 12, 2, '#f2ecde'); },
  water(p) { p.r(12, 4, 8, 4, '#2a6a8a'); p.r(10, 8, 12, 19, '#7ac0e0'); p.r(10, 8, 3, 19, '#c0e8f8'); p.r(19, 8, 3, 19, '#4a8aa8'); p.r(10, 16, 12, 6, '#2a6a8a'); p.r(12, 17, 8, 1, '#aee'); p.r(10, 26, 12, 1, '#2a5a78'); p.px(14, 11, '#fff'); },
  junk(p) { p.ell(16, 16, 9, 9, '#8a7a6a'); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; p.r(16 + Math.cos(a) * 10 - 2, 16 + Math.sin(a) * 10 - 2, 4, 4, '#8a7a6a'); } p.ell(16, 16, 9, 9, '#8a7a6a'); p.ell(16, 16, 3, 3, '#1a1410'); p.r(9, 9, 6, 2, '#b8a890'); p.r(18, 20, 6, 2, '#5a4a3a'); p.px(22, 12, RUST); p.px(10, 21, RUST); p.r(20, 22, 7, 5, RUST); },
  tech(p) { p.r(5, 7, 22, 18, '#2a5a3a'); p.r(5, 7, 22, 1, '#4a8a5a'); for (let k = 0; k < 4; k++) { p.line(8, 11 + k * 3, 14 + k * 2, 11 + k * 3, '#c9a043', 1); p.px(14 + k * 2, 11 + k * 3, '#ffe08a'); } p.r(18, 10, 6, 6, '#1a1f22'); p.r(18, 10, 6, 1, '#4a525a'); for (let k = 0; k < 3; k++) { p.px(17, 11 + k * 2, '#ccc'); p.px(24, 11 + k * 2, '#ccc'); } p.r(9, 20, 3, 3, '#8a929a'); p.px(22, 21, '#46f2c8'); p.px(24, 21, '#ff5a3a'); },
  chip(p) { p.r(8, 8, 16, 16, '#1e2428'); p.r(8, 8, 16, 1, '#4a525a'); p.r(11, 11, 10, 10, '#2a5a8a'); p.r(13, 13, 6, 6, '#46f2c8'); p.px(13, 13, '#bffff0'); for (let k = 0; k < 5; k++) { p.r(5, 9 + k * 3, 3, 1, '#c9a043'); p.r(24, 9 + k * 3, 3, 1, '#c9a043'); p.r(9 + k * 3, 5, 1, 3, '#c9a043'); p.r(9 + k * 3, 24, 1, 3, '#c9a043'); } },
  battery(p) { p.r(8, 8, 16, 20, '#2a2f34'); p.r(8, 8, 16, 2, '#4a525a'); p.r(12, 5, 8, 3, '#c9a043'); p.r(10, 14, 12, 10, '#46f2c8'); p.r(10, 14, 12, 2, '#bffff0'); p.r(10, 22, 12, 2, '#1a8a70'); p.r(15, 16, 2, 6, '#2a2f34'); p.r(13, 18, 6, 2, '#2a2f34'); p.r(8, 8, 2, 20, '#5a626a'); },
  key(p) { p.ell(10, 10, 6, 6, '#d8b048'); p.ell(10, 10, 3, 3, 0); p.g.clearRect(8, 8, 5, 5); p.r(8, 8, 5, 5, '#1a1410'); p.r(8, 8, 5, 1, '#8a6a20'); p.line(14, 14, 27, 27, '#d8b048', 3); p.line(13, 13, 26, 26, '#fff0a0', 1); p.r(21, 25, 3, 5, '#d8b048'); p.r(25, 22, 3, 5, '#d8b048'); },
  ammo(p) { for (let k = 0; k < 4; k++) { const x = 5 + k * 6; p.r(x, 10, 5, 14, '#c9a043'); p.r(x, 10, 1, 14, '#f0d078'); p.r(x + 4, 10, 1, 14, '#8a6a20'); p.r(x, 5, 5, 6, k % 2 ? '#b4532a' : '#c8c0b0'); p.r(x + 1, 4, 3, 2, k % 2 ? '#b4532a' : '#c8c0b0'); p.r(x, 24, 5, 2, '#6a5018'); p.px(x + 2, 25, '#2a2018'); } },
  fuel(p) { p.r(7, 8, 18, 19, '#b4432a'); p.r(7, 8, 18, 2, '#e0705a'); p.r(7, 25, 18, 2, '#702818'); p.r(20, 4, 5, 4, '#2a2f34'); p.r(9, 13, 14, 8, '#d8c040'); p.r(11, 15, 10, 4, '#2a2420'); p.r(7, 8, 2, 19, '#d0604a'); },
  scrap(p) { ITEM.junk(p); },
  box(p) { p.r(5, 8, 22, 18, '#8a6a3a'); p.r(5, 8, 22, 3, '#b8904e'); p.r(5, 24, 22, 2, '#5a4220'); p.r(14, 8, 4, 18, '#6a4e28'); p.line(5, 11, 14, 26, '#6a4e28', 1); p.r(13, 14, 6, 3, '#c9a043'); p.px(16, 19, '#f2ecde'); p.px(16, 21, '#f2ecde'); p.r(14, 15, 4, 1, '#2a2018'); },
  radio(p) { p.r(6, 10, 20, 15, '#4a5a3a'); p.r(6, 10, 20, 2, '#7a8a5a'); p.r(9, 13, 8, 6, '#1a2a1a'); p.px(11, 15, '#8fd14f'); p.px(12, 15, '#8fd14f'); p.px(14, 17, '#8fd14f'); p.ell(21, 16, 3, 3, '#2a2f34'); p.line(10, 10, 6, 1, '#aab', 1); p.r(9, 21, 14, 2, '#2a3a2a'); },
  drone(p) { p.ell(16, 18, 8, 6, '#6a727a'); p.r(8, 14, 16, 1, '#aab4ba'); p.ell(16, 18, 3, 3, '#d8281a'); p.px(15, 17, '#fff'); p.r(2, 9, 10, 1, '#d8e0e4'); p.r(20, 9, 10, 1, '#d8e0e4'); p.r(6, 10, 1, 4, '#444b52'); p.r(25, 10, 1, 4, '#444b52'); p.r(10, 23, 12, 2, '#444b52'); },
  goggles(p) { p.r(2, 12, 28, 4, '#3a2a1a'); for (const x of [10, 22]) { p.ell(x, 14, 6, 6, '#b0883a'); p.ell(x, 14, 4, 4, '#3a8aa8'); p.r(x - 2, 12, 2, 1, '#e8f8ff'); } },
};
const ITEM_KEYS = [
  ['battery', ['battery', 'bateri', 'akumul']], ['revolver', ['revolver', 'rewolw']], ['sniper', ['sniper', 'snajper', 'longgun', 'marksman']], ['laser', ['laser', 'plazm', 'plasma', 'beam', 'energy']], ['smg', ['smg', 'uzi', 'maszynow', 'subm']], ['shotgun', ['shotgun', 'strzelb']],
  ['rifle', ['rifle', 'karabin', 'ak47', 'assault', 'carbine']], ['pistol', ['pistol', 'handgun', 'glock', 'gun_', 'sidearm']], ['bow', ['bow', 'luk', 'kusz', 'crossbow']],
  ['pipe', ['pipe', 'rura', 'club', 'palka', 'bat', 'kij', 'wrench', 'klucz', 'crowbar', 'lom']],
  ['scythe', ['scythe', 'kosa']], ['machete', ['machete', 'maczet', 'sword', 'miecz', 'blade', 'katan']], ['knife', ['knife', 'noz', 'dagger', 'shiv', 'sztylet']], ['hammer', ['hammer', 'mlot', 'sledge', 'maul']], ['axe', ['axe', 'topor', 'siekier']],
  ['molotov', ['molotov', 'zapaj', 'incend']], ['smoke', ['smoke', 'dym']], ['grenade', ['grenade', 'granat', 'frag', 'explosive', 'bomb', 'dynamit']],
  ['antirad', ['antirad', 'rad-x', 'radx', 'rad_', 'iodine', 'jod', 'radiation']], ['stim', ['stim', 'syringe', 'strzykaw', 'inject', 'chem', 'drug', 'narkot', 'adren', 'booster']],
  ['medkit', ['medkit', 'medic', 'apteczk', 'firstaid', 'kit']], ['bandage', ['bandage', 'bandaz', 'opatrun', 'gauze', 'heal']],
  ['shield', ['shield', 'tarcz']], ['helmet', ['helmet', 'hełm', 'helm', 'hat', 'cap']], ['armor', ['armor', 'armour', 'pancerz', 'vest', 'kamizel', 'jacket', 'kurtk', 'plate', 'suit', 'kombinez']],
  ['battery', ['battery', 'bateri', 'cell', 'akumul', 'power']], ['chip', ['chip', 'układ', 'processor', 'procesor', 'cpu', 'data', 'drive', 'dysk']], ['key', ['key', 'klucz', 'keycard', 'pass']],
  ['ammo', ['ammo', 'amunic', 'bullet', 'nabo', 'magazine', 'magazynek', 'shells']], ['fuel', ['fuel', 'paliw', 'gas_can', 'jerry', 'oil']], ['water', ['water', 'woda', 'wody', 'bottle', 'butel', 'drink', 'canteen', 'flask']],
  ['food', ['food', 'jedz', 'konserw', 'can', 'ration', 'meal', 'meat', 'mięs', 'mies', 'bean', 'fasol', 'jerky']], ['radio', ['radio', 'comm', 'walkie']], ['drone', ['drone', 'dron']], ['goggles', ['goggle', 'gogle', 'lens', 'visor']],
  ['tech', ['tech', 'circuit', 'electro', 'elektr', 'gadget', 'device', 'urzadz', 'scanner', 'skaner', 'module', 'wire', 'kabel', 'part']], ['junk', ['junk', 'zlom', 'scrap', 'trash', 'gear', 'cog', 'rust', 'rdza', 'metal']],
];

function itemKind(item) {
  const d = typeof item === 'string' ? { id: item } : (item || {});
  const parts = [d.icon, d.id, d.type, d.name, d.weapon && d.weapon.group, d.weapon && d.weapon.sfx].map(norm).filter(Boolean);
  // icon field has priority, then id, then others
  for (const s of parts) { const k = ITEM_KEYS.find(([, ks]) => ks.some(x => s.includes(norm(x)))); if (k && (s === parts[0] || true)) return k[0]; }
  const t = norm(d.type);
  if (t === 'weapon') return d.weapon && d.weapon.range > 1 ? 'pistol' : 'pipe';
  if (t === 'armor') return 'armor'; if (t === 'shield') return 'shield'; if (t === 'consumable') return 'stim'; if (t === 'junk') return 'junk'; if (t === 'tech') return 'tech'; if (t === 'ammo') return 'ammo';
  return 'box';
}

export function itemIcon(item, size = 32) {
  const kind = itemKind(item); const key = 'i' + kind;
  let base = cache.get(key);
  if (!base) {
    const [c, g] = mkCanvas(32, 32); const p = new Pix(g);
    (ITEM[kind] || ITEM.box)(p);
    outlineRegion(g, 0, 0, 32, 32, '#120c08');
    // soft ground shadow
    base = c; cache.set(key, c);
  }
  return scaleCanvas(copy(base), size);
}
function copy(c) { const [n, g] = mkCanvas(c.width, c.height); g.drawImage(c, 0, 0); return n; }

// ---------------- abilities ----------------
const AB = {
  sword(p, c) { p.line(5, 18, 18, 5, '#e8f0f4', 3); p.line(5, 18, 18, 5, '#fff', 1); p.line(3, 20, 7, 16, '#6a3a1c', 3); p.line(8, 14, 12, 18, '#c9a043', 2); p.px(18, 4, '#fff'); },
  crosshair(p, c) { p.ell(12, 12, 8, 8, '#fff'); p.ell(12, 12, 6, 6, c); p.ell(12, 12, 4, 4, '#fff'); p.ell(12, 12, 2, 2, c); p.r(11, 1, 2, 6, '#fff'); p.r(11, 17, 2, 6, '#fff'); p.r(1, 11, 6, 2, '#fff'); p.r(17, 11, 6, 2, '#fff'); p.px(12, 12, '#fff'); },
  heart(p) { p.ell(8, 9, 4, 4, '#ff5a5a'); p.ell(16, 9, 4, 4, '#ff5a5a'); for (let y = 0; y < 9; y++) p.r(4 + y * 0.9, 10 + y, 16 - y * 1.8, 1, '#ff5a5a'); p.px(7, 7, '#ffc0c0'); p.px(8, 6, '#ffc0c0'); p.r(10, 11, 4, 1, '#ff8a8a'); },
  shield(p) { for (let y = 0; y < 17; y++) { const w = y < 11 ? 14 : 14 - (y - 10) * 2; p.r(12 - w / 2, 4 + y, w, 1, '#dfe6ea'); } p.r(12, 4, 1, 17, '#9aa8b0'); for (let y = 0; y < 15; y++) { const w = y < 10 ? 10 : 10 - (y - 9) * 2; if (w > 0) p.r(12 - w / 2 + 0, 6 + y, w, 1, '#5a6a74'); } p.r(11, 8, 2, 8, '#dfe6ea'); p.r(8, 11, 8, 2, '#dfe6ea'); },
  skull(p) { p.ell(12, 10, 7, 7, '#f2ecde'); p.r(8, 14, 8, 5, '#f2ecde'); p.ell(9, 10, 2, 2, '#1a1010'); p.ell(15, 10, 2, 2, '#1a1010'); p.r(11, 13, 2, 2, '#1a1010'); for (let k = 0; k < 4; k++) p.r(8 + k * 2, 17, 1, 3, '#1a1010'); },
  fire(p) { p.ell(12, 16, 6, 6, '#ff7a1e'); p.r(10, 6, 5, 8, '#ff7a1e'); p.px(12, 4, '#ff7a1e'); p.r(11, 5, 3, 3, '#ff7a1e'); p.ell(12, 17, 4, 4, '#ffd24a'); p.ell(12, 18, 2, 2, '#fff6c0'); p.r(6, 12, 3, 5, '#ff7a1e'); p.r(16, 11, 3, 6, '#ff9a30'); },
  bolt(p) { p.line(15, 2, 8, 12, '#ffe84a', 3); p.line(8, 12, 15, 12, '#ffe84a', 3); p.line(15, 12, 8, 22, '#ffe84a', 3); p.px(14, 3, '#fff'); p.px(9, 12, '#fff'); },
  drone(p) { p.ell(12, 13, 6, 4, '#dfe6ea'); p.ell(12, 13, 2, 2, '#ff3a2a'); p.r(2, 6, 7, 1, '#fff'); p.r(15, 6, 7, 1, '#fff'); p.r(5, 7, 1, 3, '#aab'); p.r(18, 7, 1, 3, '#aab'); p.r(9, 17, 6, 2, '#aab'); },
  eye(p, c) { p.ell(12, 12, 10, 5, '#f2ecde'); p.ell(12, 12, 4, 4, c); p.ell(12, 12, 2, 2, '#1a1010'); p.px(11, 11, '#fff'); p.line(2, 12, 6, 9, '#aaa', 1); },
  fist(p) { p.r(6, 8, 13, 10, '#f2d0a8'); for (let k = 0; k < 4; k++) { p.r(6 + k * 3, 5, 3, 5, '#f2d0a8'); p.r(6 + k * 3, 5, 3, 1, '#fff2e0'); p.r(8 + k * 3, 6, 1, 3, '#c89870'); } p.r(3, 12, 4, 6, '#f2d0a8'); p.r(7, 18, 11, 4, '#c0c8cc'); p.r(6, 8, 13, 1, '#fff2e0'); },
  shout(p) { p.r(3, 9, 6, 7, '#dfe6ea'); p.line(9, 9, 15, 4, '#dfe6ea', 2); p.line(9, 16, 15, 21, '#dfe6ea', 2); p.r(13, 5, 3, 15, '#dfe6ea'); for (let k = 0; k < 3; k++) { p.line(18 + k * 2, 9 - k, 18 + k * 2, 15 + k, '#fff', 1); } },
  stealth(p) { p.ell(12, 11, 9, 9, '#2e3438'); p.ell(12, 13, 6, 6, '#0e1114'); p.r(8, 12, 3, 2, '#8fd14f'); p.r(14, 12, 3, 2, '#8fd14f'); p.px(8, 12, '#e0ffd0'); p.px(14, 12, '#e0ffd0'); p.r(6, 20, 12, 3, '#2e3438'); },
  run(p) { p.ell(14, 5, 3, 3, '#dfe6ea'); p.line(14, 8, 11, 15, '#dfe6ea', 3); p.line(14, 9, 19, 12, '#dfe6ea', 2); p.line(11, 15, 7, 21, '#dfe6ea', 3); p.line(11, 15, 16, 19, '#dfe6ea', 3); p.line(16, 19, 15, 23, '#dfe6ea', 2); p.line(3, 8, 8, 8, '#fff', 1); p.line(2, 12, 7, 12, '#fff', 1); },
  explosion(p) { for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; p.line(12, 12, 12 + Math.cos(a) * 10, 12 + Math.sin(a) * 10, '#ff9a30', 3); } p.ell(12, 12, 6, 6, '#ffd24a'); p.ell(12, 12, 3, 3, '#fff'); },
  grenade(p) { AB.explosion(p, '#000'); },
  gun(p) { p.r(3, 8, 15, 5, '#dfe6ea'); p.r(3, 8, 15, 1, '#fff'); p.r(18, 9, 4, 3, '#9aa8b0'); p.r(5, 13, 4, 8, '#dfe6ea'); p.r(11, 13, 3, 3, '#9aa8b0'); p.px(23, 10, '#ffd24a'); },
  reload(p) { p.line(6, 12, 9, 6, '#fff', 2); p.line(9, 6, 17, 6, '#fff', 2); p.line(17, 6, 19, 12, '#fff', 2); p.line(19, 12, 15, 18, '#fff', 2); p.line(15, 18, 7, 18, '#fff', 2); p.r(17, 16, 5, 2, '#fff'); p.r(20, 13, 2, 5, '#fff'); },
  cross(p) { p.r(9, 3, 6, 18, '#fff'); p.r(3, 9, 18, 6, '#fff'); p.r(9, 3, 6, 1, '#cfd'); },
  wrench(p) { p.line(6, 19, 15, 10, '#dfe6ea', 4); p.ell(16, 8, 5, 5, '#dfe6ea'); p.r(16, 2, 4, 5, 0); p.g.clearRect(0, 0, 0, 0); p.r(17, 3, 4, 5, '#000'); p.line(5, 20, 8, 17, '#9aa8b0', 3); },
  star(p) { for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 1.2566, b = a + 1.2566; p.line(12, 12, 12 + Math.cos(a) * 10, 12 + Math.sin(a) * 10, '#ffe27a', 3); } p.ell(12, 12, 4, 4, '#fff6c0'); },
  hammer(p) { p.line(5, 20, 14, 11, '#8a5a30', 3); p.r(11, 4, 10, 7, '#dfe6ea'); p.r(11, 4, 10, 1, '#fff'); },
  bandage(p) { p.r(3, 8, 18, 9, '#f2ecde'); p.r(9, 6, 6, 13, '#d8d2c0'); p.r(10, 9, 4, 7, '#c43d2f'); p.r(8, 11, 8, 3, '#c43d2f'); },
  trap(p) { p.r(4, 15, 16, 4, '#9aa8b0'); for (let k = 0; k < 5; k++) { p.r(4 + k * 3, 9, 2, 7, '#dfe6ea'); p.px(4 + k * 3, 8, '#fff'); } p.r(4, 18, 16, 2, '#5a6a74'); },
};
const AB_KEYS = [
  ['crosshair', ['crosshair', 'aim', 'snip', 'precis', 'target', 'celn', 'headshot']], ['heart', ['heart', 'heal', 'regen', 'leczen', 'life', 'serce']], ['bandage', ['bandage', 'bandaz', 'first', 'stabil', 'patch']], ['cross', ['medic', 'cross', 'revive']],
  ['shield', ['shield', 'tarcz', 'cover', 'oslon', 'guard', 'block', 'defen', 'armor', 'raise']], ['skull', ['skull', 'death', 'kill', 'finish', 'execut', 'czaszk']], ['explosion', ['explos', 'wybuch', 'blast', 'area']], ['grenade', ['grenade', 'granat', 'bomb']],
  ['fire', ['fire', 'flame', 'burn', 'ogien', 'molotov', 'incend']], ['bolt', ['bolt', 'elec', 'shock', 'arc', 'zap', 'lightning', 'stun', 'emp', 'energy']], ['drone', ['drone', 'dron', 'robot', 'turret', 'deploy']], ['eye', ['eye', 'oko', 'perception', 'scan', 'spot', 'recon', 'vision', 'watch', 'analy']],
  ['fist', ['fist', 'pięść', 'piesc', 'punch', 'brawl', 'bash', 'smash', 'slam', 'unarm', 'grapple', 'trip', 'shove']], ['shout', ['shout', 'krzyk', 'yell', 'intimid', 'roar', 'rally', 'command', 'taunt', 'warcry', 'bark']],
  ['stealth', ['stealth', 'hide', 'sneak', 'ukry', 'skrad', 'shadow', 'ambush', 'backstab']], ['run', ['run', 'sprint', 'stride', 'step', 'move', 'dash', 'escape', 'bieg', 'charge']], ['reload', ['reload', 'przeład', 'przelad', 'recharge', 'swap']],
  ['trap', ['trap', 'pulap', 'mine', 'mina', 'snare']], ['wrench', ['wrench', 'tech', 'repair', 'napraw', 'hack', 'craft', 'tinker', 'gadget', 'build', 'upgrade']], ['hammer', ['hammer', 'mlot', 'sledge', 'whirl', 'cleave', 'rage', 'berserk']],
  ['gun', ['gun', 'shot', 'strzal', 'shoot', 'burst', 'fire_', 'spray', 'suppress', 'volley', 'double', 'rapid', 'pistol', 'rifle', 'ranged']], ['sword', ['sword', 'strike', 'slash', 'cut', 'attack', 'melee', 'knife', 'blade', 'uderz', 'cios', 'power', 'sneak', 'feint', 'flurry', 'stab']],
];
const AB_COL = { sword: '#a83a2a', crosshair: '#a83a2a', gun: '#a85a2a', explosion: '#b8651a', grenade: '#b8651a', fire: '#a8481a', skull: '#6a1a1a', fist: '#8a3a2a', hammer: '#8a3a2a', trap: '#8a5a2a', heart: '#2a8a4a', bandage: '#2a8a4a', cross: '#2a8a4a', shield: '#2a5a8a', stealth: '#3a4a5a', eye: '#4a3a8a', bolt: '#3a6a9a', drone: '#2a6a7a', run: '#4a7a3a', shout: '#8a6a1a', reload: '#5a5a2a', wrench: '#6a5a2a', star: '#6a4a8a' };
export function abilityKind(icon) {
  const d = typeof icon === 'string' ? { icon } : (icon || {});
  const parts = [d.icon, d.id, d.name, d.fx].map(norm).filter(Boolean);
  for (const s of parts) { const k = AB_KEYS.find(([, ks]) => ks.some(x => s.includes(norm(x)))); if (k) return k[0]; }
  return 'star';
}
export function abilityIcon(icon, size = 24) {
  const kind = abilityKind(icon); const key = 'a' + kind; let base = cache.get(key);
  if (!base) {
    const [c, g] = mkCanvas(24, 24), p = new Pix(g); const col = AB_COL[kind] || '#555';
    // badge
    p.r(1, 0, 22, 24, '#0e0a08'); p.r(0, 1, 24, 22, '#0e0a08'); p.r(2, 1, 20, 22, col); p.r(1, 2, 22, 20, col); p.r(2, 1, 20, 1, shade(col, 1.5)); p.r(1, 2, 1, 20, shade(col, 1.3)); p.r(2, 22, 20, 1, shade(col, 0.55)); p.r(22, 2, 1, 20, shade(col, 0.6));
    for (let y = 2; y < 22; y++) for (let x = 2; x < 22; x++) if (((x + y) & 1) && y > 12) p.px(x, y, shade(col, 0.88));
    // glyph on its own layer with shadow
    const [gc, gg] = mkCanvas(24, 24), gp = new Pix(gg); (AB[kind] || AB.star)(gp, shade(col, 0.9));
    g.globalAlpha = 0.5; g.drawImage(gc, 1, 1); g.globalAlpha = 1;
    const sh = mkCanvas(24, 24); const sg = sh[1]; sg.drawImage(gc, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#000'; sg.fillRect(0, 0, 24, 24); g.globalAlpha = 0.55; g.drawImage(sh[0], 1, 1); g.globalAlpha = 1;
    g.drawImage(gc, 0, 0);
    base = c; cache.set(key, c);
  }
  return scaleCanvas(copy(base), size);
}
export { itemKind };
