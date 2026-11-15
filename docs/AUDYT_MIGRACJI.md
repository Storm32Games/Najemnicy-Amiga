# Audyt migracji Oldgame → Phaser (2026-11-15)

Porównanie `Oldgame/` (Three.js) z `src/` i lista poprawek z gałęzi `audit/migration-parity`.

## Stan po audycie
- **Zasady i dane** (`src/core/rules`, `src/core/data`): zgodne 1:1. `tests/balance.selftest.ts` powtarza symulację
  walk 4v4 ze starego selftestu na tym samym ziarnie i daje te same wyniki (62,7% / 43% / 82%).
- **Kampania**: tytuł → werbunek → Przystań → podróż → misja → podsumowanie → zwycięstwo / koniec gry.
- **Mapy**: 4 biomy (ruiny, pustkowia, strefa przemysłowa, bunkier), 5 nastrojów (dzień, zmierzch, noc, toksyczny, burza).

## Poprawki
| Obszar | Zmiana |
|---|---|
| Misja | Obrót kamery Q/E (4 widoki), zoom 0,4–2,5, klik w nieodkryty teren prowadzi drużynę, do skrzyni podchodzi wybrany najemnik, klik wybranego najemnika otwiera kartę, wybicie drużyny → od razu `GameOverScene`, akcja interakcji schodzi tylko po sukcesie, reakcje niedostępne jako akcja, losowe barwy i rozmiar fauny |
| Zasadzka | Atak na nieświadomą grupę wymaga testu Skradania (`Mission.ambushAttack`); w Oldgame zasadzki nie było |
| Jednostki | 36 klatek na kierunek (oddech, chód, cios, strzał, trafienie, rzucanie, śmierć z leżącym ciałem), odrębne sylwetki 16 wrogów, fryzury i dodatki z Oldgame, cechy ras |
| Efekty | Błysk wystrzału, wybuch z falą i dymem, ogień, iskry u maszyn zamiast krwi, pixelowa kostka d20, nastroje (światła nocą, deszcz i błyskawice, toksyczna mgła), `?mood=` w demie |
| Dźwięk | `geiger` przy skażeniu, `growl` u bestii, `radio` przy celach, grzmot, ambient zależny od biomu i nastroju |
| Ikony i UI | Własna ikona dla każdego z 52 przedmiotów i 46 zdolności, ikony i portrety malowane w rozdzielczości ekranu, ikony w karcie postaci w misji, pełna lista łupów w podsumowaniu |
| Mapy | Kafel `grass_dead`, wyraźnie zniszczona `wall_broken`, nowy wrak auta, roślinność z `flora.js` jako dekoracja (osobny RNG, bez wpływu na ścieżki i widoczność) |
| Sceny meta | Mapa podróży: lista zleceń, panel szczegółów, pasek Złom/Dzień, kamera, auto-wymarsz; opcja „Rozmiar interfejsu”; figurki wybranych w werbunku; „KONIEC DROGI” z poległymi; napisy 34 s; Wartownik; skróty `?scene=…&open=…`, `&slide=N` także w buildzie produkcyjnym |
| Testy | `npm test` = `core.selftest.ts` + `balance.selftest.ts` |

## Świadome różnice względem Oldgame
- Odwrót tylko w turze najemnika (nie w trakcie tury wroga).
- Tab nie przełącza na powalonych najemników.
- Rozmiar interfejsu skaluje okna, podpowiedzi i komunikaty, ale nie HUD misji.
- Rozdzielczość zmienia się na żywo poza misją; w misji wymaga restartu.
- Dziennik walki: zwijanie i przewijanie, bez przeciągania i zmiany rozmiaru.

## Znane niedoróbki
- Widoki potworów od tyłu prawie nie różnią się od bocznych; klatki pośrednie upadku są poszarpane.
- Na mapie podróży znacznik drużyny i część napisu „PRZYSTAŃ” mogą chować się pod listą zleceń przy zoomie 1×.
- `src/core/{GridSystem,LineOfSight,Pathfinder}.ts` nie są używane przez sceny (dubel `tactical/grid.ts`).
