// Wypieka tekstury płócien (tła, warstwy paralaksy, napisy) z prawdziwej gry w przeglądarce dla portu na Amigę.
// Vite (tryb deweloperski: window.__game) + Chrome bez okna sterowany przez DevTools Protocol; scena z ?bake=1
// (src/scenes/ui/Kit.ts: tekstury w rozdzielczości projektowej, bez skalera pixel artu).
// Wynik: amiga/data/bake/<cel>/<klucz>.png + manifest.json. Uruchom: node tools/amiga/bake_scenes.ts [cel ...]
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VITE_PORT = 5199, CDP_PORT = 9333;

/** Klatki tekstury płótna animowanej kodem (np. NukeBlast): updatery sceny wołane dla czasu planszy t (s) od `from` do `to`. */
interface Frames { tex: string; from: number; to: number; step: number }
/** prep: kod JS (async, w stronie; dostępne g = gra, sc = scena) dorabiający tekstury przed zbieraniem - moduły gry przez import(). */
interface Target { name: string; scene: string; extra?: string; prefix: string[]; waitMs?: number; frames?: Frames; prep?: string }

// Mapa regionu: budynki zasłaniające (bloki z głębią), ogniska, latarnia, bestie (po jednej odmianie kolorów na gatunek)
const TRAVEL_PREP = `
  const RA = await import('/src/scenes/iso/RegionArt.ts');
  const CA = await import('/src/scenes/iso/CreatureArt.ts');
  const IA = await import('/src/scenes/iso/IsoArt.ts');
  const EN = await import('/src/core/data/enemies.ts');
  const EV = await import('/src/core/campaign/events.ts');
  const K = await import('/src/scenes/ui/Kit.ts');
  const SKINS = ['#8a6a4a', '#5a5a62', '#7a8a4a', '#9a4a5a', '#4a7a8a', '#b89a5a', '#6a4a8a', '#3a3a3e'], EYES = ['#ff3a2a', '#ffe040', '#40ffc0', '#ff60ff', '#8fff40'];
  const fauna = EV.FAUNA_KINDS.map((k, i) => {
    const def = EN.ENEMIES[k.templateId];
    const sh = CA.paintCreatureSheet(def ? def.look.shape : 'quad', K.parseColor(SKINS[i], 0), K.parseColor(EYES[i % 5], 0), k.templateId);
    new IA.ArtBook(sc).sheet('bk_fauna_' + i, sh.pc, sh.frames);
    return { name: k.name, scale: def && def.look.scale ? def.look.scale : 1 };
  });
  window.__bakeExtra = { blocks: (sc.blocks || []).map((b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, box: b.box, depth: b.depth })), fires: RA.regionFires(), beacon: RA.beaconPos(), fauna };
`;

