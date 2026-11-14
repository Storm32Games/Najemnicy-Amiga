// Contract generation (side contracts scale to party level) + the 3 story contracts vs Kostucha.
import { ENEMIES, ITEMS, createEnemy, encounterXP } from '../rules/index.js';

const rnd = (n) => Math.floor(Math.random() * n);
const pickOf = (a) => a[rnd(a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Enemy ids helpers (guarded against unknown content). */
const enemyIds = () => Object.keys(ENEMIES || {});
const isBoss = (id) => ENEMIES[id]?.ai === 'boss' || /kostucha/i.test(id);
export function findEnemy(...pats) {
  const ids = enemyIds();
  for (const p of pats) { const f = ids.find(id => (p instanceof RegExp ? p.test(id) || p.test(ENEMIES[id]?.name || '') : id === p)); if (f) return f; }
  return null;
}
function pool(factions, level) {
  const all = enemyIds().filter(id => !isBoss(id));
  let p = all.filter(id => (!factions || factions.includes(ENEMIES[id].faction)) && Math.abs((ENEMIES[id].level ?? 1) - level) <= 1);
  if (!p.length) p = all.filter(id => !factions || factions.includes(ENEMIES[id].faction));
  if (!p.length) p = all;
  return p.length ? p : ['raider'];
}
/** spec: concrete item id, or '@type' (random item of that type up to level+1; '@any' = weapon/armor/shield/consumable/tech). */
export function rollItem(spec, level = 1) {
  if (!spec) return null;
  if (!spec.startsWith('@')) return ITEMS?.[spec] ? spec : null;
  const t = spec.slice(1);
  const c = Object.values(ITEMS || {}).filter(i => (t === 'any' ? ['weapon', 'armor', 'shield', 'consumable', 'tech'].includes(i.type) : i.type === t) && (i.level ?? 0) <= level + 1 && (i.price ?? 1) > 0);
  return c.length ? pickOf(c).id : null;
}

const TYPES = {
  eliminate: {
    factions: ['raider'], biomes: ['ruins', 'industrial', 'wastes'], moods: ['dusk', 'day', 'night'],
    titles: ['Oczyścić skład', 'Wyplenić gniazdo Szabrowników', 'Odbić stację przekaźnikową', 'Dym nad Rdzawiskiem', 'Rozbić obóz Żelaznych Szczęk', 'Wyczyścić zajezdnię'],
    descs: ['Banda Szabrowników zajęła budynek, przez który prowadzi szlak zaopatrzenia. Wybić ich wszystkich.', 'Dym z ich ognisk widać z murów Przystani. Ktoś musi ich stamtąd wykurzyć.', 'Zdegenerowani bandyci blokują drogę karawanom. Zrób z tym porządek.'],
  },
  retrieve: {
    factions: ['raider', 'mutant', 'machine'], biomes: ['ruins', 'bunker', 'industrial'], moods: ['dusk', 'night', 'toxic'],
    titles: ['Odzyskać rdzeń zasilania', 'Skrzynia z lekami', 'Zaginiony generator', 'Dane z bunkra', 'Sprzęt medyczny z kliniki', 'Zgubiony ładunek karawany'],
    descs: ['W ruinach leży cenny ładunek. Znajdź go i wynieś, zanim zrobią to inni.', 'Przeżyjemy zimę tylko wtedy, gdy to odzyskacie. Uważajcie na to, co się tam lęgnie.', 'Cenny sprzęt został w skażonej strefie. Wejść, wziąć, wyjść.'],
  },
  rescue: {
    factions: ['raider', 'mutant'], biomes: ['ruins', 'industrial', 'bunker'], moods: ['night', 'dusk', 'storm'],
    titles: ['Ocalić zwiadowcę', 'Jeńcy w piwnicach', 'Uwięziony inżynier', 'Wołanie o pomoc', 'Karawana w potrzasku'],
    descs: ['Ktoś z naszych wpadł w ręce Szabrowników. Zostało mało czasu.', 'Radio zacharczało: „pomocy". Potem tylko trzaski. Idźcie tam.', 'Uwięziony technik wie, jak naprawić pompę wody w Przystani. Przyprowadźcie go żywego.'],
  },
  hunt: {
    factions: ['beast', 'mutant'], biomes: ['wastes', 'ruins', 'industrial'], moods: ['day', 'dusk', 'toxic', 'storm'],
    titles: ['Polowanie na alfę', 'Koniec z szczuroludźmi', 'Bestia z kanałów', 'Wataha przy studni', 'Plaga mutantów'],
    descs: ['Mutanty zżerają nam zapasy i pasą się na kupcach. Znajdź legowisko i zabij przywódcę.', 'Nomadzi proszą o pomoc: coś wielkiego krąży przy ich studni od trzech nocy.', 'Za głowę potwora wyznaczono nagrodę. Przynieś dowód.'],
  },
};
const GIVERS = {
  survivors: ['Starsza Wiera', 'Kapitan Dobosz', 'Mechanik Rudy', 'Siostra Hanna', 'Burmistrz Kalinowski'],
  nomads: ['Stary Tuareg', 'Handlarka Zeyna', 'Przewodnik Kasim', 'Wędrowiec Orzeł', 'Matka Karawany'],
};
function partyLvl(state) {
  const p = state?.party || []; return p.length ? Math.max(1, Math.round(p.reduce((s, c) => s + (c.level || 1), 0) / p.length)) : 1;
}

export function makeContract(type, level, state) {
  const T = TYPES[type], faction = Math.random() < 0.55 ? 'survivors' : 'nomads';
  const biome = pickOf(T.biomes), mood = pickOf(T.moods);
  // PF2e XP budget (4 PCs): ~80 moderate, ~120 severe. Whole mission budget slightly above moderate,
  // because groups are usually fought one after another.
  const plv = partyLvl(state);
  const hardC = level > plv;
  let budget = (hardC ? 125 : 85 + rnd(25)) + (type === 'hunt' ? 10 : 0);
  const cost = (id) => { try { return encounterXP(plv, [createEnemy(id)]) || 40; } catch { return 40; } };
  const enemies = [];
  if (type === 'hunt') { // one stronger target first (at most party level +2)
    const strong = enemyIds().filter(id => !isBoss(id) && T.factions.includes(ENEMIES[id].faction) && (ENEMIES[id].level ?? 1) >= level && (ENEMIES[id].level ?? 1) <= plv + 2);
    const s0 = strong.length ? pickOf(strong) : null;
    if (s0) { enemies.push(s0); budget -= cost(s0); }
  }
  const p = enemyIds().filter(id => !isBoss(id) && T.factions.includes(ENEMIES[id].faction) && (ENEMIES[id].level ?? 1) <= level + (hardC ? 0 : 0) && (ENEMIES[id].level ?? 1) >= level - 3);
  const fallback = pool(T.factions, level);
  for (let guard = 0; guard < 20 && enemies.length < 8; guard++) {
    const fit = (p.length ? p : fallback).filter(id => cost(id) <= budget);
    if (!fit.length) break;
    const id = pickOf(fit); enemies.push(id); budget -= cost(id);
  }
  while (enemies.length < 2) enemies.push(pickOf(fallback.filter(id => (ENEMIES[id].level ?? 1) <= plv) .concat(fallback).slice(0, 3)));
  let objective = { type };
  if (type === 'retrieve') objective = { type, itemId: rollItem('@tech', 5) || rollItem('@consumable', 5) || 'scrap', count: 1 };
  const hard = hardC;
  const reward = {
    scrap: Math.round((35 + level * 32 + rnd(30)) * (hard ? 1.2 : 1) * (type === 'rescue' ? 1.15 : 1)),
    xp: 300 + level * 100,
    items: Math.random() < 0.4 ? [rollItem('@any', level)].filter(Boolean) : [],
    rep: { [faction]: 1 + (hard ? 1 : 0) },
  };
  return {
    id: 'k' + (state?.day ?? 1) + '_' + Math.random().toString(36).slice(2, 7),
    title: pickOf(T.titles), giver: pickOf(GIVERS[faction]), faction,
    desc: pickOf(T.descs), type, level, biome, mood, enemies, objective, reward, travelDays: 1 + (Math.random() < 0.25 ? 1 : 0),
  };
}

// ---- story ----
function storyEnemies(i) {
  const E = (id, ...alt) => (ENEMIES?.[id] ? id : findEnemy(...alt) || findEnemy(/raider|szabr/i) || 'raider_thug');
  const thug = E('raider_thug', /thug/i), gunner = E('raider_gunner', /gunner|shoot/i), burner = E('raider_burner', /burner/i), psycho = E('raider_psycho', /psycho/i);
  const sniper = E('raider_sniper', /sniper/i), chief = E('raider_chief', /chief/i), k = E('kostucha', /kostucha/i);
  return [
    [thug, thug, gunner, psycho],
    [thug, gunner, gunner, psycho, burner, chief],
    [k, thug, thug, gunner, sniper, psycho, burner],
  ][i];
}
export const STORY_CONTRACTS = [
  { id: 'story1', story: true, title: 'Cień Żelaznych Szczęk', giver: 'Kapitan Dobosz', faction: 'survivors',
    desc: 'Szabrownicy z Żelaznych Szczęk przejęli stary posterunek na trasie do Przystani. Ich flaga — czaszka w stalowych szczękach — wisi tam od tygodnia. Kapitan chce wiedzieć, kim jest ich wódz.',
    type: 'eliminate', level: 2, biome: 'industrial', mood: 'dusk', objective: { type: 'eliminate' }, travelDays: 1,
    reward: { scrap: 220, xp: 500, items: [], rep: { survivors: 2 } }, get enemies() { return storyEnemies(0); } },
  { id: 'story2', story: true, title: 'Karawana w ogniu', giver: 'Handlarka Zeyna', faction: 'nomads',
    desc: 'Szczęki wyrżnęły karawanę Nomadów i pojmały jej przewodnika. Zeyna zapłaci wszystko, co ma, byście go odbili — a on zna kryjówkę Kostuchy.',
    type: 'rescue', level: 3, biome: 'ruins', mood: 'night', objective: { type: 'rescue' }, travelDays: 2,
    reward: { scrap: 340, xp: 700, items: [], rep: { nomads: 3 } }, get enemies() { return storyEnemies(1); } },
  { id: 'story3', story: true, title: 'Kostucha', giver: 'Burmistrz Kalinowski', faction: 'survivors',
    desc: 'Znamy już jej kryjówkę: pogrzebany pod Rdzawiskiem bunkier. Kostucha rządzi Szczękami żelazną ręką — i tylko jej śmierć powstrzyma atak na Przystań. To zlecenie, z którego się nie wraca z pustymi rękami.',
    type: 'boss', level: 5, biome: 'bunker', mood: 'toxic', objective: { type: 'boss' }, travelDays: 2,
    reward: { scrap: 800, xp: 1000, items: [], rep: { survivors: 5, nomads: 5 } }, get enemies() { return storyEnemies(2); } },
];
const STORY_NEED = [{ c: 2, r: 2 }, { c: 4, r: 6 }, { c: 7, r: 10 }];
export function storyUnlocked(state) {
  const s = state.story || 0; if (s >= STORY_CONTRACTS.length) return false;
  const need = STORY_NEED[s], rep = (state.rep?.nomads || 0) + (state.rep?.survivors || 0);
  return (state.completed?.length || 0) >= need.c && rep >= need.r;
}
export function storyHint(state) {
  const s = state.story || 0; if (s >= STORY_CONTRACTS.length) return 'Kostucha nie żyje.';
  const need = STORY_NEED[s]; return `Kolejne zlecenie fabularne: ${need.c} ukończone zlecenia i ${need.r} pkt reputacji.`;
}
const STORY_BUDGET = [100, 110, 115];
function cloneStory(i, state) {
  const s = STORY_CONTRACTS[i]; const enemies = [...s.enemies];
  // Trim escorts (never the boss/chief) until the encounter fits the PF2e budget for the current party level.
  const plv = partyLvl(state);
  const xp = () => { try { return encounterXP(plv, enemies.map(id => createEnemy(id))); } catch { return 0; } };
  for (let g = 0; g < 10 && xp() > STORY_BUDGET[i] && enemies.length > 2; g++) {
    let k = enemies.length - 1; while (k > 0 && isBoss(enemies[k])) k--;
    if (k <= 0) break; enemies.splice(k, 1);
  }
  return { ...s, enemies, reward: JSON.parse(JSON.stringify(s.reward)), objective: { ...s.objective } };
}

/** Fresh board: 4–6 side contracts (+ story contract if unlocked). */
export function generateContracts(state) {
  const lvl = partyLvl(state), out = [];
  const types = ['eliminate', 'retrieve', 'rescue', 'hunt'];
  const n = 4 + rnd(2);
  for (let i = 0; i < n; i++) out.push(makeContract(i < 4 ? types[i] : pickOf(types), clamp(lvl + (Math.random() < 0.25 ? 1 : Math.random() < 0.2 ? -1 : 0), 1, 10), state));
  if (state && storyUnlocked(state)) out.unshift(cloneStory(state.story || 0, state));
  return out;
}
/** Keep the board lively: drop `drop` random side contracts, top up to 4–6, inject story contract. Mutates state.contracts. */
export function refreshBoard(state, drop = 0) {
  state.contracts = state.contracts || [];
  for (let i = 0; i < drop; i++) { const side = state.contracts.filter(c => !c.story); if (side.length > 2) state.contracts.splice(state.contracts.indexOf(pickOf(side)), 1); }
  if (storyUnlocked(state) && !state.contracts.some(c => c.story)) state.contracts.unshift(cloneStory(state.story || 0, state));
  const lvl = partyLvl(state), types = ['eliminate', 'retrieve', 'rescue', 'hunt'];
  const target = 4 + rnd(2);
  while (state.contracts.filter(c => !c.story).length < target) {
    const missing = types.find(t => !state.contracts.some(c => c.type === t));
    state.contracts.push(makeContract(missing || pickOf(types), clamp(lvl + (Math.random() < 0.25 ? 1 : 0), 1, 10), state));
  }
  return state.contracts;
}
export const DIFFICULTY = (contractLevel, partyLevel) => {
  const d = contractLevel - partyLevel;
  return d <= -2 ? { label: 'Łatwe', cls: 'good' } : d <= 0 ? { label: 'Standardowe', cls: 'amber' } : d === 1 ? { label: 'Trudne', cls: 'bad' } : { label: 'Śmiertelne', cls: 'bad' };
};
export const BIOME_NAMES = { ruins: 'Ruiny', wastes: 'Pustkowia', industrial: 'Strefa przemysłowa', bunker: 'Bunkier' };
export const TYPE_NAMES = { eliminate: 'Eliminacja', retrieve: 'Odzyskanie', rescue: 'Ratunek', hunt: 'Polowanie', boss: 'Wódz' };
export const FACTION_NAMES = { survivors: 'Ocaleni z Przystani', nomads: 'Nomadzi' };
export const MOOD_NAMES = { day: 'dzień', dusk: 'zmierzch', night: 'noc', toxic: 'toksyczna mgła', storm: 'burza' };
