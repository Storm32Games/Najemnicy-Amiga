// Proceduralny generator mapy taktycznej (czyste dane; scena tylko je rysuje).
// Migracja z Oldgame/src/mission/map.js. Deterministyczny: to samo id zlecenia = ta sama mapa.
import type { EnemyId } from '../data/types.ts';
import { hashSeed, makeRng } from '../rules/dice.ts';
import type { GridPos } from '../rules/types.ts';
import { CellKind, DIRS4, TacticalGrid } from './grid.ts';

export const MAP_W = 32;
export const MAP_H = 32;

export type Biome = 'ruins' | 'wastes' | 'industrial' | 'bunker';
export type FloorType = 'sand' | 'asphalt' | 'asphalt_cracked' | 'rubble' | 'concrete' | 'dirt' | 'toxic' | 'metal' | 'tiles';
export type PropType =
  | 'car' | 'bus' | 'barrel' | 'barrel_toxic' | 'crate' | 'debris' | 'sandbags' | 'container' | 'fence' | 'generator' | 'pillar'
  | 'terminal' | 'tent' | 'tank_trap' | 'scrap_pile' | 'wall' | 'wall_broken'
  | 'lamp' | 'sign' | 'antenna' | 'tree_dead' | 'skeleton' | 'campfire' | 'door';

/** Ile blokuje dany obiekt: 1 niska osłona, 2 wysoka przeszkoda. Brak wpisu = 1. */
export const PROP_KIND: Readonly<Partial<Record<PropType, CellKind>>> = {
  car: 1, bus: 2, barrel: 1, barrel_toxic: 1, crate: 1, debris: 1, sandbags: 1, container: 2, fence: 1, generator: 2, pillar: 2,
  terminal: 1, tent: 2, tank_trap: 1, scrap_pile: 1, wall: 2, wall_broken: 1,
};
/** Dekoracje: nie blokują niczego. */
const DECOR: ReadonlySet<PropType> = new Set<PropType>(['lamp', 'sign', 'antenna', 'tree_dead', 'skeleton', 'campfire']);

export interface MapProp extends GridPos {
  type: PropType;
  /** Obrót w ćwiartkach (0..3). */
  rot: number;
  seed: number;
}
export interface MapBuilding extends GridPos {
  w: number;
  d: number;
  /** Liczba pięter. */
  h: number;
  seed: number;
}
export interface ReachCell extends GridPos {
  /** Odległość (4-kierunkowa) od strefy wejścia. */
  d: number;
}
export interface EntryZone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cells: GridPos[];
}
export interface EnemyGroupSpawn {
  center: ReachCell;
  members: EnemyId[];
  cells: GridPos[];
}
export type FindKind = 'scrap' | 'cache' | 'medical' | 'tech' | 'food' | 'ammo';
export interface FindSpawn extends GridPos {
  kind: FindKind;
  /** Ukryte znaleziska wymagają testu Percepcji w pobliżu. */
  hidden: boolean;
}

export interface TacticalMap {
  width: number;
  height: number;
  biome: Biome;
  grid: TacticalGrid;
  floor: FloorType[];
  props: MapProp[];
  /** Dekoracje bez kolizji (latarnie, szkielety...). */
  deco: MapProp[];
  /** Drzwi / ogniska dorysowywane obok. */
  decor: { type: PropType; gx: number; gy: number }[];
  buildings: MapBuilding[];
  /** Pełne bloki ścian bunkra (near = graniczy z korytarzem). */
  solids: { gx: number; gy: number; near: boolean }[];
  /** Strefa wejścia = strefa ewakuacji. */
  entry: EntryZone;
  groups: EnemyGroupSpawn[];
  crates: GridPos[];
  finds: FindSpawn[];
  /** Pole celu zlecenia (przedmiot / jeniec). */
  objCell: ReachCell | null;
  reach: ReachCell[];
  maxD: number;
  seed: number;
}

export interface MapSpec {
  id: string;
  biome?: Biome;
  level?: number;
}

const isBossId = (id: string): boolean => /kostucha|boss/i.test(id);

