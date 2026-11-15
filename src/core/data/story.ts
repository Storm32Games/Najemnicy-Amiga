// Teksty fabularne (migracja z Oldgame/src/data/story.js). Pure data, zero Phaser/Three.js dependencies.

export type IntroSlideId = 'bomb' | 'ruins' | 'raiders' | 'nomads' | 'haven' | 'crew';

export interface IntroSlide {
  readonly id: IntroSlideId;
  readonly text: string;
}

export const INTRO_SLIDES: readonly IntroSlide[] = [
  { id: 'bomb', text: 'Rok 2041. Nikt już nie pamięta, kto wystrzelił pierwszy. Pamięta się tylko światło — jaśniejsze niż słońce — i ciszę, która nadeszła po nim.' },
  { id: 'ruins', text: 'Miasta zamieniły się w Rdzawisko: labirynt zwęglonych wieżowców, skażonych piwnic i stalowych szkieletów. W cieniu czają się mutanty, a w ruinach rządzi głód.' },
  { id: 'raiders', text: 'Najgorsi są Szabrownicy. Zdegenerowane bandy, które mordują dla puszki konserw i błyskotki z dawnego świata. Najkrwawszą z nich dowodzi Kostucha, wódz Żelaznych Szczęk.' },
  { id: 'nomads', text: 'Na pustkowiach, z dala od ruin, wędrują Nomadzi. Twardzi, milczący handlarze, którzy przeżyli, bo znają każdą wydmę, każdą studnię i każdą burzę pyłową.' },
  { id: 'haven', text: 'Ci, którzy nie chcą uciekać, odbudowują życie w Przystani — dawnej zajezdni kolejowej na skraju Martwego Miasta. Mają mury, światło i nadzieję. Brakuje im tylko ludzi, którzy potrafią strzelać.' },
  { id: 'crew', text: 'To zadanie dla Najemników. Cztery osoby, jedna umowa, tyle Złomu, ile zdołasz zarobić. Zbierz drużynę. Przyjmij zlecenie. Przeżyj.' },
];

export const EPILOGUE: readonly string[] = [
  'Kostucha padła, a Żelazne Szczęki rozsypały się jak zardzewiały łańcuch.',
  'Karawany Nomadów wróciły na stare szlaki. W Przystani zapalono wszystkie lampy naraz.',
  'Rdzawisko wciąż jest pełne mutantów i złomu — ale ktoś w nim wreszcie śpi spokojnie.',
  'Nazywają Was teraz Najemnikami z Przystani. Jest jeszcze mnóstwo zleceń.',
];

export const GAME_TITLE = 'PYŁ I RDZA';
export const GAME_SUBTITLE = 'NAJEMNICY';

export const CREDITS: readonly (readonly [string, string])[] = [
  ['Autor', 'Robert Magdziarz'],
  ['Studio', 'STORM 32'],
  ['Reguły', 'Pathfinder 2e (adaptacja postapokaliptyczna)'],
  ['Grafika', 'rysowana w całości w kodzie'],
  ['Dźwięk i muzyka', 'syntezowane w locie — zero plików audio'],
  ['Silnik', 'Phaser + TypeScript'],
  ['Dziękujemy', 'Każdemu, kto przeżył Rdzawisko'],
];

export const GAMEOVER_LINES: readonly string[] = [
  'Pustkowia nie wybaczają. Ani szybkości, ani dumy, ani źle policzonej amunicji.',
  'Wiatr zasypuje ślady, a Przystań zapala lampy dla kolejnej drużyny.',
];

export const TIPS: readonly string[] = [
  'Wskazówka: Medyk potrafi uratować umierającego sojusznika — nie zostawiaj nikogo bez opieki.',
  'Wskazówka: Osłony dają +2 do KP. Płot, beczka i wrak to Twoi przyjaciele.',
  'Wskazówka: Handlarze Nomadów oferują lepsze ceny, gdy ich lubisz.',
];
