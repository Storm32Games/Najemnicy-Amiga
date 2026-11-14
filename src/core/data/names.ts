// Generator imion najemników + czyszczenie wpisanych imion (migracja z Oldgame/src/data/names.js).
// Czysty TypeScript - zero Phasera / DOM. Klimat: polska postapokalipsa.
// Wzorce: Imię "Ksywa" Nazwisko, Imię Nazwisko, sama ksywa ("Sowa"), Ksywa + Nazwisko, tytuł + ksywa, nomadzkie "X z Y", oznaczenia cyborgów.
import type { Rng } from '../rules/dice.ts';

export type Gender = 'm' | 'f';

export const NAME_MAX = 24;

const FIRST: Record<Gender, readonly string[]> = {
  m: ['Bogdan', 'Zenon', 'Kazik', 'Wiesiek', 'Marek', 'Tadek', 'Roman', 'Stefan', 'Jurek', 'Zbyszek', 'Józek', 'Leszek', 'Mirek', 'Witold', 'Bronek', 'Czesiek', 'Edek', 'Franek', 'Henryk', 'Janek', 'Antek', 'Waldek', 'Rysiek', 'Stach', 'Gienek', 'Lucjan', 'Bolek', 'Ignac', 'Maciej', 'Kuba', 'Szymon', 'Adam', 'Feliks', 'Tymon', 'Bartek', 'Damian'],
  f: ['Halina', 'Jadwiga', 'Grażyna', 'Bożena', 'Danka', 'Krystyna', 'Wanda', 'Zośka', 'Irena', 'Marta', 'Ewa', 'Agata', 'Hanka', 'Ola', 'Wiesia', 'Teresa', 'Dorota', 'Baśka', 'Jola', 'Kaśka', 'Renata', 'Gośka', 'Stefa', 'Lena', 'Mira', 'Nina', 'Tola', 'Ula', 'Iza', 'Weronika', 'Julka', 'Bronka'],
};
// Surnames: adjectival ones (-ski/-cki/-dzki/-ny/-wy) take the feminine form automatically.
const SURNAMES = ['Zawada', 'Kowal', 'Dymarski', 'Wroński', 'Rdest', 'Mazur', 'Sobczak', 'Kurek', 'Wilczek', 'Grabarz', 'Szewczyk', 'Kaczmarek',
  'Żuraw', 'Krawiec', 'Popiel', 'Bednarz', 'Skowron', 'Zięba', 'Rataj', 'Garbarz', 'Kołodziej', 'Ślusarz', 'Mielnik', 'Smolarek', 'Gajewski',
  'Brzeziński', 'Sikora', 'Gawron', 'Czajka', 'Rudnicki', 'Żelazny', 'Wierzbicki', 'Ostrowski', 'Pająk', 'Wróbel', 'Kruczek', 'Zając', 'Bagiński',
  'Siwy', 'Głodny', 'Rdzawy', 'Kamiński', 'Pyłko', 'Chmiel', 'Dziedzic', 'Starosta', 'Woźniak', 'Lisowski', 'Popławski', 'Duda', 'Gruszka', 'Kubiak'];
// Nicknames used in quotes (gender-neutral nouns).
const NICK = ['Młot', 'Kosa', 'Rdza', 'Kret', 'Ząb', 'Szczęka', 'Śruba', 'Klucz', 'Bagnet', 'Mżawka', 'Popiół', 'Żyleta', 'Wiertło', 'Bimber',
  'Trotyl', 'Gruz', 'Szakal', 'Pył', 'Hiena', 'Szpon', 'Kolec', 'Gwóźdź', 'Żwir', 'Rygiel', 'Zapałka', 'Dzwon', 'Puszka', 'Kanister', 'Bełt',
  'Łom', 'Grzechotka', 'Cegła', 'Smar', 'Krzemień', 'Sadza', 'Kapsel', 'Piła', 'Drut', 'Rykoszet', 'Czacha', 'Kotwica', 'Skorpion', 'Osa',
  'Szrapnel', 'Lont', 'Kastet', 'Brzytwa', 'Ćma', 'Mysz', 'Rtęć', 'Kawka', 'Węgielek', 'Fuks', 'Pech', 'Bazyl', 'Bunkier'];
