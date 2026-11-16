# Port na A1200 + PiStorm Lite 32 (miniGL) — ekrany startowe

> **Status (2026-11-16): port wznowiony.** Port na A1200 + PiStorm Lite 32 jest znowu głównym celem, a wersja
> przeglądarkowa jest wstrzymana (ma się tylko dalej budować jako wzorzec). Nowy kod musi trzymać się ograniczeń
> z tego dokumentu; profil `?profile=amiga` jest znowu utrzymywany. Wcześniejsza praca nad portem: gałąź
> `backup/amiga-minigl` (commit `74ba0af`).

Cel: logo, intro i menu główne działają w przeglądarce tak, jak będą działać w porcie C99 na Amidze,
żeby port był przepisaniem, a nie projektowaniem od nowa.

## Założenia sprzętowe (konserwatywne)

- **CPU:** 68k emulowany przez Emu68 na PiStorm (szybki), ale logika **nie używa FPU**: 68881/68882 liczy
  z 80-bitową precyzją pośrednią, więc floaty dałyby inne zaokrąglenia niż w przeglądarce. W `src/core/frontend/`
  są same inty: Q12/Q8, tablice sinusa i krzywych, `IntRng` (mulberry32, `below(n) = (u*n) >> 32`).
- **Zegar:** logika w tickach 1/50 s (PAL VBlank), `TickClock`. Renderer może interpolować (`timeQ8`) na RTG > 50 Hz.
- **miniGL:** podzbiór OpenGL 1.x, tryb natychmiastowy, **bez shaderów i bez render-to-texture**.
  Tekstury potęgi dwójki, maks. **256×256**. Wysyłanie tekstur i wypełnianie pikseli z mieszaniem alfa są najdroższe.
- **Wejście:** menu musi działać joystickiem/klawiaturą (góra/dół/ogień), mysz jest dodatkiem.

## Co jest gotowe (`src/core/frontend/`)

| Moduł | Zawartość | W C |
|---|---|---|
| `fixed.ts` | `TICK_HZ`, Q12/Q8, `SIN_LUT`/`isin`, `EASE_OUT3_LUT`/`easeOut3`, `IntRng`, `TickClock` | `static const int16_t[]`, `uint32_t` |
| `logo.ts` | `LogoCubes` (struktura tablic, sortowanie przez zliczanie po ticku lądowania), `LogoShow` (zdarzenia STEP/REVEAL/DONE) | tablice `int16_t x[MAX]…`, maska bitowa |
| `flow.ts` | `TypeProgress` (maszyna do pisania), `IntroFlow` (pisanie → czekanie → wygaszenie → plansza) | `struct` + `enum` |
| `menu.ts` | `MenuModel`, `titleMenu()` — fokus i nawigacja z zawijaniem, pomijanie nieaktywnych | tablica `struct { id; enabled; }` + `int focus` |
| `fx.ts` | fale `wave`/`phaseAt` (kąt = `(tq8 * w) >> 16`, przepełnienie uint32 nieszkodliwe), `ApproachCurve` (1−e^(−rt) z tablicy), `progressQ12`/`lerpQ12`, ognisko (`flameKQ12`…), pył `MoteField`, `blinkAlphaQ8`, kafle `potTiles` | tablice + `uint32_t` |

Testy: `node tests/core.selftest.ts` (sekcja „ekrany startowe”), m.in. `IntRng` = `makeRng`, determinizm logo,
zgodność `forEachFlying` z pełnym przejściem, przebieg intro i menu.

## Rysowanie: Phaser teraz → miniGL w porcie

**Logo** (`LogoScene.ts`)
- Siatka 160×90 kostek, skala ×3 → 480×270 (całkowita, bez rozmycia).
- Wylądowane kostki trafiają **raz** do tekstury 256×128 (używane 160×90): w porcie `glTexSubImage2D` tylko
  w klatkach, w których coś wylądowało. Wcześniej co klatkę wysyłane było płótno 960×540.
- Co klatkę rysowane są tylko kostki w locie: 4 kolorowe quady bez tekstury (cień, ściana, 2 krawędzie).
  Pętla kończy się wcześniej (kostki posortowane po lądowaniu, lot ≤ `LOGO_MAX_DUR`).
- Profil Amiga pomija przenikanie do pełnego JPG-a (tekstura > 256 px).

**Intro / menu** — wszystkie animacje (rakiety, grzyb atomowy, fala uderzeniowa, błysk, marsz ulicą, ślepia,
flaga, migotanie ogniska, karawana, latarnie, kołysanie logo, błysk podtytułu, pył i iskry w `Motes`) liczone są
w tickach przez `fx.ts`; scena tylko dzieli przez Q8/Q12 przy rysowaniu. Rozstawienie statycznych elementów
i malowanie teł zostaje w scenie — to grafika, w porcie: gotowe obrazki.

