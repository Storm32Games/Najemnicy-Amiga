// Logika gry "Pył i Rdza" (migracja z Oldgame/). ZERO zależności od Phasera, Three.js i DOM.
//   data/      - tabele treści (klasy, rasy, przedmioty, wrogowie, zdolności, rekruci)
//   rules/     - zasady PF2e: kości, statystyki, obrażenia, tury, atak, zdolności, ekwipunek, awans
//   tactical/  - siatka 2D, generator map, walka turowa, AI wrogów, misja (eksploracja i cele)
//   campaign/  - stan kampanii, zlecenia, sklep/lecznica, rozliczenie misji, zdarzenia w podróży
export * from './data/index.ts';
export * from './rules/index.ts';
export * from './tactical/index.ts';
export * from './campaign/index.ts';