// Przystań: drużyna może być dowolną czwórką, więc postacie, portrety i ikony wszystkich rekrutów / przedmiotów / zdolności
const HUB_PREP = `
  const W = await import('/src/scenes/ui/Widgets.ts');
  const U = await import('/src/scenes/iso/UnitLooks.ts');
  const H = await import('/src/scenes/iso/HiRes.ts');
  const I = await import('/src/scenes/legacy/icons.ts');
  const R = await import('/src/core/data/recruits.ts');
  const S = await import('/src/core/campaign/session.ts');
  const IT = await import('/src/core/data/items.ts');
  const AB = await import('/src/core/data/abilities.ts');
  const copy = (from, to) => { const c = g.textures.get(from).getSourceImage(); const d = document.createElement('canvas'); d.width = c.width; d.height = c.height; d.getContext('2d').drawImage(c, 0, 0); g.textures.addCanvas(to, d); };
  for (const r of R.RECRUITS) {
    const ch = S.recruitCharacter(r);
    U.ensureUnit(sc, 'pc_' + r.id, U.unitLookOf(ch));
    for (const size of [29, 30, 40]) copy(W.portraitKey(sc, ch, size), 'bk_p' + size + '_' + r.id);
  }
  for (const [id, def] of Object.entries(IT.ITEMS)) for (const size of [10, 11]) g.textures.addCanvas('bk_i' + size + '_' + id, H.hiResCanvas(I.itemIcon(def, 32), { w: size, h: size }));
  for (const [id, def] of Object.entries(AB.ABILITIES)) g.textures.addCanvas('bk_a7_' + id, H.hiResCanvas(I.abilityIcon({ icon: def.icon, id, name: def.name, fx: def.fx }, 24), { w: 7, h: 7 }));
`;
const TARGETS: Target[] = [
  { name: 'title', scene: 'TitleScene', prefix: ['title', 'rec_', 'unit_rec'] },
  { name: 'travel', scene: 'TravelScene', prefix: ['travel', 'bk_'], prep: TRAVEL_PREP },
  { name: 'hub', scene: 'HubScene', prefix: ['hub', 'unit_pc_', 'unit_npc_', 'pc_', 'npc_', 'bk_'], prep: HUB_PREP },
  // werbunek: tło + portrety 30 px (karty); portrety 26 px (plac) są tylko u wybranych - 4 przebiegi po 4 rekrutów
  ...[0, 1, 2, 3].map((k): Target => ({ name: `recruit${k + 1}`, scene: 'RecruitScene', extra: `&pick=${[0, 1, 2, 3].map((i) => k * 4 + i).join(',')}`, prefix: k ? ['porpl_'] : ['recruit', 'porpl_'] })),
  ...[1, 2, 3, 4, 5, 6].map((n): Target => ({
    name: `intro${n}`, scene: 'IntroScene', extra: `&slide=${n}`, prefix: ['intro', 'unit_intro', 'rec_', 'unit_rec'],
    // wybuch: 2.6 s rakiet, potem NukeBlast.render(k) - klatki co 0.1 s przez 7 s (plansza trwa najwyżej ~8.6 s)
    frames: n === 1 ? { tex: 'intro_bomb_fx', from: 2.5, to: 9.7, step: 0.1 } : undefined,
  })),
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url: string, ms = 30000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* jeszcze nie wstał */
    }
    if (Date.now() - t0 > ms) throw new Error('brak odpowiedzi: ' + url);
    await sleep(300);
  }
}

class Cdp {
  private id = 0;
  private wait = new Map<number, (v: unknown) => void>();
  private ws: WebSocket;
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.wait.has(m.id)) {
        this.wait.get(m.id)!(m.error ? { error: m.error } : m.result);
        this.wait.delete(m.id);
      }
    };
  }
  send(method: string, params: object = {}): Promise<Record<string, unknown>> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r) => this.wait.set(id, r as (v: unknown) => void));
  }
}

