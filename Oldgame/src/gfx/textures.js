// Procedural 32x32 pixel textures for tiles, props and buildings.
import { THREE } from '../core/engine.js';
import { Pix, mkCanvas, rng, hash, shade, mix, canvasTex, clamp, parseHex, toHex } from './util.js';

const S = 32;
// wrapped blob (tileable)
function blob(g, x, y, rx, ry, col, R, jag = 0.25) {
  g.fillStyle = col;
  for (let yy = -ry; yy <= ry; yy++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / (ry * ry + 0.01))) * (1 + (R() - 0.5) * jag));
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) g.fillRect(Math.round(x - w + ox), Math.round(y + yy + oy), w * 2 + 1, 1);
  }
}
function wpx(g, x, y, col) { g.fillStyle = col; g.fillRect(((Math.round(x) % S) + S) % S, ((Math.round(y) % S) + S) % S, 1, 1); }
function patches(g, base, R, n, amt, size = 5) { for (let i = 0; i < n; i++) blob(g, R() * S, R() * S, 2 + R() * size, 1.5 + R() * size * 0.6, R() < 0.5 ? shade(base, 1 - amt) : shade(base, 1 + amt), R, 0.6); }
function speckle(g, base, R, n, lo = 0.8, hi = 1.2) { for (let i = 0; i < n; i++) wpx(g, R() * S, R() * S, shade(base, lo + (hi - lo) * R())); }
function crack(g, R, col, x = R() * S, y = R() * S, len = 14, light = null) {
  let a = R() * 6.28;
  for (let i = 0; i < len; i++) { wpx(g, x, y, col); if (light) wpx(g, x + 1, y + 1, light); a += (R() - 0.5) * 1.1; x += Math.cos(a) * 1.1; y += Math.sin(a) * 1.1; if (R() < 0.12) crack(g, R, col, x, y, 5, light); }
}

export const TILE_TYPES = ['sand', 'asphalt', 'asphalt_cracked', 'rubble', 'concrete', 'dirt', 'toxic', 'grass_dead', 'metal', 'tiles'];

