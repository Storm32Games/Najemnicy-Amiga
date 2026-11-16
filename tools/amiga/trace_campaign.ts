// Ślad referencyjny kampanii (TS) -> amiga/data/traces/campaign.txt. Ten sam scenariusz: amiga/tests/trace_campaign.c.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ITEMS, RECRUITS, STORY_CONTRACTS, applyDamage, applyMissionResult, buy, buyPrice, campaignPartyLevel, healAtClinic, healCost, hireCost, hireRecruit,
  makeRng, newItem, refreshBoard, restDay, resolveEventChoice, rollTravelEvent, sell, sellPrice, shopStock, startCampaign, storyUnlocked, tavernRecruits,
  type CampaignState, type Contract, type ItemId, type MissionResult,
} from '../../src/core/index.ts';
import { CONTRACT_TYPES, GIVERS } from '../../src/core/campaign/contracts.ts';
import { faunaAttackEvent } from '../../src/core/campaign/events.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out: string[] = [];
const P = (s: string): void => {
  out.push(s);
};

// ---- Number.toString(36)
{
  const r = makeRng('radix');
  const vals = [0.5, 0.1, 1 / 3, 0.999999999999, 1e-10, 0.25, 0.75, 2 / 3];
  for (let i = 0; i < 3000; i++) vals.push(r());
  for (const v of vals) P(`radix ${v.toString(36)}`);
}

function contractLine(c: Contract): string {
  const T = (CONTRACT_TYPES as Record<string, { titles: readonly string[]; descs: readonly string[] }>)[c.type];
  const t = c.story ? STORY_CONTRACTS.findIndex((s) => s.id === c.id) : T.titles.indexOf(c.title);
  const g = c.story ? -1 : GIVERS[c.faction].indexOf(c.giver);
  const d = c.story ? -1 : T.descs.indexOf(c.desc);
  const rw = c.reward;
  return `c ${c.id} ${c.story ? 1 : 0} ${c.type} ${c.level} ${c.biome} ${c.mood} ${c.faction} t=${t} g=${g} d=${d} e=${c.enemies.join(',')} obj=${c.objective.itemId ?? '-'} ` +
    `r=${rw.scrap}/${rw.xp}/${rw.items.join(',')}/${rw.rep.survivors ?? 0},${rw.rep.nomads ?? 0} days=${c.travelDays}`;
}
function stateLines(st: CampaignState): void {
  P(`st day=${st.day} scrap=${st.scrap} rep=${st.rep.survivors || 0},${st.rep.nomads || 0} story=${st.story} done=${st.completed.length} plv=${campaignPartyLevel(st)} unlocked=${storyUnlocked(st) ? 1 : 0} victory=${st.flags.victory ? 1 : 0}`);
  P(`party ${st.party.map((c) => `${c.recruitId}:${c.level}:${c.xp}:${c.hp}/${c.maxHp}`).join(' ')}`);
  P(`stash ${st.stash.map((i) => `${i.id}:${i.qty}`).join(',')}`);
  P(`fallen ${(st.flags.fallenIds ?? []).join(',')}`);
  for (const c of st.contracts) P(contractLine(c));
}

