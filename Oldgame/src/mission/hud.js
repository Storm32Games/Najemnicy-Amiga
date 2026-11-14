// DOM HUD for the mission scene: objective, party cards, initiative bar, action bar, log, banner, help.
//
// Layout (all sizes in em of #ui, so it scales with the overlay font; designed to fit the worst case
// of an 80em x 45em frame = 1280x720 at 16px):
//   ┌ objective ┐   ┌──── initiative bar (centre column) ────┐   ┌─── menu (2x3 grid) ───┐
//   │ LEFT col  │                                                 │      RIGHT col        │
//   │           │               (map)                             │                       │
//   ├ party x4  ┤   ┌──── hover info (centre column) ────────┐    ├─ log (collapsible) ───┤
//   └ (stack)   ┘   └──── action bar  (centre column) ───────┘    └───────────────────────┘
// Left column = objective + party (same width, same left edge), right column = menu + log (same width,
// same right edge), the centre column between them holds the initiative bar (top) and the
// info + action bar stack (bottom). Nothing in the centre column may overlap the side columns.
import { UI } from '../core/ui.js';
import { Settings } from '../core/settings.js';
import { G, R, ITEMS, ABILITIES, condName, CONDITIONS, getStat } from './rl.js';

const GUT = 0.6, GAP = 0.5, LW = 14, RW = 21, PW = 5.9;   // PW = party column (one narrow column of 4 cards)           // gutter, gap between panels, left / right column widths (em)
const CL = GUT + LW + GAP, CR = GUT + RW + GAP;          // centre column insets
const LOG_H = { s: 13, l: 27 };                         // log list heights (em) for the size toggle

