export interface GridPos {
  gx: number;
  gy: number;
}

export class GridSystem {
  public readonly width: number;
  public readonly height: number;
  public readonly tileSize: number;
  private collisionMap: number[][]; // 0 = wolne, 1 = ściana/przeszkoda
  private opacityMap: number[][] | null = null; // 1 = zasłania widok; brak mapy = nieprzechodnie zasłania

  constructor(width: number, height: number, tileSize: number = 16) {
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;
    this.collisionMap = Array.from({ length: height }, () => Array(width).fill(0));
  }

  public setCollisionMap(map: number[][]): void {
    this.collisionMap = map;
  }

  /**
   * Osobna mapa przezroczystości (np. niska osłona blokuje ruch, ale nie wzrok).
   * Bez niej każde nieprzechodnie pole zasłania widok.
   */
  public setOpacityMap(map: number[][] | null): void {
    this.opacityMap = map;
  }

  /** Czy pole zasłania linię wzroku (poza mapą = tak). */
  public blocksSight(gx: number, gy: number): boolean {
    if (gx < 0 || gy < 0 || gx >= this.width || gy >= this.height) return true;
    return this.opacityMap ? this.opacityMap[gy][gx] !== 0 : this.collisionMap[gy][gx] !== 0;
  }

  public isWalkable(gx: number, gy: number): boolean {
    if (gx < 0 || gy < 0 || gx >= this.width || gy >= this.height) {
      return false;
    }
    return this.collisionMap[gy][gx] === 0;
  }

  public gridToWorld(gx: number, gy: number): { x: number; y: number } {
    return {
      x: gx * this.tileSize + Math.floor(this.tileSize / 2),
      y: gy * this.tileSize + Math.floor(this.tileSize / 2),
    };
  }

  public worldToGrid(x: number, y: number): GridPos {
    return {
      gx: Math.floor(x / this.tileSize),
      gy: Math.floor(y / this.tileSize),
    };
  }
}
