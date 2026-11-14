// Recruitment: choose exactly 4 of 10 premade mercenaries.
import { THREE, UI, Audio, R, disposeObj, rngSeed, dunes, skyline, particles, makeFire, sprite, atmosphere, prop, fadeLayer, className, ancName, attrName, ATTR_LIST, signed, stat, skillName, profName, portrait, ensureScreen } from './meta/common.js';
import { Game } from '../core/game.js';
import { RECRUITS } from '../data/recruits.js';
import { generateContracts } from '../data/contracts.js';
import { generateName, plainName } from '../data/names.js';
import { nameEditor, colorPicker, NAME_COLORS, esc } from './meta/nameedit.js';

let S = null;
// preview characters are keyed by recruit id (the name can be edited); they become the party on start
const preview = (r) => (S.cache[r.id] ||= Object.assign(R.createCharacter(r), { recruitId: r.id }));
const nameOf = (r) => S.names.get(r) ?? r.name;
const otherNames = (r) => RECRUITS.filter(x => x !== r).map(nameOf);

function statsBlock(ch) {
  const cls = R.CLASSES?.[ch.classId];
  const chips = ATTR_LIST.map(a => UI.el('div', { style: 'text-align:center;background:#0006;border:1px solid var(--edge);padding:.15em .1em' },
    UI.el('div', { class: 'dim', style: 'font-size:.7em' }, attrName(a).slice(0, 3).toUpperCase()), UI.el('div', { class: (ch.attrs[a] > 0 ? 'good' : ch.attrs[a] < 0 ? 'bad' : '') , style: 'font-size:1.15em;font-weight:bold' }, signed(ch.attrs[a]))));
  const skills = Object.entries(ch.prof?.skills || {}).filter(([, r]) => r > 0).map(([id, r]) => [id, stat(ch, id), r]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const abil = (ch.abilities || []).map(id => R.ABILITIES?.[id]).filter(Boolean).slice(0, 4);
  return UI.el('div', {},
    UI.el('div', { style: 'display:grid;grid-template-columns:repeat(6,1fr);gap:.3em;margin:.5em 0' }, chips),
    UI.el('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:.3em .8em;margin-bottom:.4em' },
      UI.el('div', {}, UI.el('span', { class: 'dim' }, 'PW '), UI.el('b', { class: 'good' }, ch.maxHp)),
      UI.el('div', {}, UI.el('span', { class: 'dim' }, 'KP '), UI.el('b', { class: 'amber' }, stat(ch, 'ac'))),
      UI.el('div', {}, UI.el('span', { class: 'dim' }, 'Szybk. '), UI.el('b', {}, stat(ch, 'speed'))),
      UI.el('div', {}, UI.el('span', { class: 'dim' }, 'Wytrz. '), UI.el('b', {}, signed(stat(ch, 'fortitude')))),
      UI.el('div', {}, UI.el('span', { class: 'dim' }, 'Refleks '), UI.el('b', {}, signed(stat(ch, 'reflex')))),
      UI.el('div', {}, UI.el('span', { class: 'dim' }, 'Wola '), UI.el('b', {}, signed(stat(ch, 'will'))))),
    UI.el('div', { class: 'dim', style: 'font-size:.8em' }, 'Kluczowe umiejętności'),
    UI.el('div', { style: 'display:flex;flex-wrap:wrap;gap:.3em;margin:.2em 0 .5em' }, skills.map(([id, v, r]) => UI.el('span', { style: 'border:1px solid var(--edge);padding:.05em .4em;background:#0005', title: profName(r) }, `${skillName(id)} ${signed(v)}`))),
    UI.el('div', { class: 'dim', style: 'font-size:.8em' }, 'Zdolności'),
    UI.el('div', { style: 'display:flex;flex-wrap:wrap;gap:.3em;margin:.2em 0 .4em' }, abil.length ? abil.map(a => UI.tooltip(UI.el('span', { class: 'toxic', style: 'border:1px solid #4f6a2a;padding:.05em .4em;background:#0005' }, a.name), `<b class="amber">${a.name}</b><br>${a.desc}`)) : UI.el('span', { class: 'dim' }, '—')),
    UI.el('div', { class: 'dim', style: 'font-size:.8em' }, 'Wyposażenie: ' + ['weapon', 'armor', 'shield'].map(k => ch.equipment?.[k]).filter(Boolean).map(i => R.ITEMS?.[i.id]?.name ?? i.id).join(', ')),
    cls ? UI.el('div', { class: 'dim', style: 'font-size:.8em;margin-top:.3em' }, `Rola: ${cls.role || ''}`) : null);
}

