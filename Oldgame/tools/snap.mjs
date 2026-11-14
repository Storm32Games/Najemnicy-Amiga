// Headless browser test tool.
// Usage: node tools/snap.mjs "<query>" out.png [waitMs] [script.js]
//   <query>  e.g. "?scene=hub" (appended to the game index URL), or "" for normal start
//   script.js (optional) - a file with JS run in the page after waitMs; may be async;
//             it may `return` a value which is printed as JSON. Use for clicking / driving the game.
// Prints all console messages, page errors and failed requests. Exit code 1 if any page error.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , query = '', out = '/tmp/snap.png', waitMs = '3000', scriptFile] = process.argv;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let errors = 0;
try {
  const page = await browser.newPage();
  const [vw, vh] = (process.env.VIEW || '1280x720').split('x').map(Number);   // VIEW=1920x1080 node tools/snap.mjs ...
  await page.setViewport({ width: vw, height: vh });
  page.on('console', async m => { let t = m.text(); if (t.includes('JSHandle@')) { try { t = (await Promise.all(m.args().map(a => a.evaluate(v => v instanceof Error ? v.message + ' @ ' + (v.stack||'').split('\n')[1] : (typeof v === 'object' ? JSON.stringify(v) : String(v)))))).join(' '); } catch {} } console.log(`[console.${m.type()}]`, t); });
  page.on('pageerror', e => { errors++; console.log('[PAGEERROR]', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')); });
  page.on('requestfailed', r => console.log('[REQFAIL]', r.url()));
  page.on('response', r => { if (r.status() >= 400) console.log('[HTTP', r.status() + ']', r.url()); });
  await page.goto(`http://127.0.0.1:${port}/index.html${query}`, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, +waitMs));
  if (scriptFile) {
    const code = fs.readFileSync(scriptFile, 'utf8');
    const val = await page.evaluate(`(async () => { ${code} })()`);
    console.log('[SCRIPT RESULT]', JSON.stringify(val));
    await new Promise(r => setTimeout(r, 800));
  }
  await page.screenshot({ path: out });
  console.log('[SCREENSHOT]', out);
} finally {
  await browser.close();
  server.close();
}
process.exit(errors ? 1 : 0);
