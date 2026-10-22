// Formato de animación (v2) y cálculos comunes a la vista previa, el análisis y la exportación.
//
// {
//   name, duration, loop,
//   keyframes: [{
//     time, easing: "Linear" | "Cubic" | "Constant",
//     grounded: true|false,   // ¿hay algo apoyado en el suelo? (para el ajuste automático)
//     lift: 0,                // si grounded=false: altura del punto más bajo sobre el suelo
//     root: { right, up, forward, bend, side, twist },   // desplazamiento (studs) y giro de todo el cuerpo
//     poses: [{ joint, bend, side, twist }]               // grados, ver motion.js
//   }]
// }

import * as THREE from 'three';
import { forwardKinematics } from './skeleton.js';
import { clampValues, valuesToQuaternion, rootOffsetToLocal } from './motion.js';

export function ease(kind, x) {
  if (kind === 'Constant') return 0;
  if (kind === 'Cubic') return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  return x;
}

// Los dos puntos de una pista que rodean t y cuánto mezclar entre ellos.
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

const ZERO_ROOT = { right: 0, up: 0, forward: 0, bend: 0, side: 0, twist: 0 };

// "Hornea" la animación: pose completa (giro de cada articulación) en cada keyframe.
// Aplica los límites de cada articulación y devuelve la lista de excesos.
export function bakeAnimation(anim, skeleton, motion) {
  const kfs = [...anim.keyframes].sort((a, b) => a.time - b.time);
  const tracks = {};
  const rootTrack = [];
  const exceeded = [];
  const rootName = motion.rootJoint;
  const hasRootRole = motion.joints[rootName]?.role === 'root';

  for (const k of kfs) {
    const seen = new Set();
    for (const p of k.poses || []) {
      const mj = motion.joints[p.joint];
      if (!mj || seen.has(p.joint)) continue;
      seen.add(p.joint);
      const { values, exceeded: ex } = clampValues(mj, p);
      ex.forEach((e) => exceeded.push({ ...e, time: k.time }));
      (tracks[p.joint] ||= []).push({ t: k.time, q: valuesToQuaternion(mj, values), easing: k.easing });
    }
    const r = { ...ZERO_ROOT, ...(k.root || {}) };
    if (hasRootRole) {
      rootTrack.push({ t: k.time, v: rootOffsetToLocal(motion, r), easing: k.easing });
      if (!seen.has(rootName) && (r.bend || r.side || r.twist || tracks[rootName])) {
        const { values } = clampValues(motion.joints[rootName], r);
        (tracks[rootName] ||= []).push({ t: k.time, q: valuesToQuaternion(motion.joints[rootName], values), easing: k.easing });
      }
    }
  }

  const keyframes = kfs.map((k) => {
    const rot = {};
    for (const [name, track] of Object.entries(tracks)) {
      const [a, b, f] = segment(track, k.time);
      rot[name] = new THREE.Quaternion().slerpQuaternions(a.q, b.q, f);
    }
    const offset = {};
    if (rootTrack.length) {
      const [a, b, f] = segment(rootTrack, k.time);
      offset[rootName] = a.v.clone().lerp(b.v, f);
    }
    return { time: k.time, easing: k.easing || 'Linear', rot, offset };
  });
  return { name: anim.name, duration: anim.duration, loop: anim.loop, keyframes, exceeded };
}

// Pose en el instante t (interpolando entre keyframes horneados).
export function sampleBaked(baked, t) {
  const kfs = baked.keyframes;
  const track = kfs.map((k) => ({ t: k.time, easing: k.easing, k }));
  const [a, b, f] = segment(track, t);
  const rot = {};
  const offset = {};
  for (const name of new Set([...Object.keys(a.k.rot), ...Object.keys(b.k.rot)])) {
    const qa = a.k.rot[name] || IDENTITY;
    const qb = b.k.rot[name] || IDENTITY;
    rot[name] = new THREE.Quaternion().slerpQuaternions(qa, qb, f);
  }
  for (const name of new Set([...Object.keys(a.k.offset), ...Object.keys(b.k.offset)])) {
    offset[name] = (a.k.offset[name] || ZERO_V).clone().lerp(b.k.offset[name] || ZERO_V, f);
  }
  return { rot, offset };
}
const IDENTITY = new THREE.Quaternion();
const ZERO_V = new THREE.Vector3();

// Puntos de contacto del cuerpo (esquinas de piezas y articulaciones) en el mundo.
export function bodyPoints(skeleton, fk) {
  const pts = [];
  for (const j of skeleton.joints) {
    const m = fk[j.name];
    pts.push(new THREE.Vector3().setFromMatrixPosition(m));
    if (j.partOffset && j.partSize) {
      const pm = m.clone().multiply(j.partOffset);
      const [sx, sy, sz] = j.partSize.map((v) => v / 2);
      for (const dx of [-sx, sx]) for (const dy of [-sy, sy]) for (const dz of [-sz, sz]) {
        pts.push(new THREE.Vector3(dx, dy, dz).applyMatrix4(pm));
      }
    }
  }
  return pts;
}

export function lowestPoint(skeleton, fk) {
  return Math.min(...bodyPoints(skeleton, fk).map((p) => p.y));
}

// Ajuste al suelo: en cada keyframe sube o baja todo el cuerpo para que
//  - si grounded (por defecto): el punto más bajo toque el suelo (+ lift);
//  - si no: como mínimo no atraviese el suelo (y quede a `lift` si se indica).
// Devuelve cuántos keyframes se corrigieron y cuánto.
export function groundFix(anim, skeleton, motion) {
  if (motion.joints[motion.rootJoint]?.role !== 'root') return { changed: 0, maxShift: 0 };
  const baked = bakeAnimation(anim, skeleton, motion);
  let changed = 0;
  let maxShift = 0;
  anim.keyframes.sort((a, b) => a.time - b.time);
  anim.keyframes.forEach((k, i) => {
    const fk = forwardKinematics(skeleton, baked.keyframes[i]);
    const low = lowestPoint(skeleton, fk);
    const lift = Number(k.lift) || 0;
    let shift = 0;
    if (k.grounded !== false) shift = skeleton.ground + lift - low;
    else if (lift) shift = skeleton.ground + lift - low;
    else if (low < skeleton.ground) shift = skeleton.ground - low;
    if (Math.abs(shift) > 1e-3) {
      k.root = { ...ZERO_ROOT, ...(k.root || {}) };
      k.root.up = round((k.root.up || 0) + shift);
      changed++;
      maxShift = Math.max(maxShift, Math.abs(shift));
    }
  });
  return { changed, maxShift };
}

const round = (v) => Math.round(v * 1000) / 1000;