export function generateMap(spec: MapSpec, enemyIds: readonly EnemyId[] = []): TacticalMap {
  const W = MAP_W;
  const H = MAP_H;
  const biome: Biome = spec.biome ?? 'ruins';
  const seed = hashSeed(spec.id || 'x');
  const rng = makeRng(seed);
  const ri = (a: number, b: number): number => a + Math.floor(rng() * (b - a + 1));
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rng() * a.length)];
  const K = (W * H) / (24 * 24); // skala liczby obiektów względem pierwotnej mapy 24x24
  const kn = (n: number): number => Math.round(n * K);
  const block = new Uint8Array(W * H);
  const floor: FloorType[] = new Array<FloorType>(W * H).fill('asphalt');
  let props: MapProp[] = [];
  const buildings: MapBuilding[] = [];
  const solids: TacticalMap['solids'] = [];
  const decor: TacticalMap['decor'] = [];
  const interiors: GridPos[] = [];
  const I = (x: number, y: number): number => y * W + x;
  const inb = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  // strefa wejścia (4x4 w losowym rogu) - także ewakuacja
  const corner = ri(0, 3);
  const ex = corner & 1 ? W - 5 : 1;
  const ey = corner & 2 ? H - 5 : 1;
  const entry: EntryZone = { x0: ex, y0: ey, x1: ex + 3, y1: ey + 3, cells: [] };
  for (let y = ey; y <= ey + 3; y++) for (let x = ex; x <= ex + 3; x++) entry.cells.push({ gx: x, gy: y });
  const reserved = (x: number, y: number): boolean => x >= ex - 1 && x <= ex + 4 && y >= ey - 1 && y <= ey + 4;

  const put = (type: PropType, x: number, y: number, o: { force?: boolean; rot?: number } = {}): boolean => {
    if (!inb(x, y) || block[I(x, y)] || (!o.force && reserved(x, y))) return false;
    block[I(x, y)] = PROP_KIND[type] ?? CellKind.LOW;
    props.push({ type, gx: x, gy: y, rot: o.rot ?? ri(0, 3), seed: ri(1, 9999) });
    return true;
  };
  const setFloor = (x: number, y: number, t: FloorType): void => {
    if (inb(x, y)) floor[I(x, y)] = t;
  };
  const rect = (x0: number, y0: number, w: number, h: number, fn: (x: number, y: number) => void): void => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) fn(x, y);
  };
  const rectFree = (x0: number, y0: number, w: number, h: number): boolean => {
    for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) if (!inb(x, y) || reserved(x, y) || block[I(x, y)]) return false;
    return true;
  };
  const scatter = (types: readonly PropType[], n: number, tries = 200): void => {
    let c = 0;
    while (c < n && tries-- > 0) if (put(pick(types), ri(0, W - 1), ri(0, H - 1))) c++;
  };
  const line = (type: PropType, x: number, y: number, len: number, horiz: boolean, gapAt = -1): void => {
    for (let i = 0; i < len; i++) {
      if (i === gapAt) continue;
      put(type, horiz ? x + i : x, horiz ? y : y + i, { rot: horiz ? 0 : 1 });
    }
  };
  /** Ogrodzony teren z jedną bramą. */
  const compound = (x0: number, y0: number, w: number, h: number, wallType: PropType = 'wall'): boolean => {
    if (!rectFree(x0, y0, w, h)) return false;
    const side = ri(0, 3);
    const gap = ri(1, (side < 2 ? w : h) - 2);
    rect(x0, y0, w, h, (x, y) => {
      const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
      setFloor(x, y, biome === 'wastes' ? 'dirt' : 'concrete');
      if (!edge) return;
      const onGap =
        (side === 0 && y === y0 && x - x0 === gap) || (side === 1 && y === y0 + h - 1 && x - x0 === gap) ||
        (side === 2 && x === x0 && y - y0 === gap) || (side === 3 && x === x0 + w - 1 && y - y0 === gap);
      if (onGap) {
        if (biome === 'bunker' || biome === 'industrial') decor.push({ type: 'door', gx: x, gy: y });
        return;
      }
      put(rng() < 0.18 ? 'wall_broken' : wallType, x, y, { rot: y === y0 || y === y0 + h - 1 ? 0 : 1 });
    });
    interiors.push({ gx: x0 + 1 + ri(0, w - 3), gy: y0 + 1 + ri(0, h - 3) });
    return true;
  };
  const building = (x0: number, y0: number, w: number, d: number, h: number): boolean => {
    if (!rectFree(x0, y0, w, d)) return false;
    rect(x0, y0, w, d, (x, y) => {
      block[I(x, y)] = CellKind.HIGH;
      setFloor(x, y, 'concrete');
    });
    buildings.push({ gx: x0, gy: y0, w, d, h, seed: ri(1, 9999) });
    return true;
  };

  if (biome === 'ruins') {
    for (let i = 0; i < W * H; i++) floor[i] = rng() < 0.25 ? 'asphalt_cracked' : 'asphalt';
    const roadsX = [ri(5, 7), ri(14, 16), ri(23, 25)];
    const roadsY = [ri(5, 7), ri(14, 16), ri(23, 25)];
    const isRoad = (x: number, y: number): boolean => roadsX.some((r) => x >= r && x < r + 2) || roadsY.some((r) => y >= r && y < r + 2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!isRoad(x, y)) setFloor(x, y, rng() < 0.4 ? 'rubble' : 'concrete');
    for (let t = 0; t < kn(40); t++) {
      const w = ri(3, 5);
      const d = ri(3, 4);
      const x0 = ri(0, W - w);
      const y0 = ri(0, H - d);
      let onRoad = false;
      rect(x0, y0, w, d, (x, y) => {
        if (isRoad(x, y)) onRoad = true;
      });
      if (onRoad) continue;
      if (rng() < 0.45) building(x0, y0, w, d, ri(1, 3));
      else compound(x0, y0, Math.max(w, 4), Math.max(d, 4));
    }
    for (let i = 0; i < kn(9); i++) {
      const r = pick([...roadsX.map((v) => [v, ri(0, H - 1)]), ...roadsY.map((v) => [ri(0, W - 1), v])]);
      put('car', r[0] + ri(0, 1), r[1], { rot: ri(0, 1) * 2 });
    }
    scatter(['barrel', 'debris', 'debris', 'sandbags', 'scrap_pile', 'barrel_toxic', 'crate', 'tank_trap'], kn(26));
    scatter(['lamp', 'sign', 'tree_dead', 'skeleton', 'antenna', 'campfire'], kn(12), 160);
    for (let i = 0; i < kn(2); i++) put('bus', ri(0, W - 1), roadsY[i % 3], { rot: 0 });
  } else if (biome === 'wastes') {
    for (let i = 0; i < W * H; i++) floor[i] = rng() < 0.3 ? 'dirt' : 'sand';
    for (let p = 0; p < kn(4); p++) {
      const cx = ri(3, W - 4);
      const cy = ri(3, H - 4);
      const r = ri(1, 2);
      if (cx > ex - 4 && cx < ex + 8 && cy > ey - 4 && cy < ey + 8) continue;
      rect(cx - r, cy - r, r * 2 + 1, r * 2 + 1, (x, y) => {
        if (Math.hypot(x - cx, y - cy) <= r + 0.3 && inb(x, y) && !reserved(x, y)) {
          setFloor(x, y, 'toxic');
          block[I(x, y)] = CellKind.HAZARD;
        }
      });
    }
    for (let i = 0; i < kn(12); i++) {
      const x = ri(0, W - 3);
      const y = ri(0, H - 3);
      for (let k = 0; k < ri(1, 3); k++) put(rng() < 0.6 ? 'wall_broken' : 'pillar', x + ri(0, 2), y + ri(0, 2));
    }
    for (let i = 0; i < kn(2); i++) compound(ri(2, W - 8), ri(2, H - 7), ri(4, 5), ri(4, 5), 'wall_broken');
    for (let i = 0; i < kn(5); i++) put(pick(['car', 'bus', 'car'] as const), ri(0, W - 1), ri(0, H - 1));
    for (let i = 0; i < kn(3); i++) {
      const x = ri(2, W - 3);
      const y = ri(2, H - 3);
      if (put('tent', x, y)) decor.push({ type: 'campfire', gx: x + 1, gy: y });
    }
    scatter(['scrap_pile', 'debris', 'barrel', 'sandbags', 'tank_trap', 'crate'], kn(16));
    scatter(['skeleton', 'tree_dead', 'sign', 'antenna'], kn(12), 160);
  } else if (biome === 'industrial') {
    for (let i = 0; i < W * H; i++) floor[i] = rng() < 0.2 ? 'metal' : 'concrete';
    for (let r = 0; r < kn(5); r++) {
      const x = ri(0, W - 5);
      const y = ri(0, H - 1);
      const horiz = rng() < 0.5;
      line('container', horiz ? x : ri(0, W - 1), horiz ? y : ri(0, H - 5), ri(3, 5), horiz, ri(-1, 3));
    }
    for (let r = 0; r < kn(4); r++) line('fence', ri(0, W - 7), ri(0, H - 1), ri(4, 7), true, ri(1, 4));
    for (let r = 0; r < kn(3); r++) line('fence', ri(0, W - 1), ri(0, H - 7), ri(4, 7), false, ri(1, 4));
    for (let i = 0; i < kn(2); i++) compound(ri(2, W - 8), ri(2, H - 7), ri(4, 6), ri(4, 5), 'wall');
    scatter(['generator', 'generator', 'terminal'], kn(5));
    scatter(['barrel', 'barrel_toxic', 'crate', 'debris', 'tank_trap', 'scrap_pile'], kn(22));
    scatter(['antenna', 'lamp', 'sign', 'skeleton'], kn(7), 120);
  } else {
    // bunkier: wykuwamy pokoje i korytarze w litej skale
    block.fill(CellKind.HIGH);
    for (let i = 0; i < W * H; i++) floor[i] = rng() < 0.3 ? 'metal' : 'tiles';
    const rooms = [{ x: ex - (corner & 1 ? 1 : 0), y: ey - (corner & 2 ? 1 : 0), w: 5, h: 5 }];
    for (let t = 0; t < 200 && rooms.length < kn(8); t++) {
      const w = ri(4, 7);
      const h = ri(4, 6);
      const x = ri(1, W - w - 1);
      const y = ri(1, H - h - 1);
      if (rooms.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
      rooms.push({ x, y, w, h });
    }
    const carve = (x: number, y: number): void => {
      if (inb(x, y) && x > 0 && y > 0 && x < W - 1 && y < H - 1) {
        block[I(x, y)] = CellKind.FREE;
        if (floor[I(x, y)] === 'tiles' && rng() < 0.5) floor[I(x, y)] = 'concrete';
      }
    };
    for (const r of rooms) rect(r.x, r.y, r.w, r.h, carve);
    const cen = (r: { x: number; y: number; w: number; h: number }): GridPos => ({ gx: r.x + (r.w >> 1), gy: r.y + (r.h >> 1) });
    const order = rooms.slice().sort((a, b) => cen(a).gx + cen(a).gy - cen(b).gx - cen(b).gy);
    for (let i = 0; i + 1 < order.length; i++) {
      const a = cen(order[i]);
      const b = cen(order[i + 1]);
      let x = a.gx;
      let y = a.gy;
      while (x !== b.gx) {
        carve(x, y);
        carve(x, y + 1);
        x += Math.sign(b.gx - x);
      }
      while (y !== b.gy) {
        carve(x, y);
        carve(x + 1, y);
        y += Math.sign(b.gy - y);
      }
    }
    for (const r of rooms.slice(1)) {
      for (let k = 0; k < ri(2, 4); k++) {
        put(pick(['terminal', 'barrel', 'crate', 'generator', 'pillar', 'sandbags'] as const), ri(r.x, r.x + r.w - 1), ri(r.y, r.y + r.h - 1));
      }
      interiors.push(cen(r));
    }
    rect(ex, ey, 4, 4, (x, y) => {
      block[I(x, y)] = CellKind.FREE;
    });
  }

  // strefa wejścia zawsze wolna
  for (const c of entry.cells) block[I(c.gx, c.gy)] = CellKind.FREE;
  props = props.filter((p) => !entry.cells.some((c) => c.gx === p.gx && c.gy === p.gy));
  // dekoracje nie blokują
  const deco: MapProp[] = [];
  props = props.filter((p) => {
    if (!DECOR.has(p.type)) return true;
    block[I(p.gx, p.gy)] = CellKind.FREE;
    deco.push(p);
    return false;
  });
  // lite bloki ścian bunkra (do instancjonowania w widoku)
  if (biome === 'bunker') {
    const propAt = new Set(props.map((p) => I(p.gx, p.gy)));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (block[I(x, y)] !== CellKind.HIGH || propAt.has(I(x, y))) continue;
        let near = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(x + dx, y + dy) && block[I(x + dx, y + dy)] !== CellKind.HIGH) near = true;
        solids.push({ gx: x, gy: y, near });
      }
    }
  }

  // osiągalność (4 kierunki) od wejścia
  const dist4 = new Int16Array(W * H).fill(-1);
  const start = entry.cells[5];
  const q: [number, number][] = [[start.gx, start.gy]];
  dist4[I(start.gx, start.gy)] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const [x, y] = q[qi];
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (inb(nx, ny) && block[I(nx, ny)] === CellKind.FREE && dist4[I(nx, ny)] < 0) {
        dist4[I(nx, ny)] = dist4[I(x, y)] + 1;
        q.push([nx, ny]);
      }
    }
  }
  const reach: ReachCell[] = [];
  let maxD = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dd = dist4[I(x, y)];
      if (dd < 0) continue;
      reach.push({ gx: x, gy: y, d: dd });
      maxD = Math.max(maxD, dd);
    }
  }
  const used = new Set<number>();
  const takeCell = (pred: (c: ReachCell) => boolean): ReachCell | null => {
    const c = reach.filter((r) => !used.has(I(r.gx, r.gy)) && pred(r));
    if (!c.length) return null;
    const r = pick(c);
    used.add(I(r.gx, r.gy));
    return r;
  };

  // cel zlecenia: daleko od wejścia
  const objCell = takeCell((c) => c.d >= maxD * 0.75) ?? takeCell((c) => c.d >= maxD * 0.5) ?? takeCell(() => true);

  // grupy wrogów (po ~3 osoby, maks. 4 grupy; ostatnia przy celu, boss zawsze w niej)
  const ids = enemyIds.slice();
  const groups: EnemyGroupSpawn[] = [];
  const nG = Math.max(1, Math.min(4, Math.ceil(ids.length / 3)));
  const centers: ReachCell[] = [];
  const bossIdx = ids.findIndex(isBossId);
  for (let g = 0; g < nG; g++) {
    const minD = g === 0 && nG > 1 ? maxD * 0.3 : maxD * 0.45;
    let c: ReachCell | null;
    if (g === nG - 1 && objCell) c = { ...objCell };
    else c = takeCell((r) => r.d >= minD && centers.every((o) => Math.hypot(o.gx - r.gx, o.gy - r.gy) >= 6)) ?? takeCell((r) => r.d >= 8);
    if (!c) c = reach[reach.length - 1 - g * 3] ?? reach[0];
    centers.push(c);
    groups.push({ center: c, members: [], cells: [] });
  }
  ids.forEach((id, i) => groups[bossIdx >= 0 && id === ids[bossIdx] ? nG - 1 : i % nG].members.push(id));
  for (const g of groups) {
    const near = reach
      .filter((c) => Math.hypot(c.gx - g.center.gx, c.gy - g.center.gy) <= 3.2 && !used.has(I(c.gx, c.gy)) && !(objCell && c.gx === objCell.gx && c.gy === objCell.gy))
      .sort((a, b) => Math.hypot(a.gx - g.center.gx, a.gy - g.center.gy) - Math.hypot(b.gx - g.center.gx, b.gy - g.center.gy));
    for (let k = 0; k < g.members.length; k++) {
      const c = near[k] ?? near[0];
      if (c) {
        used.add(I(c.gx, c.gy));
        g.cells.push({ gx: c.gx, gy: c.gy });
      } else g.cells.push({ gx: g.center.gx, gy: g.center.gy });
    }
  }

  // skrzynie: najpierw wnętrza budynków/ogrodzeń
  const crates: GridPos[] = [];
  const nCr = 3 + ((spec.level ?? 1) > 2 ? 1 : 0);
  const crateSpot = (c: GridPos): boolean => DIRS4.filter(([dx, dy]) => inb(c.gx + dx, c.gy + dy) && block[I(c.gx + dx, c.gy + dy)] === CellKind.FREE).length >= 2;
  for (const it of interiors) {
    if (crates.length >= nCr - 1) break;
    const cc = reach.find((r) => r.gx === it.gx && r.gy === it.gy && !used.has(I(r.gx, r.gy)) && r.d > 6);
    if (cc) {
      used.add(I(cc.gx, cc.gy));
      crates.push({ gx: cc.gx, gy: cc.gy });
    }
  }
  while (crates.length < nCr) {
    const c = takeCell((r) => r.d >= 6 && crateSpot(r));
    if (!c) break;
    crates.push({ gx: c.gx, gy: c.gy });
  }
  for (const c of crates) block[I(c.gx, c.gy)] = CellKind.LOW;

  // znaleziska do odkrycia podczas eksploracji
  const FIND_KINDS: readonly FindKind[] = ['scrap', 'scrap', 'cache', 'medical', 'tech', 'food', 'ammo'];
  const finds: FindSpawn[] = [];
  const nFinds = kn(7) + ri(0, 3);
  for (let k = 0; k < nFinds; k++) {
    const c = takeCell((r) => r.d >= 4 && block[I(r.gx, r.gy)] === CellKind.FREE);
    if (!c) break;
    finds.push({ gx: c.gx, gy: c.gy, kind: pick(FIND_KINDS), hidden: rng() < 0.55 });
  }

  return {
    width: W, height: H, biome, grid: new TacticalGrid(W, H, block), floor, props, deco, decor, buildings, solids, entry, groups,
    crates, finds, objCell, reach, maxD, seed,
  };
}

/** Czy pole leży w strefie ewakuacji. */
export const inEntryZone = (e: EntryZone, p: GridPos): boolean => p.gx >= e.x0 && p.gx <= e.x1 && p.gy >= e.y0 && p.gy <= e.y1;
