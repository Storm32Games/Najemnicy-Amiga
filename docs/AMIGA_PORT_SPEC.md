# Pył i Rdza: Najemnicy — specyfikacja logiki do portu na A1200 + PiStorm Lite 32 (C99 + miniGL)

Stan na 2026-11-16 (commit `3338c7f`). Źródło prawdy to nadal `src/core/` — ten dokument opisuje, **co** port musi
odtworzyć i **jak**, a liczby bierze z wygenerowanych plików (niżej), żeby nic nie było przepisywane ręcznie.
Ekrany startowe (logo, intro, menu) i ograniczenia sprzętu: `docs/AMIGA_MINIGL.md`.

## 0. Pliki dla portu

`node tools/amiga/export_data.ts` generuje z `src/core` (uruchamiaj po każdej zmianie zasad lub danych):

| Plik | Zawartość | Użycie w porcie |
|---|---|---|
| `amiga/data/game_data.json` | wszystkie tabele: rasy, klasy, przedmioty, wrogowie, zdolności, rekruci, stany, umiejętności, stałe zasad, zamki, zdarzenia podróży, zlecenia fabularne, sektory regionu, teksty fabuły, `SIN_LUT`, `EASE_OUT3_LUT` | wejście dla generatora nagłówków C (`static const`) |
| `amiga/data/test_vectors.json` | oczekiwane wyniki: `hashSeed`, mulberry32 (uint32), karty 16 rekrutów na poz. 1/5/10, 17 wrogów w wersji słabej/zwykłej/elitarnej, 32 ataki z ziarnem, 12 map (3 na biom) | testy jednostkowe portu: C musi dać identyczne liczby |
| `amiga/data/region_height.bin` | siatka wysokości regionu 145×97 × int16 **big-endian** (Q8) | wczytywana wprost do pamięci 68k |
| `amiga/src/data/gamedata.h` + `gamedata.c` (`node tools/amiga/gen_headers.ts`) | enumy id, struktury i tabele `const` C99: rasy, klasy (z progresją), przedmioty, wrogowie, zdolności, rekruci, stany, zamki, zdarzenia podróży (+ szablon ataku fauny z `{N}`/`{n}`), szablony zleceń, zlecenia fabularne, stałe zasad, teksty (ISO-8859-2), `SIN_LUT` (Q14), `EASE_OUT3_LUT` | kompilowane do gry; `make -C amiga test` (natywnie) i `make -C amiga m68k` (68020) |

Konwencje nagłówków: kości jako `Dice {n, sides, mod}`; prawdopodobieństwo `p` jako próg `le = ceil(p·2³²) − 1`
(sukces, gdy `u32 ≤ le` — identycznie jak `rng() < p`); brak wartości `0xFF` / `-1` / `COLOR_NONE`; `key` = tekstowe id z TS
(do zapisów gry). Nie są jeszcze generowane: generator imion (`data/names.ts`) i stałe trasy regionu (`RING_S/N`, `HALLS`).

## 1. Mapa modułów

| Moduł TS | Linie | Co robi | Port |
|---|---|---|---|
| `core/data/*` | ~2.6k | tabele treści | generowane nagłówki z `game_data.json` |
| `core/rules/dice.ts` | 192 | RNG, hash, k20, stopnie sukcesu, rzuty | 1:1, liczby całkowite |
| `core/rules/stats.ts` | 222 | stany, KP, rzuty obronne, umiejętności, premia do ataku | 1:1 |
| `core/rules/damage.ts` | 122 | obrażenia, odporności, umieranie, leczenie | 1:1 |
| `core/rules/turn.ts` | 99 | początek/koniec tury, inicjatywa | 1:1 |
| `core/rules/strike.ts` | 103 | atak bronią | 1:1 |
| `core/rules/character.ts` | 318 | tworzenie postaci/wrogów, awans, PD, łup, odpoczynek | 1:1 |
| `core/rules/abilities.ts` | 805 | efekty 46 zdolności | tablica wskaźników na funkcje |
| `core/rules/consumables.ts`, `equipment.ts`, `locks.ts` | 340 | przedmioty jednorazowe, sloty, zamki/hakowanie | 1:1 |
| `core/tactical/grid.ts` | 195 | siatka, Dijkstra, linia strzału, pole widzenia | 1:1, koszty całkowite (rozdz. 21) |
| `core/tactical/mapgen.ts` | 525 | generator map 32×32, 4 biomy | 1:1, kolejność losowań święta |
| `core/tactical/combat.ts` | 911 | kontroler walki turowej | 1:1, sygnały → kolejka zdarzeń |
| `core/tactical/ai.ts` | 254 | AI wrogów (i auto-tura najemnika) | 1:1, oceny w liczbach całkowitych |
| `core/tactical/mission.ts` | 1173 | eksploracja, mgła wojny, wykrywanie, cele, ewakuacja, zapis | 1:1 |
| `core/campaign/*` | ~1.3k | stan kampanii, zlecenia, sklep, lecznica, karczma, podróż, rozliczenie, region | 1:1 |
| `core/frontend/*` | ~620 | logo/intro/menu (już w liczbach całkowitych, 50 Hz) | 1:1 (patrz `AMIGA_MINIGL.md`) |
| `core/HudState.ts` | 500 | model HUD-u (paski, akcje, ekwipunek, dziennik) | wzór dla UI, nie logika gry |
| `core/GridSystem.ts`, `Pathfinder.ts`, `LineOfSight.ts`, `TurnManager.ts`, `SkirmishRules.ts`, `TurnState.ts` | ~400 | pozostałości wczesnej migracji, używane tylko pomocniczo przez sceny | **nie portować** — zastępuje je `tactical/*` |
| `scenes/*` | ~17k | Phaser: rysowanie, animacje, okna | przepisać od zera pod miniGL |
| `audio/SoundManager.ts` | 1178 | synteza WebAudio | przepisać pod Paulę (rozdz. 20) |

Zasada z TS obowiązuje dalej: **logika gry nie zna renderera**. Walka i misja emitują zdarzenia
(`CombatSignal`, `MissionSignal`) — w C to kolejka `struct Event` czytana przez warstwę widoku.

## 2. Przebieg gry (ekrany)

```
Logo -> Intro (6 plansz) -> Tytuł -> Werbunek (4 z 16 rekrutów, imię, kolor)
  -> Przystań (hub): Tablica zleceń | Handlarz Nomadów | Lecznica | Drużyna (ekwipunek) | Karczma | Odpoczynek | Zapis
  -> Podróż (mapa regionu, marsz po trasie, zdarzenie 30%, atak fauny 22%) -> [zawróć = powrót do huba]
  -> Misja: eksploracja <-> walka -> ewakuacja / odwrót / porażka
  -> Rozliczenie -> Przystań ... ; cała drużyna martwa -> Koniec gry ; ukończona "Kostucha" -> Zwycięstwo (epilog)
```

## 3. Dane (podsumowanie; pełne wartości w `game_data.json`)

