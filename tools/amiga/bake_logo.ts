// Wypieka próbkę logo STORM 32 (160x90 RGB) dokładnie tak, jak robi to LogoScene w przeglądarce (canvas drawImage),
// przez Chrome bez okna. Wynik: amiga/data/bake/logo_sample.rgb (43200 bajtów). Uruchom: node tools/amiga/bake_logo.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir = mkdtempSync(join(tmpdir(), 'najm-bake-'));
const img = join(ROOT, 'public', 'assets', 'storm32-logo.jpg');
const html = `<!doctype html><html><body><pre id="out">wait</pre><script>
const img = new Image();
img.onload = () => {
  const c = document.createElement('canvas'); c.width = 160; c.height = 90;
  const g = c.getContext('2d', { willReadFrequently: true });
  const k = Math.min(160 / img.width, 90 / img.height), w = img.width * k, h = img.height * k;
  g.fillStyle = '#060a14'; g.fillRect(0, 0, 160, 90);
  g.drawImage(img, (160 - w) / 2, (90 - h) / 2, w, h);
  const d = g.getImageData(0, 0, 160, 90).data, rgb = [];
  for (let i = 0; i < d.length; i += 4) rgb.push(d[i], d[i + 1], d[i + 2]);
  document.getElementById('out').textContent = 'OK ' + btoa(String.fromCharCode(...rgb));
};
img.onerror = () => { document.getElementById('out').textContent = 'ERR'; };
img.src = ${JSON.stringify('file://' + img)};
</script></body></html>`;
writeFileSync(join(dir, 'logo.html'), html);
const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--virtual-time-budget=8000', '--dump-dom', 'file://' + join(dir, 'logo.html')], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
const m = /<pre id="out">OK ([A-Za-z0-9+/=]+)/.exec(dom);
if (!m) throw new Error('Chrome nie zwrócił próbki logo');
const buf = Buffer.from(m[1], 'base64');
if (buf.length !== 160 * 90 * 3) throw new Error('zły rozmiar próbki: ' + buf.length);
mkdirSync(join(ROOT, 'amiga', 'data', 'bake'), { recursive: true });
writeFileSync(join(ROOT, 'amiga', 'data', 'bake', 'logo_sample.rgb'), buf);
console.log('OK: amiga/data/bake/logo_sample.rgb');
