// Own 5x7 pixel font (uppercase, digits, Polish Ł) for logo/title lettering.
const G = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11100 10010 10001 10001 10001 10010 11100',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 11011 10001', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  'Ł': '10000 10000 10010 11100 10000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00110 01000 10000 11111', 3: '11110 00001 00001 01110 00001 00001 11110',
  4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
  '-': '00000 00000 00000 11111 00000 00000 00000', '.': '00000 00000 00000 00000 00000 01100 01100',
  '!': '00100 00100 00100 00100 00100 00000 00100', ' ': '00000 00000 00000 00000 00000 00000 00000',
};
const rows = (ch) => (G[ch] || G[' ']).split(' ');
/** pixel list [{x,y}] (y down) for a string, 1 col spacing; returns {px, w, h}. */
export function textPixels(str, spacing = 1) {
  const px = []; let x = 0;
  for (const ch of str.toUpperCase().replace(/[^\u0141]/g, c => c.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
    const r = rows(ch);
    r.forEach((row, y) => { for (let i = 0; i < 5; i++) if (row[i] === '1') px.push({ x: x + i, y }); });
    x += 5 + spacing;
  }
  return { px, w: x - spacing, h: 7 };
}
/** Draw lettering to a canvas with vertical gradient + dark outline + drop shadow. */
export function textCanvas(str, scale = 4, { top = '#ffd36b', bottom = '#b4532a', outline = '#1a0e06', shadow = true, spacing = 1 } = {}) {
  const { px, w, h } = textPixels(str, spacing);
  const pad = 2, c = document.createElement('canvas');
  c.width = (w + pad * 2 + 1) * scale; c.height = (h + pad * 2 + 1) * scale;
  const g = c.getContext('2d');
  const set = new Set(px.map(p => p.x + ',' + p.y));
  if (shadow) { g.fillStyle = '#0008'; for (const p of px) g.fillRect((p.x + pad + 1) * scale, (p.y + pad + 1) * scale, scale, scale); }
  g.fillStyle = outline;
  for (const p of px) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
    g.fillRect((p.x + pad + dx) * scale, (p.y + pad + dy) * scale, scale, scale);
  const grad = g.createLinearGradient(0, pad * scale, 0, (pad + h) * scale);
  grad.addColorStop(0, top); grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  for (const p of px) g.fillRect((p.x + pad) * scale, (p.y + pad) * scale, scale, scale);
  // highlight on top edges
  g.fillStyle = '#ffffff55';
  for (const p of px) if (!set.has(p.x + ',' + (p.y - 1))) g.fillRect((p.x + pad) * scale, (p.y + pad) * scale, scale, Math.max(1, scale >> 2));
  c.className = 'pix'; return c;
}
