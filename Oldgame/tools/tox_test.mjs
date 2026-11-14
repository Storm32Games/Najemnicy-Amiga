// Test przegladarkowej wersji ToxiCity (~/WebGames/toxicity-mgl) prawdziwymi kliknieciami myszy.
import puppeteer from 'puppeteer-core'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = process.env.ROOT, out = process.argv[2];
const T = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.data': 'application/octet-stream' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p);
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 800 }); let errs = 0;
pg.on('pageerror', e => { errs++; console.log('[PAGEERROR]', e.message); }); pg.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html`); const w = ms => new Promise(r => setTimeout(r, ms));
await w(9000); await pg.screenshot({ path: out + '_1.png' });
const box = await (await pg.$('canvas')).boundingBox();
for (let i = 0; i < 3; i++) { await pg.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await w(2500); }
await pg.screenshot({ path: out + '_2.png' });
console.log('errors', errs); await b.close(); srv.close();
