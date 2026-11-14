// Regression test: tooltip in the Nomad shop must disappear after buying (real mouse hover + click).
import puppeteer from 'puppeteer-core'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = { '.html': 'text/html', '.js': 'text/javascript' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 720 }); pg.on('pageerror', e => console.log('[PAGEERROR]', e.message));
await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html?scene=hub`); const w = ms => new Promise(r => setTimeout(r, ms)); await w(3000);
await pg.evaluate(() => { Game.state.scrap = 999; [...document.querySelectorAll('button')].find(x => /HANDLARZ/i.test(x.textContent)).click(); }); await w(800);
const btn = await pg.evaluateHandle(() => [...document.querySelectorAll('button')].find(x => / Z$/.test(x.textContent.trim()) && !x.disabled));
const bb = await btn.boundingBox(); await pg.mouse.move(bb.x - 120, bb.y + bb.height / 2); await w(300);
const before = await pg.evaluate(() => document.querySelectorAll('.tooltip').length);
await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await pg.mouse.down(); await pg.mouse.up(); await w(200);
await pg.mouse.move(640, 700); await w(400);
const after = await pg.evaluate(() => document.querySelectorAll('.tooltip').length);
console.log('tooltips while hovering:', before, ' after buying and moving away:', after);
await b.close(); srv.close(); process.exit(after === 0 ? 0 : 1);
