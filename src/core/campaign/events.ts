// Losowe zdarzenia w podróży (dane). Migracja z Oldgame/src/data/events.js; logika: campaign/travel.ts.
// Każdy wybór rozstrzyga test umiejętności najlepszego członka drużyny.
// Klucze `out` = stopień sukcesu: 0 krytyczna porażka, 1 porażka, 2 sukces, 3 krytyczny sukces.
import type { SkillId } from '../data/types.ts';

/** Skutek zdarzenia. items: id przedmiotu albo '@typ' (losowy), hp: obrażenia losowego członka drużyny. */
export interface EventOutcome {
  readonly text: string;
  readonly scrap?: number;
  readonly items?: readonly string[];
  readonly hp?: string | number;
  readonly rep?: { readonly nomads?: number; readonly survivors?: number };
  /** PD dla każdego. */
  readonly xp?: number;
  /** Zmiana czasu podróży w dniach (ujemna = zysk). */
  readonly days?: number;
}
export interface EventChoice {
  readonly label: string;
  /** null = wybór bez testu (automatyczny sukces). */
  readonly skill: SkillId | null;
  /** 'level' = ST wg poziomu zlecenia. */
  readonly dc?: 'level' | number;
  readonly out: Readonly<Partial<Record<0 | 1 | 2 | 3, EventOutcome>>>;
}
export interface TravelEvent {
  readonly id: string;
  readonly title: string;
  readonly weight: number;
  readonly text: string;
  readonly choices: readonly EventChoice[];
}

