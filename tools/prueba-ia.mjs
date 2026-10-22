// Prueba real con IA: maneja la web como lo haría una persona (generar + autorrevisión),
// guarda capturas antes/después y calcula lo que ha costado cada animación.
//
// Uso (con el servidor arrancado con ANIM_ANTHROPIC_KEY):
//   node tools/prueba-ia.mjs [carpeta-salida] [esqueleto:"descripción" ...]
// Por defecto: 2 animaciones (R15 caminar cansado, lobo atacar mordiendo).

import fs from 'node:fs';
import path from 'node:path';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = pw.chromium || pw.default.chromium;
const base = process.env.BASE_URL || 'http://localhost:3000';
const out = process.argv[2] || 'docs/prueba-ia';
const casos = process.argv.slice(3).length
  ? process.argv.slice(3).map((s) => { const i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1)]; })
  : [['r15', 'caminar cansado, arrastrando un poco los pies'], ['lobo', 'atacar mordiendo con rabia']];

// Precio por millón de tokens (entrada, salida) según el modelo.
const PRECIOS = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };
const LOG = 'logs/revisiones.jsonl';

fs.mkdirSync(out, { recursive: true });
const status = await (await fetch(`${base}/api/status`)).json();
if (!status.ai) { console.error('El servidor no tiene ANIM_ANTHROPIC_KEY: no se puede hacer la prueba real.'); process.exit(1); }
const [pIn, pOut] = PRECIOS[status.model] || [4, 20];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const resumen = [];
for (const [esqueleto, descripcion] of casos) {
  const lineasAntes = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).length : 0;
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(base);
  await page.waitForTimeout(1500);
  await page.selectOption('#skeleton-select', esqueleto);
  await page.waitForTimeout(800);
  await page.fill('#prompt', descripcion);
  const inicio = Date.now();
  await page.click('#generate');
  await page.waitForFunction(() => /Lista|rror|rechaz|cort/.test(document.getElementById('status').textContent), null, { timeout: 15 * 60 * 1000 });
  const segundos = (Date.now() - inicio) / 1000;
  const estado = await page.textContent('#status');
  const registro = await page.$$eval('#log li', (lis) => lis.map((li) => li.innerText.trim()));
  const fallosFinales = await page.$$eval('#issues li', (lis) => lis.map((li) => li.innerText.trim()));
  // Capturas que miró la IA en cada ronda (la primera = antes de corregir).
  const imagenes = await page.$$eval('#log img', (imgs) => imgs.map((i) => i.src));
  const slug = `${esqueleto}-${descripcion.split(/[ ,]+/).slice(0, 2).join('-')}`.normalize('NFD').replace(/[^\w-]/g, '');
  imagenes.forEach((src, i) => fs.writeFileSync(path.join(out, `${slug}-ronda${i + 1}.png`), Buffer.from(src.split(',')[1], 'base64')));
  const json = await page.evaluate(() => window.__ultimaAnimacion || null);
  if (json) fs.writeFileSync(path.join(out, `${slug}.json`), JSON.stringify(json, null, 1));
  await page.close();

  const nuevas = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).slice(lineasAntes).map((l) => JSON.parse(l)) : [];
  const tokIn = nuevas.reduce((s, e) => s + (e.uso?.input_tokens || 0), 0);
  const tokOut = nuevas.reduce((s, e) => s + (e.uso?.output_tokens || 0), 0);
  const coste = (tokIn * pIn + tokOut * pOut) / 1e6;
  resumen.push({ esqueleto, descripcion, estado, segundos: Math.round(segundos), llamadas: nuevas.length, tokensEntrada: tokIn, tokensSalida: tokOut, costeUSD: Number(coste.toFixed(3)), registro, fallosFinales });
  console.log(`${esqueleto} "${descripcion}": ${estado} · ${Math.round(segundos)} s · ${nuevas.length} llamadas · ${coste.toFixed(3)} $`);
}
await browser.close();
fs.writeFileSync(path.join(out, 'resumen.json'), JSON.stringify({ modelo: status.model, fecha: new Date().toISOString(), resumen }, null, 1));
const total = resumen.reduce((s, r) => s + r.costeUSD, 0);
console.log(`TOTAL: ${total.toFixed(3)} $ (${status.model})`);
