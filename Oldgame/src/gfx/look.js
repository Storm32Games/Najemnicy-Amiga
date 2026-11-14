// Derive a deterministic visual description (body plan, colors, weapon) from any desc.
import { hash, rng, shade, mix } from './util.js';

const norm = (s) => String(s || '').toLowerCase().replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź|ż/g, 'z');
const has = (s, ...keys) => keys.some(k => s.includes(k));
// token-start match (avoids 'rat' in 'pirate')
const tok = (s, ...keys) => s.split(/[^a-z]+/).some(t => keys.some(k => t.startsWith(k)));

export const CLASS_DEFAULTS = {
  soldier: { cloth: '#5d6a3a', accent: '#c9a468', weapon: 'rifle', head: 'helmet', bw: 'medium' },
  scout: { cloth: '#7a6a4a', accent: '#8fd14f', weapon: 'longgun', head: 'hood', bw: 'light' },
  medic: { cloth: '#d8d2c0', accent: '#c43d2f', weapon: 'pistol', head: 'headband', bw: 'medium' },
  techie: { cloth: '#46687a', accent: '#f2c03b', weapon: 'smg', head: 'goggles', bw: 'light' },
  scavenger: { cloth: '#4a3a2a', accent: '#b4532a', weapon: 'knife', head: 'hood', bw: 'light' },
  brute: { cloth: '#6a3a2a', accent: '#7f9aa8', weapon: 'sledge', head: 'none', bw: 'heavy' },
};
const SKINS = ['#e0ac84', '#c68a62', '#a56b46', '#7a4a30', '#f0c8a0', '#d49a74'];
const HAIRS = ['#1c1410', '#3a2414', '#6a4524', '#a8793a', '#2a2a30', '#8a2a1a', '#c9b48a'];

export function weaponKind(str) {
  const s = norm(str);
  if (!s) return null;
  if (has(s, 'laser', 'plazm', 'plasma', 'lasgun', 'beam')) return 'laser';
  if (has(s, 'flame', 'miotacz', 'plomien', 'burner')) return 'flamer';
  if (has(s, 'sniper', 'snajper', 'scope', 'long', 'sztucer')) return 'longgun';
  if (has(s, 'shotgun', 'strzelb', 'dubelt')) return 'shotgun';
  if (has(s, 'smg', 'uzi', 'maszynow', 'machinegun', 'subm')) return 'smg';
  if (has(s, 'rifle', 'karabin', 'ak47', 'ak_', 'assault')) return 'rifle';
  if (has(s, 'pistol', 'rewolw', 'revolver', 'handgun', 'glock', 'gun')) return 'pistol';
  if (has(s, 'bow', 'luk', 'kusz')) return 'bow';
  if (has(s, 'scythe', 'kosa')) return 'scythe';
  if (has(s, 'machete', 'maczet', 'sword', 'miecz', 'blade', 'katan', 'tasak')) return 'machete';
  if (has(s, 'knife', 'noz', 'dagger', 'shiv', 'sztylet')) return 'knife';
  if (has(s, 'sledge', 'hammer', 'mlot', 'maul')) return 'sledge';
  if (has(s, 'axe', 'topor', 'siekier')) return 'axe';
  if (has(s, 'pipe', 'rura', 'club', 'palka', 'bat', 'kij', 'wrench', 'klucz', 'crowbar', 'lom')) return 'pipe';
  if (has(s, 'fist', 'pies', 'unarm', 'knuck')) return 'none';
  return null;
}
export const isGun = (k) => ['rifle', 'longgun', 'shotgun', 'smg', 'pistol', 'laser'].includes(k);

