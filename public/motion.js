// Reglas de movimiento por articulación.
//
// En vez de pedir a la IA giros "x, y, z" (que dependen de cómo esté orientado cada
// hueso), cada articulación tiene tres movimientos con significado fijo:
//   bend  (doblar)   — p. ej. rodilla: + dobla la rodilla; brazo: + adelante; cabeza: + mira abajo
//   side  (lateral)  — p. ej. brazo/pierna: + se separa del cuerpo; columna/cabeza: + hacia su derecha
//   twist (girar)    — giro sobre el eje del propio hueso; columna/cabeza: + gira hacia su derecha
// Aquí se calcula, para cada articulación, el eje real de cada movimiento a partir de la
// forma del esqueleto en reposo, y los límites realistas (nada se dobla al revés).

import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const DOWN = V(0, -1, 0);
const FWD = V(0, 0, -1); // el personaje mira hacia -Z
const BACK = V(0, 0, 1);
const RIGHT = V(1, 0, 0);
const DEG = Math.PI / 180;

// Límites en grados: [mín, máx] para bend, side y twist. Relativos a la pose de reposo.
export const LIMITS = {
  root: { bend: [-90, 90], side: [-45, 45], twist: [-180, 180] },
  spine: { bend: [-25, 40], side: [-25, 25], twist: [-35, 35] },
  neck: { bend: [-40, 55], side: [-35, 35], twist: [-60, 60] },
  head: { bend: [-45, 45], side: [-30, 30], twist: [-70, 70] },
  jaw: { bend: [0, 40], side: [-5, 5], twist: [0, 0] },
  tail: { bend: [-35, 45], side: [-40, 40], twist: [-15, 15] },
  'arm.clavicle': { bend: [-15, 25], side: [-20, 20], twist: [0, 0] },
  'arm.upper': { bend: [-60, 175], side: [-25, 175], twist: [-90, 90] },
  'arm.lower': { bend: [0, 150], side: [-5, 5], twist: [-80, 80] },
  hand: { bend: [-70, 70], side: [-30, 30], twist: [-30, 30] },
  'leg.upper': { bend: [-45, 120], side: [-20, 60], twist: [-40, 40] },
  'leg.lower': { bend: [0, 150], side: [-5, 5], twist: [-10, 10] },
  'leg.lower2': { bend: [-20, 110], side: [-5, 5], twist: [-10, 10] },
  foot: { bend: [-40, 50], side: [-15, 15], twist: [-15, 15] },
  toe: { bend: [-40, 40], side: [0, 0], twist: [0, 0] },
  'wing.1': { bend: [-80, 80], side: [-45, 45], twist: [-45, 45] },
  'wing.2': { bend: [-20, 140], side: [-30, 30], twist: [-20, 20] },
  hinge: { bend: [-110, 110], side: [0, 0], twist: [0, 0] },
  fixed: { bend: [0, 0], side: [0, 0], twist: [0, 0] },
};

// Qué significa el signo positivo de cada movimiento (para explicárselo a la IA y a la web).
export const MEANING = {
  root: { bend: 'inclinar todo el cuerpo hacia delante', side: 'inclinarse hacia su derecha', twist: 'girar todo el cuerpo hacia su derecha' },
  spine: { bend: 'encorvarse hacia delante', side: 'inclinarse hacia su derecha', twist: 'girar el torso hacia su derecha' },
  neck: { bend: 'bajar la cabeza', side: 'ladear hacia su derecha', twist: 'girar hacia su derecha' },
  head: { bend: 'mirar hacia abajo', side: 'ladear la cabeza hacia su derecha', twist: 'girar la cabeza hacia su derecha' },
  jaw: { bend: 'abrir la boca', side: 'desplazar a su derecha', twist: '-' },
  tail: { bend: 'levantar la cola', side: 'mover la cola hacia su derecha', twist: 'girar la cola' },
  'arm.clavicle': { bend: 'encoger el hombro (subir)', side: 'adelantar el hombro', twist: '-' },
  'arm.upper': { bend: 'llevar el brazo hacia delante/arriba', side: 'separar el brazo del cuerpo hacia fuera', twist: 'rotar el brazo hacia fuera' },
  'arm.lower': { bend: 'doblar el codo', side: '-', twist: 'girar el antebrazo' },
  hand: { bend: 'doblar la muñeca hacia delante', side: 'muñeca hacia fuera', twist: 'girar la mano' },
  'leg.upper': { bend: 'llevar la pierna/pata hacia delante', side: 'separar la pierna hacia fuera', twist: 'rotar la pierna hacia fuera' },
  'leg.lower': { bend: 'doblar la rodilla (el pie va hacia atrás)', side: '-', twist: '-' },
  'leg.lower2': { bend: 'doblar el corvejón/muñeca de la pata', side: '-', twist: '-' },
  foot: { bend: 'apuntar los dedos hacia abajo', side: 'girar el pie hacia fuera', twist: 'girar el pie' },
  toe: { bend: 'doblar los dedos hacia abajo', side: '-', twist: '-' },
  'wing.1': { bend: 'batir el ala hacia abajo (negativo = arriba)', side: 'llevar el ala hacia delante', twist: 'girar el ala' },
  'wing.2': { bend: 'plegar el ala hacia atrás', side: 'bajar la punta', twist: 'girar' },
  hinge: { bend: 'abrir (girar sobre la bisagra)', side: '-', twist: '-' },
  fixed: { bend: '-', side: '-', twist: '-' },
};