function paintTile(type, variant) {
  const [c, g] = mkCanvas(S, S); const R = rng(hash(type) + variant * 7919 + 13); let emi = null;
  const base = { sand: '#c4a064', asphalt: '#3b3b40', asphalt_cracked: '#3e3d42', rubble: '#6e6a62', concrete: '#85807a', dirt: '#6a4a30', toxic: '#3a3a2c', grass_dead: '#8a7c3e', metal: '#59626a', tiles: '#a39a84' }[type] || '#777';
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  switch (type) {
    case 'sand': {
      patches(g, base, R, 8, 0.1, 7);
      for (let k = 0; k < 5; k++) { const y0 = R() * S, ph = R() * 6, amp = 0.8 + R() * 1.2, len = 10 + R() * 22, x0 = R() * S; for (let x = 0; x < len; x++) { const yy = y0 + Math.sin(x * 0.35 + ph) * amp; wpx(g, x0 + x, yy, shade(base, 0.82)); wpx(g, x0 + x, yy + 1, shade(base, 1.14)); } }
      speckle(g, base, R, 70, 0.85, 1.15); for (let k = 0; k < 3; k++) { const x = R() * S, y = R() * S; wpx(g, x, y, '#7a6a52'); wpx(g, x + 1, y, '#a09078'); } break; }
    case 'asphalt': case 'asphalt_cracked': {
      patches(g, base, R, 10, 0.12, 6); speckle(g, base, R, 140, 0.78, 1.3);
      for (let k = 0; k < (variant % 2 ? 1 : 0); k++) blob(g, R() * S, R() * S, 4 + R() * 4, 3 + R() * 2, '#26262a', R, 0.5);
      if (type === 'asphalt_cracked') { for (let k = 0; k < 2 + (variant % 2); k++) crack(g, R, '#1a1a1e', R() * S, R() * S, 16, '#55555a'); for (let k = 0; k < 3; k++) { const x = R() * S, y = R() * S; wpx(g, x, y, '#5a6a2a'); wpx(g, x + 1, y - 1, '#7a8a3a'); } }
      if (variant === 3) { g.fillStyle = '#b8a84a'; for (let x = 0; x < S; x += 8) g.fillRect(x, 15, 5, 2); speckle(g, '#b8a84a', R, 10, 0.5, 0.8); }
      break; }
    case 'rubble': {
      patches(g, base, R, 6, 0.12, 5);
      for (let k = 0; k < 14; k++) { const x = R() * S, y = R() * S, w = 3 + R() * 6, h = 2 + R() * 4, col = ['#8a8478', '#6a655c', '#a09a8c', '#5a564f', '#7a5a46'][(R() * 5) | 0]; for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.fillStyle = col; g.fillRect(Math.round(x + ox), Math.round(y + oy), Math.round(w), Math.round(h)); g.fillStyle = shade(col, 1.3); g.fillRect(Math.round(x + ox), Math.round(y + oy), Math.round(w), 1); g.fillStyle = shade(col, 0.6); g.fillRect(Math.round(x + ox), Math.round(y + oy + h - 1), Math.round(w), 1); } }
      for (let k = 0; k < 2; k++) { const x = R() * S, y = R() * S; for (let i = 0; i < 7; i++) wpx(g, x + i, y + i * 0.4, '#b4532a'); } speckle(g, base, R, 40, 0.7, 1.2); break; }
    case 'concrete': {
      patches(g, base, R, 8, 0.07, 7); speckle(g, base, R, 80, 0.88, 1.1);
      g.fillStyle = shade(base, 0.6); g.fillRect(0, 0, S, 1); g.fillRect(0, 0, 1, S); g.fillStyle = shade(base, 1.18); g.fillRect(1, 1, S - 1, 1); g.fillRect(1, 1, 1, S - 1);
      if (variant % 2) { g.fillStyle = shade(base, 0.66); g.fillRect(0, 15, S, 1); g.fillStyle = shade(base, 1.15); g.fillRect(0, 16, S, 1); }
      if (variant > 0) crack(g, R, shade(base, 0.45), 4 + R() * 24, 4 + R() * 24, 10, shade(base, 1.2)); if (variant === 2) blob(g, 16, 16, 6, 4, shade(base, 0.7), R, 0.5); break; }
    case 'dirt': {
      patches(g, base, R, 10, 0.14, 6); speckle(g, base, R, 120, 0.7, 1.3);
      for (let k = 0; k < 6; k++) { const x = R() * S, y = R() * S, col = ['#8a7a68', '#4a3220', '#9a8a70'][(R() * 3) | 0]; wpx(g, x, y, col); wpx(g, x + 1, y, shade(col, 0.7)); }
      if (variant % 2) { for (const yy of [8, 21]) for (let x = 0; x < S; x++) { wpx(g, x, yy + Math.sin(x * 0.2) * 1.5, shade(base, 0.7)); wpx(g, x, yy + 1 + Math.sin(x * 0.2) * 1.5, shade(base, 1.2)); } } break; }
    case 'toxic': {
      emi = mkCanvas(S, S); emi[1].fillStyle = '#000'; emi[1].fillRect(0, 0, S, S);
      patches(g, base, R, 8, 0.1, 6); speckle(g, base, R, 70, 0.8, 1.2);
      const np = 1 + (variant % 3);
      for (let k = 0; k < np; k++) {
        const x = R() * S, y = R() * S, rx = 5 + R() * 6, ry = 3 + R() * 4;
        blob(g, x, y, rx + 1, ry + 1, '#1c3a14', R, 0.3); blob(g, x, y, rx, ry, '#4fae2a', R, 0.3); blob(g, x - 1, y - 1, rx * 0.6, ry * 0.6, '#8fe04a', R, 0.3); blob(g, x - 2, y - 1, rx * 0.25, ry * 0.25, '#d8ff8a', R, 0.2);
        blob(emi[1], x, y, rx, ry, '#2a7a18', R, 0.3); blob(emi[1], x - 1, y - 1, rx * 0.6, ry * 0.6, '#6ad030', R, 0.3); blob(emi[1], x - 2, y - 1, rx * 0.25, ry * 0.25, '#c8ff70', R, 0.2);
        for (let b = 0; b < 3; b++) { const bx = x + (R() - 0.5) * rx, by = y + (R() - 0.5) * ry; wpx(g, bx, by, '#e8ffb0'); wpx(emi[1], bx, by, '#ffffff'); }
      }
      for (let k = 0; k < 2; k++) { const x = R() * S, y = R() * S; wpx(g, x, y, '#c8c030'); wpx(g, x + 1, y, '#8a8a20'); }
      break; }
    case 'grass_dead': {
      patches(g, base, R, 12, 0.14, 6); speckle(g, base, R, 60, 0.8, 1.2);
      for (let k = 0; k < 8; k++) { const x = R() * S, y = R() * S, col = ['#a89a4a', '#6a5a2a', '#c0b060', '#5a6a2a'][(R() * 4) | 0]; for (let i = 0; i < 3; i++) { wpx(g, x + i - 1, y - (i === 1 ? 2 : 1), col); wpx(g, x + i - 1, y, shade(col, 0.7)); } }
      for (let k = 0; k < 3; k++) blob(g, R() * S, R() * S, 4 + R() * 3, 2 + R() * 2, '#6a5030', R, 0.5); break; }
    case 'metal': {
      patches(g, base, R, 5, 0.08, 6);
      g.fillStyle = shade(base, 0.55); for (const p of [0, 16]) { g.fillRect(p, 0, 1, S); g.fillRect(0, p, S, 1); } g.fillStyle = shade(base, 1.3); for (const p of [1, 17]) { g.fillRect(p, 0, 1, S); g.fillRect(0, p, S, 1); }
      for (const [x, y] of [[3, 3], [13, 3], [3, 13], [13, 13], [19, 3], [29, 3], [19, 13], [29, 13], [3, 19], [13, 19], [3, 29], [13, 29], [19, 19], [29, 19], [19, 29], [29, 29]]) { wpx(g, x, y, '#2a2e32'); wpx(g, x - 1, y - 1, '#9aa4aa'); }
      for (let k = 0; k < 5; k++) { const x = R() * S, y = R() * S; for (let i = 0; i < 5 + R() * 6; i++) wpx(g, x + i, y, shade(base, 1 + (R() - 0.5) * 0.5)); }
      for (let k = 0; k < 4; k++) blob(g, R() * S, R() * S, 2 + R() * 3, 1 + R() * 2, '#8a4a28', R, 0.7); if (variant % 2) { g.fillStyle = '#c0a030'; for (let x = -S; x < S; x += 8) for (let y = 0; y < 5; y++) g.fillRect(x + y + 0, 24 + y, 4, 1); g.fillStyle = '#2a2a2a'; for (let x = -S; x < S; x += 8) for (let y = 0; y < 5; y++) g.fillRect(x + y + 4, 24 + y, 4, 1); } break; }
    case 'tiles': {
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) { const col = (tx + ty) % 2 ? '#a8a08a' : '#8e9a86'; g.fillStyle = shade(col, 0.92 + R() * 0.14); g.fillRect(tx * 8, ty * 8, 8, 8); g.fillStyle = shade(col, 1.25); g.fillRect(tx * 8, ty * 8, 8, 1); g.fillStyle = '#4a463c'; g.fillRect(tx * 8 + 7, ty * 8, 1, 8); g.fillRect(tx * 8, ty * 8 + 7, 8, 1); }
      patches(g, '#908a76', R, 6, 0.1, 5); crack(g, R, '#3a362e', R() * S, R() * S, 12, '#c0b8a0'); for (let k = 0; k < 2; k++) blob(g, R() * S, R() * S, 3 + R() * 3, 2 + R() * 2, '#6a4a30', R, 0.6); speckle(g, '#a39a84', R, 30, 0.8, 1.1); break; }
  }
  return { c, emi: emi && emi[0] };
}