const CSS = `
#ui .toast{top:9.6em}
.m-p{padding:.45em .6em!important}
.m-hd{display:flex;align-items:center;gap:.4em;color:var(--amber);font-size:.72em;letter-spacing:.14em;text-transform:uppercase;text-shadow:1px 1px 0 #000;border-bottom:1px solid var(--edge);padding-bottom:.25em;margin-bottom:.35em;white-space:nowrap}
.m-hd .sp{flex:1}
.m-hd .m-tb{font:inherit;font-size:1em;letter-spacing:0;line-height:1;color:var(--dim);background:#0006;border:1px solid var(--edge);padding:.15em .4em;cursor:pointer}
.m-hd .m-tb:hover{color:#fff;border-color:var(--edge-hi)}
.m-banner{position:absolute;left:0;right:0;top:34%;text-align:center;font-size:4.2em;font-weight:bold;letter-spacing:.15em;text-shadow:4px 4px 0 #000,0 0 18px currentColor;pointer-events:none!important;animation:mBan 1.9s forwards;z-index:30}
.m-banner small{display:block;font-size:.3em;letter-spacing:.2em;color:var(--text)}
@keyframes mBan{0%{opacity:0;transform:scale(2.2)}12%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:scale(1.05)}}
/* objective */
.m-obj .t{color:var(--amber);font-weight:bold;font-size:.86em;line-height:1.25;margin-bottom:.25em;text-transform:uppercase;letter-spacing:.04em}
.m-obj .l{font-size:.76em;line-height:1.3;margin:.12em 0;padding-left:1.3em;text-indent:-1.3em}
.m-obj .l.go{color:var(--toxic);animation:mGo 1.2s infinite alternate}
@keyframes mGo{from{opacity:.65}to{opacity:1;text-shadow:0 0 6px var(--toxic)}}
/* menu */
.m-menu{display:grid;grid-template-columns:1fr 1fr;gap:.3em}
.m-menu .btn{font-size:.7em;padding:.4em .5em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m-menu .wide{grid-column:1 / span 2}
/* party */
.m-party{display:flex;flex-direction:column;gap:.3em}
.m-card{display:flex;flex-direction:column;gap:.15em;min-width:0;padding:.2em;border:2px solid var(--edge);background:#120e0be6;box-shadow:2px 2px 0 #0008;cursor:pointer;position:relative;overflow:hidden}
.m-card:hover{border-color:var(--edge-hi)}
.m-card.sel{border-color:var(--amber)}
.m-card.act{border-color:var(--amber);box-shadow:0 0 0 1px var(--amber),0 0 12px #f2a93b99}
.m-card.down{border-color:var(--blood)}.m-card.down .m-pt canvas{filter:grayscale(.7) brightness(.75)}
.m-card.dead{opacity:.6}.m-card.dead .m-pt canvas{filter:grayscale(1) brightness(.5)}
.m-pt{width:100%;aspect-ratio:1;flex:none;position:relative;border:1px solid #000}
.m-pt canvas{width:100%;height:100%;display:block}
.m-pt .st{position:absolute;left:0;right:0;top:38%;text-align:center;font-size:.55em;font-weight:bold;letter-spacing:.05em;background:#000c;color:var(--bad)}
.m-cb{min-width:0;display:flex;flex-direction:column;gap:.18em}
.m-nm{position:absolute;left:0;right:0;bottom:0;font-size:.62em;line-height:1.5;padding:0 .3em;background:#000b;text-shadow:1px 1px 0 #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--amber)}
.m-card:not(.act) .m-nm{color:var(--text)}
.m-hpb{height:.85em;background:#000;border:1px solid #000;position:relative;box-shadow:inset 0 0 0 1px #2a2018}
.m-hpb i{position:absolute;left:0;top:0;bottom:0;display:block}
.m-hpb span{position:absolute;inset:0;font-size:.62em;line-height:1.55;text-align:center;color:#fff;text-shadow:1px 1px 0 #000,-1px 0 0 #000}
.m-row{position:absolute;left:.15em;right:.15em;top:.15em;display:flex;flex-wrap:wrap;align-items:center;gap:.15em;overflow:hidden;max-height:2.2em}
.m-row .m-pip{box-shadow:0 0 0 1px #000}
.m-cond{display:inline-block;flex:none;font-size:.6em;line-height:1.4;padding:0 .3em;border:1px solid var(--edge);background:#000a;cursor:help}
.m-pip{display:inline-block;flex:none;width:.75em;height:.75em;border-radius:50%;border:2px solid var(--amber);vertical-align:middle}.m-pip.on{background:var(--amber)}
/* initiative */
.m-initw{position:absolute;top:${GUT}em;left:${CL}em;right:${CR}em;display:none;flex-direction:column;align-items:center;pointer-events:none!important}
.m-init{display:flex;gap:.3em;align-items:center;max-width:100%;overflow-x:auto;overflow-y:hidden;padding:.25em .3em .35em;pointer-events:auto}
.m-init::-webkit-scrollbar{height:.45em}
.m-ic{flex:0 1 4.4em;min-width:3em;aspect-ratio:1;border:2px solid var(--steel);background:#000;position:relative;cursor:pointer;box-shadow:2px 2px 0 #000a;transition:flex-basis .2s}
.m-ic.e{border-color:var(--blood)}
.m-ic canvas{width:100%;height:100%;display:block}
.m-ic .n{position:absolute;left:0;top:0;font-size:.55em;line-height:1.3;background:#000c;padding:0 .25em;color:var(--dim)}
.m-ic .hp{position:absolute;left:0;right:0;bottom:0;height:.38em;background:#000c}.m-ic .hp i{display:block;height:100%}
.m-ic.done{opacity:.55}
.m-ic.down canvas{filter:grayscale(1) brightness(.6)}
.m-ic.down::after{content:'!';position:absolute;right:.2em;top:0;color:var(--bad);font-weight:bold;font-size:.9em;text-shadow:1px 1px 0 #000}
.m-ic.cur{flex-basis:5.4em;min-width:3.8em;border:3px solid var(--amber);box-shadow:0 0 0 1px #000,0 0 14px var(--amber);opacity:1}
.m-ic.cur::before{content:'';position:absolute;left:50%;bottom:-.75em;transform:translateX(-50%);border:.35em solid transparent;border-top-color:var(--amber)}
.m-rl{font-size:.72em;letter-spacing:.12em;text-transform:uppercase;color:var(--amber);text-shadow:2px 2px 0 #000;margin-top:.25em;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m-rl b{color:#fff}.m-rl .e{color:var(--bad)}
/* centre bottom stack: hover info + action bar */
.m-cs{position:absolute;bottom:${GUT}em;left:${CL}em;right:${CR}em;display:flex;flex-direction:column;align-items:center;gap:${GAP}em;pointer-events:none!important}
.m-info{min-width:12em;max-width:min(100%,27em);font-size:.82em;line-height:1.35;display:none;pointer-events:none!important}
.m-actp{display:none;max-width:100%;pointer-events:auto!important}
.m-actp .m-hd .who{color:#fff;letter-spacing:.06em;overflow:hidden;text-overflow:ellipsis;max-width:16em}
.m-actp .m-hd .btn{font-size:1em;letter-spacing:.06em;padding:.25em .6em}
.m-bar{display:flex;flex-wrap:wrap;gap:.3em;justify-content:center}
.m-ab{display:flex;align-items:center;gap:.3em;padding:.22em .45em;font-size:.74em;white-space:nowrap;position:relative;max-width:22em}
.m-ab .lb{overflow:hidden;text-overflow:ellipsis}
.m-ab.act{border-color:var(--amber)!important;background:#4a3417!important;color:#fff;box-shadow:0 0 8px #f2a93b88}
.m-ab .k{color:var(--dim);font-size:.8em;border:1px solid #fff2;padding:0 .2em;line-height:1.2}
.m-ab .c{display:flex;gap:.12em}.m-ab .c i{display:block;width:.5em;height:.5em;border-radius:50%;background:var(--amber)}.m-ab .c i.r{border-radius:0;transform:rotate(45deg);background:var(--steel)}
/* log */
.m-logp{position:absolute;right:${GUT}em;bottom:${GUT}em;width:${RW}em;display:flex;flex-direction:column;z-index:11}
.m-logp .m-hd{cursor:move;user-select:none;touch-action:none}
.m-logp.drag{box-shadow:0 0 0 2px var(--amber),4px 4px 0 #000a;opacity:.92}
.m-log{overflow-y:auto;overflow-x:hidden;min-height:0;font-size:.74em;line-height:1.35;overscroll-behavior:contain;padding-right:.3em;cursor:default;user-select:text}
.m-log::-webkit-scrollbar{width:1.1em}.m-log::-webkit-scrollbar-thumb{background:var(--edge);border:1px solid #000}.m-log::-webkit-scrollbar-thumb:hover{background:var(--edge-hi)}
.m-log div{padding:.05em 0;border-bottom:1px dotted #ffffff10;overflow-wrap:anywhere}
/* 2026-11-13: the whole log is grey; only mercenary names are coloured (their chosen colour, or bright by default) */
.m-log div,.m-log .good,.m-log .bad,.m-log .amber,.m-log .dim{color:#9c958a}.m-log .hd{color:#9c958a;border-bottom:1px solid var(--edge);margin-top:.3em}
.m-log b.nm{font-weight:inherit;color:#f4ead2}
.m-logp.col .m-log,.m-logp.col .m-new{display:none}.m-logp.col .m-hd{border-bottom:0;margin-bottom:0;padding-bottom:0}
/* character sheet (click a merc): equipment + available actions */
.m-sheet{position:absolute;left:${GUT + PW + GAP}em;top:9.6em;width:19em;max-height:calc(100% - 9.2em - 15em);overflow-y:auto;display:none;z-index:12;font-size:.92em}
.m-sheet .hdr{display:flex;gap:.5em;align-items:center;margin-bottom:.3em}
.m-sheet .hdr canvas{width:3em;height:3em;border:1px solid #000;flex:none}
.m-sheet .nm{color:var(--amber);font-weight:bold;font-size:.95em;line-height:1.2}
.m-sheet .sub{color:var(--dim);font-size:.72em}
.m-sheet .x{margin-left:auto;align-self:flex-start;font-size:.8em;padding:.1em .5em}
.m-sheet .sec{color:var(--amber);font-size:.68em;letter-spacing:.14em;text-transform:uppercase;border-bottom:1px solid var(--edge);margin:.5em 0 .25em;padding-bottom:.15em}
.m-sheet .it{display:flex;align-items:center;gap:.4em;font-size:.76em;line-height:1.25;padding:.12em 0}
.m-sheet .it canvas{width:1.7em;height:1.7em;flex:none;image-rendering:pixelated}
.m-sheet .it .sl{color:var(--dim);font-size:.82em;display:block}
.m-sheet .it .r{margin-left:auto;color:var(--dim);white-space:nowrap;font-size:.9em}
.m-sheet .ab{display:flex;align-items:center;gap:.35em;font-size:.76em;padding:.14em .2em;cursor:help;border-bottom:1px dotted #ffffff10}
.m-sheet .ab:hover{background:#ffffff10}
.m-sheet .ab .c{display:flex;gap:.12em;margin-left:auto}.m-sheet .ab .c i{display:block;width:.5em;height:.5em;border-radius:50%;background:var(--amber)}
.m-sheet .ab.off{opacity:.45}
.m-sheet .st{display:grid;grid-template-columns:repeat(3,1fr);gap:.2em;font-size:.72em}.m-sheet .st span{background:#0006;border:1px solid var(--edge);padding:.1em .3em;white-space:nowrap}
.m-new{position:absolute;left:0;right:0;margin:0 auto;width:max-content;bottom:.6em;font-size:.68em;padding:.25em .7em;display:none;z-index:2;box-shadow:0 0 10px #000}
`;