export default {
  scene: null, camera: null,
  enter() {
    S = { picks: [], cache: {}, sps: [], t: 0, cards: [], view: RECRUITS[0], names: new Map(), cardName: new Map() };
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200); this.scene = scene; this.camera = cam;
    S.atmo = atmosphere(scene, 'dusk');
    const g = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshLambertMaterial({ color: 0x4a3c30 })); g.rotation.x = -Math.PI / 2; scene.add(g);
    scene.add(skyline(rngSeed(9), { n: 30, x0: -50, x1: 50, z: -22, hMin: 5, hMax: 20, color: 0x1d1410, lit: true }));
    for (const x of [-9, 9]) { const l = prop('lamp'); l.position.set(x, 0, -3); if (!l.userData.fb) l.scale.setScalar(2); scene.add(l); }
    S.fire = makeFire(0.8); S.fire.position.set(-7, 0, 1); scene.add(S.fire);
    S.dust = particles(80, { box: [30, 6, 14], center: [0, 0, 0], color: 0xf0c080, size: 2, vel: [1.5, 0.1, 0], seed: 3, opacity: 0.5 }); scene.add(S.dust);
    cam.position.set(0, 1.4, 11); cam.lookAt(0, 3.2, 0);
    // UI
    UI.add(UI.el('div', { style: 'position:absolute;left:3%;top:2.5%;right:3%;display:flex;justify-content:space-between;align-items:baseline' },
      UI.el('h2', { style: 'font-size:1.8em;margin:0' }, 'Zbierz drużynę'), (S.count = UI.el('div', { style: 'font-size:1.2em' }))));
    // 2026-11-13: 16 mercenaries in a 4 x 4 grid; the portrait fills the card, the name lies on its lower edge
    const grid = UI.el('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:.35em' });
    RECRUITS.forEach(r => {
      const ch = preview(r), card = UI.el('div', { class: 'panel', style: 'cursor:pointer;padding:.22em;text-align:center;position:relative;transition:transform .1s;min-width:0' });
      const pc = UI.pixCanvas(portrait(ch, 128), '100%'); pc.style.display = 'block'; pc.style.aspectRatio = '1';
      const nm = UI.el('div', { style: 'position:absolute;left:0;right:0;bottom:0;font-size:.68em;line-height:1.5;padding:0 .2em;background:#000b;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:1px 1px 0 #000' }, plainName(nameOf(r))); S.cardName.set(r, nm);
      card.append(UI.el('div', { style: 'position:relative;border:1px solid #000' }, pc, nm),
        UI.el('div', { class: 'amber', style: 'font-size:.6em;line-height:1.3;margin-top:.15em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, className(r.classId)),
        UI.el('div', { class: 'dim', style: 'font-size:.56em;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, ancName(ch.ancestry)));
      card.addEventListener('click', () => { Audio.sfx('click'); this.toggle(r); this.show(r); });
      card.addEventListener('mouseenter', () => { if (!S.detail.contains(document.activeElement)) this.show(r); });
      UI.tooltip(card, () => `<b class="amber">${esc(nameOf(r))}</b><br>${className(r.classId)}, ${ancName(ch.ancestry)}<br>PW ${ch.maxHp} · KP ${stat(ch, 'ac')}<br><i>${r.bio}</i>`);
      S.cards.push([r, card]); grid.append(card);
    });
    UI.add(UI.panel('left:2.5%;top:9.5%;width:33%;padding:.5em .6em;', UI.el('h3', { style: 'margin:0 0 .35em' }, 'Najemnicy do wzięcia'), grid));
    S.detail = UI.add(UI.panel('left:37%;top:9.5%;width:60.5%;height:76%;overflow:auto'));
    const bottom = UI.add(UI.el('div', { style: 'position:absolute;left:2.5%;right:2.5%;bottom:3%;display:flex;justify-content:space-between;align-items:flex-end' }));
    bottom.append(UI.button('◀ Wróć', () => this.leave('title')), (S.hint = UI.el('div', { class: 'dim', style: 'text-shadow:2px 2px 0 #000;font-size:1.05em;padding-bottom:.4em' })), UI.el('div', { style: 'display:flex;gap:.8em' }, UI.button('Pomoc', () => this.help(), { title: 'Porównanie klas i ras z Pathfinderem 2e' }), UI.button('⚄ Losuj drużynę', () => this.randomParty(), { title: 'Wylosuj czterech najemników (różne role)' }), (S.start = UI.button('Rozpocznij ▶', () => this.begin(), { class: 'primary' }))));
    S.start.style.fontSize = '1.2em';
    S.fade = fadeLayer('#000'); this.show(RECRUITS[0]); this.refresh();
    Audio.music('title'); Audio.ambience('town');
    const q = new URLSearchParams(location.search).get('pick'); if (q) q.split(',').forEach(i => this.toggle(RECRUITS[+i]));
  },
  show(r) {
    S.view = r; const ch = preview(r); S.detail.replaceChildren(
      UI.el('div', { style: 'display:flex;gap:.8em;align-items:center' }, UI.pixCanvas(portrait(ch, 64), '7em'),
        UI.el('div', { style: 'flex:1;min-width:0' }, (S.title = UI.el('h2', { style: 'font-size:1.25em;margin:0;overflow-wrap:anywhere' + (ch.nameColor ? ';color:' + ch.nameColor : '') }, nameOf(r))), UI.el('div', { class: 'amber' }, className(r.classId) + (R.CLASSES?.[r.classId]?.pf2e ? ` (PF2e: ${R.CLASSES[r.classId].pf2e})` : '') + ' — ' + (R.CLASSES?.[r.classId]?.role || '')), UI.el('div', { class: 'dim' }, ancName(ch.ancestry) + ' · poz. 1'), UI.el('div', { class: 'dim', style: 'font-size:.78em' }, R.ANCESTRIES?.[ch.ancestry]?.pf2e ? `odpowiednik PF2e: ${R.ANCESTRIES[ch.ancestry].pf2e} — ${R.ANCESTRIES[ch.ancestry].perk || ''}` : ''))),
      nameEditor({ value: nameOf(r), taken: () => otherNames(r),
        generate: () => generateName({ ancestry: ch.ancestry, classId: r.classId, gender: r.gender, taken: otherNames(r) }),
        reset: () => r.name,
        onCommit: (n) => { if (n === r.name) S.names.delete(r); else S.names.set(r, n); ch.name = n; S.title.textContent = n; S.cardName.get(r).textContent = plainName(n); } }),
      colorPicker({ value: ch.nameColor || null, onPick: (c) => { if (c) ch.nameColor = c; else delete ch.nameColor; S.title.style.color = c || ''; S.cardName.get(r).style.color = c || 'var(--text)'; } }),
      UI.el('div', { style: 'font-style:italic;margin:.5em 0;line-height:1.4;color:#cbbf9f' }, '„' + r.bio + '"'), statsBlock(ch));
    S.cards.forEach(([rr, c]) => { c.style.outline = rr === r ? '2px dashed var(--edge-hi)' : 'none'; });
  },
  /** Help: the game's classes and origins next to their Pathfinder 2e counterparts. */
  help() {
    const AB = R.ABILITIES || {}, th = (t) => `<th style="text-align:left;padding:.25em .5em;border-bottom:2px solid var(--edge);color:var(--amber);white-space:nowrap">${t}</th>`, td = (t, st = '') => `<td style="padding:.22em .5em;border-bottom:1px solid #ffffff14;vertical-align:top;${st}">${t}</td>`;
    const cls = Object.values(R.CLASSES || {}).map(c => `<tr>${td(`<b style="color:${c.color || 'inherit'}">${esc(c.name)}</b>`, 'white-space:nowrap')}${td(esc(c.pf2e || '—'), 'white-space:nowrap')}${td(esc(c.role || ''), 'white-space:nowrap')}${td(`${c.hpPerLevel}`, 'text-align:center')}${td((c.abilities || []).map(id => esc(AB[id]?.name || id)).join(', '), 'color:#cbbf9f')}</tr>`).join('');
    const AT = { str: 'Siła', dex: 'Zręczność', con: 'Kondycja', int: 'Inteligencja', wis: 'Mądrość', cha: 'Charyzma' };
    const boosts = (a) => { const b = Object.entries(a.attrBoosts || {}).map(([k, v]) => k === 'free' ? (v > 1 ? `${v} dowolne` : 'jedna dowolna') : AT[k] || k), f = Object.keys(a.attrFlaw || {}).map(k => '−' + (AT[k] || k)); return b.join(', ') + (f.length ? ' / ' + f.join(', ') : ''); };
    const anc = Object.values(R.ANCESTRIES || {}).map(a => `<tr>${td(`<b>${esc(a.name)}</b>`, 'white-space:nowrap')}${td(esc(a.pf2e || '—'), 'white-space:nowrap')}${td(a.hp, 'text-align:center')}${td(a.speed, 'text-align:center')}${td(esc(boosts(a)), 'color:#cbbf9f')}</tr>`).join('');
    UI.modal({ title: 'Pomoc — klasy i rasy a Pathfinder 2e', body: `<div style="font-size:.7em;line-height:1.25;max-height:46em;overflow:auto;padding-right:.4em">
<div class="dim" style="margin-bottom:.5em">Gra używa zasad Pathfinder 2e (k20 + modyfikatory, 3 akcje na turę, cztery stopnie sukcesu). Każda klasa i rasa to odpowiednik z PF2e w postapokaliptycznym przebraniu.</div>
<table style="border-collapse:collapse;width:100%"><tr>${th('Klasa')}${th('Odpowiednik PF2e')}${th('Rola')}${th('PW / poz.')}${th('Zdolności')}</tr>${cls}</table>
<table style="border-collapse:collapse;width:100%;margin-top:1em"><tr>${th('Rasa')}${th('Odpowiednik PF2e')}${th('PW rasy')}${th('Prędkość')}${th('Premie / wada')}</tr>${anc}</table>
<div class="dim" style="margin-top:.6em">Drużyna to czterech najemników. „Losuj drużynę” dobiera różne role i losowe kolory imion — kolor i imię można potem zmienić w panelu po prawej.</div></div>`, buttons: [{ label: 'Zamknij', value: true, class: 'primary' }] });
    const box = document.querySelector('.modal-back .modal'); if (box) { box.style.maxWidth = '94%'; box.style.width = '90%'; }   // wide enough for both tables without scrolling
  },
  /** Random squad: 4 recruits, as many different roles as possible. */
  randomParty() {
    const pool = RECRUITS.slice().sort(() => Math.random() - 0.5), picks = [];
    for (const r of pool) if (picks.length < 4 && !picks.some(p => p.classId === r.classId)) picks.push(r);
    for (const r of pool) if (picks.length < 4 && !picks.includes(r)) picks.push(r);
    // every drawn mercenary also gets a random (distinct) name colour; it can still be changed with the swatches
    const cols = NAME_COLORS.filter(Boolean).sort(() => Math.random() - 0.5);
    picks.forEach((r, i) => { const c = cols[i % cols.length]; preview(r).nameColor = c; const nm = S.cardName.get(r); if (nm) nm.style.color = c; });
    S.picks = picks; this.refresh(); this.show(picks[0]);
  },
  toggle(r) {
    const i = S.picks.indexOf(r);
    if (i >= 0) S.picks.splice(i, 1); else if (S.picks.length < 4) S.picks.push(r); else { Audio.sfx('error'); UI.toast('Drużyna jest pełna — odrzuć kogoś najpierw.'); return; }
    this.refresh();
  },
  refresh() {
    S.cards.forEach(([r, c]) => { const on = S.picks.includes(r); c.style.borderColor = on ? 'var(--toxic)' : ''; c.style.background = on ? '#22301aee' : ''; c.style.transform = on ? 'translateY(-.15em)' : ''; });
    S.count.innerHTML = `Wybrano: <b class="${S.picks.length === 4 ? 'good' : 'amber'}">${S.picks.length}/4</b>`;
    S.start.disabled = S.picks.length !== 4; S.hint.textContent = S.picks.length === 4 ? 'Gotowi. Pustkowia czekają.' : `Wybierz jeszcze ${4 - S.picks.length}.`;
    const roles = new Set(S.picks.map(r => r.classId)); if (S.picks.length === 4 && roles.size < 3) S.hint.textContent += ' (Uwaga: mało różnorodna drużyna)';
    // 3D sprites
    S.sps.forEach(s => { scene_remove(this.scene, s.sp); s.sp.dispose?.(); }); S.sps = [];
    S.picks.forEach((r, i) => { const sp = sprite(preview(r), 1.35); this.scene.add(sp.object3d); sp.play('idle'); S.sps.push({ sp, i, born: S.t }); });
    Audio.sfx(S.picks.length ? 'pickup' : 'click', { vol: 0.5 });
  },
  begin() {
    if (S.picks.length !== 4) return;
    Game.newGame(); const st = Game.state;
    // the previewed characters themselves (same id -> same look as on this screen), with the chosen names
    st.party = S.picks.map(r => { const ch = JSON.parse(JSON.stringify(preview(r))); ch.name = nameOf(r); ch.recruitId = r.id; return ch; });
    st.stash.push(R.newItem('bandage', 3), R.newItem('stimpak', 1));
    st.contracts = generateContracts(st); Game.save(); this.leave('hub');
  },
  leave(n) { S.fade.to(1, 400); setTimeout(() => { if (Game.current === this) Game.goto(n); }, 410); },
  update(dt) {
    if (!S) return; S.t += dt; S.fire.userData.update(S.t); S.dust.userData.update(dt); S.atmo.update?.(dt);
    const n = S.sps.length;
    S.sps.forEach((s, idx) => { const k = Math.min(1, (S.t - s.born) * 4), x = (idx - (n - 1) / 2) * 3.2; s.sp.object3d.position.set(x, 0, 2 + Math.sin(idx) * 0.2); s.sp.object3d.scale.setScalar(1.35 * (0.6 + 0.4 * k)); s.sp.update(dt); });
  },
  exit() { if (S) { S.sps.forEach(s => s.sp.dispose?.()); disposeObj(this.scene); } S = null; this.scene = null; },
};
function scene_remove(scene, sp) { scene.remove(sp.object3d); }
