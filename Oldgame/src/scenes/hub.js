// Przystań: 3D town diorama + menu (zlecenia, handlarz, lecznica, drużyna, karczma, zapis).
import { THREE, UI, Audio, R, disposeObj, rngSeed, dunes, skyline, particles, makeFire, sprite, atmosphere, prop, building, groundMat, fadeLayer, className, ancName, attrName, ATTR_LIST, signed, stat, skillName, profName, itemName, itemTip, itemRow, iconOf, portrait, partyLevel, bar, addToStash, pick } from './meta/common.js';
import { Game } from '../core/game.js';
import { Settings } from '../core/settings.js';
import { RECRUITS } from '../data/recruits.js';
import { generateName, plainName, shortName } from '../data/names.js';
import { nameEditor, colorPicker } from './meta/nameedit.js';
import { refreshBoard, storyHint, DIFFICULTY, BIOME_NAMES, TYPE_NAMES, FACTION_NAMES, MOOD_NAMES } from '../data/contracts.js';
import { shopStock, buyPrice, sellPrice, nomadDiscount } from '../data/shop.js';

let H = null;
const S = () => Game.state;
const living = () => S().party.filter(c => R.isAlive(c) && !c.conditions?.dead);
const fmtRep = (n) => (n > 0 ? '+' : '') + n;
const SLOTS = [['weapon', 'Broń główna', 'weapon'], ['weapon2', 'Broń zapasowa', 'weapon'], ['armor', 'Pancerz', 'armor'], ['shield', 'Tarcza', 'shield']];

function chip(text, cls = '', title) { return UI.el('span', { class: cls, title, style: 'border:1px solid currentColor;padding:0 .4em;font-size:.8em;white-space:nowrap' }, text); }
function popup(title, build) {
  const back = UI.el('div', { class: 'modal-back', style: 'z-index:45' }); const close = () => back.remove();
  const box = UI.el('div', { class: 'panel', style: 'min-width:34%;max-width:60%;max-height:80%;overflow:auto' }, UI.el('h2', {}, title));
  build(box, close); box.append(UI.el('div', { style: 'text-align:right;margin-top:.6em' }, UI.button('Zamknij', close)));
  back.append(box); back.addEventListener('pointerdown', e => { if (e.target === back) close(); }); UI.add(back); return close;
}

