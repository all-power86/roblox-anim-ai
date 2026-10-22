// Pasa el análisis automático por todas las plantillas de todos los esqueletos de prueba,
// y comprueba que detecta fallos provocados a propósito.
import fs from 'node:fs';
import { prepareSkeleton } from '../public/skeleton.js';
import { classifySkeleton } from '../public/classify.js';
import { buildMotion } from '../public/motion.js';
import { makeContext, buildTemplate, templatesFor } from '../public/templates.js';
import { analyzeAnimation } from '../public/analyze.js';

const dir = new URL('../public/skeletons/', import.meta.url);
const load = (f) => {
  const sk = prepareSkeleton(JSON.parse(fs.readFileSync(new URL(f, dir))));
  const cls = classifySkeleton(sk);
  const motion = buildMotion(sk, cls.joints);
  return { sk, cls, motion, ctx: makeContext(sk, motion, cls.bodyType) };
};
let fails = 0;
for (const f of fs.readdirSync(dir)) {
  const { sk, cls, motion, ctx } = load(f);
  for (const t of templatesFor(cls.bodyType)) {
    const anim = buildTemplate(t.id, ctx);
    if (!anim) continue;
    const { issues } = analyzeAnimation(anim, sk, motion, { legLength: ctx.legLength });
    const serious = issues.filter((i) => i.severity !== 'baja');
    console.log(`${f.padEnd(12)} ${t.id.padEnd(7)} ${serious.length ? '⚠ ' + serious.map((i) => i.message).join(' | ') : 'sin fallos'}`);
  }
}
// Fallos provocados: rodilla al revés, brazo atravesando el torso, cuerpo bajo el suelo.
{
  const { sk, motion, ctx } = load('r15.json');
  const bad = { name: 'malo', duration: 1, loop: false, keyframes: [
    { time: 0, easing: 'Linear', root: {}, poses: [] },
    { time: 1, easing: 'Linear', grounded: false, root: { up: -1.5 }, poses: [{ joint: 'RightKnee', bend: -60 }, { joint: 'RightShoulder', side: -60, bend: 0 }, { joint: 'RightElbow', bend: 150 }] },
  ] };
  const types = new Set(analyzeAnimation(bad, sk, motion, { legLength: ctx.legLength }).issues.map((i) => i.type));
  for (const want of ['giro_imposible', 'atraviesa_suelo', 'se_atraviesan']) {
    if (!types.has(want)) { fails++; console.log('FALLO: no se detectó', want); }
  }
  console.log('fallos provocados detectados:', [...types].join(', '));
}
process.exit(fails ? 1 : 0);