- **Cechy** `str dex con int wis cha` (modyfikatory, nie wartości 3–18). **13 umiejętności**, każda z cechą bazową.
- **8 ras** (`ANCESTRIES`): PW rasy 6–10, Prędkość 4–6 pól, premie/wady cech, `free` = premie wg `boostOrder` klasy,
  odporności/słabości (mutant: trucizna 2; cyborg: +1 KP, słabość na prąd 3, cecha `machine`). Aliasy nazw w `ancestryAliases`.
- **12 klas** (`CLASSES`): cecha kluczowa, PW/poziom (8/10/12), cechy startowe, rangi biegłości, ekwipunek startowy,
  zdolności z poziomem odblokowania, progresja rang na poz. 3 i 5.

| Klasa | Kluczowa | PW/poz. | Zdolności (poziom) |
|---|---|---|---|
| Żołnierz `soldier` | SIŁ | 10 | ogień zaporowy 1, podwójny cios 1, natarcie 2, zew dowódcy 5 |
| Zwiadowca `scout` | ZR | 8 | wyznacz cel 1, precyzyjny strzał 1, strzał w nogę 3, seria 5 |
| Medyk `medic` | MDR | 8 | opatrunek polowy 1, stymulant 1, adrenalina 3, punkt medyczny 5 |
| Technik `techie` | INT | 8 | dron bojowy 1, granat EMP 1, naprawa pancerza 2, strojenie broni 4 |
| Szczur `scavenger` | ZR | 8 | atak z ukrycia 1, unik 1, kradzież 1, rzut piaskiem 3 (+ kości z ukrycia) |
| Brutal `brute` | SIŁ | 12 | szał 1, rozpłatanie 1, ryk 2, powal 3, drugi oddech 5 |
| Rewolwerowiec `gunslinger` | ZR | 8 | precyzyjny strzał 1, unik 1, rzut piaskiem 2, seria 4 |
| Strażnik `champion` | SIŁ | 10 | zew dowódcy 1, powal 1, natarcie 2, drugi oddech 4 |
| Chemik `alchemist` | INT | 8 | rzut koktajlem 1, stymulant 1, opatrunek 2, adrenalina 3 |
| Herold `herald` | CHA | 8 | zew dowódcy 1, ryk 1, rzut piaskiem 2, adrenalina 4 |
| Pięściarz `monk` | SIŁ | 10 | podwójny cios 1, unik 1, powal 2, drugi oddech 4 |
| Haker `hacker` | INT | 8 | atak z ukrycia 1, granat EMP 1, dron 1, kradzież 2, strojenie 3 |

Każdy najemnik ma też 6 zdolności uniwersalnych: atak, podnieś tarczę, schowaj się, zastrasz, pierwsza pomoc, wstań.

- **16 rekrutów** (`RECRUITS`): stała rasa+klasa+wygląd+życiorys (Hak, Sowa, Igła, Lut, Szczurek, Bizon, Kruk, Pleśń,
  Iskra, Grzmot, Szept, Zgrzyt, Mur, Retorta, Aksamit, Zero). Poległy rekrut znika z karczmy na zawsze.
- **53 przedmioty** (`ITEMS`): 18 broni, 7 pancerzy, 2 tarcze, 9 jednorazowych, 17 złomu/tech/amunicji. Cena w Złomie,
  `level` = minimalny poziom drużyny w sklepie. Broń: kości, typ obrażeń, zasięg (0 = wręcz; inaczej długość przyrostu
  zasięgu w polach), kategoria, ręce, cechy. Pancerz: +KP, limit ZR, kara do testów, kara do Prędkości, kategoria.
- **17 wrogów** (`ENEMIES`): poziom 0–6, PW, KP, rzuty obronne, Percepcja, Prędkość (0 = wieżyczka), frakcja
  (`raider mutant beast machine`), typ AI (`melee ranged beast coward boss`), ataki z gotową premią i obrażeniami,
  zdolności, łup (szansa), Złom `[min,max]`, odporności/słabości/niewrażliwości, wygląd. Bossowie: Herszt (poz. 3), Kostucha (poz. 6).
- **46 zdolności** (`ABILITIES`): koszt (1/2 akcje; `reaction` = niedostępna w turze), cel (`self ally enemy area none`),
  zasięg, promień, limit (`null` / `encounter` + `usesMax`), `move` (z ruchem), efekt wizualny.
- **27 stanów** (`CONDITIONS`), rodzaje: `flag`, `decay` (−1 na koniec tury), `timed` (rundy), `persistent` (obrażenia co turę,
  wartość = kość), `consume` (traci X akcji w następnej turze), `short` (znika na początku własnej tury).

## 4. Postać

**Tworzenie** (`createCharacter`): cechy = cechy klasy + premie rasy (`free` rozdawane po `boostOrder` klasy) + wady rasy,
każda obcięta do +4. Biegłości = klasa + umiejętności rasy (zawsze maksimum z rang). Typ sylwetki z klasy
(ciężka: brutal, żołnierz, strażnik, pięściarz; lekka: szczur, zwiadowca, rewolwerowiec, haker, herold).
Ekwipunek startowy po kolei: pierwsza broń → `weapon`, druga → `weapon2`, pancerz → `armor`, tarcza → `shield`
(chyba że broń główna dwuręczna), reszta do plecaka (jednorazowe łączą się w stos).

**PW**: `maxHp = PW_rasy + (PW_klasy + KON) × poziom`. Wzrost maxHp podnosi też bieżące PW (jeśli > 0).

**PD i awans**: 1000 PD na poziom, maks. poziom 10 (nadwyżka obcięta do 999). Awans: progresja rang klasy
(poz. 3 i 5), co 5 poziomów +1 do pierwszych 4 cech z `boostOrder` (maks. +5), co 2 poziomy +1 ranga najwyższej
umiejętności poniżej Eksperta (sortowanie malejąco po randze, stabilne). Potem przeliczenie PW i nowe zdolności.

**PD za starcie**: suma po zabitych `ENCOUNTER_XP[min(4, poz_wroga − poz_drużyny)]`; różnica < −4 = 0.
Poziom drużyny = zaokrąglona średnia (min. 1).

**Wróg z szablonu** (`createEnemy`, `levelAdj` −1/0/+1 = słaby/zwykły/elitarny): PW ×0.8/×1.25 (zaokrąglone),
premia ataku ±1, stała obrażeń ±2, KP/rzuty/Percepcja ±1, `classDC = 10 + premia_pierwszego_ataku + adj`.

## 5. Statystyki pochodne (`getStat`)

Premia z biegłości: `ranga > 0 ? 2×ranga + poziom : 0`. Kara statusowa `pen` = wartość `sickened`.

- **KP** (najemnik): `10 + min(ZR, limit_pancerza) + bieg(obrona[kategoria]) + KP_pancerza + KP_rasy`.
  Wróg: `base.ac`. Potem dla obu: −2 gdy odsłonięty (`off_guard`, `distracted` albo `prone`); premia okolicznościowa =
  **maksimum** z: osłona (1 → +2, 2 → +4; pomijana przy atakach wręcz i `ignoreCover`), podniesiona tarcza (KP tarczy,
  domyślnie 2), unik (+2); +1 `reinforced`, −1 `raging`; na końcu −`pen`.
