// Genera los esqueletos de prueba en public/skeletons/*.json.
// Uso: node tools/make-skeletons.mjs

import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { matrixToCframe, FORMAT_ID } from '../public/skeleton.js';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '../public/skeletons');
fs.mkdirSync(OUT, { recursive: true });

const r = (v) => Math.round(v * 1e4) / 1e4;
const cf = (m) => matrixToCframe(m).map(r);
const at = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const angles = (rx, ry, rz) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));

function save(file, skeleton) {
  fs.writeFileSync(path.join(OUT, file), JSON.stringify({ format: FORMAT_ID, ...skeleton }, null, 1));
  console.log('escrito', file, skeleton.joints.length, 'articulaciones');
}

// ---------- Motor6D: articulaciones alineadas con el mundo ----------
// spec: [nombreJoint, padre, pieza, posJoint, tamañoPieza, centroPieza(relativo a la articulación)]
function motorRig(name, rootPart, spec, extra = {}) {
  const joints = spec.map(([jn, parent, part, pos, size, center]) => ({
    name: jn,
    type: 'Motor6D',
    parent,
    part,
    cframe: cf(at(...pos)),
    partSize: size,
    partCFrame: cf(at(pos[0] + center[0], pos[1] + center[1], pos[2] + center[2])),
  }));
  return { name, rootPart, ...extra, joints };
}

// R15 (bloques, proporciones del rig por defecto)
const H = 2.7;
save('r15.json', motorRig('R15', 'HumanoidRootPart', [
  ['Root', null, 'LowerTorso', [0, H, 0], [2, 0.4, 1], [0, 0.2, 0]],
  ['Waist', 'Root', 'UpperTorso', [0, H + 0.4, 0], [2, 1.6, 1], [0, 0.8, 0]],
  ['Neck', 'Waist', 'Head', [0, H + 2.0, 0], [1.2, 1.2, 1.2], [0, 0.6, 0]],
  ['RightShoulder', 'Waist', 'RightUpperArm', [1.5, H + 1.9, 0], [1, 1.1, 1], [0, -0.45, 0]],
  ['RightElbow', 'RightShoulder', 'RightLowerArm', [1.5, H + 0.9, 0], [0.95, 1.0, 0.95], [0, -0.5, 0]],
  ['RightWrist', 'RightElbow', 'RightHand', [1.5, H - 0.1, 0], [0.9, 0.4, 0.9], [0, -0.2, 0]],
  ['LeftShoulder', 'Waist', 'LeftUpperArm', [-1.5, H + 1.9, 0], [1, 1.1, 1], [0, -0.45, 0]],
  ['LeftElbow', 'LeftShoulder', 'LeftLowerArm', [-1.5, H + 0.9, 0], [0.95, 1.0, 0.95], [0, -0.5, 0]],
  ['LeftWrist', 'LeftElbow', 'LeftHand', [-1.5, H - 0.1, 0], [0.9, 0.4, 0.9], [0, -0.2, 0]],
  ['RightHip', 'Root', 'RightUpperLeg', [0.5, H, 0], [1, 1.2, 1], [0, -0.6, 0]],
  ['RightKnee', 'RightHip', 'RightLowerLeg', [0.5, H - 1.2, 0], [0.95, 1.2, 0.95], [0, -0.6, 0]],
  ['RightAnkle', 'RightKnee', 'RightFoot', [0.5, H - 2.4, 0], [1, 0.3, 1.2], [0, -0.15, -0.1]],
  ['LeftHip', 'Root', 'LeftUpperLeg', [-0.5, H, 0], [1, 1.2, 1], [0, -0.6, 0]],
  ['LeftKnee', 'LeftHip', 'LeftLowerLeg', [-0.5, H - 1.2, 0], [0.95, 1.2, 0.95], [0, -0.6, 0]],
  ['LeftAnkle', 'LeftKnee', 'LeftFoot', [-0.5, H - 2.4, 0], [1, 0.3, 1.2], [0, -0.15, -0.1]],
]));

