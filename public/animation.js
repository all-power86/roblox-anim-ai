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

// Valor (bend/side/twist o desplazamiento de raíz) de cada articulación en el instante t,
// interpolando entre los keyframes que la mencionan. Sirve para insertar keyframes nuevos.
export function interpolateKeyframe(anim, t) {
  const kfs = [...anim.keyframes].sort((a, b) => a.time - b.time);
  const tracks = {};
  const rootTrack = [];
  for (const k of kfs) {
    for (const p of k.poses || []) (tracks[p.joint] ||= []).push({ t: k.time, easing: k.easing, v: p });
    rootTrack.push({ t: k.time, easing: k.easing, v: { ...ZERO_ROOT, ...(k.root || {}) } });
  }
  const mix = (track, keys) => {
    const [a, b, f] = segment(track, t);
    return Object.fromEntries(keys.map((key) => [key, round((a.v[key] || 0) + ((b.v[key] || 0) - (a.v[key] || 0)) * f)]));
  };
  const prev = kfs.filter((k) => k.time <= t).pop() || kfs[0];
  return {
    time: round(t),
    easing: prev.easing,
    ...(prev.grounded === false ? { grounded: false, lift: prev.lift || 0 } : {}),
    root: mix(rootTrack, Object.keys(ZERO_ROOT)),
    poses: Object.entries(tracks).map(([joint, track]) => ({ joint, ...mix(track, ['bend', 'side', 'twist']) })),
  };
}

// Pies (puntos que apoyan): articulaciones de pie/dedos o extremos de piernas.
function footJoints(skeleton, motion) {
  return skeleton.joints.filter((j) => {
    const r = motion.joints[j.name]?.role;
    return r === 'foot' || r === 'toe' || (r?.startsWith('leg') && !j.children.length);
  });
}

// Pies fijos (cinemática inversa por búsqueda): en un keyframe, ajusta el "bend" de cadera
// y rodilla de cada pata apoyada para que el pie vuelva a su sitio de reposo. Funciona con
// cualquier pata (2-4 tramos, Motor6D o Bone) porque usa los ejes anatómicos de motion.js.
function pinFeet(anim, skeleton, motion, k, index, feet, L) {
  const baked = bakeAnimation(anim, skeleton, motion);
  const fk0 = forwardKinematics(skeleton, baked.keyframes[index]);
  const planted = feet.filter((f) => new THREE.Vector3().setFromMatrixPosition(fk0[f.name]).y - f.restPos.y < 0.15 * L);
  for (const foot of planted) {
    // Tramos de la pata que se pueden ajustar: cadera (leg.upper) y rodilla (leg.lower).
    const chain = [];
    for (let j = foot.parentNode; j; j = j.parentNode) {
      const r = motion.joints[j.name]?.role;
      if (r === 'leg.upper' || r === 'leg.lower') chain.unshift(j.name);
      if (r === 'leg.upper') break;
    }
    if (chain.length < 2) continue;
    const entry = (name) => {
      let p = k.poses.find((q) => q.joint === name);
      if (!p) {
        const interp = interpolateKeyframe(anim, k.time).poses.find((q) => q.joint === name) || { joint: name };
        p = { joint: name, bend: interp.bend || 0, side: interp.side || 0, twist: interp.twist || 0 };
        k.poses.push(p);
      }
      return p;
    };
    const params = chain.map(entry);
    const error = () => {
      const b = bakeAnimation({ ...anim, keyframes: [k] }, skeleton, motion);
      const fk = forwardKinematics(skeleton, b.keyframes[0]);
      return new THREE.Vector3().setFromMatrixPosition(fk[foot.name]).distanceTo(foot.restPos);
    };
    let best = error();
    for (let step = 8; step >= 0.5; step /= 2) {
      let improved = true;
      for (let guard = 0; improved && guard < 20; guard++) {
        improved = false;
        for (const p of params) {
          const lim = motion.joints[p.joint].limits.bend;
          for (const dir of [1, -1]) {
            const old = p.bend;
            p.bend = Math.min(lim[1], Math.max(lim[0], old + dir * step));
            const e = error();
            if (e < best - 1e-4) { best = e; improved = true; } else p.bend = old;
          }
        }
      }
    }
    params.forEach((p) => (p.bend = round(p.bend)));
  }
}

