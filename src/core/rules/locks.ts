// Zamki i zabezpieczenia elektroniczne wg PF2e (bez k100):
// - Otwieranie zamka (Pick a Lock, Złodziejstwo, 2 akcje): zamki złożone wymagają kilku sukcesów;
//   kryt. sukces = 2 sukcesy, sukces = 1, porażka = nic, kryt. porażka = pęka wytrych.
//   Bez wytrychów: improwizowane narzędzia, kara -2 (okolicznościowa).
// - Hakowanie (Hack - wzorem Starfinder 2e, tu Technika albo Złodziejstwo jako "Unieszkodliwienie urządzenia"):
//   ten sam schemat sukcesów, kryt. porażka = blokada urządzenia i alarm.
// Czysty TypeScript: zero zależności od Phasera / DOM.
import type { SkillId } from '../data/types.ts';
import { dcForLevel, type CheckResult, type Degree, type Rng } from './dice.ts';
import { checkBy, getStat } from './stats.ts';
import type { Character } from './types.ts';

/** Jakość zamka (tabela PF2e Core: Poor / Simple / Average / Good / Superior). */
export type LockQuality = 'poor' | 'simple' | 'average' | 'good' | 'superior';

export interface LockDef {
  name: string;
  /** Poziom przedmiotu zamka. */
  level: number;
  /** ST Złodziejstwa z tabeli PF2e. */
  dc: number;
  /** Ile sukcesów potrzeba do otwarcia. */
  successes: number;
}

/** Zamki z PF2e Core Rulebook (Locks): ST 15/20/25/30/40, 2..6 sukcesów. */
export const LOCKS: Readonly<Record<LockQuality, LockDef>> = {
  poor: { name: 'Lichy zamek', level: 0, dc: 15, successes: 2 },
  simple: { name: 'Prosty zamek', level: 1, dc: 20, successes: 3 },
  average: { name: 'Przeciętny zamek', level: 3, dc: 25, successes: 4 },
  good: { name: 'Dobry zamek', level: 9, dc: 30, successes: 5 },
  superior: { name: 'Doskonały zamek', level: 17, dc: 40, successes: 6 },
};

/** Rodzaje urządzeń elektronicznych do hakowania. */
export type DeviceKind = 'terminal' | 'computer' | 'server' | 'security' | 'robot';

export interface DeviceDef {
  name: string;
  /** Poziom urządzenia względem poziomu misji (ST = ST poziomu PF2e). */
  levelOffset: number;
  successes: number;
}

/** Urządzenia: ST z tabeli ST wg poziomu (PF2e), liczba "warstw zabezpieczeń" = wymagane sukcesy. */
export const DEVICES: Readonly<Record<DeviceKind, DeviceDef>> = {
  terminal: { name: 'Terminal', levelOffset: 0, successes: 1 },
  computer: { name: 'Komputer', levelOffset: 0, successes: 2 },
  server: { name: 'Serwer', levelOffset: 2, successes: 3 },
  security: { name: 'Panel zabezpieczeń', levelOffset: 1, successes: 2 },
  robot: { name: 'Sterownik robota', levelOffset: 3, successes: 3 },
};

/** Umiejętności do otwierania zamka (Wytrych / Wyważenie). */
export const LOCK_SKILLS: readonly SkillId[] = ['thievery', 'athletics'];
/** Umiejętności do hakowania (Technika = włamanie do systemu, Złodziejstwo = obejście sprzętowe). */
export const HACK_SKILLS: readonly SkillId[] = ['crafting', 'thievery'];

/** Przedmiot: wytrychy (narzędzia złodziejskie PF2e). */
export const LOCKPICK_ID = 'lockpick';
/** Kara za improwizowane narzędzia (PF2e). */
export const IMPROVISED_PENALTY = -2;

/** Stan zamka / zabezpieczenia na obiekcie misji. */
export interface LockState {
  dc: number;
  needed: number;
  progress: number;
  /** Zablokowany na stałe (zacięty zamek, zablokowane urządzenie). */
  jammed: boolean;
  /** Kara do kolejnych prób wyważania po kryt. porażce (PF2e Force Open: -2). */
  forcePenalty: number;
}

export const lockState = (q: LockQuality): LockState => ({ dc: LOCKS[q].dc, needed: LOCKS[q].successes, progress: 0, jammed: false, forcePenalty: 0 });
export const deviceState = (k: DeviceKind, missionLevel: number): LockState => ({
  dc: dcForLevel(missionLevel + DEVICES[k].levelOffset), needed: DEVICES[k].successes, progress: 0, jammed: false, forcePenalty: 0,
});

/** Jakość zamka pasująca do poziomu misji (zamki z poziomem <= poziom misji + 1). */
export function lockForLevel(level: number, rng: Rng = Math.random): LockQuality {
  const ok = (Object.keys(LOCKS) as LockQuality[]).filter((q) => LOCKS[q].level <= level + 1);
  const top = ok.slice(-2);
  return top[Math.floor(rng() * top.length)] ?? 'poor';
}

export const hasLockpick = (ch: Character): boolean => ch.inventory.some((i) => i.id === LOCKPICK_ID && i.qty > 0);

