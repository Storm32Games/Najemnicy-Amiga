// Combat controller: initiative, PF2e 3-action turns, strikes/abilities/items, enemy AI.
import { THREE } from '../core/engine.js';
import { UI } from '../core/ui.js';
import { G, Audio, ABILITIES, ITEMS, ENEMIES, getStat, getWeapon, getWeapons, atkBonus, degreeOf, doStrikeRule, weaponRange, normW, useConsumable, applyDamage, heal, addCondition, removeCondition, hasCondition,
  isAlive, isDown, startTurn, endTurn, rollInitiative, skillCheck, roll, rnd, condName, DEGREE_NAMES } from './rl.js';
import { cheb, dist } from './util.js';
import { R } from './rl.js';

export function createCombat(M) {
  const H = () => M.hud;
  const C = { active: false, order: [], round: 1, idx: 0, locked: false, auto: false };
  const W = () => M.map.W;
  const vis = (a) => !!M.vis[a.y * W() + a.x];
  const speedOf = (a) => Math.max(1, Math.round(getStat(a.ch, 'speed')) || 5);
  const foesOf = (a) => (a.side === 'pc' ? M.enemies.filter(e => e.group.alerted) : M.pcs).filter(f => f.state === 'up');
  const alliesOf = (a) => (a.side === 'pc' ? M.pcs : M.enemies).filter(f => f !== a);
  const UNIV = ['strike', 'raise_shield', 'take_cover', 'demoralize', 'first_aid', 'stand'];
  const tpl = (a) => ENEMIES[a.ch.templateId] || {};
  const charActor = (ch) => M.actors.find(a => a.ch === ch) || M.actors.find(a => a.ch.id && a.ch.id === ch?.id);
  const aiType = (a) => (a.side === 'enemy' ? a.ch.ai || tpl(a).ai || 'melee' : 'pc');
  const isStable = (a) => a.state === 'down' && !a.ch.conditions?.dying;

  // ---------- state sync (up / down / dead)
  function sync(a) {
    const ch = a.ch; let s = !isAlive(ch) ? 'dead' : (isDown(ch) || ch.hp <= 0) ? 'down' : 'up';
    if (a.side === 'enemy' && s !== 'up') s = 'dead';
    if (s !== a.state) {
      const prev = a.state; a.state = s;
      if (s === 'dead' || s === 'down') {
        a.sprite.play('die'); M.drawBar(a);
        if (s === 'dead' && a.side === 'enemy') {
          if (!M.killed.includes(ch)) M.killed.push(ch); M.sfx(a.sprite && /beast|mutant/.test(tpl(a).faction || '') ? 'scream' : 'death', { vol: 0.7 });
          M.refreshObjective(); M.updateVis();
        } else if (s === 'down') { M.float(a, 'POWALONY!', '#ff4a3a'); M.sfx('scream'); }
        else if (s === 'dead') { M.log(`${ch.name} POLEGŁ.`, 'bad'); M.float(a, 'ZGINĄŁ', '#ff4a3a'); M.sfx('death'); }
      } else if (s === 'up' && prev !== 'up') { a.sprite.play('idle'); M.log(`${ch.name} wraca do walki.`, 'good'); }
    }
    M.drawBar(a); return s;
  }
  function syncAll() { for (const a of M.actors) if (a.side !== 'neutral') sync(a); M.hud.party_(); M.hud.initBar(); }
  C.syncAll = syncAll;

  // ---------- combat rolls info
  const weaponOf = (a) => pickedWeapon.get(a) || getWeapon(a.ch);
  const pickedWeapon = new Map();
  function flanked(att, def, w) {
    if (weaponRange(w) > 0 || cheb(att, def) > 1) return false;
    const ox = -(att.x - def.x), oy = -(att.y - def.y);
    return alliesOf(att).some(z => z.state === 'up' && cheb(z, def) === 1 && z.x - def.x === ox && z.y - def.y === oy);
  }
  /** Temporarily apply geometric cover / flanking to the defender's conditions (rules read them in getStat('ac')). */
  function withTemp(def, geoCover, flank, fn) {
    const c = def.ch.conditions, sv = { ic: c.in_cover, og: c.off_guard };
    if (geoCover) c.in_cover = sv.ic >= 1 ? 2 : 1;
    if (flank && !c.off_guard) c.off_guard = 1;
    try { return fn(); } finally {
      if (def.ch.hp > 0) { if (sv.ic === undefined) delete c.in_cover; else c.in_cover = sv.ic; }
      if (sv.og === undefined) delete c.off_guard; else c.off_guard = sv.og;
    }
  }
  /** Info about attacking def from position pos (default current). */
  function strikeInfo(att, def, w, pos) {
    w = w || weaponOf(att); pos = pos || att; const nw = normW(w); const info = { ok: false, reason: '', w, nw };
    const d = cheb(pos, def), r = weaponRange(w); let los = { clear: true, cover: false }, inc = 0;
    if (r === 0) { if (d > 1) { info.reason = 'za daleko'; info.melee = true; return info; } }
    else { if (d > r * 6) { info.reason = 'poza zasięgiem'; return info; } los = M.grid.los(pos, def); if (!los.clear) { info.reason = 'brak linii strzału'; return info; } inc = Math.ceil(d / r) - 1; }
    const fl = flanked({ x: pos.x, y: pos.y, side: att.side, ch: att.ch }, def, w);
    const mapIdx = Math.min(2, att.mapN || 0), mod = atkBonus(att.ch, w, mapIdx, { rangeIncrements: inc });
    const ac = withTemp(def, r > 0 && los.cover, fl, () => getStat(def.ch, 'ac', { ignoreCover: r === 0 }));
    const base = getStat(def.ch, 'ac', { ignoreCover: r === 0 });
    let hit = 0, crit = 0; for (let k = 1; k <= 20; k++) { const g = degreeOf(k, mod, ac); if (g >= 2) hit++; if (g === 3) crit++; }
    Object.assign(info, { ok: true, mod, ac, base, hit: hit * 5, crit: crit * 5, flank: fl, geoCover: r > 0 && los.cover, inc, mapIdx, ranged: r > 0 });
    return info;
  }
  C.strikeInfo = strikeInfo;
  const infoHtml = (att, def, i) => {
    const mapTxt = i.mapIdx ? `<span class="bad">PWA ${i.mapIdx === 1 ? '-5' : '-10'}${w_agile(i.w) ? ' (zwinna: ' + (i.mapIdx === 1 ? '-4' : '-8') + ')' : ''}</span>` : '';
    const notes = [i.flank && '<span class="good">flankowanie (odsłonięty -2 KP)</span>', i.geoCover && '<span class="bad">osłona (+2 KP)</span>', i.inc && `<span class="bad">dystans -${2 * i.inc}</span>`, mapTxt].filter(Boolean).join(' · ');
    return `<b class="bad">${def.ch.name}</b> <span class="dim">poz. ${def.ch.level || 1}</span><br>PW ${Math.max(0, def.ch.hp)}/${def.ch.maxHp} · KP ${i.ac}<br><b class="amber">${att.ch.name}: ${i.nw.name || 'atak'}</b> — trafienie <b class="${i.hit >= 50 ? 'good' : 'bad'}">${i.hit}%</b> (krytyk ${i.crit}%)<br>Obrażenia: ${i.nw.dmg || '?'}${notes ? '<br>' + notes : ''}`;
  };
  const w_agile = (w) => !!normW(w)?.traits?.includes?.('agile');

  // ---------- effects of results
  function applyEvents(res, src) {
    const evs = res?.events || []; let missShown = new Set();
    for (const ev of evs) {
      const ta = charActor(ev.target); if (!ta) continue;
      const pos = M.vec(ta, 1.3);
      if (ev.type === 'damage') {
        const crit = ev.degree === 3; M.float(ta, crit ? `-${ev.amount}!` : `-${ev.amount ?? ''}`, ta.side === 'pc' ? '#ff6a50' : crit ? '#ffe060' : '#ffd24a');
        try { G.spawnEffect(M.scene, 'blood', pos); } catch (e) {} ta.sprite.play('hurt'); M.sfx(crit ? 'crit' : 'hit', { vol: 0.7 });
      } else if (ev.type === 'heal') { M.float(ta, `+${ev.amount}`, '#7fe05a'); try { G.spawnEffect(M.scene, 'heal', pos); } catch (e) {} M.sfx('heal'); }
      else if (ev.type === 'miss') { M.float(ta, 'PUDŁO', '#bbbbbb'); missShown.add(ta); M.sfx('miss', { vol: 0.6 }); }
      else if (ev.type === 'condition') { M.float(ta, condName(ev.condition), '#e0a0ff'); }
            M.drawBar(ta);
    }
    syncAll();
  }
  function logRes(res, att, cls) { for (const l of res?.log || []) M.log(l, cls || 'dim'); }
  async function showDice(r, label, att) {
    if (!r) return; if (M.fast || M.speed >= 4) return; if (att.side !== 'pc' && M.speed >= 2) return;
    if (!vis(att) && att.side !== 'pc') return;
    try { await G.showD20Roll({ ...r, label }); } catch (e) {}
  }
  const sfxOf = (w) => normW(w)?.sfx || (weaponRange(w) > 0 ? 'shot_pistol' : 'melee');
  function alarmNear(a, r) { for (const g of M.groups) { if (g.alerted || !g.actors.some(e => e.state !== 'dead')) continue; if (g.actors.some(e => e.state !== 'dead' && cheb(e, a) <= r)) join(g, 'Hałas przyciąga uwagę!'); } }

  // ---------- STRIKE
  async function strike(att, def, w, opts = {}) {
    w = w || weaponOf(att);
    const inf = strikeInfo(att, def, w); if (!inf.ok) return false;
    M.faceToward(att, def); M.faceToward(def, att); const ranged = inf.ranged;
    const nm = inf.nw.name || 'atak';
    if (vis(att) || vis(def)) M.focus((att.x + def.x) / 2, (att.y + def.y) / 2);
    const res = withTemp(def, inf.geoCover, inf.flank, () => doStrikeRule(att.ch, def.ch, { weapon: w, mapIndex: inf.mapIdx, rng: rnd, rangeIncrements: inc0(inf) }));
    att.mapN = (att.mapN || 0) + 1; if (att.ch.conditions?.in_cover) delete att.ch.conditions.in_cover;
    const d = res.d20;
    const note = [inf.flank && 'flankowanie', inf.geoCover && 'osłona', inf.mapIdx && (inf.mapIdx === 1 ? 'PWA -5' : 'PWA -10'), inf.inc && 'dystans'].filter(Boolean).join(', ');
    await showDice(d, `Atak: ${nm}`, att);
    if (d) {
      const deg = d.degree, cls = att.side === 'pc' ? (deg >= 3 ? 'amber' : deg >= 2 ? 'good' : 'dim') : (deg >= 2 ? 'bad' : 'dim');
      M.log(`${att.ch.name} → ${def.ch.name} (${nm}): k20 ${d.d20}${d.mod >= 0 ? '+' : ''}${d.mod} = ${d.total} vs KP ${d.dc} — ${DEGREE_NAMES[deg]}${note ? ' [' + note + ']' : ''}`, cls);
    }
    if (ranged) {
      att.sprite.play('shoot'); M.sfx(sfxOf(w), { vol: 0.8 }); alarmNear(att, 9);
      try { G.spawnEffect(M.scene, 'muzzle', M.vec(att, 1.1)); G.spawnTracer(M.scene, M.vec(att, 1.1), M.vec(def, 1.0), att.side === 'pc' ? 0xffe090 : 0xff8060); } catch (e) {}
      await M.wait(260);
    } else {
      att.sprite.play('attack'); M.sfx(sfxOf(w), { vol: 0.8 });
      await M.tween(0.16, (k) => { const s = Math.sin(k * Math.PI) * 0.35; M.setPos(att, att.x + (def.x - att.x) * s, att.y + (def.y - att.y) * s); }); M.setPos(att, att.x, att.y);
    }
    if (d && d.degree < 2 && !(res.events || []).some(e => e.type === 'miss')) { M.float(def, 'PUDŁO', '#bbbbbb'); M.sfx('miss', { vol: 0.5 }); }
    logRes(res, 'dim'); applyEvents(res, att);
    await M.wait(380);
    C.checkEnd(); return true;
  }
  const inc0 = (inf) => inf.inc || 0;

  // ---------- movement
  function reachFor(a, actions) {
    const sp = speedOf(a);
    const passFn = (x, y) => { const o = M.actorAt(x, y); return !o || o.side === a.side; };
    return { res: M.grid.search(a.x, a.y, sp * actions, passFn), sp };
  }
  const costActions = (cost, sp) => Math.max(1, Math.ceil(cost / sp - 1e-6));
  C.speedOf = speedOf;
  async function stride(a, path, nActions) {
    const t = M.turn; t.actions -= nActions; M.refreshAll(); if (a.ch.conditions?.in_cover) delete a.ch.conditions.in_cover;
    await M.walk(a, path, async () => { if (a.side === 'pc') { joinNearby(); } return true; });
    M.focus(a.x, a.y); updateHL(); M.refreshAll();
  }
  C.stride = stride;

  // ---------- abilities
  const usesLeft = (a, ab) => {
    if (!ab.uses) return Infinity; const u = a.ch.uses?.[ab.id]; if (typeof u === 'number') return u; return a.used[ab.id] ? 0 : 1;
  };
  const abCost = (ab) => (ab.actions === 'reaction' ? 99 : ab.actions ?? 1);
  function abTargets(a, ab) {
    const range = ab.move ? speedOf(a) + 1 : (ab.range ?? 1), kind = ab.target;
    const inR = (t) => cheb(a, t) <= range && (range <= 1 || M.grid.los(a, t).clear);
    if (kind === 'enemy') return foesOf(a).filter(inR);
    if (kind === 'ally') return M.pcs.concat(M.enemies).filter(x => x.side === a.side && x.state !== 'dead' && (x === a || inR(x)));
    return [];
  }
  function areaTargets(cell, radius) { return M.actors.filter(x => x.side !== 'neutral' && x.state !== 'dead' && Math.hypot(x.x - cell.x, x.y - cell.y) <= (radius || 1) + 0.45); }
  async function useAbility(a, ab, targets, cell) {
    const t = M.turn; const cost = ab.actions === 'reaction' ? 0 : (ab.actions ?? 1);
    t.actions -= cost; if (cost === 0) a.used['_free_' + ab.id] = true;
    const before = a.ch.uses?.[ab.id];
    if (ab.move && tg0(targets)) { const f = targets[0]; const sp = speedOf(a); const { res: rr } = reachFor(a, 1); let best = null, bc = 1e9; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = f.x + dx, y = f.y + dy; if ((!dx && !dy) || !M.grid.free(x, y) || (M.occupied(x, y) && !(x === a.x && y === a.y))) continue; const c = rr.cost[y * W() + x]; if ((x === a.x && y === a.y) || (c > 0 && c < bc)) { bc = x === a.x && y === a.y ? 0 : c; best = { x, y }; } } if (best && !(best.x === a.x && best.y === a.y)) { const pp = M.grid.pathFrom(rr, best.x, best.y); if (pp) await M.walk(a, pp); } }
    M.log(`${a.ch.name} używa: ${ab.name}.`, a.side === 'pc' ? 'amber' : 'bad');
    let res = null;
    try { res = ab.resolve({ user: a.ch, targets: targets.map(x => x.ch), rng: rnd, mapIndex: Math.min(2, a.mapN || 0), cell }); } catch (e) { console.warn('ability failed', ab.id, e); M.log('Nic z tego nie wyszło.', 'dim'); }
    if (ab.uses) { if (typeof before === 'number' && a.ch.uses[ab.id] === before) a.ch.uses[ab.id] = Math.max(0, before - 1); else if (typeof before !== 'number') a.used[ab.id] = true; }
    if (res?.attack) a.mapN = (a.mapN || 0) + (res.attacks || 1);
    const tg = targets[0]; if (tg && tg !== a) M.faceToward(a, tg);
    const fx = ab.fx;
    if (vis(a) || (tg && vis(tg))) M.focus(tg && fx !== 'buff' ? tg.x : a.x, tg && fx !== 'buff' ? tg.y : a.y);
    if (res?.d20) await showDice(res.d20, ab.name, a);
    if (fx === 'melee') { a.sprite.play('attack'); M.sfx('melee'); await M.wait(300); }
    else if (fx === 'shot') { a.sprite.play('shoot'); M.sfx('shot_rifle'); alarmNear(a, 9); for (const x of targets) { try { G.spawnEffect(M.scene, 'muzzle', M.vec(a, 1.1)); G.spawnTracer(M.scene, M.vec(a, 1.1), M.vec(x, 1.0)); } catch (e) {} } await M.wait(300); }
    else if (fx === 'explosion') { a.sprite.play('shoot'); const c = cell || (tg && { x: tg.x, y: tg.y }); if (c) { try { G.spawnEffect(M.scene, 'explosion', M.vecXY(c.x, c.y, 0.6)); } catch (e) {} } M.sfx('explosion'); alarmNear(a, 10); await M.wait(450); }
    else if (fx === 'heal') { a.sprite.play('cast'); await M.wait(200); }
    else if (fx === 'buff' || fx === 'shout') { a.sprite.play('cast'); try { G.spawnEffect(M.scene, 'buff', M.vec(a, 0.8)); } catch (e) {} M.sfx(fx === 'shout' ? 'alarm' : 'heal', { vol: 0.6 }); await M.wait(300); }
    else { a.sprite.play('cast'); await M.wait(250); }
    if (res) { logRes(res, 'dim'); applyEvents(res, a); } else syncAll();
    await M.wait(300); C.checkEnd();
  }

  // ---------- consumables
  const consumables = (a) => (a.ch.inventory || []).filter(it => ITEMS[it.id]?.type === 'consumable' && it.qty > 0);
  async function useItem(a, it, tgt, cell) {
    const def = ITEMS[it.id], c = def.consumable || {}; const t = M.turn; t.actions -= (c.actions ?? 1);
    a.sprite.play('cast'); M.faceToward(a, tgt || cell || a);
    let targets = [a];
    if (c.target === 'area') targets = areaTargets(cell, c.radius || 1);
    else if (tgt) targets = [tgt];
    let res; try { res = useConsumable(a.ch, it, targets.map(x => x.ch), rnd); } catch (e) { console.warn(e); res = { log: ['Nie udało się.'], events: [] }; }
    if (c.effect === 'damage') { const cc = cell || tgt; if (cc) { try { G.spawnEffect(M.scene, 'explosion', M.vecXY(cc.x, cc.y, 0.6)); } catch (e) {} } M.sfx('explosion'); alarmNear(a, 10); }
    else M.sfx('heal');
    if (res.d20) await showDice(res.d20, def.name, a);
    logRes(res, 'amber'); applyEvents(res, a);
    if (c.effect === 'buff' || c.effect === 'smoke') for (const x of targets) { try { G.spawnEffect(M.scene, 'buff', M.vec(x, 0.8)); } catch (e) {} }
    await M.wait(500); C.checkEnd();
  }
  async function swapWeapon(a) { const e = a.ch.equipment; const x = e.weapon; e.weapon = e.weapon2; e.weapon2 = x; M.turn.actions -= 1; M.log(`${a.ch.name} zmienia broń na: ${normW(getWeapon(a.ch)).name || '?'}.`, 'dim'); M.sfx('click'); await M.wait(200); }
  async function takeCoverAI(a) { M.turn.actions -= 1; a.ch.conditions.in_cover = (a.ch.conditions.in_cover >= 1 ? 2 : 1); M.float(a, 'W OSŁONIE', '#7fb8ff'); M.log(`${a.ch.name} kryje się za osłoną.`, 'dim'); M.sfx('step'); await M.wait(250); }

  // ---------- turn flow
  async function lock(fn) {
    if (C.locked) return; C.locked = true; M.hud.barPanel.style.opacity = '.35'; M.hud.showInfo(null); M.HL.path = []; M.HL.aim = null;
    try { await fn(); } catch (e) { console.error(e); } finally { C.locked = false; if (M.mode === 'combat' && M.turn) { M.hud.barPanel.style.opacity = '1'; afterAction(); } }
  }
  function afterAction() {
    const t = M.turn; if (!t || C.auto) return; syncAll(); updateHL(); C.refreshBar();
    if (t.actor.side === 'pc' && C.active && (t.actions <= 0 && !t.ending || t.actor.state !== 'up')) { t.ending = true; setTimeout(() => { if (M.turn === t) C.endPlayerTurn(); }, 450 / M.speed); }
  }
  C.endPlayerTurn = () => { const t = M.turn; if (t?.done && !C.locked) { const d = t.done; t.done = null; d(); } };
  /** Player picks another merc during the party's turn (PF2e Delay): if the current merc has not spent any action,
   *  the picked merc acts now and the current one keeps its turn (with its actions) right after; otherwise the picked
   *  merc is queued to act next. Mercs who already acted this round cannot be picked. */
  C.switchTo = (b) => {
    const t = M.turn; if (!t || C.locked || !C.active || !b || b.side !== 'pc' || b === t.actor) return false;
    if (t.actor.side !== 'pc') return false;
    if (b.state !== 'up') { M.toast(`${b.ch.name} nie może działać.`); return true; }
    const bi = C.order.indexOf(b);
    if (bi < 0 || bi <= C.idx) { M.toast(`${b.ch.name} już działał(a) w tej rundzie.`); return true; }
    C.order.splice(bi, 1);
    if (t.actions >= t.full && !t.used) {
      t.actor.savedTurn = { actions: t.actions, round: C.round };
      C.order.splice(C.idx, 0, b); t.switched = true;
      M.log(`${t.actor.ch.name} odkłada akcje — teraz ${b.ch.name}.`, 'dim');
      const d = t.done; t.done = null; d && d();
    } else {
      C.order.splice(C.idx + 1, 0, b);
      M.toast(`${b.ch.name} wykona turę jako następny.`); M.log(`${b.ch.name} będzie działać następny.`, 'dim'); M.hud.initBar();
    }
    return true;
  };
  C.delay = () => { const t = M.turn; if (!t || C.locked) return; t.delayed = true; C.endPlayerTurn(); };
  C.cancelMode = () => { const t = M.turn; if (t && (t.mode || t.sub)) { t.mode = null; t.sub = null; updateHL(); C.refreshBar(); M.hud.showInfo(null); } };
  function setMode(m) { const t = M.turn; t.mode = t.mode && m && t.mode.type === m.type && t.mode.ab === m.ab && t.mode.it === m.it ? null : m; t.sub = t.mode ? t.sub : t.sub; updateHL(); C.refreshBar(); }

  function playerTurn(a) { return new Promise(res => { M.turn.done = res; C.refreshBar(); updateHL(); M.refreshAll(); }); }

  async function takeTurn(a) {
    M.turn = { actor: a, actions: 3, mode: null, sub: null };
    a.mapN = 0; M.drawBar(a);
    joinNearby();
    if (!C.active) return;
    if (vis(a) || a.side === 'pc') M.focus(a.x, a.y);
    M.log(`— Tura: ${a.ch.name} —`, 'hd'); M.refreshAll();
    const saved = a.savedTurn && a.savedTurn.round === C.round ? a.savedTurn : null; a.savedTurn = null;
    let st = saved ? { log: [], actions: saved.actions, events: [] } : (startTurn(a.ch, rnd) || { log: [], actions: 3, events: [] });
    for (const l of st.log || []) M.log(l, 'dim'); if (st.events?.length) applyEvents({ events: st.events }, a); else syncAll();
    if (a.state === 'dead') { await M.wait(300); C.checkEnd(); return; }
    if (a.state === 'down') { M.log(`${a.ch.name} leży nieprzytomny${isStable(a) ? ' (stabilny)' : ''}.`, 'dim'); await M.wait(500); C.checkEnd(); if (C.active) { const e = endTurn(a.ch, rnd); for (const l of e?.log || []) M.log(l, 'dim'); syncAll(); } return; }
    M.turn.actions = Math.max(0, st.actions ?? 3); M.turn.full = M.turn.actions; M.refreshAll();
    if (a.side === 'pc') M.sfx('turn');
    if (M.turn.actions <= 0) { M.log(`${a.ch.name} traci akcje w tej turze.`, 'bad'); await M.wait(600); }
    else if (a.side === 'pc' && !C.auto) { M.select(a); await playerTurn(a); }
    else { await C.aiTurn(a); }
    if (!C.active) return;
    if (M.turn?.switched) { M.turn = null; M.hud.setBarHead(null); clearHL(); C.idx--; M.hud.initBar(); M.refreshAll(); return; }
    const e = endTurn(a.ch, rnd); for (const l of e?.log || []) M.log(l, 'dim'); if (e?.events?.length) applyEvents({ events: e.events }, a);
    const delayed = M.turn?.delayed; M.turn = null; M.hud.setBarHead(null); clearHL(); M.refreshAll();
    if (delayed) { C.order.splice(C.idx, 1); C.order.push(a); C.idx--; M.log(`${a.ch.name} odkłada turę.`, 'dim'); }
  }

  async function loop() {
    while (C.active && M.mode === 'combat') {
      const a = C.order[C.idx];
      if (a && a.state !== 'dead' && (a.side !== 'enemy' || a.group.alerted)) await takeTurn(a);
      if (!C.active) break;
      C.idx++;
      if (C.idx >= C.order.length) { C.idx = 0; C.round++; C.order = C.order.filter(x => x.state !== 'dead'); M.log(`═══ Runda ${C.round} ═══`, 'amber'); M.hud.initBar(); if (C.round > 60) { M.log('Walka się przeciąga…', 'dim'); } }
      await M.wait(60);
    }
  }
  function rollInit(a) { const r = rollInitiative(a.ch, rnd); a.init = Math.round(r.total); return r; }
  function join(g, msg) {
    if (g.alerted) return; g.alerted = true; if (msg) M.log(msg, 'bad');
    if (!C.active) return;
    for (const e of g.actors) { if (e.state === 'dead') continue; rollInit(e); C.order.push(e); M.log(`${e.ch.name} dołącza do walki (inicjatywa ${e.init}).`, 'bad'); }
    M.updateVis(); M.hud.initBar();
  }
  function joinNearby() {
    if (!C.active) return;
    for (const g of M.groups) {
      if (g.alerted || !g.actors.some(e => e.state !== 'dead')) continue;
      const near = g.actors.some(e => e.state !== 'dead' && M.pcs.some(p => p.state === 'up' && (cheb(e, p) <= 3 || (cheb(e, p) <= 7 && M.grid.los(e, p).clear))));
      if (near) join(g, 'Kolejna grupa wrogów zwraca uwagę na walkę!');
    }
  }
  C.startCombat = async (g) => {
    if (C.active) { join(g); return; }
    C.active = true; M.mode = 'combat'; g.alerted = true; C.round = 1; C.idx = 0;
    M.sfx('alarm'); M.hud.banner('WALKA!', 'var(--blood)'); M.log('═══ WALKA! ═══', 'bad');
    const boss = g.actors.some(e => tpl(e).ai === 'boss'); try { Audio.music(boss ? 'boss' : 'combat'); } catch (e) {}
    const parts = M.pcs.filter(p => p.state !== 'dead').concat(g.actors.filter(e => e.state !== 'dead'));
    for (const a of parts) { const r = rollInit(a); M.log(`Inicjatywa: ${a.ch.name} ${a.init} (k20 ${r.d20 ?? '?'})`, 'dim'); }
    C.order = parts.sort((x, y) => y.init - x.init || (x.side === 'pc' ? -1 : 1));
    clearHL(); M.updateVis();
    const seer = g.actors[0]; if (seer) M.focus(seer.x, seer.y);
    M.refreshAll(); await M.wait(1300);
    if (!C.active) return; loop();
  };
  C.checkEnd = () => {
    if (!C.active || M.mode !== 'combat') return;
    if (M.pcs.every(p => p.state !== 'up')) { C.active = false; C.stop(); M.finish('lose'); return; }
    if (M.target && M.target.state === 'dead') { C.active = false; C.stop(); M.hud.banner('CEL ELIMINOWANY', 'var(--good)'); setTimeout(() => M.finish('success'), M.fast ? 0 : 900); return; }
    if (!M.enemies.some(e => e.group.alerted && e.state !== 'dead')) endCombat();
  };
  C.stop = () => { const t = M.turn; if (t?.done) { const d = t.done; t.done = null; d(); } };
  function endCombat() {
    C.active = false; C.stop(); M.mode = 'explore'; M.turn = null; M.hud.setBarHead(null);
    for (const a of M.actors) { a.mapN = 0; if (a.side === 'pc') { try { R.endEncounter?.(a.ch); } catch (e) {} } }
    clearHL(); M.hud.showInfo(null); M.hud.banner('WALKA ZAKOŃCZONA', 'var(--good)'); M.log('Walka zakończona.', 'good');
    try { Audio.music(({ ruins: 'ruins', wastes: 'wastes', industrial: 'ruins', bunker: 'ruins' })[M.contract.biome] || 'ruins'); } catch (e) {}
    M.refreshAll(); M.refreshObjective();
    if (M.objType === 'eliminate' && M.enemies.every(e => e.state === 'dead')) setTimeout(() => M.finish('success'), M.fast ? 0 : 1100);
    M.steps += 3;
  }

  // ---------- highlights & hover
  // Ground overlay shows ONLY: the movement range of the active merc (cost 1/2/3 actions, or Step tiles), the hovered
  // destination + its path, and the tile under the active character (drawn by M.drawHL). Everything else is told by
  // sprite outlines (attackable / valid targets / blast victims) and the hover info panel. Area aiming draws a thin
  // blast circle + centre cross (not tile fills) so the player still sees where a grenade lands.
  const OL = { foe: '#ff3b2b', ally: '#4dff88', hover: '#ffe95a', blast: '#ff9a1a', blastAlly: '#ffe95a', off: '#8c8c8c' };
  function clearHL() { M.setHL({ tiles: [], path: [], dest: null, aim: null, outline: new Map(), hoverOutline: new Map() }); }
  C.clearHL = clearHL;
  const areaSpec = (mode) => {
    if (mode?.type === 'ability' && mode.ab.target === 'area') return { r: mode.ab.radius || 1, range: mode.ab.range ?? 8, name: mode.ab.name };
    if (mode?.type === 'item') { const c = ITEMS[mode.it.id]?.consumable; if (c?.target === 'area') return { r: c.radius || 1, range: c.range || 6, name: ITEMS[mode.it.id].name }; }
    return null;
  };
  function updateHL() {
    const t = M.turn; if (!t || M.mode !== 'combat' || t.actor.side !== 'pc') { M.setHL({ tiles: [], path: [], dest: null, aim: null, outline: new Map(), hoverOutline: new Map() }); return; }
    const a = t.actor; const tiles = [], outline = new Map(), mode = t.mode;
    const foes = foesOf(a).filter(vis);
    if (!mode || mode.type === 'stride') {
      if (t.actions > 0) {
        const { res, sp } = reachFor(a, t.actions); C.reach = { res, sp };
        for (let i = 0; i < res.cost.length; i++) { const c = res.cost[i]; if (c <= 0 || c >= 1e9) continue; const x = i % W(), y = (i / W()) | 0; if (M.occupied(x, y) || M.thingAt(x, y)?.kind === 'crate') continue; tiles.push({ x, y, n: costActions(c, sp) }); }
        for (const f of foes) if (strikeInfo(a, f).ok) outline.set(f, OL.foe);
      }
    } else if (mode.type === 'step') {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = a.x + dx, y = a.y + dy; if ((dx || dy) && M.grid.free(x, y) && !M.occupied(x, y) && (!dx || !dy || (M.grid.free(a.x + dx, a.y) && M.grid.free(a.x, a.y + dy)))) tiles.push({ x, y, n: 's' }); }
    } else if (mode.type === 'strike') { for (const f of foes) outline.set(f, strikeInfo(a, f).ok ? OL.foe : OL.off); }
    else if (mode.type === 'ability') {
      const ab = mode.ab;
      if (ab.target === 'enemy' || ab.target === 'ally') for (const x of abTargets(a, ab)) outline.set(x, ab.target === 'ally' ? OL.ally : OL.foe);
    } else if (mode.type === 'item') {
      const c = ITEMS[mode.it.id]?.consumable || {};
      if (c.target === 'enemy') for (const f of foes.filter(f => cheb(a, f) <= (c.range || 6))) outline.set(f, OL.foe);
      else if (c.target !== 'area') for (const x of M.pcs.filter(p => p.state !== 'dead' && cheb(a, p) <= Math.max(1, c.range || 1))) outline.set(x, OL.ally);
    }
    M.setHL({ tiles, outline, path: [], dest: null, aim: null, hoverOutline: new Map() });
  }
  C.updateHL = updateHL;
  C.onHover = (h) => {
    const hud = M.hud; if (!h) return;
    if (M.mode === 'explore') { const e = h.actor; const ho = new Map(); if (e && e.side === 'enemy') { ho.set(e, OL.foe); hud.showInfo(`<b class="bad">${e.ch.name}</b> <span class="dim">poz. ${e.ch.level || 1}</span><br>PW ${Math.max(0, e.ch.hp)}/${e.ch.maxHp}`); } else hud.showInfo(null); M.setHL({ hoverOutline: ho }); return; }
    const t = M.turn;
    if (!t || t.actor.side !== 'pc' || C.locked || M.mode !== 'combat') { hud.showInfo(null); return; }
    const a = t.actor, mode = t.mode; let html = null, path = [], dest = null, aim = null; const ho = new Map();
    const base = M.HL.outline || new Map();
    if (h.actor && h.actor.side === 'enemy' && (!mode || mode.type === 'strike' || mode.type === 'stride')) {
      const i = strikeInfo(a, h.actor); if (i.ok || i.melee) ho.set(h.actor, OL.hover);
      html = i.ok ? infoHtml(a, h.actor, i) : `<b class="bad">${h.actor.ch.name}</b> <span class="dim">poz. ${h.actor.ch.level || 1}</span><br>PW ${Math.max(0, h.actor.ch.hp)}/${h.actor.ch.maxHp} · KP ${getStat(h.actor.ch, 'ac')}<br><span class="dim">${i.reason}${i.melee ? (t.actions >= 2 ? ' — kliknij, by podejść i uderzyć' : ' — za mało akcji, by podejść i uderzyć') : ''}</span>`;
    } else if (h.actor && mode && (mode.type === 'ability' || mode.type === 'item') && !areaSpec(mode)) {
      const ok = base.has(h.actor) && base.get(h.actor) !== OL.off; if (ok) ho.set(h.actor, OL.hover);
      const nm = mode.type === 'ability' ? mode.ab.name : ITEMS[mode.it.id]?.name;
      html = `<b class="amber">${nm}</b> → <b>${h.actor.ch.name}</b><br>PW ${Math.max(0, h.actor.ch.hp)}/${h.actor.ch.maxHp}<br>${ok ? '<span class="good">Kliknij, by użyć.</span>' : '<span class="bad">Nieprawidłowy cel (zasięg / linia strzału).</span>'}`;
    } else if (h.tile && (!mode || mode.type === 'stride') && C.reach && t.actions > 0) {
      const i = h.tile.y * W() + h.tile.x, c = C.reach.res.cost[i];
      if (c > 0 && c < 1e9 && !M.occupied(h.tile.x, h.tile.y) && M.thingAt(h.tile.x, h.tile.y)?.kind !== 'crate') { path = M.grid.pathFrom(C.reach.res, h.tile.x, h.tile.y) || []; dest = h.tile; const n = costActions(c, C.reach.sp); html = `<b class="amber">Marsz</b>: ${path.length} ${path.length === 1 ? 'pole' : path.length < 5 ? 'pola' : 'pól'} — ${n} ${n === 1 ? 'akcja' : 'akcje'}`; }
    } else if (h.tile && mode?.type === 'step') {
      if (cheb(a, h.tile) === 1 && (M.HL.tiles || []).some(q => q.x === h.tile.x && q.y === h.tile.y)) { dest = h.tile; html = '<b class="amber">Krok</b> na to pole (1 akcja)'; }
    }
    const ar = areaSpec(mode);
    if (ar && h.tile) {
      const ok = cheb(a, h.tile) <= ar.range && M.grid.los(a, h.tile).clear && M.grid.kind(h.tile.x, h.tile.y) !== 2;
      aim = { x: h.tile.x, y: h.tile.y, r: ar.r, ok };
      const hit = ok ? areaTargets(h.tile, ar.r) : [];
      for (const x of hit) ho.set(x, x.side === a.side ? OL.blastAlly : OL.blast);
      const nf = hit.filter(x => x.side !== a.side).length, na = hit.filter(x => x.side === a.side).length;
      html = `<b class="amber">${ar.name}</b> <span class="dim">(promień ${ar.r}, zasięg ${ar.range})</span><br>` + (ok ? `Trafi: <b class="${nf ? 'good' : 'dim'}">${nf} ${nf === 1 ? 'wroga' : 'wrogów'}</b>${na ? ` · <span class="bad">w tym sojusznicy: ${na}!</span>` : ''}` : '<span class="bad">Poza zasięgiem lub brak linii strzału.</span>');
    }
    M.setHL({ path, dest, aim, hoverOutline: ho }); hud.showInfo(html || (mode && t.hint) || null);
  };
  function cellsInRadius(c, r) { const o = []; for (let y = c.y - Math.ceil(r); y <= c.y + Math.ceil(r); y++) for (let x = c.x - Math.ceil(r); x <= c.x + Math.ceil(r); x++) if (M.grid.inb(x, y) && Math.hypot(x - c.x, y - c.y) <= r + 0.45) o.push({ x, y }); return o; }

  // ---------- player clicks
  C.playerClick = (tile, actor) => {
    const t = M.turn; if (!t || t.actor.side !== 'pc' || C.locked || !C.active) return;
    const a = t.actor, mode = t.mode;
    if (mode?.type === 'step') {
      if (!tile || t.actions < 1) return; if (Math.max(Math.abs(tile.x - a.x), Math.abs(tile.y - a.y)) !== 1 || !M.grid.free(tile.x, tile.y) || M.occupied(tile.x, tile.y)) return M.toast('Krok: jedno wolne pole obok.');
      return lock(async () => { t.actions -= 1; t.mode = null; M.refreshAll(); await M.walk(a, [{ x: tile.x, y: tile.y }]); M.focus(a.x, a.y); });
    }
    if (mode?.type === 'ability') return abilityClick(a, mode.ab, tile, actor);
    if (mode?.type === 'item') return itemClick(a, mode.it, tile, actor);
    if (actor && actor.side === 'enemy') {
      if (t.actions < 1) return M.toast('Brak akcji.');
      return lock(async () => { t.mode = null; await attackTarget(a, actor); });
    }
    if (actor && actor.side === 'pc') { M.hud.sheet?.(actor); if (actor !== a) C.switchTo(actor); return; }
    const th = tile && M.thingAt(tile.x, tile.y);
    if (th && !actor) return C.playerInteract(th);
    if (!tile || actor) return;
    if (!C.reach || t.actions < 1) return M.toast(t.actions < 1 ? 'Brak akcji.' : 'Nie ma tam drogi.');
    const c = C.reach.res.cost[tile.y * W() + tile.x]; if (!(c > 0 && c < 1e9) || M.occupied(tile.x, tile.y)) return;
    const path = M.grid.pathFrom(C.reach.res, tile.x, tile.y); const n = costActions(c, C.reach.sp);
    return lock(async () => { t.mode = null; await stride(a, path, n); });
  };
  async function attackTarget(a, foe) {
    const t = M.turn, w = weaponOf(a); let inf = strikeInfo(a, foe, w);
    if (!inf.ok && inf.melee) {
      if (t.actions < 2) { M.toast('Za daleko — potrzeba akcji na ruch i atak.'); return; }
      const { res, sp } = reachFor(a, t.actions - 1); let best = null, bc = 1e9;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = foe.x + dx, y = foe.y + dy; if ((!dx && !dy) || !M.grid.free(x, y) || M.occupied(x, y)) continue; let c = res.cost[y * W() + x]; if (c <= 0 || c >= 1e9) continue; if (strikeInfo(a, foe, w, { x, y }).flank) c -= 0.5; if (c < bc) { bc = c; best = { x, y }; } }
      if (!best) { M.toast('Nie można podejść.'); return; }
      const path = M.grid.pathFrom(res, best.x, best.y); await stride(a, path, costActions(res.cost[best.y * W() + best.x], sp)); inf = strikeInfo(a, foe, w);
      if (!C.active) return;
    }
    if (!inf.ok) { M.toast(`Nie można zaatakować: ${inf.reason}.`); return; }
    t.actions -= 1; M.refreshAll(); await strike(a, foe, w);
  }
  function abilityClick(a, ab, tile, actor) {
    const t = M.turn, kind = ab.target;
    if (kind === 'enemy') { if (!actor || !abTargets(a, ab).includes(actor)) return M.toast('Wskaż wroga w zasięgu i na linii strzału.'); return lock(async () => { t.mode = null; await useAbility(a, ab, [actor]); }); }
    if (kind === 'ally') { if (!actor || !abTargets(a, ab).includes(actor)) return M.toast('Wskaż sojusznika w zasięgu.'); return lock(async () => { t.mode = null; await useAbility(a, ab, [actor]); }); }
    if (kind === 'area') { if (!tile || cheb(a, tile) > (ab.range ?? 8) || !M.grid.los(a, tile).clear) return M.toast('Poza zasięgiem / brak linii.'); return lock(async () => { t.mode = null; await useAbility(a, ab, areaTargets(tile, ab.radius || 1), tile); }); }
  }
  function itemClick(a, it, tile, actor) {
    const t = M.turn, c = ITEMS[it.id]?.consumable || {};
    if (c.target === 'area') { if (!tile || cheb(a, tile) > (c.range || 6) || !M.grid.los(a, tile).clear) return M.toast('Poza zasięgiem.'); return lock(async () => { t.mode = null; await useItem(a, it, null, tile); }); }
    if (!actor) return M.toast('Wskaż cel.');
    if (c.target === 'enemy' && actor.side !== 'enemy') return M.toast('Wskaż wroga.');
    if (c.target !== 'enemy' && actor.side !== 'pc') return M.toast('Wskaż sojusznika.');
    if (cheb(a, actor) > Math.max(1, c.range || 1)) return M.toast('Za daleko.');
    return lock(async () => { t.mode = null; await useItem(a, it, actor); });
  }
  C.playerInteract = (th) => {
    const t = M.turn; if (!t || C.locked) return; const a = t.actor;
    if (cheb(a, th) > 1) return M.toast('Podejdź bliżej (obok obiektu).'); if (t.actions < 1) return M.toast('Brak akcji.');
    return lock(async () => { t.mode = null; const ok = await M.interact(a, th); if (ok !== false) t.actions -= 1; M.refreshAll(); });
  };

  // ---------- action bar
  C.refreshBar = () => {
    const hud = M.hud, bar = hud.bar; bar.innerHTML = ''; const t = M.turn;
    if (M.mode !== 'combat' || !t || t.actor.side !== 'pc' || C.auto || t.actor.state !== 'up') { hud.setBarHead(null); return; }
    const a = t.actor, n = t.actions, mode = t.mode; t.buttons = [];
    const add = (label, icon, cost, fn, o = {}) => { const idx = t.buttons.length; o.key = idx < 9 ? String(idx + 1) : ''; const dis = o.disabled || (cost && cost !== 'r' && cost > n); const b = hud.abBtn(label, icon, cost || null, () => { if (!C.locked && !dis) fn(); }, { ...o, disabled: dis }); bar.append(b); t.buttons.push(dis ? null : fn); };
    const icon = (id) => { try { return G.itemIcon(id, 24); } catch (e) { return null; } };
    const endBtn = UI.button('Zakończ turę [Spacja]', () => C.endPlayerTurn(), { class: n <= 0 ? 'primary' : '' });
    if (t.sub === 'items') {
      hud.setBarHead({ who: 'Przedmioty — ' + a.ch.name, actions: n, full: t.full, buttons: [UI.button('Wróć [Esc]', () => { t.sub = null; t.mode = null; updateHL(); C.refreshBar(); M.hud.showInfo(null); }), endBtn] });
      for (const it of consumables(a)) { const def = ITEMS[it.id], c = def.consumable || {}; const ic = icon(it.id); add(`${def.name}${it.qty > 1 ? ' x' + it.qty : ''}`, null, c.actions ?? 1, () => itemPick(a, it), { iconCanvas: ic, tip: `<b class="amber">${def.name}</b><br>${def.desc || ''}`, active: mode?.type === 'item' && mode.it === it }); }
      return;
    }
    hud.setBarHead({ who: a.ch.name, actions: n, full: t.full, buttons: [UI.button('Odłóż turę', () => C.delay(), { title: 'Przesuń swoją turę na koniec rundy.' }), endBtn] });
    const w = weaponOf(a), mapIdx = Math.min(2, a.mapN || 0);
    add('Marsz', 'move', 1, () => setMode({ type: 'stride' }), { tip: '<b class="amber">Marsz</b> — przejdź do Twojej prędkości za 1 akcję. Kliknij podświetlone pole (niebieskie 1 akcja, żółte 2, pomarańczowe 3).', active: mode?.type === 'stride' });
    add('Krok', 'step', 1, () => setMode({ type: 'step' }), { tip: '<b class="amber">Krok</b> — przesuń się o 1 pole.', active: mode?.type === 'step' });
    add(`Atak: ${w.name || 'broń'}${mapIdx ? ' (' + (w_agile(w) ? '-' + 4 * mapIdx : '-' + 5 * mapIdx) + ')' : ''}`, 'attack', 1, () => setMode({ type: 'strike' }), { tip: `<b class="amber">Atak (Strike)</b><br>${w.name || ''}: ${w.damage || ''}, ${weaponRange(w) ? 'zasięg ' + weaponRange(w) : 'wręcz'}. Wrogowie w zasięgu mają czerwony kontur. Kolejne ataki w turze mają karę (PWA).`, active: mode?.type === 'strike' });
    for (const id of a.ch.abilities || []) {
      const ab = ABILITIES[id]; if (!ab || id === 'strike') continue;
      if (id === 'stand' && !hasCondition(a.ch, 'prone')) continue; if (id === 'raise_shield' && !a.ch.equipment?.shield) continue; const cost = abCost(ab); const left = usesLeft(a, ab); const dis = cost === 99 || left <= 0 || (ab.actions === 0 && a.used['_free_' + id]);
      add(ab.name + (ab.uses && Number.isFinite(left) ? ` (${left})` : ''), ab.icon, cost === 99 ? 'r' : cost, () => abilityPick(a, ab), { disabled: dis, tip: `<b class="amber">${ab.name}</b> ${ab.actions === 0 ? '(akcja darmowa)' : ab.actions === 'reaction' ? '(reakcja)' : ''}<br>${ab.desc || ''}`, active: mode?.type === 'ability' && mode.ab === ab });
    }
    const cons = consumables(a); if (cons.length) add(`Przedmioty (${cons.reduce((s, x) => s + x.qty, 0)})`, null, null, () => { t.sub = 'items'; t.mode = null; updateHL(); C.refreshBar(); }, { tip: 'Użyj przedmiotu (Interakcja).', iconCanvas: icon(cons[0].id) });
    const th = M.things.find(x => !x.done && cheb(a, x) <= 1 && x.x !== undefined);
    if (th) add(th.kind === 'crate' ? 'Otwórz skrzynię' : th.kind === 'item' ? 'Zabierz cel' : 'Uwolnij', null, 1, () => C.playerInteract(th));
    if (a.ch.equipment?.weapon2) add('Zmień broń', null, 1, () => lock(async () => { await swapWeapon(a); }), { tip: 'Zamień broń główną z zapasową.', iconCanvas: icon(a.ch.equipment.weapon2.id) });
  };
  const hint = (html) => { const t = M.turn; t.hint = t.mode ? html : null; M.hud.showInfo(t.hint); };
  function abilityPick(a, ab) {
    const t = M.turn; if (abCost(ab) > t.actions) return M.toast('Za mało akcji.');
    if (ab.target === 'area' && !(ab.range > 0)) return lock(async () => { t.mode = null; await useAbility(a, ab, areaTargets(a, ab.radius || 1).filter(x => x.side === a.side), { x: a.x, y: a.y }); });
    if (ab.target === 'self' || ab.target === 'none' || !ab.target) return lock(async () => { t.mode = null; await useAbility(a, ab, ab.target === 'self' || !ab.target ? [a] : foesOf(a)); });
    if ((ab.target === 'enemy' || ab.target === 'ally') && !abTargets(a, ab).length) return M.toast('Brak celów w zasięgu.');
    setMode({ type: 'ability', ab }); hint(`<b class="amber">${ab.name}</b><br>${ab.target === 'area' ? `Wskaż pole: promień ${ab.radius || 1}, zasięg ${ab.range ?? 8}.` : `Wskaż cel z <span class="${ab.target === 'ally' ? 'good">zielonym' : 'bad">czerwonym'} konturem</span>.`} <span class="dim">[Esc = anuluj]</span>`);
  }
  function itemPick(a, it) {
    const t = M.turn, c = ITEMS[it.id]?.consumable || {}; if ((c.actions ?? 1) > t.actions) return M.toast('Za mało akcji.');
    if (c.target === 'self') return lock(async () => { t.mode = null; t.sub = null; await useItem(a, it, a); });
    setMode({ type: 'item', it }); hint(`<b class="amber">${ITEMS[it.id].name}</b><br>${c.target === 'area' ? `Wskaż pole: promień ${c.radius || 1}, zasięg ${c.range || 6}.` : `Wskaż cel z <span class="${c.target === 'enemy' ? 'bad">czerwonym' : 'good">zielonym'} konturem</span>.`} <span class="dim">[Esc = anuluj]</span>`);
  }
  C.hotkey = (i) => { const t = M.turn; if (!t || C.locked || t.actor.side !== 'pc') return; t.buttons?.[i]?.(); };
  C.focusNext = () => { M.focusActor(M.turn?.actor); };

  // ================= AI =================
  function pickWeapon(a, foes) {
    const ws = getWeapons(a.ch); if (ws.length <= 1) return ws[0] || getWeapon(a.ch); const ai = aiType(a);
    // best weapon able to strike something now; else prefer by ai role
    let best = null, bs = -1e9;
    for (const w of ws) { let s = atkBonus(a.ch, w, Math.min(2, a.mapN || 0)); const can = foes.some(f => strikeInfo(a, f, w).ok); if (can) s += 50; else s += (ai === 'ranged' ? weaponRange(w) : -weaponRange(w)); if (s > bs) { bs = s; best = w; } }
    return best;
  }
  function bestTarget(a, w, foes) {
    let best = null, bs = -1e9;
    for (const f of foes) { const i = strikeInfo(a, f, w); if (!i.ok) continue; const hpf = f.ch.hp / f.ch.maxHp; let s = (1 - hpf) * 30 + i.hit * 0.25 - cheb(a, f) * 1.5 + (i.flank ? 6 : 0); if (aiType(a) === 'beast') s = -cheb(a, f) * 3 + i.hit * 0.1; if (f.state !== 'up') s -= 100; if (s > bs) { bs = s; best = { f, i }; } }
    return best;
  }
  async function aiMove(a, w, foes) {
    const t = M.turn, sp = speedOf(a), maxA = t.actions;
    const { res } = reachFor(a, maxA); const ai = aiType(a), ranged = weaponRange(w) > 0, W_ = W();
    // distance map to foes
    const dm = new Float32Array(res.cost.length).fill(1e9);
    for (const f of foes) { const r = M.grid.search(f.x, f.y, 60, () => true); for (let i = 0; i < dm.length; i++) if (r.cost[i] < dm[i]) dm[i] = r.cost[i]; }
    const flee = ai === 'coward' && a.ch.hp < a.ch.maxHp * 0.4;
    let best = null, bs = -1e9;
    for (let i = 0; i < res.cost.length; i++) {
      const c = res.cost[i]; if (c >= 1e9) continue; const x = i % W_, y = (i / W_) | 0; const here = x === a.x && y === a.y;
      if (!here && (M.occupied(x, y) || M.thingAt(x, y)?.kind === 'crate')) continue;
      const n = here ? 0 : costActions(c, sp), rem = maxA - n; let s = 0;
      const pos = { x, y };
      if (flee) { const nd = Math.min(...foes.map(f => cheb(f, pos))); s = nd * 6 - c * 0.2; }
      else {
        const canHit = rem >= 1 && foes.some(f => strikeInfo(a, f, w, pos).ok);
        if (canHit) s += 100 + (rem >= 2 ? 15 : 0);
        s -= dm[i] * 2 + (here ? 0 : c * 0.1);
        const nd = Math.min(...foes.map(f => cheb(f, pos)));
        if (ranged) { if (nd < 3) s -= 12; if (lowCoverAt(pos)) s += 7; if (canHit && foes.some(f => strikeInfo(a, f, w, pos).cover === 0 && false)) s += 0; }
        else if (canHit && foes.some(f => strikeInfo(a, f, w, pos).flank)) s += 8;
      }
      if (s > bs) { bs = s; best = { x, y, c, n, here }; }
    }
    if (!best || best.here) return false;
    const path = M.grid.pathFrom(res, best.x, best.y); if (!path?.length) return false;
    if (vis(a) || vis({ x: best.x, y: best.y })) M.focus(best.x, best.y);
    await stride(a, path, best.n); return true;
  }
  const lowCoverAt = (p) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => M.grid.kind(p.x + dx, p.y + dy) === 1);
  async function aiAbility(a, foes) {
    const t = M.turn; const ids = (a.ch.abilities && a.ch.abilities.length ? a.ch.abilities : tpl(a).abilities) || [];
    for (const id of ids) {
      const ab = ABILITIES[id]; if (!ab || ab.actions === 'reaction' || UNIV.includes(id)) continue; const cost = ab.actions ?? 1; if (cost > t.actions || usesLeft(a, ab) <= 0 || (cost === 0 && a.used['_free_' + id])) continue;
      if (a.side === 'enemy' && Math.random() > 0.65) continue;
      if (kind0(ab) === 'enemy' && a.mapN >= 2 && ab.attackish !== false && ab.actions !== 0 && false) continue;
      const kind = ab.target, fx = ab.fx;
      if (kind === 'enemy') { const tg = abTargets(a, ab); if (!tg.length) continue; if (fx === 'melee' && a.mapN >= 2) continue; const best = tg.slice().sort((p, q) => p.ch.hp - q.ch.hp)[0]; await useAbility(a, ab, [best]); return true; }
      if (kind === 'ally' || kind === 'self') {
        const cands = kind === 'self' ? [a] : abTargets(a, ab); const healing = fx === 'heal';
        if (healing) { const w = cands.filter(c => c.state !== 'dead' && (c.ch.hp < c.ch.maxHp * 0.55 || c.state === 'down')).sort((p, q) => p.ch.hp / p.ch.maxHp - q.ch.hp / q.ch.maxHp)[0]; if (w) { await useAbility(a, ab, [w]); return true; } }
        else if (!a.used['b_' + id] && foes.length) { a.used['b_' + id] = true; await useAbility(a, ab, [cands.sort((p, q) => q.ch.level - p.ch.level)[0] || a]); return true; }
      }
      if (kind === 'area') {
        if (!(ab.range > 0)) { const al = areaTargets(a, ab.radius || 1).filter(x => x.side === a.side && x !== a); if (al.length && !a.used['b_' + id]) { a.used['b_' + id] = true; await useAbility(a, ab, al.concat([a]), { x: a.x, y: a.y }); return true; } continue; }
        let best = null, bs = 0; const rg = ab.range ?? 8, rad = ab.radius || 1;
        for (const f of foes) { if (cheb(a, f) > rg || !M.grid.los(a, f).clear) continue; const hit = areaTargets(f, rad); const e = hit.filter(x => x.side !== a.side).length, fr = hit.filter(x => x.side === a.side).length; const s = e * 2 - fr * 4; if (s > bs) { bs = s; best = { f, hit }; } }
        if (best) { await useAbility(a, ab, best.hit, { x: best.f.x, y: best.f.y }); return true; }
      }
      if (kind === 'none' && foes.length && !a.used['b_' + id]) { a.used['b_' + id] = true; await useAbility(a, ab, foes); return true; }
    }
    return false;
  }
  C.aiTurn = async (a) => {
    const t = M.turn; let guard = 10; const ai = aiType(a); const quick = !vis(a);
    while (t.actions > 0 && guard-- > 0 && C.active && a.state === 'up') {
      const foes = foesOf(a); if (!foes.length) break;
      if (a.side === 'pc') { // medic-ish: aid adjacent downed ally
        const dn = M.pcs.find(p => p.state === 'down' && p.ch.conditions.dying && cheb(a, p) <= 1); if (dn && t.actions >= 2) { await useAbility(a, ABILITIES.first_aid, [dn]); continue; }
        const hurt = M.pcs.filter(p => p.state === 'down' && p.ch.conditions.dying)[0];
        if (hasCondition(a.ch, 'prone') && a.state === 'up') { await useAbility(a, ABILITIES.stand, [a]); continue; }
        if (hurt && ABILITIES.first_aid && t.actions >= 3 && !foes.some(f => cheb(f, a) <= 1)) { const path = pathNear(a, hurt); if (path) { await stride(a, path.path, path.n); continue; } }
      }
      if (await aiAbility(a, foes)) { syncAll(); continue; }
      const w = pickWeapon(a, foes);
      const flee = ai === 'coward' && a.ch.hp < a.ch.maxHp * 0.4;
      if (flee && await aiMove(a, w, foes)) continue;
      const tg = bestTarget(a, w, foes);
      if (tg && (a.mapN < 2 || tg.i.hit >= 30) && !flee) { t.actions -= 1; M.refreshAll(); if (quick) M.focus(a.x, a.y); await strike(a, tg.f, w); continue; }
      if (await aiMove(a, w, foes)) continue;
      if (!a.ch.conditions.in_cover && (lowCoverAt(a) || weaponRange(w) > 0) && t.actions >= 1) { await takeCoverAI(a); continue; }
      break;
    }
    t.actions = 0;
  };
  const tg0 = (t) => t && t.length && t[0] !== undefined;
  const kind0 = (ab) => ab.target;
  function pathNear(a, target) {
    const { res, sp } = reachFor(a, M.turn.actions - 1); let best = null, bc = 1e9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = target.x + dx, y = target.y + dy; if (!M.grid.free(x, y) || M.occupied(x, y)) continue; const c = res.cost[y * W() + x]; if (c > 0 && c < bc) { bc = c; best = { x, y }; } }
    if (!best) return null; return { path: M.grid.pathFrom(res, best.x, best.y), n: costActions(bc, sp) };
  }
  C.autoTurn = async () => {
    if (M.mode !== 'combat' || !M.turn || M.turn.actor.side !== 'pc' || C.locked) return false;
    const a = M.turn.actor; C.locked = true; try { await C.aiTurn(a); } finally { C.locked = false; }
    if (M.turn?.actor === a) { const d = M.turn.done; M.turn.done = null; d?.(); }
    return true;
  };
  return C;
}
