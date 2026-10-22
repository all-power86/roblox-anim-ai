// Exporta una animación a .rbxmx (modelo XML de Roblox) con una KeyframeSequence.
//
//   [contenedor "AnimSaves"]  Folder | ObjectValue | (ninguno) — configurable
//     └ KeyframeSequence
//         └ Keyframe (uno por instante)
//             └ Pose <rootPart>            (la pieza fija, p. ej. HumanoidRootPart)
//                 └ Pose <Part1>           Motor6D o AnimationConstraint: la pose lleva el nombre de la pieza que mueve
//                     └ Pose <Bone>        Bone: la pose lleva el nombre del hueso
//
// Cada Pose guarda en su CFrame el Transform de su Motor6D, AnimationConstraint o Bone.
// Probado en Studio (22/10/2026): con el contenedor Folder el Editor de Animaciones carga
// la animación del R15 y la del lobo con huesos (lista toda la jerarquía de huesos).

import * as THREE from 'three';
import { bakeAnimation } from './animation.js';
import { PART_JOINTS } from './skeleton.js';

export const CONTAINERS = {
  Folder: 'Carpeta (Folder) "AnimSaves" — recomendado, probado en Studio',
  ObjectValue: 'ObjectValue "AnimSaves"',
  none: 'Sin contenedor (solo la KeyframeSequence)',
};

const EASING_STYLE = { Linear: 0, Constant: 1, Cubic: 3 }; // PoseEasingStyle
const EASING_DIRECTION_INOUT = 2; // PoseEasingDirection
const PRIORITY_ACTION = 2; // AnimationPriority.Action

const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const num = (v) => (Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(6)));

function cframeXml(position, quaternion) {
  const e = new THREE.Matrix4().makeRotationFromQuaternion(quaternion).elements; // por columnas
  const values = [position.x, position.y, position.z, e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]].map(num);
  const tags = ['X', 'Y', 'Z', 'R00', 'R01', 'R02', 'R10', 'R11', 'R12', 'R20', 'R21', 'R22'];
  return `<CoordinateFrame name="CFrame">${tags.map((t, i) => `<${t}>${values[i]}</${t}>`).join('')}</CoordinateFrame>`;
}

// Nombre de la pose de cada articulación (lo que Roblox usa para encontrar la articulación):
// Motor6D y AnimationConstraint, la pieza que mueven (Part1); Bone, el nombre del hueso.
export const poseName = (joint) => (PART_JOINTS.has(joint.type) ? joint.part : joint.name);

// Árbol de poses (igual para todos los keyframes): raíz = rootPart.
function poseTree(skeleton) {
  const root = { name: skeleton.rootPart, joint: null, children: [] };
  const nodeOf = new Map();
  const extraParts = new Map(); // MeshParts contenedoras que no mueve ninguna articulación
  for (const j of skeleton.joints) {
    const node = { name: poseName(j), joint: j, children: [] };
    nodeOf.set(j.name, node);
    let parent;
    if (j.parentNode) parent = nodeOf.get(j.parentNode.name);
    else if (j.type === 'Bone' && j.part && j.part !== skeleton.rootPart) {
      const owner = skeleton.joints.find((m) => PART_JOINTS.has(m.type) && m.part === j.part);
      parent = owner ? nodeOf.get(owner.name) : null;
      if (!parent) {
        if (!extraParts.has(j.part)) {
          const p = { name: j.part, joint: null, children: [] };
          extraParts.set(j.part, p);
          root.children.push(p);
        }
        parent = extraParts.get(j.part);
      }
    } else parent = root;
    parent.children.push(node);
  }
  return root;
}

let ref = 0;
const nextRef = () => `RBX${(ref++).toString(16).toUpperCase().padStart(8, '0')}`;

export function toRbxmx(anim, skeleton, motion, { container = 'Folder' } = {}) {
  ref = 0;
  const baked = bakeAnimation(anim, skeleton, motion);
  const tree = poseTree(skeleton);
  const zero = new THREE.Vector3();
  const identity = new THREE.Quaternion();

  const keyframesXml = baked.keyframes.map((k) => {
    const build = (node) => {
      const j = node.joint;
      const q = (j && k.rot[j.name]) || identity;
      const p = (j && k.offset[j.name]) || zero;
      return `<Item class="Pose" referent="${nextRef()}"><Properties>`
        + `<string name="Name">${xmlEscape(node.name)}</string>`
        + cframeXml(p, q)
        + `<token name="EasingStyle">${EASING_STYLE[k.easing] ?? 0}</token>`
        + `<token name="EasingDirection">${EASING_DIRECTION_INOUT}</token>`
        + `<float name="Weight">1</float>`
        + `</Properties>${node.children.map(build).join('')}</Item>`;
    };
    return `<Item class="Keyframe" referent="${nextRef()}"><Properties>`
      + '<string name="Name">Keyframe</string>'
      + `<float name="Time">${num(k.time)}</float>`
      + `</Properties>${build(tree)}</Item>`;
  });

  const sequence = `<Item class="KeyframeSequence" referent="${nextRef()}"><Properties>`
    + `<string name="Name">${xmlEscape(anim.name)}</string>`
    + `<bool name="Loop">${anim.loop ? 'true' : 'false'}</bool>`
    + `<token name="Priority">${PRIORITY_ACTION}</token>`
    + `</Properties>${keyframesXml.join('')}</Item>`;

  const wrap = container === 'Folder'
    ? `<Item class="Folder" referent="${nextRef()}"><Properties><string name="Name">AnimSaves</string></Properties>${sequence}</Item>`
    : container === 'ObjectValue'
      ? `<Item class="ObjectValue" referent="${nextRef()}"><Properties><string name="Name">AnimSaves</string></Properties>${sequence}</Item>`
      : sequence;
  return `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" version="4">${wrap}</roblox>`;
}
