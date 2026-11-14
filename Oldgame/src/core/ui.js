// DOM overlay helpers. The overlay (#ui) sits above the WebGL canvas, same size (16:9).
// Font size scales with the viewport, so use `em` units in scene UIs.
export const UI = {
  root: null,
  init() { this.root = document.getElementById('ui'); this.clear(); },
  /** Remove everything from the overlay (called automatically on scene change). */
  clear() { if (this.root) this.root.innerHTML = ''; this._tip = null; },
  _tip: null,
  /**
   * Create an element. props: { class, style (string|object), text, html, on: {click: fn}, title, ...attrs }
   * children: nodes or strings (null/false skipped).
   */
  el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') { if (typeof v === 'string') e.style.cssText = v; else Object.assign(e.style, v); }
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return e;
  },
  /** Append to overlay root (or given parent). Returns node. */
  add(node, parent) { (parent || this.root).append(node); return node; },
  /** Absolutely positioned panel. pos: css string e.g. 'left:2%;top:2%;width:30%' */
  panel(pos, ...children) { return this.el('div', { class: 'panel', style: 'position:absolute;' + pos }, ...children); },
  button(label, onClick, opts = {}) {
    const b = this.el('button', { class: 'btn ' + (opts.class || ''), title: opts.title, disabled: opts.disabled || null }, label);
    b.addEventListener('click', (e) => { e.stopPropagation(); UI.onClickSound?.(); onClick?.(e); });
    b.addEventListener('mouseenter', () => UI.onHoverSound?.());
    return b;
  },
  toast(msg, cls = '') {
    const t = this.el('div', { class: 'panel toast ' + cls }, msg); this.root.append(t);
    setTimeout(() => t.remove(), 2700); return t;
  },
  /** Modal dialog. buttons: [{label, value, class}] -> Promise resolving to value. body: string|Node */
  modal({ title = '', body = '', buttons = [{ label: 'OK', value: true }] } = {}) {
    return new Promise(resolve => {
      const back = this.el('div', { class: 'modal-back' });
      const box = this.el('div', { class: 'panel modal' }, title ? this.el('h2', { text: title }) : null,
        typeof body === 'string' ? this.el('div', { html: body }) : body);
      const row = this.el('div', { class: 'row' });
      for (const b of buttons) row.append(this.button(b.label, () => { back.remove(); resolve(b.value); }, { class: b.class }));
      box.append(row); back.append(box); this.root.append(back);
    });
  },
  /** Attach a hover tooltip (html string or fn returning html) to an element. */
  tooltip(target, content) {
    let tip = null;
    target.addEventListener('mouseenter', () => {
      UI._tip?.remove();
      tip = this.el('div', { class: 'panel tooltip', html: typeof content === 'function' ? content() : content });
      this.root.append(tip); UI._tip = tip;
      // A click often rebuilds the list (e.g. buying) and removes the hovered row without a mouseleave:
      // drop the tooltip as soon as its target leaves the DOM or is no longer hovered.
      const watch = () => {
        if (!tip) return;
        if (!target.isConnected || !target.matches(':hover')) { kill(); return; }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    });
    target.addEventListener('mousemove', (e) => {
      if (!tip) return; const r = this.root.getBoundingClientRect();
      let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
      if (x + tip.offsetWidth > r.width) x = e.clientX - r.left - tip.offsetWidth - 10;
      if (y + tip.offsetHeight > r.height) y = e.clientY - r.top - tip.offsetHeight - 10;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    const kill = () => { tip?.remove(); if (UI._tip === tip) UI._tip = null; tip = null; };
    target.addEventListener('mouseleave', kill); target.addEventListener('click', kill);
    return target;
  },
  /** Draw a canvas (e.g. a pixel portrait) scaled up crisply. */
  pixCanvas(canvas, cssW) { canvas.classList.add('pix'); if (cssW) canvas.style.width = cssW; return canvas; },
  onClickSound: null, onHoverSound: null,
};
