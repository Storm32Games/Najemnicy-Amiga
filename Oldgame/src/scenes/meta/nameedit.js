// Name editor widget: text input (sanitised, max length) + "Losuj" (random name) + optional reset.
// Typing never reaches scene hotkeys (Engine ignores keydown while an input has focus).
import { UI, Audio } from './common.js';
import { NAME_MAX, checkName, sanitizeName } from '../../data/names.js';

/** Escape text for the few places that build HTML strings (tooltips). */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * nameEditor({ value, taken: () => [names], generate: () => name, onCommit(name), reset?: () => name, label? })
 * Returns a row element. onCommit is called with a valid, sanitised, unique name.
 */
export function nameEditor({ value, taken, generate, onCommit, reset, onDone, label = 'Imię' }) {
  let cur = value;
  const inp = UI.el('input', { class: 'name-input', type: 'text', maxlength: NAME_MAX + 4, spellcheck: 'false', autocomplete: 'off', value: cur, title: `Wpisz imię lub ksywę (do ${NAME_MAX} znaków). Ksywę możesz ująć w cudzysłów: Jan "Kos" Nowak` });
  const commit = (raw, quiet) => {
    const r = checkName(raw, taken());
    if (!r.ok) { if (!quiet) { Audio.sfx('error'); UI.toast(r.error); } inp.value = cur; return false; }
    inp.value = r.name; if (r.name !== cur) { cur = r.name; onCommit(r.name); } return true;
  };
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); onDone?.(); }
    else if (e.key === 'Escape') { e.preventDefault(); inp.value = cur; inp.blur(); onDone?.(); }
  });
  inp.addEventListener('input', () => { const s = sanitizeName(inp.value); if (inp.value.length > NAME_MAX + 2) inp.value = s; });
  inp.addEventListener('blur', () => commit(inp.value));
  inp.addEventListener('pointerdown', (e) => e.stopPropagation());
  const gen = UI.button('Losuj', () => { for (let i = 0; i < 8; i++) if (commit(generate(), true)) break; Audio.sfx('dice', { vol: 0.4 }); }, { title: 'Wylosuj imię pasujące do pochodzenia i klasy' });
  const row = UI.el('div', { class: 'name-edit', style: 'display:flex;gap:.4em;align-items:center' },
    label ? UI.el('span', { class: 'dim', style: 'font-size:.8em' }, label) : null, inp, gen,
    reset ? UI.button('↺', () => { commit(reset(), false); }, { title: 'Przywróć oryginalne imię' }) : null,
    onDone ? UI.button('OK', () => { commit(inp.value); onDone(); }, { class: 'primary', title: 'Zatwierdź (Enter)' }) : null);
  for (const b of row.querySelectorAll('.btn')) b.style.cssText = 'padding:.2em .55em;font-size:.85em';
  row.input = inp;
  return row;
}

/** Name colours a player can pick for a mercenary (null = default). Stored on the Character as `nameColor`. */
export const NAME_COLORS = [null, '#f2a93b', '#ff6a50', '#ff7ac0', '#c890ff', '#6ab0ff', '#40d8d0', '#8fe06a', '#e8e060', '#ffffff', '#b8a888'];
/** colorPicker({ value, onPick(color|null), label? }) -> a row of swatches. */
export function colorPicker({ value = null, onPick, label = 'Kolor imienia' }) {
  const row = UI.el('div', { class: 'name-colors', style: 'display:flex;gap:.3em;align-items:center;flex-wrap:wrap;margin-top:.35em' }, label ? UI.el('span', { class: 'dim', style: 'font-size:.8em;margin-right:.2em' }, label) : null);
  const sw = [];
  const mark = (cur) => sw.forEach(([c, b]) => { b.style.outline = (c || null) === (cur || null) ? '2px solid #fff' : '1px solid #000'; b.style.transform = (c || null) === (cur || null) ? 'scale(1.15)' : ''; });
  for (const c of NAME_COLORS) {
    const b = UI.el('button', { type: 'button', title: c ? 'Kolor imienia' : 'Kolor domyślny', style: `width:1.35em;height:1.35em;padding:0;border:0;cursor:pointer;background:${c || 'linear-gradient(135deg,#f2a93b 50%,#e8e0d0 50%)'};font-size:1em` });
    b.addEventListener('pointerdown', (e) => e.stopPropagation()); b.addEventListener('click', (e) => { e.stopPropagation(); Audio.sfx('click'); mark(c); onPick(c); }); sw.push([c, b]); row.append(b);
  }
  mark(value); return row;
}
