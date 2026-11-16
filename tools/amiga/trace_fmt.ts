// Wspólny format śladów (TS <-> C, amiga/tests/trace_fmt.c). Same identyfikatory ASCII i liczby, bez tekstów.
import { ABILITIES, CONDITIONS, PERSISTENT, type ActionResult, type Character, type CombatEvent } from '../../src/core/index.ts';

const DMG = ['P', 'S', 'B', 'fire', 'acid', 'elec', 'poison', 'bleed', 'rad'];
const COND_KEYS = Object.keys(CONDITIONS);
const ABIL_KEYS = Object.keys(ABILITIES);
const PERSIST = new Set<string>(PERSISTENT);

/** Kość jako n/s/m: '1d6' -> '1d6+0', liczba v -> '0d0+v'. */
export function diceStr(v: string | number): string {
  if (typeof v === 'number') return `0d0${v >= 0 ? '+' : ''}${v}`;
  const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(v.replace(/\s+/g, ''));
  if (!m) return `0d0+${Number(v)}`;
  const mod = m[3] ? Number(m[3]) : 0;
  return `${m[1] === '' ? 1 : Number(m[1])}d${Number(m[2])}${mod >= 0 ? '+' : ''}${mod}`;
}

export function snap(label: string, ch: Character): string {
  const conds: string[] = [];
  for (const k of COND_KEYS) {
    const v = (ch.conditions as Record<string, string | number | undefined>)[k];
    if (v === undefined) continue;
    conds.push(PERSIST.has(k) ? `${k}:${diceStr(v)}` : `${k}:${typeof v === 'number' ? v : 1}`);
  }
  const uses: string[] = [];
  for (const k of ABIL_KEYS) {
    const v = (ch.uses as Record<string, number | undefined>)[k];
    if (v !== undefined) uses.push(`${k}:${v}`);
  }
  const eq = (['weapon', 'weapon2', 'armor', 'shield'] as const).map((s) => ch.equipment[s]?.id ?? '-').join(',');
  const inv = ch.inventory.map((i) => `${i.id}:${i.qty}`).join(',');
  return `${label} hp=${ch.hp}/${ch.maxHp} thp=${ch.tempHp} lvl=${ch.level} xp=${ch.xp} cond=${conds.join(',')} uses=${uses.join(',')} eq=${eq} inv=${inv} st=${ch.stolen ?? 0}/${ch.stolenScrap ?? 0}`;
}

export type LabelOf = (ch: Character | undefined) => string;

function evStr(e: CombatEvent, L: LabelOf): string {
  switch (e.type) {
    case 'damage': return `dmg:${L(e.target)}:${e.amount}:${DMG.indexOf(e.dmgType)}:${e.degree ?? '-'}:${e.persistent ?? '-'}`;
    case 'heal': return `heal:${L(e.target)}:${e.amount}:${e.temp ? 1 : 0}`;
    case 'miss': return `miss:${L(e.target)}:${e.degree}`;
    case 'condition': {
      const v = e.value === undefined ? '-' : PERSIST.has(e.condition) ? diceStr(e.value) : typeof e.value === 'number' ? String(e.value) : '1';
      return `cond:${L(e.target)}:${e.condition}:${v}`;
    }
    case 'crit': return `crit:${L(e.target)}`;
    case 'death': return `death:${L(e.target)}`;
    case 'down': return `down:${L(e.target)}`;
    case 'recovery': return `rec:${L(e.target)}:${e.degree}`;
    case 'steal': return `steal:${L(e.target)}:${e.item.id}`;
    case 'scrap': return `scrap:${e.amount}`;
  }
}

export function resStr(r: ActionResult, L: LabelOf): string {
  const d = r.d20 ? `${r.d20.raw}/${r.d20.d20}/${r.d20.total}/${r.d20.dc}/${r.d20.degree}` : '-';
  const roll = (x: ActionResult['dmg']): string =>
    x ? `${x.total}|${x.flat}|${Math.round(x.mult * 2)}|${x.dice.map((k) => k.value).join('.')}|${x.post.map((k) => k.value).join('.')}` : '-';
  return `res att=${r.attack ? 1 : 0}/${r.attacks ?? 0} hit=${r.hit ? 1 : 0} dealt=${r.dealt ?? 0} cons=${r.consumed ? 1 : 0} d20=${d} dmg=${roll(r.dmg)} heal=${roll(r.heal)} ev=${r.events.map((e) => evStr(e, L)).join(';')}`;
}
