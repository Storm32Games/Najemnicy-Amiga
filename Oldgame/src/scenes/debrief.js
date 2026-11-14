// Debrief: apply mission results (XP, Złom, loot, rep, story), animate the rewards, save -> hub / victory / gameover.
import { THREE, UI, Audio, R, disposeObj, rngSeed, dunes, skyline, particles, makeFire, sprite, atmosphere, fadeLayer, className, itemName, itemTip, iconOf, portrait, bar, addToStash, signed } from './meta/common.js';
import { Game } from '../core/game.js';
import { refreshBoard, STORY_CONTRACTS } from '../data/contracts.js';

let D = null;
const short = (n) => n.split(' ')[0].replace(/"/g, '');

function apply(params) {
  const st = Game.state; let c = params.contract; if (typeof c === 'string') c = st.contracts.find(k => k.id === c);
  c = c || { title: 'Zlecenie', reward: { scrap: 0, xp: 0, items: [], rep: {} }, faction: 'survivors', travelDays: 1 };
  const result = params.result || 'success', ok = result === 'success', retreat = result === 'retreat';
  const mult = ok ? 1 : retreat ? 0.5 : 0, rw = c.reward || { scrap: 0, xp: 0, items: [], rep: {} };
  const res = { c, result, lines: [], levelups: [], scrap: 0, xp: 0, items: [], rep: {}, fallen: [], members: [], story: false, win: false };
  // casualties
  const names = new Set(params.casualties || []);
  const dead = st.party.filter(m => m.conditions?.dead || names.has(m.name));
  for (const m of dead) { (st.flags.fallen ||= []).push(m.name); if (m.recruitId) (st.flags.fallenIds ||= []).push(m.recruitId); res.fallen.push(m.name); }
  st.party = st.party.filter(m => !dead.includes(m));
  // scrap
  res.scrap = Math.round((params.scrap || 0) * (result === 'fail' ? 0 : 1) + rw.scrap * mult);
  for (const m of st.party) if (m.stolenScrap) { res.scrap += m.stolenScrap; res.stolen = (res.stolen || 0) + m.stolenScrap; m.stolenScrap = 0; }
  st.scrap += res.scrap;
  // items
  const loot = result === 'fail' ? [] : (params.loot || []);
  for (const i of loot) { addToStash(st, i); res.items.push(i.id); }
  if (ok) for (const id of rw.items || []) { addToStash(st, R.newItem(id)); res.items.push(id); }
  // rep
  if (ok) for (const [f, v] of Object.entries(rw.rep || {})) { st.rep[f] = (st.rep[f] || 0) + v; res.rep[f] = v; }
  else if (result === 'fail') { const f = c.faction || 'survivors'; st.rep[f] = (st.rep[f] || 0) - 1; res.rep[f] = -1; }
  // xp + survivors
  res.xp = Math.round((params.xp || 0) * (result === 'fail' ? 0.25 : retreat ? 0.5 : 1) + (ok ? rw.xp : 0));
  for (const m of st.party) {
    const before = { lvl: m.level, hp: m.maxHp, abil: [...(m.abilities || [])], xp: m.xp };
    if (m.hp <= 0) m.hp = 1; for (const k of ['dying', 'unconscious']) delete m.conditions[k];
    const g = R.addXP(m, res.xp);
    res.members.push({ m, before, gained: g, after: { lvl: m.level, hp: m.maxHp, abil: (m.abilities || []).filter(a => !before.abil.includes(a)) } });
  }
  // progress
  const idx = st.contracts.findIndex(k => k.id === c.id); if (idx >= 0) st.contracts.splice(idx, 1);
  if (ok) { st.completed.push(c.id); if (c.story) { st.story = (st.story || 0) + 1; res.story = true; if (c.type === 'boss' || /kostucha/i.test(c.title)) res.win = true; } }
  st.day += (c.travelDays || 1); st.log?.push?.({ day: st.day, text: `${c.title}: ${result}` });
  if (res.win) st.flags.victory = true;
  refreshBoard(st, ok ? 1 : 0); res.tpk = st.party.length === 0; if (!res.tpk) Game.save(); return res;
}

export default {
  scene: null, camera: null,
  enter(params = {}) {
    const st = Game.state; if (!st.party.length) Game.quickParty?.();
    if (!params.contract && !params.result) params = { contract: st.contracts[0], result: 'success', xp: 120, loot: [R.newItem('bandage', 2)], scrap: 25, casualties: [], ...params };
    const res = apply(params); D = { res, t: 0, q: [], sps: [], count: null };
    const ok = res.result === 'success';
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200); this.scene = scene; this.camera = cam;
    D.atmo = atmosphere(scene, ok ? 'dusk' : 'night');
    const g = dunes(120, 60, { amp: 0.5, base: ok ? [0.6, 0.42, 0.28] : [0.3, 0.25, 0.22], seed: 5 }); g.position.z = -10; scene.add(g);
    scene.add(skyline(rngSeed(8), { n: 24, x0: -50, x1: 50, z: -40, hMin: 5, hMax: 22, color: 0x1a1210, lit: true }));
    D.fire = makeFire(1.1); D.fire.position.set(0, 0, 0); scene.add(D.fire);
    D.dust = particles(60, { box: [30, 6, 14], center: [0, 0, 0], color: 0xf0c080, size: 1.5, vel: [1, 0.2, 0], seed: 3, opacity: 0.4 }); scene.add(D.dust);
    Game.state.party.forEach((ch, i) => { const sp = sprite(ch, 1.25), n = Game.state.party.length, a = Math.PI * (1.1 + 0.8 * (i / Math.max(1, n - 1))); sp.object3d.position.set(Math.cos(a) * 3.6 * -1 + 0, 0, Math.abs(Math.sin(a)) * 2 + 0.5); sp.object3d.position.x = (i - (n - 1) / 2) * 2.4; sp.object3d.position.z = 2 + (i % 2) * 0.6; scene.add(sp.object3d); sp.play(ch.hp < ch.maxHp * 0.4 ? 'hurt' : 'idle'); D.sps.push(sp); });
    cam.position.set(0, 2.6, 11); cam.lookAt(0, 2.2, 0);
    this.ui(); D.fade = fadeLayer('#000');
    Audio.music(ok ? 'victory' : 'defeat'); Audio.ambience('wind');
  },
  ui() {
    const r = D.res, head = { success: ['ZLECENIE WYKONANE', 'good'], retreat: ['ODWRÓT', 'amber'], fail: ['PORAŻKA', 'bad'] }[r.result] || ['KONIEC', 'amber'];
    const panel = UI.add(UI.el('div', { class: 'panel', style: 'position:absolute;left:5%;top:5%;width:90%;height:85%;display:flex;flex-direction:column;gap:.5em;background:#120e0af8' }));
    panel.append(UI.el('h2', { class: head[1], style: 'font-size:1.8em;margin:0;text-align:center;letter-spacing:.2em' }, head[0]), UI.el('div', { class: 'dim', style: 'text-align:center' }, r.c.title));
    D.body = UI.el('div', { style: 'flex:1;display:grid;grid-template-columns:1fr 1.3fr;gap:.8em;min-height:0' }); panel.append(D.body);
    D.left = UI.el('div', { style: 'display:flex;flex-direction:column;gap:.4em;overflow:auto' }); D.right = UI.el('div', { style: 'display:flex;flex-direction:column;gap:.4em;overflow:auto' }); D.body.append(D.left, D.right);
    D.foot = UI.el('div', { style: 'text-align:right;min-height:2.6em' }); panel.append(D.foot);
    const reveal = (parent, node, sfx) => { node.style.opacity = 0; node.style.transition = 'opacity .4s'; parent.append(node); requestAnimationFrame(() => node.style.opacity = 1); if (sfx) Audio.sfx(sfx); };
    let t = 0.4; const at = (d, fn) => D.q.push({ t: (t += d), fn });
    // scrap
    const sc = UI.el('div', { style: 'font-size:1.3em' }, 'Złom: ', UI.el('b', { class: 'amber' }, '+0'));
    at(0.2, () => { reveal(D.left, sc, 'coin'); D.count = { el: sc.lastChild, to: r.scrap, v: 0 }; });
    if (r.stolen) at(0.3, () => reveal(D.left, UI.el('div', { class: 'dim' }, `(w tym ${r.stolen} z kradzieży Szczura)`)));
    at(0.8, () => reveal(D.left, UI.el('div', {}, 'Doświadczenie: ', UI.el('b', { class: 'toxic' }, `+${r.xp} PD`), ' dla każdego żywego najemnika')));
    if (Object.keys(r.rep).length) at(0.5, () => reveal(D.left, UI.el('div', {}, 'Reputacja: ', ...Object.entries(r.rep).map(([f, v]) => UI.el('b', { class: v > 0 ? 'good' : 'bad', style: 'margin-right:.8em' }, `${f === 'nomads' ? 'Nomadzi' : 'Ocaleni'} ${v > 0 ? '+' : ''}${v}`)))));
    if (r.items.length) at(0.5, () => { const row = UI.el('div', { style: 'display:flex;flex-wrap:wrap;gap:.4em' }); r.items.forEach(id => row.append(UI.tooltip(UI.el('div', { class: 'panel', style: 'padding:.2em;display:flex;gap:.3em;align-items:center' }, UI.pixCanvas(iconOf(id, 32), '2em'), itemName(id)), () => itemTip(id)))); reveal(D.left, UI.el('div', {}, UI.el('div', { class: 'dim', style: 'margin:.3em 0' }, 'Łup:'), row), 'pickup'); });
    if (r.fallen.length) at(0.6, () => reveal(D.left, UI.el('div', { class: 'bad', style: 'margin-top:.5em' }, 'Polegli: ' + r.fallen.join(', ')), 'death'));
    if (r.story) at(0.6, () => reveal(D.left, UI.el('div', { class: 'amber', style: 'margin-top:.5em' }, r.win ? '★ Kostucha nie żyje!' : '★ Wątek fabularny posunął się naprzód.'), 'levelup'));
    // members
    r.members.forEach(({ m, before, gained, after }) => {
      const xpb = bar(before.xp / 1000, 'var(--amber)', '100%', '.6em'), fill = xpb.firstChild; fill.style.transition = 'width 1s';
      const row = UI.el('div', { class: 'panel', style: 'display:flex;gap:.7em;align-items:center;padding:.4em' }, UI.pixCanvas(portrait(m, 64), '3.4em'), UI.el('div', { style: 'flex:1' }, UI.el('b', {}, m.name), UI.el('span', { class: 'dim' }, ` ${className(m.classId)} poz. ${before.lvl}`), xpb, (D['lv' + m.id] = UI.el('div', { class: 'good', style: 'min-height:1.2em;font-weight:bold' }))));
      at(0.45, () => {
        reveal(D.right, row); setTimeout(() => {
          if (gained) { fill.style.width = '100%'; setTimeout(() => { fill.style.transition = 'none'; fill.style.width = (m.xp / 10) + '%'; D['lv' + m.id].innerHTML = `★ AWANS! Poziom ${after.lvl} · PW ${before.hp} → ${after.hp}` + (after.abil.length ? ` · nowa zdolność: ${after.abil.map(a => R.ABILITIES?.[a]?.name ?? a).join(', ')}` : ''); Audio.sfx('levelup'); }, 1000); }
          else fill.style.width = (m.xp / 10) + '%';
        }, 80);
      });
    });
    at(1.2, () => {
      D.foot.append(r.tpk ? UI.button('Dalej…', () => this.go('gameover'), { class: 'danger' }) : r.win ? UI.button('Koniec drogi… ▶', () => this.go('victory'), { class: 'primary' }) : UI.button('Wróć do Przystani ▶', () => this.go('hub'), { class: 'primary' }));
      D.foot.firstChild.style.fontSize = '1.2em';
    });
  },
  go(n) { D.fade.to(1, 500); setTimeout(() => { if (Game.current === this) Game.goto(n); }, 520); },
  update(dt) {
    if (!D) return; D.t += dt; D.fire.userData.update(D.t); D.dust.userData.update(dt); D.atmo.update?.(dt); D.sps.forEach(s => s.update(dt));
    while (D.q.length && D.q[0].t <= D.t) D.q.shift().fn();
    if (D.count) { D.count.v = Math.min(D.count.to, D.count.v + Math.max(1, D.count.to * dt * 1.2)); D.count.el.textContent = (D.count.to >= 0 ? '+' : '') + Math.round(D.count.v); }
  },
  exit() { if (D) { D.sps.forEach(s => s.dispose?.()); disposeObj(this.scene); } D = null; this.scene = null; },
};