- **Rzuty obronne**: Wytrwałość KON, Refleks ZR, Wola MDR + biegłość. **Percepcja**: MDR + biegłość.
  **classDC**: `10 + cecha_kluczowa + bieg(classDC)`. **Umiejętność**: cecha + biegłość, dla SIŁ/ZR −kara pancerza.
  Wrogowie: wartości z `base`, Refleks −`clumsy`, nieznana umiejętność = Percepcja − 1.
- ZR obniża `clumsy`, SIŁ obniża `enfeebled`.
- **Prędkość**: `max(1, speed − kara_pancerza)`, 0 zostaje 0.
- **Premia do ataku**: wróg = stała premia ataku; najemnik = cecha (dystans ZR, `finesse` max(SIŁ,ZR), wręcz SIŁ)
  + bieg(kategoria broni) + `potency`. Potem: +1 `stimmed`, −2 `prone`, wróg strzelający −`clumsy`, −`pen`,
  −2 × przyrosty zasięgu, kara za wielokrotny atak PWA `[0,−5,−10]` (broń `agile`: `[0,−4,−8]`).

## 6. Kości, testy, RNG

- **RNG**: mulberry32 (32-bit), ziarno z liczby albo `hashSeed` (FNV-1a po kodach UTF-16 znaków). Wartość `rng()` = `u32 / 2^32`.
- `d(n) = 1 + floor(rng()×n)` — w C dokładnie `1 + ((uint64)u * n >> 32)`.
- **Test**: k20 + mod vs ST. Stopnie: ≥ ST+10 kryt. sukces, ≥ ST sukces, ≤ ST−10 kryt. porażka, inaczej porażka;
  naturalna 20 / 1 przesuwa o stopień. Stopnie 0..3.
- **Połowienie kości** (`halveDie`, zaokrąglenie w górę, kumuluje się): przerażony połowi **wszystkie swoje** kości
  (k20 i obrażeń/leczenia); atak na ukrytego (`hidden`) połowi k20 trafienia. Połowiona k20 nie daje naturalnej 20.
- **ST wg poziomu**: `DC_TABLE[poziom]` (14,15,16,18,19,20,22,23,24,26,27,…).
- Wyrażenia kości: `NdS±K`, także sumy `2d6+1d4+2`. W danych występują tylko proste `NdS[+K]` — w C wystarczy
  parsowanie do `struct {u8 n, sides; s8 mod;}` przy generowaniu nagłówków.

## 7. Stany: cykl życia

- Nakładanie (`addCondition`): martwi ignorują; niewrażliwi pomijani (`immune`, trucizna też przez `poison`);
  obrażenia ciągłe nadpisują kość; stany z wartością/czasowe biorą **maksimum** starej i nowej.
- **Początek tury** (`startTurn`): umierający → tylko test ratunkowy (koniec). Inaczej obrażenia ciągłe po kolei
  (`bleeding`, `burning`, `poisoned`): rzut kością, obrażenia, płaski test ST 15 kończy stan. Zdejmij `raised_shield`, `dodging`.
  Akcje = 3, +1 `quickened`, −X `stunned`/`slowed` (te dwa znikają). Powalony/nieprzytomny = 0 akcji.
- **Koniec tury** (`endTurn`): `decay` i `timed` −1, przy 0 znikają.
- **Po walce** (`endEncounter`): zostają tylko `dying wounded unconscious dead bleeding`; zero tymczasowych PW (jeśli żyje
  przytomny), odnowienie zdolności `encounter`.
- **Długi odpoczynek**: pełne PW, wszystkie stany zdjęte, wszystkie użycia odnowione.

## 8. Atak bronią (`strike`)

1. Broń znormalizowana (przedmiot, atak wroga albo Pięść `UNARMED`). Premia = §5 (+ premia zdolności).
2. ST = KP obrońcy (wręcz zawsze bez osłony). k20 z połowieniami (przerażony atakujący + ukryty cel).
3. Stopień ≤ 1 → pudło. Inaczej: kości = n broni (+ dodatkowe ze zdolności); przy krytyku z `fatal:X` ścianki = X.
4. Stała: mod broni + premia zdolności; najemnik wręcz (lub `thrown`) +SIŁ; szał wręcz `+2 + floor(poz/5)`;
   `tuned` +2; zwiadowca na `hunted` `+2 + floor(poz/4)`.
5. Atak z ukrycia (tylko klasa Szczur): `floor((poz+1)/2)` k6, gdy cel odsłonięty albo wymuszone.
6. Krytyk: suma ×2, potem `fatal` +1 kość X, albo `deadly:X` +1 kość (+2 przy ≥ 3 kościach broni). Minimum 1.
7. `applyDamage` (§9). Wszystkie kości obrażeń atakującego połowione, gdy jest przerażony.

## 9. Obrażenia, umieranie, leczenie

- Odporność odejmuje, słabość dodaje, niewrażliwość zeruje (wróg: własne pola; najemnik: z rasy). Najpierw schodzą
  tymczasowe PW. **Uwaga**: odporności wrogów w danych są już podwojone (stary kod odejmował dwa razy) — przenosić 1:1.
- Wróg przy 0 PW ginie. Najemnik przy 0 PW pada: `dying = min(4, 1 + wounded + (kryt?1:0))`, nieprzytomny, powalony,
  traci tarczę w górze i osłonę; `dying ≥ 4` = śmierć. Obrażenia leżącego: `dying +1` (+2 krytyk).
- Test ratunkowy (początek tury): płaski ST `10 + dying`; kryt. sukces −2, sukces −1, porażka +1, kryt. porażka +2;
  ≥ 4 śmierć; ≤ 0 stabilizacja (`wounded +1`, maks. 3, dalej nieprzytomny).
- Leczenie podnosi leżącego: zdejmuje `dying`/`unconscious`, `wounded +1`. Tymczasowe PW się nie sumują (bierze się wyższe).

## 10. Walka turowa (`Combat`)

- **Start**: biorą udział tylko wrogowie w polu widzenia drużyny (reszta dołącza później, gdy wejdzie w pole widzenia:
  rzut inicjatywy i koniec kolejki). Inicjatywa = Percepcja + k20 (połowiona, gdy przerażony). Kolejność: malejąco,
  remis — najemnik pierwszy. **Zasadzka**: drużyna przed wrogami w 1. rundzie, nieświadomi wrogowie odsłonięci do swojej tury.
- **Tura**: 3 akcje (§7). Akcje: Marsz (do Prędkości za akcję; koszt w akcjach = `ceil(koszt_drogi / Prędkość)`),
  Krok (1 pole, bez ścinania rogów), Atak, zdolność, przedmiot, zamiana broni (1), Schowaj się (1), interakcja (1; wytrych
  i hakowanie 2), Odłóż turę (na koniec rundy), zamiana najemnika (PF2e Delay: wybrany działa teraz, bieżący zachowuje akcje).
