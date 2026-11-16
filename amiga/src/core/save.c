/* Zapis gry (binarny, big-endian). Kampania + misja w eksploracji. Odczyt misji odwzorowuje Mission.restore z TS. */
#include <string.h>
#include "save.h"

/* ---------------------------------------------------------------- bufor */
typedef struct { uint8_t *b; const uint8_t *rb; int n, cap, err; } Buf;
static void w8(Buf *o, int v) { if (o->n < o->cap) o->b[o->n] = (uint8_t)v; else o->err = 1; o->n++; }
static void w16(Buf *o, int v) { w8(o, (v >> 8) & 255); w8(o, v & 255); }
static void w32(Buf *o, uint32_t v) { w16(o, (int)(v >> 16)); w16(o, (int)(v & 0xFFFF)); }
static void wstr(Buf *o, const char *s) { int n = (int)strlen(s), i; w8(o, n); for (i = 0; i < n; i++) w8(o, (unsigned char)s[i]); }
static int r8(Buf *o) { if (o->n >= o->cap) { o->err = 1; return 0; } return o->rb[o->n++]; }
static int r16(Buf *o) { int a = r8(o); return (int16_t)((a << 8) | r8(o)); }
static int ru16(Buf *o) { int a = r8(o); return (a << 8) | r8(o); }
static uint32_t r32(Buf *o) { uint32_t a = (uint32_t)ru16(o); return (a << 16) | (uint32_t)ru16(o); }
static void rstr(Buf *o, char *s, int max) { int n = r8(o), i; for (i = 0; i < n; i++) { int c = r8(o); if (i < max) s[i] = (char)c; } s[n < max ? n : max] = 0; }
static void wdice(Buf *o, Dice d) { w8(o, d.n); w8(o, d.sides); w8(o, d.mod); }
static Dice rdice(Buf *o) { Dice d; d.n = (uint8_t)r8(o); d.sides = (uint8_t)r8(o); d.mod = (int8_t)r8(o); return d; }
static void wbytes(Buf *o, const void *p, int n) { const uint8_t *b = (const uint8_t *)p; int i; for (i = 0; i < n; i++) w8(o, b[i]); }
static void rbytes(Buf *o, void *p, int n) { uint8_t *b = (uint8_t *)p; int i; for (i = 0; i < n; i++) b[i] = (uint8_t)r8(o); }

