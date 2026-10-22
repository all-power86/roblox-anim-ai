// Definición del muñeco R15. Se usa en el navegador (para dibujarlo) y en el
// servidor (para decirle a la IA qué articulaciones existen).
//
// Convenciones (las mismas que Roblox):
// - Unidades en "studs". Eje Y hacia arriba.
// - El personaje mira hacia -Z. Su lado derecho es +X.
// - Cada articulación (Motor6D) une una pieza "padre" con una pieza "hija".
//   `offset` es dónde está la articulación respecto a la articulación padre.
//   `size` y `center` describen el bloque que se dibuja (relativo a su articulación).

export const ROOT_HEIGHT = 2.7; // altura de la cadera sobre el suelo en reposo

export const JOINTS = [
  { name: 'Root',          part: 'LowerTorso',    parent: null,            offset: [0, ROOT_HEIGHT, 0], size: [2, 0.4, 1],     center: [0, 0.2, 0],     color: 0x2f6fd6 },
  { name: 'Waist',         part: 'UpperTorso',    parent: 'Root',          offset: [0, 0.4, 0],         size: [2, 1.6, 1],     center: [0, 0.8, 0],     color: 0x2f6fd6 },
  { name: 'Neck',          part: 'Head',          parent: 'Waist',         offset: [0, 1.6, 0],         size: [1.2, 1.2, 1.2], center: [0, 0.6, 0],     color: 0xf5cd30 },
  { name: 'RightShoulder', part: 'RightUpperArm', parent: 'Waist',         offset: [1.5, 1.5, 0],       size: [1, 1.1, 1],     center: [0, -0.45, 0],   color: 0xf5cd30 },
  { name: 'RightElbow',    part: 'RightLowerArm', parent: 'RightShoulder', offset: [0, -1.0, 0],        size: [0.95, 1.0, 0.95], center: [0, -0.5, 0],  color: 0xf5cd30 },
  { name: 'RightWrist',    part: 'RightHand',     parent: 'RightElbow',    offset: [0, -1.0, 0],        size: [0.9, 0.4, 0.9], center: [0, -0.2, 0],    color: 0xf5cd30 },
  { name: 'LeftShoulder',  part: 'LeftUpperArm',  parent: 'Waist',         offset: [-1.5, 1.5, 0],      size: [1, 1.1, 1],     center: [0, -0.45, 0],   color: 0xf5cd30 },
  { name: 'LeftElbow',     part: 'LeftLowerArm',  parent: 'LeftShoulder',  offset: [0, -1.0, 0],        size: [0.95, 1.0, 0.95], center: [0, -0.5, 0],  color: 0xf5cd30 },
  { name: 'LeftWrist',     part: 'LeftHand',      parent: 'LeftElbow',     offset: [0, -1.0, 0],        size: [0.9, 0.4, 0.9], center: [0, -0.2, 0],    color: 0xf5cd30 },
  { name: 'RightHip',      part: 'RightUpperLeg', parent: 'Root',          offset: [0.5, 0, 0],         size: [1, 1.2, 1],     center: [0, -0.6, 0],    color: 0x4b974b },
  { name: 'RightKnee',     part: 'RightLowerLeg', parent: 'RightHip',      offset: [0, -1.2, 0],        size: [0.95, 1.2, 0.95], center: [0, -0.6, 0],  color: 0x4b974b },
  { name: 'RightAnkle',    part: 'RightFoot',     parent: 'RightKnee',     offset: [0, -1.2, 0],        size: [1, 0.3, 1.2],   center: [0, -0.15, -0.1], color: 0x4b974b },
  { name: 'LeftHip',       part: 'LeftUpperLeg',  parent: 'Root',          offset: [-0.5, 0, 0],        size: [1, 1.2, 1],     center: [0, -0.6, 0],    color: 0x4b974b },
  { name: 'LeftKnee',      part: 'LeftLowerLeg',  parent: 'LeftHip',       offset: [0, -1.2, 0],        size: [0.95, 1.2, 0.95], center: [0, -0.6, 0],  color: 0x4b974b },
  { name: 'LeftAnkle',     part: 'LeftFoot',      parent: 'LeftKnee',      offset: [0, -1.2, 0],        size: [1, 0.3, 1.2],   center: [0, -0.15, -0.1], color: 0x4b974b },
];

export const JOINT_NAMES = JOINTS.map((j) => j.name);
export const EASINGS = ['Linear', 'Cubic', 'Constant'];
