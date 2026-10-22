// Servidor del prototipo:
//  - Sirve la página web (carpeta public/) y la librería 3D (Three.js).
//  - POST /api/generate: recibe un texto y pide a Claude los keyframes de la animación.
// La clave de la IA se lee de la variable de entorno ANTHROPIC_API_KEY y nunca llega al navegador.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { JOINT_NAMES, EASINGS } from './public/rig.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.ANIM_MODEL || 'claude-opus-5-5';
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

const client = HAS_KEY ? new Anthropic() : null;

// Forma exacta que debe tener la respuesta de la IA.
const AnimationSchema = z.object({
  name: z.string().describe('Nombre corto de la animación, en el idioma del usuario'),
  duration: z.number().describe('Duración total en segundos'),
  loop: z.boolean().describe('true si la animación debe repetirse en bucle'),
  keyframes: z.array(
    z.object({
      time: z.number().describe('Momento del keyframe en segundos'),
      easing: z.enum(EASINGS).describe('Cómo se llega desde este keyframe al siguiente'),
      rootOffset: z.object({ x: z.number(), y: z.number(), z: z.number() })
        .describe('Desplazamiento del cuerpo entero en studs respecto a la posición de reposo'),
      poses: z.array(
        z.object({
          joint: z.enum(JOINT_NAMES),
          rx: z.number(),
          ry: z.number(),
          rz: z.number(),
        }),
      ).describe('Rotaciones en grados de las articulaciones animadas en este keyframe'),
    }),
  ),
});

const SYSTEM_PROMPT = `Eres un animador experto de Roblox. Conviertes una descripción en texto en una animación de keyframes para un personaje R15.

Esqueleto R15 (articulación Motor6D -> pieza que mueve):
- Root -> LowerTorso (mueve y gira todo el cuerpo)
- Waist -> UpperTorso
- Neck -> Head
- RightShoulder -> RightUpperArm, RightElbow -> RightLowerArm, RightWrist -> RightHand
- LeftShoulder -> LeftUpperArm, LeftElbow -> LeftLowerArm, LeftWrist -> LeftHand
- RightHip -> RightUpperLeg, RightKnee -> RightLowerLeg, RightAnkle -> RightFoot
- LeftHip -> LeftUpperLeg, LeftKnee -> LeftLowerLeg, LeftAnkle -> LeftFoot

Sistema de coordenadas (igual que Roblox): Y hacia arriba, el personaje mira hacia -Z, su derecha es +X.
En reposo el personaje está de pie con los brazos colgando rectos hacia abajo.
Cada pose es una rotación local en GRADOS (rx, ry, rz), aplicada como CFrame.Angles(rx, ry, rz) relativa a la pieza padre, y 0,0,0 es la pose de reposo.

Chuleta de signos (compruébala con cuidado):
- RightShoulder rz +90: brazo derecho en horizontal hacia el lado; rz +170: brazo derecho arriba por encima de la cabeza.
- LeftShoulder rz -90: brazo izquierdo en horizontal hacia el lado; rz -170: arriba.
- Shoulder rx +90: brazo estirado hacia delante; rx -40: brazo hacia atrás. Lo mismo para ambos brazos.
- Elbow rx +90: antebrazo doblado hacia delante. Con el brazo levantado de lado (Shoulder rz), doblar el codo en el mismo plano se hace con rz del mismo signo que el hombro.
- Hip rx +: muslo hacia delante; Knee rx -: rodilla doblada (la espinilla va hacia atrás; nunca uses rx positivo en la rodilla); Ankle rx +: compensa para dejar el pie plano.
- Waist rx -: inclinar el torso hacia delante. Waist ry: girar el torso.
- Neck rx -: mirar hacia abajo; Neck ry -: girar la cabeza hacia su derecha; Neck rz: ladear la cabeza.
- Root ry: girar todo el cuerpo. rootOffset.y negativo: agacharse (con las rodillas dobladas unos 80 grados baja ~0.55 studs); rootOffset.y positivo: el cuerpo se eleva (salto).

Reglas:
- Usa entre 4 y 16 keyframes. El primero en time 0 y el último en time = duration.
- En cada keyframe incluye solo las articulaciones que cambian, pero si una articulación aparece en un keyframe debe aparecer también en el primero y en el último.
- Si loop es true, el último keyframe debe ser idéntico al primero para que el bucle sea suave. Si es una acción única (saludar una vez, saltar una vez), empieza y termina en reposo.
- Usa easing "Cubic" casi siempre; "Linear" para movimientos mecánicos; "Constant" solo para cortes bruscos.
- Haz que la animación tenga vida: movimientos secundarios (cabeza, torso, el otro brazo), anticipación y asentamiento, sin exagerar.
- Respeta límites físicos humanos: sin hiperextender codos ni rodillas, y sin que los brazos atraviesen el torso.
- Duración típica: 1 a 4 segundos.`;

