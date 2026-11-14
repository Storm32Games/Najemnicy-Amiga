// Bus graph shared by live context and OfflineAudioContext tests.
import { makeImpulse } from './core.js';
export function createBuses(c, dest = c.destination) {
  const master = c.createGain();
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.22;
  master.connect(comp); comp.connect(dest);
  const mk = () => { const g = c.createGain(); g.connect(master); return g; };
  const sfx = mk(), music = mk(), amb = mk();
  const revIn = c.createGain(), conv = c.createConvolver(), revRet = c.createGain();
  conv.buffer = makeImpulse(c); revRet.gain.value = 0.55;
  revIn.connect(conv); conv.connect(revRet); revRet.connect(master);
  const sfxWet = c.createGain(), musicWet = c.createGain();
  sfxWet.connect(revIn); musicWet.connect(revIn);
  return { master, comp, sfx, music, amb, sfxWet, musicWet, revIn };
}