// Single-word callsigns by class (like "Sowa", "Lut", "Bizon").
const CALL: Record<string, readonly string[]> = {
  soldier: ['Sierżant', 'Kapral', 'Taran', 'Okop', 'Granat', 'Salwa', 'Bagnet', 'Major', 'Stalowy', 'Hełm', 'Moździerz', 'Bastion', 'Wachta', 'Szaniec'],
  scout: ['Sowa', 'Jastrząb', 'Wiatr', 'Lis', 'Cień', 'Kania', 'Sokół', 'Ryś', 'Szept', 'Pustułka', 'Kruk', 'Tropiciel', 'Zmierzch', 'Mgła'],
  medic: ['Igła', 'Bandaż', 'Siostra', 'Szew', 'Plaster', 'Jodyna', 'Skalpel', 'Konował', 'Szpatułka', 'Spirytus', 'Pigułka', 'Opatrunek', 'Rumianek'],
  techie: ['Lut', 'Iskra', 'Bezpiecznik', 'Śrubka', 'Kabel', 'Dioda', 'Zwora', 'Cewka', 'Turbina', 'Tranzystor', 'Antena', 'Lampa', 'Bit', 'Akumulator'],
  scavenger: ['Szczurek', 'Kret', 'Sroka', 'Wytrych', 'Łasica', 'Pchła', 'Szperacz', 'Paser', 'Kuna', 'Kieszeń', 'Gałgan', 'Złomiarz', 'Fuks', 'Myszka'],
  gunslinger: ['Kruk', 'Colt', 'Rykoszet', 'Spust', 'Bęben', 'Kabura', 'Szeryf', 'Pojedynek', 'Proch', 'Łuska', 'Kurek', 'Ostroga'],
  champion: ['Mur', 'Bastion', 'Pawęż', 'Tarcza', 'Opoka', 'Strażnik', 'Przysięga', 'Zapora', 'Rygiel', 'Baszta'],
  alchemist: ['Retorta', 'Kwas', 'Siarka', 'Kolba', 'Opar', 'Zaczyn', 'Destylat', 'Saletra', 'Rtęć', 'Eter'],
  herald: ['Aksamit', 'Tuba', 'Werbel', 'Echo', 'Sygnał', 'Hejnał', 'Głos', 'Megafon', 'Pieśń', 'Okrzyk'],
  monk: ['Grzmot', 'Kastet', 'Garda', 'Sierp', 'Hak', 'Rundka', 'Nokaut', 'Gong', 'Podbródek', 'Klincz'],
  hacker: ['Zero', 'Bit', 'Port', 'Skrypt', 'Kursor', 'Bajt', 'Proxy', 'Glitch', 'Kernel', 'Ping'],
  brute: ['Bizon', 'Grzmot', 'Kowadło', 'Tur', 'Dzik', 'Łom', 'Głaz', 'Niedźwiedź', 'Taran', 'Buldożer', 'Walec', 'Kafar', 'Mamut', 'Pięść'],
};
const ANC = {
  mutant: { call: ['Pleśń', 'Glon', 'Ropucha', 'Bąbel', 'Szczaw', 'Mech', 'Narośl', 'Huba', 'Pokrzywa', 'Rzęsa', 'Grzyb', 'Jaszczur', 'Łuska', 'Kora', 'Trzmiel', 'Fosfor'],
    title: ['Doktor', 'Stary', 'Brat', 'Ciotka', 'Wujek', 'Mały', 'Zielony', 'Krzywy', 'Święty'] },
  cyborg: { call: ['Chrom', 'Tytan', 'Wolfram', 'Kobalt', 'Ołów', 'Magnez', 'Tłok', 'Sprężyna', 'Zębatka', 'Nit', 'Zawór', 'Rezystor', 'Bolec', 'Przekładnia'],
    serial: ['K', 'R', 'T', 'MK', 'ZX', 'B'] },
  nomad: { call: ['Sowa', 'Kruk', 'Wydma', 'Kurz', 'Burza', 'Piasek', 'Susza', 'Skwar', 'Ostów', 'Szarańcza', 'Sęp', 'Kojot', 'Wiatr', 'Pustułka', 'Żmija', 'Biegacz'],
    from: ['z Rdzawiska', 'ze Studni', 'z Wydm', 'zza Wydmy', 'od Karawany', 'z Płaskowyżu', 'spod Komina', 'z Pustych Torów', 'znad Szlamu'] },
};
const TITLE_HUMAN = ['Stary', 'Mała', 'Wielki', 'Kapitan', 'Sierżant', 'Doktor', 'Szef', 'Dziadek', 'Babka'];


