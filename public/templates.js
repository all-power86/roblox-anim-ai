// Plantillas de movimiento: reposo, caminar, correr, saltar, atacar y saludar,
// para bípedos y cuadrúpedos (más "abrir" para objetos con bisagra).
//
// Están escritas por FUNCIÓN (pierna, brazo, cola...), no por esqueleto, así que la misma
// plantilla sirve para un R15, un yeti o un lobo. Después se ajustan los pies al suelo.

import { groundFix } from './animation.js';

export const TEMPLATE_LIST = [
  { id: 'idle', label: 'Reposo', keywords: ['reposo', 'quieto', 'respirar', 'idle', 'esperar', 'parado', 'descanso'] },
  { id: 'walk', label: 'Caminar', keywords: ['caminar', 'andar', 'camina', 'anda', 'pasear', 'walk', 'paso'] },
  { id: 'run', label: 'Correr', keywords: ['correr', 'corre', 'trotar', 'galopar', 'sprint', 'run', 'huir'] },
  { id: 'jump', label: 'Saltar', keywords: ['saltar', 'salto', 'salta', 'brincar', 'jump'] },
  { id: 'attack', label: 'Atacar', keywords: ['atacar', 'ataque', 'golpe', 'golpear', 'puñetazo', 'morder', 'mordisco', 'zarpazo', 'attack', 'pegar', 'espada'] },
  { id: 'wave', label: 'Saludar', keywords: ['saludar', 'saludo', 'saluda', 'hola', 'wave', 'despedir'] },
  { id: 'open', label: 'Abrir', keywords: ['abrir', 'abre', 'cerrar', 'cierra', 'open', 'close', 'puerta'], objectOnly: true },
];

const TAU = Math.PI * 2;