- Ruch przez sojuszników dozwolony, przez wrogów nie; po ruchu znika `in_cover`. Ruch najemnika wciąga widocznych wrogów do walki.
- **Atak**: wręcz zasięg 1 (`reach` 2); dystans do `6 × zasięg` pól, wymaga linii strzału; przyrosty `ceil(d / zasięg) − 1`.
  **Flankowanie** (tylko wręcz): sojusznik stoi dokładnie naprzeciw celu → cel odsłonięty. **Osłona geometryczna**:
  niska przeszkoda na linii strzału w promieniu 1 od celu → `in_cover` 1 (albo 2, jeśli już się schował).
  Klik na wroga poza zasięgiem broni białej: podejście (najtańsze pole obok, flankujące −0.5) + atak.
- **Zdolności**: cele wroga/sojusznika w zasięgu i na linii strzału (zasięg ≤ 1 bez linii); zdolność z ruchem —
  zasięg = Prędkość + 1, najpierw podejście. Obszar: na pole (granaty, salwa) trafia **wszystkich** w promieniu
  (euklides ≤ r + 0.45), także swoich; wokół siebie — tylko wrogów, a 4 zdolności wspierające (zew dowódcy, punkt
  medyczny, zew herszta, rozkaz Kostuchy) tylko swoich. Darmowe (0 akcji) — raz na turę.
- **Hałas**: strzał/strzał zdolnością promień 9, wybuch 10 → budzi grupy w promieniu (idą w stronę walki).
- **Koniec**: wszyscy najemnicy nie stoją → porażka; brak wrogów biorących udział → wyczyszczone (`endEncounter` drużyny).
- **Eksploracja**: zdolności na siebie/sojusznika i przedmioty nieofensywne bez kosztu akcji; zdolność bez limitu
  (np. pierwsza pomoc) działa na danego sojusznika raz między walkami.

## 11. Zdolności (efekty; koszty i zasięgi w `game_data.json`)

Skróty: *kl* = classDC użytkownika, *RO podst.* = podstawowy rzut obronny (kryt. sukces 0, sukces ½, porażka całość, kryt. porażka ×2).

| Zdolność | Efekt |
|---|---|
| Zastrasz | Zastraszanie vs 10+Wola celu → przerażony 1 (kryt. 2); cel odporny 4 rundy |
| Pierwsza pomoc | Medycyna vs (umierający 15+dying / krwawiący 15 / ST poziomu): stabilizuje (kryt. +1k6), tamuje krwawienie, albo leczy 1k6+1 (kryt. 2k6+1); kryt. porażka na umierającym: dying+1 |
| Ogień zaporowy | broń dystansowa; każdy cel w obszarze: Refleks vs *kl*, obrażenia broni bez stałej (½ / całość / ×2); porażka: zdezorientowany 2, kryt.: przerażony 1 |
| Podwójny cios / Seria | 2 ataki (seria +1 do trafienia); liczą się 2 do PWA |
| Natarcie | ruch + atak +1 trafienie, +2 obrażenia |
| Zew dowódcy | sojusznicy: zdejmuje strach, +4+2×poz tymcz. PW |
| Wyznacz cel | `hunted` 5 rund (zwiadowca +2+poz/4 obrażeń) |
| Precyzyjny strzał / Strzał w głowę | +2 trafienie, +1 kość, ignoruje osłonę |
| Strzał w nogę | atak; trafienie → Wytrwałość vs *kl*: spowolniony 1 (kryt. 2) |
| Opatrunek polowy | Medycyna vs ST poziomu: kryt. 4k6+MDR+poz (+ zdejmuje krwawienie i truciznę), sukces 2k6+… (krwawienie), porażka 1k4 |
| Stymulant | +4+2×poz tymcz. PW, `stimmed` 5 |
| Adrenalina | leżący: leczy 1k8+MDR+poz i wstaje; inaczej `quickened` 1 |
| Punkt medyczny | sojusznicy w promieniu: 1k8+MDR+poz |
| Dron bojowy | 2 ataki (premia *kl*−10, drugi −5), 1k6+INT |
| Granat EMP | Refleks vs *kl*: maszyny 2k6+poz el. + ogłuszenie 1/2, reszta 1k4 |
| Naprawa pancerza | Technika vs ST poziomu: +3+2×poz tymcz. PW (kryt. ×2), `reinforced` 4 |
| Strojenie broni | `tuned` 4 (+2 obrażeń) |
| Atak z ukrycia | ukryty albo Skradanie vs 10+Percepcja celu → atak z kośćmi z ukrycia |
| Unik | `dodging` (+2 KP) |
| Kradzież | Złodziejstwo vs 10+Percepcja: przedmiot z tabeli łupu wroga (raz na wroga), kryt. +2+k6 Złomu; kryt. porażka: niezdarny 1 |
| Rzut piaskiem | Refleks celu vs *kl*: porażka → zdezorientowany 2 + niezdarny 1 (kryt. 2) |
| Szał / Szał bojowy | `raging` 5 rund + tymcz. PW (poz+KON / 5+poz) |
| Ryk | wrogowie w promieniu: Zastraszanie vs 10+Wola → przerażony 1/2 |
| Rozpłatanie | atak +1 kość; trafienie → krwawienie 1k6 (kryt. 2k6) |
| Powal | Atletyka vs 10+Refleks: powalony (kryt. +1k6 obuch.); kryt. porażka: sam pada |
| Drugi oddech | leczy 1k8+KON+poz+4 |
| Wrogowie | powalające kły (atak + Refleks → powalony), chmura owadów (RO podst. Wytrw. 1k6+1 trucizna, chory 1), jadowite żądło (1k6+3, zatruty 1k6, kryt. chory), wstrząs (RO Ref. 2k6+3, powalony), skażający dotyk (chory 1/2), koktajl (RO Ref. ST 16+poz/2, 1k6+2 ogień, płonie 1k4), zew herszta (+6 tymcz. PW, `stimmed` 4), samozniszczenie (RO Ref. ST 16, 2k8, dron ginie), seria z działka (3 ataki), salwa rakietowa (RO Ref. 3k6+4), Żniwa (atak na 2 cele), Gradobicie (RO Ref. ST 22, 3k6+2, zdezorientowany 2), Rozkaz Kostuchy (+15 tymcz. PW, do 3 sojuszników `quickened` + `stimmed`) |

Limit użyć: jeśli efekt sam nie zmniejszył licznika, `useAbility` zmniejsza go po fakcie.

## 12. Przedmioty i ekwipunek

- Jednorazowe (`useConsumable`): `heal` (kości, zdejmuje `cures`), `cleanse`, `damage` (RO podst. z ST przedmiotu;
  `only: machine` dla EMP; stan przy porażce), `buff`, `smoke` (`dodging` dla wszystkich w promieniu). Zużywa 1 sztukę.
  W walce: obszar do zasięgu (domyślnie 6), cel pojedynczy do zasięgu (min. 1).
- Sloty: `weapon weapon2 armor shield`. Dwuręczna broń główna zdejmuje tarczę; tarczy nie da się założyć do dwuręcznej.
  Zamiana broni **nie** zdejmuje tarczy (zgodnie z oryginałem). Jednorazowe i amunicja łączą się w stosy.
