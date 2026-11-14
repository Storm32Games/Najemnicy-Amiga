// Grid helpers: pathfinding (Dijkstra, diagonal 1.5), line of sight + cover.
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class Grid {
  constructor(W, H, block) { this.W = W; this.H = H; this.block = block; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  kind(x, y) { return this.inb(x, y) ? this.block[y * this.W + x] : 2; }
  free(x, y) { return this.kind(x, y) === 0; }
  /** Dijkstra from (sx,sy). passFn(x,y) false = cannot traverse (enemy bodies). Returns {cost, prev}. */
  search(sx, sy, maxCost, passFn) {
    const { W, H } = this; const N = W * H;
    const cost = new Float32Array(N).fill(1e9), prev = new Int32Array(N).fill(-1);
    const open = [[0, sx, sy]]; cost[sy * W + sx] = 0;
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [c, x, y] = open.splice(bi, 1)[0];
      if (c > cost[y * W + x]) continue;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy; if (!this.free(nx, ny)) continue;
        if (passFn && !passFn(nx, ny)) continue;
        if (dx && dy && (!this.free(x + dx, y) || !this.free(x, y + dy))) continue;
        const nc = c + (dx && dy ? 1.5 : 1); if (nc > maxCost) continue;
        const ni = ny * W + nx; if (nc < cost[ni]) { cost[ni] = nc; prev[ni] = y * W + x; open.push([nc, nx, ny]); }
      }
    }
    return { cost, prev, W };
  }
  pathFrom(res, tx, ty) {
    const W = this.W; let i = ty * W + tx; if (res.cost[i] >= 1e9) return null;
    const p = []; while (res.prev[i] >= 0) { p.push({ x: i % W, y: (i / W) | 0 }); i = res.prev[i]; }
    return p.reverse();
  }
  _clear(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, n = Math.max(2, Math.ceil(Math.hypot(dx, dy) * 3));
    let cover = false, last = -1;
    for (let s = 1; s < n; s++) {
      const t = s / n, x = Math.round(ax + dx * t), y = Math.round(ay + dy * t);
      const key = y * 64 + x; if (key === last || (x === ax && y === ay) || (x === bx && y === by)) continue; last = key;
      const k = this.kind(x, y);
      if (k === 2) return { clear: false, cover: false };
      if (k === 1 && Math.max(Math.abs(x - bx), Math.abs(y - by)) <= 1) cover = true;
    }
    return { clear: true, cover };
  }
  /** LOS for attacks a→b. cover = low obstacle adjacent to target on the line. */
  los(a, b) { const r = this._clear(a.x, a.y, b.x, b.y); if (r.clear) return r; const r2 = this._clear(b.x, b.y, a.x, a.y); return { clear: r2.clear, cover: false }; }
  visible(a, r) {
    const out = []; for (let y = a.y - r; y <= a.y + r; y++) for (let x = a.x - r; x <= a.x + r; x++) {
      if (!this.inb(x, y) || Math.hypot(x - a.x, y - a.y) > r + 0.3) continue;
      if (this._clear(a.x, a.y, x, y).clear || this._clear(x, y, a.x, a.y).clear) out.push(y * this.W + x);
    } return out;
  }
}
