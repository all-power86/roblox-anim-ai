// Genera archivos de ejemplo para probar en Roblox Studio (docs/ejemplos/):
//  - animaciones .rbxmx con los tres tipos de contenedor
//  - modelos de prueba con huesos (Bone) para el lobo y el dragón
// Uso: node tools/make-examples.mjs

import fs from 'node:fs';
import path from 'node:path';
import { prepareSkeleton, matrixToCframe } from '../public/skeleton.js';
import { classifySkeleton } from '../public/classify.js';
import { buildMotion } from '../public/motion.js';
import { makeContext, buildTemplate } from '../public/templates.js';
import { toRbxmx } from '../public/export-roblox.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'docs/ejemplos');
fs.mkdirSync(OUT, { recursive: true });

function load(name) {
  const sk = prepareSkeleton(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/skeletons', `${name}.json`))));
  const cls = classifySkeleton(sk);
  const motion = buildMotion(sk, cls.joints);
  return { sk, motion, ctx: makeContext(sk, motion, cls.bodyType) };
}

function writeAnim(skName, template, container, file) {
  const { sk, motion, ctx } = load(skName);
  fs.writeFileSync(path.join(OUT, file), toRbxmx(buildTemplate(template, ctx), sk, motion, { container }));
  console.log('escrito', file);
}

writeAnim('r15', 'walk', 'Folder', 'R15-Caminar-Folder.rbxmx');
writeAnim('r15', 'walk', 'ObjectValue', 'R15-Caminar-ObjectValue.rbxmx');
writeAnim('r15', 'walk', 'none', 'R15-Caminar-SoloKeyframeSequence.rbxmx');
writeAnim('r15', 'attack', 'Folder', 'R15-Atacar-Folder.rbxmx');
writeAnim('r6', 'walk', 'Folder', 'R6-Caminar-Folder.rbxmx');
writeAnim('lobo', 'walk', 'Folder', 'Lobo-Caminar-Folder.rbxmx');
writeAnim('lobo', 'attack', 'Folder', 'Lobo-Atacar-Folder.rbxmx');
writeAnim('dragon', 'attack', 'Folder', 'Dragon-Atacar-Folder.rbxmx');

// ---------- Modelos de prueba con huesos ----------
// Model > Part (anclada, la "malla") > Bones anidados, + AnimationController > Animator.
let ref = 0;
const nextRef = () => `RBX${(ref++).toString(16).toUpperCase().padStart(8, '0')}`;
const n = (v) => (Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(5)));
const cf = (name, c) => `<CoordinateFrame name="${name}">${['X', 'Y', 'Z', 'R00', 'R01', 'R02', 'R10', 'R11', 'R12', 'R20', 'R21', 'R22'].map((t, i) => `<${t}>${n(c[i])}</${t}>`).join('')}</CoordinateFrame>`;

function boneRigXml(skName) {
  ref = 0;
  const { sk } = load(skName);
  const bone = (j) => `<Item class="Bone" referent="${nextRef()}"><Properties><string name="Name">${j.name}</string>${cf('CFrame', matrixToCframe(j.restLocal))}</Properties>${j.children.map(bone).join('')}</Item>`;
  const partRef = nextRef();
  const roots = sk.joints.filter((j) => !j.parentNode);
  const s = sk.size;
  const part = `<Item class="Part" referent="${partRef}"><Properties>`
    + `<string name="Name">${sk.rootPart}</string>`
    + cf('CFrame', [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
    + '<bool name="Anchored">true</bool><bool name="CanCollide">false</bool><float name="Transparency">0.8</float>'
    + `<Vector3 name="size"><X>${n(Math.max(s.x, 0.2))}</X><Y>0.2</Y><Z>${n(Math.max(s.z, 0.2))}</Z></Vector3>`
    + `</Properties>${roots.map(bone).join('')}</Item>`;
  const controller = `<Item class="AnimationController" referent="${nextRef()}"><Properties><string name="Name">AnimationController</string></Properties><Item class="Animator" referent="${nextRef()}"><Properties><string name="Name">Animator</string></Properties></Item></Item>`;
  return `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" version="4"><Item class="Model" referent="${nextRef()}"><Properties><string name="Name">${sk.name}</string><Ref name="PrimaryPart">${partRef}</Ref></Properties>${part}${controller}</Item></roblox>`;
}
for (const name of ['lobo', 'dragon']) {
  const file = `Modelo-${name[0].toUpperCase()}${name.slice(1)}-huesos.rbxmx`;
  fs.writeFileSync(path.join(OUT, file), boneRigXml(name));
  console.log('escrito', file);
}