// R15 nuevo de Studio: AnimationConstraint en lugar de Motor6D, cada una con su
// BallSocketConstraint (física del ragdoll, que el programa ignora).
{
  const r15 = JSON.parse(fs.readFileSync(path.join(OUT, 'r15.json')));
  const joints = [];
  for (const j of r15.joints) {
    joints.push({ ...j, type: 'AnimationConstraint' });
    if (j.parent) joints.push({ name: `${j.name}BallSocket`, type: 'BallSocketConstraint', parent: j.parent, part: j.part, cframe: j.cframe });
  }
  save('r15-nuevo.json', { name: 'R15 nuevo (AnimationConstraint)', rootPart: r15.rootPart, joints });
}

// R6: articulaciones con los C0 girados del rig real de Roblox.
{
  const torso = at(0, 3, 0);
  const pi = Math.PI;
  const joint = (name, parent, part, c0, size, partPos) => ({
    name, type: 'Motor6D', parent, part,
    cframe: cf(torso.clone().multiply(c0)),
    partSize: size,
    partCFrame: cf(at(...partPos)),
  });
  save('r6.json', {
    name: 'R6',
    rootPart: 'HumanoidRootPart',
    joints: [
      { name: 'RootJoint', type: 'Motor6D', parent: null, part: 'Torso', cframe: cf(torso.clone().multiply(angles(-pi / 2, 0, pi))), partSize: [2, 2, 1], partCFrame: cf(torso) },
      joint('Neck', 'RootJoint', 'Head', at(0, 1, 0).multiply(angles(-pi / 2, 0, pi)), [1.2, 1.2, 1.2], [0, 4.6, 0]),
      joint('Right Shoulder', 'RootJoint', 'Right Arm', at(1, 0.5, 0).multiply(angles(0, pi / 2, 0)), [1, 2, 1], [1.5, 3, 0]),
      joint('Left Shoulder', 'RootJoint', 'Left Arm', at(-1, 0.5, 0).multiply(angles(0, -pi / 2, 0)), [1, 2, 1], [-1.5, 3, 0]),
      joint('Right Hip', 'RootJoint', 'Right Leg', at(1, -1, 0).multiply(angles(0, pi / 2, 0)), [1, 2, 1], [0.5, 1, 0]),
      joint('Left Hip', 'RootJoint', 'Left Leg', at(-1, -1, 0).multiply(angles(0, -pi / 2, 0)), [1, 2, 1], [-0.5, 1, 0]),
    ],
  });
}

