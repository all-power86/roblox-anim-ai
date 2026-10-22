// Servidor del proyecto:
//  - Sirve la web (carpeta public/) y la librería 3D (Three.js).
//  - POST /api/generate: genera una animación con IA partiendo de una plantilla.
//  - POST /api/review:   la IA revisa las capturas de la animación y la corrige.
// La clave de la IA (ANIM_ANTHROPIC_KEY o ANTHROPIC_API_KEY) solo se lee aquí y nunca se envía al navegador.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { generate, review, hasKey, MODEL } from './server/ai.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const LOG_DIR = path.join(ROOT, 'logs');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8',
};
const STATIC_DIRS = {
  '/vendor/three/': path.join(ROOT, 'node_modules/three/'),
  '/': path.join(ROOT, 'public/'),
};

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!urlPath.startsWith(prefix)) continue;
    const file = path.join(dir, urlPath.slice(prefix.length) || 'index.html');
    if (!file.startsWith(dir)) break; // no salir de la carpeta permitida
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      return res.end(data);
    } catch {
      break;
    }
  }
  res.writeHead(404).end('No encontrado');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Petición demasiado grande'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function checkPayload(body) {
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw Object.assign(new Error('Escribe una descripción.'), { status: 400 });
  if (!body.skeleton || !body.roles) throw Object.assign(new Error('Falta el esqueleto.'), { status: 400 });
  body.prompt = body.prompt.trim().slice(0, 600);
}

// Registro de la autorrevisión (una línea JSON por ronda).
async function logReview(entry) {
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.appendFile(path.join(LOG_DIR, 'revisiones.jsonl'), JSON.stringify({ fecha: new Date().toISOString(), ...entry }) + '\n');
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  try {
    if (req.method === 'GET' && req.url === '/api/status') {
      return sendJson(res, 200, { ai: hasKey(), model: MODEL });
    }
    if (req.method === 'POST' && (req.url === '/api/generate' || req.url === '/api/review')) {
      if (!hasKey()) return sendJson(res, 503, { error: 'La IA no está configurada (falta ANIM_ANTHROPIC_KEY en el servidor). Las plantillas funcionan igualmente.' });
      const body = await readBody(req, req.url === '/api/review' ? 12_000_000 : 2_000_000);
      checkPayload(body);
      if (req.url === '/api/generate') {
        const out = await generate(body);
        console.log(`Generada "${out.animation.name}" (${body.skeleton.name}) en ${((Date.now() - started) / 1000).toFixed(1)} s`);
        await logReview({ tipo: 'generar', prompt: body.prompt, esqueleto: body.skeleton.name, plantilla: out.template, descartadas: out.dropped, uso: out.usage });
        return sendJson(res, 200, out);
      }
      const out = await review(body);
      console.log(`Revisión ${body.iteration}: ${out.ok ? 'OK' : 'corregida'} en ${((Date.now() - started) / 1000).toFixed(1)} s`);
      await logReview({
        tipo: 'revisar', ronda: body.iteration, prompt: body.prompt, esqueleto: body.skeleton.name,
        fallosAutomaticos: (body.issues || []).map((i) => i.message), ok: out.ok, problemas: out.problems, cambios: out.changes, uso: out.usage,
      });
      return sendJson(res, 200, out);
    }
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405).end();
  } catch (err) {
    console.error(err);
    const status = err.status && err.status < 500 && !(err instanceof Anthropic.APIError) ? err.status : 500;
    const msg = err instanceof Anthropic.APIError ? `Error de la IA (${err.status ?? 'red'}): ${err.message}` : err.message;
    sendJson(res, status, { error: msg });
  }
});

server.listen(PORT, () => {
  console.log(`Abre http://localhost:${PORT}`);
  console.log(hasKey() ? `IA activada (modelo ${MODEL})` : 'Sin clave de IA: solo plantillas');
});