- Skrytka drużyny (`stash`) wspólna, plecak per postać. Przenoszenie po 1 sztuce ze stosu.

## 13. Zamki, hakowanie, skrzynie

- **Zamki** (PF2e): lichy ST 15/2 sukcesy, prosty 20/3, przeciętny 25/4, dobry 30/5, doskonały 40/6.
  Wytrych (Złodziejstwo, 2 akcje): kryt. sukces 2, sukces 1; bez wytrychów −2; kryt. porażka łamie wytrych.
  Wyważenie (Atletyka, 1 akcja): ST+5, −2, sukces = otwarte (zamek zniszczony), kryt. porażka = −2 do kolejnych prób.
- **Urządzenia**: terminal/komputer/serwer/panel/sterownik robota, ST = ST poziomu misji + offset, 1–3 sukcesy;
  Technika lub Złodziejstwo; kryt. porażka = blokada + alarm (najbliższa nieświadoma grupa ≤ 16 pól zostaje zaalarmowana).
  Serwer z celem zlecenia nie blokuje się na stałe (alarm i reset postępu).
- **Skrzynie**: Złodziejstwo/Technika/Atletyka vs ST poziomu + 1, jedna próba (porażka: maks. 2 próby).
  Kryt. porażka: pułapka 1k6. Sukces: `round((8 + rng×14) × (1 + poz×0.5))` Złomu + 1 losowy przedmiot
  (jednorazowy/złom/tech/amunicja do poz.+1); kryt.: ×1.5 Złomu i 2 przedmioty.
- Uwaga: drzwi i urządzenia poboczne mają gotowe API (`addLockedDoor`, `addDevice`), ale generator ich jeszcze nie stawia.

## 14. AI (`ai.ts`)

Jedna decyzja na krok, maks. 10 kroków na turę:
1. (najemnik pod AI) pierwsza pomoc umierającemu obok, wstań, podejście do umierającego.
2. **Zdolność** (wróg: każda z szansą 65%): na wroga — najsłabszy cel w zasięgu; leczenie — sojusznik < 55% PW;
   wzmocnienie — raz na walkę; obszar wokół siebie — gdy ktoś jest w promieniu; obszar na pole — pole wroga z najlepszą
   oceną `2×wrogów − 4×swoich`.
3. **Broń**: ta, która sięga kogoś teraz (+50), inaczej strzelcy — najdłuższy zasięg, reszta — najkrótszy.
4. **Tchórz** (< 40% PW) ucieka: maks. odległość od wrogów.
5. **Atak** na najlepszy cel: `(1−PW%)×30 + szansa×25 − dystans×1.5 + flank×6` (bestie: `−dystans×3 + szansa×10`),
   leżący −100; trzeci atak tylko przy szansie ≥ 30%.
6. **Ruch**: pole z możliwością ataku +100 (+15 gdy zostaną 2 akcje), −2×odległość po ścieżce do najbliższego wroga,
   strzelcy −12 gdy wróg < 3 pola, +7 przy niskiej osłonie; wręcz +8 za flankowanie.
7. **Schowaj się**, gdy obok niska osłona albo ma broń dystansową.

## 15. Siatka, ścieżki, widoczność (`grid.ts`)

- Pole: `0 FREE`, `1 LOW` (niska osłona — blokuje ruch, nie wzrok), `2 HIGH` (blokuje oba), `3 HAZARD` (skażenie,
  blokuje ruch). Poza mapą = HIGH.
- **Dijkstra 8-kierunkowa**: prosto 1, ukos 1.5, bez ścinania rogów (oba pola boczne muszą być wolne).
- Odległości: zasięgi i sąsiedztwo — Czebyszew; promienie — euklides z tolerancją.
- **Linia strzału**: `n = max(2, ceil(dł × 3))` próbek, zaokrąglanie do pól, pomija start i cel; HIGH blokuje, LOW przy
  celu (Czebyszew ≤ 1) daje osłonę. Symetryczna przy blokadzie (sprawdza też w drugą stronę).
- **Pole widzenia**: kwadrat r, euklides ≤ r + 0.3, linia w dowolną stronę. Najemnik 9 pól, jeniec 5.

## 16. Generator map (`mapgen.ts`) — kolejność losowań musi się zgadzać

Mapa 32×32, ziarno `hashSeed(id_zlecenia)`, jeden strumień `rng`; liczby obiektów skalowane
`kn(n) = round(n × 1024/576)`: 2→4, 3→5, 4→7, 5→9, 7→12, 8→14, 9→16, 12→21, 14→25, 16→28, 22→39, 26→46, 30→53, 40→71, 46→82.

1. Strefa wejścia 4×4 w losowym rogu (`ri(0,3)`), zarezerwowana z obwódką 1 pola; to też strefa ewakuacji.
2. Biom:
   - **ruiny**: asfalt/pęknięty (25%), po 3 drogi poziome i pionowe szer. 2, poza drogami gruz/beton;
     71 prób: 45% budynek (HIGH, 1–3 piętra), inaczej ogrodzenie z bramą (ściany, 18% zniszczona ściana);
     16 aut na drogach, 46 rekwizytów, 21 dekoracji, 4 autobusy.
   - **pustkowia**: piasek/ziemia; 7 kałuż skażenia (HAZARD), 21 skupisk ruin, 4 ogrodzenia z ruin, 9 wraków,
     5 namiotów z ogniskiem, 28 rekwizytów, 21 dekoracji.
   - **przemysł**: beton/metal; 9 rzędów kontenerów (z przerwą), płoty 7 poziomych + 5 pionowych, 4 ogrodzenia,
     9 generatorów/terminali, 39 rekwizytów, 12 dekoracji.
   - **bunkier**: lita skała, pokój startowy 5×5 + do 14 pokoi (200 prób, odstęp 2), korytarze szer. 2 łączące
     pokoje posortowane po `x+y` środka, 2–4 rekwizyty w pokoju.
3. Wejście zawsze wolne; dekoracje (`lamp sign antenna tree_dead skeleton campfire`) nie blokują.
4. BFS 4-kierunkowy od pola wejścia nr 5 → `reach` z odległością `d`, `maxD`.
5. Cel zlecenia: losowe pole `d ≥ 0.75·maxD` (potem 0.5, potem dowolne).
6. Wędrowcy (poza „obroną”): od końca listy, szabrownicy/fauna/maszyny bez bossa z szansą 45% (osobny strumień
   `seed ^ 0x2a77e1d5`), dopóki zostaje > 1 w grupach.
7. Grupy po ~3 (maks. 4), ostatnia przy celu i zawsze z bossem; środki `d ≥ 0.3/0.45·maxD`, odstęp ≥ 6; członkowie na
   najbliższych polach ≤ 3.2 od środka. Wędrowcy pojedynczo `d ≥ 0.3·maxD`, ≥ 5 od innych.
8. Skrzynie: 3 (+1 od poz. 3), najpierw wnętrza budynków/ogrodzeń `d > 6`, potem pola z ≥ 2 wolnymi sąsiadami; stają się LOW.
9. Znaleziska: `16 + ri(0,3)`, `d ≥ 4`, rodzaj z listy, 55% ukryte.
10. **Na końcu** osobny strumień (`seed ^ 0x51f15eed`): wyschnięta trawa i roślinność — czysto wizualne, nie zmienia kolizji.

