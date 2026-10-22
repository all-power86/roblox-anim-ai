// Llamadas a Claude: generar una animación partiendo de una plantilla y revisarla mirando
// las capturas. La clave solo se usa aquí, en el servidor. Se lee de ANIM_ANTHROPIC_KEY
// (Claude Code se reserva ANTHROPIC_API_KEY en sus sesiones) o, si no, de ANTHROPIC_API_KEY.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { prepareSkeleton } from '../public/skeleton.js';
import { buildMotion, MEANING, describeDirection } from '../public/motion.js';
import { makeContext, buildTemplate, guessTemplate, TEMPLATE_LIST } from '../public/templates.js';
import { groundFix } from '../public/animation.js';

export const MODEL = process.env.ANIM_MODEL || 'claude-opus-5-5';
const apiKey = () => process.env.ANIM_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
export const hasKey = () => Boolean(apiKey());
let client = null;
const getClient = () => (client ||= new Anthropic({ apiKey: apiKey() }));

// ---------- Esquemas de respuesta ----------

const num = z.number();
const AnimationSchema = z.object({
  name: z.string(),
  duration: num,
  loop: z.boolean(),
  keyframes: z.array(z.object({
    time: num,
    easing: z.enum(['Linear', 'Cubic', 'Constant']),
    grounded: z.boolean(),
    lift: num,
    root: z.object({ right: num, up: num, forward: num, bend: num, side: num, twist: num }),
    poses: z.array(z.object({ joint: z.string(), bend: num, side: num, twist: num })),
  })),
});
const ReviewSchema = z.object({
  ok: z.boolean(),
  problems: z.array(z.object({
    type: z.enum(['se_atraviesan', 'pie_patina', 'giro_imposible', 'ritmo', 'no_cumple_descripcion', 'suelo', 'otro']),
    detail: z.string(),
  })),
  changes: z.string(),
  animation: AnimationSchema.nullable(),
});

// ---------- Instrucciones ----------

const SYSTEM = `Eres un animador profesional de videojuegos que crea animaciones para Roblox. Trabajas con cualquier esqueleto: humanoides, cuadrúpedos, criaturas con alas o cola y objetos con bisagras.

FORMATO DE LA ANIMACIÓN
- duration en segundos; loop=true si se repite (caminar, correr, reposo).
- Cada keyframe: time (s), easing ("Linear" para ciclos con muchos keyframes, "Cubic" para gestos con aceleración, "Constant" solo para cortes), grounded, lift, root y poses.
- poses: lista de {joint, bend, side, twist} en GRADOS, relativos a la pose de reposo. Cada articulación tiene tres movimientos con significado fijo, explicado en la tabla del esqueleto (por ejemplo, en una rodilla bend positivo dobla la rodilla). No pienses en ejes x/y/z: usa ese significado.
- Una articulación que no aparece en un keyframe se interpola entre los keyframes donde sí aparece. Si animas una articulación, ponla también en el primer y el último keyframe.
- root: desplazamiento de todo el cuerpo en studs (right, up, forward) y su giro (bend = inclinarse hacia delante, side = hacia su derecha, twist = girar hacia su derecha).
- grounded=true si algo apoya en el suelo en ese keyframe: el programa ajusta root.up automáticamente para que el punto más bajo toque el suelo, así que no calcules la altura a mano. grounded=false en el aire: lift = altura del punto más bajo sobre el suelo (studs).
- Las animaciones de Roblox son "en el sitio": al caminar o correr el cuerpo no avanza (root.forward≈0); los pies apoyados se deslizan hacia atrás.
- Los ángulos fuera de los límites de la tabla se recortan, así que respétalos.

CALIDAD
- Parte de la plantilla base que se te da: ya está adaptada a este esqueleto y es físicamente correcta. Modifícala para cumplir la descripción (ritmo, amplitud, actitud, partes extra) en lugar de empezar de cero.
- Principios de animación: anticipación antes de un gesto fuerte, seguimiento y asentamiento después, movimientos secundarios (cabeza, cola, alas, el otro brazo), arcos naturales, peso coherente con el tamaño (las criaturas grandes se mueven más despacio).
- Evita que las extremidades atraviesen el cuerpo o entre sí, y que los pies patinen cuando deben estar quietos.
- Ataques: el cuerpo se echa atrás en la anticipación (root.forward negativo) y se lanza hacia delante al golpear (root.forward positivo, al menos un cuarto de la altura de cadera respecto a la anticipación). Las patas apoyadas se ajustan solas para que no patinen.
- Mordiscos: en el momento de morder la cabeza se lanza hacia delante y abajo (cuello y cabeza con bend positivo) y el hocico mira al frente o un poco abajo. Si la cabeza se levanta al morder parece un aullido.
- Si es un bucle, el último keyframe debe ser igual al primero.`;

