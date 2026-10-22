// Detección automática de fallos en una animación (sin IA):
//  - giros imposibles (límites superados)
//  - partes que se atraviesan entre sí
//  - cuerpo que atraviesa el suelo o flota
//  - pies que patinan
//  - ritmo: bucle que no cierra, movimientos demasiado bruscos, animación casi quieta
//  - ataques: el cuerpo debe lanzarse hacia delante y, al morder, la cabeza ir hacia
//    delante y abajo (no hacia arriba, que parece un aullido)
// El resultado se muestra en la web y se le pasa a la IA en la autorrevisión.

import * as THREE from 'three';
import { forwardKinematics } from './skeleton.js';
import { bakeAnimation, sampleBaked, lowestPoint, legChain } from './animation.js';

const FPS = 30;
const LOCOMOTION = new Set(['walk', 'run']);

// Cápsulas (segmento + radio) que representan cada pieza o hueso, en el marco de su articulación.
function buildCapsules(skeleton) {
  const caps = [];
  for (const j of skeleton.joints) {
    const toLocal = j.restWorld.clone().invert();
    if (j.partOffset && j.partSize) {
      const sizes = j.partSize;
      const axis = sizes.indexOf(Math.max(...sizes));
      const others = sizes.filter((_, i) => i !== axis);
      const r = (Math.min(...others) / 2) * 0.9;
      const half = Math.max(sizes[axis] / 2 - r, 0);
      const dir = new THREE.Vector3().setComponent(axis, half);
      const center = new THREE.Vector3();
      const a = center.clone().sub(dir).applyMatrix4(j.partOffset);
      const b = center.clone().add(dir).applyMatrix4(j.partOffset);
      caps.push({ joint: j.name, a, b, r });
    } else {
      const r = (j.radius || 0.12) * 0.8;
      for (const c of j.children) {
        caps.push({ joint: j.name, a: new THREE.Vector3(), b: c.restPos.clone().applyMatrix4(toLocal), r: Math.min(r, (c.radius || r) * 1.2) });
      }
    }
  }
  return caps;
}

// Distancia mínima entre dos segmentos 3D.
function segmentDistance(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s;
  let t;
  if (a <= 1e-9 && e <= 1e-9) return p1.distanceTo(p2);
  if (a <= 1e-9) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  return p1.clone().add(d1.multiplyScalar(s)).distanceTo(p2.clone().add(d2.multiplyScalar(t)));
}

// Distancia en la jerarquía entre dos articulaciones (para ignorar piezas vecinas).
function hierarchyDistance(skeleton, a, b) {
  const ancestors = (n) => { const l = []; let j = skeleton.byName[n]; while (j) { l.push(j.name); j = j.parentNode; } return l; };
  const A = ancestors(a);
  const B = ancestors(b);
  const common = A.find((n) => B.includes(n));
  if (!common) return 99;
  return A.indexOf(common) + B.indexOf(common);
}

