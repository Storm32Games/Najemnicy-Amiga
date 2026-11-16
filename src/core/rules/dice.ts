// Kości, testy, stopnie sukcesu, biegłość. Migracja z Oldgame/src/rules/dice.js.
// Czysty TypeScript: zero zależności od Phasera / Three.js / DOM.
import { DC_TABLE } from '../data/rules.ts';
import type { DiceExpr } from '../data/types.ts';

/** Generator liczb [0, 1). Domyślnie Math.random; makeRng() daje deterministyczny mulberry32. */
export type Rng = () => number;
/** 0 krytyczna porażka, 1 porażka, 2 sukces, 3 krytyczny sukces. */
export type Degree = 0 | 1 | 2 | 3;

/** FNV-1a hash tekstu -> uint32 (ziarno map i sklepów). */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministyczny mulberry32. Bez ziarna zwraca Math.random. */
export function makeRng(seed?: number | string | null): Rng {
  if (seed === undefined || seed === null) return Math.random;
  let a = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rzut kością 1..sides. */
export const d = (sides: number, rng: Rng = Math.random): number => 1 + Math.floor(rng() * sides);
/**
 * Połowienie wyniku kości (Zastraszanie, ukrycie celu): każde połowienie dzieli przez 2 z zaokrągleniem w górę.
 * 20 -> 10 -> 5, 1 zostaje 1.
 */
export function halveDie(v: number, halves = 0): number {
  for (let i = 0; i < halves; i++) v = Math.ceil(v / 2);
  return v;
}
/** Liczba całkowita z przedziału [a, b]. */
export const randInt = (a: number, b: number, rng: Rng = Math.random): number => a + Math.floor(rng() * (b - a + 1));
/** Losowy element tablicy. */
export const pickOne = <T>(arr: readonly T[], rng: Rng = Math.random): T => arr[Math.floor(rng() * arr.length)];

/** Pojedyncza kość z rzutu (do animacji): ścianki + wynik. */
export interface DieRoll {
  sides: number;
  value: number;
}

/**
 * Rzut obrażeń do pokazania w HUD-zie: kości (sumowane i mnożone), stała premia, mnożnik stopnia
 * (kryt x2, połowa przy udanym rzucie obronnym, x0 przy krytycznym), kości dodane po mnożeniu (deadly / fatal).
 */
export interface DamageRoll {
  dice: DieRoll[];
  flat: number;
  mult: number;
  post: DieRoll[];
  total: number;
}

/** Tekst rzutu obrażeń: "(4+2+3) ×2 +5 = 23". */
export function fmtDamage(r: DamageRoll): string {
  const parts = r.dice.map((x) => String(x.value));
  let base = parts.join('+') || '0';
  if (r.flat) base += (r.flat > 0 ? '+' : '-') + Math.abs(r.flat);
  const multi = parts.length + (r.flat ? 1 : 0) > 1;
  let s = r.mult !== 1 ? `${multi ? '(' + base + ')' : base} ×${r.mult === 0.5 ? '½' : r.mult}` : base;
  for (const x of r.post) s += ` +${x.value}`;
  return `${s} = ${r.total}`;
}

export interface RollResult {
  total: number;
  rolls: number[];
  /** Kości z rozmiarem ścianek (w kolejności rzutu). */
  dice: DieRoll[];
  expr: string;
  mod: number;
}

/** "2d6+3", "1d8", "1d4-1", "2d6+1d4+2", "5". */
export function roll(expr: DiceExpr | number, rng: Rng = Math.random, halves = 0): RollResult {
  const s = String(expr).replace(/\s+/g, '');
  const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/g;
  let m: RegExpExecArray | null;
  let total = 0;
  let mod = 0;
  const rolls: number[] = [];
  const dice: DieRoll[] = [];
  while ((m = re.exec(s))) {
    if (m[3] !== undefined) {
      const sign = m[1] === '-' ? -1 : 1;
      const n = m[2] === '' ? 1 : Number(m[2]);
      const sides = Number(m[3]);
      for (let i = 0; i < n; i++) {
        const r = halveDie(d(sides, rng), halves);
        rolls.push(r);
        dice.push({ sides, value: r });
        total += sign * r;
      }
    } else {
      const v = (m[4] === '-' ? -1 : 1) * Number(m[5]);
      mod += v;
      total += v;
    }
  }
  return { total, rolls, dice, expr: s, mod };
}

export interface ParsedDice {
  n: number;
  sides: number;
  mod: number;
}

/** "2d6+3" -> {n: 2, sides: 6, mod: 3}. Liczba bez kości -> {n: 0, sides: 0, mod}. */
export function parseDice(expr: DiceExpr): ParsedDice {
  const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(String(expr).replace(/\s+/g, ''));
  if (!m) return { n: 0, sides: 0, mod: parseInt(expr, 10) || 0 };
  return { n: m[1] === '' ? 1 : Number(m[1]), sides: Number(m[2]), mod: m[3] ? Number(m[3]) : 0 };
}

export function averageDice(expr: DiceExpr): number {
  const p = parseDice(expr);
  return (p.n * (p.sides + 1)) / 2 + p.mod;
}

/** Stopień sukcesu PF2e: ±10 od ST + naturalna 20 / 1 przesuwa o stopień. */
export function degreeOf(total: number, dc: number, nat?: number): Degree {
  let deg: number = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (nat === 20) deg = Math.min(3, deg + 1);
  else if (nat === 1) deg = Math.max(0, deg - 1);
  return deg as Degree;
}

export interface CheckResult {
  /** Wynik k20 po ewentualnym połowieniu (to on wchodzi do sumy). */
  d20: number;
  /** Surowy rzut k20 przed połowieniem. */
  raw: number;
  /** Ile razy połowiono kość (0 = zwykły rzut). */
  halves: number;
  mod: number;
  total: number;
  dc: number;
  degree: Degree;
  nat20: boolean;
  nat1: boolean;
}

/**
 * Test k20 vs ST. `halves` > 0 połowi kość (zaokrąglenie w górę) przed dodaniem modyfikatora;
 * połowiona kość nie daje naturalnej 20 (maks. 10), naturalna 1 zostaje 1.
 */
export function check(mod: number, dc: number, rng: Rng = Math.random, halves = 0): CheckResult {
  const raw = d(20, rng);
  const r = halveDie(raw, halves);
  const total = r + mod;
  return { d20: r, raw, halves, mod, total, dc, degree: degreeOf(total, dc, r), nat20: r === 20, nat1: r === 1 };
}

/** Kość do dziennika: "14" albo "14→7" przy połowieniu. */
export const fmtD20 = (c: CheckResult): string => (c.halves ? `${c.raw}→${c.d20}` : String(c.d20));

export const flatCheck = (dc: number, rng: Rng = Math.random): CheckResult => check(0, dc, rng);

/** Szansa (0..1) na co najmniej sukces / krytyk dla danego modyfikatora i ST - do podpowiedzi w UI. */
export function hitChances(mod: number, dc: number, halves = 0): { hit: number; crit: number } {
  let hit = 0;
  let crit = 0;
  for (let k = 1; k <= 20; k++) {
    const v = halveDie(k, halves);
    const g = degreeOf(v + mod, dc, v);
    if (g >= 2) hit++;
    if (g === 3) crit++;
  }
  return { hit: hit / 20, crit: crit / 20 };
}

/** Standardowe ST wg poziomu (tabela PF2e). */
export const dcForLevel = (level: number): number => DC_TABLE[Math.max(0, Math.min(DC_TABLE.length - 1, level | 0))];

/** Premia z biegłości: 0 bez szkolenia, inaczej 2*ranga + poziom. */
export const profBonus = (rank: number, level: number): number => (rank > 0 ? 2 * rank + level : 0);

export const fmtMod = (n: number): string => (n >= 0 ? '+' + n : String(n));