function skeletonTable(skeleton, motion, roles) {
  const rows = skeleton.joints.map((j) => {
    const m = motion.joints[j.name];
    if (m.role === 'fixed') return `- ${j.name}: fija (no animar)`;
    const r = roles[j.name] || {};
    const fmt = (k) => `${k} ${m.limits[k][0]}..${m.limits[k][1]} (+ = ${MEANING[m.role][k]})`;
    const where = [r.side && r.side !== 'C' ? `lado ${r.side === 'L' ? 'izquierdo' : 'derecho'}` : null, r.region === 'front' ? 'delantera' : r.region === 'hind' ? 'trasera' : null].filter(Boolean).join(', ');
    return `- ${j.name}: ${m.role}${where ? ` (${where})` : ''}; en reposo apunta hacia ${describeDirection(m.direction)}; ${['bend', 'side', 'twist'].filter((k) => m.limits[k][0] !== m.limits[k][1]).map(fmt).join('; ')}`;
  });
  return rows.join('\n');
}

// Prepara esqueleto, reglas y plantilla a partir de lo que manda el navegador.
function prepare({ skeleton: raw, roles, bodyType }) {
  const skeleton = prepareSkeleton(raw);
  const motion = buildMotion(skeleton, roles);
  const ctx = makeContext(skeleton, motion, bodyType);
  return { skeleton, motion, ctx };
}

function describeSkeleton(skeleton, motion, roles, ctx) {
  const typeName = { biped: 'bípedo', quadruped: 'cuadrúpedo', object: 'objeto', creature: 'criatura sin patas' }[ctx.bodyType] || ctx.bodyType;
  return `ESQUELETO "${skeleton.name}" — tipo: ${typeName}; altura ${skeleton.size.y.toFixed(1)} studs; longitud ${skeleton.size.z.toFixed(1)}; altura de cadera ${ctx.legLength.toFixed(2)} studs.
Articulaciones (nombre: función; dirección de reposo; movimientos con límites en grados):
${skeletonTable(skeleton, motion, roles)}`;
}

// Limpieza de la respuesta: articulaciones desconocidas fuera, tiempos ordenados y dentro de la duración.
function sanitize(anim, skeleton) {
  const known = new Set(skeleton.joints.map((j) => j.name));
  const dropped = new Set();
  const duration = Math.min(Math.max(Number(anim.duration) || 1, 0.1), 30);
  const keyframes = anim.keyframes
    .map((k) => ({
      ...k,
      time: Math.min(Math.max(Number(k.time) || 0, 0), duration),
      poses: k.poses.filter((p) => (known.has(p.joint) ? true : (dropped.add(p.joint), false))),
    }))
    .sort((a, b) => a.time - b.time);
  if (!keyframes.length) throw new Error('La IA no ha devuelto keyframes.');
  return { anim: { ...anim, duration, keyframes }, dropped: [...dropped] };
}