const pick = <T>(a: readonly T[], rng: Rng): T => a[Math.floor(rng() * a.length) % a.length];

/** Żeńska forma przymiotnikowego nazwiska. */
export function femSurname(s: string): string {
  if (/(ski|cki|dzki)$/.test(s)) return s.slice(0, -1) + 'a';
  if (/[^aeiouyąęó]y$/.test(s)) return s.slice(0, -1) + 'a'; // Żelazny -> Żelazna, Siwy -> Siwa
  return s;
}
const surname = (g: Gender, rng: Rng): string => {
  const s = pick(SURNAMES, rng);
  return g === 'f' ? femSurname(s) : s;
};
const FEM: Record<string, string> = { Stary: 'Stara', Wielki: 'Wielka', Mały: 'Mała', Zielony: 'Zielona', Krzywy: 'Krzywa', Święty: 'Święta', Brat: 'Siostra', Wujek: 'Ciotka', Dziadek: 'Babka', Stalowy: 'Stalowa' };
const MASC: Record<string, string> = { Mała: 'Mały', Ciotka: 'Wujek', Babka: 'Dziadek' };
const fem = (w: string, g: Gender): string => (g === 'f' ? FEM[w] : MASC[w]) ?? w;

export interface NameOptions {
  ancestry?: string;
  classId?: string;
  gender?: Gender | null;
  taken?: Iterable<string>;
  rng?: Rng;
}

/** Jedno losowe imię (bez sprawdzania `taken`). */
function rawName(o: NameOptions): string {
  const rng = o.rng ?? Math.random;
  const ancestry = o.ancestry ?? 'human';
  const g: Gender = o.gender === 'f' || o.gender === 'm' ? o.gender : rng() < 0.4 ? 'f' : 'm';
  const call = CALL[o.classId ?? 'soldier'] ?? CALL.soldier;
  const first = (): string => pick(FIRST[g], rng);
  const r = rng();
  if (ancestry === 'mutant') {
    const A = ANC.mutant;
    if (r < 0.35) return pick(A.call, rng);
    if (r < 0.65) return fem(pick(A.title, rng), g) + ' ' + pick(A.call, rng);
    if (r < 0.85) return `${first()} "${pick(A.call, rng)}"`;
    return pick(call, rng);
  }
  if (ancestry === 'cyborg') {
    const A = ANC.cyborg;
    if (r < 0.3) return pick(A.call, rng);
    if (r < 0.55) return `${pick(A.call, rng)}-${2 + Math.floor(rng() * 98)}`;
    if (r < 0.7) return `${pick(A.serial, rng)}-${10 + Math.floor(rng() * 890)} "${pick([...A.call, ...call], rng)}"`;
    if (r < 0.85) return `${first()} "${pick(A.call, rng)}" ${surname(g, rng)}`;
    return pick(call, rng);
  }
  if (ancestry === 'nomad') {
    const A = ANC.nomad;
    if (r < 0.35) return pick(A.call, rng);
    if (r < 0.6) return pick(A.call, rng) + ' ' + pick(A.from, rng);
    if (r < 0.8) return pick(A.call, rng) + ' ' + surname(g, rng);
    return `${first()} ${pick(A.from, rng)}`;
  }
  if (r < 0.28) return `${first()} "${pick(NICK, rng)}" ${surname(g, rng)}`;
  if (r < 0.46) return pick(rng() < 0.6 ? call : NICK, rng);
  if (r < 0.64) return pick([...call, ...NICK], rng) + ' ' + surname(g, rng);
  if (r < 0.8) return `${first()} ${surname(g, rng)}`;
  if (r < 0.9) return `${first()} "${pick([...NICK, ...call], rng)}"`;
  return fem(pick(TITLE_HUMAN, rng), g) + ' ' + first();
}

