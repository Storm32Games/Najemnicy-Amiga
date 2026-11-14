// Przedmioty. Ceny w Złomie.
const W = (id, name, desc, price, level, icon, w) => ({ id, name, desc, type: 'weapon', price, level, icon,
  weapon: { dmgType: 'P', range: 0, category: 'simple', hands: 1, traits: [], group: 'melee', sfx: 'melee', potency: 0, ...w } });
const A = (id, name, desc, price, level, icon, a) => ({ id, name, desc, type: 'armor', price, level, icon, armor: { checkPenalty: 0, speedPenalty: 0, ...a } });
const S = (id, name, desc, price, level, icon, s) => ({ id, name, desc, type: 'shield', price, level, icon, shield: s });
const C = (id, name, desc, price, level, icon, c) => ({ id, name, desc, type: 'consumable', price, level, icon, consumable: { actions: 1, target: 'self', range: 1, ...c } });
const J = (id, name, desc, price, level, icon, type = 'junk') => ({ id, name, desc, type, price, level, icon });

const list = [
  // ---- broń biała
  W('knife', 'Nóż', 'Zwinny, łatwy do ukrycia. Dobry do ataku z ukrycia.', 15, 0, 'knife', { damage: '1d4', dmgType: 'P', traits: ['agile', 'finesse'] }),
  W('pipe', 'Rura', 'Kawał rury od hydrauliki. Boli.', 10, 0, 'pipe', { damage: '1d6', dmgType: 'B' }),
  W('machete', 'Maczeta', 'Pustkowiowy klasyk. Tnie krzaki i ludzi.', 35, 0, 'machete', { damage: '1d6', dmgType: 'S', traits: ['forceful'] }),
  W('fire_axe', 'Topór strażacki', 'Czerwony, ciężki, wciąż ostry.', 60, 1, 'axe', { damage: '1d8', dmgType: 'S', category: 'martial', traits: ['sweep'] }),
  W('sledgehammer', 'Młot kowalski', 'Obuch dwuręczny. Miażdży kości i drzwi.', 90, 1, 'hammer', { damage: '1d12', dmgType: 'B', category: 'martial', hands: 2, traits: ['shove'] }),
  W('monoblade', 'Ostrze monomolekularne', 'Rzadka technologia sprzed wojny. Przecina stal.', 900, 5, 'blade', { damage: '2d6', dmgType: 'S', category: 'martial', traits: ['agile', 'finesse'], potency: 1, tech: true }),
  // ---- broń dystansowa
  W('bow', 'Łuk', 'Cichy i tani. Strzały można zbierać.', 40, 0, 'bow', { damage: '1d6', dmgType: 'P', range: 10, category: 'martial', hands: 2, group: 'bow', traits: ['deadly:10'] }),
  W('crossbow', 'Kusza', 'Prosta, mocna, powolna.', 50, 0, 'crossbow', { damage: '1d8', dmgType: 'P', range: 10, hands: 2, group: 'bow' }),
  W('pistol', 'Pistolet 9mm', 'Zwykły, niezawodny, ostatni argument.', 70, 0, 'pistol', { damage: '1d8', dmgType: 'P', range: 8, group: 'firearm', sfx: 'shot_pistol', ammo: true }),
  W('revolver', 'Rewolwer', 'Ciężki kaliber. Krytyki bolą.', 120, 1, 'pistol', { damage: '1d8', dmgType: 'P', range: 9, category: 'martial', group: 'firearm', sfx: 'shot_pistol', traits: ['fatal:12'], ammo: true }),
  W('sawedoff', 'Obrzyn', 'Ucięta dubeltówka. Strach pomyśleć co robi z bliska.', 90, 0, 'shotgun', { damage: '2d4', dmgType: 'P', range: 3, group: 'firearm', sfx: 'shot_shotgun', traits: ['scatter'], ammo: true }),
  W('shotgun', 'Strzelba', 'Dwie lufy, jedna decyzja.', 180, 1, 'shotgun', { damage: '2d6', dmgType: 'P', range: 5, category: 'martial', hands: 2, group: 'firearm', sfx: 'shot_shotgun', traits: ['scatter'], ammo: true }),
  W('smg', 'Pistolet maszynowy', 'Szybki, hałaśliwy, żre amunicję.', 150, 1, 'smg', { damage: '1d6', dmgType: 'P', range: 7, category: 'martial', group: 'firearm', sfx: 'shot_smg', traits: ['automatic'], ammo: true }),
  W('rifle', 'Karabin', 'Dalekosiężny i solidny. Klasyk Żołnierzy.', 200, 1, 'rifle', { damage: '1d10', dmgType: 'P', range: 14, category: 'martial', hands: 2, group: 'firearm', sfx: 'shot_rifle', ammo: true }),
  W('hunting_rifle', 'Sztucer', 'Precyzyjny, z lunetą. Dla cierpliwych.', 260, 2, 'rifle', { damage: '1d10', dmgType: 'P', range: 18, category: 'martial', hands: 2, group: 'firearm', sfx: 'shot_rifle', traits: ['deadly:10'], potency: 0, ammo: true }),
  W('assault_rifle', 'Karabin szturmowy', 'Wojskowy zapas, który cudem przetrwał.', 450, 3, 'rifle', { damage: '1d10', dmgType: 'P', range: 14, category: 'martial', hands: 2, group: 'firearm', sfx: 'shot_smg', traits: ['automatic'], potency: 1, ammo: true }),
  W('laser_pistol', 'Pistolet laserowy', 'Rzadka technologia. Pali powietrze i skórę.', 600, 4, 'laser', { damage: '2d6', dmgType: 'fire', range: 10, category: 'martial', group: 'laser', sfx: 'shot_laser', potency: 1, tech: true }),
  W('laser_rifle', 'Karabin laserowy', 'Skarb pustkowi. Warty więcej niż cała osada.', 1500, 6, 'laser', { damage: '3d6', dmgType: 'fire', range: 16, category: 'martial', hands: 2, group: 'laser', sfx: 'shot_laser', potency: 1, tech: true }),
  // ---- pancerze
  A('leather', 'Skórzany kombinezon', 'Łatwy i lekki. Ochrona symboliczna.', 40, 0, 'armor_leather', { ac: 1, dexCap: 4, category: 'light' }),
  A('nomad_cloak', 'Płaszcz Nomada', 'Pylisty płaszcz z wstawkami. Pozwala dobrze się ruszać.', 60, 1, 'armor_leather', { ac: 1, dexCap: 5, category: 'light' }),
  A('scrap_armor', 'Pancerz ze złomu', 'Blachy z samochodów, sznurek, wiara.', 80, 1, 'armor_scrap', { ac: 2, dexCap: 3, checkPenalty: 1, category: 'light' }),
  A('scrap_plate', 'Pancerz płytowy ze złomu', 'Ciężki i hałaśliwy, ale trzyma kulę.', 160, 1, 'armor_scrap', { ac: 2, dexCap: 2, checkPenalty: 1, category: 'medium' }),
  A('kevlar', 'Kamizelka kewlarowa', 'Wojskowy zapas. Zatrzymuje kule.', 260, 2, 'armor_kevlar', { ac: 2, dexCap: 2, checkPenalty: 1, category: 'medium' }),
  A('riot_armor', 'Pancerz szturmowy', 'Płyty ceramiczne, hełm, nakolanniki.', 520, 3, 'armor_kevlar', { ac: 4, dexCap: 1, checkPenalty: 2, speedPenalty: 0, category: 'medium' }),
  A('power_armor', 'Pancerz wspomagany', 'Mechaniczny szkielet ze starej bazy. Rzadkość.', 1800, 6, 'armor_power', { ac: 6, dexCap: 0, checkPenalty: 3, speedPenalty: 1, category: 'heavy', tech: true }),
  // ---- tarcze
  S('scrap_shield', 'Tarcza ze złomu', 'Blacha od znaku drogowego.', 25, 0, 'shield', { ac: 2, hardness: 2, hp: 16 }),
  S('riot_shield', 'Tarcza szturmowa', 'Przezroczysty poliwęglan. Zatrzymuje kule i kamienie.', 130, 2, 'shield', { ac: 2, hardness: 5, hp: 30 }),
  // ---- konsumabelki
  C('stimpak', 'Stymulant', 'Strzykawka z mieszanką leczniczą. Leczy 2k6+4.', 50, 0, 'stim', { effect: 'heal', amount: '2d6+4', target: 'ally' }),
  C('bandage', 'Bandaż', 'Zatamuje krwawienie i trochę podleczy (1k6+2).', 15, 0, 'bandage', { effect: 'heal', amount: '1d6+2', target: 'ally', cures: ['bleeding'] }),
  C('medkit', 'Apteczka polowa', 'Pełny zestaw. Leczy 4k6+6.', 130, 3, 'medkit', { effect: 'heal', amount: '4d6+6', actions: 2, target: 'ally', cures: ['bleeding', 'poisoned'] }),
  C('antirad', 'Antyrad', 'Usuwa mdłości i zatrucie.', 30, 0, 'antirad', { effect: 'cleanse', cures: ['sickened', 'poisoned', 'burning'], target: 'ally' }),
  C('frag_grenade', 'Granat odłamkowy', '2k6 obrażeń kłutych w promieniu 2 (Refleks WT 17).', 55, 1, 'grenade', { effect: 'damage', amount: '2d6', dmgType: 'P', save: 'reflex', dc: 17, target: 'area', range: 6, radius: 2 }),
  C('molotov', 'Koktajl Mołotowa', '1k6 ognia + podpalenie (Refleks WT 15).', 30, 0, 'molotov', { effect: 'damage', amount: '1d6', dmgType: 'fire', save: 'reflex', dc: 15, target: 'area', range: 6, radius: 1, condition: { id: 'burning', value: '1d4' } }),
  C('smoke_grenade', 'Granat dymny', 'Dym w promieniu 2: cele są ukryte do końca tury.', 25, 0, 'smoke', { effect: 'smoke', target: 'area', range: 6, radius: 2 }),
  C('emp_grenade', 'Granat EMP', '3k6 elektr. maszynom i cyborgom + ogłuszenie (Refleks WT 18).', 80, 2, 'grenade', { effect: 'damage', amount: '3d6', dmgType: 'elec', save: 'reflex', dc: 18, target: 'area', range: 6, radius: 2, only: 'machine', condition: { id: 'stunned', value: 1 } }),
  C('combat_stim', 'Bojowy wzmacniacz', '+1 do trafienia i +2 do obrażeń przez 4 rundy.', 60, 1, 'stim', { effect: 'buff', target: 'self', buffs: [{ id: 'stimmed', value: 4 }, { id: 'tuned', value: 4 }] }),
  // ---- złom i tech do sprzedaży
  J('scrap_metal', 'Złom metalowy', 'Garść przydatnego żelastwa.', 5, 0, 'junk'),
  J('copper_wire', 'Zwój miedzi', 'Cenny dla Techników.', 8, 0, 'cable'),
  J('canned_food', 'Konserwa', 'Data ważności: sprzed wojny.', 6, 0, 'junk'),
  J('old_watch', 'Stary zegarek', 'Nadal tyka. Zadziwiające.', 15, 0, 'junk'),
  J('trophy_teeth', 'Szczęka-trofeum', 'Znak gangu Żelaznych Szczęk. Handlarze płacą za dowód.', 20, 1, 'junk'),
  J('mutant_gland', 'Gruczoł mutanta', 'Śmierdzi, ale alchemicy płacą.', 30, 1, 'junk'),
  J('fuel_can', 'Kanister paliwa', 'Płynne złoto pustkowi.', 35, 1, 'junk'),
  J('battery', 'Akumulator', 'Jeszcze trzyma ładunek.', 25, 1, 'battery', 'tech'),
  J('gas_mask', 'Maska gazowa', 'Starego typu, z filtrem.', 50, 1, 'mask'),
  J('memory_card', 'Karta pamięci', 'Dane sprzed końca świata.', 35, 1, 'chip', 'tech'),
  J('radio_part', 'Część radiowa', 'Do naprawy nadajnika.', 40, 1, 'chip', 'tech'),
  J('circuit', 'Układ scalony', 'Rzadki, delikatny, drogi.', 45, 2, 'chip', 'tech'),
  J('vacuum_tube', 'Lampa próżniowa', 'Kolekcjonerzy płacą nieźle.', 45, 2, 'chip', 'tech'),
  J('drone_parts', 'Części drona', 'Serwa, optyka, procesor.', 60, 2, 'chip', 'tech'),
  J('power_core', 'Rdzeń zasilający', 'Zasila generatory przez lata.', 120, 4, 'battery', 'tech'),
  J('ammo_box', 'Skrzynka amunicji', 'Do wymiany z handlarzem.', 20, 0, 'junk', 'ammo'),
];
export const ITEMS = Object.fromEntries(list.map((i) => [i.id, i]));
export const UNARMED = { id: 'fist', name: 'Pięść', desc: 'Gołe ręce.', type: 'weapon', price: 0, level: 0, icon: 'fist',
  weapon: { damage: '1d4', dmgType: 'B', range: 0, category: 'unarmed', hands: 1, traits: ['agile', 'finesse'], group: 'unarmed', sfx: 'melee', potency: 0 } };
export const sellPrice = (idOrDef) => { const it = typeof idOrDef === 'string' ? ITEMS[idOrDef] : idOrDef; return it ? Math.max(1, Math.floor(it.price / 2)) : 0; };