// Llama a Claude con streaming (respuestas largas) y valida el JSON con el esquema.
async function callClaude(content, schema, label) {
  const stream = getClient().messages.stream({
    model: MODEL,
    max_tokens: 48000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: zodOutputFormat(schema) },
    messages: [{ role: 'user', content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('La IA ha rechazado la petición.');
  if (msg.stop_reason === 'max_tokens') throw new Error('La respuesta de la IA se cortó por larga. Prueba una animación más corta o más sencilla.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`La IA devolvió un JSON inválido (${label}).`); }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error(`La respuesta de la IA no tiene el formato esperado (${label}).`);
  return { data: parsed.data, usage: msg.usage };
}

// La animación tal como la escribió quien la creó (IA o plantilla), sin los ajustes
// automáticos de suelo y pies: es lo que la IA debe ver y corregir.
function authoredView(anim) {
  const { authored, reviewLog, ...rest } = anim;
  return { ...rest, keyframes: authored || anim.keyframes };
}

// ---------- API ----------

export async function generate({ prompt, skeleton: raw, roles, bodyType }) {
  const { skeleton, motion, ctx } = prepare({ skeleton: raw, roles, bodyType });
  const templateId = guessTemplate(prompt, bodyType);
  const base = buildTemplate(templateId, ctx) || buildTemplate('idle', ctx);
  const content = `DESCRIPCIÓN DEL USUARIO: ${prompt}

${describeSkeleton(skeleton, motion, roles, ctx)}

PLANTILLA BASE ("${TEMPLATE_LIST.find((t) => t.id === base.template)?.label}", elegida por palabras clave; si la descripción pide otra cosa, adáptala igualmente o cámbiala):
<plantilla>
${JSON.stringify(authoredView(base))}
</plantilla>

Devuelve la animación completa que cumple la descripción.`;
  const { data, usage } = await callClaude(content, AnimationSchema, 'generar');
  const { anim, dropped } = sanitize(data, skeleton);
  anim.template = base.template;
  const fix = groundFix(anim, skeleton, motion, { plant: !['walk', 'run'].includes(base.template) });
  return { animation: anim, template: base.template, dropped, groundFix: fix, usage };
}

export async function review({ prompt, skeleton: raw, roles, bodyType, animation, image, issues, iteration }) {
  const { skeleton, motion, ctx } = prepare({ skeleton: raw, roles, bodyType });
  const base64 = String(image || '').replace(/^data:image\/png;base64,/, '');
  const issueText = (issues || []).length
    ? issues.map((i) => `- [${i.severity}] ${i.message}`).join('\n')
    : '- (ninguno)';
  const content = [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
    { type: 'text', text: `AUTORREVISIÓN — ronda ${iteration} de 3.
La imagen muestra la animación actual: columnas = momentos (t en segundos), fila de arriba = vista 3/4 frontal, fila de abajo = vista desde su lado derecho (el personaje mira hacia la derecha de la imagen en esa fila). Colores: azul tronco, amarillo cabeza y brazos, verde piernas, morado cola, rojo alas; la marca negra es la cara.

DESCRIPCIÓN DEL USUARIO: ${prompt}

${describeSkeleton(skeleton, motion, roles, ctx)}

FALLOS DETECTADOS AUTOMÁTICAMENTE (medidos, son fiables):
${issueText}

ANIMACIÓN ACTUAL (tal como la escribiste; después el programa ajusta solo la altura al suelo y las patas apoyadas, por eso la imagen puede variar un poco):
${JSON.stringify(authoredView(animation))}

Revisa con ojo de animador: extremidades atravesándose, pies que patinan, giros imposibles, falta de ritmo o de peso, y si cumple la descripción.
- Si está bien (o los únicos fallos son menores), responde ok=true, animation=null.
- Si no, ok=false, lista los problemas, explica en "changes" qué cambias (en castellano, breve) y devuelve la animación corregida completa.` },
  ];
  const { data, usage } = await callClaude(content, ReviewSchema, 'revisar');
  let animation2 = null;
  let dropped = [];
  if (!data.ok && data.animation) {
    const s = sanitize(data.animation, skeleton);
    animation2 = { ...s.anim, template: animation.template };
    dropped = s.dropped;
    groundFix(animation2, skeleton, motion, { plant: !['walk', 'run'].includes(animation.template) });
  }
  return { ok: data.ok || !animation2, problems: data.problems, changes: data.changes, animation: animation2, dropped, usage };
}