const key = (s: string): string => s.toLocaleLowerCase('pl').replace(/["\s.\-]+/g, ' ').trim();

/** Losowe imię mieszczące się w NAME_MAX i nieobecne w `taken` (porównanie bez wielkości liter). */
export function generateName(opts: NameOptions = {}): string {
  const taken = new Set([...(opts.taken ?? [])].map(key));
  let n = '';
  for (let i = 0; i < 60; i++) {
    n = rawName(opts);
    if (n.length <= NAME_MAX && !taken.has(key(n))) return n;
  }
  return n.slice(0, NAME_MAX);
}

/**
 * Czyści wpisane imię: NFC, cudzysłowy typograficzne -> ", tylko litery/cyfry/spacja/-/./" , najwyżej jedna para cudzysłowów,
 * zwinięte spacje, maks. NAME_MAX znaków. Zwraca '' gdy nic użytecznego nie zostało.
 */
export function sanitizeName(raw: string): string {
  let s = String(raw ?? '').normalize('NFC').replace(/[„”“«»″]/g, '"').replace(/[’‘`´']/g, '');
  s = s.replace(/[^\p{L}\p{M}\p{N} .\-"]/gu, ' ');
  let q = 0;
  s = s.replace(/"/g, () => (++q <= 2 ? '"' : ''));
  if (q === 1) s = s.replace('"', ' ');
  s = s.replace(/"\s*([^"]*?)\s*"/, (_m, inner: string) => (inner ? `"${inner}"` : ' '));
  s = s.replace(/(\S)"(?=[^"]*"[^"]*$)/, '$1 "').replace(/^([^"]*"[^"]*")(\S)/, '$1 $2');
  s = s.replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, NAME_MAX).join('').trim();
  if ((s.match(/"/g) ?? []).length === 1) s = s.replace('"', '').replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(s)) return '';
  return s;
}

/** Sprawdza wpisane imię względem drużyny. */
export function checkName(raw: string, taken: Iterable<string> = []): { ok: boolean; name: string; error: string } {
  const name = sanitizeName(raw);
  if (!name) return { ok: false, name, error: 'Imię nie może być puste.' };
  if (name.replace(/[\s"]/g, '').length < 2) return { ok: false, name, error: 'Imię jest za krótkie.' };
  if ([...taken].some((t) => key(t) === key(name))) return { ok: false, name, error: 'Ktoś w drużynie już tak się nazywa.' };
  return { ok: true, name, error: '' };
}

/** Imię bez ksywy w cudzysłowie ("Hak "Młot" Zawada" -> "Hak Zawada"); sama ksywa zostaje. */
export function plainName(name: string): string {
  const s = String(name || '').replace(/"[^"]*"\s*/g, '').replace(/\s+/g, ' ').trim();
  return s || String(name || '').replace(/"/g, '').trim();
}
/** Krótka forma: pierwsze słowo plainName ("Hak", "Sowa", "Doktor"). */
export const shortName = (name: string): string => plainName(name).split(' ')[0] || String(name || '');

/** Kolory imienia do wyboru (null = domyślny). */
export const NAME_COLORS: readonly (string | null)[] = [null, '#f2a93b', '#ff6a50', '#ff7ac0', '#c890ff', '#6ab0ff', '#40d8d0', '#8fe06a', '#e8e060', '#ffffff', '#b8a888'];