/* ---------------------------------------------------------------- postać */
static void w_char(Buf *o, const Character *c) {
  int i;
  wstr(o, c->name);
  w8(o, c->is_enemy); w8(o, c->ancestry); w8(o, c->class_id); w8(o, c->recruit); w8(o, c->template_id);
  w8(o, c->level); w16(o, c->xp);
  wbytes(o, c->attrs, ATTR_COUNT);
  w16(o, c->max_hp); w16(o, c->hp); w16(o, c->temp_hp);
  wbytes(o, &c->prof, sizeof(Prof)); /* same uint8_t */
  w8(o, c->n_skill_order); wbytes(o, c->skill_order, SKILL_COUNT);
  for (i = 0; i < SLOT_COUNT; i++) { w8(o, c->equip[i].id); w8(o, c->equip[i].qty); }
  w8(o, c->n_inv);
  for (i = 0; i < c->n_inv; i++) { w8(o, c->inv[i].id); w8(o, c->inv[i].qty); }
  w8(o, c->n_abilities); wbytes(o, c->abilities, c->n_abilities);
  wbytes(o, c->uses, ABIL_COUNT);
  wbytes(o, c->cond, COND_COUNT);
  for (i = 0; i < COND_COUNT; i++) wdice(o, c->cond_dice[i]);
  w8(o, c->speed);
  w8(o, c->look.body); w32(o, c->look.skin); w32(o, c->look.hair); w32(o, c->look.cloth); w32(o, c->look.accent);
  w8(o, c->look.hair_style); w8(o, c->look.mask); w8(o, c->look.mutation); w8(o, c->look.cyber);
  w8(o, c->ac_base); w8(o, c->fort_base); w8(o, c->ref_base); w8(o, c->will_base); w8(o, c->perception_base); w8(o, c->class_dc_base);
  w8(o, c->n_attacks);
  for (i = 0; i < c->n_attacks; i++) { w8(o, c->attacks[i].bonus); wdice(o, c->attacks[i].damage); }
  w8(o, c->stolen); w16(o, c->stolen_scrap); w32(o, c->name_color);
}
static void r_char(Buf *o, Character *c) {
  int i;
  memset(c, 0, sizeof *c);
  rstr(o, c->name, NAME_MAX);
  c->is_enemy = (uint8_t)r8(o); c->ancestry = (uint8_t)r8(o); c->class_id = (uint8_t)r8(o); c->recruit = (uint8_t)r8(o); c->template_id = (uint8_t)r8(o);
  c->level = (uint8_t)r8(o); c->xp = (uint16_t)ru16(o);
  rbytes(o, c->attrs, ATTR_COUNT);
  c->max_hp = (int16_t)r16(o); c->hp = (int16_t)r16(o); c->temp_hp = (int16_t)r16(o);
  rbytes(o, &c->prof, sizeof(Prof));
  c->n_skill_order = (uint8_t)r8(o); rbytes(o, c->skill_order, SKILL_COUNT);
  for (i = 0; i < SLOT_COUNT; i++) { c->equip[i].id = (uint8_t)r8(o); c->equip[i].qty = (uint8_t)r8(o); }
  c->n_inv = (uint8_t)r8(o);
  if (c->n_inv > INV_MAX) { o->err = 1; c->n_inv = 0; }
  for (i = 0; i < c->n_inv; i++) { c->inv[i].id = (uint8_t)r8(o); c->inv[i].qty = (uint8_t)r8(o); }
  c->n_abilities = (uint8_t)r8(o);
  if (c->n_abilities > CHAR_ABIL_MAX) { o->err = 1; c->n_abilities = 0; }
  rbytes(o, c->abilities, c->n_abilities);
  rbytes(o, c->uses, ABIL_COUNT);
  rbytes(o, c->cond, COND_COUNT);
  for (i = 0; i < COND_COUNT; i++) c->cond_dice[i] = rdice(o);
  c->speed = (uint8_t)r8(o);
  c->look.body = (uint8_t)r8(o); c->look.skin = r32(o); c->look.hair = r32(o); c->look.cloth = r32(o); c->look.accent = r32(o);
  c->look.hair_style = (uint8_t)r8(o); c->look.mask = (uint8_t)r8(o); c->look.mutation = (uint8_t)r8(o); c->look.cyber = (uint8_t)r8(o);
  c->ac_base = (uint8_t)r8(o); c->fort_base = (int8_t)r8(o); c->ref_base = (int8_t)r8(o); c->will_base = (int8_t)r8(o);
  c->perception_base = (int8_t)r8(o); c->class_dc_base = (int8_t)r8(o);
  c->n_attacks = (uint8_t)r8(o);
  if (c->n_attacks > 2) { o->err = 1; c->n_attacks = 0; }
  for (i = 0; i < c->n_attacks; i++) {
    int8_t bonus = (int8_t)r8(o);
    Dice dmg = rdice(o);
    if (c->template_id < ENEMY_COUNT) c->attacks[i] = ENEMY_DEFS[c->template_id].attacks[i]; /* nazwa, cechy, sfx z szablonu */
    c->attacks[i].bonus = bonus;
    c->attacks[i].damage = dmg;
  }
  if (c->is_enemy && c->template_id < ENEMY_COUNT) c->name_acc = ENEMY_DEFS[c->template_id].acc;
  c->stolen = (uint8_t)r8(o); c->stolen_scrap = (uint16_t)ru16(o); c->name_color = r32(o);
}