export const EVENTS: readonly TravelEvent[] = [
  { id: 'trader', title: 'Karawana Nomadów', weight: 3,
    text: 'Na wydmie błyska lusterko. Mała karawana Nomadów zwija obóz — handlarz macha do Was, jakby czekał od rana.',
    choices: [
      { label: 'Potargować się', skill: 'diplomacy', dc: 'level', out: {
        0: { text: 'Handlarz obraża się i zdziera z Was haracz za „zepsute targowanie".', scrap: -15 },
        1: { text: 'Cena jest absurdalna. Odchodzicie z niczym.' },
        2: { text: 'Dobijacie targu: kupujecie sprzęt za pół ceny.', items: ['@consumable'] },
        3: { text: 'Handlarz jest pod wrażeniem. Dorzuca prezent i dobre słowo o Was wśród Nomadów.', items: ['@consumable', '@any'], rep: { nomads: 1 } } } },
      { label: 'Wymienić plotki', skill: 'society', dc: 'level', out: {
        0: { text: 'Plotki okazują się pułapką na naiwnych. Tracicie trochę Złomu.', scrap: -10 },
        1: { text: 'Nic nowego. Machacie sobie na pożegnanie.' },
        2: { text: 'Nomadzi sprzedają informację o ukrytym składzie.', scrap: 25 },
        3: { text: 'Mapa skrytki! Wasze kieszenie robią się cięższe.', scrap: 60 } } },
    ] },
  { id: 'radstorm', title: 'Burza radioaktywna', weight: 3,
    text: 'Horyzont ciemnieje, a geiger zaczyna rzęzić jak szalony. Idzie burza pyłowa niosąca skażenie. Trzeba coś zrobić — szybko.',
    choices: [
      { label: 'Znaleźć schronienie', skill: 'survival', dc: 'level', out: {
        0: { text: 'Schronienie okazuje się dziurawe. Burza trawi Was przez godziny.', hp: '2d6' },
        1: { text: 'Przeczekujecie burzę, ale bez rewelacji — każdy nałykał się pyłu.', hp: '1d6' },
        2: { text: 'Znajdujecie betonową rurę. Burza przechodzi bokiem.' },
        3: { text: 'Pod osłoną wraku znajdujecie czyjąś skrytkę z zapasami.', items: ['@consumable'] } } },
      { label: 'Przebić się mimo wszystko', skill: 'athletics', dc: 'level', out: {
        0: { text: 'Pył zasypuje oczy. Potykacie się, kaszlecie krwią.', hp: '2d6' },
        1: { text: 'Docieracie na miejsce poobijani i skażeni.', hp: '1d6' },
        2: { text: 'Silne plecy i mokre szmaty na twarzach — przeszliście.' },
        3: { text: 'Burza zostaje w tyle. Nawet zyskujecie dzień czasu.', days: -1 } } },
    ] },
  { id: 'ambush', title: 'Zasadzka Szabrowników', weight: 3,
    text: 'Coś nie gra. Cisza, zbyt równo ułożone kamienie przy drodze, odblask lunety między skałami. Szabrownicy czekają za zakrętem.',
    choices: [
      { label: 'Wypatrzyć ich pierwsi', skill: 'perception', dc: 'level', out: {
        0: { text: 'Za późno! Seria z karabinu rani Was, zanim sięgniecie po broń.', hp: '2d6', scrap: -20 },
        1: { text: 'Widzicie ich, ale oni Was też. Ostrzał zadaje rany.', hp: '1d6' },
        2: { text: 'Mijacie zasadzkę szerokim łukiem. Szabrownicy nawet nie zauważyli.' },
        3: { text: 'Zaskakujecie ich. Rozbrajacie pułapkę i zabieracie ich zapasy.', scrap: 30, xp: 20 } } },
      { label: 'Przekraść się ukradkiem', skill: 'stealth', dc: 'level', out: {
        0: { text: 'Kamień usuwa się spod nogi. Strzały! Uciekacie zdyszani.', hp: '2d6' },
        1: { text: 'Prawie. Ktoś Was zauważył i posłał kilka kul na pożegnanie.', hp: '1d6' },
        2: { text: 'Bezszelestnie obchodzicie zasadzkę.' },
        3: { text: 'Wymykacie się, a przy okazji zwijacie im kilka rzeczy z obozu.', items: ['@consumable'], xp: 20 } } },
    ] },
  { id: 'cache', title: 'Opuszczona skrzynia', weight: 3,
    text: 'W cieniu wraku autobusu stoi wojskowa skrzynia z solidnym zamkiem. Nikogo wokół — albo tak się wydaje.',
    choices: [
      { label: 'Otworzyć wytrychem', skill: 'thievery', dc: 'level', out: {
        0: { text: 'Zamek ma pułapkę! Iskry i gaz. Skrzynia jest pusta.', hp: '1d6' },
        1: { text: 'Zamek ani drgnie. Tracicie tylko czas.' },
        2: { text: 'Klik! W środku leży sprzęt i trochę Złomu.', scrap: 40, items: ['@consumable'] },
        3: { text: 'Skrzynia wojskowa pełna po brzegi. Dobry dzień dla Najemników.', scrap: 80, items: ['@any', '@consumable'] } } },
      { label: 'Rozebrać zawiasy', skill: 'crafting', dc: 'level', out: {
        0: { text: 'Narzędzie ślizga się i kaleczy dłoń.', hp: '1d4' },
        1: { text: 'Zawiasy zardzewiałe na amen. Odpuszczacie.' },
        2: { text: 'Skrzynia otwarta. Kilka przydatnych drobiazgów.', scrap: 35, items: ['@consumable'] },
        3: { text: 'Pod fałszywym dnem leży prawdziwy skarb.', scrap: 70, items: ['@any'] } } },
    ] },
  { id: 'stranger', title: 'Ranny nieznajomy', weight: 3,
    text: 'Przy drodze leży człowiek, trzyma się za brzuch. Mówi, że zaatakowały go mutanty. Krew na piasku jest jeszcze świeża.',
    choices: [
      { label: 'Opatrzyć rany', skill: 'medicine', dc: 'level', out: {
        0: { text: 'Pacjent umiera Wam na rękach. Zostaje tylko poczucie winy.', rep: { survivors: -1 } },
        1: { text: 'Opatrunek wystarczył na kilka godzin. Mężczyzna odchodzi o własnych siłach, nic nie mówiąc.' },
        2: { text: 'Mężczyzna dochodzi do siebie. W podzięce oddaje Wam trochę Złomu.', scrap: 30, rep: { survivors: 1 } },
        3: { text: 'Okazuje się kurierem Przystani. Odwdzięcza się hojnie i opowiada o Was wszędzie.', scrap: 50, items: ['@consumable'], rep: { survivors: 2 } } } },
      { label: 'Przeszukać i iść dalej', skill: 'thievery', dc: 'level', out: {
        0: { text: 'To była pułapka! „Ranny" wyciąga nóż.', hp: '1d8' },
        1: { text: 'Nic przy nim nie ma. Odchodzicie ze złym smakiem w ustach.', rep: { survivors: -1 } },
        2: { text: 'Znajdujecie coś cennego. Sumienie milczy.', scrap: 25, rep: { survivors: -1 } },
        3: { text: 'Pod kurtką ukrył cenną rzecz. Nikt się nie dowie.', scrap: 45, rep: { survivors: -1 } } } },
    ] },
  { id: 'bridge', title: 'Zawalony wiadukt', weight: 2,
    text: 'Wiadukt, którym biegnie szlak, runął. Z drugiej strony przepaści widać dymiącą drogę. Objazd zająłby dzień.',
    choices: [
      { label: 'Przejść po belkach', skill: 'acrobatics', dc: 'level', out: {
        0: { text: 'Belka pęka. Spadacie boleśnie z kilku metrów.', hp: '2d6' },
        1: { text: 'Przechodzicie, ale trzy razy prawie ginąc. Ktoś zdarł sobie skórę.', hp: '1d6' },
        2: { text: 'Linia po linii, przechodzicie na drugą stronę.' },
        3: { text: 'Idzie jak po sznurku — wasza zwinność zostanie zapamiętana.', xp: 20 } } },
      { label: 'Zbudować przeprawę', skill: 'crafting', dc: 'level', out: {
        0: { text: 'Konstrukcja zawala się w trakcie. Rany i stracony sprzęt.', hp: '1d6', scrap: -15 },
        1: { text: 'Budowa trwa cały dzień.', days: 1 },
        2: { text: 'Kilka desek, lina i sprytny węzeł. Przeprawa gotowa.' },
        3: { text: 'Z gruzu wydobywacie jeszcze nadające się do użytku części.', scrap: 30 } } },
    ] },
  { id: 'wreck', title: 'Wrak konwoju', weight: 2,
    text: 'Szkielety ciężarówek tkwią w piasku. Ktoś już tu był — ale ktoś zawsze coś przegapi.',
    choices: [
      { label: 'Przeszukać wraki', skill: 'perception', dc: 'level', out: {
        0: { text: 'Pod blachą gnieździ się mutant-padlinożerca. Gryzie!', hp: '1d8' },
        1: { text: 'Tylko rdza i szkielety.' },
        2: { text: 'Znajdujecie schowek w podwoziu.', scrap: 30, items: ['@consumable'] },
        3: { text: 'Ukryty ładunek! Ktoś kiedyś bardzo go pilnował.', scrap: 60, items: ['@any'] } } },
      { label: 'Rozmontować na złom', skill: 'crafting', dc: 'level', out: {
        0: { text: 'Resztka paliwa zapala się. Poparzenia.', hp: '1d6' },
        1: { text: 'Same śruby. Mało pożytku.', scrap: 10 },
        2: { text: 'Dobry kawał metalu na sprzedaż.', scrap: 45 },
        3: { text: 'Działający akumulator i cenne części.', scrap: 75, items: ['@tech'] } } },
    ] },
  { id: 'beasts', title: 'Stado mutantów', weight: 2,
    text: 'Z wydm wynurza się stado kudłatych, sześcionogich stworzeń. Węszą w Waszą stronę i zbliżają się powoli.',
    choices: [
      { label: 'Uspokoić je', skill: 'nature', dc: 'level', out: {
        0: { text: 'Rozjuszone zwierzęta atakują. Ledwo uciekacie.', hp: '2d6' },
        1: { text: 'Cofają się niechętnie, ale kilka razy Was ugryzło.', hp: '1d6' },
        2: { text: 'Zwierzęta rozchodzą się, jakby nic się nie stało.' },
        3: { text: 'Przewodnik stada daje się pogłaskać. Znajdujecie coś w jego legowisku.', items: ['@consumable'], xp: 20 } } },
      { label: 'Odstraszyć wrzaskiem', skill: 'intimidation', dc: 'level', out: {
        0: { text: 'Rzucają się wprost na Was.', hp: '2d6' },
        1: { text: 'Odsuwają się, ale ciągnęli Was za nogawki jeszcze godzinę.', hp: '1d4' },
        2: { text: 'Stado ucieka z piskiem.' },
        3: { text: 'Uciekając, zostawiają zapasy.', scrap: 25, xp: 20 } } },
    ] },
  { id: 'signal', title: 'Dziwny sygnał radiowy', weight: 2,
    text: 'Stary nadajnik w Waszym plecaku nagle zaczyna syczeć. Przez trzaski przebija się czyjś głos, powtarzający liczby.',
    choices: [
      { label: 'Namierzyć źródło', skill: 'crafting', dc: 'level', out: {
        0: { text: 'Sprzężenie zwrotne wypala radio i uszy.', hp: '1d4', scrap: -10 },
        1: { text: 'Sygnał urywa się w połowie.' },
        2: { text: 'Namierzacie starą stację przekaźnikową z zapasami.', scrap: 35, items: ['@tech'] },
        3: { text: 'To automatyczny skład wojskowy! Pełen użytecznych rzeczy.', scrap: 70, items: ['@tech', '@consumable'] } } },
      { label: 'Zignorować', skill: null, out: { 2: { text: 'Wyłączacie radio. Co w nim było, nigdy się nie dowiecie.' } } },
    ] },
  { id: 'guide', title: 'Wędrowiec z pustkowi', weight: 2,
    text: 'Samotny Nomad siedzi przy dogasającym ognisku. Zna okolicę lepiej niż Wy własne kieszenie i wygląda, jakby miał ochotę na rozmowę.',
    choices: [
      { label: 'Poprosić o skrót', skill: 'diplomacy', dc: 'level', out: {
        0: { text: 'Źle zrozumiał prośbę — wyprowadza Was na manowce.', days: 1 },
        1: { text: 'Kręci głową. Skrótów nie sprzedaje.' },
        2: { text: 'Pokazuje ścieżkę znaną tylko Nomadom. Zyskujecie czas.', days: -1, rep: { nomads: 1 } },
        3: { text: 'Z honorami prowadzi Was dalej i opowiada o Was przy ogniskach.', days: -1, rep: { nomads: 2 }, items: ['@consumable'] } } },
      { label: 'Wypytać o szlaki', skill: 'survival', dc: 'level', out: {
        0: { text: 'Źle zapamiętujecie drogę i traficie na pole minowe.', hp: '1d6' },
        1: { text: 'Nic konkretnego.' },
        2: { text: 'Dowiadujecie się, gdzie najlepiej szukać zapasów.', scrap: 30 },
        3: { text: 'Ma dla Was mapę kilku skrytek.', scrap: 60, rep: { nomads: 1 } } } },
    ] },
];

