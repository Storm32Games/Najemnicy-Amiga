# Port na A1200 + PiStorm Lite 32 (miniGL) — ekrany startowe

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

**Intro / menu** — tła malowane raz na płótnie 480×270. W porcie: siatka tekstur ≤ 256 px
(np. 256+224 × 256+14) albo statyczny bitplane/chunky pod warstwą GL. Ruchome elementy (cząstki, ogniska,
postacie) to małe quady.

**Efekty retro** (`FxScene.ts`) — trzy pełnoekranowe warstwy z alfą. W profilu Amiga wyłączone: bez shaderów
i przy limicie wypełniania to najdroższa rzecz na klatce.

## Profil Amiga w przeglądarce

`?profile=amiga` w URL (albo Opcje → „Profil Amiga”, po restarcie): 50 kl./s, bez nakładek FX,
logo bez dużej tekstury JPG. `?profile=pc` wymusza zwykły tryb.

## Następne kroki

1. Sceny intro: animacje plansz (`Math.sin`, ułamkowe `t`) przenieść na `isin` + ticki.
2. Tła: dzielenie na kafle ≤ 256 px już w wersji webowej (w profilu Amiga), żeby zmierzyć liczbę tekstur.
3. `src/core` poza ekranami startowymi: domyślne `Math.random` → wspólny ziarnisty RNG, koszty Dijkstry
   w półkrokach całkowitych (1→2, przekątna 1.5→3), `Math.hypot` → porównania kwadratów odległości.
4. Dźwięk: syntezę Web Audio wyrenderować do 8-bitowych sampli dla Paula/AHI.
