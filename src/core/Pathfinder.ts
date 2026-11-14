import { type GridPos, GridSystem } from './GridSystem';

interface Node {
  gx: number;
  gy: number;
  g: number;
  h: number;
  f: number;
  parent: Node | null;
}

export class Pathfinder {
  private grid: GridSystem;

  constructor(grid: GridSystem) {
    this.grid = grid;
  }

  /**
   * A* po 4 kierunkach. `isBlocked` (opcjonalnie) oznacza dodatkowe zajęte pola,
   * np. pozycje innych jednostek.
   */
  public findPath(start: GridPos, end: GridPos, isBlocked?: (gx: number, gy: number) => boolean): GridPos[] {
    const passable = (gx: number, gy: number) => this.grid.isWalkable(gx, gy) && !isBlocked?.(gx, gy);
    if (!passable(end.gx, end.gy)) return [];

    const openList: Node[] = [];
    const closedSet = new Set<string>();
    const key = (x: number, y: number) => `${x},${y}`;

    openList.push({
      gx: start.gx,
      gy: start.gy,
      g: 0,
      h: Math.abs(end.gx - start.gx) + Math.abs(end.gy - start.gy),
      f: 0,
      parent: null,
    });

    while (openList.length > 0) {
      openList.sort((a, b) => a.f - b.f);
      const current = openList.shift()!;

      if (current.gx === end.gx && current.gy === end.gy) {
        const path: GridPos[] = [];
        let curr: Node | null = current;
        while (curr && curr.parent) {
          path.unshift({ gx: curr.gx, gy: curr.gy });
          curr = curr.parent;
        }
        return path;
      }

      closedSet.add(key(current.gx, current.gy));

      const neighbors = [
        { gx: current.gx + 1, gy: current.gy },
        { gx: current.gx - 1, gy: current.gy },
        { gx: current.gx, gy: current.gy + 1 },
        { gx: current.gx, gy: current.gy - 1 },
      ];

      for (const next of neighbors) {
        if (closedSet.has(key(next.gx, next.gy)) || !passable(next.gx, next.gy)) {
          continue;
        }

        const g = current.g + 1;
        const h = Math.abs(end.gx - next.gx) + Math.abs(end.gy - next.gy);
        const existing = openList.find((n) => n.gx === next.gx && n.gy === next.gy);

        if (!existing) {
          openList.push({ gx: next.gx, gy: next.gy, g, h, f: g + h, parent: current });
        } else if (g < existing.g) {
          existing.g = g;
          existing.f = g + existing.h;
          existing.parent = current;
        }
      }
    }

    return [];
  }
}
