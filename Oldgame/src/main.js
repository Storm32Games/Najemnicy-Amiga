import { Engine } from './core/engine.js';
import { UI } from './core/ui.js';
import { Game } from './core/game.js';
import { Settings } from './core/settings.js';
import { Audio } from './audio/audio.js';
import { createCharacter } from './rules/index.js';
import { RECRUITS } from './data/recruits.js';
import { generateContracts } from './data/contracts.js';

import logo from './scenes/logo.js';
import intro from './scenes/intro.js';
import title from './scenes/title.js';
import recruit from './scenes/recruit.js';
import hub from './scenes/hub.js';
import worldmap from './scenes/worldmap.js';
import debrief from './scenes/debrief.js';
import gameover from './scenes/gameover.js';
import victory from './scenes/victory.js';
import mission from './scenes/mission.js';

Engine.init();
UI.init();
Settings.init();
window.Settings = Settings; window.Engine = Engine; // testing / console
UI.onClickSound = () => Audio.sfx('click');
UI.onHoverSound = () => Audio.sfx('hover');

for (const [n, s] of Object.entries({ logo, intro, title, recruit, hub, worldmap, debrief, gameover, victory, mission })) Game.register(n, s);

// Audio needs a user gesture to start.
const unlock = () => { Audio.init(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

/** Dev helper: a ready party of the first 4 recruits (used by ?scene=... shortcuts and tests). */
export function quickParty() {
  Game.newGame();
  Game.state.party = RECRUITS.slice(0, 4).map(r => Object.assign(createCharacter(r), { recruitId: r.id }));
  Game.state.contracts = generateContracts(Game.state);
}
Game.quickParty = quickParty;

const start = Game.params.get('scene');
if (start && start !== 'logo') {
  if (!['intro', 'title', 'recruit'].includes(start)) quickParty();
  const params = {};
  for (const [k, v] of Game.params) if (k !== 'scene') params[k] = v;
  if (start === 'mission' && !params.contract) params.contract = Game.state.contracts[0]?.id;
  Game.goto(start, params);
} else {
  Game.goto('logo');
}
Engine.start((dt, t) => Game.tick(dt, t));
