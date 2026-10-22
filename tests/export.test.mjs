// Lee de vuelta cada .rbxmx exportado y comprueba: XML bien formado, jerarquía de poses
// (cada pose cuelga de su padre correcto) y que los CFrame reproducen la pose de la vista previa.
import fs from 'node:fs';
import * as THREE from 'three';
import { prepareSkeleton, forwardKinematics } from '../public/skeleton.js';
import { classifySkeleton } from '../public/classify.js';
import { buildMotion } from '../public/motion.js';
import { bakeAnimation } from '../public/animation.js';
import { makeContext, buildTemplate, templatesFor } from '../public/templates.js';
import { toRbxmx, poseName } from '../public/export-roblox.js';

// Mini lector de XML de Roblox: devuelve un árbol de Items con nombre de clase, propiedades y CFrame.
function parse(xml) {
  const root = { cls: 'root', children: [], props: {} };
  const stack = [root];
  const re = /<Item class="([^"]+)"[^>]*>|<\/Item>|<string name="Name">([^<]*)<\/string>|<CoordinateFrame name="CFrame">(.*?)<\/CoordinateFrame>|<float name="Time">([^<]*)<\/float>/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1]) { const it = { cls: m[1], children: [], props: {} }; top.children.push(it); stack.push(it); }
    else if (m[0] === '</Item>') { if (stack.length === 1) throw new Error('</Item> sin abrir'); stack.pop(); }
    else if (m[2] != null) top.props.name = m[2];
    else if (m[3] != null) top.props.cf = [...m[3].matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map((x) => Number(x[2]));
    else if (m[4] != null) top.props.time = Number(m[4]);
  }
  if (stack.length !== 1) throw new Error('Items sin cerrar');
  return root;
}

const dir = new URL('../public/skeletons/', import.meta.url);
let fails = 0;
let files = 0;
for (const f of fs.readdirSync(dir)) {
  const sk = prepareSkeleton(JSON.parse(fs.readFileSync(new URL(f, dir))));
  const cls = classifySkeleton(sk);
  const motion = buildMotion(sk, cls.joints);
  const ctx = makeContext(sk, motion, cls.bodyType);
  for (const t of templatesFor(cls.bodyType)) {
    const anim = buildTemplate(t.id, ctx);
    for (const container of ['Folder', 'ObjectValue', 'none']) {
      files++;
      const tree = parse(toRbxmx(anim, sk, motion, { container }));
      const top = tree.children[0];
      const kfs = container === 'none' ? top : top.children[0];
      if ((container === 'none' && top.cls !== 'KeyframeSequence') || (container !== 'none' && (top.cls !== container || top.props.name !== 'AnimSaves'))) {
        fails++; console.log('FALLO contenedor', f, container, top.cls); continue;
      }
      if (container !== 'ObjectValue' || t.id !== 'walk') continue; // la comprobación de poses, una vez por esqueleto
      const baked = bakeAnimation(anim, sk, motion);
      kfs.children.forEach((kf, i) => {
        // Reconstruir la pose desde el XML: nombre de pose -> articulación.
        const byPose = Object.fromEntries(sk.joints.map((j) => [poseName(j), j]));
        const rot = {};
        const offset = {};
        const walk = (item, parentJoint) => {
          const j = byPose[item.props.name];
          if (j) {
            const expectedParent = j.parentNode ? poseName(j.parentNode) : null;
            if (expectedParent && parentJoint !== expectedParent) { fails++; console.log('FALLO jerarquía', f, item.props.name, 'cuelga de', parentJoint); }
            const m = new THREE.Matrix4().set(...item.props.cf.slice(3, 6), item.props.cf[0], ...item.props.cf.slice(6, 9), item.props.cf[1], ...item.props.cf.slice(9, 12), item.props.cf[2], 0, 0, 0, 1);
            rot[j.name] = new THREE.Quaternion().setFromRotationMatrix(m);
            offset[j.name] = new THREE.Vector3().setFromMatrixPosition(m);
          }
          item.children.forEach((c) => walk(c, item.props.name));
        };
        walk(kf.children[0], null);
        const a = forwardKinematics(sk, { rot, offset });
        const b = forwardKinematics(sk, baked.keyframes[i]);
        for (const j of sk.joints) {
          const d = new THREE.Vector3().setFromMatrixPosition(a[j.name]).distanceTo(new THREE.Vector3().setFromMatrixPosition(b[j.name]));
          if (d > 1e-3) { fails++; console.log('FALLO posición', f, j.name, d); break; }
        }
      });
    }
  }
}
// R15 nuevo (AnimationConstraint + BallSocketConstraint): el .rbxmx debe ser idéntico al del
// R15 con Motor6D (las poses llevan el nombre de la pieza que mueve cada articulación).
{
  const xml = (f) => {
    const sk = prepareSkeleton(JSON.parse(fs.readFileSync(new URL(f, dir))));
    const cls = classifySkeleton(sk);
    const motion = buildMotion(sk, cls.joints);
    return toRbxmx(buildTemplate('walk', makeContext(sk, motion, cls.bodyType)), sk, motion);
  };
  if (xml('r15.json') !== xml('r15-nuevo.json')) { fails++; console.log('FALLO: el R15 con AnimationConstraint no exporta igual que el de Motor6D'); }
}
console.log(`${files} archivos .rbxmx generados; ${fails ? fails + ' fallos' : 'todo correcto'}`);
process.exit(fails ? 1 : 0);