Port musi odtworzyć dokładnie: kolejność wywołań `rng`, kolejność iteracji (`y` zewnętrzne, `x` wewnętrzne),
stabilne sortowanie, filtrowanie list. Weryfikacja: 12 map w `test_vectors.json` (`cells`, `floor`, grupy, skrzynie...).

## 17. Misja (`mission.ts`)

- **Rozstawienie**: do 4 żywych najemników na polach wejścia 5, 6, 9, 10; wrogowie z grup; wędrowcy krążą ≤ 7 pól od domu.
  Cel polowania = boss albo najwyższy poziom.
- **9 typów celów**: eliminacja (wszyscy martwi), odzyskanie (przedmiot na polu celu → ewakuacja), ratunek (jeniec idzie za
  drużyną → ewakuacja), polowanie / wódz (cel martwy), włamanie (serwer na polu obok celu, 3 warstwy → ewakuacja),
  wyzwolenie (3–4 osadników + wszyscy wrogowie), oczyszczanie (2–3 gniazda + wszyscy wrogowie), obrona (fale: kolejna
  grupa rusza co ~10 kroków lub 2 kroki po odparciu poprzedniej).
- **Eksploracja**: ruch wybranego (albo całej drużyny w formacji — zasięg najwolniejszego), krok po kroku: każdy krok
  `steps++`, pole widzenia, znaleziska, wykrywanie; wykrycie przerywa ruch. Potem ruch świata (`advanceWorld`):
  zaalarmowani idą do najbliższego najemnika i stają w polu widzenia, wędrowcy krążą (35% postój).
- **Wykrywanie**: tylko wrogowie widoczni dla drużyny. Zaalarmowani atakują od razu; nieświadomi: ≤ 3.2 pola = wykrycie,
  dalej co 3 kroki test Percepcji najlepszego vs `10 + najlepsze Skradanie drużyny`.
- **Zasadzka z ukrycia**: Skradanie atakującego vs `10 + najlepsza Percepcja grupy` → walka z zaskoczenia albo zwykła.
- **Znaleziska**: ukryte w promieniu 2 → raz test Percepcji najlepszego vs ST poziomu; zabiera stojący obok.
  Złom `round(bazowy + rng×8×(1+0.4·poz))` (złom 10, skrytka 6, reszta 2) + przedmiot wg rodzaju.
- **Ewakuacja**: cel wykonany i wszyscy przytomni (plus jeniec) w strefie wejścia. **Odwrót** zawsze możliwy: zaliczony,
  jeśli cel wykonany (poza ratunkiem). Po walce `steps += 3`.
- **Zakończenie**: PD z zabitych, łup z ich tabel, ukradziony Złom, lista poległych.

## 18. Kampania

- **Stan** (`CampaignState`): drużyna (≤ 4), Złom (start 120), dzień, reputacja `survivors`/`nomads`, skrytka (start:
  3 bandaże, 1 stymulant), tablica zleceń, ukończone, postęp fabuły 0..3, flagi (polegli, zwycięstwo), dziennik.
- **Tablica**: 10–11 zleceń pobocznych, każdy z 8 typów co najmniej raz, poziom = poziom drużyny (25% +1, 20% −1).
  Wrogowie dobierani z budżetu PD: 85–109 (+10 polowanie/wyzwolenie/oczyszczanie, +20 obrona; 125 gdy powyżej poziomu
  drużyny), frakcje wg typu, 2–8 wrogów (obrona do 10). Nagroda: Złom `(35 + 32·poz + 0..29) × 1.2 (trudne) × mnożnik typu`,
  PD `300 + 100·poz (+100)`, czasem przedmiot, reputacja 1–3. Podróż 1–2 dni. Biomy rozkładane równomiernie, tytuły bez powtórek.
- **Fabuła**: 3 zlecenia (`STORY_CONTRACTS`), odblokowanie: ukończone 2/4/7 i suma reputacji 2/6/10; eskorta przycinana do
  budżetu 100/110/115 PD (boss zostaje). Ukończenie „Kostuchy” = zwycięstwo.
- **Handlarz**: asortyment dnia z ziarnem `day×7919+13`: 8 jednorazowych/amunicji + 12 sprzętu do poz.+1.
  Rabat 2%/pkt reputacji Nomadów (−20%..25%); skup 60% (złom) / 40% (reszta) + 1%/pkt (maks. +10%).
- **Lecznica**: `ceil(1.5 × brakujące PW) + 8` za stany. **Karczma**: `120 + 60 × poziom drużyny`, rekrut na poziomie drużyny.
  **Odpoczynek**: długi odpoczynek, +1 dzień, tablica −2 zlecenia i dopełnienie.
- **Rozliczenie**: sukces 100% nagrody, odwrót 50% Złomu i PD (łup zostaje), porażka: bez łupu, 25% PD, −1 reputacji.
  Polegli usuwani na zawsze; powaleni wracają z 1 PW. Dzień += dni podróży, tablica −1 (sukces).
- **Podróż**: zdarzenie z szansą 30% (10 zdarzeń ważonych, po 2 wybory), atak fauny 22% w losowym momencie marszu.
  Wybór = test umiejętności najlepszego członka drużyny vs ST poziomu zlecenia; skutki: Złom, przedmioty (`@typ` losowe),
  reputacja, PD dla wszystkich, dni, obrażenia losowej postaci (nigdy poniżej 1 PW).
- **Region** (`region.ts`, już w Q8): sektory (ruiny w elipsie miasta, pustkowia, przemysł, bunkier) ze stałymi miejscami
  zleceń, trasy (autostrada + ulice albo szlak Catmull-Rom w Q8 z objazdem miasta i hal), czas marszu `max(400, len×1000/10752)` ticków.
  Wysokości z `region_height.bin`, interpolacja dwuliniowa na intach (`heightQ8`).

## 19. Zapis gry

Przeglądarka trzyma JSON w localStorage: autozapis + 3 sloty; misja zapisywana tylko w eksploracji
(`MissionSnapshot`: mapa odtwarzana z id zlecenia, do tego zmienione pola, postacie, obiekty, znaleziska, odkryte pola).
Na Amidze: plik binarny w `PROGDIR:saves/` (big-endian, nagłówek z wersją), ta sama zawartość. Przenoszenie zapisów
między przeglądarką a Amigą nie jest wymagane — wtedy id zleceń mogą być generowane inaczej (rozdz. 21).

## 20. Grafika i dźwięk — inwentarz

- **Postacie PixelLab** (22 jednostki: 16 rekrutów + 6 typów szabrowników, RGBA PNG): spoczynek 64×64 w 8 kierunkach
  (176 plików) i animacje w paskach klatek 96×96: chód 8 klatek (128 pasków), strzał/kucnięcie/hakowanie/skradanie
  6 klatek (204), podnoszenie 5 klatek (56) — łącznie ~2530 klatek 96×96. Brakujące kierunki: odbicie lustrzane.
  Portrety 64×64 (21). **miniGL**: tekstury potęgi dwójki ≤ 256: 96×96 mieści się po 4 w atlasie 256×256 (192 użyte) —
  lepiej przyciąć klatki do 64×64 (16 w atlasie) i ładować tylko jednostki obecne w misji (~115 klatek ≈ 8 atlasów na jednostkę).