export function createHud(M) {
  const el = UI.el;
  const H = { cards: [], pc: new Map() };
  UI.add(el('style', { text: CSS }));
  const portraits = new Map();
  const portrait = (ch, size) => {
    const k = (ch.id || ch.name) + '|' + size; if (!portraits.has(k)) { try { portraits.set(k, G.portraitCanvas(ch, size)); } catch (e) { portraits.set(k, document.createElement('canvas')); } }
    const c = document.createElement('canvas'); const src = portraits.get(k); c.width = src.width || 1; c.height = src.height || 1; c.getContext('2d').drawImage(src, 0, 0); UI.pixCanvas(c); return c;
  };
  H.portrait = portrait;
  const hpCol = (side, p) => side === 'pc' ? (p > 0.6 ? 'var(--good)' : p > 0.3 ? 'var(--amber)' : 'var(--bad)') : (p > 0.5 ? '#d9473a' : p > 0.25 ? '#e0803a' : '#f0c040');

  // ---- LEFT column: objective (top) + party (bottom)
  H.obj = UI.add(UI.panel(`left:${GUT}em;top:${GUT}em;width:${LW}em;`, el('div', { class: 'm-hd', text: 'Zlecenie' }), el('div', { class: 't' }), el('div', { class: 'o-t' })));
  H.obj.classList.add('m-p', 'm-obj');
  H.party = UI.add(el('div', { class: 'm-party', style: `position:absolute;left:${GUT}em;bottom:${GUT}em;width:${PW}em` }));

  // ---- RIGHT column: menu (top) + log (bottom)
  H.menu = UI.add(el('div', { class: 'm-menu', style: `position:absolute;right:${GUT}em;top:${GUT}em;width:${RW}em` }));
  H.speedBtn = UI.button('', () => M.cycleSpeed(), { title: 'Tempo animacji (F)' });
  H.modeBtn = UI.button('', () => M.toggleGroup(), { title: 'Poruszanie: cała drużyna / jeden najemnik (G)' });
  H.menu.append(UI.button('Sterowanie [H]', () => H.help()), UI.button('Opcje', () => { try { Settings.open?.(); } catch (e) { console.warn(e); } }, { title: 'Ustawienia gry' }),
    H.speedBtn, H.modeBtn, UI.button('Mapa −', () => M.zoomBy(1 / 1.25), { title: 'Oddal mapę (kółko myszy lub klawisz −)' }), UI.button('Mapa +', () => M.zoomBy(1.25), { title: 'Przybliż mapę (kółko myszy lub klawisz +)' }), UI.button('Odwrót', () => M.retreat(), { class: 'danger wide', title: 'Wycofaj się ze zlecenia (bez nagrody za cel)' }));

  // ---- CENTRE column, top: initiative
  H.initW = UI.add(el('div', { class: 'm-initw' }));
  H.init = el('div', { class: 'm-init' });
  H.init.addEventListener('wheel', (e) => { if (H.init.scrollWidth > H.init.clientWidth) { H.init.scrollLeft += e.deltaY || e.deltaX; e.preventDefault(); } }, { passive: false });
  H.roundLbl = el('div', { class: 'm-rl' }); H.initW.append(H.init, H.roundLbl);

  // ---- CENTRE column, bottom: hover info + action bar
  H.cstack = UI.add(el('div', { class: 'm-cs' }));
  H.info = el('div', { class: 'panel m-p m-info' });
  H.barHead = el('div', { class: 'm-hd' }); H.bar = el('div', { class: 'm-bar' });
  H.barPanel = el('div', { class: 'panel m-p m-actp' }, H.barHead, H.bar);
  H.cstack.append(H.info, H.barPanel);
  /** Show the action bar: head = {who, actions, full, buttons:[Node]} (right-aligned head buttons), or null to hide. */
  H.setBarHead = (o) => {
    H.barHead.innerHTML = '';
    if (!o) { H.barPanel.style.display = 'none'; H.bar.innerHTML = ''; return; }
    H.barPanel.style.display = 'block';
    H.barHead.append(el('span', { class: 'who', text: o.who || '' }));
    if (o.actions != null) H.barHead.append(el('span', { style: 'display:flex;gap:.25em;align-items:center' }, ...Array.from({ length: Math.max(3, o.full || 3) }, (_, i) => el('span', { class: 'm-pip' + (i < o.actions ? ' on' : ''), style: 'width:.9em;height:.9em' }))), el('span', { class: 'dim', text: o.actions === 1 ? '1 akcja' : o.actions + (o.actions >= 2 && o.actions <= 4 ? ' akcje' : ' akcji') }));
    H.barHead.append(el('span', { class: 'sp' }), ...(o.buttons || []));
  };

  // ---- RIGHT column, bottom: log
  const pref = (k, d) => { try { return localStorage.getItem('pir-log-' + k) ?? d; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem('pir-log-' + k, v); } catch (e) {} };
  H.logSize = pref('size', 's'); H.logCol = pref('col', '0') === '1';
  const sizeBtn = el('button', { class: 'm-tb', title: 'Powiększ / zmniejsz dziennik' });
  const colBtn = el('button', { class: 'm-tb', title: 'Zwiń / rozwiń dziennik' });
  H.logList = el('div', { class: 'm-log' });
  H.newBtn = el('button', { class: 'btn primary m-new' });
  const fMinus = el('button', { class: 'm-tb', text: 'A−', title: 'Mniejsza czcionka dziennika' }), fPlus = el('button', { class: 'm-tb', text: 'A+', title: 'Większa czcionka dziennika' });
  const logHead = el('div', { class: 'm-hd', title: 'Przeciągnij, aby przenieść dziennik · dwuklik = wróć na miejsce' }, el('span', { text: '⠿ Dziennik' }), el('span', { class: 'sp' }), fMinus, fPlus, sizeBtn, colBtn);
  H.logBox = UI.add(el('div', { class: 'panel m-p m-logp' }, logHead, H.logList, H.newBtn));
  // font size (A− / A+), remembered
  const FS = [0.56, 0.64, 0.74, 0.86, 1.0, 1.16, 1.34]; H.logFs = Math.max(0, Math.min(FS.length - 1, +pref('fs', '2') | 0));
  const applyFs = () => { H.logList.style.fontSize = FS[H.logFs] + 'em'; H.logList.style.height = (LOG_H[H.logSize] * 0.74 / FS[H.logFs]).toFixed(3) + 'em'; fMinus.disabled = H.logFs <= 0; fPlus.disabled = H.logFs >= FS.length - 1; if (H.logFollow) H.logList.scrollTop = H.logList.scrollHeight; };
  for (const [b, d] of [[fMinus, -1], [fPlus, 1]]) { b.addEventListener('pointerdown', (e) => e.stopPropagation()); b.addEventListener('click', (e) => { e.stopPropagation(); UI.onClickSound?.(); H.logFs = Math.max(0, Math.min(FS.length - 1, H.logFs + d)); setPref('fs', String(H.logFs)); applyFs(); }); }
  for (const b of [sizeBtn, colBtn]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
  // free placement: drag the header anywhere on the screen (position kept as a fraction of the screen, so it survives resizes)
  const placeLog = (fx, fy) => {
    const host = H.logBox.parentNode, hw = host.clientWidth || 1, hh = host.clientHeight || 1, bw = H.logBox.offsetWidth, bh = H.logBox.offsetHeight;
    const x = Math.max(0, Math.min(hw - bw, fx * hw)), y = Math.max(0, Math.min(hh - Math.min(bh, hh), fy * hh));
    H.logBox.style.left = (x / hw * 100) + '%'; H.logBox.style.top = (y / hh * 100) + '%'; H.logBox.style.right = 'auto'; H.logBox.style.bottom = 'auto';
  };
  const homeLog = () => { for (const k of ['left', 'top', 'right', 'bottom']) H.logBox.style[k] = ''; H.logPos = null; setPref('pos', ''); };
  logHead.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
    const host = H.logBox.parentNode, hr = host.getBoundingClientRect(), br = H.logBox.getBoundingClientRect(), ox = e.clientX - br.left, oy = e.clientY - br.top; let moved = false;
    const mv = (ev) => { if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return; moved = true; H.logBox.classList.add('drag'); H.logPos = [(ev.clientX - ox - hr.left) / hr.width, (ev.clientY - oy - hr.top) / hr.height]; placeLog(H.logPos[0], H.logPos[1]); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); H.logBox.classList.remove('drag'); if (moved && H.logPos) { const r = H.logBox.getBoundingClientRect(); H.logPos = [(r.left - hr.left) / hr.width, (r.top - hr.top) / hr.height]; setPref('pos', H.logPos.map(v => v.toFixed(4)).join(',')); } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  logHead.addEventListener('dblclick', (e) => { e.stopPropagation(); homeLog(); });
  { const p = pref('pos', '').split(',').map(Number); if (p.length === 2 && p.every(Number.isFinite)) { H.logPos = p; requestAnimationFrame(() => H.logPos && placeLog(H.logPos[0], H.logPos[1])); } }
  window.addEventListener('resize', () => { if (H.logPos && H.logBox.isConnected) placeLog(H.logPos[0], H.logPos[1]); });
  const applyLog = () => {
    H.logBox.classList.toggle('col', H.logCol);
    H.logList.style.height = (LOG_H[H.logSize] * 0.74 / FS[H.logFs]).toFixed(3) + 'em';   // box height stays the same for every font size
    sizeBtn.textContent = H.logSize === 'l' ? '▭ mniej' : '▭ więcej'; sizeBtn.style.display = H.logCol ? 'none' : '';
    colBtn.textContent = H.logCol ? '▴ rozwiń' : '▾ zwiń';
    H.logToBottom(); if (H.logPos) requestAnimationFrame(() => H.logPos && placeLog(H.logPos[0], H.logPos[1]));
  };
  const atBottom = () => H.logList.scrollHeight - H.logList.scrollTop - H.logList.clientHeight < 6;
  H.logFollow = true; H.logUnseen = 0;
  const updNew = () => { H.newBtn.style.display = H.logFollow || H.logCol ? 'none' : 'block'; H.newBtn.textContent = '▼ Najnowsze' + (H.logUnseen ? ` (+${H.logUnseen})` : ''); };
  H.logToBottom = () => { H.logList.scrollTop = H.logList.scrollHeight; H.logFollow = true; H.logUnseen = 0; updNew(); };
  sizeBtn.addEventListener('click', (e) => { e.stopPropagation(); UI.onClickSound?.(); H.logSize = H.logSize === 'l' ? 's' : 'l'; setPref('size', H.logSize); applyLog(); });
  colBtn.addEventListener('click', (e) => { e.stopPropagation(); UI.onClickSound?.(); H.logCol = !H.logCol; setPref('col', H.logCol ? '1' : '0'); applyLog(); });
  H.newBtn.addEventListener('click', (e) => { e.stopPropagation(); UI.onClickSound?.(); H.logToBottom(); });
  // The user's scroll position decides whether new lines auto-follow (only when parked at the bottom).
  H.logList.addEventListener('scroll', () => { if (H._logPrograms) return; H.logFollow = atBottom(); if (H.logFollow) H.logUnseen = 0; updNew(); });
  // Wheel over the log scrolls the log only (never reaches the map zoom), also when it is at an end.
  H.logList.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
  // Drag the text area to scroll (in addition to the scrollbar).
  H.logList.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.offsetX > H.logList.clientWidth) return;   // the scrollbar handles itself
    const y0 = e.clientY, s0 = H.logList.scrollTop; let moved = false;
    const mv = (ev) => { const d = ev.clientY - y0; if (Math.abs(d) > 3) moved = true; if (moved) H.logList.scrollTop = s0 - d; };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  const MAX_LOG = 600;
  H.log = (msg, cls = '') => {
    const L = H.logList, follow = H.logFollow; const d = el('div', { class: cls });
    // mercenary names are written in the colour the player picked for them
    const tinted = M.pcs.filter(a => a.ch.name).sort((a, b) => b.ch.name.length - a.ch.name.length), text = String(msg);
    if (!tinted.length) d.textContent = text;
    else { let i = 0; while (i < text.length) { let hit = null, at = text.length; for (const a of tinted) { const k = text.indexOf(a.ch.name, i); if (k >= 0 && k < at) { at = k; hit = a; } } if (at > i) d.append(text.slice(i, at)); if (!hit) break; d.append(el('b', { class: 'nm', text: hit.ch.name, style: hit.ch.nameColor ? 'color:' + hit.ch.nameColor : '' })); i = at + hit.ch.name.length; } }
    L.append(d);
    H._logPrograms = true;
    let removed = 0; while (L.childElementCount > MAX_LOG) { removed += L.firstChild.offsetHeight; L.firstChild.remove(); }
    if (follow) L.scrollTop = L.scrollHeight; else { if (removed) L.scrollTop -= removed; H.logUnseen++; }
    H._logPrograms = false; updNew();
  };
  applyLog(); applyFs();

  H.banner = (text, color = 'var(--blood)', sub = '') => { const b = el('div', { class: 'm-banner', style: 'color:' + color }, text, sub ? el('small', { text: sub }) : null); UI.add(b); setTimeout(() => b.remove(), 2000); };
  H.setSpeed = (s) => { H.speedBtn.textContent = 'Tempo ' + (s >= 4 ? 'x4 bez kości' : 'x' + s) + ' [F]'; };
  H.setMode = (g) => { H.modeBtn.textContent = g ? 'Ruch: drużyna [G]' : 'Ruch: solo [G]'; };
  H.objective = (title, lines) => {
    H.obj.querySelector('.t').textContent = title; const t = H.obj.querySelector('.o-t'); t.innerHTML = '';
    for (const l of lines) t.append(el('div', { class: 'l ' + (l.cls || '') + (l.go ? ' go' : ''), text: (l.go ? '► ' : l.done ? '☑ ' : '☐ ') + l.text }));
  };
  // ---- character sheet: equipment + actions of the clicked mercenary (click again or ✕ to close)
  H.sheetBox = UI.add(el('div', { class: 'panel m-p m-sheet' })); H.sheetOf = null;
  H.sheetBox.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  const SLOT = { weapon: 'Broń główna', weapon2: 'Broń zapasowa', armor: 'Pancerz', shield: 'Tarcza' };
  const icn = (id) => { try { const c = G.itemIcon(id, 24); return UI.pixCanvas ? UI.pixCanvas(c) : c; } catch (e) { return el('span', { style: 'width:1.7em' }); } };
  const itemStat = (def) => { const w = def?.weapon, ar = def?.armor; return w ? `${w.damage}${w.range ? ' · zasięg ' + w.range : ' · wręcz'}` : ar ? `KP +${ar.ac}` : def?.shield ? `tarcza +${def.shield.ac ?? 2}` : ''; };
  H.sheetDraw = () => {
    const a = H.sheetOf, box = H.sheetBox; if (!a || a.state === 'dead') { box.style.display = 'none'; H.sheetOf = null; return; }
    const ch = a.ch, turn = M.turn && M.turn.actor === a, acts = turn ? M.turn.actions : 3;
    const cls = (() => { try { return R.CLASSES?.[ch.classId]?.name || ch.classId || ''; } catch (e) { return ''; } })();
    const kids = [el('div', { class: 'hdr' }, portrait(ch, 96), el('div', {}, el('div', { class: 'nm', text: ch.name, style: ch.nameColor ? 'color:' + ch.nameColor : '' }), el('div', { class: 'sub', text: `${cls} · poz. ${ch.level || 1}` })), UI.button('✕', () => H.sheet(null), { class: 'x', title: 'Zamknij kartę' })),
      el('div', { class: 'st' }, ...[['PW', `${Math.max(0, ch.hp)}/${ch.maxHp}`], ['KP', getStat(ch, 'ac')], ['Ruch', getStat(ch, 'speed') + ' pól'], ['Percepcja', '+' + getStat(ch, 'perception')], ['Akcje', turn ? `${acts}/3` : '3 / turę'], ['Refleks', '+' + getStat(ch, 'reflex')]].map(([k, v]) => el('span', {}, el('span', { class: 'dim', style: 'border:0;padding:0;background:none', text: k + ' ' }), String(v)))),
      el('div', { class: 'sec', text: 'Wyposażenie' })];
    for (const [slot, label] of Object.entries(SLOT)) { const it = ch.equipment?.[slot], def = it && ITEMS[it.id]; if (!def && (slot === 'weapon2' || slot === 'shield')) continue;
      const row = el('div', { class: 'it' }, def ? icn(it.id) : el('span', { style: 'width:1.7em;flex:none' }), el('div', {}, el('span', { class: 'sl', text: label }), def ? def.name : '— brak —'), def ? el('span', { class: 'r', text: itemStat(def) }) : null);
      if (def) UI.tooltip(row, `<b class="amber">${def.name}</b><br>${def.desc || ''}`); kids.push(row); }
    kids.push(el('div', { class: 'sec', text: 'Plecak' }));
    const inv = ch.inventory || []; if (!inv.length) kids.push(el('div', { class: 'it dim', text: 'pusty' }));
    for (const it of inv) { const def = ITEMS[it.id]; if (!def) continue; const row = el('div', { class: 'it' }, icn(it.id), el('div', { text: def.name }), el('span', { class: 'r', text: (it.qty > 1 ? 'x' + it.qty : '') + (itemStat(def) ? ' ' + itemStat(def) : '') })); UI.tooltip(row, `<b class="amber">${def.name}</b><br>${def.desc || ''}`); kids.push(row); }
    kids.push(el('div', { class: 'sec', text: turn ? `Dostępne akcje (zostało ${acts})` : 'Dostępne akcje' }));
    const base = [['Marsz', 1, `Ruch do ${getStat(ch, 'speed')} pól za 1 akcję.`], ['Krok', 1, 'Jedno pole bez prowokowania reakcji.']];
    for (const [n, c, d] of base) { const r = el('div', { class: 'ab' + (c > acts ? ' off' : '') }, el('span', { text: n }), el('span', { class: 'c' }, ...Array.from({ length: c }, () => el('i')))); UI.tooltip(r, `<b class="amber">${n}</b><br>${d}`); kids.push(r); }
    for (const id of ch.abilities || []) { const ab = ABILITIES[id]; if (!ab || id === 'stand' || (id === 'raise_shield' && !ch.equipment?.shield)) continue; const c = typeof ab.actions === 'number' ? ab.actions : (ab.cost ?? 1), left = ch.uses?.[id];
      const off = (typeof c === 'number' && c > acts) || left === 0;
      const r = el('div', { class: 'ab' + (off ? ' off' : '') }, (() => { try { const ic = G.abilityIcon(ab.icon || id, 24); return UI.pixCanvas ? UI.pixCanvas(ic) : ic; } catch (e) { return null; } })(), el('span', { text: ab.name + (left != null ? ` (${left})` : '') }), el('span', { class: 'c' }, ...Array.from({ length: typeof c === 'number' ? Math.min(3, c) : 1 }, () => el('i'))));
      const cv = r.querySelector('canvas'); if (cv) cv.style.cssText = 'width:1.5em;height:1.5em;flex:none';
      UI.tooltip(r, `<b class="amber">${ab.name}</b>${typeof c === 'number' ? ` <span class="dim">[${c} akc.]</span>` : ''}<br>${ab.desc || ''}`); kids.push(r); }
    box.replaceChildren(...kids); box.style.display = 'block';
  };
  /** Toggle / show the sheet for an actor (null closes). Clicking the same merc twice closes it. */
  H.sheet = (a, keep) => { H.sheetOf = a && (keep || H.sheetOf !== a) ? a : null; H.sheetDraw(); };
  H.showInfo = (html) => { if (!html) { H.info.style.display = 'none'; return; } H.info.innerHTML = html; H.info.style.display = 'block'; };
  H.help = () => UI.modal({ title: 'Sterowanie', body: `<div style="line-height:1.6;font-size:.9em">
<b class="amber">Kamera</b>: Q / E obrót, kółko = zoom, WASD / strzałki lub PPM + przeciągnięcie = przesuwanie, Spacja w eksploracji = wycentruj.<br>
<b class="amber">Eksploracja</b>: LPM na pole = ruch (drużyna podąża; G = tylko wybrany najemnik), LPM na skrzynię / cel = interakcja. Wrogowie zauważają drużynę (Percepcja vs Skradanie) i zaczyna się walka. Strefę ewakuacji wyznaczają zielone słupki.<br>
<b class="amber">Walka</b>: 3 akcje na turę. Podświetlone pola = zasięg ruchu (niebieskie 1 akcja, żółte 2, pomarańczowe 3). Wrogowie, których możesz zaatakować, mają <span class="bad">czerwony kontur</span>; cele umiejętności wspierających — <span class="good">zielony</span>. Najedź na wroga: szansa trafienia. Kolejne ataki: kara PWA -5/-10 (zwinne -4/-8).<br>
Klawisze: 1-9 przyciski akcji, Spacja = zakończ turę, Esc / PPM = anuluj, Tab = następny najemnik, F = tempo, H = sterowanie.<br>
<b class="amber">Osłona</b> (+2 KP) – niska przeszkoda tuż przy celu na linii strzału. <b class="amber">Flankowanie</b> – dwóch sojuszników po przeciwnych stronach = cel odsłonięty. Dystans: -2 za każdy kolejny zasięg broni.<br>
<b class="amber">Dziennik</b>: kółko / pasek przewijania / przeciąganie; przycisk „Najnowsze” wraca na dół.<br>
Poległych nie da się wskrzesić; powaleni potrzebują Pierwszej pomocy lub leczenia (inaczej umierają).</div>`, buttons: [{ label: 'Zamknij', value: true, class: 'primary' }] });
  const bad = new Set(['dying', 'bleeding', 'burning', 'poisoned', 'sickened', 'frightened', 'stunned', 'slowed', 'prone', 'off_guard', 'wounded', 'unconscious', 'blinded', 'immobilized']);
  /** Condition chips: [{node, id, name, val, desc}] */
  H.condList = (a) => {
    const out = []; const ch = a.ch;
    const add = (id, val, name, desc, good) => { const c = el('span', { class: 'm-cond', style: 'color:' + (good ? 'var(--good)' : bad.has(id) ? 'var(--bad)' : 'var(--amber)'), text: name.slice(0, 3).toUpperCase() + (val > 1 ? val : '') }); UI.tooltip(c, `<b class="amber">${name}${val > 1 ? ' ' + val : ''}</b><br>${desc || ''}`); out.push({ node: c, id, name, val }); };
    for (const [id, v] of Object.entries(ch.conditions || {})) { if (!v) continue; const def = CONDITIONS[id]; add(id, typeof v === 'number' ? v : 1, condName(id), (typeof def === 'object' && def?.desc) || '', false); }
    if (a.state === 'down' && !ch.conditions?.dying) add('stable', 1, 'Ustabilizowany', 'Nie umiera, ale jest nieprzytomny.', true);
    return out;
  };
  H.condChips = (a) => H.condList(a).map(c => c.node);
  H.party_ = () => {
    H.party.innerHTML = ''; if (H.sheetOf) H.sheetDraw();
    for (const a of M.pcs) {
      const ch = a.ch; const pct = Math.max(0, Math.min(1, ch.hp / ch.maxHp));
      const turn = M.turn && M.turn.actor === a;
      const conds = H.condList(a); const MAXC = turn ? 2 : 4; const shown = conds.slice(0, MAXC), rest = conds.slice(MAXC);
      const more = rest.length ? el('span', { class: 'm-cond', style: 'color:var(--dim)', text: '+' + rest.length }) : null;
      if (more) UI.tooltip(more, rest.map(c => `<b class="amber">${c.name}${c.val > 1 ? ' ' + c.val : ''}</b>`).join('<br>'));
      const st = a.state === 'dead' ? 'POLEGŁ' : a.state === 'down' ? (ch.conditions?.dying ? 'UMIERA ' + ch.conditions.dying : 'NIEPRZYT.') : '';
      const pips = turn ? Array.from({ length: Math.max(3, M.turn.full || 3) }, (_, i) => el('span', { class: 'm-pip' + (i < M.turn.actions ? ' on' : '') })) : [];
      const card = el('div', { class: 'm-card' + (M.selected === a ? ' sel' : '') + (turn ? ' act' : '') + (a.state === 'down' ? ' down' : '') + (a.state === 'dead' ? ' dead' : ''), on: { click: () => M.select(a) } },
        el('div', { class: 'm-pt' }, portrait(ch, 128), st ? el('div', { class: 'st', text: st }) : null,
          el('div', { class: 'm-row' }, ...pips, pips.length && shown.length ? el('span', { style: 'width:.2em;flex:none' }) : null, ...shown.map(c => c.node), more),
          el('div', { class: 'm-nm', text: ch.name, style: ch.nameColor ? 'color:' + ch.nameColor : '' })),
        el('div', { class: 'm-hpb' }, el('i', { style: `width:${pct * 100}%;background:${hpCol('pc', pct)}` }), el('span', { text: `${Math.max(0, ch.hp)}/${ch.maxHp}` + (ch.tempHp ? ` +${ch.tempHp}` : '') })));
      UI.tooltip(card, () => `<b class="amber">${ch.name}</b> (poz. ${ch.level || 1})<br>KP ${getStat(ch, 'ac')} · Percepcja +${getStat(ch, 'perception')} · Prędkość ${getStat(ch, 'speed')}${conds.length ? '<br>' + conds.map(c => c.name + (c.val > 1 ? ' ' + c.val : '')).join(', ') : ''}`);
      H.party.append(card);
    }
  };
  H.initBar = () => {
    H.init.innerHTML = ''; if (M.mode !== 'combat' || !M.C.order.length) { H.initW.style.display = 'none'; return; }
    H.initW.style.display = 'flex';
    const cur = M.turn?.actor; let curEl = null;
    for (const [i, a] of M.C.order.entries()) {
      if (a.state === 'dead' || (a.side === 'enemy' && !a.group?.alerted)) continue; const isCur = cur === a;
      const pct = Math.max(0, Math.min(1, a.ch.hp / a.ch.maxHp));
      const ic = el('div', { class: 'm-ic' + (a.side === 'enemy' ? ' e' : '') + (isCur ? ' cur' : '') + (a.state === 'down' ? ' down' : '') + (!isCur && i < M.C.idx ? ' done' : '') },
        portrait(a.ch, 128), el('div', { class: 'n', text: String(a.init ?? '') }), el('div', { class: 'hp' }, el('i', { style: `width:${pct * 100}%;background:${hpCol(a.side, pct)}` })));
      UI.tooltip(ic, () => `<b class="${a.side === 'pc' ? 'amber' : 'bad'}">${a.ch.name}</b>${a.side === 'enemy' ? ` <span class="dim">poz. ${a.ch.level || 1}</span>` : ''}<br>PW ${Math.max(0, a.ch.hp)}/${a.ch.maxHp} · KP ${getStat(a.ch, 'ac')} · inicjatywa ${a.init}${a.state === 'down' ? '<br><span class="bad">powalony</span>' : ''}`);
      ic.addEventListener('click', () => (a.side === 'pc' ? M.select(a) : M.focusActor(a))); H.init.append(ic); if (isCur) curEl = ic;
    }
    H.roundLbl.innerHTML = `Runda ${M.C.round}` + (cur ? ` · tura: <b class="${cur.side === 'enemy' ? 'e' : ''}">${escapeHtml(cur.ch.name)}</b>` : '');
    if (curEl && H.init.scrollWidth > H.init.clientWidth) { const l = curEl.offsetLeft - H.init.clientWidth / 2 + curEl.offsetWidth / 2; H.init.scrollLeft = l; }
  };
  H.abBtn = (label, iconName, cost, onClick, o = {}) => {
    const icon = o.iconCanvas || (iconName ? (() => { try { return G.abilityIcon(iconName, 24); } catch (e) { return null; } })() : null);
    const b = el('button', { class: 'btn m-ab' + (o.active ? ' act' : ''), disabled: o.disabled || null },
      o.key ? el('span', { class: 'k', text: o.key }) : null,
      icon ? UI.pixCanvas(icon, '1.5em') : null, el('span', { class: 'lb', text: label }),
      cost != null ? el('span', { class: 'c' }, ...Array.from({ length: cost === 'r' ? 1 : cost }, () => el('i', { class: cost === 'r' ? 'r' : '' }))) : null);
    b.addEventListener('click', (e) => { e.stopPropagation(); UI.onClickSound?.(); onClick(); });
    if (o.tip) UI.tooltip(b, o.tip); return b;
  };
  return H;
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