/* ---------------------------------------------------------------- zlecenie */
static int ptr_index(const char *const *arr, int n, const char *p) {
  int i;
  for (i = 0; i < n; i++) if (arr[i] == p) return i;
  return 0;
}
static void w_contract(Buf *o, const Contract *c) {
  const ContractTemplate *T = &CONTRACT_TEMPLATES[c->type];
  int i;
  wstr(o, c->id);
  w8(o, c->story); w8(o, c->type); w8(o, c->faction); w8(o, c->level); w8(o, c->biome); w8(o, c->mood);
  w8(o, c->story >= 0 ? 0 : ptr_index(T->titles, T->n_titles, c->title));
  w8(o, c->story >= 0 ? 0 : ptr_index(GIVERS[c->faction], 5, c->giver));
  w8(o, c->story >= 0 ? 0 : ptr_index(T->descs, T->n_descs, c->desc));
  w8(o, c->n_enemies); wbytes(o, c->enemies, c->n_enemies);
  w8(o, c->obj_item); w16(o, c->reward_scrap); w16(o, c->reward_xp);
  w8(o, c->n_reward_items); wbytes(o, c->reward_items, c->n_reward_items);
  for (i = 0; i < FACTION_COUNT; i++) w8(o, c->reward_rep[i]);
  w8(o, c->travel_days);
}
static void r_contract(Buf *o, Contract *c) {
  int i, ti, gi, di;
  memset(c, 0, sizeof *c);
  rstr(o, c->id, 23);
  c->story = (int8_t)r8(o); c->type = (uint8_t)r8(o); c->faction = (uint8_t)r8(o); c->level = (uint8_t)r8(o); c->biome = (uint8_t)r8(o); c->mood = (uint8_t)r8(o);
  ti = r8(o); gi = r8(o); di = r8(o);
  if (c->type >= OBJ_COUNT || c->faction >= FACTION_COUNT) { o->err = 1; return; }
  if (c->story >= 0 && c->story < STORY_CONTRACT_COUNT) {
    c->title = STORY_CONTRACTS[c->story].title;
    c->giver = STORY_CONTRACTS[c->story].giver;
    c->desc = STORY_CONTRACTS[c->story].desc;
  } else {
    const ContractTemplate *T = &CONTRACT_TEMPLATES[c->type];
    c->title = T->titles[ti < T->n_titles ? ti : 0];
    c->giver = GIVERS[c->faction][gi < 5 ? gi : 0];
    c->desc = T->descs[di < T->n_descs ? di : 0];
  }
  c->n_enemies = (uint8_t)r8(o);
  if (c->n_enemies > CONTRACT_ENEMIES_MAX) { o->err = 1; return; }
  rbytes(o, c->enemies, c->n_enemies);
  c->obj_item = (uint8_t)r8(o); c->reward_scrap = (uint16_t)ru16(o); c->reward_xp = (uint16_t)ru16(o);
  c->n_reward_items = (uint8_t)r8(o);
  if (c->n_reward_items > 2) { o->err = 1; return; }
  rbytes(o, c->reward_items, c->n_reward_items);
  for (i = 0; i < FACTION_COUNT; i++) c->reward_rep[i] = (int8_t)r8(o);
  c->travel_days = (uint8_t)r8(o);
}

static void w_head(Buf *o, char kind) { w8(o, 'N'); w8(o, 'A'); w8(o, 'J'); w8(o, kind); w8(o, SAVE_VERSION); }
static int r_head(Buf *o, char kind) { return r8(o) == 'N' && r8(o) == 'A' && r8(o) == 'J' && r8(o) == kind && r8(o) == SAVE_VERSION; }

/* ---------------------------------------------------------------- kampania */
int campaign_save(const CampaignState *st, uint8_t *buf, int cap) {
  Buf o;
  int i;
  memset(&o, 0, sizeof o);
  o.b = buf;
  o.cap = cap;
  w_head(&o, 'C');
  w8(&o, st->n_party);
  for (i = 0; i < st->n_party; i++) w_char(&o, &st->party[i]);
  w32(&o, (uint32_t)st->scrap); w16(&o, st->day);
  for (i = 0; i < FACTION_COUNT; i++) w16(&o, st->rep[i]);
  w8(&o, st->n_stash);
  for (i = 0; i < st->n_stash; i++) { w8(&o, st->stash[i].id); w8(&o, st->stash[i].qty); }
  w8(&o, st->n_contracts);
  for (i = 0; i < st->n_contracts; i++) w_contract(&o, &st->contracts[i]);
  w8(&o, st->n_completed);
  for (i = 0; i < st->n_completed; i++) wstr(&o, st->completed[i]);
  w8(&o, st->story);
  w8(&o, st->n_fallen);
  for (i = 0; i < st->n_fallen; i++) wstr(&o, st->fallen[i]);
  w8(&o, st->n_fallen_ids); wbytes(&o, st->fallen_ids, st->n_fallen_ids);
  w8(&o, st->victory); w16(&o, st->n_log);
  return o.err ? 0 : o.n;
}