const RESULTS = ['success', 'retreat', 'fail'] as const;
for (let s = 0; s < 6; s++) {
  const rng = makeRng(`camp:${s}`);
  const st = startCampaign([0, 4, 8, 12].map((i) => RECRUITS[(i + s) % 16]), rng);
  P(`campaign ${s}`);
  stateLines(st);
  for (let step = 0; step < 8; step++) {
    if (!st.party.length) break;
    const ci = step % st.contracts.length;
    const contract = st.contracts[ci];
    P(`day ${step} contract ${contract.id}`);
    const ev = rollTravelEvent(rng);
    if (ev) {
      const choice = ev.choices[step % ev.choices.length];
      const r = resolveEventChoice(st, contract, choice, rng);
      P(`ev ${ev.id} ${step % ev.choices.length} deg=${r.degree} who=${r.who?.recruitId ?? '-'} chk=${r.check ? `${r.check.total}/${r.check.dc}` : '-'}`);
    }
    if (step % 3 === 0) {
      const fe = faunaAttackEvent('x');
      const choice = fe.choices[step % 3];
      const r = resolveEventChoice(st, contract, choice, rng);
      P(`fauna ${step % 3} deg=${r.degree} who=${r.who?.recruitId ?? '-'}`);
    }
    stateLines(st);
    const result = RESULTS[(step + s) % 3];
    const casualties: string[] = [];
    if (step === 5 && st.party.length > 1) {
      const victim = st.party[st.party.length - 1];
      applyDamage(victim, victim.hp + 50, 'P');
      victim.conditions.dead = 1;
      casualties.push(victim.name);
    }
    if (step === 2) st.party[0].stolenScrap = 9;
    const mr: MissionResult = {
      contractId: contract.id, result, xp: 40 * step + 20, scrap: 7 * step + 3, casualties,
      loot: [newItem('bandage'), newItem('circuit'), newItem((step % 2 ? 'stimpak' : 'scrap_metal') as ItemId)],
    };
    const sum = applyMissionResult(st, mr, contract, rng);
    P(`debrief ${result} scrap=${sum.scrap} stolen=${sum.stolen} xp=${sum.xp} items=${sum.items.join(',')} rep=${sum.rep.survivors ?? 0},${sum.rep.nomads ?? 0} fallen=${sum.fallen.length} gained=${sum.members.map((m) => m.levelsGained).join(',')} story=${sum.story ? 1 : 0} win=${sum.win ? 1 : 0} tpk=${sum.tpk ? 1 : 0}`);
    const plv = campaignPartyLevel(st);
    const stock = shopStock(st, plv);
    P(`shop ${stock.join(',')}`);
    P(`prices ${stock.map((id) => `${buyPrice(id, st)}/${sellPrice(id, st)}`).join(',')}`);
    for (const id of stock.slice(0, 2)) P(`buy ${id} ${buy(st, id).ok ? 1 : 0}`);
    if (st.stash.length) P(`sell ${st.stash[0].id} ${sell(st, st.stash[0], st.stash)}`);
    if (st.party.length) {
      applyDamage(st.party[0], 5, 'S');
      P(`clinic ${healCost(st.party[0])} ${healAtClinic(st, st.party[0]) ? 1 : 0}`);
    }
    restDay(st, rng);
    if (st.party.length < 4) {
      const list = tavernRecruits(st);
      P(`tavern ${list.map((r) => r.id).join(',')} cost=${hireCost(st)}`);
      if (list.length) P(`hire ${list[0].id} ${hireRecruit(st, list[0], rng).ok ? 1 : 0}`);
    }
    stateLines(st);
  }
}
// wątek fabularny: odblokowanie, przycięta eskorta, ukończenie, zwycięstwo
{
  const rng = makeRng('story');
  const st = startCampaign([0, 1, 2, 3].map((i) => RECRUITS[i]), rng);
  for (let k = 0; k < 3; k++) {
    while (st.completed.length < [2, 4, 7][k]) st.completed.push('x' + st.completed.length);
    st.rep.survivors = 5 * (k + 1);
    st.rep.nomads = 5 * (k + 1);
    refreshBoard(st, 0, rng);
    stateLines(st);
    const c = st.contracts.find((x) => x.story)!;
    const sum = applyMissionResult(st, { contractId: c.id, result: 'success', xp: 100, scrap: 10, casualties: [], loot: [] }, c, rng);
    P(`storydone ${k} story=${sum.story ? 1 : 0} win=${sum.win ? 1 : 0}`);
    stateLines(st);
  }
}
// ceny przy różnej reputacji Nomadów
{
  const st = startCampaign([RECRUITS[0]], makeRng('prices'));
  for (const rep of [-15, -3, 0, 4, 9, 20]) {
    st.rep.nomads = rep;
    P(`rep ${rep} ${Object.keys(ITEMS).map((id) => `${buyPrice(id, st)}/${sellPrice(id, st)}`).join(',')}`);
  }
}

mkdirSync(join(ROOT, 'amiga', 'data', 'traces'), { recursive: true });
const file = join(ROOT, 'amiga', 'data', 'traces', 'campaign.txt');
writeFileSync(file, out.join('\n') + '\n');
console.log(`OK: ${file} (${out.length} linii)`);
