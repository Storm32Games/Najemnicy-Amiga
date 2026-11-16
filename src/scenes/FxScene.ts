import Phaser from 'phaser';
import { VH, VW, VX, VY, ZOOM, ZOOM_EVENT } from './ui/Kit';
import { Settings, type SettingsValues } from './ui/Settings';

// Efekty retro nad całą grą (odpowiednik przebiegu post-process z Oldgame/src/gfx/post.js):
// linie skanowania, ziarno filmu i raster Bayera. Scena stoi zawsze na wierzchu, nie przyjmuje kliknięć,
// a włącza/wyłącza się w Opcjach (Settings.scanlines / grain / dither).
// Rysuje w pikselach płótna (kamera bez zoomu), ale wzory leżą na siatce pikseli projektowych (obszar gry od VX, VY):
// ziarno i raster mają rozmiar piksela projektowego, a linia skanowania wypada na dole każdego wiersza pikseli.
// Drobne (1 piksel płótna) ziarno i linie co 6 px przy pikselu 4 px rozmywały kontury postaci.


export class FxScene extends Phaser.Scene {
  private scan!: Phaser.GameObjects.TileSprite;
  private grain!: Phaser.GameObjects.TileSprite;
  private dither!: Phaser.GameObjects.TileSprite;
  private off: (() => void) | null = null;
  private acc = 0;

  constructor() {
    super({ key: 'FxScene', active: true });
  }

  create(): void {
    this.input.enabled = false;
    this.makeTextures();
    this.scan = this.add.tileSprite(VX, VY, VW, VH, 'fx_scan').setOrigin(0);
    this.grain = this.add.tileSprite(VX, VY, VW, VH, 'fx_grain').setOrigin(0).setBlendMode(Phaser.BlendModes.SCREEN).setTileScale(ZOOM, ZOOM);
    this.dither = this.add.tileSprite(VX, VY, VW, VH, 'fx_bayer').setOrigin(0).setTileScale(ZOOM, ZOOM);
    // zmiana rozdzielczości na żywo (Opcje): warstwy w pikselach płótna dostają nowy rozmiar
    this.events.on(ZOOM_EVENT, () => {
      if (this.textures.exists('fx_scan')) this.textures.remove('fx_scan');
      this.makeTextures();
      this.scan.setTexture('fx_scan').setPosition(VX, VY).setSize(VW, VH);
      this.grain.setPosition(VX, VY).setSize(VW, VH).setTileScale(ZOOM, ZOOM);
      this.dither.setPosition(VX, VY).setSize(VW, VH).setTileScale(ZOOM, ZOOM);
    });
    this.apply(Settings.values);
    this.off = Settings.onChange((v) => this.apply(v));
    // nowe sceny startujące później w tej klatce lądowałyby nad nami - pilnujemy wierzchu
    this.game.events.on(Phaser.Core.Events.POST_STEP, this.keepOnTop, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.off?.();
      this.game.events.off(Phaser.Core.Events.POST_STEP, this.keepOnTop, this);
    });
  }

  private keepOnTop(): void {
    const mgr = this.game.scene;
    const scenes = mgr.getScenes(false);
    if (scenes[scenes.length - 1] !== this) mgr.bringToTop('FxScene');
  }

  private apply(v: SettingsValues): void {
    // Profil Amiga: trzy pełnoekranowe warstwy z mieszaniem alfa to ~3x480x270 pikseli blendingu na klatkę -
    // miniGL nie ma shaderów ani render-to-texture, a wypełnianie jest najdroższe. Na docelowym sprzęcie ich nie ma.
    const amiga = Settings.startAmiga;
    this.scan.setVisible(v.scanlines && !amiga);
    this.grain.setVisible(v.grain && !amiga);
    this.dither.setVisible(v.dither && !amiga);
  }

  private makeTextures(): void {
    if (!this.textures.exists('fx_scan')) {
      // dolna ćwiartka każdego wiersza pikseli projektowych przyciemniona (krok = piksel projektowy, przy
      // ułamkowym ZOOM zaokrąglony); wcześniej co 1.5 piksela projektowego - linie cięły piksele postaci w poprzek
      const step = Math.max(2, Math.round(ZOOM)), line = Math.max(1, Math.round(step / 4));
      const g = this.make.graphics({}, false);
      g.fillStyle(0x000000, 0.13).fillRect(0, step - line, 4, line);
      g.generateTexture('fx_scan', 4, step);
      g.destroy();
    }
    if (!this.textures.exists('fx_grain')) {
      const n = 128;
      const c = this.textures.createCanvas('fx_grain', n, n)!;
      const ctx = c.getContext();
      const img = ctx.createImageData(n, n);
      for (let i = 0; i < n * n; i++) {
        const v = Math.random() * 255;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = Math.random() < 0.5 ? 14 : 0;
      }
      ctx.putImageData(img, 0, 0);
      c.refresh();
      c.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    if (!this.textures.exists('fx_bayer')) {
      // macierz Bayera 4x4: delikatny raster w pikselach projektowych (jak dithering palety w post.js)
      const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      const c = this.textures.createCanvas('fx_bayer', 4, 4)!;
      const ctx = c.getContext();
      for (let i = 0; i < 16; i++) {
        const a = (B[i] / 15 - 0.5) * 0.09;
        ctx.fillStyle = a > 0 ? `rgba(255,236,200,${a.toFixed(3)})` : `rgba(0,0,0,${(-a).toFixed(3)})`;
        ctx.fillRect(i % 4, Math.floor(i / 4), 1, 1);
      }
      c.refresh();
      c.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }

  update(_t: number, delta: number): void {
    if (!this.grain.visible) return;
    // ziarno migocze ~24 razy na sekundę
    this.acc += delta;
    if (this.acc < 42) return;
    this.acc = 0;
    this.grain.setTilePosition(Math.floor(Math.random() * 128), Math.floor(Math.random() * 128));
  }
}
