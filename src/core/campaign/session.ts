// Bieżąca kampania: stan + start nowej gry (migracja z Oldgame/src/core/game.js i scenes/recruit.js: begin()).
// Czysty TypeScript - zero Phasera / DOM. Zapis na dysk należy do warstwy scen.
import { generateName } from '../data/names.ts';
import { RECRUITS } from '../data/recruits.ts';
import type { RecruitDef } from '../data/types.ts';
import { createCharacter, newItem } from '../rules/character.ts';
import type { Rng } from '../rules/dice.ts';
import { generateContracts } from './contracts.ts';
import { campaignPartyLevel, freshState, MAX_PARTY, type CampaignState } from './state.ts';

export const campaign: { state: CampaignState } = { state: freshState() };

/** Najemnik z gotowego rekruta (ten sam wygląd i życiorys co na ekranie werbunku). */
export function recruitCharacter(r: RecruitDef, name: string = r.name, level = 1) {
  return createCharacter({ name, ancestry: r.ancestry, classId: r.classId, look: r.look, bio: r.bio, recruitId: r.id, level });
}

/** Nowa kampania: drużyna z wybranych rekrutów, startowe zapasy i pierwsza tablica zleceń. */
export function startCampaign(picks: readonly RecruitDef[], rng: Rng = Math.random, custom: (r: RecruitDef) => { name?: string; nameColor?: string } = () => ({})): CampaignState {
  const st = freshState();
  st.party = picks.slice(0, MAX_PARTY).map((r) => {
    const c = custom(r);
    const ch = recruitCharacter(r, c.name ?? r.name);
    if (c.nameColor) ch.nameColor = c.nameColor;
    return ch;
  });
  st.stash.push(newItem('bandage', 3), newItem('stimpak', 1));
  st.contracts = generateContracts(st, rng);
  campaign.state = st;
  return st;
}

/** Dev / testy: gotowa drużyna z pierwszych 4 rekrutów i tablica zleceń (Oldgame Game.quickParty). */
export function quickParty(rng: Rng = Math.random): CampaignState {
  return startCampaign(RECRUITS.slice(0, MAX_PARTY), rng);
}

// ---------------- Karczma (Oldgame/src/scenes/hub.js: draw_tavern)

/** Koszt podpisu nowego najemnika. */
export const hireCost = (state: Pick<CampaignState, 'party'>): number => 120 + 60 * campaignPartyLevel(state);

/** Rekruci do wzięcia: nie w drużynie i nie polegli. */
export function tavernRecruits(state: CampaignState): RecruitDef[] {
  const have = new Set(state.party.map((c) => c.recruitId ?? c.name));
  const fallen = state.flags.fallen ?? [], fallenIds = state.flags.fallenIds ?? [];
  return RECRUITS.filter((r) => !have.has(r.id) && !have.has(r.name) && !fallenIds.includes(r.id) && !fallen.includes(r.name));
}

/** Zatrudnia rekruta na poziomie drużyny (MUTUJE `state`). */
export function hireRecruit(state: CampaignState, r: RecruitDef, rng: Rng = Math.random): { ok: boolean; reason?: string } {
  const cost = hireCost(state);
  if (state.party.length >= MAX_PARTY) return { ok: false, reason: 'Drużyna jest pełna.' };
  if (state.scrap < cost) return { ok: false, reason: 'Za mało Złomu.' };
  const taken = state.party.map((c) => c.name);
  const clash = taken.some((t) => t.toLowerCase() === r.name.toLowerCase());
  const name = clash ? generateName({ ancestry: r.ancestry, classId: r.classId, gender: r.gender, taken, rng }) : r.name;
  const lvl = campaignPartyLevel(state);
  state.scrap -= cost;
  state.party.push(recruitCharacter(r, name, lvl));
  return { ok: true };
}
