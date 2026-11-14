// Name generator for mercenaries + sanitising of typed names. Pure JS (no DOM), runs in Node too.
// Flavour: Polish post-apocalypse. Patterns: Imię "Ksywa" Nazwisko, Imię Nazwisko, single callsign ("Sowa"),
// Ksywa + Nazwisko ("Igła Wrońska"), title + nickname ("Doktor Pleśń"), nomad "X z Y", cyborg designations.
// generateName({ancestry, classId, gender:'m'|'f'|null, taken:[names], rng}) -> string (<= NAME_MAX chars)

export const NAME_MAX = 24;

const FIRST = {
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
const CALL = {
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

const pick = (a, rng) => a[Math.floor(rng() * a.length) % a.length];
/** Feminine form of an adjectival Polish surname. */
export function femSurname(s) {
  if (/(ski|cki|dzki)$/.test(s)) return s.slice(0, -1) + 'a';
  if (/[^aeiouyąęó]y$/.test(s)) return s.slice(0, -1) + 'a';     // Żelazny -> Żelazna, Siwy -> Siwa
  return s;
}
const surname = (g, rng) => { const s = pick(SURNAMES, rng); return g === 'f' ? femSurname(s) : s; };
const fem = (w, g) => g === 'f' ? ({ Stary: 'Stara', Wielki: 'Wielka', Mały: 'Mała', Zielony: 'Zielona', Krzywy: 'Krzywa', 'Święty': 'Święta', Brat: 'Siostra', Wujek: 'Ciotka', Dziadek: 'Babka', Stalowy: 'Stalowa' }[w] || w)
  : ({ Mała: 'Mały', Ciotka: 'Wujek', Babka: 'Dziadek' }[w] || w);

/** One random name (not checked against `taken`). */
function rawName({ ancestry = 'human', classId = 'soldier', gender, rng = Math.random } = {}) {
  const g = gender === 'f' || gender === 'm' ? gender : (rng() < 0.4 ? 'f' : 'm');
  const call = CALL[classId] || CALL.soldier;
  const first = () => pick(FIRST[g], rng);
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
    if (r < 0.8) return pick(A.call, rng) + ' ' + surname(g, rng);       // "Kruk Dymarski"
    return `${first()} ${pick(A.from, rng)}`;
  }
  // human (and anything else)
  if (r < 0.28) return `${first()} "${pick(NICK, rng)}" ${surname(g, rng)}`;   // Hak "Młot" Zawada
  if (r < 0.46) return pick(rng() < 0.6 ? call : NICK, rng);                    // Szczurek, Grzmot
  if (r < 0.64) return pick([...call, ...NICK], rng) + ' ' + surname(g, rng);  // Igła Wrońska
  if (r < 0.8) return `${first()} ${surname(g, rng)}`;
  if (r < 0.9) return `${first()} "${pick([...NICK, ...call], rng)}"`;
  return fem(pick(TITLE_HUMAN, rng), g) + ' ' + first();                       // Stary Bogdan
}

const key = (s) => String(s || '').toLocaleLowerCase('pl').replace(/["\s.\-]+/g, ' ').trim();

/** A random name that fits NAME_MAX and is not in `taken` (array/Set of names, compared case-insensitively). */
export function generateName(opts = {}) {
  const taken = new Set([...(opts.taken || [])].map(key));
  let n = '';
  for (let i = 0; i < 60; i++) { n = rawName(opts); if (n.length <= NAME_MAX && !taken.has(key(n))) return n; }
  return n.slice(0, NAME_MAX);
}

/**
 * Clean a typed name: NFC, typographic quotes -> ", only letters/digits/space/-/./" kept (no markup characters),
 * at most one pair of quotes, collapsed spaces, max NAME_MAX characters. Returns '' if nothing usable is left.
 */
export function sanitizeName(raw) {
  let s = String(raw ?? '').normalize('NFC').replace(/[„”“«»″]/g, '"').replace(/[’‘`´']/g, '');
  s = s.replace(/[^\p{L}\p{M}\p{N} .\-"]/gu, ' ');                 // no < > & ' = / etc.
  let q = 0; s = s.replace(/"/g, () => (++q <= 2 ? '"' : ''));       // at most one quoted nickname
  if (q === 1) s = s.replace('"', ' ');
  s = s.replace(/"\s*([^"]*?)\s*"/, (m, inner) => inner ? `"${inner}"` : ' ');   // `" Młot "` -> `"Młot"`, `""` dropped
  s = s.replace(/(\S)"(?=[^"]*"[^"]*$)/, '$1 "').replace(/^([^"]*"[^"]*")(\S)/, '$1 $2');   // space around the quoted part
  s = s.replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, NAME_MAX).join('').trim();
  if ((s.match(/"/g) || []).length === 1) s = s.replace('"', '').replace(/\s+/g, ' ').trim();   // cut through the nickname
  if (!/[\p{L}\p{N}]/u.test(s)) return '';
  return s;
}

/** Validate a typed name against the party. -> {ok, name, error} */
export function checkName(raw, taken = []) {
  const name = sanitizeName(raw);
  if (!name) return { ok: false, name, error: 'Imię nie może być puste.' };
  if (name.replace(/[\s"]/g, '').length < 2) return { ok: false, name, error: 'Imię jest za krótkie.' };
  if ([...taken].some(t => key(t) === key(name))) return { ok: false, name, error: 'Ktoś w drużynie już tak się nazywa.' };
  return { ok: true, name, error: '' };
}

/** Name without the quoted nickname ("Hak "Młot" Zawada" -> "Hak Zawada"); a nickname-only name keeps the nickname. */
export function plainName(name) {
  const s = String(name || '').replace(/"[^"]*"\s*/g, '').replace(/\s+/g, ' ').trim();
  return s || String(name || '').replace(/"/g, '').trim();
}
/** Short form for tight spots: first word of plainName ("Hak", "Sowa", "Doktor"). */
export function shortName(name) { return plainName(name).split(' ')[0] || String(name || ''); }