// Curva periódica suave a partir de una tabla de valores (Catmull-Rom). s en [0, 1).
function cycle(table, s) {
  const n = table.length;
  const x = (((s % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  const t = x - i;
  const p = (k) => table[((i + k) % n + n) % n];
  const [p0, p1, p2, p3] = [p(-1), p(0), p(1), p(2)];
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

// ---------- Contexto: qué partes tiene este esqueleto ----------

export function makeContext(skeleton, motion, bodyType) {
  const joints = Object.values(motion.joints);
  const byRole = (role, side, region) => joints.filter((j) => j.role === role
    && (side == null || j.side === side)
    && (region == null || j.region === region || j.region == null));
  // Cadenas ordenadas desde la base (por profundidad en la jerarquía).
  const depth = (name) => { let d = 0; let j = skeleton.byName[name]; while (j.parentNode) { d++; j = j.parentNode; } return d; };
  const chain = (role, side) => byRole(role, side).sort((a, b) => depth(a.name) - depth(b.name));
  const root = skeleton.byName[motion.rootJoint];
  const legLength = root && motion.joints[root.name]?.role === 'root'
    ? Math.max(root.restPos.y - skeleton.ground, 0.5)
    : Math.max(skeleton.size.y * 0.45, 0.5);
  return {
    skeleton, motion, bodyType, byRole, chain, legLength,
    // Escala de tiempo: los animales grandes se mueven más despacio (∝ raíz de la longitud).
    timeScale: Math.sqrt(legLength / (bodyType === 'quadruped' ? 2.2 : 2.7)),
    hasWings: byRole('wing.1').length > 0,
    hasTail: byRole('tail').length > 0,
  };
}

// ---------- Constructor de poses por función ----------

class Pose {
  constructor(ctx) {
    this.ctx = ctx;
    this.values = new Map();
    this.root = {};
    this.flags = {};
  }
  add(name, v) {
    const cur = this.values.get(name) || { bend: 0, side: 0, twist: 0 };
    for (const k of ['bend', 'side', 'twist']) cur[k] += v[k] || 0;
    this.values.set(name, cur);
    return this;
  }
  // Todas las articulaciones con esa función (y lado/región si se indican).
  limb(role, side, region, v) {
    this.ctx.byRole(role, side, region).forEach((j) => this.add(j.name, v));
    return this;
  }
  // Reparte un valor total entre los tramos de una cadena (columna, cuello).
  chain(role, v) {
    const c = this.ctx.chain(role);
    c.forEach((j) => this.add(j.name, { bend: (v.bend || 0) / c.length, side: (v.side || 0) / c.length, twist: (v.twist || 0) / c.length }));
    return this;
  }
  // Valor distinto en cada tramo: fn(índice, total) (ondas de cola, alas).
  each(role, side, fn) {
    const c = this.ctx.chain(role, side);
    c.forEach((j, i) => this.add(j.name, fn(i, c.length)));
    return this;
  }
  move(v) { Object.assign(this.root, v); return this; }
  air(lift) { this.flags = { grounded: false, lift }; return this; }
  out(time, easing = 'Linear') {
    const poses = [...this.values.entries()].map(([joint, v]) => ({ joint, bend: r1(v.bend), side: r1(v.side), twist: r1(v.twist) }));
    const root = Object.fromEntries(Object.entries(this.root).map(([k, v]) => [k, r3(v)]));
    return { time: r3(time), easing, ...(this.flags.grounded === false ? { grounded: false, lift: r3(this.flags.lift || 0) } : {}), root, poses };
  }
}
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

// Posturas comunes.
function wingsFolded(p, breath = 0) {
  for (const side of ['L', 'R']) {
    p.limb('wing.1', side, null, { bend: -30 + breath, side: -25 });
    p.each('wing.2', side, (i) => ({ bend: i === 0 ? 45 : 20, side: -10 }));
  }
}
function wingsFlap(p, s, amp = 55) {
  // s: fase del aleteo (0..1). bend negativo = ala arriba.
  for (const side of ['L', 'R']) {
    p.limb('wing.1', side, null, { bend: amp * Math.sin(TAU * s) - 10, side: 5 * Math.cos(TAU * s) });
    p.each('wing.2', side, (i) => ({ bend: 10 + 15 * Math.sin(TAU * s - 0.8 - i * 0.4), side: 12 * Math.sin(TAU * s - 0.6) }));
  }
}
// Alas abiertas hacia arriba (amenaza). up en grados.
function wingsSpread(p, up) {
  for (const side of ['L', 'R']) {
    p.limb('wing.1', side, null, { bend: -up, side: 10 });
    p.each('wing.2', side, (i) => ({ bend: 8 + i * 4 }));
  }
}
function tailWave(p, t, period, amp, lift = 0) {
  p.each('tail', null, (i) => ({ side: amp * Math.sin(TAU * t / period - i * 0.7), bend: lift }));
}

// Ciclo de una pierna de bípedo (s = 0: el talón toca el suelo).
const BIPED_WALK = {
  hip: [25, 18, 6, -8, -18, -12, 8, 22],
  knee: [4, 14, 8, 6, 28, 58, 42, 10],
  foot: [-14, 0, 2, 8, 22, 8, -6, -14],
};
const BIPED_RUN = {
  hip: [32, 18, -2, -25, -32, 5, 40, 42],
  knee: [22, 38, 22, 28, 85, 115, 80, 35],
  foot: [-8, 12, 20, 32, 12, 0, -12, -10],
};
// Ciclo de una pata de cuadrúpedo (s = 0: la pata se apoya delante).
const QUAD_STEP = {
  upper: [22, 12, 2, -8, -18, -8, 12, 24],
  lower: [6, 8, 10, 16, 32, 52, 36, 10],
  lower2: [6, 6, 8, 16, 26, 42, 26, 8],
  foot: [-10, 0, 5, 12, 24, 14, 0, -10],
};

function bipedLegs(p, table, sR, scale = 1) {
  for (const [side, s] of [['R', sR], ['L', sR + 0.5]]) {
    p.limb('leg.upper', side, null, { bend: cycle(table.hip, s) * scale, side: 2 });
    p.limb('leg.lower', side, null, { bend: Math.max(0, cycle(table.knee, s) * scale) });
    p.limb('foot', side, null, { bend: cycle(table.foot, s) * scale });
  }
}
function quadLegs(p, phases, scale = 1) {
  for (const [side, region, s] of phases) {
    // Las delanteras van algo más adelante y las traseras más atrás, para que no choquen.
    const bias = scale > 1 ? (region === 'front' ? 8 : -8) : 0;
    p.limb('leg.upper', side, region, { bend: cycle(QUAD_STEP.upper, s) * scale + bias });
    p.limb('leg.lower', side, region, { bend: Math.max(0, cycle(QUAD_STEP.lower, s) * scale) });
    p.limb('leg.lower2', side, region, { bend: cycle(QUAD_STEP.lower2, s) * scale });
    p.limb('foot', side, region, { bend: cycle(QUAD_STEP.foot, s) * scale });
  }
}

// Muestrea una función de pose a lo largo de un ciclo.
function loopFrames(ctx, period, samples, fn) {
  const kfs = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * period;
    const p = new Pose(ctx);
    fn(p, i === samples ? 0 : i / samples, t);
    kfs.push(p.out(t, 'Linear'));
  }
  return kfs;
}

// ---------- Bípedos ----------

const BIPED = {
  idle(ctx) {
    const T = 3.2 * ctx.timeScale;
    return { loop: true, duration: T, keyframes: loopFrames(ctx, T, 8, (p, s) => {
      const b = Math.sin(TAU * s);
      p.chain('spine', { bend: 2 * b - 1, twist: 2 * Math.sin(TAU * s * 2) * 0 });
      p.limb('head', null, null, { bend: -1.5 * b, twist: 6 * Math.sin(TAU * s) });
      p.limb('neck', null, null, { bend: -1 * b });
      for (const side of ['L', 'R']) {
        p.limb('arm.upper', side, null, { side: 6 + 1.5 * b, bend: 3 });
        p.limb('arm.lower', side, null, { bend: 12 + 2 * b });
        p.limb('leg.upper', side, null, { bend: 3, side: 2 });
        p.limb('leg.lower', side, null, { bend: 5 });
        p.limb('foot', side, null, { bend: -2 });
      }
      p.move({ right: 0.02 * ctx.legLength * Math.sin(TAU * s) });
      if (ctx.hasWings) wingsFolded(p, 3 * b);
      if (ctx.hasTail) tailWave(p, s * T, T, 6);
    }) };
  },
  walk(ctx) {
    const T = 1.1 * ctx.timeScale;
    return { loop: true, duration: T, keyframes: loopFrames(ctx, T, 12, (p, s) => {
      bipedLegs(p, BIPED_WALK, s);
      for (const [side, sLeg] of [['R', s], ['L', s + 0.5]]) {
        // El brazo se mueve al revés que la pierna del mismo lado.
        p.limb('arm.upper', side, null, { bend: -0.7 * cycle(BIPED_WALK.hip, sLeg), side: 7 });
        p.limb('arm.lower', side, null, { bend: 15 + 10 * Math.max(0, -Math.cos(TAU * sLeg)) });
      }
      p.chain('spine', { bend: 4, twist: 7 * Math.cos(TAU * s) });
      p.limb('head', null, null, { twist: -4 * Math.cos(TAU * s), bend: -2 });
      p.limb('neck', null, null, { twist: -3 * Math.cos(TAU * s) });
      p.move({ right: 0.03 * ctx.legLength * Math.sin(TAU * s) });
      if (ctx.hasWings) wingsFolded(p);
      if (ctx.hasTail) tailWave(p, s * T, T, 10);
    }) };
  },
  run(ctx) {
    const T = 0.7 * ctx.timeScale;
    return { loop: true, duration: T, keyframes: loopFrames(ctx, T, 12, (p, s) => {
      bipedLegs(p, BIPED_RUN, s);
      for (const [side, sLeg] of [['R', s], ['L', s + 0.5]]) {
        p.limb('arm.upper', side, null, { bend: -0.9 * cycle(BIPED_RUN.hip, sLeg) + 10, side: 10 });
        p.limb('arm.lower', side, null, { bend: 85 });
      }
      p.chain('spine', { bend: 14, twist: 10 * Math.cos(TAU * s) });
      p.limb('head', null, null, { bend: -10, twist: -6 * Math.cos(TAU * s) });
      // Fase de vuelo: entre apoyos los dos pies están en el aire.
      const flight = Math.max(0, Math.sin(TAU * 2 * (s - 0.12)));
      if (flight > 0.3) p.air(0.08 * ctx.legLength * flight);
      if (ctx.hasWings) wingsFolded(p);
      if (ctx.hasTail) tailWave(p, s * T, T, 12, 10);
    }) };
  },
  jump(ctx) {
    const k = ctx.timeScale;
    const L = ctx.legLength;
    const frame = (t, easing, legs, arms, spine, opts = {}) => {
      const p = new Pose(ctx);
      for (const side of ['L', 'R']) {
        p.limb('leg.upper', side, null, { bend: legs[0], side: 3 });
        p.limb('leg.lower', side, null, { bend: legs[1] });
        p.limb('foot', side, null, { bend: legs[2] });
        p.limb('arm.upper', side, null, { bend: arms[0], side: arms[1] });
        p.limb('arm.lower', side, null, { bend: arms[2] });
      }
      p.chain('spine', { bend: spine });
      p.limb('head', null, null, { bend: -spine * 0.6 });
      if (opts.air) p.air(opts.air);
      if (ctx.hasWings) (opts.flap != null ? wingsFlap(p, opts.flap, 60) : wingsFolded(p));
      if (ctx.hasTail) p.each('tail', null, () => ({ bend: opts.tail || 0 }));
      return p.out(t * k, easing);
    };
    return { loop: false, duration: 1.4 * k, keyframes: [
      frame(0, 'Cubic', [3, 5, -2], [3, 6, 12], 0),
      frame(0.3, 'Cubic', [55, 95, -40], [-45, 10, 20], 22, { tail: -10 }),
      frame(0.45, 'Linear', [-5, 5, 35], [140, 30, 10], -5, { flap: 0.75 }),
      frame(0.68, 'Cubic', [40, 70, 10], [150, 35, 15], 5, { air: 0.55 * L, flap: 0.25, tail: 15 }),
      frame(0.92, 'Cubic', [50, 85, -30], [40, 25, 30], 18, { flap: 0.5 }),
      frame(1.12, 'Cubic', [15, 25, -8], [10, 10, 15], 5),
      frame(1.4, 'Cubic', [3, 5, -2], [3, 6, 12], 0),
    ] };
  },
  attack(ctx) {
    // Puñetazo / golpe con el brazo derecho, con paso adelante de la pierna izquierda.
    const k = ctx.timeScale;
    const L = ctx.legLength;
    const frame = (t, easing, o) => {
      const p = new Pose(ctx);
      p.chain('spine', { bend: o.spineBend, twist: o.twist });
      p.limb('head', null, null, { twist: -o.twist * 0.6, bend: -4 });
      p.limb('arm.upper', 'R', null, { bend: o.rArm[0], side: o.rArm[1], twist: o.rArm[2] || 0 });
      p.limb('arm.lower', 'R', null, { bend: o.rArm[3] });
      p.limb('arm.upper', 'L', null, { bend: o.lArm[0], side: o.lArm[1] });
      p.limb('arm.lower', 'L', null, { bend: o.lArm[2] });
      p.limb('leg.upper', 'L', null, { bend: o.lLeg[0], side: 4 });
      p.limb('leg.lower', 'L', null, { bend: o.lLeg[1] });
      p.limb('foot', 'L', null, { bend: o.lLeg[2] });
      p.limb('leg.upper', 'R', null, { bend: o.rLeg[0], side: 4 });
      p.limb('leg.lower', 'R', null, { bend: o.rLeg[1] });
      p.limb('foot', 'R', null, { bend: o.rLeg[2] });
      p.move({ forward: (o.forward || 0) * L });
      if (ctx.hasWings) (o.wings ? wingsSpread(p, 40) : wingsFolded(p));
      if (ctx.hasTail) p.each('tail', null, (i) => ({ side: (o.tail || 0) * (i + 1) / 2 }));
      return p.out(t * k, easing);
    };
    const guard = { spineBend: 5, twist: 0, rArm: [35, 12, 0, 95], lArm: [45, 10, 100], lLeg: [15, 15, -5], rLeg: [-5, 15, 5] };
    return { loop: false, duration: 1.3 * k, keyframes: [
      frame(0, 'Cubic', guard),
      frame(0.35, 'Cubic', { spineBend: 0, twist: 28, rArm: [-35, 35, 0, 120], lArm: [55, 15, 95], lLeg: [10, 20, -5], rLeg: [-5, 20, 5], forward: -0.08, tail: 10, wings: true }),
      frame(0.5, 'Linear', { spineBend: 12, twist: -32, rArm: [92, 8, 0, 4], lArm: [-15, 12, 100], lLeg: [30, 25, -10], rLeg: [-22, 10, 18], forward: 0.22, tail: -15, wings: true }),
      frame(0.72, 'Cubic', { spineBend: 12, twist: -30, rArm: [88, 10, 0, 8], lArm: [-12, 12, 95], lLeg: [30, 25, -10], rLeg: [-22, 10, 18], forward: 0.22, tail: -10 }),
      frame(1.3, 'Cubic', guard),
    ] };
  },
  wave(ctx) {
    const k = ctx.timeScale;
    const frame = (t, raise, elbow, headSide) => {
      const p = new Pose(ctx);
      // Rotar el brazo hacia fuera (twist) hace que el codo se doble hacia arriba al levantarlo.
      p.limb('arm.upper', 'R', null, { side: 8 + raise * 80, twist: raise * 85, bend: raise * 10 });
      p.limb('arm.lower', 'R', null, { bend: 12 + raise * elbow });
      p.limb('hand', 'R', null, { side: raise * 10 });
      p.limb('arm.upper', 'L', null, { side: 6 });
      p.limb('arm.lower', 'L', null, { bend: 12 });
      p.limb('head', null, null, { side: headSide, twist: 10 * raise, bend: -3 });
      p.chain('spine', { side: -4 * raise });
      for (const side of ['L', 'R']) { p.limb('leg.upper', side, null, { bend: 2, side: 2 }); p.limb('leg.lower', side, null, { bend: 4 }); }
      if (ctx.hasWings) wingsFolded(p);
      if (ctx.hasTail) p.each('tail', null, (i) => ({ side: raise * 12 * Math.sin(t * 9 - i) }));
      return p.out(t * k, 'Cubic');
    };
    return { loop: false, duration: 2.4 * k, keyframes: [
      frame(0, 0, 0, 0),
      frame(0.4, 1, 70, 8),
      frame(0.7, 1, 30, 8),
      frame(1.0, 1, 75, 8),
      frame(1.3, 1, 30, 8),
      frame(1.6, 1, 70, 8),
      frame(2.0, 0.15, 10, 2),
      frame(2.4, 0, 0, 0),
    ] };
  },
};

// ---------- Cuadrúpedos (y criaturas sin patas: solo columna/cola/cabeza) ----------

const QUAD = {
  idle(ctx) {
    const T = 3.4 * ctx.timeScale;
    return { loop: true, duration: T, keyframes: loopFrames(ctx, T, 8, (p, s, t) => {
      const b = Math.sin(TAU * s);
      p.chain('spine', { bend: 1.5 * b });
      p.chain('neck', { bend: 3 * b - 4, twist: 10 * Math.sin(TAU * s) });
      p.limb('head', null, null, { bend: 2 * b, side: 4 * Math.sin(TAU * s) });
      for (const side of ['L', 'R']) for (const region of ['front', 'hind']) {
        p.limb('leg.upper', side, region, { bend: 2 });
        p.limb('leg.lower', side, region, { bend: 4 });
      }
      if (ctx.hasWings) wingsFolded(p, 4 * b);
      if (ctx.hasTail) tailWave(p, t, T, 12, 4);
    }) };
  },
  walk(ctx) {
    const T = 1.2 * ctx.timeScale;
    // Paso lateral: trasera izq, delantera izq, trasera der, delantera der.
    return { loop: true, duration: T, keyframes: loopFrames(ctx, T, 12, (p, s, t) => {
      quadLegs(p, [['L', 'hind', s], ['L', 'front', s + 0.25], ['R', 'hind', s + 0.5], ['R', 'front', s + 0.75]]);
      p.chain('spine', { side: 4 * Math.sin(TAU * s), bend: 1.5 * Math.cos(TAU * 2 * s) });
      p.chain('neck', { bend: 4 * Math.cos(TAU * 2 * s), side: -3 * Math.sin(TAU * s) });
      p.limb('head', null, null, { bend: -3 * Math.cos(TAU * 2 * s) });
      if (ctx.hasWings) wingsFolded(p);
      if (ctx.hasTail) tailWave(p, t, T, 12, 6);
    }) };
  },
  run(ctx) {
    const T = 0.6 * ctx.timeScale;
    // Trote: patas en diagonal a la vez.
    return { loop: true, duration: T, keyframes: loopFrames(ctx, T, 12, (p, s, t) => {
      quadLegs(p, [['L', 'front', s], ['R', 'hind', s], ['R', 'front', s + 0.5], ['L', 'hind', s + 0.5]], 1.3);
      p.chain('spine', { bend: 5 * Math.sin(TAU * 2 * s) });
      p.chain('neck', { bend: 10 + 6 * Math.cos(TAU * 2 * s) });
      p.limb('head', null, null, { bend: -6 });
      const flight = Math.max(0, Math.sin(TAU * 2 * (s - 0.2)));
      if (flight > 0.4) p.air(0.06 * ctx.legLength * flight);
      if (ctx.hasWings) wingsFlap(p, 2 * s, 20);
      if (ctx.hasTail) tailWave(p, t, T / 2, 10, 12);
    }) };
  },
  jump(ctx) {
    const k = ctx.timeScale;
    const L = ctx.legLength;
    const frame = (t, easing, front, hind, spine, opts = {}) => {
      const p = new Pose(ctx);
      for (const side of ['L', 'R']) {
        p.limb('leg.upper', side, 'front', { bend: front[0] });
        p.limb('leg.lower', side, 'front', { bend: front[1] });
        p.limb('leg.lower2', side, 'front', { bend: front[2] });
        p.limb('leg.upper', side, 'hind', { bend: hind[0] });
        p.limb('leg.lower', side, 'hind', { bend: hind[1] });
        p.limb('leg.lower2', side, 'hind', { bend: hind[2] });
      }
      p.chain('spine', { bend: spine });
      p.chain('neck', { bend: opts.neck || 0 });
      p.move({ bend: opts.pitch || 0 });
      if (opts.air) p.air(opts.air);
      if (ctx.hasWings) (opts.flap != null ? wingsFlap(p, opts.flap, 60) : wingsFolded(p));
      if (ctx.hasTail) p.each('tail', null, () => ({ bend: opts.tail || 0 }));
      return p.out(t * k, easing);
    };
    return { loop: false, duration: 1.5 * k, keyframes: [
      frame(0, 'Cubic', [2, 4, 2], [2, 4, 2], 0),
      frame(0.35, 'Cubic', [25, 40, 30], [45, 70, 55], 8, { neck: 10, tail: -10, pitch: 6 }),
      frame(0.5, 'Linear', [60, 30, 20], [-35, 10, -10], -6, { neck: -10, pitch: -12, flap: 0.75 }),
      frame(0.75, 'Cubic', [70, 60, 50], [30, 60, 50], 0, { air: 0.55 * L, neck: -5, tail: 15, flap: 0.25 }),
      frame(1.0, 'Cubic', [-15, 25, 20], [30, 50, 40], 4, { neck: 10, pitch: 6, flap: 0.5 }),
      frame(1.2, 'Cubic', [10, 20, 15], [25, 40, 30], 3, { neck: 5 }),
      frame(1.5, 'Cubic', [2, 4, 2], [2, 4, 2], 0),
    ] };
  },
  attack(ctx) {
    // Embestida con mordisco: se agacha, se lanza hacia delante, abre la boca y muerde.
    const k = ctx.timeScale;
    const L = ctx.legLength;
    const frame = (t, easing, o) => {
      const p = new Pose(ctx);
      for (const side of ['L', 'R']) {
        p.limb('leg.upper', side, 'front', { bend: o.front[0] });
        p.limb('leg.lower', side, 'front', { bend: o.front[1] });
        p.limb('leg.lower2', side, 'front', { bend: o.front[2] });
        p.limb('leg.upper', side, 'hind', { bend: o.hind[0] });
        p.limb('leg.lower', side, 'hind', { bend: o.hind[1] });
        p.limb('leg.lower2', side, 'hind', { bend: o.hind[2] });
      }
      p.chain('spine', { bend: o.spine || 0 });
      p.chain('neck', { bend: o.neck });
      p.limb('head', null, null, { bend: o.head || 0 });
      p.limb('jaw', null, null, { bend: o.jaw });
      p.move({ forward: (o.forward || 0) * L, bend: o.pitch || 0 });
      if (ctx.hasWings) (o.wings ? wingsSpread(p, o.wings) : wingsFolded(p));
      if (ctx.hasTail) p.each('tail', null, (i) => ({ bend: o.tail || 0, side: (o.whip || 0) * (i + 1) / 2 }));
      return p.out(t * k, easing);
    };
    const stand = { front: [2, 4, 2], hind: [2, 4, 2], neck: 0, jaw: 0 };
    return { loop: false, duration: 1.4 * k, keyframes: [
      frame(0, 'Cubic', stand),
      frame(0.4, 'Cubic', { front: [-10, 35, 25], hind: [35, 60, 45], spine: 6, neck: 18, head: 5, jaw: 5, forward: -0.15, pitch: -4, tail: 10, wings: 25 }),
      // Mordisco: la cabeza se lanza hacia delante y abajo (no hacia arriba, parecería un aullido).
      frame(0.58, 'Linear', { front: [45, 20, 10], hind: [-25, 10, 5], spine: -6, neck: 14, head: 4, jaw: 38, forward: 0.4, pitch: 4, tail: -5, whip: 18, wings: 55 }),
      frame(0.72, 'Cubic', { front: [40, 25, 15], hind: [-20, 15, 10], spine: -4, neck: 16, head: 10, jaw: 0, forward: 0.4, pitch: 6, tail: -5, whip: -15, wings: 45 }),
      frame(1.4, 'Cubic', stand),
    ] };
  },
  wave(ctx) {
    // "Saludar" en cuadrúpedo: levanta la pata delantera derecha y mueve la cola.
    const k = ctx.timeScale;
    const frame = (t, lift, paw, wag) => {
      const p = new Pose(ctx);
      p.limb('leg.upper', 'R', 'front', { bend: 55 * lift });
      p.limb('leg.lower', 'R', 'front', { bend: 25 * lift + paw });
      p.limb('leg.lower2', 'R', 'front', { bend: 40 * lift });
      p.limb('leg.upper', 'L', 'front', { bend: -5 * lift, side: 4 * lift });
      p.limb('leg.upper', 'L', 'hind', { bend: 12 * lift });
      p.limb('leg.upper', 'R', 'hind', { bend: 12 * lift });
      p.limb('leg.lower', 'L', 'hind', { bend: 20 * lift });
      p.limb('leg.lower', 'R', 'hind', { bend: 20 * lift });
      p.move({ side: -6 * lift, bend: -5 * lift });
      p.chain('neck', { bend: -8 * lift });
      p.limb('head', null, null, { side: 14 * lift });
      if (ctx.hasWings) wingsFolded(p);
      if (ctx.hasTail) p.each('tail', null, (i) => ({ side: wag * (i + 1) / 2, bend: 15 * lift }));
      return p.out(t * k, 'Cubic');
    };
    return { loop: false, duration: 2.4 * k, keyframes: [
      frame(0, 0, 0, 0),
      frame(0.15, 0.15, 50, 5), // primero despega la pata (dobla la muñeca) para no arrastrarla
      frame(0.4, 1, 0, 20),
      frame(0.7, 1, 40, -20),
      frame(1.0, 1, 0, 20),
      frame(1.3, 1, 40, -20),
      frame(1.6, 1, 0, 20),
      frame(2.0, 0.2, 50, 0),
      frame(2.4, 0, 0, 0),
    ] };
  },
};

// ---------- Objetos ----------

const OBJECT = {
  idle(ctx) {
    const T = 3;
    return { loop: true, duration: T, keyframes: loopFrames(ctx, T, 6, (p, s) => p.limb('hinge', null, null, { bend: 1.5 * Math.sin(TAU * s) })) };
  },
  open(ctx) {
    const frame = (t, angle, easing = 'Cubic') => new Pose(ctx).limb('hinge', null, null, { bend: angle }).out(t, easing);
    return { loop: true, duration: 3.6, keyframes: [
      frame(0, 0), frame(1.0, 95), frame(1.9, 95), frame(2.8, -4), frame(3.1, 1.5), frame(3.6, 0),
    ] };
  },
};

// Construye la plantilla `id` para un esqueleto. Devuelve null si no tiene sentido (p. ej. "caminar" en una puerta).
export function buildTemplate(id, ctx) {
  const lib = ctx.bodyType === 'object' ? OBJECT : ctx.bodyType === 'biped' ? BIPED : QUAD;
  const make = lib[id];
  if (!make) return null;
  const meta = TEMPLATE_LIST.find((t) => t.id === id);
  const anim = { name: meta?.label || id, template: id, ...make(ctx) };
  anim.duration = Math.round(anim.duration * 1000) / 1000;
  groundFix(anim, ctx.skeleton, ctx.motion, { plant: !['walk', 'run'].includes(id) });
  return anim;
}

export function templatesFor(bodyType) {
  return TEMPLATE_LIST.filter((t) => (bodyType === 'object' ? ['idle', 'open'].includes(t.id) : !t.objectOnly));
}

// Elige la plantilla más parecida a lo que pide el usuario (por palabras clave).
export function guessTemplate(prompt, bodyType) {
  const text = String(prompt || '').toLowerCase();
  const options = templatesFor(bodyType);
  for (const t of options) if (t.keywords.some((w) => text.includes(w))) return t.id;
  return 'idle';
}