export default {
  scene: null, camera: null,
  enter(params = {}) {
    const s = S(); if (!s.party.length) Game.quickParty?.();
    refreshBoard(Game.state);
    H = { t: 0, win: null, tab: null, sps: [], anchors: [], sel: null, charIdx: 0 };
    this.build3D();
    this.buildUI();
    H.fade = fadeLayer('#000');
    Audio.music('town'); Audio.ambience('town');
    if (params.open) this.open(params.open);
  },
  // ---------------- 3D ----------------
  build3D() {
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 300); this.scene = scene; this.camera = cam;
    H.atmo = atmosphere(scene, 'dusk');
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), groundMat('concrete', 0x6a5f50)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    if (ground.material.map) { ground.material.map = ground.material.map.clone(); ground.material.map.wrapS = ground.material.map.wrapT = THREE.RepeatWrapping; ground.material.map.repeat.set(30, 20); ground.material.map.needsUpdate = true; }
    const far = dunes(200, 80, { amp: 2, base: [0.45, 0.34, 0.24], seed: 9 }); far.position.set(0, -0.3, -50); scene.add(far);
    scene.add(skyline(rngSeed(2), { n: 36, x0: -70, x1: 70, z: -44, hMin: 8, hMax: 30, color: 0x1a1210, lit: true }));
    const put = (o, x, z, ry = 0, sc = 1) => { o.position.set(x, 0, z); o.rotation.y = ry; if (!o.userData.fb) o.scale.multiplyScalar(sc); scene.add(o); return o; };
    put(building({ w: 10, d: 3, h: 2, ruined: false, seed: 4 }), 0, -9);
    put(building({ w: 4, d: 4, h: 3, ruined: true, seed: 8 }), -15, -8); put(building({ w: 4, d: 3, h: 2, ruined: true, seed: 9 }), 15, -8);
    // stalls / tents
    put(prop('tent', { seed: 1 }), -8, -3.5, 0.3, 2.2); put(prop('tent', { seed: 2 }), -11.5, -1.5, 0.8, 2); put(prop('tent', { seed: 3 }), 8.5, -4, -0.4, 2.2);
    put(prop('container', { seed: 1 }), 11.5, -1.5, 0.2, 1.6);
    for (const [x, z] of [[8.5, -1.5], [10, -1.2], [7, -2]]) put(prop('crate', { seed: x }), x, z, x, 1.2);
    put(prop('sign'), 3.8, -4.2, 0, 2.2); put(prop('generator'), -14, -3, 0.4, 1.4); put(prop('antenna'), 13.5, -4, 0, 2.5);
    for (const x of [-12, -5.5, 6, 13]) { const l = put(prop('lamp'), x, -1.6, 0, 2.1); const pl = new THREE.PointLight(0xffc070, 12, 12, 1.6); pl.position.set(x, 4.4, -1.4); scene.add(pl); H.lamps = (H.lamps || []).concat(pl); }
    for (let i = -4; i <= 4; i++) if (Math.abs(i) > 1) put(prop('fence'), i * 3.4, 6.5, 0, 1.6);
    for (const [x, z] of [[-4, -5], [5.5, -5.5], [-6.8, 0.6]]) put(prop('barrel'), x, z, 0, 1.2);
    put(prop('barrel_toxic'), 14, 1, 0, 1.2); put(prop('sandbags'), -2.5, 4, 0.2, 1.6); put(prop('sandbags'), 2.5, 4, -0.2, 1.6);
    put(prop('campfire'), 0, 0.8, 0, 1.4); H.fire = makeFire(1.2); H.fire.position.set(0, 0, 0.8); scene.add(H.fire);
    H.smoke = particles(40, { box: [2, 6, 2], center: [0, 0.5, 0.8], color: 0x8a8a90, size: 2, vel: [0.25, 0.8, 0], seed: 4, opacity: 0.35 }); scene.add(H.smoke);
    H.dust = particles(90, { box: [40, 7, 24], center: [0, 0, 0], color: 0xf0c080, size: 1.5, vel: [1.2, 0.1, 0.2], seed: 6, opacity: 0.4 }); scene.add(H.dust);
    // NPCs
    const npc = (desc, x, z, act, label, sc = 1.05) => { const sp = sprite(desc, sc); sp.object3d.position.set(x, 0, z); scene.add(sp.object3d); sp.play('idle'); H.sps.push(sp); H.anchors.push({ pos: new THREE.Vector3(x, 1.1, z), act, label }); return sp; };
    npc({ classId: 'scout', look: { body: 'medium', skin: '#a9785a', hair: '#d8c9a0', hairStyle: 3, cloth: '#8a7a55', accent: '#b4532a', mask: true } }, 9, -0.6, 'shop', 'Handlarz Nomadów');
    npc({ classId: 'medic', look: { body: 'light', skin: '#e0b896', hair: '#9a9a9a', hairStyle: 2, cloth: '#d9d2c0', accent: '#c43d2f' } }, -8, -1.4, 'heal', 'Lecznica');
    npc({ classId: 'soldier', look: { body: 'heavy', skin: '#c99a74', hair: '#3a2a20', hairStyle: 1, cloth: '#5b6b4a', accent: '#c9a23a' } }, 4.8, -3.2, 'board', 'Tablica zleceń');
    npc({ classId: 'techie', look: { body: 'medium', skin: '#c9a07a', hair: '#222', hairStyle: 4, cloth: '#3f5666', accent: '#8fd14f' } }, -13, -1, null, 'Mechanik');
    npc({ classId: 'scavenger', look: { body: 'light', skin: '#d0a583', hair: '#1c1c1c', hairStyle: 2, cloth: '#4a3f36', accent: '#f2a93b' } }, -5, 5.5, null, 'Wartownik');
    H.anchors.push({ pos: new THREE.Vector3(3.8, 2, -4.2), act: 'board', label: 'Tablica zleceń' });
    // party
    S().party.forEach((ch, i) => {
      const sp = sprite(ch, 1.2); const a = Math.PI * (0.25 + i * 0.5 / 3) + Math.PI * 0.25; sp.object3d.position.set(Math.cos(a + Math.PI * 0.5) * 3.1 * (i < 2 ? 1 : 1) + (i - 1.5) * 0.4, 0, 2.6 + Math.sin(i * 1.7) * 0.5); scene.add(sp.object3d); sp.play('idle'); H.sps.push(sp);
      if (!R.isAlive(ch)) sp.play('die');
    });
    S().party.forEach((ch, i) => { const sp = H.sps[H.sps.length - S().party.length + i]; sp.object3d.position.x = -3.9 + i * 2.6; });
    cam.position.set(0, 5.2, 15); cam.lookAt(0, 1.7, -1);
  },
  // ---------------- UI ----------------
  buildUI() {
    H.top = UI.add(UI.el('div', { class: 'panel', style: 'position:absolute;left:0;top:0;right:0;display:flex;gap:1.6em;align-items:center;padding:.35em 1.2em;border-width:0 0 3px 0' }));
    H.menu = UI.add(UI.el('div', { style: 'position:absolute;right:1.5%;top:9%;width:19%;display:flex;flex-direction:column;gap:.5em' }));
    H.winBox = UI.add(UI.el('div', { class: 'passthru', style: 'position:absolute;inset:0' }));
    this.drawTop(); this.drawMenu();
    H.hover = UI.add(UI.el('div', { class: 'panel', style: 'position:absolute;left:50%;transform:translateX(-50%);bottom:3%;display:none;padding:.3em .9em' }));
  },
  drawTop() {
    const s = S(), lvl = partyLevel(s), d = nomadDiscount(s);
    H.top.replaceChildren(UI.el('b', { class: 'amber', style: 'letter-spacing:.15em;font-size:1.1em' }, 'PRZYSTAŃ'),
      UI.el('span', {}, 'Złom: ', UI.el('b', { class: 'amber' }, String(s.scrap))), UI.el('span', {}, 'Dzień: ', UI.el('b', {}, String(s.day))),
      UI.el('span', { title: `Rabat u handlarzy: ${Math.round(d * 100)}%` }, 'Nomadzi: ', UI.el('b', { class: s.rep.nomads >= 0 ? 'good' : 'bad' }, fmtRep(s.rep.nomads))),
      UI.el('span', {}, 'Ocaleni: ', UI.el('b', { class: s.rep.survivors >= 0 ? 'good' : 'bad' }, fmtRep(s.rep.survivors))),
      UI.el('span', { class: 'dim', style: 'margin-left:auto' }, `Poziom drużyny: ${lvl} · Ukończone zlecenia: ${s.completed.length}`));
  },
  drawMenu() {
    const s = S(); H.menu.replaceChildren();
    const add = (label, fn, cls = '') => { const b = UI.button(label, fn, { class: cls }); b.style.cssText = 'text-align:left;padding:.6em .9em;font-size:1.05em'; H.menu.append(b); return b; };
    const hasStory = s.contracts.some(c => c.story);
    add('Tablica zleceń' + (hasStory ? ' ★' : ''), () => this.open('board'), 'primary');
    add('Handlarz Nomadów', () => this.open('shop'));
    add('Lecznica', () => this.open('heal'));
    add('Drużyna', () => this.open('party'));
    if (s.party.length < 4 || s.party.some(c => c.conditions?.dead)) add('Karczma — nowi najemnicy', () => this.open('tavern'), 'danger');
    H.menu.append(UI.el('div', { style: 'height:.6em' }));
    add('Opcje', () => Settings.open());
    add('Zapisz grę', () => { Game.save() ? (Audio.sfx('pickup'), UI.toast('Gra zapisana.')) : UI.toast('Zapis nie powiódł się!'); });
    add('Menu główne', async () => { if (await UI.modal({ title: 'Wyjść do menu?', body: 'Postęp zostanie zapisany.', buttons: [{ label: 'Zostań', value: false }, { label: 'Zapisz i wyjdź', value: true, class: 'primary' }] })) { Game.save(); Game.goto('title'); } });
  },
  open(tab) {
    H.tab = tab; H.winBox.replaceChildren(); const titles = { board: 'Tablica zleceń', shop: 'Handlarz Nomadów', heal: 'Lecznica', party: 'Drużyna', tavern: 'Karczma' };
    const win = UI.el('div', { class: 'panel', style: 'position:absolute;left:1.5%;top:8.5%;width:75%;height:86%;display:flex;flex-direction:column;z-index:10' });
    const head = UI.el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:.4em' }, UI.el('h2', { style: 'margin:0;font-size:1.3em' }, titles[tab]), UI.button('✕', () => this.close(), { title: 'Zamknij (Esc)' }));
    H.body = UI.el('div', { style: 'flex:1;min-height:0;display:flex;gap:.8em' }); win.append(head, H.body); H.winBox.append(win);
    Audio.sfx('door', { vol: 0.5 }); this['draw_' + tab]();
  },
  close() { H.tab = null; H.winBox.replaceChildren(); },
  refreshAll() { this.drawTop(); this.drawMenu(); if (H.tab) { const sc = H.body?.firstChild?.scrollTop; this['draw_' + H.tab](); } },
  // -------- Board --------
  draw_board() {
    const s = S(), lvl = partyLevel(s); const sel = s.contracts.find(c => c.id === H.sel) || s.contracts[0]; H.sel = sel?.id;
    const list = UI.el('div', { style: 'width:46%;overflow:auto;display:flex;flex-direction:column;gap:.5em;padding-right:.3em' });
    for (const c of s.contracts) {
      const df = DIFFICULTY(c.level, lvl), on = c.id === sel?.id;
      const card = UI.el('div', { class: 'panel', style: `cursor:pointer;padding:.5em .7em;${on ? 'border-color:var(--amber);background:#2c2214' : ''}` },
        UI.el('div', { style: 'display:flex;justify-content:space-between;gap:.5em' }, UI.el('b', { class: c.story ? 'amber' : '' }, (c.story ? '★ ' : '') + c.title), UI.el('span', { class: 'amber' }, c.reward.scrap + ' Z')),
        UI.el('div', { class: 'dim', style: 'font-size:.85em;margin:.15em 0' }, `${c.giver} · ${FACTION_NAMES[c.faction] || c.faction}`),
        UI.el('div', { style: 'display:flex;gap:.4em;flex-wrap:wrap' }, chip(TYPE_NAMES[c.type] || c.type, 'toxic'), chip('Poz. ' + c.level, ''), chip(df.label, df.cls), chip(BIOME_NAMES[c.biome] || c.biome, 'dim')));
      card.addEventListener('click', () => { H.sel = c.id; Audio.sfx('click'); this.draw_board(); }); list.append(card);
    }
    if (!s.contracts.length) list.append(UI.el('div', { class: 'dim' }, 'Tablica jest pusta. Odpocznij, a ktoś coś dopisze.'));
    list.append(UI.el('div', { class: 'dim', style: 'font-size:.85em;margin-top:.4em' }, storyHint(s)));
    const det = UI.el('div', { class: 'panel', style: 'flex:1;overflow:auto;display:flex;flex-direction:column;gap:.45em' });
    if (sel) {
      const df = DIFFICULTY(sel.level, lvl), cnt = {}; for (const e of sel.enemies || []) cnt[e] = (cnt[e] || 0) + 1;
      const obj = { eliminate: 'Wyeliminuj wszystkich wrogów.', retrieve: `Odzyskaj: ${itemName(sel.objective?.itemId)}.`, rescue: 'Odnajdź i uratuj jeńca.', hunt: 'Wytrop i zabij cel polowania.', boss: 'Zabij Kostuchę.' }[sel.type] || '';
      det.append(UI.el('h2', { style: 'margin:0' }, sel.title), UI.el('div', { class: 'dim' }, `Zleceniodawca: ${sel.giver} (${FACTION_NAMES[sel.faction] || ''})`),
        UI.el('div', { style: 'line-height:1.45' }, sel.desc),
        UI.el('div', {}, UI.el('span', { class: 'dim' }, 'Cel: '), obj), UI.el('div', {}, UI.el('span', { class: 'dim' }, 'Miejsce: '), `${BIOME_NAMES[sel.biome] || sel.biome}, ${MOOD_NAMES[sel.mood] || sel.mood}`),
        UI.el('div', {}, UI.el('span', { class: 'dim' }, 'Trudność: '), UI.el('b', { class: df.cls }, `${df.label} (zlecenie poz. ${sel.level} vs drużyna ${lvl})`)),
        UI.el('div', {}, UI.el('span', { class: 'dim' }, 'Podróż: '), `${sel.travelDays || 1} dni`),
        UI.el('div', {}, UI.el('span', { class: 'dim' }, 'Zwiad: '), Object.entries(cnt).map(([id, n]) => `${n}× ${R.ENEMIES?.[id]?.name ?? id}`).join(', ')),
        UI.el('div', { style: 'border-top:1px solid var(--edge);padding-top:.4em' }, UI.el('b', { class: 'amber' }, 'Nagroda: '), `${sel.reward.scrap} Złomu, ${sel.reward.xp} PD`,
          ...(sel.reward.items || []).map(id => UI.tooltip(UI.el('span', { style: 'margin-left:.6em' }, UI.pixCanvas(iconOf(id, 32), '1.6em'), ' ' + itemName(id)), () => itemTip(id))),
          Object.entries(sel.reward.rep || {}).map(([f, v]) => UI.el('span', { class: 'good', style: 'margin-left:.6em' }, `${f === 'nomads' ? 'Nomadzi' : 'Ocaleni'} ${fmtRep(v)}`))));
      const go = UI.button('Przyjmij zlecenie ▶', () => this.accept(sel), { class: 'primary' }); go.style.cssText = 'margin-top:auto;font-size:1.15em;padding:.6em';
      det.append(go);
    } else det.append(UI.el('div', { class: 'dim' }, 'Wybierz zlecenie z listy.'));
    H.body.replaceChildren(list, det);
  },
  async accept(c) {
    const p = living(); if (!p.length) return UI.toast('Brak sprawnych najemników!');
    const hurt = p.filter(x => x.hp < x.maxHp * 0.6);
    if (hurt.length) { const ok = await UI.modal({ title: 'Ranni najemnicy', body: `${hurt.map(h => plainName(h.name)).join(', ')} — nie jest w pełni sił. Wyruszyć mimo to?`, buttons: [{ label: 'Wróć do Przystani', value: false }, { label: 'Wyruszamy', value: true, class: 'primary' }] }); if (!ok) return; }
    Audio.sfx('door'); H.fade.to(1, 400); setTimeout(() => { if (Game.current === this) Game.goto('worldmap', { contract: c }); }, 420);
  },
  // -------- Shop --------
  draw_shop() {
    const s = S(), lvl = partyLevel(s), stock = shopStock(s, lvl);
    const mine = () => { const a = s.stash.map(i => ({ inst: i, src: 'Skrytka', arr: s.stash })); for (const c of s.party) for (const i of c.inventory) a.push({ inst: i, src: shortName(c.name), arr: c.inventory }); return a; };
    const left = UI.el('div', { style: 'flex:1;overflow:auto' }, UI.el('h3', {}, `Towary (rabat ${Math.round(nomadDiscount(s) * 100)}%)`));
    for (const id of stock) {
      const price = buyPrice(id, s), b = UI.button(price + ' Z', () => {
        if (s.scrap < price) { Audio.sfx('error'); return UI.toast('Za mało Złomu.'); }
        s.scrap -= price; addToStash(s, R.newItem(id)); Audio.sfx('buy'); this.refreshAll();
      }, { disabled: s.scrap < price }); b.style.padding = '.1em .6em';
      left.append(itemRow(id, { right: b, qty: 1 }));
    }
    const right = UI.el('div', { style: 'flex:1;overflow:auto' }, UI.el('h3', {}, 'Twoje rzeczy (sprzedaż)'));
    const items = mine(); if (!items.length) right.append(UI.el('div', { class: 'dim' }, 'Nic do sprzedania.'));
    for (const { inst, src, arr } of items) {
      const price = sellPrice(inst.id, s), b = UI.button(price ? '+' + price + ' Z' : '—', () => {
        if (!price) return; inst.qty > 1 ? inst.qty-- : arr.splice(arr.indexOf(inst), 1); s.scrap += price; Audio.sfx('coin'); this.refreshAll();
      }, { disabled: !price }); b.style.padding = '.1em .6em';
      right.append(itemRow(inst, { right: [UI.el('span', { class: 'dim', style: 'font-size:.75em' }, src), b] }));
    }
    H.body.replaceChildren(left, right);
    left.after(UI.el('div', { style: 'width:1px;background:var(--edge)' }));
  },
  // -------- Heal --------
  draw_heal() {
    const s = S(); const col = UI.el('div', { style: 'flex:1;overflow:auto;display:flex;flex-direction:column;gap:.5em' });
    col.append(UI.el('div', { class: 'dim', style: 'font-style:italic' }, '„Pokaż rękę. Nie, drugą. Ta wygląda, jakby przeżyła wojnę.” — Doktor Mika'));
    const cost = (c) => { const miss = c.maxHp - c.hp; const cond = Object.keys(c.conditions || {}).length; return miss <= 0 && !cond ? 0 : Math.ceil(miss * 1.5) + (cond ? 8 : 0); };
    for (const c of s.party) {
      const dead = c.conditions?.dead, k = cost(c);
      const b = UI.button(dead ? 'Poległ' : k ? `Ulecz (${k} Z)` : 'Zdrów', () => {
        if (s.scrap < k) { Audio.sfx('error'); return UI.toast('Za mało Złomu.'); }
        s.scrap -= k; c.hp = c.maxHp; c.conditions = {}; Audio.sfx('heal'); this.refreshAll();
      }, { disabled: dead || !k });
      col.append(UI.el('div', { class: 'panel', style: 'display:flex;gap:.8em;align-items:center;padding:.5em' }, UI.pixCanvas(portrait(c, 64), '3.6em'),
        UI.el('div', { style: 'flex:1' }, UI.el('b', {}, c.name), UI.el('div', { class: 'dim', style: 'font-size:.85em' }, `${className(c.classId)} poz. ${c.level}` + (Object.keys(c.conditions || {}).length ? ' · ' + Object.keys(c.conditions).map(k => R.CONDITIONS?.[k]?.name ?? k).join(', ') : '')),
          bar(c.hp / c.maxHp, c.hp / c.maxHp < 0.34 ? 'var(--bad)' : 'var(--good)'), UI.el('div', { style: 'font-size:.85em' }, `PW ${Math.max(0, c.hp)}/${c.maxHp}`)), b));
    }
    const total = s.party.filter(c => !c.conditions?.dead).reduce((a, c) => a + cost(c), 0);
    const side = UI.el('div', { style: 'width:34%;display:flex;flex-direction:column;gap:.7em' },
      UI.button(total ? `Ulecz wszystkich (${total} Z)` : 'Wszyscy zdrowi', () => { if (s.scrap < total) { Audio.sfx('error'); return UI.toast('Za mało Złomu.'); } s.scrap -= total; for (const c of s.party) if (!c.conditions?.dead) { c.hp = c.maxHp; c.conditions = {}; } Audio.sfx('heal'); this.refreshAll(); }, { class: 'primary', disabled: !total }),
      UI.el('div', { class: 'panel' }, UI.el('h3', {}, 'Odpoczynek'), UI.el('div', { style: 'line-height:1.4;margin-bottom:.6em' }, 'Prześpij noc w kwaterze: pełne PW i zdolności, ale mija dzień — tablica zleceń się zmienia.'),
        UI.button('Odpocznij (następny dzień)', () => this.rest())));
    H.body.replaceChildren(col, side);
  },
  rest() {
    const s = S(); for (const c of s.party) R.longRest(c); s.day++; refreshBoard(s, 2); Audio.sfx('heal'); UI.toast(`Dzień ${s.day}. Wypoczęci.`); this.refreshAll();
  },
  // -------- Party --------
  draw_party() {
    const s = S(); if (H.charIdx >= s.party.length) H.charIdx = 0; const ch = s.party[H.charIdx];
    const tabs = UI.el('div', { style: 'width:11%;display:flex;flex-direction:column;gap:.4em' });
    s.party.forEach((c, i) => { const t = UI.el('div', { class: 'panel', style: `cursor:pointer;padding:.3em;text-align:center;${i === H.charIdx ? 'border-color:var(--amber)' : ''}` }, UI.pixCanvas(portrait(c, 64), '3.6em'), UI.el('div', { style: 'font-size:.7em;line-height:1.1;overflow-wrap:anywhere' + (c.nameColor ? ';color:' + c.nameColor : '') }, shortName(c.name))); t.addEventListener('click', () => { H.charIdx = i; this.draw_party(); }); tabs.append(t); });
    if (!ch) { H.body.replaceChildren(tabs, UI.el('div', {}, 'Brak drużyny.')); return; }
    const cls = R.CLASSES?.[ch.classId];
    const kv = (k, v, cls2 = '') => UI.el('div', { style: 'display:flex;justify-content:space-between;gap:.5em' }, UI.el('span', { class: 'dim' }, k), UI.el('b', { class: cls2 }, v));
    const hdr = UI.el('div', { style: 'display:flex;gap:.8em;align-items:center' }, UI.pixCanvas(portrait(ch, 64), '6.4em'),
      UI.el('div', { style: 'flex:1' }, H.renaming === ch.id ? nameEditor({ value: ch.name, label: '', taken: () => s.party.filter(c => c !== ch).map(c => c.name),
          generate: () => generateName({ ancestry: ch.ancestry, classId: ch.classId, gender: RECRUITS.find(r => r.id === ch.recruitId)?.gender, taken: s.party.filter(c => c !== ch).map(c => c.name) }),
          onCommit: (n) => { ch.name = n; Audio.sfx('pickup', { vol: 0.5 }); this.draw_party(); },
          onDone: () => { if (H.renaming === ch.id) { H.renaming = null; this.draw_party(); } } })
          : UI.el('div', { style: 'display:flex;gap:.6em;align-items:baseline' }, UI.el('h2', { style: 'margin:0;font-size:1.25em;overflow-wrap:anywhere' + (ch.nameColor ? ';color:' + ch.nameColor : '') }, ch.name), this.mini('✎ Zmień imię', () => { H.renaming = ch.id; this.draw_party(); H.body.querySelector('.name-input')?.focus(); }, 'Nadaj najemnikowi nowe imię lub ksywę')), UI.el('div', { class: 'amber' }, `${className(ch.classId)} · ${ancName(ch.ancestry)} · poz. ${ch.level}`),
        colorPicker({ value: ch.nameColor || null, onPick: (c) => { if (c) ch.nameColor = c; else delete ch.nameColor; this.draw_party(); } }),
        UI.el('div', { style: 'display:flex;gap:.5em;align-items:center;font-size:.85em' }, 'PD', bar((ch.xp || 0) / 1000, 'var(--amber)', '12em'), `${ch.xp || 0}/1000`),
        UI.el('div', { style: 'display:flex;gap:.5em;align-items:center;font-size:.85em' }, 'PW', bar(ch.hp / ch.maxHp, 'var(--good)', '12em'), `${Math.max(0, ch.hp)}/${ch.maxHp}`)));
    const attrs = UI.el('div', { class: 'panel', style: 'padding:.5em' }, UI.el('h3', {}, 'Cechy'), ...ATTR_LIST.map(a => kv(attrName(a), signed(ch.attrs[a]), ch.attrs[a] > 0 ? 'good' : ch.attrs[a] < 0 ? 'bad' : '')));
    const def = UI.el('div', { class: 'panel', style: 'padding:.5em' }, UI.el('h3', {}, 'Obrona'), kv('KP', stat(ch, 'ac'), 'amber'), kv('Percepcja', signed(stat(ch, 'perception'))), kv('Wytrzymałość', signed(stat(ch, 'fortitude'))), kv('Refleks', signed(stat(ch, 'reflex'))), kv('Wola', signed(stat(ch, 'will'))), kv('KT klasy', stat(ch, 'classDC')), kv('Prędkość', stat(ch, 'speed') + ' pól'));
    const skills = UI.el('div', { class: 'panel', style: 'padding:.5em;overflow:auto' }, UI.el('h3', {}, 'Umiejętności'), ...Object.keys(R.SKILLS || {}).map(id => { const rk = id === 'perception' ? ch.prof?.perception ?? 0 : ch.prof?.skills?.[id] ?? 0; return UI.el('div', { style: `display:flex;justify-content:space-between;gap:.5em;opacity:${rk ? 1 : 0.55}` }, UI.el('span', {}, skillName(id)), UI.el('span', {}, UI.el('span', { class: 'dim', style: 'font-size:.75em' }, profName(rk) + ' '), UI.el('b', {}, signed(stat(ch, id))))); }));
    const eq = UI.el('div', { class: 'panel', style: 'padding:.5em' }, UI.el('h3', {}, 'Ekwipunek'));
    for (const [slot, label, type] of SLOTS) {
      const inst = ch.equipment?.[slot], it = inst && R.ITEMS?.[inst.id];
      const r = UI.el('div', { style: 'display:flex;align-items:center;gap:.5em;padding:.2em;cursor:pointer;border:1px dashed var(--edge);margin-bottom:.25em' }, inst ? UI.pixCanvas(iconOf(inst.id, 32), '2.2em') : UI.el('div', { style: 'width:2.2em;height:2.2em;background:#0006' }),
        UI.el('div', { style: 'flex:1;min-width:0' }, UI.el('div', { class: 'dim', style: 'font-size:.7em' }, label), UI.el('div', { style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, it?.name ?? '— puste —')));
      if (inst) UI.tooltip(r, () => itemTip(inst)); r.addEventListener('click', () => this.pickEquip(ch, slot, type)); eq.append(r);
    }
    const abil = UI.el('div', { class: 'panel', style: 'padding:.5em;overflow:auto' }, UI.el('h3', {}, 'Zdolności'), ...(ch.abilities || []).map(id => R.ABILITIES?.[id]).filter(Boolean).map(a => UI.el('div', { style: 'margin-bottom:.4em;line-height:1.3' }, UI.el('b', { class: 'toxic' }, a.name), UI.el('span', { class: 'dim', style: 'font-size:.8em' }, ` ${a.actions === 'reaction' ? '[reakcja]' : a.actions === 0 ? '[darmowa]' : '[' + a.actions + ' akc.]'}${a.uses ? ' · ' + (ch.uses?.[a.id] ?? '?') + ' użyć' : ''}`), UI.el('div', { style: 'font-size:.85em' }, a.desc))));
    const inv = UI.el('div', { class: 'panel', style: 'padding:.5em;overflow:auto' }, UI.el('h3', {}, 'Plecak'));
    for (const i of ch.inventory) { const it = R.ITEMS?.[i.id]; const bs = []; if (it?.consumable?.effect === 'heal') bs.push(this.mini('Użyj', () => this.useItem(ch, i))); bs.push(this.mini('→', () => { ch.inventory.splice(ch.inventory.indexOf(i), 1); addToStash(s, i); this.draw_party(); }, 'Do skrytki')); inv.append(itemRow(i, { right: bs })); }
    if (!ch.inventory.length) inv.append(UI.el('div', { class: 'dim' }, 'Pusty.'));
    inv.append(UI.el('h3', { style: 'margin-top:.6em' }, 'Skrytka drużyny'));
    for (const i of s.stash) inv.append(itemRow(i, { right: this.mini('← plecak', () => { s.stash.splice(s.stash.indexOf(i), 1); ch.inventory.push(i); this.draw_party(); }) }));
    if (!s.stash.length) inv.append(UI.el('div', { class: 'dim' }, 'Pusta.'));
    const grid = UI.el('div', { style: 'flex:1;min-width:0;display:grid;grid-template-columns:1fr 1.1fr 1.2fr;grid-template-rows:auto 1fr;gap:.6em;overflow:hidden' });
    hdr.style.gridColumn = '1 / 4';
    grid.append(hdr, UI.el('div', { style: 'display:flex;flex-direction:column;gap:.5em;overflow:auto' }, attrs, def), UI.el('div', { style: 'display:flex;flex-direction:column;gap:.5em;overflow:auto' }, skills, eq), UI.el('div', { style: 'display:flex;flex-direction:column;gap:.5em;overflow:auto' }, abil, inv));
    H.body.replaceChildren(tabs, grid);
  },
  mini(label, fn, title) { const b = UI.button(label, fn, { title }); b.style.cssText = 'padding:.05em .5em;font-size:.8em'; return b; },
  useItem(ch, inst) {
    const it = R.ITEMS[inst.id], c = it.consumable; if (!c) return;
    const amt = R.roll ? R.roll(c.amount || '1d6').total : 5; const before = ch.hp; ch.hp = Math.min(ch.maxHp, Math.max(ch.hp, 0) + amt);
    for (const k of c.cures || []) delete ch.conditions[k]; delete ch.conditions.dying; delete ch.conditions.unconscious;
    inst.qty > 1 ? inst.qty-- : ch.inventory.splice(ch.inventory.indexOf(inst), 1); Audio.sfx('heal'); UI.toast(`${shortName(ch.name)}: +${ch.hp - before} PW`); this.refreshAll();
  },
  pickEquip(ch, slot, type) {
    const s = S(); const cur = ch.equipment[slot];
    popup('Wybierz: ' + SLOTS.find(x => x[0] === slot)[1], (box, close) => {
      const cands = [...s.stash.map(i => ({ i, from: s.stash })), ...ch.inventory.map(i => ({ i, from: ch.inventory }))].filter(x => R.ITEMS?.[x.i.id]?.type === type);
      if (cur) box.append(itemRow(cur, { right: this.mini('Zdejmij', () => { ch.equipment[slot] = null; addToStash(s, cur); close(); this.refreshAll(); }) }));
      if (!cands.length) box.append(UI.el('div', { class: 'dim', style: 'margin:.5em 0' }, 'Brak pasujących przedmiotów w skrytce ani plecaku.'));
      for (const { i, from } of cands) box.append(itemRow(i, { right: this.mini('Załóż', () => {
        from.splice(from.indexOf(i), 1); if (cur) addToStash(s, cur); ch.equipment[slot] = i;
        if (type === 'weapon' && slot === 'weapon' && R.ITEMS[i.id]?.weapon?.hands === 2 && ch.equipment.shield) { addToStash(s, ch.equipment.shield); ch.equipment.shield = null; UI.toast('Broń dwuręczna: tarcza trafiła do skrytki.'); }
        Audio.sfx('pickup'); close(); this.refreshAll();
      }) }));
    });
  },
  // -------- Tavern --------
  draw_tavern() {
    const s = S(), lvl = partyLevel(s), cost = 120 + 60 * lvl;
    // recruits are tracked by id (names can be changed); old saves without recruitId fall back to names
    const have = new Set(s.party.map(c => c.recruitId || c.name)), fallen = s.flags.fallen || [], fallenIds = s.flags.fallenIds || [];
    const avail = RECRUITS.filter(r => !have.has(r.id) && !have.has(r.name) && !fallenIds.includes(r.id) && !fallen.includes(r.name));
    const hire = (r) => { const taken = s.party.map(c => c.name); const name = taken.some(t => t.toLowerCase() === r.name.toLowerCase()) ? generateName({ ancestry: r.ancestry, classId: r.classId, gender: r.gender, taken }) : r.name; return Object.assign(R.createCharacter({ ...r, name, level: lvl }), { recruitId: r.id }); };
    const slots = 4 - s.party.length;
    const col = UI.el('div', { style: 'flex:1;overflow:auto;display:flex;flex-direction:column;gap:.5em' }, UI.el('div', { class: 'dim' }, slots > 0 ? `W drużynie brakuje ${slots} osób. Najemnicy żądają ${cost} Złomu za podpis.` : 'Drużyna kompletna.'));
    if (fallen.length) col.append(UI.el('div', { class: 'bad', style: 'font-size:.85em' }, 'Polegli: ' + fallen.join(', ')));
    for (const r of avail) {
      const ch = R.createCharacter({ ...r, level: lvl });
      const b = UI.button(`Zatrudnij (${cost} Z)`, () => {
        if (s.party.length >= 4) return UI.toast('Drużyna jest pełna.'); if (s.scrap < cost) { Audio.sfx('error'); return UI.toast('Za mało Złomu.'); }
        s.scrap -= cost; s.party.push(hire(r)); Audio.sfx('buy'); this.refreshAll();
      }, { disabled: slots <= 0 || s.scrap < cost });
      col.append(UI.el('div', { class: 'panel', style: 'display:flex;gap:.8em;align-items:center;padding:.5em' }, UI.pixCanvas(portrait(ch, 64), '4em'),
        UI.el('div', { style: 'flex:1' }, UI.el('b', {}, r.name), UI.el('div', { class: 'amber', style: 'font-size:.85em' }, `${className(r.classId)} · ${ancName(ch.ancestry)} · poz. ${lvl} · PW ${ch.maxHp} · KP ${stat(ch, 'ac')}`), UI.el('div', { class: 'dim', style: 'font-size:.8em;font-style:italic' }, r.bio)), b));
    }
    if (!avail.length) col.append(UI.el('div', { class: 'dim' }, 'Nikogo więcej w karczmie nie ma.'));
    H.body.replaceChildren(col);
  },
  // -------- 3D interaction --------
  onPointerMove(ev, ndc) { if (!H) return; const a = this.hit(ndc); H.hover.style.display = a ? 'block' : 'none'; if (a) H.hover.textContent = a.label + (a.act ? ' — kliknij' : ''); Engine_cursor(a && a.act); },
  onPointerDown(ev, ndc) { if (!H) return; const a = this.hit(ndc); if (a?.act) this.open(a.act); },
  hit(ndc) {
    let best = null, bd = 0.09; for (const a of H.anchors) { const p = a.pos.clone().project(this.camera); const d = Math.hypot((p.x - ndc.x) * 1.78, p.y - ndc.y); if (d < bd) { bd = d; best = a; } } return best;
  },
  onKey(e) { if (e.key === 'Escape') this.close(); },
  update(dt) {
    if (!H) return; H.t += dt; H.fire.userData.update(H.t); H.smoke.userData.update(dt); H.dust.userData.update(dt); H.atmo.update?.(dt); H.sps.forEach(s => s.update(dt));
    this.camera.position.x = Math.sin(H.t * 0.12) * 1.6; this.camera.lookAt(0, 1.7, -1);
    if (H.lamps) H.lamps.forEach((l, i) => { l.intensity = 12 + Math.sin(H.t * 8 + i * 2) * 0.8 + (Math.sin(H.t * 41 + i) > 0.97 ? -5 : 0); });
  },
  exit() { if (H) { H.sps.forEach(s => s.dispose?.()); disposeObj(this.scene); } Engine_cursor(false); H = null; this.scene = null; },
};
function Engine_cursor(on) { const c = document.getElementById('view'); if (c) c.style.cursor = on ? 'pointer' : ''; }