// Dirección "natural" de cada movimiento: [bend preferido, bend alternativo, side preferido, side alternativo].
function directions(role, side, region) {
  const OUT = side === 'L' ? V(-1, 0, 0) : RIGHT;
  switch (role) {
    case 'root': case 'spine': return [FWD, DOWN, RIGHT, UP];
    case 'neck': case 'head': return [FWD, DOWN, RIGHT, UP];
    case 'jaw': return [DOWN, BACK, RIGHT, UP];
    case 'tail': return [UP, BACK, RIGHT, UP];
    case 'arm.clavicle': return [UP, FWD, FWD, UP];
    case 'arm.upper': return [FWD, UP, OUT, UP];
    case 'arm.lower': return [FWD, UP, OUT, UP];
    case 'hand': return [FWD, UP, OUT, UP];
    case 'leg.upper': return [FWD, DOWN, OUT, UP];
    case 'leg.lower': return [BACK, UP, OUT, UP];
    case 'leg.lower2': return [region === 'front' ? BACK : FWD, UP, OUT, UP];
    case 'foot': case 'toe': return [DOWN, BACK, OUT, UP];
    case 'wing.1': return [DOWN, BACK, FWD, UP];
    case 'wing.2': return [BACK, DOWN, DOWN, FWD];
    case 'hinge': return [FWD, RIGHT, UP, RIGHT];
    default: return [FWD, UP, RIGHT, UP];
  }
}

const perpTo = (v, axis) => v.clone().sub(axis.clone().multiplyScalar(v.dot(axis)));

function pick(d, preferred, fallback, alsoPerp) {
  for (const cand of [preferred, fallback]) {
    let p = perpTo(cand, d);
    if (alsoPerp) p = perpTo(p, alsoPerp);
    if (p.length() > 0.35) return p.normalize();
  }
  // Último recurso: cualquier perpendicular.
  const any = Math.abs(d.y) < 0.9 ? UP : RIGHT;
  return perpTo(any, d).normalize();
}

// Dirección del hueso en reposo (hacia dónde apunta).
function boneDirection(joint, roles) {
  const role = roles[joint.name]?.role;
  if (role === 'root') return UP.clone();
  if (role === 'hinge') {
    if (joint.partCFrame) {
      const c = V(joint.partCFrame[0], joint.partCFrame[1], joint.partCFrame[2]).sub(joint.restPos);
      if (c.length() > 1e-3) return c.normalize();
    }
    return RIGHT.clone();
  }
  if (role === 'foot' || role === 'toe' || role === 'jaw') return FWD.clone();
  // Hijo que continúa la misma cadena (no la mandíbula ni piezas fijas).
  const same = joint.children.filter((c) => !['jaw', 'fixed'].includes(roles[c.name]?.role));
  const cont = same.find((c) => sameLimb(role, roles[c.name]?.role)) || same[0];
  if (cont) {
    const v = cont.restPos.clone().sub(joint.restPos);
    if (v.length() > 1e-3) return v.normalize();
  }
  if (joint.partCFrame) {
    const v = V(joint.partCFrame[0], joint.partCFrame[1], joint.partCFrame[2]).sub(joint.restPos);
    if (v.length() > 1e-3 && role !== 'head') return v.normalize();
  }
  if (role === 'head' || role === 'neck' || role === 'spine') {
    return joint.parentNode ? boneDirection(joint.parentNode, roles) : UP.clone();
  }
  return joint.parentNode ? boneDirection(joint.parentNode, roles) : UP.clone();
}

