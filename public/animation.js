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
  // Si algún keyframe gira el cuerpo, todos llevan su giro (también los que lo tienen a 0);
  // si no, los primeros keyframes heredarían el giro del siguiente.
  const rootTurns = kfs.some((k) => k.root && (k.root.bend || k.root.side || k.root.twist));

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
      if (!seen.has(rootName) && (rootTurns || tracks[rootName])) {
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

// Tramos de la pata que se pueden ajustar: cadera (leg.upper) y rodilla (leg.lower).
export function legChain(foot, motion) {
  const chain = [];
  for (let j = foot.parentNode; j; j = j.parentNode) {
    const r = motion.joints[j.name]?.role;
    if (r === 'leg.upper' || r === 'leg.lower') chain.unshift(j.name);
    if (r === 'leg.upper') break;
  }
  return chain;
}

// Pies fijos (cinemática inversa por búsqueda): en un keyframe, ajusta cadera y rodilla de
// cada pata apoyada para que el pie vuelva a su sitio de reposo. La cadera se mueve en sus
// tres sentidos (adelante/atrás, abrir/cerrar, girar) y la rodilla se dobla, así el pie se
// queda quieto aunque el torso gire, se incline o se desplace en cualquier dirección.
// Funciona con cualquier pata (2-4 tramos, Motor6D, AnimationConstraint o Bone) porque usa
// los ejes anatómicos de motion.js. Si una pata no llega a su sitio, el pie se levanta.
// Devuelve la distancia que queda en el peor pie apoyado y la lista de pies levantados.
const PIN_MOTIONS = { 'leg.upper': ['bend', 'side', 'twist'], 'leg.lower': ['bend'] };
const PIN_EFFORT = 0.0005; // coste de cambiar 1° (en fracciones de la altura de cadera)
const REACH_TOLERANCE = 0.05; // si el pie queda más lejos de su sitio, se levanta (fracción de la altura de cadera)
const LIFT_HEIGHT = 0.2; // altura a la que se levanta ese pie (por encima del umbral de "apoyado")
function pinFeet(anim, skeleton, motion, k, index, feet, L) {
  const base = bakeAnimation(anim, skeleton, motion).keyframes[index];
  const fk0 = forwardKinematics(skeleton, base);
  const planted = feet.filter((f) => new THREE.Vector3().setFromMatrixPosition(fk0[f.name]).y - f.restPos.y < 0.15 * L);
  const rot = { ...base.rot };
  let worst = 0;
  const lifted = [];
  for (const foot of planted) {
    const chain = legChain(foot, motion);
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
    const setRot = (p) => { const mj = motion.joints[p.joint]; rot[p.joint] = valuesToQuaternion(mj, clampValues(mj, p).values); };
    // Error: distancia del pie a su objetivo, con el resto del cuerpo como está en este keyframe.
    let target = foot.restPos;
    const error = () => {
      const fk = forwardKinematics(skeleton, { rot, offset: base.offset });
      return new THREE.Vector3().setFromMatrixPosition(fk[foot.name]).distanceTo(target);
    };
    params.forEach(setRot);
    // Se prefiere la solución que menos cambia la pose original (y antes doblar que abrir o
    // girar la cadera): sin esto, dos keyframes seguidos pueden acabar con soluciones muy
    // distintas y la pata gira de golpe entre ellos.
    const start = params.map((p) => ({ bend: p.bend || 0, side: p.side || 0, twist: p.twist || 0 }));
    const cost = () => error() + params.reduce((sum, p, i) => sum + PIN_EFFORT * L
      * (Math.abs((p.bend || 0) - start[i].bend) + 1 * Math.abs((p.side || 0) - start[i].side) + 1 * Math.abs((p.twist || 0) - start[i].twist)), 0);
    const solve = () => {
      let best = cost();
      for (let step = 8; step >= 0.25; step /= 2) {
        let improved = true;
        for (let guard = 0; improved && guard < 30; guard++) {
          improved = false;
          for (const p of params) {
            const lims = motion.joints[p.joint].limits;
            for (const key of PIN_MOTIONS[motion.joints[p.joint].role] || ['bend']) {
              for (const dir of [1, -1]) {
                const old = p[key] || 0;
                p[key] = Math.min(lims[key][1], Math.max(lims[key][0], old + dir * step));
                setRot(p);
                const e = cost();
                if (e < best - 1e-4) { best = e; improved = true; } else { p[key] = old; setRot(p); }
              }
            }
          }
        }
      }
    };
    solve();
    // La pata no llega a su sitio (p. ej. embestida muy larga): en vez de arrastrar el pie por
    // el suelo, se levanta, como un lobo que se abalanza con las patas delanteras.
    if (error() > REACH_TOLERANCE * L) {
      target = foot.restPos.clone().add(new THREE.Vector3(0, LIFT_HEIGHT * L, 0)); // sube en vertical: no roza al despegar
      solve();
      lifted.push(foot.name);
    }
    params.forEach((p) => { for (const key of ['bend', 'side', 'twist']) p[key] = round(p[key] || 0); setRot(p); });
    worst = Math.max(worst, target === foot.restPos ? error() : 0);
  }
  // Si ninguna pata apoyada ha podido quedarse en el suelo, el cuerpo va en el aire (salta):
  // no se baja para forzar el apoyo, solo se evita que atraviese el suelo.
  const pinnable = planted.filter((f) => legChain(f, motion).length >= 2);
  if (pinnable.length && pinnable.every((f) => lifted.includes(f.name))) k.airborne = true; else delete k.airborne;
  return { worst, lifted };
}

// Ajuste al suelo:
//  - grounded (por defecto): el punto más bajo toca el suelo (+ lift);
//  - grounded=false: como mínimo no atraviesa el suelo (y queda a `lift` si se indica);
//  - plant: (animaciones sin desplazamiento) los pies apoyados no patinan aunque el torso
//    gire, se incline o se desplace: se ajustan cadera y rodilla para devolverlos a su sitio
//    (también entre keyframes), así se respeta el desplazamiento que pide la animación
//    (root.right/forward, p. ej. una embestida). Solo si la pata no tiene rodilla (p. ej. R6)
//    se mueve el cuerpo en horizontal para que el pie no patine;
//  - guarda en anim.authored los keyframes tal como llegaron (sin ajustes), para que la IA
//    corrija su propia versión y los ajustes no se acumulen ronda tras ronda;
//  - si entre dos keyframes el cuerpo se hunde, inserta un keyframe intermedio y lo corrige.
export function groundFix(anim, skeleton, motion, { plant = false } = {}) {
  if (motion.joints[motion.rootJoint]?.role !== 'root') return { changed: 0, inserted: 0 };
  const feet = footJoints(skeleton, motion);
  const L = Math.max(skeleton.byName[motion.rootJoint].restPos.y - skeleton.ground, 0.5);
  let changed = 0;
  let inserted = 0;
  anim.authored = structuredClone(anim.keyframes);

  // Pies cuya pata no se puede doblar para devolverlos a su sitio (sin rodilla).
  const rigidFeet = feet.filter((f) => legChain(f, motion).length < 2);

  // plantFeet: solo en la primera pasada. Con patas sin rodilla un pie apoyado solo se
  // queda quieto moviendo el cuerpo, así que ahí manda el pie.
  const fixKeyframes = (plantFeet = false) => {
    anim.keyframes.sort((a, b) => a.time - b.time);
    const baked = bakeAnimation(anim, skeleton, motion);
    anim.keyframes.forEach((k, i) => {
      const fk = forwardKinematics(skeleton, baked.keyframes[i]);
      const low = lowestPoint(skeleton, fk);
      const lift = Number(k.lift) || 0;
      let up = 0;
      if ((k.grounded !== false && !k.airborne) || lift) up = skeleton.ground + lift - low;
      else if (low < skeleton.ground) up = skeleton.ground - low;
      let right = 0;
      let forward = 0;
      if (plantFeet && k.grounded !== false) {
        const pos = (f) => new THREE.Vector3().setFromMatrixPosition(fk[f.name]);
        const onGround = (f) => pos(f).y + up - f.restPos.y < 0.08 * L;
        const drift = (list) => list.reduce((s, f) => s.add(f.restPos.clone().sub(pos(f))), new THREE.Vector3()).divideScalar(list.length);
        const rigid = rigidFeet.filter(onGround);
        if (rigid.length) { const d = drift(rigid); right = d.x; forward = -d.z; }
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

  if (plant && feet.length) fixKeyframes(true);
  // Que no se hunda en el suelo, tampoco entre keyframes (inserta keyframes donde haga falta).
  const keepAboveGround = () => {
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
        const k = insertKeyframe(anim, t);
        if (!k) continue;
        k.grounded = false; // solo evitar hundirse, sin pegarlo al suelo
        delete k.lift;
        inserted++;
      }
    }
  };
  keepAboveGround();

  // Pies fijos al final, cuando la altura ya está ajustada: en cada keyframe (también los
  // insertados para no hundirse) y entre keyframes. pinFeet solo toca los pies que están en el suelo.
  if (plant && feet.length) {
    anim.keyframes.sort((a, b) => a.time - b.time);
    anim.keyframes.forEach((k, i) => pinFeet(anim, skeleton, motion, k, i, feet, L));
    inserted += pinBetweenKeyframes(anim, skeleton, motion, feet, L);
    limitPinSpeed(anim, motion, feet);
    keepAboveGround();
  }
  anim.keyframes.sort((a, b) => a.time - b.time);
  return { changed, inserted };
}

// Inserta un keyframe en t con la pose interpolada. Si el tramo tenía aceleración (Cubic),
// los dos trozos pasan a ser lineales siguiendo la misma curva: con Cubic cada trozo
// arrancaría y frenaría por separado y el movimiento iría a tirones.
function insertKeyframe(anim, t) {
  if (anim.keyframes.some((q) => Math.abs(q.time - t) < 0.005)) return null; // ya hay uno ahí
  const k = interpolateKeyframe(anim, t);
  const prev = anim.keyframes.filter((q) => q.time <= t).sort((a, b) => b.time - a.time)[0];
  if (prev && prev.easing === 'Cubic') { prev.easing = 'Linear'; k.easing = 'Linear'; }
  anim.keyframes.push(k);
  return k;
}

// Entre dos keyframes con un pie apoyado, la interpolación puede hacerlo patinar aunque esté
// fijo en los dos extremos. Busca el peor momento de cada tramo, inserta ahí un keyframe y
// vuelve a fijar los pies. Devuelve cuántos keyframes ha insertado.
function pinBetweenKeyframes(anim, skeleton, motion, feet, L) {
  const pinnable = feet.filter((f) => legChain(f, motion).length >= 2);
  if (!pinnable.length) return 0;
  const tolerance = 0.03 * L;
  const near = (fk, f) => new THREE.Vector3().setFromMatrixPosition(fk[f.name]).y - f.restPos.y < 0.15 * L;
  let inserted = 0;
  for (let pass = 0; pass < 3; pass++) {
    anim.keyframes.sort((a, b) => a.time - b.time);
    const baked = bakeAnimation(anim, skeleton, motion);
    const kfs = anim.keyframes;
    const toInsert = [];
    for (let i = 0; i + 1 < kfs.length; i++) {
      if (kfs[i].easing === 'Constant') continue;
      const fa = forwardKinematics(skeleton, baked.keyframes[i]);
      const fb = forwardKinematics(skeleton, baked.keyframes[i + 1]);
      const both = pinnable.filter((f) => near(fa, f) && near(fb, f));
      if (!both.length) continue;
      const t0 = kfs[i].time;
      const t1 = kfs[i + 1].time;
      if (t1 - t0 < 0.05) continue;
      let worst = { d: tolerance, t: null };
      for (let s = 1; s < 6; s++) {
        const t = t0 + ((t1 - t0) * s) / 6;
        const fk = forwardKinematics(skeleton, sampleBaked(baked, t));
        for (const f of both) {
          const d = new THREE.Vector3().setFromMatrixPosition(fk[f.name]).distanceTo(f.restPos);
          if (d > worst.d) worst = { d, t };
        }
      }
      if (worst.t != null) toInsert.push(worst.t);
    }
    if (!toInsert.length) break;
    for (const t of toInsert) if (insertKeyframe(anim, t)) inserted++;
    anim.keyframes.sort((a, b) => a.time - b.time);
    for (const t of toInsert) {
      const i = anim.keyframes.findIndex((k) => k.time === round(t));
      if (i >= 0) pinFeet(anim, skeleton, motion, anim.keyframes[i], i, feet, L);
    }
  }
  return inserted;
}

// Límite de velocidad de las patas ajustadas: el ajuste de pies fijos no puede hacer que
// cadera y rodilla giren más deprisa que PIN_SPEED grados por segundo (o que la animación
// original, si ya era más rápida). Así la pata nunca gira de golpe por culpa del ajuste,
// aunque a cambio un pie pueda moverse un poco en un cambio muy rápido.
// Con "Cubic" la velocidad máxima de un tramo es 1,5 veces la media.
export const PIN_SPEED = { normal: 500, attack: 850 };
function limitPinSpeed(anim, motion, feet) {
  const joints = new Set(feet.flatMap((f) => (legChain(f, motion).length >= 2 ? legChain(f, motion) : [])));
  if (!joints.size || !anim.authored) return;
  const cap = anim.template === 'attack' ? PIN_SPEED.attack : PIN_SPEED.normal;
  const original = { ...anim, keyframes: anim.authored };
  const kfs = [...anim.keyframes].sort((a, b) => a.time - b.time);
  for (const joint of joints) {
    const list = kfs.map((k) => ({ k, p: k.poses.find((q) => q.joint === joint) })).filter((e) => e.p);
    if (list.length < 2) continue;
    const base = list.map(({ k }) => interpolateKeyframe(original, k.time).poses.find((q) => q.joint === joint) || {});
    for (const key of ['bend', 'side', 'twist']) {
      const v = list.map(({ p }) => p[key] || 0);
      const b0 = base.map((q) => q[key] || 0);
      // Cambio permitido entre los keyframes i y j (vecinos).
      const allowed = (i, j) => {
        const first = Math.min(i, j);
        const dt = Math.abs(list[i].k.time - list[j].k.time);
        const peak = list[first].k.easing === 'Cubic' ? 1.5 : 1;
        return Math.max(Math.abs(b0[i] - b0[j]), (cap * dt) / peak);
      };
      const clampFrom = (i, j) => { const m = allowed(i, j); v[i] = Math.min(v[j] + m, Math.max(v[j] - m, v[i])); };
      for (let i = 1; i < v.length; i++) clampFrom(i, i - 1);
      for (let i = v.length - 2; i >= 0; i--) clampFrom(i, i + 1);
      list.forEach(({ p }, i) => { p[key] = round(v[i]); });
    }
  }
}

const round = (v) => Math.round(v * 1000) / 1000;
