// Genera hojas de capturas de las plantillas en cada esqueleto de prueba.
// Uso: node tools/capture.mjs [carpeta-salida] [esqueleto:plantilla ...]
// Requiere el servidor arrancado (npm start) y Playwright con Chromium.
import path from 'node:path';
import fs from 'node:fs';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = pw.chromium || pw.default.chromium;
const out = process.argv[2] || 'docs/capturas';
const base = process.env.BASE_URL || 'http://localhost:3000';
const pairs = process.argv.slice(3).length ? process.argv.slice(3).map((s) => s.split(':')) : [
  ['r15', 'walk'], ['r15', 'attack'], ['r15', 'run'], ['r15', 'jump'], ['r15', 'wave'], ['r15', 'idle'],
  ['r6', 'walk'], ['r6', 'attack'],
  ['yeti', 'walk'], ['yeti', 'attack'],
  ['lobo', 'walk'], ['lobo', 'attack'], ['lobo', 'run'], ['lobo', 'jump'], ['lobo', 'wave'],
  ['dragon', 'walk'], ['dragon', 'attack'], ['dragon', 'jump'],
  ['puerta', 'open'],
];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1800, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
for (const [sk, tpl] of pairs) {
  await page.goto(`${base}/sheet.html?skeleton=${sk}&template=${tpl}`);
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 30000 });
  const status = await page.evaluate(() => document.body.dataset.ready);
  const file = path.join(out, `${sk}-${tpl}.png`);
  if (status === '1') await page.locator('canvas').screenshot({ path: file });
  console.log(status === '1' ? 'ok   ' : 'ERROR', file, status === '1' ? '' : await page.textContent('#info'));
}
if (errors.length) console.log('errores de página:', errors);
await browser.close();
