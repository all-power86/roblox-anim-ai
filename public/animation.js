// Cálculos de la animación compartidos por la vista previa y la exportación a Roblox.
//
// "Hornear" (bake) la animación: en cada keyframe calculamos la pose COMPLETA de las
// 15 articulaciones, aunque la IA solo haya indicado algunas. Así la vista previa y el
// archivo de Roblox usan exactamente los mismos datos y se ven igual.

import * as THREE from 'three';
import { JOINTS } from './rig.js';

const DEG = Math.PI / 180;

export function ease(kind, x) {
  if (kind === 'Constant') return 0;
  if (kind === 'Cubic') return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  return x;
}

// Busca los dos puntos de una pista que rodean el instante t y cuánto mezclar entre ellos.
export function segment(track, t) {
  if (t <= track[0].t) return [track[0], track[0], 0];
  const last = track[track.length - 1];
  if (t >= last.t) return [last, last, 0];
  let i = 0;
  while (track[i + 1].t < t) i++;
  const a = track[i];
  const b = track[i + 1];
  const span = b.t - a.t;
  return [a, b, span > 0 ? ease(a.easing, (t - a.t) / span) : 1];
}

export function bakeAnimation(anim) {
  // 1) Una pista por articulación con los valores que indicó la animación.
  const tracks = {};
  const rootTrack = [];
  for (const k of anim.keyframes) {
    for (const p of k.poses) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx * DEG, p.ry * DEG, p.rz * DEG, 'XYZ'));
      (tracks[p.joint] ||= []).push({ t: k.time, q, easing: k.easing });
    }
    const o = k.rootOffset || { x: 0, y: 0, z: 0 };
    rootTrack.push({ t: k.time, v: new THREE.Vector3(o.x, o.y, o.z), easing: k.easing });
  }

  // 2) En cada keyframe, la pose completa de todas las articulaciones.
  const times = [...new Set(anim.keyframes.map((k) => k.time))].sort((a, b) => a - b);
  const easingAt = new Map(anim.keyframes.map((k) => [k.time, k.easing]));
  return {
    name: anim.name,
    duration: anim.duration,
    loop: anim.loop,
    keyframes: times.map((t) => {
      const quats = {};
      for (const j of JOINTS) {
        const track = tracks[j.name];
        if (!track) { quats[j.name] = new THREE.Quaternion(); continue; }
        const [a, b, f] = segment(track, t);
        quats[j.name] = new THREE.Quaternion().slerpQuaternions(a.q, b.q, f);
      }
      const [a, b, f] = segment(rootTrack, t);
      return { time: t, easing: easingAt.get(t), root: a.v.clone().lerp(b.v, f), quats };
    }),
  };
}

// Pose (rotaciones + desplazamiento del cuerpo) en el instante t de una animación horneada.
export function sampleBaked(baked, t, out) {
  const [a, b, f] = segment(baked.keyframes.map((k) => ({ ...k, t: k.time })), t);
  for (const j of JOINTS) out.quats[j.name].slerpQuaternions(a.quats[j.name], b.quats[j.name], f);
  out.root.copy(a.root).lerp(b.root, f);
  return out;
}