// Yeti: bípedo grande, Motor6D con nombres en castellano.
{
  const h = 4.2; // altura de cadera
  save('yeti.json', motorRig('Yeti', 'HumanoidRootPart', [
    ['Raiz', null, 'Pelvis', [0, h, 0], [3.2, 1.0, 2.2], [0, 0.4, 0]],
    ['Cintura', 'Raiz', 'Pecho', [0, h + 0.9, 0], [3.7, 3.0, 2.6], [0, 1.5, 0.1]],
    ['Cuello', 'Cintura', 'Cabeza', [0, h + 3.9, -0.3], [1.9, 1.8, 1.9], [0, 0.8, -0.2]],
    ['HombroDer', 'Cintura', 'BrazoDer', [2.6, h + 3.2, 0], [1.4, 2.2, 1.4], [0, -1.0, 0]],
    ['CodoDer', 'HombroDer', 'AntebrazoDer', [2.6, h + 1.1, 0], [1.3, 2.0, 1.3], [0, -1.0, 0]],
    ['MunecaDer', 'CodoDer', 'ManoDer', [2.6, h - 0.9, 0], [1.4, 1.0, 1.2], [0, -0.5, 0]],
    ['HombroIzq', 'Cintura', 'BrazoIzq', [-2.6, h + 3.2, 0], [1.4, 2.2, 1.4], [0, -1.0, 0]],
    ['CodoIzq', 'HombroIzq', 'AntebrazoIzq', [-2.6, h + 1.1, 0], [1.3, 2.0, 1.3], [0, -1.0, 0]],
    ['MunecaIzq', 'CodoIzq', 'ManoIzq', [-2.6, h - 0.9, 0], [1.4, 1.0, 1.2], [0, -0.5, 0]],
    ['MusloDer', 'Raiz', 'MusloDerPieza', [0.9, h, 0], [1.5, 2.1, 1.5], [0, -1.05, 0]],
    ['RodillaDer', 'MusloDer', 'PiernaDer', [0.9, h - 2.1, 0], [1.4, 1.75, 1.4], [0, -0.87, 0]],
    ['TobilloDer', 'RodillaDer', 'PieDer', [0.9, h - 3.85, 0], [1.6, 0.35, 2.2], [0, -0.17, -0.4]],
    ['MusloIzq', 'Raiz', 'MusloIzqPieza', [-0.9, h, 0], [1.5, 2.1, 1.5], [0, -1.05, 0]],
    ['RodillaIzq', 'MusloIzq', 'PiernaIzq', [-0.9, h - 2.1, 0], [1.4, 1.75, 1.4], [0, -0.87, 0]],
    ['TobilloIzq', 'RodillaIzq', 'PieIzq', [-0.9, h - 3.85, 0], [1.6, 0.35, 2.2], [0, -0.17, -0.4]],
  ]));
}

// Puerta con bisagra (objeto).
save('puerta.json', motorRig('Puerta', 'Marco', [
  ['Bisagra', null, 'Hoja', [-2, 3.5, 0], [4, 7, 0.3], [2, 0, 0]],
]));

// ---------- Bones: huesos con el eje Y a lo largo del hueso (como Blender/Meshy) ----------
// spec: [nombre, padre, posición, radio]. La orientación se calcula apuntando al primer hijo,
// con un "roll" distinto en cada hueso para comprobar que las matemáticas no dependen de él.
function boneRig(name, mesh, spec) {
  const pos = Object.fromEntries(spec.map(([n, , p]) => [n, new THREE.Vector3(...p)]));
  const firstChild = {};
  for (const [n, parent] of spec) if (parent && !firstChild[parent]) firstChild[parent] = n;
  const joints = spec.map(([n, parent, p, radius], i) => {
    const from = pos[n];
    let dir = firstChild[n] ? pos[firstChild[n]].clone().sub(from) : (parent ? from.clone().sub(pos[parent]) : new THREE.Vector3(0, 1, 0));
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 0.7) % (2 * Math.PI)));
    const m = new THREE.Matrix4().compose(from, q, new THREE.Vector3(1, 1, 1));
    return { name: n, type: 'Bone', parent, part: parent ? undefined : mesh, cframe: cf(m), radius };
  });
  return { name, rootPart: mesh, joints };
}

// Duplica las partes izquierdas (x negativa) para crear las derechas.
const toRight = (n) => n && n.replace('_L', '_R').replace('.FL.', '.FR.').replace('.HL.', '.HR.');
const mirror = (spec) => spec.flatMap((s) => {
  if (toRight(s[0]) === s[0]) return [s];
  return [s, [toRight(s[0]), toRight(s[1]), [-s[2][0], s[2][1], s[2][2]], s[3]]];
});

