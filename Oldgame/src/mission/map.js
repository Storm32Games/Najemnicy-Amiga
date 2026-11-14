// Procedural tactical map generator (pure data; scene instantiates it with GFX).
export const MAP_W = 32, MAP_H = 32;   // 2026-11-12: wieksza mapa (bylo 24x24); liczby obiektow skalowane przez K
// 0 free, 1 low cover (blocks move, not sight), 2 high (blocks both)
export const PROP_KIND = { car: 1, bus: 2, barrel: 1, barrel_toxic: 1, crate: 1, debris: 1, sandbags: 1, container: 2, fence: 1, generator: 2, pillar: 2, terminal: 1, tent: 2, tank_trap: 1, scrap_pile: 1, wall: 2, wall_broken: 1 };
const DECOR = ['lamp', 'sign', 'antenna', 'tree_dead', 'skeleton', 'campfire'];

export function hashSeed(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function generateMap(contract, enemyIds = []) {
  const W = MAP_W, H = MAP_H, biome = contract.biome || 'ruins';
  const rng = mulberry(hashSeed(contract.id || 'x'));
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const K = (W * H) / (24 * 24);   // area factor vs the original 24x24 tuning
  const kn = (n) => Math.round(n * K);
  const block = new Uint8Array(W * H);
  const floor = new Array(W * H).fill('asphalt');
  const props = [], buildings = [], solids = [], decor = [], interiors = [];
  const I = (x, y) => y * W + x, inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  // entry zone (4x4 corner), also extraction
  const corner = ri(0, 3);
  const ex = corner & 1 ? W - 5 : 1, ey = corner & 2 ? H - 5 : 1;
  const entry = { x0: ex, y0: ey, x1: ex + 3, y1: ey + 3, cells: [] };
  for (let y = ey; y <= ey + 3; y++) for (let x = ex; x <= ex + 3; x++) entry.cells.push({ x, y });
  const reserved = (x, y) => x >= ex - 1 && x <= ex + 4 && y >= ey - 1 && y <= ey + 4;
  const put = (type, x, y, o = {}) => {
    if (!inb(x, y) || block[I(x, y)] || (!o.force && reserved(x, y))) return false;
    const k = PROP_KIND[type] ?? 1; block[I(x, y)] = k; props.push({ type, x, y, rot: o.rot ?? ri(0, 3), seed: ri(1, 9999) }); return true;
  };
  const setFloor = (x, y, t) => { if (inb(x, y)) floor[I(x, y)] = t; };
  const rect = (x0, y0, w, h, fn) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) fn(x, y); };
  const rectFree = (x0, y0, w, h) => { for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) { if (!inb(x, y) || reserved(x, y) || block[I(x, y)]) return false; } return true; };
  const scatter = (types, n, tries = 200) => { let c = 0; while (c < n && tries-- > 0) { if (put(pick(types), ri(0, W - 1), ri(0, H - 1))) c++; } };
  const line = (type, x, y, len, horiz, gapAt = -1) => { for (let i = 0; i < len; i++) { if (i === gapAt) continue; put(type, horiz ? x + i : x, horiz ? y : y + i, { rot: horiz ? 0 : 1 }); } };
  // walled compound with a door gap, returns interior center
  const compound = (x0, y0, w, h, wallType = 'wall') => {
    if (!rectFree(x0, y0, w, h)) return false;
    const side = ri(0, 3), gap = ri(1, (side < 2 ? w : h) - 2);
    rect(x0, y0, w, h, (x, y) => {
      const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
      setFloor(x, y, biome === 'wastes' ? 'dirt' : 'concrete');
      if (!edge) return;
      const onGap = (side === 0 && y === y0 && x - x0 === gap) || (side === 1 && y === y0 + h - 1 && x - x0 === gap) || (side === 2 && x === x0 && y - y0 === gap) || (side === 3 && x === x0 + w - 1 && y - y0 === gap);
      if (onGap) { if (biome === 'bunker' || biome === 'industrial') decor.push({ type: 'door', x, y }); return; }
      put(rng() < 0.18 ? 'wall_broken' : wallType, x, y, { rot: (y === y0 || y === y0 + h - 1) ? 0 : 1 });
    });
    const cx = x0 + 1 + ri(0, w - 3), cy = y0 + 1 + ri(0, h - 3);
    interiors.push({ x: cx, y: cy }); return true;
  };
  const building = (x0, y0, w, d, h) => {
    if (!rectFree(x0, y0, w, d)) return false;
    rect(x0, y0, w, d, (x, y) => { block[I(x, y)] = 2; setFloor(x, y, 'concrete'); });
    buildings.push({ x: x0, y: y0, w, d, h, seed: ri(1, 9999) }); return true;
  };

  if (biome === 'ruins') {
    for (let i = 0; i < W * H; i++) floor[i] = rng() < 0.25 ? 'asphalt_cracked' : 'asphalt';
    // lots (non-road) as rubble/concrete
    const roadsX = [ri(5, 7), ri(14, 16), ri(23, 25)], roadsY = [ri(5, 7), ri(14, 16), ri(23, 25)];
    const isRoad = (x, y) => roadsX.some(r => x >= r && x < r + 2) || roadsY.some(r => y >= r && y < r + 2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!isRoad(x, y)) setFloor(x, y, rng() < 0.4 ? 'rubble' : 'concrete');
    for (let t = 0; t < kn(40); t++) {
      const w = ri(3, 5), d = ri(3, 4), x0 = ri(0, W - w), y0 = ri(0, H - d);
      let onRoad = false; rect(x0, y0, w, d, (x, y) => { if (isRoad(x, y)) onRoad = true; }); if (onRoad) continue;
      if (rng() < 0.45) building(x0, y0, w, d, ri(1, 3)); else compound(x0, y0, Math.max(w, 4), Math.max(d, 4));
    }
    for (let i = 0; i < kn(9); i++) { const r = pick([...roadsX.map(v => [v, ri(0, H - 1)]), ...roadsY.map(v => [ri(0, W - 1), v])]); put('car', r[0] + ri(0, 1), r[1], { rot: ri(0, 1) * 2 }); }
    scatter(['barrel', 'debris', 'debris', 'sandbags', 'scrap_pile', 'barrel_toxic', 'crate', 'tank_trap'], kn(26));
    scatter(['lamp', 'sign', 'tree_dead', 'skeleton', 'antenna', 'campfire'], kn(12), 160);
    for (let i = 0; i < kn(2); i++) put('bus', ri(0, W - 1), roadsY[i % 3], { rot: 0 });
  } else if (biome === 'wastes') {
    for (let i = 0; i < W * H; i++) floor[i] = rng() < 0.3 ? 'dirt' : 'sand';
    for (let p = 0; p < kn(4); p++) { const cx = ri(3, W - 4), cy = ri(3, H - 4), r = ri(1, 2); if (cx > ex - 4 && cx < ex + 8 && cy > ey - 4 && cy < ey + 8) continue; rect(cx - r, cy - r, r * 2 + 1, r * 2 + 1, (x, y) => { if (Math.hypot(x - cx, y - cy) <= r + 0.3 && inb(x, y) && !reserved(x, y)) { setFloor(x, y, 'toxic'); block[I(x, y)] = 3; } }); }
    for (let i = 0; i < kn(12); i++) { const x = ri(0, W - 3), y = ri(0, H - 3); for (let k = 0; k < ri(1, 3); k++) put(rng() < 0.6 ? 'wall_broken' : 'pillar', x + ri(0, 2), y + ri(0, 2)); }
    for (let i = 0; i < kn(2); i++) compound(ri(2, W - 8), ri(2, H - 7), ri(4, 5), ri(4, 5), 'wall_broken');
    for (let i = 0; i < kn(5); i++) put(pick(['car', 'bus', 'car']), ri(0, W - 1), ri(0, H - 1));
    for (let i = 0; i < kn(3); i++) { const x = ri(2, W - 3), y = ri(2, H - 3); if (put('tent', x, y)) { decor.push({ type: 'campfire', x: x + 1, y }); } }
    scatter(['scrap_pile', 'debris', 'barrel', 'sandbags', 'tank_trap', 'crate'], kn(16));
    scatter(['skeleton', 'tree_dead', 'sign', 'antenna'], kn(12), 160);
  } else if (biome === 'industrial') {
    for (let i = 0; i < W * H; i++) floor[i] = rng() < 0.2 ? 'metal' : 'concrete';
    for (let r = 0; r < kn(5); r++) { const x = ri(0, W - 5), y = ri(0, H - 1), horiz = rng() < 0.5; line('container', horiz ? x : ri(0, W - 1), horiz ? y : ri(0, H - 5), ri(3, 5), horiz, ri(-1, 3)); }
    for (let r = 0; r < kn(4); r++) line('fence', ri(0, W - 7), ri(0, H - 1), ri(4, 7), true, ri(1, 4));
    for (let r = 0; r < kn(3); r++) line('fence', ri(0, W - 1), ri(0, H - 7), ri(4, 7), false, ri(1, 4));
    for (let i = 0; i < kn(2); i++) compound(ri(2, W - 8), ri(2, H - 7), ri(4, 6), ri(4, 5), 'wall');
    scatter(['generator', 'generator', 'terminal'], kn(5));
    scatter(['barrel', 'barrel_toxic', 'crate', 'debris', 'tank_trap', 'scrap_pile'], kn(22));
    scatter(['antenna', 'lamp', 'sign', 'skeleton'], kn(7), 120);
  } else { // bunker: carve rooms and corridors
    block.fill(2); for (let i = 0; i < W * H; i++) floor[i] = rng() < 0.3 ? 'metal' : 'tiles';
    const rooms = [{ x: ex - (corner & 1 ? 1 : 0), y: ey - (corner & 2 ? 1 : 0), w: 5, h: 5 }];
    for (let t = 0; t < 200 && rooms.length < kn(8); t++) {
      const w = ri(4, 7), h = ri(4, 6), x = ri(1, W - w - 1), y = ri(1, H - h - 1);
      if (rooms.some(r => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue; rooms.push({ x, y, w, h });
    }
    const carve = (x, y) => { if (inb(x, y) && x > 0 && y > 0 && x < W - 1 && y < H - 1) { block[I(x, y)] = 0; if (floor[I(x, y)] === 'tiles' && rng() < 0.5) floor[I(x, y)] = 'concrete'; } };
    for (const r of rooms) rect(r.x, r.y, r.w, r.h, carve);
    const cen = r => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });
    const order = rooms.slice().sort((a, b) => cen(a).x + cen(a).y - cen(b).x - cen(b).y);
    for (let i = 0; i + 1 < order.length; i++) {
      const a = cen(order[i]), b = cen(order[i + 1]); let x = a.x, y = a.y;
      while (x !== b.x) { carve(x, y); carve(x, y + 1); x += Math.sign(b.x - x); }
      while (y !== b.y) { carve(x, y); carve(x + 1, y); y += Math.sign(b.y - y); }
    }
    for (const r of rooms.slice(1)) {
      for (let k = 0; k < ri(2, 4); k++) put(pick(['terminal', 'barrel', 'crate', 'generator', 'pillar', 'sandbags']), ri(r.x, r.x + r.w - 1), ri(r.y, r.y + r.h - 1));
      interiors.push(cen(r));
    }
    // entry room clear
    rect(ex, ey, 4, 4, (x, y) => { block[I(x, y)] = 0; });
  }
  // clear entry zone
  for (const c of entry.cells) { block[I(c.x, c.y)] = 0; }
  for (const p of props) if (reserved(p.x, p.y) && entry.cells.some(c => c.x === p.x && c.y === p.y)) p._remove = true;
  const keep = props.filter(p => !p._remove); props.length = 0; props.push(...keep);
  // decorations that block nothing (only on free cells at the end)
  const deco = [];
  for (const p of props.slice()) if (DECOR.includes(p.type)) { /* put() would have blocked: unblock */ block[I(p.x, p.y)] = 0; deco.push(p); props.splice(props.indexOf(p), 1); }
  // solid blocks for bunker walls (instanced): boundary only
  if (biome === 'bunker') for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (block[I(x, y)] === 2 && !props.some(p => p.x === x && p.y === y)) {
    let near = false; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(x + dx, y + dy) && block[I(x + dx, y + dy)] !== 2) near = true;
    solids.push({ x, y, near });
  }
  // reachability (4-dir) from entry
  const dist4 = new Int16Array(W * H).fill(-1); const q = [[entry.cells[5].x, entry.cells[5].y]]; dist4[I(q[0][0], q[0][1])] = 0;
  for (let qi = 0; qi < q.length; qi++) { const [x, y] = q[qi]; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (inb(nx, ny) && block[I(nx, ny)] === 0 && dist4[I(nx, ny)] < 0) { dist4[I(nx, ny)] = dist4[I(x, y)] + 1; q.push([nx, ny]); } } }
  const reach = []; let maxD = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dist4[I(x, y)] >= 0) { reach.push({ x, y, d: dist4[I(x, y)] }); maxD = Math.max(maxD, dist4[I(x, y)]); }
  const used = new Set();
  const takeCell = (pred) => { const c = reach.filter(c => !used.has(I(c.x, c.y)) && pred(c)); if (!c.length) return null; const r = pick(c); used.add(I(r.x, r.y)); return r; };
  // objective position: far
  const objCell = takeCell(c => c.d >= maxD * 0.75) || takeCell(c => c.d >= maxD * 0.5) || takeCell(c => true);
  // enemy groups
  const ids = enemyIds.slice(); const groups = []; const nG = Math.max(1, Math.min(4, Math.ceil(ids.length / 3)));
  const centers = []; const bossIdx = ids.findIndex(e => /kostucha|boss/i.test(String(e)));
  for (let g = 0; g < nG; g++) {
    const minD = g === 0 && nG > 1 ? maxD * 0.3 : maxD * 0.45;
    let c = null;
    if (g === nG - 1 && objCell) c = { x: objCell.x, y: objCell.y, d: objCell.d };
    else c = takeCell(c => c.d >= minD && centers.every(o => Math.hypot(o.x - c.x, o.y - c.y) >= 6)) || takeCell(c => c.d >= 8);
    if (!c) c = reach[reach.length - 1 - g * 3] || reach[0];
    centers.push(c); groups.push({ center: c, members: [], cells: [] });
  }
  ids.forEach((id, i) => groups[(id === ids[bossIdx] && bossIdx >= 0) ? nG - 1 : i % nG].members.push(id));
  for (const g of groups) {
    const near = reach.filter(c => Math.hypot(c.x - g.center.x, c.y - g.center.y) <= 3.2 && !used.has(I(c.x, c.y)) && !(c.x === objCell?.x && c.y === objCell?.y)).sort((a, b) => Math.hypot(a.x - g.center.x, a.y - g.center.y) - Math.hypot(b.x - g.center.x, b.y - g.center.y));
    for (let k = 0; k < g.members.length; k++) { const c = near[k] || near[0]; if (c) { used.add(I(c.x, c.y)); g.cells.push({ x: c.x, y: c.y }); } else g.cells.push({ x: g.center.x, y: g.center.y }); }
  }
  // crates: interiors first
  const crates = []; const nCr = 3 + (contract.level > 2 ? 1 : 0);
  const crateSpot = (c) => { const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => inb(c.x + dx, c.y + dy) && block[I(c.x + dx, c.y + dy)] === 0).length; return adj >= 2; };
  for (const it of interiors) { if (crates.length >= nCr - 1) break; const cc = reach.find(r => r.x === it.x && r.y === it.y && !used.has(I(r.x, r.y)) && r.d > 6); if (cc) { used.add(I(cc.x, cc.y)); crates.push({ x: cc.x, y: cc.y }); } }
  while (crates.length < nCr) { const c = takeCell(c => c.d >= 6 && crateSpot(c)); if (!c) break; crates.push({ x: c.x, y: c.y }); }
  for (const c of crates) block[I(c.x, c.y)] = 1;
  // finds (2026-11-12): resources to discover while exploring. Visible ones glint; hidden ones need a Perception check nearby.
  const FIND_KINDS = ['scrap', 'scrap', 'cache', 'medical', 'tech', 'food', 'ammo'];
  const finds = [];
  for (let k = 0; k < kn(7) + ri(0, 3); k++) {
    const c = takeCell(c => c.d >= 4 && block[I(c.x, c.y)] === 0); if (!c) break;
    finds.push({ x: c.x, y: c.y, kind: pick(FIND_KINDS), hidden: rng() < 0.55 });
  }
  return { W, H, biome, block, floor, props, deco, decor, buildings, solids, entry, groups, crates, finds, objCell, reach, maxD, rngSeed: hashSeed(contract.id || 'x') };
}