- **Grafika proceduralna** (rysowana w kodzie, `scenes/iso/*`, `scenes/fx/*`): bestie, maszyny, ghul, mutant-kolos,
  Kostucha, kafle podłóg, rekwizyty, budynki, roślinność, efekty. Dla Amigi: wypiec offline do atlasów
  (skrypt na przeglądarce/Node) zamiast rysowania w trakcie gry.
- **Izometria**: `isoX = (gx − gy)·tw/2`, `isoY = (gx + gy)·th/2`, głębokość = `gx + gy`. Siatka projektowa 480×270.
- **Dźwięk**: wszystko syntezowane (zero plików). 31 efektów (`click hover dice hit crit miss melee shot_* explosion heal
  step levelup coin buy error death scream growl door pickup flip geiger logo typewriter turn victory defeat alarm radio thunder`),
  9 utworów (`logo intro title town wastes ruins combat boss victory defeat`), ambient (`wind ruins town`). Dla Pauli:
  wyrenderować efekty offline do 8-bitowych sampli (OfflineAudioContext), muzykę jako moduł (4 kanały) albo próbki pętli.

## 21. Determinizm i liczby zmiennoprzecinkowe (bez FPU)

**Stan (2026-11-17): cała logika gry jest bitowo zgodna z przeglądarką** — sprawdzają to ślady TS↔C (§24).
Przyjęta polityka (inna niż pierwotna propozycja „wszystko na intach”):

- Tam, gdzie TS liczy na liczbach całkowitych albo wynik jest dokładny (RNG `u32`, kości, zasady, koszty Dijkstry
  w połówkach, `region.ts`, `frontend/*`) — C też liczy na intach.
- Tam, gdzie TS używa `double` (oceny AI, `Math.hypot`, nagrody i ceny, Złom ze skrzyń, dekoracje mapy, `toString(36)`) —
  C używa `double` **w tej samej kolejności działań**. Na Amidze kompilacja z `-msoft-float`: libgcc liczy w IEEE 754
  dokładnie jak JS (bez 80-bitowej precyzji koprocesora 68881). `Math.round` = `js_round` (połówki w górę),
  `Math.hypot(dx,dy)` = `sqrt(dx²+dy²)` (dla argumentów całkowitych zgodne w praktyce; sprawdzone śladami).
- `Array.prototype.sort` z komparatorem: `js_sort_ptr` odtwarza algorytm V8 dla tablic < 64 elementów
  (wykrycie przebiegu + sortowanie binarne przez wstawianie) — także przy niespójnym komparatorze kolejności inicjatywy
  (sprawdzone na 200 000 losowych przypadków przeciw prawdziwemu `Array.sort`).
- `rng().toString(36)` (id zleceń = ziarno mapy) — `js_radix36` odtwarza `DoubleToRadixCString` z V8 (3008 wartości zgodnych),
  więc te same zlecenia dają te same mapy co w przeglądarce.
- W C kolejność obliczania argumentów funkcji jest nieokreślona — każde losowanie, które w TS jest argumentem,
  idzie w C do osobnej zmiennej w kolejności z TS.
- Linia strzału w TS przeszła na liczby całkowite (2026-11-16), bo wersja `Math.round(ax + dx·s/n)` myliła się przy
  dokładnych połówkach.

Wydajność: Dijkstra w C to kolejka kubełkowa FIFO (ta sama kolejność co liniowe szukanie pierwszego minimum w TS).
`aiMove` nadal liczy Dijkstrę od każdego wroga i `strikeInfo` dla każdego pola — do sprawdzenia na sprzęcie.

## 22. Osobliwości do zachowania albo świadomej zmiany

- Cechy broni `sweep forceful shove scatter automatic` są w danych, ale zasady ich **nie używają** (działają tylko
  `agile finesse deadly fatal reach thrown`).
- Odporności wrogów podwojone w danych (§9). Zamiana broni nie zdejmuje tarczy. Reakcje mają koszt 99 (niedostępne).
- Przedmioty typu `ammo` nie są zużywane przez broń (amunicja to tylko towar).
- Drzwi i urządzenia poboczne: API gotowe, generator ich nie stawia.
- Cała drużyna powalona w walce = porażka misji, a powaleni z `dead` giną naprawdę.

## 23. Stan portu i struktura C

```
amiga/src/data/   gamedata.h/.c (generowane: tabele, teksty ISO-8859-2, region, imiona)
amiga/src/core/   rng dice character stats rules abilities   (zasady, §4–13)
                  tactical.h grid mapgen combat.h combat ai mission   (taktyka, §10, §14–17)
                  campaign region names save   (kampania, §18–19)
amiga/src/gfx/    r2d (renderer 2D na GL / MiniGL, czcionka), img (obrazy .ntx w kaflach <= 256, animacje .nta)
amiga/src/app/    app (maszyna ekranów, przejścia), scr_logo scr_intro scr_title, scenefx (tła, ognisko, postacie), ui
amiga/src/plat/   plat_amiga.c (ekran RTG 32 bit, MiniGL, klawiatura / joystick / mysz, timer)
amiga/gfx/        grafiki ekranów (.ntx, .nta) - kopiowane obok pliku wykonywalnego (PROGDIR:gfx/)
amiga/tests/      test_*.c (jednostkowe), trace_*.c (ślady porównywane z TS), gl_host.c (ekrany na Macu, zrzuty)
```

1. ✅ Generator nagłówków (`tools/amiga/gen_headers.ts`).
2. ✅ RNG, kości (`rng.c`, `dice.c`).
3. ✅ Postać, stany, statystyki, tworzenie, awans (`character.c`, `stats.c`).
4. ✅ Obrażenia, umieranie, tura, atak, 46 zdolności, przedmioty, ekwipunek, zamki (`rules.c`, `abilities.c`).
5. ✅ Siatka, generator map (`grid.c`, `mapgen.c`).
6. ✅ Walka turowa, AI, misja ze wszystkimi 9 typami celów (`combat.c`, `ai.c`, `mission.c`).
7. ✅ Kampania: zlecenia, fabuła, handlarz, lecznica, karczma, podróż, rozliczenie (`campaign.c`), region (`region.c`),
   generator imion (`names.c`).
8. ✅ Zapis gry: kampania + misja w eksploracji, binarnie big-endian (`save.c`). Zapisy z przeglądarki (JSON) nie są czytane.
9. 🔶 Ekrany i grafika miniGL (§25): ✅ logo STORM 32, intro (6 plansz), menu tytułowe, werbunek, Przystań; ⏳ podróż, misja, rozliczenie, zapis z menu, opcje, mapa
   regionu, misja, okna, dziennik walki (teksty z sygnałów `CombatSignal`/`MissionSignal`).