export function analyzeAnimation(anim, skeleton, motion, opts = {}) {
  const issues = [];
  const baked = bakeAnimation(anim, skeleton, motion);
  const L = opts.legLength || Math.max(skeleton.size.y * 0.45, 0.5);
  const templateId = anim.template || opts.template;
  const nFrames = Math.max(2, Math.round(anim.duration * FPS));
  const times = Array.from({ length: nFrames + 1 }, (_, i) => (i / nFrames) * anim.duration);
  const roleOf = (n) => motion.joints[n]?.role;

  // 1) Giros imposibles
  if (baked.exceeded.length) {
    const byJoint = {};
    for (const e of baked.exceeded) (byJoint[`${e.joint}.${e.motion}`] ||= []).push(e);
    const list = Object.entries(byJoint).slice(0, 6).map(([k, es]) => `${k} pidió ${es[0].value}° (límite ${es[0].limit[0]}..${es[0].limit[1]}°)`);
    issues.push({ type: 'giro_imposible', severity: 'media', message: `Giros fuera de los límites realistas (se han recortado): ${list.join('; ')}.` });
  }

  // Muestreo
  const caps = buildCapsules(skeleton);
  const restFk = forwardKinematics(skeleton, {});
  const capWorld = (fk, c) => [c.a.clone().applyMatrix4(fk[c.joint]), c.b.clone().applyMatrix4(fk[c.joint])];
  const pairs = [];
  for (let i = 0; i < caps.length; i++) {
    for (let k = i + 1; k < caps.length; k++) {
      if (caps[i].joint === caps[k].joint) continue;
      // Piezas unidas por la misma articulación se tocan siempre; se ignoran salvo
      // brazo-torso (lo más habitual: el brazo atravesando el pecho).
      const dist = hierarchyDistance(skeleton, caps[i].joint, caps[k].joint);
      const roles = [roleOf(caps[i].joint), roleOf(caps[k].joint)];
      const armTorso = roles.includes('arm.upper') && roles.some((r) => r === 'spine' || r === 'root');
      if (dist <= 1 && !armTorso) continue;
      const [a1, b1] = capWorld(restFk, caps[i]);
      const [a2, b2] = capWorld(restFk, caps[k]);
      const restPen = caps[i].r + caps[k].r - segmentDistance(a1, b1, a2, b2);
      pairs.push({ i, k, restPen: Math.max(restPen, 0) });
    }
  }
  const feet = skeleton.joints.filter((j) => ['foot', 'toe'].includes(roleOf(j.name)) || (roleOf(j.name)?.startsWith('leg') && !j.children.length));
  const footRestY = Object.fromEntries(feet.map((f) => [f.name, f.restPos.y]));

  let below = { frames: 0, depth: 0, at: 0 };
  let floating = 0;
  const collisions = new Map();
  const slide = {};
  const prevFoot = {};
  let prevRot = null;
  let maxSpeed = { value: 0, joint: '', at: 0 };
  let totalMotion = 0;

  for (const t of times) {
    const pose = sampleBaked(baked, t);
    const fk = forwardKinematics(skeleton, pose);
    // 2) Suelo
    const low = lowestPoint(skeleton, fk);
    if (low < skeleton.ground - Math.max(0.05, 0.03 * L)) {
      below.frames++;
      if (skeleton.ground - low > below.depth) below = { ...below, depth: skeleton.ground - low, at: t };
    }
    const kfIdx = anim.keyframes.findIndex((k) => k.time >= t);
    const grounded = anim.keyframes[Math.max(kfIdx, 0)]?.grounded !== false && anim.keyframes[Math.max(kfIdx - 1, 0)]?.grounded !== false;
    if (grounded && feet.length && low > skeleton.ground + 0.1 * L) floating++;

    // 3) Choques entre partes
    for (const p of pairs) {
      const [a1, b1] = capWorld(fk, caps[p.i]);
      const [a2, b2] = capWorld(fk, caps[p.k]);
      const pen = caps[p.i].r + caps[p.k].r - segmentDistance(a1, b1, a2, b2) - p.restPen;
      if (pen > 0.3 * Math.min(caps[p.i].r, caps[p.k].r)) {
        const key = [caps[p.i].joint, caps[p.k].joint].sort().join(' ↔ ');
        const cur = collisions.get(key) || { frames: 0, depth: 0, at: t };
        cur.frames++;
        if (pen > cur.depth) { cur.depth = pen; cur.at = t; }
        collisions.set(key, cur);
      }
    }

    // 4) Pies que patinan (mientras están apoyados)
    for (const f of feet) {
      const pos = new THREE.Vector3().setFromMatrixPosition(fk[f.name]);
      const contact = pos.y - footRestY[f.name] < 0.05 * L + Math.max(0, low - skeleton.ground);
      const prev = prevFoot[f.name];
      if (contact && prev?.contact) {
        const s = (slide[f.name] ||= { lateral: 0, horizontal: 0 });
        s.lateral += Math.abs(pos.x - prev.pos.x);
        s.horizontal += Math.hypot(pos.x - prev.pos.x, pos.z - prev.pos.z);
      }
      prevFoot[f.name] = { pos, contact };
    }

    // 5) Velocidad de giro
    if (prevRot) {
      for (const [name, q] of Object.entries(pose.rot)) {
        const prev = prevRot[name];
        if (!prev) continue;
        const ang = (2 * Math.acos(Math.min(1, Math.abs(prev.dot(q))))) * (180 / Math.PI);
        totalMotion += ang;
        const speed = ang * FPS;
        if (speed > maxSpeed.value) maxSpeed = { value: speed, joint: name, at: t };
      }
    }
    prevRot = pose.rot;
  }

  if (below.frames) {
    issues.push({ type: 'atraviesa_suelo', severity: 'alta', message: `El cuerpo atraviesa el suelo hasta ${below.depth.toFixed(2)} studs (peor momento t=${below.at.toFixed(2)} s, ${below.frames} fotogramas).` });
  }
  if (floating > nFrames * 0.15) {
    issues.push({ type: 'flota', severity: 'media', message: `Ningún pie toca el suelo en ${Math.round((floating / nFrames) * 100)}% de los fotogramas marcados como "apoyado".` });
  }
  const worst = [...collisions.entries()].sort((a, b) => b[1].depth - a[1].depth).slice(0, 5);
  if (worst.length) {
    const list = worst.map(([k, v]) => `${k} (t=${v.at.toFixed(2)} s, ${v.depth.toFixed(2)} studs)`).join('; ');
    issues.push({ type: 'se_atraviesan', severity: worst[0][1].depth > 0.25 * L ? 'alta' : 'media', message: `Partes que se atraviesan: ${list}.` });
  }
  const locomotion = LOCOMOTION.has(templateId);
  for (const [foot, s] of Object.entries(slide)) {
    if (s.lateral > 0.15 * L) {
      issues.push({ type: 'pie_patina', severity: 'media', message: `El pie ${foot} se desliza de lado ${s.lateral.toFixed(2)} studs mientras está apoyado.` });
    } else if (!locomotion && s.horizontal > 0.2 * L) {
      issues.push({ type: 'pie_patina', severity: 'media', message: `El pie ${foot} patina ${s.horizontal.toFixed(2)} studs mientras está apoyado (en esta animación debería quedarse quieto).` });
    }
  }
  if (anim.loop && baked.keyframes.length > 1) {
    const a = baked.keyframes[0];
    const b = baked.keyframes[baked.keyframes.length - 1];
    let worstSeam = { ang: 0, joint: '' };
    for (const name of Object.keys(a.rot)) {
      const q2 = b.rot[name];
      if (!q2) continue;
      const ang = (2 * Math.acos(Math.min(1, Math.abs(a.rot[name].dot(q2))))) * (180 / Math.PI);
      if (ang > worstSeam.ang) worstSeam = { ang, joint: name };
    }
    if (worstSeam.ang > 4) issues.push({ type: 'bucle_no_cierra', severity: 'media', message: `El bucle no cierra: ${worstSeam.joint} salta ${worstSeam.ang.toFixed(0)}° al volver al principio.` });
  }
  const limit = templateId === 'attack' ? 1500 : 900;
  if (maxSpeed.value > limit) {
    issues.push({ type: 'brusco', severity: 'baja', message: `Movimiento muy brusco: ${maxSpeed.joint} gira a ${Math.round(maxSpeed.value)}°/s cerca de t=${maxSpeed.at.toFixed(2)} s.` });
  }
  const jointsMoving = Object.keys(baked.keyframes[0]?.rot || {}).length || 1;
  if (totalMotion / jointsMoving < 5 && templateId !== 'idle') {
    issues.push({ type: 'quieto', severity: 'media', message: 'La animación apenas se mueve.' });
  }

  if (templateId === 'attack') issues.push(...attackIssues(anim, skeleton, motion, baked, times, L, opts.prompt));

  return { issues, stats: { frames: nFrames + 1, maxTurnSpeed: Math.round(maxSpeed.value), legLength: L } };
}