// ---------------- Atak zmutowanej bestii w drodze (Oldgame/src/scenes/worldmap.js: spawnFauna/fightFauna)

/** Szansa, że w podróży szarżuje zmutowana bestia (niezależnie od zwykłego zdarzenia). */
export const FAUNA_CHANCE = 0.22;

/** Gatunki bestii na mapie regionu: id szablonu wroga (wygląd) + polska nazwa. */
export const FAUNA_KINDS: readonly { readonly templateId: string; readonly name: string }[] = [
  { templateId: 'dog_mutant', name: 'pies' },
  { templateId: 'rat_mutant', name: 'szczur' },
  { templateId: 'scorpion', name: 'skorpion' },
  { templateId: 'kretowij', name: 'kretowij' },
  // gatunki tylko z mapy regionu (bez szablonu wroga - wygląd po samym id)
  { templateId: 'wolf_beast', name: 'wilk' },
  { templateId: 'boar_beast', name: 'dzik' },
  { templateId: 'spider', name: 'pająk' },
  { templateId: 'beetle', name: 'chrząszcz' },
];

/** Zdarzenie "Atak: zmutowany <name>". Wybór 0 (walka) zakończony sukcesem zabija bestię. */
export function faunaAttackEvent(name: string): TravelEvent {
  const N = name[0].toUpperCase() + name.slice(1);
  return {
    id: 'fauna_attack', title: `Atak: zmutowany ${name}`, weight: 0,
    text: `${N} wypada zza wydmy prosto na Was — za duży, za szybki, a jego narośla świecą w półmroku. Nie ma czasu na ustawienie szyku.`,
    choices: [
      { label: 'Walczcie!', skill: 'athletics', dc: 'level', out: {
        0: { text: `${N} rozrywa szyk i znika z kawałkiem czyjegoś ekwipunku w pysku. Ktoś mocno krwawi.`, hp: '2d6', scrap: -10 },
        1: { text: 'Odpieracie atak, ale bestia zdążyła kogoś poharatać, zanim uciekła.', hp: '1d6', xp: 15 },
        2: { text: `${N} pada. Wycinacie gruczoł — alchemicy w Przystani dobrze za niego zapłacą.`, items: ['mutant_gland'], xp: 40 },
        3: { text: 'Czysta robota: jedno uderzenie, jedno truchło. Przy legowisku znajdujecie resztki po mniej szczęśliwych podróżnych.', items: ['mutant_gland', '@consumable'], scrap: 15, xp: 60 } } },
      { label: 'Odstraszcie ją ogniem i krzykiem', skill: 'intimidation', dc: 'level', out: {
        0: { text: 'Krzyk tylko ją rozjusza. Zanim odpuści, ktoś obrywa.', hp: '1d8' },
        1: { text: 'Bestia krąży, kąsa i dopiero po chwili daje za wygraną.', hp: '1d4' },
        2: { text: `${N} cofa się, warczy i odchodzi w pustkowia.`, xp: 20 },
        3: { text: 'Bestia podkula ogon i ucieka. Wy idziecie dalej raźniejszym krokiem.', xp: 35 } } },
      { label: 'Uciekajcie między skały', skill: 'acrobatics', dc: 'level', out: {
        0: { text: 'Ktoś się potyka. Bestia dopada go pierwsza, a kluczenie kosztuje Was dzień.', hp: '1d8', days: 1 },
        1: { text: 'Gubicie ją, ale nadkładacie drogi.', days: 1 },
        2: { text: 'Gubicie bestię w rumowisku i wracacie na szlak.' },
        3: { text: 'Znikacie jej z oczu tak sprawnie, że po drodze trafiacie na czyjś porzucony schowek.', items: ['@consumable'] } } },
    ],
  };
}