int campaign_load(CampaignState *st, const uint8_t *buf, int len) {
  Buf o;
  int i;
  memset(&o, 0, sizeof o);
  o.rb = buf;
  o.cap = len;
  if (!r_head(&o, 'C')) return 0;
  campaign_fresh(st);
  st->n_party = r8(&o);
  if (st->n_party > MAX_PARTY) return 0;
  for (i = 0; i < st->n_party; i++) r_char(&o, &st->party[i]);
  st->scrap = (int32_t)r32(&o); st->day = r16(&o);
  for (i = 0; i < FACTION_COUNT; i++) st->rep[i] = r16(&o);
  st->n_stash = (uint8_t)r8(&o);
  if (st->n_stash > MAX_STASH) return 0;
  for (i = 0; i < st->n_stash; i++) { st->stash[i].id = (uint8_t)r8(&o); st->stash[i].qty = (uint8_t)r8(&o); }
  st->n_contracts = r8(&o);
  if (st->n_contracts > MAX_CONTRACTS) return 0;
  for (i = 0; i < st->n_contracts; i++) r_contract(&o, &st->contracts[i]);
  st->n_completed = r8(&o);
  if (st->n_completed > MAX_COMPLETED) return 0;
  for (i = 0; i < st->n_completed; i++) rstr(&o, st->completed[i], 23);
  st->story = r8(&o);
  st->n_fallen = r8(&o);
  if (st->n_fallen > MAX_FALLEN) return 0;
  for (i = 0; i < st->n_fallen; i++) rstr(&o, st->fallen[i], NAME_MAX);
  st->n_fallen_ids = r8(&o);
  if (st->n_fallen_ids > MAX_FALLEN) return 0;
  rbytes(&o, st->fallen_ids, st->n_fallen_ids);
  st->victory = (uint8_t)r8(&o); st->n_log = ru16(&o);
  return !o.err;
}

/* ---------------------------------------------------------------- misja */
static int actor_index(const Mission *m, const Actor *a) {
  int i;
  for (i = 0; i < m->n_actors; i++) if (m->actors[i] == a) return i;
  return -1;
}
static int party_index(const Mission *m, const Character *c) {
  int i;
  for (i = 0; i < m->n_party; i++) if (m->party[i] == c) return i;
  return -1;
}

int mission_save(const Mission *m, uint8_t *buf, int cap) {
  Buf o;
  int i;
  if (m->mode != MODE_EXPLORE) return 0;
  memset(&o, 0, sizeof o);
  o.b = buf;
  o.cap = cap;
  w_head(&o, 'M');
  wstr(&o, m->contract.id);
  wbytes(&o, m->map.grid.cells, GRID_N);
  w8(&o, m->n_actors);
  for (i = 0; i < m->n_actors; i++) {
    const Actor *a = m->actors[i];
    int pc = a->side == SIDE_PC ? party_index(m, a->ch) : -1, gi = -1, k;
    w8(&o, pc);
    if (pc < 0) w_char(&o, a->ch);
    for (k = 0; k < m->n_groups; k++) if (m->groups[k] == a->group) gi = k;
    w8(&o, a->side); w8(&o, a->gx); w8(&o, a->gy); w8(&o, a->state); w8(&o, gi); w8(&o, a->engaged);
    w8(&o, a->has_roam); w8(&o, a->roam_home.gx); w8(&o, a->roam_home.gy); w8(&o, a->roam_has_dest); w8(&o, a->roam_dest.gx); w8(&o, a->roam_dest.gy);
    w8(&o, a->is_target); w8(&o, a->following);
  }
  w8(&o, m->n_groups);
  for (i = 0; i < m->n_groups; i++) { w8(&o, m->groups[i]->alerted); w16(&o, m->groups[i]->next_notice); w8(&o, m->groups[i]->center.gx); w8(&o, m->groups[i]->center.gy); }
  w8(&o, m->n_things);
  for (i = 0; i < m->n_things; i++) {
    const MissionThing *t = &m->things[i];
    w8(&o, t->gx); w8(&o, t->gy); w8(&o, t->kind); w8(&o, t->done); w8(&o, t->item); w8(&o, t->tries); w8(&o, t->freed); w8(&o, t->objective);
    w8(&o, t->actor ? actor_index(m, t->actor) : -1);
    w8(&o, t->has_lock); w8(&o, t->lock.dc); w8(&o, t->lock.needed); w8(&o, t->lock.progress); w8(&o, t->lock.jammed); w8(&o, t->lock.force_penalty);
    w8(&o, t->quality); w8(&o, t->device);
  }
  w8(&o, m->n_finds);
  for (i = 0; i < m->n_finds; i++) {
    const MissionFind *f = &m->finds[i];
    w8(&o, f->f.gx); w8(&o, f->f.gy); w8(&o, f->f.kind); w8(&o, f->f.hidden); w8(&o, f->found); w8(&o, f->taken); w8(&o, f->tried);
  }
  w8(&o, m->item_thing); w8(&o, m->captive); w8(&o, m->obj_device);
  w8(&o, m->n_settlers); for (i = 0; i < m->n_settlers; i++) w8(&o, m->settlers[i]);
  w8(&o, m->n_nests); for (i = 0; i < m->n_nests; i++) w8(&o, m->nests[i]);
  w16(&o, m->wave); w16(&o, m->next_wave); w8(&o, m->stage); w16(&o, m->steps); w32(&o, (uint32_t)m->scrap);
  w8(&o, m->n_loot);
  for (i = 0; i < m->n_loot; i++) { w8(&o, m->loot[i].id); w8(&o, m->loot[i].qty); }
  w8(&o, m->n_killed);
  for (i = 0; i < m->n_killed; i++) {
    int k, ai = -1;
    for (k = 0; k < m->n_actors; k++) if (m->actors[k]->ch == m->killed[i]) ai = k;
    w8(&o, ai);
  }
  for (i = 0; i < GRID_N; i += 8) {
    int bits = 0, k;
    for (k = 0; k < 8; k++) if (m->explored[i + k]) bits |= 1 << k;
    w8(&o, bits);
  }
  return o.err ? 0 : o.n;
}