const tileCache = new Map();
export function tileMaterial(type = 'sand', variant = 0) {
  type = TILE_TYPES.includes(type) ? type : 'sand'; variant = ((variant | 0) % 4 + 4) % 4;
  const key = type + variant; let m = tileCache.get(key); if (m) return m;
  const { c, emi } = paintTile(type, variant);
  m = new THREE.MeshLambertMaterial({ map: canvasTex(c, { repeat: true, mip: true }) });
  if (emi) { m.emissiveMap = canvasTex(emi, { repeat: true, mip: true }); m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 1.0; }
  m.name = 'tile_' + key; tileCache.set(key, m); return m;
}

// ---------------- prop / building surface textures ----------------
function paintSurface(name, col) {
  const [c, g] = mkCanvas(S, S); const R = rng(hash(name + col)); const P = new Pix(g);
  switch (name) {
    case 'concrete': { const b = col || '#8c867a'; g.fillStyle = b; g.fillRect(0, 0, S, S); patches(g, b, R, 9, 0.09, 7); speckle(g, b, R, 90, 0.85, 1.12); g.fillStyle = shade(b, 0.62); g.fillRect(0, S - 1, S, 1); g.fillStyle = shade(b, 1.15); g.fillRect(0, 0, S, 1); if (R() < 0.7) crack(g, R, shade(b, 0.5), R() * S, R() * S, 11, shade(b, 1.2)); blob(g, R() * S, 4, 6, 3, shade(b, 0.78), R, 0.6); for (let k = 0; k < 4; k++) { const x = R() * S; for (let y = 0; y < 5 + R() * 10; y++) wpx(g, x, y + 10, shade(b, 0.78)); } break; }
    case 'brick': { const b = col || '#8a4a38'; g.fillStyle = shade(b, 0.55); g.fillRect(0, 0, S, S); for (let r = 0; r < 8; r++) for (let k = 0; k < 4; k++) { const x = (k * 8 + (r % 2) * 4) % S, y = r * 4, cc = shade(b, 0.8 + R() * 0.45); g.fillStyle = cc; g.fillRect(x, y, 7, 3); g.fillStyle = shade(cc, 1.25); g.fillRect(x, y, 7, 1); if (x + 7 > S - 1 && false) { } if (x > 24) { g.fillStyle = cc; g.fillRect(0, y, (x + 7) - S + 1, 3); } } patches(g, b, R, 4, 0.12, 5); for (let k = 0; k < 4; k++) { const x = R() * S, y = R() * S; g.fillStyle = shade('#7a7a70', 0.9 + R() * 0.3); g.fillRect(x, y, 4, 3); } speckle(g, b, R, 30, 0.7, 1.2); break; }
    case 'rust': { const b = col || '#8a4a28'; g.fillStyle = b; g.fillRect(0, 0, S, S); patches(g, b, R, 12, 0.22, 6); for (let k = 0; k < 7; k++) { const x = R() * S; const len = 6 + R() * 18, y0 = R() * 10; for (let y = 0; y < len; y++) wpx(g, x, y0 + y, shade(b, 0.7)); } speckle(g, b, R, 90, 0.65, 1.4); for (let k = 0; k < 3; k++) blob(g, R() * S, R() * S, 2 + R() * 3, 2, '#3a2418', R, 0.6); g.fillStyle = shade(b, 1.3); g.fillRect(0, 0, S, 1); break; }
    case 'metal': { const b = col || '#6a727a'; g.fillStyle = b; g.fillRect(0, 0, S, S); patches(g, b, R, 6, 0.1, 6); for (let k = 0; k < 8; k++) { const x = R() * S, y = R() * S; for (let i = 0; i < 4 + R() * 8; i++) wpx(g, x + i, y, shade(b, 1 + (R() - 0.5) * 0.6)); } g.fillStyle = shade(b, 0.5); g.fillRect(0, 15, S, 1); g.fillStyle = shade(b, 1.3); g.fillRect(0, 16, S, 1); for (const x of [3, 28]) for (const y of [3, 12, 20, 28]) { wpx(g, x, y, '#2a2e32'); wpx(g, x - 1, y - 1, '#aab'); } for (let k = 0; k < 3; k++) blob(g, R() * S, R() * S, 2 + R() * 3, 2, '#7a4424', R, 0.7); break; }
    case 'corr': { const b = col || '#9a3a28'; g.fillStyle = b; g.fillRect(0, 0, S, S); for (let x = 0; x < S; x += 4) { g.fillStyle = shade(b, 1.3); g.fillRect(x, 0, 1, S); g.fillStyle = shade(b, 0.7); g.fillRect(x + 2, 0, 2, S); } patches(g, b, R, 8, 0.12, 6); for (let k = 0; k < 5; k++) blob(g, R() * S, R() * S, 2 + R() * 3, 3 + R() * 3, '#5a2a18', R, 0.8); speckle(g, b, R, 60, 0.6, 1.3); break; }
    case 'wood': { const b = col || '#8a6236'; g.fillStyle = b; g.fillRect(0, 0, S, S); for (let y = 0; y < S; y += 8) { g.fillStyle = shade(b, 0.8 + R() * 0.35); g.fillRect(0, y, S, 7); g.fillStyle = shade(b, 0.5); g.fillRect(0, y + 7, S, 1); g.fillStyle = shade(b, 1.25); g.fillRect(0, y, S, 1); for (let k = 0; k < 6; k++) { const x = R() * S; for (let i = 0; i < 4 + R() * 8; i++) wpx(g, x + i, y + 1 + R() * 5 | 0, shade(b, 0.7)); } if (R() < 0.5) { const x = R() * S; wpx(g, x, y + 3, '#2a1a0a'); wpx(g, x + 1, y + 3, '#4a2a14'); } } break; }
    case 'glass': { g.fillStyle = '#1e3a46'; g.fillRect(0, 0, S, S); for (let k = -S; k < S; k += 9) for (let i = 0; i < S; i++) { wpx(g, k + i, i, '#3a6678'); if (i % 5 < 2) wpx(g, k + i + 1, i, '#6a9aa8'); } crack(g, R, '#0a1a20', 10, 10, 10, '#8ab8c4'); break; }
    case 'canvas': { const b = col || '#b89a62'; g.fillStyle = b; g.fillRect(0, 0, S, S); patches(g, b, R, 8, 0.1, 6); for (let y = 0; y < S; y += 4) { g.fillStyle = shade(b, 0.88); g.fillRect(0, y, S, 1); } for (let x = 0; x < S; x += 8) { g.fillStyle = shade(b, 0.8); g.fillRect(x, 0, 1, S); } for (let k = 0; k < 2; k++) { const x = R() * 24, y = R() * 24; g.fillStyle = shade(['#8a4a28', '#4a5a3a', '#6a6a70'][(R() * 3) | 0], 1); g.fillRect(x, y, 7, 6); g.strokeStyle = '#3a2a18'; g.strokeRect(x + 0.5, y + 0.5, 6, 5); } speckle(g, b, R, 50, 0.75, 1.15); break; }
    case 'sandbag': { const b = col || '#a8905e'; g.fillStyle = shade(b, 0.55); g.fillRect(0, 0, S, S); for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) { const x = (k * 16 + (r % 2) * 8) % S, y = r * 8; g.fillStyle = shade(b, 0.85 + R() * 0.3); g.fillRect(x, y, 15, 7); g.fillStyle = shade(b, 1.25); g.fillRect(x + 1, y, 13, 2); g.fillStyle = shade(b, 0.65); g.fillRect(x, y + 6, 15, 1); wpx(g, x + 7, y + 3, shade(b, 0.7)); } speckle(g, b, R, 50, 0.7, 1.2); break; }
    case 'asphalt': { const b = '#3a3a3e'; g.fillStyle = b; g.fillRect(0, 0, S, S); speckle(g, b, R, 120, 0.8, 1.3); patches(g, b, R, 8, 0.1, 6); break; }
    case 'bark': { const b = col || '#4a3a2c'; g.fillStyle = b; g.fillRect(0, 0, S, S); for (let x = 0; x < S; x += 3) { const w = 1 + (R() * 2 | 0); g.fillStyle = shade(b, 0.55 + R() * 0.3); g.fillRect(x, 0, w, S); g.fillStyle = shade(b, 1.2); g.fillRect(x + w, 0, 1, S); for (let k = 0; k < 4; k++) wpx(g, x, R() * S, '#2a1c12'); } speckle(g, b, R, 30, 0.7, 1.3); break; }
    case 'car': { const b = col || '#9a3a28'; g.fillStyle = b; g.fillRect(0, 0, S, S); patches(g, b, R, 8, 0.15, 7); g.fillStyle = shade(b, 1.3); g.fillRect(0, 0, S, 2); g.fillStyle = shade(b, 0.65); g.fillRect(0, S - 3, S, 3); for (let k = 0; k < 6; k++) blob(g, R() * S, R() * S, 2 + R() * 4, 1 + R() * 3, '#7a4a22', R, 0.8); for (let k = 0; k < 4; k++) { const x = R() * S, y = R() * S; for (let i = 0; i < 6; i++) wpx(g, x + i, y + i * 0.3, shade(b, 1.5)); } speckle(g, b, R, 60, 0.6, 1.3); break; }
    case 'hazard': { g.fillStyle = '#d8b020'; g.fillRect(0, 0, S, S); g.fillStyle = '#1e1c1a'; for (let k = -S; k < S * 2; k += 10) for (let i = 0; i < S; i++) g.fillRect(k + i, i, 5, 1); patches(g, '#d8b020', R, 4, 0.2, 4); speckle(g, '#7a6a20', R, 40, 0.5, 1.2); break; }
    case 'toxbarrel': { const b = '#b8b82a'; g.fillStyle = b; g.fillRect(0, 0, S, S); for (let x = 0; x < S; x += 4) { g.fillStyle = shade(b, 0.9 + (x % 8) * 0.01); g.fillRect(x, 0, 1, S); } g.fillStyle = '#2a2a14'; g.fillRect(0, 4, S, 2); g.fillRect(0, 26, S, 2); g.fillStyle = '#16160c'; g.beginPath(); g.arc(16, 16, 7, 0, 6.3); g.fill(); g.fillStyle = b; g.beginPath(); g.arc(16, 16, 6, 0, 6.3); g.fill(); g.fillStyle = '#16160c'; g.beginPath(); g.arc(16, 16, 1.8, 0, 6.3); g.fill(); for (const a of [0, 2.09, 4.19]) { g.beginPath(); g.moveTo(16, 16); g.arc(16, 16, 6, a - 0.5, a + 0.5); g.fill(); } patches(g, b, R, 6, 0.15, 4); blob(g, 8, 20, 3, 6, '#5ab02a', R, 0.5); speckle(g, b, R, 40, 0.6, 1.2); break; }
    case 'barrel': { const b = col || '#8a4a28'; g.fillStyle = b; g.fillRect(0, 0, S, S); for (let x = 0; x < S; x += 4) { g.fillStyle = shade(b, 0.82 + R() * 0.3); g.fillRect(x, 0, 3, S); g.fillStyle = shade(b, 1.35); g.fillRect(x, 0, 1, S); } g.fillStyle = shade(b, 0.5); for (const y of [2, 14, 28]) g.fillRect(0, y, S, 2); g.fillStyle = shade(b, 1.4); for (const y of [2, 14, 28]) g.fillRect(0, y, S, 1); patches(g, b, R, 6, 0.2, 4); speckle(g, b, R, 60, 0.6, 1.3); break; }
    case 'dark': { g.fillStyle = col || '#16120f'; g.fillRect(0, 0, S, S); speckle(g, col || '#16120f', R, 40, 0.5, 1.6); break; }
    case 'bone': { const b = '#d8cdb0'; g.fillStyle = b; g.fillRect(0, 0, S, S); patches(g, b, R, 5, 0.12, 4); speckle(g, b, R, 30, 0.7, 1.1); break; }
    case 'cloth': { const b = col || '#5a4a3a'; g.fillStyle = b; g.fillRect(0, 0, S, S); patches(g, b, R, 8, 0.15, 6); speckle(g, b, R, 60, 0.7, 1.3); break; }
    case 'chain': { // alpha chain-link
      g.clearRect(0, 0, S, S); for (let k = -S; k < S * 2; k += 4) for (let i = 0; i < S; i++) { wpx(g, k + i, i, '#8a929a'); wpx(g, k - i + S, i, '#6a727a'); } g.fillStyle = 'rgba(0,0,0,0)'; break; }
    default: { g.fillStyle = col || '#777'; g.fillRect(0, 0, S, S); }
  }
  return c;
}
const surfCache = new Map();
/** Lambert material with a pixel texture. key: 'name' or 'name:#color' */
export function surf(key, opts = {}) {
  let m = surfCache.get(key + (opts.alpha ? '|a' : '')); if (m) return m;
  const [name, col] = key.split(':'); const c = paintSurface(name, col ? '#' + col.replace('#', '') : undefined);
  m = new THREE.MeshLambertMaterial({ map: canvasTex(c, { repeat: true, mip: !opts.alpha }), side: opts.alpha ? THREE.DoubleSide : THREE.FrontSide, alphaTest: opts.alpha ? 0.5 : 0, transparent: false });
  surfCache.set(key + (opts.alpha ? '|a' : ''), m); return m;
}
export { paintSurface };