export interface LockAttempt {
  roll: CheckResult;
  skill: SkillId;
  /** Ile sukcesów dodała ta próba (0..2). */
  gained: number;
  opened: boolean;
  /** Kryt. porażka wytrychem: pęka jeden wytrych. */
  brokeTool: boolean;
  /** Kryt. porażka wyważania: zamek zacięty (kara -2 do kolejnych prób). Przy hakowaniu: blokada. */
  jammed: boolean;
  /** Wyważony zamek jest zniszczony (PF2e Force Open: sukces = otwarte, ale uszkodzone). */
  broken: boolean;
  /** Hakowanie: włączony alarm. */
  alarm: boolean;
  improvised: boolean;
  log: string;
}

const DEG = ['KRYTYCZNA PORAŻKA', 'porażka', 'sukces', 'KRYTYCZNY SUKCES'];
const used = (d: Degree): string => DEG[d];

/** Usuwa 1 wytrych z plecaka. */
function breakLockpick(ch: Character): void {
  const it = ch.inventory.find((i) => i.id === LOCKPICK_ID && i.qty > 0);
  if (!it) return;
  it.qty -= 1;
  if (it.qty <= 0) ch.inventory.splice(ch.inventory.indexOf(it), 1);
}

/**
 * Próba otwarcia zamka. MUTUJE stan zamka i plecak (pęknięty wytrych).
 * thievery = Otwieranie zamka (kilka sukcesów); athletics = Wyważenie (PF2e Force Open: jeden test,
 * ST +5, kara -2 bez łomu; sukces = otwarte, ale zamek zniszczony; kryt. porażka = zacięty, -2 do kolejnych prób).
 */
export function pickLock(ch: Character, lock: LockState, skill: SkillId, rng: Rng = Math.random, what = 'Zamek'): LockAttempt {
  const out: LockAttempt = { roll: null as unknown as CheckResult, skill, gained: 0, opened: false, brokeTool: false, jammed: false, broken: false, alarm: false, improvised: false, log: '' };
  if (skill === 'athletics') {
    const dc = lock.dc + 5;
    const mod = getStat(ch, 'athletics') + IMPROVISED_PENALTY + lock.forcePenalty;
    const r = checkBy(ch, mod, dc, rng);
    out.roll = r;
    out.improvised = true;
    if (r.degree >= 2) {
      lock.progress = lock.needed;
      out.opened = true;
      out.broken = r.degree === 2;
      out.gained = lock.needed;
    } else if (r.degree === 0) {
      lock.forcePenalty -= 2;
      out.jammed = true;
    }
    out.log = `${ch.name}: wyważanie (${what}) ${r.total} vs ST ${dc} — ${used(r.degree)}${out.opened ? (out.broken ? ', zamek zniszczony' : ', bez śladów') : out.jammed ? ', zamek się zaciął (-2)' : ''}`;
    return out;
  }
  out.improvised = !hasLockpick(ch);
  const mod = getStat(ch, skill) + (out.improvised ? IMPROVISED_PENALTY : 0);
  const r = checkBy(ch, mod, lock.dc, rng);
  out.roll = r;
  out.gained = r.degree === 3 ? 2 : r.degree === 2 ? 1 : 0;
  lock.progress = Math.min(lock.needed, lock.progress + out.gained);
  out.opened = lock.progress >= lock.needed;
  if (r.degree === 0 && !out.improvised) {
    breakLockpick(ch);
    out.brokeTool = true;
  }
  out.log = `${ch.name}: wytrych (${what}${out.improvised ? ', bez narzędzi -2' : ''}) ${r.total} vs ST ${lock.dc} — ${used(r.degree)}` +
    ` [${lock.progress}/${lock.needed}]${out.opened ? ', otwarte!' : ''}${out.brokeTool ? ', wytrych pęka' : ''}`;
  return out;
}

/**
 * Próba hakowania urządzenia. MUTUJE stan zabezpieczenia.
 * Kryt. sukces = 2 warstwy, sukces = 1, porażka = nic, kryt. porażka = blokada urządzenia i alarm.
 */
export function hackDevice(ch: Character, dev: LockState, skill: SkillId, rng: Rng = Math.random, what = 'Urządzenie'): LockAttempt {
  const r = checkBy(ch, getStat(ch, skill), dev.dc, rng);
  const out: LockAttempt = { roll: r, skill, gained: r.degree === 3 ? 2 : r.degree === 2 ? 1 : 0, opened: false, brokeTool: false, jammed: false, broken: false, alarm: false, improvised: false, log: '' };
  dev.progress = Math.min(dev.needed, dev.progress + out.gained);
  out.opened = dev.progress >= dev.needed;
  if (r.degree === 0) {
    dev.jammed = true;
    out.jammed = true;
    out.alarm = true;
  }
  out.log = `${ch.name}: hakowanie (${what}) ${r.total} vs ST ${dev.dc} — ${used(r.degree)} [${dev.progress}/${dev.needed}]` +
    `${out.opened ? ', dostęp uzyskany!' : ''}${out.alarm ? ', BLOKADA I ALARM' : ''}`;
  return out;
}
