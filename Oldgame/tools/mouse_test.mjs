// Real-mouse regression test for the mission scene: select a merc, check range tiles, click a tile, check that the party moved.
// Usage: node tools/mouse_test.mjs [out.png]   (VIEW=1920x1080)
import puppeteer from 'puppeteer-core'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage(); const [vw, vh] = (process.env.VIEW || '1280x720').split('x').map(Number); await pg.setViewport({ width: vw, height: vh });
let errs = 0; pg.on('pageerror', e => { errs++; console.log('[PAGEERROR]', e.message); }); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load/.test(m.text())) console.log('[console.error]', m.text()); });
await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html?scene=mission`); const w = ms => new Promise(r => setTimeout(r, ms)); await w(4000);
// screen position of a tile / actor
const scr = (x, y, h = 0) => pg.evaluate((x, y, h) => { const M = __mission.state, v = M.vec({ px: x, py: y, x, y }, h).project(M.cam), r = Engine.canvas.getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; }, x, y, h);
const st = () => pg.evaluate(() => { const M = __mission.state; return { sel: M.selected?.ch.name, pos: M.pcs.map(p => [p.x, p.y]), tiles: M.HL.tiles.length, mode: M.mode, busy: M.busy, inv: !!document.querySelector('.m-sheet') }; });
const click = async (p) => { await pg.mouse.move(p.x, p.y); await w(120); await pg.mouse.down(); await pg.mouse.up(); await w(250); };
const out = { s0: await st() };
const pcs = out.s0.pos; const p2 = await scr(pcs[1][0], pcs[1][1], 0.9); await click(p2); await w(500); out.afterSelect = await st();
const tile = await pg.evaluate(() => { const M = __mission.state, t = M.HL.tiles.filter(t => !M.actorAt(t.x, t.y)); return t.sort((a, b) => (Math.abs(b.x - M.selected.x) + Math.abs(b.y - M.selected.y)) - (Math.abs(a.x - M.selected.x) + Math.abs(a.y - M.selected.y)))[0]; });
out.target = tile; if (tile) { await click(await scr(tile.x, tile.y, 0)); await w(2500); } out.afterMove = await st();
await pg.screenshot({ path: process.argv[2] || '/tmp/mouse.png' }); console.log(JSON.stringify(out)); await b.close(); srv.close();
const moved = JSON.stringify(out.afterMove.pos) !== JSON.stringify(out.s0.pos); console.log('moved:', moved, 'tiles after select:', out.afterSelect.tiles); process.exit(moved && out.afterSelect.tiles > 0 && !errs ? 0 : 1);