function sameLimb(a, b) {
  const fam = (r) => (['root', 'spine', 'neck', 'head'].includes(r) ? 'trunk' : String(r).split('.')[0]);
  return a && b && fam(a) === fam(b);
}

// Prepara las reglas de todas las articulaciones.
// `roles` = { nombre: { role, side, region } } (de classify.js, quizá corregido a mano).
export function buildMotion(skeleton, roles) {
  const joints = {};
  let rootJoint = null;
  for (const j of skeleton.joints) {
    const info = roles[j.name] || { role: 'fixed', side: 'C' };
    const role = LIMITS[info.role] ? info.role : 'fixed';
    const d = boneDirection(j, roles);
    const [bp, bf, sp, sf] = directions(role, info.side, info.region);
    let bendAxis;
    let bendDir;
    if (role === 'hinge' && Array.isArray(j.hingeAxis)) {
      bendAxis = V(...j.hingeAxis).normalize();
      bendDir = bendAxis.clone().cross(d).normalize();
    } else {
      bendDir = pick(d, bp, bf);
      bendAxis = d.clone().cross(bendDir).normalize();
    }
    const sideDir = pick(d, sp, sf, bendDir);
    const sideAxis = d.clone().cross(sideDir).normalize();
    // twist positivo lleva la dirección de "bend" hacia la de "side".
    const twistAxis = d.clone().multiplyScalar(Math.sign(d.clone().cross(bendDir).dot(sideDir)) || 1);

    const toLocal = j.restRot.clone().invert();
    joints[j.name] = {
      name: j.name,
      role,
      side: info.side,
      region: info.region,
      limits: LIMITS[role],
      direction: d,
      axes: {
        bend: bendAxis.applyQuaternion(toLocal),
        side: sideAxis.applyQuaternion(toLocal),
        twist: twistAxis.applyQuaternion(toLocal),
      },
    };
    if (role === 'root' && !rootJoint) rootJoint = j.name;
  }
  if (!rootJoint) rootJoint = skeleton.joints.find((j) => !j.parentNode)?.name;
  const root = skeleton.byName[rootJoint];
  return { joints, rootJoint, rootToLocal: root ? root.restRot.clone().invert() : new THREE.Quaternion() };
}

const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

// Aplica límites. Devuelve los valores corregidos y la lista de excesos (para el registro).
export function clampValues(motionJoint, values) {
  const out = {};
  const exceeded = [];
  for (const k of ['bend', 'side', 'twist']) {
    const v = Number(values[k]) || 0;
    const c = clampTo(v, motionJoint.limits[k]);
    if (Math.abs(c - v) > 0.5) exceeded.push({ joint: motionJoint.name, motion: k, value: Math.round(v), limit: motionJoint.limits[k] });
    out[k] = c;
  }
  return { values: out, exceeded };
}

// bend/side/twist (grados) -> giro local de la articulación.
export function valuesToQuaternion(motionJoint, { bend = 0, side = 0, twist = 0 }) {
  const { axes } = motionJoint;
  return new THREE.Quaternion().setFromAxisAngle(axes.bend, bend * DEG)
    .multiply(new THREE.Quaternion().setFromAxisAngle(axes.side, side * DEG))
    .multiply(new THREE.Quaternion().setFromAxisAngle(axes.twist, twist * DEG));
}

// Desplazamiento de la raíz {right, up, forward} (studs, en el mundo) -> traslación local.
export function rootOffsetToLocal(motion, { right = 0, up = 0, forward = 0 }) {
  return V(right, up, -forward).applyQuaternion(motion.rootToLocal);
}

// Descripción en texto de la dirección de reposo (para que la IA entienda la pose inicial).
export function describeDirection(v) {
  const parts = [];
  if (v.y > 0.4) parts.push('arriba'); else if (v.y < -0.4) parts.push('abajo');
  if (v.z < -0.4) parts.push('delante'); else if (v.z > 0.4) parts.push('atrás');
  if (v.x > 0.4) parts.push('su derecha'); else if (v.x < -0.4) parts.push('su izquierda');
  return parts.join('-') || 'centro';
}
