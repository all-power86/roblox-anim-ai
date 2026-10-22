// Exporta una animación a un archivo .rbxmx (modelo XML de Roblox).
//
// Contenido del archivo:
//   AnimSaves (ObjectValue)            <- carpeta donde el Editor de Animaciones busca animaciones
//     └ KeyframeSequence               <- la animación
//         └ Keyframe (uno por instante)
//             └ Pose HumanoidRootPart
//                 └ Pose LowerTorso (articulación Root)
//                     └ Pose UpperTorso, piernas... (siguiendo el esqueleto R15)
//
// Cada Pose guarda un CFrame: el giro (y para el torso, el desplazamiento) de su Motor6D.

import * as THREE from 'three';
import { JOINTS } from './rig.js';
import { bakeAnimation } from './animation.js';

// Valores de los enums de Roblox (PoseEasingStyle / PoseEasingDirection / AnimationPriority).
const EASING_STYLE = { Linear: 0, Constant: 1, Cubic: 3 };
const EASING_DIRECTION_INOUT = 2;
const PRIORITY_ACTION = 2;

const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const num = (v) => (Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(6)));

let ref = 0;
const nextRef = () => `RBX${(ref++).toString(16).toUpperCase().padStart(8, '0')}`;

// CFrame de Roblox: X Y Z y la matriz de rotación fila por fila (R00 R01 R02 R10 ... R22).
function cframeXml(name, position, quaternion) {
  const e = new THREE.Matrix4().makeRotationFromQuaternion(quaternion).elements; // por columnas
  const rows = [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
  const [x, y, z] = [position.x, position.y, position.z];
  const tags = ['X', 'Y', 'Z', 'R00', 'R01', 'R02', 'R10', 'R11', 'R12', 'R20', 'R21', 'R22'];
  const values = [x, y, z, ...rows].map(num);
  return `<CoordinateFrame name="${name}">${tags.map((t, i) => `<${t}>${values[i]}</${t}>`).join('')}</CoordinateFrame>`;
}

function poseXml(partName, position, quaternion, easing, children) {
  return `<Item class="Pose" referent="${nextRef()}"><Properties>`
    + `<string name="Name">${partName}</string>`
    + cframeXml('CFrame', position, quaternion)
    + `<token name="EasingStyle">${EASING_STYLE[easing] ?? 3}</token>`
    + `<token name="EasingDirection">${EASING_DIRECTION_INOUT}</token>`
    + '<float name="Weight">1</float>'
    + `</Properties>${children.join('')}</Item>`;
}

export function toRbxmx(anim) {
  ref = 0;
  const baked = bakeAnimation(anim);
  const zero = new THREE.Vector3();

  const keyframesXml = baked.keyframes.map((k) => {
    const build = (joint) => {
      const children = JOINTS.filter((c) => c.parent === joint.name).map(build);
      const position = joint.name === 'Root' ? k.root : zero;
      return poseXml(joint.part, position, k.quats[joint.name], k.easing, children);
    };
    const rootJoint = JOINTS.find((j) => j.parent === null);
    const hrp = poseXml('HumanoidRootPart', zero, new THREE.Quaternion(), k.easing, [build(rootJoint)]);
    return `<Item class="Keyframe" referent="${nextRef()}"><Properties>`
      + '<string name="Name">Keyframe</string>'
      + `<float name="Time">${num(k.time)}</float>`
      + `</Properties>${hrp}</Item>`;
  });

  const sequence = `<Item class="KeyframeSequence" referent="${nextRef()}"><Properties>`
    + `<string name="Name">${xmlEscape(anim.name)}</string>`
    + `<bool name="Loop">${anim.loop ? 'true' : 'false'}</bool>`
    + `<token name="Priority">${PRIORITY_ACTION}</token>`
    + `</Properties>${keyframesXml.join('')}</Item>`;

  return '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" version="4">'
    + `<Item class="ObjectValue" referent="${nextRef()}"><Properties><string name="Name">AnimSaves</string></Properties>`
    + sequence
    + '</Item></roblox>';
}