const FORWARD = new THREE.Vector3(0, 0, -1); // el personaje mira hacia -Z
const BITE_WORDS = /mord|muerd|bite|dentellada/i;

// Ataques: ¿se lanza el cuerpo hacia delante? ¿muerde con la cabeza hacia delante y abajo?
function attackIssues(anim, skeleton, motion, baked, times, L, prompt) {
  const issues = [];
  const roleOf = (n) => motion.joints[n]?.role;
  const rootName = motion.rootJoint;
  const head = skeleton.joints.find((j) => roleOf(j.name) === 'head');
  const jaw = skeleton.joints.find((j) => roleOf(j.name) === 'jaw');
  const samples = times.map((t) => {
    const pose = sampleBaked(baked, t);
    const fk = forwardKinematics(skeleton, pose);
    const s = { t, root: new THREE.Vector3().setFromMatrixPosition(fk[rootName]) };
    if (head) {
      s.head = new THREE.Vector3().setFromMatrixPosition(fk[head.name]);
      const rot = new THREE.Quaternion().setFromRotationMatrix(fk[head.name]).multiply(head.restRot.clone().invert());
      s.pitch = Math.asin(THREE.MathUtils.clamp(FORWARD.clone().applyQuaternion(rot).y, -1, 1)) * (180 / Math.PI); // + = mira arriba
    }
    if (jaw) { const q = pose.rot[jaw.name]; s.jaw = q ? (2 * Math.acos(Math.min(1, Math.abs(q.w)))) * (180 / Math.PI) : 0; }
    return s;
  });

  // Momento del golpe: máxima apertura de la boca o, si no muerde, cuando más avanza el cuerpo.
  const maxJaw = jaw ? Math.max(...samples.map((s) => s.jaw)) : 0;
  const bites = Boolean(head) && (maxJaw >= 10 || BITE_WORDS.test(prompt || ''));
  const strike = maxJaw >= 10 && head
    ? samples.reduce((a, b) => (b.jaw > a.jaw ? b : a))
    : bites ? samples.reduce((a, b) => (b.head.z < a.head.z ? b : a))
      : samples.reduce((a, b) => (b.root.z < a.root.z ? b : a));

  // 1) Embestida: lo que avanza el cuerpo en el empujón que termina en el golpe (desde el
  //    punto más retrasado justo antes). Avanzar durante la anticipación no cuenta.
  const push = (i) => {
    let j = i;
    while (j > 0 && samples[j - 1].root.z >= samples[j].root.z - 1e-4) j--;
    return { adv: samples[j].root.z - samples[i].root.z, from: samples[j].t, to: samples[i].t };
  };
  let lunge = { adv: 0, from: strike.t, to: strike.t };
  samples.forEach((s, i) => {
    if (s.t < strike.t - 0.05 || s.t > strike.t + 0.08) return;
    const p = push(i);
    if (p.adv > lunge.adv) lunge = p;
  });
  const minLunge = 0.25 * L;
  // Con patas sin rodilla (R6) el cuerpo no puede avanzar sin que los pies patinen.
  const canLunge = skeleton.joints.some((j) => legChain(j, motion).length >= 2);
  if (canLunge && lunge.adv < minLunge) {
    issues.push({ type: 'no_avanza', severity: 'media', message: `En el golpe (t=${strike.t.toFixed(2)} s) el cuerpo apenas se lanza hacia delante (${lunge.adv.toFixed(2)} studs). Un ataque debe echarse atrás en la anticipación (root.forward negativo) y lanzarse hacia delante al golpear: al menos ${minLunge.toFixed(2)} studs desde la anticipación.` });
  }

  // 2) Mordisco: la cabeza debe ir hacia delante y abajo, no levantarse.
  if (!bites) return issues;
  const wind = samples.filter((s) => s.t >= strike.t - 0.2 && s.t <= strike.t);
  const lowPitch = Math.min(...wind.map((s) => s.pitch));
  const start = wind[0];
  const rise = strike.head.y - start.head.y;
  const ahead = start.head.z - strike.head.z;
  const problems = [];
  if (strike.pitch > 10) problems.push(`el hocico apunta ${Math.round(strike.pitch)}° hacia arriba`);
  else if (strike.pitch - lowPitch > 15) problems.push(`la cabeza se levanta ${Math.round(strike.pitch - lowPitch)}° justo al morder`);
  if (rise > 0.05 * L && rise > Math.max(ahead, 0)) problems.push(`sube ${rise.toFixed(2)} studs y avanza solo ${Math.max(ahead, 0).toFixed(2)}`);
  if (problems.length) {
    issues.push({ type: 'mordisco_arriba', severity: 'alta', message: `En el mordisco (t=${strike.t.toFixed(2)} s) ${problems.join(' y ')}: parece un aullido. Al morder, la cabeza debe lanzarse hacia delante y abajo (cuello y cabeza con bend positivo) y el hocico mirar al frente o un poco abajo.` });
  }
  return issues;
}