typedef struct { Buf *o; Character **party; int n_party; int ok; } LoadCtx;

static Actor *restore(Mission *m, void *vctx) {
  LoadCtx *L = (LoadCtx *)vctx;
  Buf *o = L->o;
  Actor *target = NULL, *list[MAX_ACTORS];
  int n, i;
  char id[24];
  struct { int8_t gx, gy; uint8_t side, state, engaged, has_roam, roam_has_dest, is_target, following; int8_t gi; Pos home, dest; Character *ch; } ar[MAX_ACTORS];
  rstr(o, id, 23);
  if (strcmp(id, m->contract.id)) { L->ok = 0; return NULL; }
  rbytes(o, m->map.grid.cells, GRID_N);
  n = r8(o);
  if (n > MAX_ACTORS) { L->ok = 0; return NULL; }
  for (i = 0; i < n; i++) {
    int pc = (int8_t)r8(o);
    if (pc >= 0) ar[i].ch = pc < L->n_party ? L->party[pc] : NULL;
    else {
      ar[i].ch = &m->char_store[m->n_chars++];
      r_char(o, ar[i].ch);
    }
    ar[i].side = (uint8_t)r8(o); ar[i].gx = (int8_t)r8(o); ar[i].gy = (int8_t)r8(o); ar[i].state = (uint8_t)r8(o); ar[i].gi = (int8_t)r8(o); ar[i].engaged = (uint8_t)r8(o);
    ar[i].has_roam = (uint8_t)r8(o); ar[i].home.gx = (int8_t)r8(o); ar[i].home.gy = (int8_t)r8(o); ar[i].roam_has_dest = (uint8_t)r8(o);
    ar[i].dest.gx = (int8_t)r8(o); ar[i].dest.gy = (int8_t)r8(o); ar[i].is_target = (uint8_t)r8(o); ar[i].following = (uint8_t)r8(o);
  }
  m->n_groups = r8(o);
  if (m->n_groups > MAX_MAP_GROUPS) { L->ok = 0; return NULL; }
  for (i = 0; i < m->n_groups; i++) {
    EnemyGroup *g = &m->group_store[i];
    memset(g, 0, sizeof *g);
    g->idx = (uint8_t)i;
    g->alerted = (uint8_t)r8(o); g->next_notice = (int16_t)r16(o); g->center.gx = (int8_t)r8(o); g->center.gy = (int8_t)r8(o);
    m->groups[i] = g;
  }
  for (i = 0; i < n; i++) {
    EnemyGroup *grp = ar[i].gi >= 0 && ar[i].gi < m->n_groups ? m->groups[ar[i].gi] : NULL;
    Actor *a;
    if (!ar[i].ch) { list[i] = NULL; continue; }
    a = mission_make_actor(m, ar[i].ch, ar[i].side, mkpos(ar[i].gx, ar[i].gy), grp);
    a->state = ar[i].state;
    a->engaged = 0;
    a->has_roam = ar[i].has_roam; a->roam_home = ar[i].home; a->roam_has_dest = ar[i].roam_has_dest; a->roam_dest = ar[i].dest;
    if (ar[i].is_target) { a->is_target = 1; target = a; }
    a->following = ar[i].following;
    if (grp && grp->n < MAX_GROUP_MEMBERS) grp->actors[grp->n++] = a;
    if (a->side == SIDE_PC) m->pcs[m->n_pcs++] = a;
    else if (a->side == SIDE_ENEMY) m->enemies[m->n_enemies++] = a;
    else m->neutral[m->n_neutral++] = a;
    list[i] = a;
  }
  m->n_things = r8(o);
  if (m->n_things > MAX_THINGS) { L->ok = 0; return NULL; }
  for (i = 0; i < m->n_things; i++) {
    MissionThing *t = &m->things[i];
    int ai;
    memset(t, 0, sizeof *t);
    t->gx = (int8_t)r8(o); t->gy = (int8_t)r8(o); t->kind = (uint8_t)r8(o); t->done = (uint8_t)r8(o); t->item = (uint8_t)r8(o); t->tries = (uint8_t)r8(o);
    t->freed = (uint8_t)r8(o); t->objective = (uint8_t)r8(o);
    ai = (int8_t)r8(o);
    t->actor = ai >= 0 && ai < n ? list[ai] : NULL;
    t->has_lock = (uint8_t)r8(o); t->lock.dc = (uint8_t)r8(o); t->lock.needed = (uint8_t)r8(o); t->lock.progress = (uint8_t)r8(o);
    t->lock.jammed = (uint8_t)r8(o); t->lock.force_penalty = (int8_t)r8(o); t->quality = (uint8_t)r8(o); t->device = (uint8_t)r8(o);
  }
  m->n_finds = r8(o);
  if (m->n_finds > MAX_FINDS) { L->ok = 0; return NULL; }
  for (i = 0; i < m->n_finds; i++) {
    MissionFind *f = &m->finds[i];
    f->f.gx = (int8_t)r8(o); f->f.gy = (int8_t)r8(o); f->f.kind = (uint8_t)r8(o); f->f.hidden = (uint8_t)r8(o);
    f->found = (uint8_t)r8(o); f->taken = (uint8_t)r8(o); f->tried = (uint8_t)r8(o);
  }
  m->item_thing = (int8_t)r8(o); m->captive = (int8_t)r8(o); m->obj_device = (int8_t)r8(o);
  m->n_settlers = r8(o); for (i = 0; i < m->n_settlers && i < 8; i++) m->settlers[i] = r8(o);
  m->n_nests = r8(o); for (i = 0; i < m->n_nests && i < 8; i++) m->nests[i] = r8(o);
  m->wave = r16(o); m->next_wave = r16(o); m->stage = r8(o); m->steps = r16(o); m->scrap = (int32_t)r32(o);
  m->n_loot = (uint8_t)r8(o);
  if (m->n_loot > MAX_LOOT) { L->ok = 0; return NULL; }
  for (i = 0; i < m->n_loot; i++) { m->loot[i].id = (uint8_t)r8(o); m->loot[i].qty = (uint8_t)r8(o); }
  m->n_killed = 0;
  {
    int nk = r8(o);
    for (i = 0; i < nk; i++) {
      int ai = (int8_t)r8(o);
      if (ai >= 0 && ai < n && list[ai]) m->killed[m->n_killed++] = list[ai]->ch;
    }
  }
  for (i = 0; i < GRID_N; i += 8) {
    int bits = r8(o), k;
    for (k = 0; k < 8; k++) m->explored[i + k] = (uint8_t)((bits >> k) & 1);
  }
  if (o->err) L->ok = 0;
  return target;
}

int mission_load(Mission *m, const MissionContract *contract, Character **party, int n_party, Rng *rng, const uint8_t *buf, int len) {
  Buf o;
  LoadCtx L;
  memset(&o, 0, sizeof o);
  o.rb = buf;
  o.cap = len;
  if (!r_head(&o, 'M')) return 0;
  L.o = &o;
  L.party = party;
  L.n_party = n_party;
  L.ok = 1;
  mission_init_with(m, contract, party, n_party, rng, restore, &L);
  return L.ok;
}