10. ⏳ Dźwięk (Paula).
11. ⏳ Uruchomienie testów na Amidze / w emulatorze (programy 68020 się budują, nie były uruchamiane).

Rozmiar (68020, `-O2 -msoft-float`): kod logiki ok. 250 KB, dane statyczne (BSS) ok. 255 KB.

## 24. Testy

`make -C amiga test` (natywnie): testy jednostkowe + ślady. Ślad = ten sam scenariusz w TS (`tools/amiga/trace_*.ts` →
`amiga/data/traces/*.txt`) i w C (`amiga/tests/trace_*.c`); `make` porównuje wynik bajt po bajcie.

| Ślad | Zakres | Linie |
|---|---|---|
| `rules` | ataki 16 rekrutów × 3 poziomy × 17 wrogów, ataki ze stanami, 46 zdolności × 8 wariantów, przedmioty, tura, umieranie, inicjatywa, zamki, ekwipunek, PD, łup | 9896 |
| `tactical` | 48 map (4 biomy), Dijkstra, ścieżki, pole widzenia | 2256 |
| `mission` | 54 symulacje: 9 typów celów × walka AI / pełna eksploracja × 3 ziarna | 29 043 |
| `campaign` | `toString(36)`, 6 kampanii × 8 dni, wątek fabularny do zwycięstwa, ceny | 5075 |
| `region` | 34 trasy, wysokość terenu, miejsca zleceń | 59 |
| `names` | 576 imion, odmiana nazwisk, kolizja imion w karczmie | 583 |

Testy jednostkowe: `test_gamedata` (86), `test_dice` (536), `test_character` (4876), `test_save` (130: zapis → odczyt →
zapis daje te same bajty, a odczytana kopia gra dalej identycznie). Czułość śladów sprawdzana celowo wprowadzanymi błędami.

## 25. Ekrany (miniGL)

Wirtualny ekran 480x270 (siatka projektowa gry), skalowany do trybu RTG z czarnymi pasami. Renderer `r2d` używa tylko
podzbioru GL sprawdzonego na A1200 w Cube Rally: `glBegin(GL_QUADS)` w paczkach (`MGLBATCH`, domyślnie 8), tekstury RGBA8
o bokach potęgi dwójki <= 256, `GL_NEAREST`, mieszanie src-alpha (promienie światła: addytywne), `glColor4ub`.

**Grafiki z gry, nie przerysowane.** Tła są malowane kodem na płótnie w przeglądarce; zamiast przepisywać malarzy
(`fx/Painter.ts`, `NukeArt.ts`) do C, wypiekamy je z prawdziwej gry:

1. `node tools/amiga/bake_scenes.ts [title intro1 ... intro6]` - Vite + Chrome bez okna (DevTools Protocol), scena z
   `?bake=1` (`Kit.ts`: tekstury w rozdzielczości projektowej, bez skalera pixel artu). Zapisuje tekstury płócien,
   ramki arkuszy postaci, obiekty sceny (pozycje, głębie) i animacje do `amiga/data/bake/<cel>/` (poza repozytorium).
   Dla wybuchu atomowego (NukeBlast liczy każdy piksel co klatkę) - klatki co 100 ms przez 7 s.
2. `python3 tools/amiga/pack_scenes.py` - `.ntx` (paleta <= 256 + RLE) i `.nta` (animacja: wspólna paleta, LZ względem
   poprzedniej klatki; wybuch 73 klatki = 1,5 MB) w `amiga/gfx/`, oraz `amiga/src/data/scenes.{h,c}`: migające okna,
   ptaki i promienie (`Windows`, `Birds`, `LightRays` - te same ziarna lcg co w grze), rozstawienie postaci, oczy w ruinach.

Ruch odtwarzany w C (`scenefx.c`, `scr_*.c`) z liczb całkowitych `core/frontend` (fazy `wave_q14`, `TickClock`, `MoteField`,
`campfire`): paralaksa, dryf chmur / mgły / dymu, ognisko, pył i iskry, postacie z animacją idle (klatka = 100 ms +
`duration`, start `|x| % 4` jak `addUnit`), flaga szabrowników, karawana nomadów, reflektory, rakiety, wstrząs kamery.
Teksty: ISO-8859-2 + 32 znaki czcionki spoza Latin-2 na kodach 0x80..0x9F (`tools/amiga/charmap.ts`: —, ▶, ◆, „ ” ...).

Menu tytułowe na Amidze: zapisy jeszcze nie działają (`title_menu(0, 0)`), „Opcje” pokazują komunikat,
Esc = wyjście z potwierdzeniem. Mysz: jeszcze nie (klawiatura i joystick).

Werbunek (`scr_recruit.c`): portrety 30 / 26 px wypieczone z gry (4 przebiegi `recruit1..4` z `?pick=`), całe postacie
w 8 kierunkach prosto z `src/assets/units/<id>/*.png` (`spr_<id>.ntx`, ładowane przy zmianie pokazanego). Fokus
joystickiem po siatce 4 x 4 i przyciskach (fokus = pokazany najemnik, obrót karty skalą `r2d_scale`), fire = wybierz.
„Rozpocznij” woła `start_campaign` i przechodzi do Przystani. Bez „Zmień imię” (brak wpisywania
tekstu) i bez podpowiedzi do zdolności; kursywa opisu jako zwykły tekst.

Sprawdzanie bez Amigi: `make -C amiga build/gl_host` (OpenGL na Macu, ten sam kod ekranów), np.
`cd amiga && ./build/gl_host 1280x720 400 build/shots/t "0:goto=title 100:DOWN 120:shot"` -> zrzuty PPM
(`tools/amiga/ppm2png.py`). Plik wykonywalny: `make -C amiga amiga-app` -> `build/Najemnicy` (+ katalog `gfx/` obok).

Przystań (`scr_hub.c`): tablica zleceń (szczegóły, zwiad, nagroda, przyjęcie z ostrzeżeniem o rannych), handlarz (kupno /
sprzedaż ze skrytki i plecaków), lecznica (leczenie, odpoczynek = następny dzień), drużyna (cechy, obrona, umiejętności,
gniazda ekwipunku z oknem wyboru, zdolności, plecak - użyj / do skrytki, skrytka), karczma (zatrudnianie), menu główne.
Wszystko na `core/campaign` i `core/rules`. Sterowanie: strefa treści i menu po prawej, podpowiedzi przedmiotów i zdolności
po 350 ms fokusu (zamiast najechania myszą). Grafiki: tło 'hub', mieszkańcy, wszyscy rekruci przy ognisku, portrety
29 / 30 / 40 px i ikony przedmiotów (10 / 11 px) i zdolności (7 px) wypieczone z gry (cel `hub` z `prep` - kod w stronie
woła moduły gry przez `import()`), w atlasach `portraits.ntx`, `icons.ntx`, `hub_party.ntx`.
Napisy w nowych plikach ekranów piszemy w UTF-8; `python3 tools/amiga/latin2_literals.py <plik.c>` przekodowuje literały
na kody portu (komentarze zostają w UTF-8). Gdy brak ekranu docelowego (podróż i misja, zapis, opcje) - komunikat.