async function generateAnimation(prompt) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: zodOutputFormat(AnimationSchema) },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Crea esta animación: ${prompt}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('La IA ha rechazado esta petición.');
  if (response.stop_reason === 'max_tokens') throw new Error('La respuesta de la IA se ha cortado. Prueba una descripción más sencilla.');
  const anim = response.parsed_output;
  if (!anim) throw new Error('La IA no ha devuelto una animación válida.');
  return cleanAnimation(anim);
}

// Pequeña limpieza de seguridad: ordena los keyframes y recorta valores absurdos.
function cleanAnimation(anim) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const keyframes = anim.keyframes
    .map((k) => ({
      ...k,
      time: clamp(k.time, 0, 30),
      rootOffset: { x: clamp(k.rootOffset.x, -10, 10), y: clamp(k.rootOffset.y, -3, 10), z: clamp(k.rootOffset.z, -10, 10) },
      poses: k.poses.map((p) => ({ joint: p.joint, rx: clamp(p.rx, -360, 360), ry: clamp(p.ry, -360, 360), rz: clamp(p.rz, -360, 360) })),
    }))
    .sort((a, b) => a.time - b.time);
  const lastTime = keyframes.length ? keyframes[keyframes.length - 1].time : 1;
  return { ...anim, duration: Math.max(clamp(anim.duration, 0.1, 30), lastTime), keyframes };
}

// --- Servidor web ---

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const STATIC_DIRS = {
  '/vendor/three/': path.join(ROOT, 'node_modules/three/'),
  '/': path.join(ROOT, 'public/'),
};

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!urlPath.startsWith(prefix)) continue;
    let rel = urlPath.slice(prefix.length) || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir)) break; // evita salir de la carpeta permitida
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

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new Error('Petición demasiado grande');
  }
  return JSON.parse(body || '{}');
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/status') {
      return sendJson(res, 200, { ai: HAS_KEY, model: MODEL });
    }
    if (req.method === 'POST' && req.url === '/api/generate') {
      if (!HAS_KEY) return sendJson(res, 503, { error: 'La IA no está configurada todavía (falta la clave ANTHROPIC_API_KEY). Usa las animaciones de demo.' });
      const { prompt } = await readBody(req);
      if (typeof prompt !== 'string' || !prompt.trim()) return sendJson(res, 400, { error: 'Escribe una descripción.' });
      const started = Date.now();
      const animation = await generateAnimation(prompt.trim().slice(0, 500));
      console.log(`Generada "${animation.name}" en ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return sendJson(res, 200, { animation });
    }
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405).end();
  } catch (err) {
    console.error(err);
    const msg = err instanceof Anthropic.APIError ? `Error de la IA (${err.status ?? 'red'}): ${err.message}` : err.message;
    sendJson(res, 500, { error: msg });
  }
});

server.listen(PORT, () => {
  console.log(`Abre http://localhost:${PORT}`);
  console.log(HAS_KEY ? `IA activada (modelo ${MODEL})` : 'Sin clave de IA: solo modo demo');
});