// Lobo: cuadrúpedo con huesos bien nombrados.
save('lobo.json', boneRig('Lobo', 'WolfMesh', mirror([
  ['Hips', null, [0, 2.2, 0.9], 0.55],
  ['Spine1', 'Hips', [0, 2.25, 0.2], 0.55],
  ['Spine2', 'Spine1', [0, 2.3, -0.5], 0.6],
  ['Chest', 'Spine2', [0, 2.35, -1.1], 0.6],
  ['Neck', 'Chest', [0, 2.6, -1.5], 0.35],
  ['Head', 'Neck', [0, 3.0, -1.9], 0.4],
  ['Jaw', 'Head', [0, 2.8, -2.1], 0.18],
  ['Tail1', 'Hips', [0, 2.3, 1.3], 0.18],
  ['Tail2', 'Tail1', [0, 2.05, 1.9], 0.15],
  ['Tail3', 'Tail2', [0, 1.7, 2.45], 0.12],
  ['FrontLeg_L_1', 'Chest', [-0.45, 2.0, -1.1], 0.22],
  ['FrontLeg_L_2', 'FrontLeg_L_1', [-0.45, 1.1, -1.0], 0.18],
  ['FrontLeg_L_3', 'FrontLeg_L_2', [-0.45, 0.3, -1.05], 0.14],
  ['FrontPaw_L', 'FrontLeg_L_3', [-0.45, 0.07, -1.3], 0.13],
  ['HindLeg_L_1', 'Hips', [-0.45, 2.0, 0.9], 0.26],
  ['HindLeg_L_2', 'HindLeg_L_1', [-0.45, 1.25, 0.65], 0.18],
  ['HindLeg_L_3', 'HindLeg_L_2', [-0.45, 0.6, 1.1], 0.14],
  ['HindPaw_L', 'HindLeg_L_3', [-0.45, 0.07, 1.0], 0.13],
])));

// Dragón: cuadrúpedo con alas y cola larga. Las alas tienen nombres genéricos
// ("Bone.0xx") para obligar a clasificarlas por la forma.
save('dragon.json', boneRig('Dragon', 'DragonMesh', mirror([
  ['Root', null, [0, 3.2, 1.2], 0.9],
  ['Spine.1', 'Root', [0, 3.3, 0.0], 0.95],
  ['Spine.2', 'Spine.1', [0, 3.5, -1.3], 0.95],
  ['Neck.1', 'Spine.2', [0, 4.1, -2.2], 0.55],
  ['Neck.2', 'Neck.1', [0, 4.9, -2.8], 0.48],
  ['Neck.3', 'Neck.2', [0, 5.6, -3.3], 0.42],
  ['Head', 'Neck.3', [0, 5.9, -3.9], 0.55],
  ['Jaw', 'Head', [0, 5.55, -4.3], 0.3],
  ['Tail.1', 'Root', [0, 3.1, 2.4], 0.6],
  ['Tail.2', 'Tail.1', [0, 2.8, 3.6], 0.45],
  ['Tail.3', 'Tail.2', [0, 2.4, 4.8], 0.32],
  ['Tail.4', 'Tail.3', [0, 2.0, 6.0], 0.2],
  ['Leg.FL.1', 'Spine.2', [-0.9, 2.9, -1.3], 0.38],
  ['Leg.FL.2', 'Leg.FL.1', [-1.0, 1.6, -1.1], 0.3],
  ['Leg.FL.3', 'Leg.FL.2', [-1.0, 0.25, -1.2], 0.26],
  ['Leg.FL.4', 'Leg.FL.3', [-1.0, 0.1, -1.7], 0.2],
  ['Leg.HL.1', 'Root', [-1.0, 2.9, 1.2], 0.45],
  ['Leg.HL.2', 'Leg.HL.1', [-1.05, 1.7, 0.8], 0.35],
  ['Leg.HL.3', 'Leg.HL.2', [-1.05, 0.7, 1.5], 0.25],
  ['Leg.HL.4', 'Leg.HL.3', [-1.05, 0.1, 1.2], 0.2],
  ['Bone.010_L', 'Spine.2', [-0.8, 4.0, -1.0], 0.3],
  ['Bone.011_L', 'Bone.010_L', [-3.0, 4.8, -0.6], 0.22],
  ['Bone.012_L', 'Bone.011_L', [-5.6, 5.0, 0.2], 0.15],
  ['Bone.013_L', 'Bone.012_L', [-7.8, 4.2, 1.2], 0.1],
]))); 
