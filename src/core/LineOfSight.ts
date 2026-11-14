import { type GridPos, GridSystem } from './GridSystem';

/**
 * Linia wzroku na siatce oparta o algorytm Bresenhama.
 *
 * Zasady:
 * - pole startowe i docelowe nie zasłaniają widoku (dzięki temu ściana sama
 *   w sobie jest widoczna, ale nie widać nic za nią),
 * - każde pole pośrednie, które nie jest przechodnie, blokuje wzrok,
 * - przy kroku po przekątnej wzrok nie "przecieka" przez szczelinę między
 *   dwoma stykającymi się rogami ścian.
 */
export class LineOfSight {
  private grid: GridSystem;

  constructor(grid: GridSystem) {
    this.grid = grid;
  }

  /** Czy z pola `from` widać pole `to`. */
  public hasLineOfSight(from: GridPos, to: GridPos): boolean {
    if (!this.inBounds(from.gx, from.gy) || !this.inBounds(to.gx, to.gy)) return false;

    let x = from.gx;
    let y = from.gy;
    const dx = Math.abs(to.gx - x);
    const dy = -Math.abs(to.gy - y);
    const sx = x < to.gx ? 1 : -1;
    const sy = y < to.gy ? 1 : -1;
    let err = dx + dy;

    while (x !== to.gx || y !== to.gy) {
      const e2 = 2 * err;
      const stepX = e2 >= dy;
      const stepY = e2 <= dx;

      // Krok po przekątnej między dwiema ścianami = szczelina, przez którą nie widać.
      if (stepX && stepY && this.blocksSight(x + sx, y) && this.blocksSight(x, y + sy)) {
        return false;
      }

      if (stepX) {
        err += dy;
        x += sx;
      }
      if (stepY) {
        err += dx;
        y += sy;
      }

      if (x === to.gx && y === to.gy) return true;
      if (this.blocksSight(x, y)) return false;
    }

    return true; // from === to
  }

  /**
   * Zwraca mapę widoczności [gy][gx] dla obserwatora w `origin`.
   * `radius` (opcjonalnie) ogranicza zasięg wzroku (odległość euklidesowa w polach).
   */
  public computeVisibility(origin: GridPos, radius?: number): boolean[][] {
    const r2 = radius !== undefined ? radius * radius : Infinity;
    const visible: boolean[][] = [];

    for (let gy = 0; gy < this.grid.height; gy++) {
      const row: boolean[] = [];
      for (let gx = 0; gx < this.grid.width; gx++) {
        const ddx = gx - origin.gx;
        const ddy = gy - origin.gy;
        row.push(ddx * ddx + ddy * ddy <= r2 && this.hasLineOfSight(origin, { gx, gy }));
      }
      visible.push(row);
    }

    // Bresenham bywa niesymetryczny i "ociera się" o ściany, przez co część ścian
    // na krawędzi pola widzenia wychodzi ciemna. Ściana jest widoczna, jeśli
    // sąsiaduje (8 kierunków) z widoczną podłogą.
    for (let gy = 0; gy < this.grid.height; gy++) {
      for (let gx = 0; gx < this.grid.width; gx++) {
        if (visible[gy][gx] || !this.blocksSight(gx, gy)) continue;
        const ddx = gx - origin.gx;
        const ddy = gy - origin.gy;
        if (ddx * ddx + ddy * ddy > r2) continue;
        visible[gy][gx] = this.hasVisibleFloorNeighbour(visible, gx, gy);
      }
    }

    return visible;
  }

  private hasVisibleFloorNeighbour(visible: boolean[][], gx: number, gy: number): boolean {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = gx + ox;
        const ny = gy + oy;
        if ((ox || oy) && this.inBounds(nx, ny) && !this.blocksSight(nx, ny) && visible[ny][nx]) {
          return true;
        }
      }
    }
    return false;
  }

  private inBounds(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.grid.width && gy < this.grid.height;
  }

  private blocksSight(gx: number, gy: number): boolean {
    // Poza mapą lub wysoka przeszkoda (mapa przezroczystości z GridSystem).
    return this.grid.blocksSight(gx, gy);
  }
}
