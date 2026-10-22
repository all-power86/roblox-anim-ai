// Comprueba que "+bend" y "+side" mueven cada hueso en la dirección prometida,
// en todos los esqueletos de prueba (incluidos R6 con C0 girados y huesos torcidos).
import fs from 'node:fs';
import * as THREE from 'three';
import { prepareSkeleton, forwardKinematics } from '../public/skeleton.js';
import { classifySkeleton } from '../public/classify.js';
import { buildMotion, valuesToQuaternion } from '../public/motion.js';

const dir = new URL('../public/skeletons/', import.meta.url);
let fails = 0;
let checks = 0;
for (const f of fs.readdirSync(dir)) {
  const sk = prepareSkeleton(JSON.parse(fs.readFileSync(new URL(f, dir))));
  const roles = classifySkeleton(sk).joints;
  const motion = buildMotion(sk, roles);
  for (const j of sk.joints) {
    const m = motion.joints[j.name];
    if (m.role === 'fixed') continue;
    // Punto de prueba: la punta del hueso (en reposo) = posición + dirección.
    const tipLocal = m.direction.clone().applyQuaternion(j.restRot.clone().invert());
    for (const [motionName, expected] of [['bend', null], ['side', null]]) {
      const lim = m.limits[motionName];
      const amount = lim[1] >= 20 ? 20 : lim[1];
      if (amount < 5) continue;
      const q = valuesToQuaternion(m, { [motionName]: amount });
      const w = forwardKinematics(sk, { rot: { [j.name]: q } });
      const tip = tipLocal.clone().applyMatrix4(w[j.name]);
      const restTip = j.restPos.clone().add(m.direction);
      const moved = tip.sub(restTip);
      // Dirección esperada: el eje (mundo) x dirección del hueso.
      const axisWorld = m.axes[motionName].clone().applyQuaternion(j.restRot);
      const want = axisWorld.clone().cross(m.direction).normalize();
      checks++;
      if (moved.length() < 1e-3 || moved.normalize().dot(want) < 0.9) {
        fails++;
        console.log('FALLO', f, j.name, motionName, moved.toArray().map((v) => v.toFixed(2)), want.toArray().map((v) => v.toFixed(2)));
      }
    }
  }
}

// Comprobaciones concretas de sentido común (mundo): rodilla R15 hacia atrás, brazo R6 hacia delante,
// ala del dragón hacia abajo, cabeza del lobo mira abajo, puerta gira alrededor del eje vertical.
function tipAfter(file, joint, values) {
  const sk = prepareSkeleton(JSON.parse(fs.readFileSync(new URL(file, dir))));
  const motion = buildMotion(sk, classifySkeleton(sk).joints);
  const j = sk.byName[joint];
  const m = motion.joints[joint];
  const tipLocal = m.direction.clone().applyQuaternion(j.restRot.clone().invert());
  const w = forwardKinematics(sk, { rot: { [joint]: valuesToQuaternion(m, values) } });
  return tipLocal.applyMatrix4(w[joint]).sub(j.restPos.clone().add(m.direction));
}
const expectations = [
  ['r15.json', 'RightKnee', { bend: 60 }, (d) => d.z > 0.3, 'la espinilla va hacia atrás (+Z)'],
  ['r15.json', 'RightHip', { bend: 40 }, (d) => d.z < -0.3, 'el muslo va hacia delante (-Z)'],
  ['r15.json', 'RightShoulder', { side: 60 }, (d) => d.x > 0.3, 'el brazo derecho se abre hacia +X'],
  ['r15.json', 'LeftShoulder', { side: 60 }, (d) => d.x < -0.3, 'el brazo izquierdo se abre hacia -X'],
  ['r6.json', 'Right Shoulder', { bend: 60 }, (d) => d.z < -0.3, 'brazo R6 hacia delante'],
  ['r6.json', 'Left Hip', { bend: 40 }, (d) => d.z < -0.3, 'pierna R6 hacia delante'],
  ['dragon.json', 'Bone.010_L', { bend: 40 }, (d) => d.y < -0.3, 'el ala baja'],
  ['lobo.json', 'Head', { bend: 30 }, (d) => d.y < -0.1, 'el lobo mira hacia abajo'],
  ['lobo.json', 'Tail1', { bend: 30 }, (d) => d.y > 0.2, 'la cola sube'],
  ['puerta.json', 'Bisagra', { bend: 60 }, (d) => d.z < -0.3 && Math.abs(d.y) < 1e-6, 'la puerta gira en horizontal hacia delante'],
];
for (const [file, joint, values, ok, text] of expectations) {
  checks++;
  const d = tipAfter(file, joint, values);
  if (!ok(d)) { fails++; console.log('FALLO', file, joint, text, d.toArray().map((v) => v.toFixed(2))); }
}
console.log(`${checks - fails}/${checks} comprobaciones correctas`);
process.exit(fails ? 1 : 0);
