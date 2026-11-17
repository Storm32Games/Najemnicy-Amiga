// Ślad referencyjny logiki ekranów startowych (TS) -> amiga/data/traces/frontend.txt. Ten sam scenariusz: amiga/tests/trace_frontend.c.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ApproachCurve, IntRng, IntroFlow, LOGO_GH, LOGO_GW, LogoCubes, LogoShow, MoteField, TickClock, TypeProgress, angQ8, blinkAlphaQ8,
  flameKQ12, flameSwayQ8, glowAlphaQ8, potTiles, progressQ12, secToQ8, titleMenu, type CubePose,
} from '../../src/core/frontend/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out: string[] = [];
const P = (s: string): void => {
  out.push(s);
};
const h32 = (h: number, v: number): number => (Math.imul(h, 31) + (v | 0)) >>> 0;

// zegar
{
  const c = new TickClock();
  const ms = [16, 17, 16, 33, 7, 120, 20, 19, 21, 250, 3];
  P(`clock ${ms.map((m) => `${c.advance(m)}:${c.tick}:${c.alphaQ8}:${c.timeQ8}`).join(' ')}`);
}
// logo: obraz syntetyczny (pasy, okrąg, szum)
const rgb = new Uint8Array(LOGO_GW * LOGO_GH * 3);
{
  const r = new IntRng(7);
  for (let y = 0; y < LOGO_GH; y++)
    for (let x = 0; x < LOGO_GW; x++) {
      const o = (y * LOGO_GW + x) * 3;
      const inC = (x - 80) * (x - 80) + (y - 45) * (y - 45) * 4 < 1600;
      rgb[o] = inC ? 200 + r.below(56) : (x * 3) & 255;
      rgb[o + 1] = inC ? 40 + r.below(80) : (y * 5) & 255;
      rgb[o + 2] = (x + y) % 7 === 0 ? 30 : r.below(90);
    }
}
for (const seed of [32, 99]) {
  const c = new LogoCubes(rgb, 3, seed);
  let h = 7;
  for (let i = 0; i < c.count; i++) h = h32(h32(h32(h32(h32(h, c.x[i]), c.y[i]), c.sx[i]), c.sy[i]), c.land[i] ^ c.col[i] ^ c.hi[i] ^ c.lo[i]);
  P(`cubes ${seed} n=${c.count} h=${h}`);
  const pose: CubePose = { x: 0, y: 0, s: 0 };
  for (let t = 0; t <= 200 * 256; t += 1777) {
    let hf = 7;
    const nf = c.forEachFlying(t, pose, (i, p) => {
      hf = h32(h32(h32(h32(hf, i), p.x), p.y), p.s);
    });
    const nd = c.drainLanded(t, () => {});
    P(`fly ${t} ${nf} ${hf} landed=${nd}/${c.landed}`);
  }
  const show = new LogoShow(c);
  c.reset();
  const ev: string[] = [];
  for (let t = 0; t < 340; t++) {
    c.drainLanded(t * 256, () => {});
    const e = show.update(t);
    if (e) ev.push(`${t}:${e}${e & 1 ? '/' + show.stepPitchQ8() : ''}`);
  }
  P(`show ${ev.join(' ')}`);
}
// maszyna do pisania i intro
{
  const tp = new TypeProgress(137, 34);
  const s: string[] = [];
  for (let k = 0; k < 12; k++) s.push(`${tp.step(k % 4 + 1)}/${tp.shown}/${tp.done ? 1 : 0}`);
  tp.finish();
  P(`type ${s.join(' ')} fin=${tp.shown}`);
  const f = new IntroFlow(6);
  const typing = new TypeProgress(90, 34);
  const a: string[] = [];
  for (let t = 0; t < 2600; t++) {
    let r = f.tick(typing.done);
    if (r === 3) typing.finish(), (typing as unknown as { acc: number }).acc = 0;
    else typing.step(1);
    if (t % 97 === 13) r = r * 10 + f.press(typing.done);
    if (t === 2400) r = r * 10 + f.skip();
    if (r) a.push(`${t}:${r}:${f.index}`);
  }
  P(`intro ${a.join(' ')}`);
}
// menu
for (const [save, slots] of [[false, false], [true, false], [true, true], [false, true]] as const) {
  const m = titleMenu(save, slots);
  const ops: string[] = [`${m.focus}`];
  for (const d of [1, 1, -1, -1, -1, 1, 1, 1, 1, 1, 1]) ops.push(`${m.move(d as 1 | -1) ? 1 : 0}${m.focus}`);
  ops.push(`f${m.setFocus(3) ? 1 : 0}${m.focus}`, `a${m.activate()}`);
  P(`menu ${save ? 1 : 0}${slots ? 1 : 0} ${m.items.map((i) => i.id).join(',')} ${ops.join(' ')}`);
}
// stałe i krzywe
P(`ang ${[0.8, 1.1, 2, 9, 23, 0.045, 3.7, 12.5].map(angQ8).join(',')} q8 ${[0.1, 0.48, 1.25, 3.33].map(secToQ8).join(',')}`);
P(`prog ${[[0, 0, 5000], [2560, 0, 12800], [99999, 100, 12800], [-5, 0, 256]].map(([a, b, c]) => progressQ12(a, b, c)).join(',')}`);
for (const [rate, step] of [[2.2, 16], [0.7, 8], [5, 4]] as const) {
  const ac = new ApproachCurve(rate, step);
  P(`approach ${rate} ${step} ${[-1, 0, 100, 1000, 4000, 9000, 40000, 300000].map((t) => ac.at(t)).join(',')}`);
}
{
  const s: string[] = [];
  for (let t = 0; t < 30000; t += 413) s.push(`${flameKQ12(t, t % 4)}/${flameSwayQ8(t, (t >> 3) % 4)}/${glowAlphaQ8(t)}`);
  P(`flame ${s.join(' ')}`);
}
{
  const mf = new MoteField(40, { x: 10, y: 120, w: 300, h: 140 }, 3.5, -6, 4242, 0.6);
  const mg = new MoteField(25, { x: 0, y: 0, w: 480, h: 270 }, -12, 2, 77, 0.35);
  for (let k = 0; k < 400; k++) {
    mf.step();
    mg.step();
  }
  let h = 7;
  for (let i = 0; i < mf.n; i++) h = h32(h32(h32(h, mf.x[i]), mf.y[i]), mf.alpha[i]);
  for (let i = 0; i < mg.n; i++) h = h32(h32(h32(h, mg.x[i]), mg.y[i]), mg.alpha[i]);
  P(`motes ${h} ${mf.x[0]},${mf.y[0]} ${mg.x[3]},${mg.y[3]}`);
}
P(`blink ${Array.from({ length: 30 }, (_, i) => blinkAlphaQ8(i * 9)).join(',')} ${blinkAlphaQ8(500, 100, 7, 4, 60)}`);
P(`tiles ${potTiles(480, 270).map((t) => `${t.x},${t.y},${t.w},${t.h},${t.texW},${t.texH}`).join(';')} ${potTiles(600, 130, 128).length}`);

mkdirSync(join(ROOT, 'amiga', 'data', 'traces'), { recursive: true });
const file = join(ROOT, 'amiga', 'data', 'traces', 'frontend.txt');
writeFileSync(file, out.join('\n') + '\n');
console.log(`OK: ${file} (${out.length} linii)`);