// Ajuste al suelo:
//  - grounded (por defecto): el punto más bajo toca el suelo (+ lift);
//  - grounded=false: como mínimo no atraviesa el suelo (y queda a `lift` si se indica);
//  - plant: (animaciones sin desplazamiento) mueve el cuerpo en horizontal para que
//    los pies apoyados no patinen respecto a su posición de reposo;
//  - si entre dos keyframes el cuerpo se hunde, inserta un keyframe intermedio y lo corrige.
export function groundFix(anim, skeleton, motion, { plant = false } = {}) {
  if (motion.joints[motion.rootJoint]?.role !== 'root') return { changed: 0, inserted: 0 };
  const feet = footJoints(skeleton, motion);
  const L = Math.max(skeleton.byName[motion.rootJoint].restPos.y - skeleton.ground, 0.5);
  let changed = 0;
  let inserted = 0;

  const fixKeyframes = () => {
    anim.keyframes.sort((a, b) => a.time - b.time);
    const baked = bakeAnimation(anim, skeleton, motion);
    anim.keyframes.forEach((k, i) => {
      const fk = forwardKinematics(skeleton, baked.keyframes[i]);
      const low = lowestPoint(skeleton, fk);
      const lift = Number(k.lift) || 0;
      let up = 0;
      if (k.grounded !== false || lift) up = skeleton.ground + lift - low;
      else if (low < skeleton.ground) up = skeleton.ground - low;
      let right = 0;
      let forward = 0;
      if (plant && k.grounded !== false && feet.length) {
        const contact = feet.filter((f) => new THREE.Vector3().setFromMatrixPosition(fk[f.name]).y + up - f.restPos.y < 0.08 * L);
        if (contact.length) {
          const now = new THREE.Vector3();
          const rest = new THREE.Vector3();
          contact.forEach((f) => { now.add(new THREE.Vector3().setFromMatrixPosition(fk[f.name])); rest.add(f.restPos); });
          now.divideScalar(contact.length);
          rest.divideScalar(contact.length);
          right = rest.x - now.x;
          forward = -(rest.z - now.z);
        }
      }
      if (Math.abs(up) > 1e-3 || Math.abs(right) > 1e-3 || Math.abs(forward) > 1e-3) {
        k.root = { ...ZERO_ROOT, ...(k.root || {}) };
        k.root.up = round(k.root.up + up);
        k.root.right = round(k.root.right + right);
        k.root.forward = round(k.root.forward + forward);
        changed++;
      }
    });
  };

  if (plant && feet.length) {
    fixKeyframes();
    anim.keyframes.forEach((k, i) => { if (k.grounded !== false) pinFeet(anim, skeleton, motion, k, i, feet, L); });
  }
  for (let iter = 0; iter < 4; iter++) {
    fixKeyframes();
    // ¿Se hunde entre keyframes? Buscar el peor momento de cada tramo.
    const baked = bakeAnimation(anim, skeleton, motion);
    const kfs = anim.keyframes;
    const toInsert = [];
    for (let i = 0; i + 1 < kfs.length; i++) {
      const t0 = kfs[i].time;
      const t1 = kfs[i + 1].time;
      let worst = { depth: 0.02, t: null };
      for (let s = 1; s < 6; s++) {
        const t = t0 + ((t1 - t0) * s) / 6;
        const low = lowestPoint(skeleton, forwardKinematics(skeleton, sampleBaked(baked, t)));
        if (skeleton.ground - low > worst.depth) worst = { depth: skeleton.ground - low, t };
      }
      if (worst.t != null) toInsert.push(worst.t);
    }
    if (!toInsert.length) break;
    for (const t of toInsert) {
      const k = interpolateKeyframe(anim, t);
      k.grounded = false; // solo evitar hundirse, sin pegarlo al suelo
      delete k.lift;
      anim.keyframes.push(k);
      inserted++;
    }
  }
  anim.keyframes.sort((a, b) => a.time - b.time);
  return { changed, inserted };
}

const round = (v) => Math.round(v * 1000) / 1000;
