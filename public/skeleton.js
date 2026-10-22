// Esqueleto universal: carga el JSON (ver docs/formato-esqueleto.md), prepara las
// matrices de reposo y calcula la cinemática directa (dónde está cada articulación
// para una pose dada). Lo usan la vista previa, el análisis de fallos y la exportación.
//
// Convención: Y arriba, el personaje mira hacia -Z, su derecha es +X (como Roblox).

import * as THREE from 'three';

export const FORMAT_ID = 'roblox-anim-ai/skeleton@1';

// Articulaciones que mueven una pieza entera (Part1). Los rigs R15 nuevos de Studio usan
// AnimationConstraint en lugar de Motor6D; para animar funcionan igual.
export const PART_JOINTS = new Set(['Motor6D', 'AnimationConstraint']);
// Restricciones físicas que acompañan a las articulaciones (p. ej. BallSocketConstraint junto a
// cada AnimationConstraint, para el ragdoll). No se animan: se ignoran al cargar.
export const IGNORED_TYPES = new Set(['BallSocketConstraint']);

// CFrame de Roblox (12 números: X Y Z R00 R01 R02 R10 R11 R12 R20 R21 R22) -> Matrix4.
export function cframeToMatrix(c) {
  const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = c;
  return new THREE.Matrix4().set(
    r00, r01, r02, x,
    r10, r11, r12, y,
    r20, r21, r22, z,
    0, 0, 0, 1,
  );
}

export function matrixToCframe(m) {
  const e = m.elements; // por columnas
  return [e[12], e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
}

// Comprueba el JSON y devuelve una lista de errores en castellano (vacía si es válido).
export function validateSkeleton(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return ['El archivo no es un objeto JSON.'];
  if (!Array.isArray(raw.joints) || raw.joints.length === 0) return ['Falta la lista "joints".'];
  const names = new Set();
  for (const [i, j] of raw.joints.entries()) {
    const where = `Articulación ${i + 1} (${j?.name ?? 'sin nombre'})`;
    if (typeof j.name !== 'string' || !j.name) errors.push(`${where}: falta "name".`);
    if (names.has(j.name)) errors.push(`${where}: nombre repetido.`);
    names.add(j.name);
    if (!PART_JOINTS.has(j.type) && j.type !== 'Bone') errors.push(`${where}: "type" debe ser "Motor6D", "AnimationConstraint" o "Bone".`);
    if (!Array.isArray(j.cframe) || j.cframe.length !== 12 || j.cframe.some((v) => typeof v !== 'number')) {
      errors.push(`${where}: "cframe" debe tener 12 números.`);
    }
    if (PART_JOINTS.has(j.type) && !j.part) errors.push(`${where}: un ${j.type} necesita "part" (la pieza que mueve).`);
  }
  for (const j of raw.joints) {
    if (j.parent != null && !names.has(j.parent)) errors.push(`${j.name}: el padre "${j.parent}" no existe.`);
  }
  // Ciclos
  const byName = Object.fromEntries(raw.joints.map((j) => [j.name, j]));
  for (const j of raw.joints) {
    let cur = j;
    for (let steps = 0; cur && cur.parent != null; steps++) {
      if (steps > raw.joints.length) { errors.push(`${j.name}: la jerarquía tiene un ciclo.`); break; }
      cur = byName[cur.parent];
    }
  }
  return errors;
}

// Prepara el esqueleto: ordena padres antes que hijos y calcula matrices de reposo.
export function prepareSkeleton(raw) {
  const ignored = Array.isArray(raw?.joints) ? raw.joints.filter((j) => IGNORED_TYPES.has(j?.type)) : [];
  if (ignored.length) raw = { ...raw, joints: raw.joints.filter((j) => !IGNORED_TYPES.has(j?.type)) };
  const errors = validateSkeleton(raw);
  if (errors.length) throw new Error(errors.join('\n'));

  const byName = {};
  const ordered = [];
  const visit = (j) => {
    if (byName[j.name]) return;
    if (j.parent != null) visit(raw.joints.find((p) => p.name === j.parent));
    const parent = j.parent != null ? byName[j.parent] : null;
    const restWorld = cframeToMatrix(j.cframe);
    const node = {
      ...j,
      index: ordered.length,
      parentNode: parent,
      children: [],
      restWorld,
      restLocal: parent ? parent.restWorld.clone().invert().multiply(restWorld) : restWorld.clone(),
      restPos: new THREE.Vector3().setFromMatrixPosition(restWorld),
      restRot: new THREE.Quaternion().setFromRotationMatrix(restWorld),
      // Pieza que mueve (Motor6D/AnimationConstraint) en el espacio de la articulación, para dibujarla.
      partOffset: j.partCFrame ? restWorld.clone().invert().multiply(cframeToMatrix(j.partCFrame)) : null,
    };
    if (parent) parent.children.push(node);
    byName[j.name] = node;
    ordered.push(node);
  };
  raw.joints.forEach(visit);

  const skeleton = {
    name: raw.name || 'Esqueleto',
    rootPart: raw.rootPart || 'HumanoidRootPart',
    raw,
    joints: ordered,
    byName,
    ignored: ignored.map((j) => `${j.name} (${j.type})`),
  };

  // Medidas generales (en reposo): suelo, altura, tamaño.
  const pts = restPoints(skeleton);
  const box = new THREE.Box3().setFromPoints(pts);
  skeleton.ground = raw.ground ?? box.min.y;
  skeleton.size = box.getSize(new THREE.Vector3());
  skeleton.center = box.getCenter(new THREE.Vector3());
  return skeleton;
}

// Puntos representativos del cuerpo en reposo (articulaciones y esquinas de piezas).
function restPoints(skeleton) {
  const pts = [];
  for (const j of skeleton.joints) {
    pts.push(j.restPos.clone());
    if (j.partCFrame && j.partSize) {
      const m = cframeToMatrix(j.partCFrame);
      const [sx, sy, sz] = j.partSize.map((v) => v / 2);
      for (const dx of [-sx, sx]) for (const dy of [-sy, sy]) for (const dz of [-sz, sz]) {
        pts.push(new THREE.Vector3(dx, dy, dz).applyMatrix4(m));
      }
    }
  }
  return pts;
}

// Cinemática directa. `pose.rot[name]` = Quaternion local (giro sobre el marco de reposo),
// `pose.offset[name]` = Vector3 de traslación local (solo la raíz suele tenerla).
// Devuelve matrices de mundo por articulación (marco de la articulación ya girado).
export function forwardKinematics(skeleton, pose, out = {}) {
  const t = new THREE.Matrix4();
  for (const j of skeleton.joints) {
    const q = pose.rot?.[j.name];
    const o = pose.offset?.[j.name];
    t.compose(o || ZERO, q || IDENTITY, ONE);
    const parentWorld = j.parentNode ? out[j.parentNode.name] : null;
    const m = out[j.name] || new THREE.Matrix4();
    if (parentWorld) m.multiplyMatrices(parentWorld, j.restLocal).multiply(t);
    else m.multiplyMatrices(j.restLocal, t);
    out[j.name] = m;
  }
  return out;
}

const ZERO = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const IDENTITY = new THREE.Quaternion();