Tła i duże napisy idą przez `tiledImage()` (Kit): w profilu Amiga kafle ≤ 256 px w teksturach potęgi dwójki,
tak jak załaduje je miniGL. Budżet (16 bpp):

| Obraz | Kafle | Pamięć tekstur |
|---|---|---|
| tło 480×270 (tytuł, każda plansza intro) | 256×256, 256×256 (224 użyte), 256×16, 256×16 | 272 KB |
| logo tytułu (> 256 px szer.) | 2 | zależnie od szerokości |
| logo STORM 32 (kostki) | 256×128 | 64 KB |

Ekran tytułowy w profilu Amiga: 7 tekstur. Źródłowe płótno jest usuwane po pocięciu na kafle, a plansze intro
zwalniają tło poprzedniej planszy — naraz w pamięci są tylko 4 kafle tła.

**Efekty retro** (`FxScene.ts`) — trzy pełnoekranowe warstwy z alfą. W profilu Amiga wyłączone: bez shaderów
i przy limicie wypełniania to najdroższa rzecz na klatce.

## Mapa regionu i podróż między sektorami (`src/core/campaign/region.ts`)

Port `Oldgame/src/scenes/meta/worldterrain.js` + `worldmap.js` bez three.js. Wcześniej mapa była płaska
(malowana z góry), a drużyna szła prostą linią przez wszystko — także przez miasto i góry.

| Element | Logika (core, Q8 = 1/256 jednostki świata) | W C |
|---|---|---|
| Teren | `regionHeightF` (1:1 z `hgt()`: góry z grzbietami, wydmy, płaskowyże, krater z wałem, suche koryto, spłaszczone miasto i Przystań) wypiekany raz do `heightGrid()` 145×97 `Int16` (krok 0.5 j., 27.5 KB); `heightQ8` = interpolacja dwuliniowa na intach | `static const int16_t hmap[]` z pliku |
| Sektory | `SECTORS` (obrys, podpis, stałe miejsca zleceń), `PLAZAS` w mieście, `contractSpots` | tablica `struct` |
| Trasy | `buildRoute`: do ruin autostrada → brama → aleja → przecznica; poza miastem kręty szlak przez 2 punkty kontrolne odsunięte w bok, a gdy prosta przecina miasto — objazd od południa/północy. Catmull-Rom na intach (wagi Q8, suma 512), długości przez `isqrt` | `int32_t x[], z[], cum[]` |
| Marsz | `routeTicks` = max(6 s, długość / 4.2 j/s) w tickach 50 Hz; `routePointAt` (wyszukiwanie binarne po `cum`) | bez FPU |

Rysowanie (`scenes/iso/RegionArt.ts`): rzut ukośny z południa (7.4 px/j. w poziomie, 5.6 px/j. w głąb,
6 px na jednostkę wysokości). Teren malowany kolumnami „voxel space” od najbliższego do najdalszego z buforem Y,
cieniowanie stoków od NW, urwiska płaskowyżów ciemniejsze, jezioro w kraterze jako płaska tafla.
Budynki miasta, wieżowce, wiadukt, fabryki z kominami, chłodnia, obóz Nomadów i Przystań to bryły
(front + dach) sortowane po krawędzi frontu. Marker drużyny i bestie stoją na wysokości terenu, głębia po Y.
Całość to jeden obraz 480×270 → w profilu Amiga 4 kafle (`tiledImage`); w porcie gotowy obrazek.
Na żywo zostają tylko: szlaki (kropki), flagi, 7 ognisk, migająca latarnia bunkra, marker i 5 bestii.

## Profil Amiga w przeglądarce

`?profile=amiga` w URL (albo Opcje → „Profil Amiga”, po restarcie): 50 kl./s, bez nakładek FX,
logo bez dużej tekstury JPG. `?profile=pc` wymusza zwykły tryb.

## Następne kroki

1. ~~Animacje plansz intro na `isin` + ticki~~ — zrobione (`fx.ts`).
2. ~~Kafle ≤ 256 px dla teł w profilu Amiga~~ — zrobione (`tiledImage`, `potTiles`).
3. Tła: wypiec do obrazków (np. IFF/PNG z paletą) zamiast malowania w kodzie — w porcie nie będzie Canvas 2D.
4. ~~Mapa regionu z wysokościami i trasami między sektorami~~ — zrobione (`region.ts`, `RegionArt.ts`).
5. `src/core` poza ekranami startowymi: domyślne `Math.random` → wspólny ziarnisty RNG, koszty Dijkstry
   w półkrokach całkowitych (1→2, przekątna 1.5→3), `Math.hypot` → porównania kwadratów odległości.
6. Dźwięk: syntezę Web Audio wyrenderować do 8-bitowych sampli dla Paula/AHI.