export function analyze(desc = {}) {
  const tid = norm(desc.templateId || (desc.isEnemy ? desc.id : '') || '');
  const enemy = !!(desc.isEnemy || desc.templateId) && !desc.classId;
  const label = tid + ' ' + norm(desc.faction) + ' ' + (enemy ? norm(desc.name) : '');
  const L = desc.look || {};
  // recruits: seed from the stable recruitId only, so renaming (or a new uid after a restart) never changes the look
  const seed = hash((desc.recruitId ? 'r:' + desc.recruitId + '|' : (desc.id || '') + '|') + (tid || desc.classId || '') + '|' + (desc.recruitId ? '' : (desc.name || '')) + '|' + JSON.stringify(L));
  const R = rng(seed);
  const A = { enemy, seed, tid, kind: 'human', size: 1, scale: 1, tags: [], R };
  const ancestry = norm(desc.ancestry);

  if (enemy) {
    const is = (...k) => tok(label, ...k); const isX = (...k) => label.split(/[^a-z]+/).some(t => k.includes(t));
    A.name = desc.name;
    if (is('kostuch', 'reaper') || has(label, 'kostucha')) { A.boss = true; A.role = 'kostucha'; }
    else if (is('boss', 'warlord') || has(label, 'boss')) { A.boss = true; A.role = 'boss'; }
    if (!A.boss) {
      if (is('turret', 'wiez', 'sentry', 'automat', 'emplacement')) A.kind = 'turret';
      else if (is('drone', 'dron', 'quad', 'hover')) A.kind = 'drone';
      else if (is('robot', 'bot', 'mech', 'android', 'golem', 'machine', 'maszyn')) { A.kind = 'human'; A.machine = true; }
      else if (is('spider', 'pajak', 'scorp', 'skorp', 'bug', 'insect', 'robal', 'roach', 'karalu', 'chrzas', 'beetle', 'scarab', 'ant', 'mrow', 'swarm', 'roj', 'wasp', 'osa', 'stonog', 'larw', 'maggot', 'cockro', 'mite', 'tick', 'kleszcz', 'locust', 'szarancz')) {
        A.kind = 'insect'; A.variant = is('spider', 'pajak') ? 'spider' : is('scorp', 'skorp') ? 'scorpion' : is('swarm', 'roj', 'locust', 'szarancz', 'maggot', 'larw') ? 'swarm' : 'beetle';
      }
      else if (isX('rat', 'psy') || is('dog', 'pies', 'wolf', 'wilk', 'hound', 'kojot', 'coyote', 'szczur', 'beast', 'bestia', 'cat', 'kot', 'boar', 'dzik', 'bear', 'nied', 'lizard', 'jaszcz', 'mole', 'kret', 'hyena', 'hiena', 'mastif', 'cerber', 'zwierz')) {
        A.kind = 'beast'; A.variant = (isX('rat') || is('szczur')) ? 'rat' : is('wolf', 'wilk', 'hyena', 'hiena', 'kojot', 'coyote') ? 'wolf' : is('boar', 'dzik', 'bear', 'nied') ? 'boar' : 'dog';
      }
      else if (is('mutant', 'ghoul', 'zombie', 'zombi', 'goul', 'irrad', 'napromien', 'swiec', 'glow', 'abomin', 'creeper', 'hulk', 'freak', 'dziwol')) { A.mutant = true; }
    }
    A.mutant = A.mutant || false;
    if (A.kind === 'human' || A.boss) {
      A.raider = !A.mutant && !A.machine;
      if (A.boss) A.role = A.role || 'boss';
      else if (is('shooter', 'strzel', 'sniper', 'gunner', 'marksman', 'rifle', 'ranged')) A.role = 'shooter';
      else if (is('burner', 'podpal', 'flame', 'plomien', 'piroman')) A.role = 'burner';
      else if (is('psycho', 'szalen', 'berserk', 'maniak', 'fanat', 'junkie', 'ćpun')) A.role = 'psycho';
      else if (is('chief', 'wodz', 'szef', 'przywodc', 'captain', 'kapitan', 'lider', 'leader', 'boss', 'warlord')) { A.role = 'chief'; }
      else if (is('thug', 'bandyt', 'brute', 'bruiser', 'goryl', 'zbir', 'zbój', 'zbir')) A.role = 'thug';
      else A.role = ['thug', 'shooter', 'psycho'][seed % 3];
    }
  } else {
    let cid = norm(desc.classId); cid = ({ gunslinger: 'scout', champion: 'soldier', alchemist: 'medic', herald: 'scavenger', monk: 'brute', hacker: 'techie' })[cid] || cid;   // new classes wear the closest existing outfit (colours come from the recruit's look)
    A.cls = Object.keys(CLASS_DEFAULTS).find(k => cid.includes(k)) || (has(cid, 'zolnierz') ? 'soldier' : has(cid, 'zwiad') ? 'scout' : has(cid, 'medyk', 'medic', 'doc') ? 'medic' : has(cid, 'tech', 'inz', 'engin') ? 'techie' : has(cid, 'szczur', 'szabr', 'rogue', 'thief') ? 'scavenger' : has(cid, 'brutal', 'barb', 'tank') ? 'brute' : Object.keys(CLASS_DEFAULTS)[seed % 6]);
    A.role = A.cls;
  }

  // ---- palette / body ----
  const cd = CLASS_DEFAULTS[A.cls] || {};
  let skin = L.skin || SKINS[(seed >>> 3) % SKINS.length];
  const mutantAnc = has(ancestry, 'mutant');
  A.mutation = !!L.mutation || mutantAnc || A.mutant;
  A.cyber = !!L.cyber || has(ancestry, 'cyborg', 'cyber');
  A.nomad = has(ancestry, 'nomad', 'pustk', 'wasteland');
  if (A.mutant) skin = ['#8fb36a', '#a6b86a', '#7aa08a', '#9aa86a'][seed % 4];
  else if (mutantAnc && !L.skin) skin = ['#a9c27a', '#8fbf9a', '#c4b87a'][seed % 3];
  A.skin = skin;
  A.hair = L.hair || HAIRS[(seed >>> 5) % HAIRS.length];
  A.hairStyle = L.hairStyle != null ? L.hairStyle | 0 : (seed >>> 7) % 6;
  A.bw = L.body || cd.bw || 'medium';
  let cloth = L.cloth || cd.cloth, accent = L.accent || cd.accent;
  if (A.raider || (enemy && A.kind === 'human')) {
    const cl = ['#7a5a3a', '#8a3a24', '#5f6a3f', '#6a4a62', '#9a7a42', '#42607a'], ac = ['#c43d2f', '#f2a93b', '#8fd14f', '#b4532a', '#d8d2c0'];
    cloth = cloth || cl[(seed >>> 2) % cl.length]; accent = accent || ac[(seed >>> 4) % ac.length];
    if (A.role === 'chief') A.bw = 'heavy'; else if (A.role === 'thug') A.bw = 'heavy'; else if (A.role === 'shooter') A.bw = 'medium'; else A.bw = 'light';
    if (A.role === 'psycho') A.bw = 'medium';
  }
  if (A.mutant) { cloth = '#4a4238'; accent = '#7aa23a'; A.bw = 'heavy'; }
  if (A.machine) { cloth = '#6a727a'; accent = '#e0402a'; A.bw = 'medium'; }
  if (A.boss) { cloth = '#4a1410'; accent = '#c43d2f'; A.bw = 'heavy'; A.scale = 1.32; }
  A.cloth = cloth || '#6b5a3a'; A.accent = accent || '#b4532a';
  A.cloth2 = shade(A.cloth, 0.6);
  A.pants = A.cls === 'medic' ? '#4a4a52' : mix(shade(A.cloth, 0.55), '#2a2420', 0.4);
  A.boot = '#2a2018';
  A.mask = !!L.mask; A.head = cd.head || 'none';
  if (A.raider) { A.head = ['none', 'mask', 'none', 'gas'][(seed >>> 6) % 4]; if (A.role === 'psycho') A.head = 'mask'; if (A.role === 'chief') A.head = 'cap'; if (A.role === 'burner') A.head = 'gas'; if (A.role === 'shooter' && A.head === 'mask') A.head = 'none'; A.maskStyle = (seed >>> 9) & 1 ? 'skull' : 'hockey'; if (A.role === 'psycho') A.hairStyle = 2; }
  if (A.boss) { A.head = 'reaper'; A.maskStyle = 'skull'; }
  if (A.machine) A.head = 'machine';
  if (A.mask && !enemy) A.head = 'gas';
  if (A.nomad && A.head === 'none') A.head = 'goggles';

  // ---- weapon ----
  let w = null;
  const eq = desc.equipment && desc.equipment.weapon;
  if (eq) w = weaponKind(typeof eq === 'string' ? eq : (eq.id || eq.name || eq.icon));
  if (!w && desc.weapon) w = weaponKind(typeof desc.weapon === 'string' ? desc.weapon : desc.weapon.id);
  if (!w && !enemy) w = cd.weapon;
  if (!w && enemy && A.kind === 'human') {
    w = A.boss ? 'scythe' : A.mutant ? 'none' : A.machine ? 'smg' : ({ shooter: 'rifle', psycho: 'axe', chief: 'shotgun', thug: 'pipe', burner: 'flamer' })[A.role] || 'pipe';
    const att = desc.attacks && desc.attacks[0]; if (att) { const k = weaponKind((att.name || '') + ' ' + (att.sfx || '')); if (k && !A.boss) w = k; }
  }
  A.weapon = w || 'none';
  A.hunch = !!A.mutant;
  A.size = A.size || 1;
  A.mutSeed = (L.mut | 0) || 0;
  A.key = [A.mutSeed, A.kind, A.variant, A.cls, A.role, A.mutant, A.machine, A.boss, A.skin, A.hair, A.hairStyle, A.cloth, A.accent, A.bw, A.head, A.maskStyle, A.cyber, A.mutation, A.weapon, A.nomad, enemy].join('|');
  return A;
}
