// Kości, testy, stopnie sukcesu, biegłość. Czysty JS (Node + przeglądarka).
export function makeRng(seed) {
  if (seed === undefined || seed === null) return Math.random;
  let a;
  if (typeof seed === 'string') { a = 2166136261; for (let i = 0; i < seed.length; i++) { a ^= seed.charCodeAt(i); a = Math.imul(a, 16777619); } a >>>= 0; }
  else a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const d = (sides, rng = Math.random) => 1 + Math.floor(rng() * sides);

// "2d6+3", "1d8", "1d4-1", "2d6+1d4+2", "5"
export function roll(expr, rng = Math.random) {
  const s = String(expr).replace(/\s+/g, '');
  const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/g;
  let m, total = 0, mod = 0; const rolls = [];
  while ((m = re.exec(s))) {
    if (m[3] !== undefined) {
      const sign = m[1] === '-' ? -1 : 1, n = m[2] === '' ? 1 : +m[2], sides = +m[3];
      for (let i = 0; i < n; i++) { const r = d(sides, rng); rolls.push(r); total += sign * r; }
    } else { const v = (m[4] === '-' ? -1 : 1) * +m[5]; mod += v; total += v; }
  }
  return { total, rolls, expr: s, mod };
}
// parse "2d6+3" -> {n, sides, mod} (pierwszy człon kostkowy)
export function parseDice(expr) {
  const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(String(expr).replace(/\s+/g, ''));
  if (!m) return { n: 0, sides: 0, mod: parseInt(expr, 10) || 0 };
  return { n: m[1] === '' ? 1 : +m[1], sides: +m[2], mod: m[3] ? +m[3] : 0 };
}
export function averageDice(expr) { const p = parseDice(expr); return p.n * (p.sides + 1) / 2 + p.mod; }

export const DEGREE_NAMES = ['Krytyczna porażka', 'Porażka', 'Sukces', 'Krytyczny sukces'];
export function degreeOf(total, dc, nat) {
  let deg = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (nat === 20) deg = Math.min(3, deg + 1);
  else if (nat === 1) deg = Math.max(0, deg - 1);
  return deg;
}
export function check(mod, dc, rng = Math.random) {
  const r = d(20, rng), total = r + mod;
  return { d20: r, mod, total, dc, degree: degreeOf(total, dc, r), nat20: r === 20, nat1: r === 1 };
}
export function flatCheck(dc, rng = Math.random) { return check(0, dc, rng); }

const DC_TABLE = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34];
export const dcForLevel = (level) => DC_TABLE[Math.max(0, Math.min(DC_TABLE.length - 1, level | 0))];

export const PROF_NAMES = ['Nieszkolony', 'Wyszkolony', 'Ekspert', 'Mistrz', 'Legenda'];
export const profBonus = (rank, level) => (rank > 0 ? 2 * rank + level : 0);
export const fmtMod = (n) => (n >= 0 ? '+' + n : String(n));