const COLLECT = (scene: string, prefixes: string[], waitMs: number, frames?: Frames, prep = ''): string => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200 && !(window.__game && window.__game.scene.isActive(${JSON.stringify(scene)})); i++) await sleep(100);
  await sleep(${waitMs});
  const g = window.__game, pre = ${JSON.stringify(prefixes)}, want = (k) => pre.some((p) => k.startsWith(p));
  { const sc = g.scene.getScene(${JSON.stringify(scene)}); ${prep} }
  const out = { textures: {}, objects: [], anims: [] };
  for (const [k, t] of Object.entries(g.textures.list)) {
    if (!want(k)) continue;
    const src = t.getSourceImage();
    if (!src || !src.getContext) continue;
    const frames = {};
    for (const [fn, f] of Object.entries(t.frames)) if (fn !== '__BASE') frames[fn] = [f.cutX, f.cutY, f.cutWidth, f.cutHeight];
    out.textures[k] = { w: src.width, h: src.height, png: src.toDataURL('image/png'), frames };
  }
  const sc = g.scene.getScene(${JSON.stringify(scene)});
  const dump = (o, depth0) => {
    const r = { type: o.type, x: o.x, y: o.y, d: o.depth ?? depth0, vis: o.visible, a: o.alpha };
    if (o.width !== undefined) { r.w = o.width; r.h = o.height; }
    if (o.originX !== undefined) { r.ox = o.originX; r.oy = o.originY; }
    if (o.scaleX !== undefined && (o.scaleX !== 1 || o.scaleY !== 1)) { r.sx = o.scaleX; r.sy = o.scaleY; }
    if (o.flipX) r.flip = 1;
    if (o.texture && o.texture.key !== '__DEFAULT') { r.tex = o.texture.key; r.frame = o.frame && o.frame.name; }
    if (o.fillColor !== undefined) { r.fill = o.fillColor; r.fa = o.fillAlpha; }
    if (o.strokeColor !== undefined && o.isStroked) { r.stroke = o.strokeColor; }
    if (o.text !== undefined) r.text = o.text;
    if (o.anims && o.anims.currentAnim) r.anim = o.anims.currentAnim.key;
    if (o.list) r.children = o.list.map((c) => dump(c, 0));
    return r;
  };
  out.objects = sc.children.list.map((o) => dump(o, 0));
  out.extra = window.__bakeExtra || null;
  const fr = ${JSON.stringify(frames ?? null)};
  out.frames = [];
  if (fr) {
    sc.scene.pause();
    const c = g.textures.get(fr.tex).getSourceImage();
    for (let t = fr.from; t <= fr.to + 1e-6; t += fr.step) {
      const tq = Math.round(t * 50 * 256); // TickClock.timeQ8: ticki 50 Hz w Q8
      for (const u of sc.updaters) {
        try {
          u(tq, 0);
        } catch (e) {
          throw new Error('updater t=' + t + ': ' + e);
        }
      }
      out.frames.push({ t: Math.round(t * 1000) / 1000, png: c.toDataURL('image/png') });
    }
  }
  for (const a of g.anims.anims.entries ? Object.values(g.anims.anims.entries) : []) {
    if (!want(a.key)) continue;
    out.anims.push({ key: a.key, frames: a.frames.map((f) => [f.frame.name, f.duration]), rate: a.frameRate, dur: a.msPerFrame, repeat: a.repeat });
  }
  return JSON.stringify(out);
})()`;

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const procs: ChildProcess[] = [];
  try {
    const vite = spawn(join(ROOT, 'node_modules', '.bin', 'vite'), ['--port', String(VITE_PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    procs.push(vite);
    await waitHttp(`http://localhost:${VITE_PORT}/`);
    const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'najm-chrome-'))}`,
      '--no-first-run', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
    procs.push(chrome);
    await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const list = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('brak karty w Chrome');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    for (const t of TARGETS) {
      if (only.length && !only.includes(t.name)) continue;
      await cdp.send('Page.navigate', { url: `http://localhost:${VITE_PORT}/?scene=${t.scene}${t.extra ?? ''}&bake=1&res=fhd` });
      const r = (await cdp.send('Runtime.evaluate', { expression: COLLECT(t.scene, t.prefix, t.waitMs ?? 2500, t.frames, t.prep), awaitPromise: true, returnByValue: true })) as {
        result?: { value?: string }; exceptionDetails?: unknown;
      };
      if (!r.result?.value) throw new Error(`${t.name}: brak wyniku ${JSON.stringify(r.exceptionDetails ?? r).slice(0, 400)}`);
      const all = JSON.parse(r.result.value) as { textures: Record<string, { w: number; h: number; png: string; frames: Record<string, number[]> }>; objects: unknown[]; anims: unknown[]; frames: { t: number; png: string }[] };
      const tex = all.textures;
      const dir = join(ROOT, 'amiga', 'data', 'bake', t.name);
      mkdirSync(dir, { recursive: true });
      const manifest: Record<string, { w: number; h: number; frames: Record<string, number[]> }> = {};
      for (const [k, v] of Object.entries(tex)) {
        const file = k.replace(/[^a-zA-Z0-9_@.-]/g, '_') + '.png';
        writeFileSync(join(dir, file), Buffer.from(v.png.split(',')[1], 'base64'));
        manifest[k] = { w: v.w, h: v.h, frames: v.frames };
      }
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
      if (all.frames.length) {
        mkdirSync(join(dir, 'frames'), { recursive: true });
        all.frames.forEach((f, i) => writeFileSync(join(dir, 'frames', `${String(i).padStart(3, '0')}.png`), Buffer.from(f.png.split(',')[1], 'base64')));
        writeFileSync(join(dir, 'frames', 'index.json'), JSON.stringify(all.frames.map((f) => f.t)) + '\n');
      }
      writeFileSync(join(dir, 'scene.json'), JSON.stringify({ objects: all.objects, anims: all.anims, extra: (all as unknown as { extra?: unknown }).extra ?? null }, null, 1) + '\n');
      console.log(`${t.name}: ${Object.keys(tex).length} tekstur -> amiga/data/bake/${t.name}/ (${Object.entries(manifest).map(([k, v]) => `${k} ${v.w}x${v.h}`).join(', ')})`);
    }
    ws.close();
  } finally {
    for (const p of procs) p.kill();
  }
}
await main();
