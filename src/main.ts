import Phaser from 'phaser';
import { SoundManager } from './audio/SoundManager';
import { campaign, quickParty } from './core/campaign/session';
import { DebriefScene } from './scenes/DebriefScene';
import { FxScene } from './scenes/FxScene';
import { GameOverScene, VictoryScene } from './scenes/EndScenes';
import { HubScene } from './scenes/HubScene';
import { IntroScene } from './scenes/IntroScene';
import { LogoScene } from './scenes/LogoScene';
import { RecruitScene } from './scenes/RecruitScene';
import { TitleScene } from './scenes/TitleScene';
import { TravelScene } from './scenes/TravelScene';
import { UIScene } from './scenes/UIScene';
import { BASE_H, BASE_W, ZOOM } from './scenes/ui/Kit';
import { Settings } from './scenes/ui/Settings';
import { WorldScene } from './scenes/WorldScene';

// Kolejność jak w Oldgame/src/main.js: logo -> intro -> tytuł -> werbunek -> Przystań -> podróż -> misja -> podsumowanie.
// Skrót deweloperski (jak Oldgame/src/main.js): ?scene=<dowolna scena>; sceny kampanii dostają gotową drużynę (quickParty).
// WorldScene bez zlecenia = misja demonstracyjna; TravelScene: &contract=&event=; RecruitScene: &pick=0,1,2,3.
const SCENES = { LogoScene, IntroScene, TitleScene, RecruitScene, HubScene, TravelScene, WorldScene, DebriefScene, GameOverScene, VictoryScene } as const;
/** Sceny, które nie potrzebują kampanii. */
const NO_CAMPAIGN = ['LogoScene', 'IntroScene', 'TitleScene', 'RecruitScene', 'WorldScene'];
const wanted = new URLSearchParams(window.location.search).get('scene');
const first = wanted && wanted in SCENES ? (wanted as keyof typeof SCENES) : 'LogoScene';
if (import.meta.env.DEV && !NO_CAMPAIGN.includes(first) && !campaign.state.party.length) quickParty();
const rest = (Object.keys(SCENES) as (keyof typeof SCENES)[]).filter((k) => k !== first);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  // Siatka projektowa 480x270 renderowana w ZOOM-krotnej rozdzielczości (kamery mają zoom = ZOOM): gruby piksel, ostry tekst.
  width: BASE_W * ZOOM,
  height: BASE_H * ZOOM,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  // Profil Amiga: 50 klatek (PAL VBlank) - tyle, ile dostanie port na A1200 + PiStorm z miniGL.
  fps: Settings.startAmiga ? { target: 50, limit: 50 } : undefined,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // FxScene (efekty retro z Opcji) startuje sama i zawsze leży na wierzchu
  scene: [SCENES[first], ...rest.map((k) => SCENES[k]), UIScene, FxScene],
};

const game = new Phaser.Game(config);
// Płótno jest już w (prawie) natywnej rozdzielczości ekranu - resztę skalowania CSS wygładzamy zamiast "pikselować".
game.canvas.style.imageRendering = 'auto';
// Odblokowuje WebAudio przy pierwszym kliknięciu/klawiszu; sceny wołają SoundManager.sfx()/music()/ambience().
SoundManager.attach(game);
// Tylko w trybie deweloperskim: uchwyt do testów automatycznych / konsoli.
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
