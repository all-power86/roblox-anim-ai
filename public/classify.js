import * as THREE from 'three';

// Clasificación automática de las partes de un esqueleto por su función
// (columna, cabeza, patas, alas, cola...). Combina dos pistas:
//   1) el nombre (inglés o castellano: "LeftUpperArm", "HombroDer", "Tail.2"...)
//   2) la forma (qué ramas tocan el suelo, cuáles salen de lado, cuáles van hacia atrás)
// Cada parte recibe una confianza: "alta", "media" o "baja". Las de confianza baja
// se marcan en la web para que el usuario las revise.

export const ROLES = [
  'root', 'spine', 'neck', 'head', 'jaw', 'tail',
  'arm.clavicle', 'arm.upper', 'arm.lower', 'hand',
  'leg.upper', 'leg.lower', 'leg.lower2', 'foot', 'toe',
  'wing.1', 'wing.2', 'hinge', 'fixed',
];

export const ROLE_LABELS = {
  root: 'Raíz / pelvis', spine: 'Columna', neck: 'Cuello', head: 'Cabeza', jaw: 'Mandíbula', tail: 'Cola',
  'arm.clavicle': 'Clavícula', 'arm.upper': 'Brazo (hombro)', 'arm.lower': 'Antebrazo (codo)', hand: 'Mano',
  'leg.upper': 'Pierna/pata (cadera)', 'leg.lower': 'Rodilla', 'leg.lower2': 'Corvejón / muñeca', foot: 'Pie / pezuña', toe: 'Dedos',
  'wing.1': 'Ala (base)', 'wing.2': 'Ala (punta)', hinge: 'Bisagra', fixed: 'Fija (no se mueve)',
};

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function tokens(name) {
  return strip(String(name || ''))
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const has = (toks, words) => toks.some((t) => words.includes(t));

// Lado y delante/detrás según el nombre.
function nameSide(toks) {
  if (has(toks, ['left', 'l', 'izq', 'izquierda', 'izquierdo', 'fl', 'hl', 'bl'])) return 'L';
  if (has(toks, ['right', 'r', 'der', 'derecha', 'derecho', 'fr', 'hr', 'br'])) return 'R';
  return null;
}
function nameRegion(toks) {
  if (has(toks, ['front', 'fore', 'delantera', 'delantero', 'anterior', 'fl', 'fr'])) return 'front';
  if (has(toks, ['hind', 'rear', 'back', 'trasera', 'trasero', 'posterior', 'hl', 'hr', 'bl', 'br'])) return 'hind';
  return null;
}

// Tipo de miembro y, si el nombre lo dice, el tramo concreto.
function nameRole(toks) {
  const t = (w) => has(toks, w);
  if (t(['hinge', 'bisagra', 'door', 'puerta', 'lid', 'tapa', 'gate', 'verja'])) return { limb: 'hinge', role: 'hinge' };
  if (t(['jaw', 'mandibula', 'boca', 'mouth', 'chin'])) return { limb: 'trunk', role: 'jaw' };
  if (t(['tail', 'cola'])) return { limb: 'tail', role: 'tail' };
  if (t(['wing', 'wings', 'ala', 'alas'])) return { limb: 'wing', role: null };
  if (t(['head', 'cabeza', 'skull', 'craneo'])) return { limb: 'trunk', role: 'head' };
  if (t(['neck', 'cuello'])) return { limb: 'trunk', role: 'neck' };
  if (t(['clavicle', 'clavicula', 'collar'])) return { limb: 'arm', role: 'arm.clavicle' };
  if (t(['forearm', 'antebrazo', 'elbow', 'codo']) || (t(['lower']) && t(['arm']))) return { limb: 'arm', role: 'arm.lower' };
  if (t(['hand', 'mano', 'wrist', 'muneca', 'palm', 'palma'])) return { limb: 'arm', role: 'hand' };
  if (t(['finger', 'dedo', 'thumb', 'pulgar'])) return { limb: 'arm', role: 'fixed' };
  if (t(['shoulder', 'hombro']) || (t(['upper']) && t(['arm'])) || t(['arm', 'brazo'])) return { limb: 'arm', role: 'arm.upper' };
  if (t(['shin', 'calf', 'knee', 'rodilla', 'pantorrilla', 'espinilla']) || (t(['lower']) && t(['leg']))) return { limb: 'leg', role: 'leg.lower' };
  if (t(['foot', 'feet', 'pie', 'ankle', 'tobillo', 'paw', 'zarpa', 'hoof', 'pezuna', 'garra', 'claw'])) return { limb: 'leg', role: 'foot' };
  if (t(['toe', 'toes'])) return { limb: 'leg', role: 'toe' };
  if (t(['root', 'raiz', 'pelvis', 'cog'])) return { limb: 'trunk', role: 'root' };
  if (t(['hip', 'hips', 'cadera', 'caderas'])) return { limb: 'leg?', role: null }; // pierna si tiene lado; pelvis si es central
  if (t(['thigh', 'muslo']) || (t(['upper']) && t(['leg']))) return { limb: 'leg', role: 'leg.upper' };
  if (t(['leg', 'legs', 'pierna', 'pata', 'patas'])) return { limb: 'leg', role: null };
  if (t(['spine', 'columna', 'torso', 'chest', 'pecho', 'waist', 'cintura', 'espalda', 'abdomen', 'belly', 'barriga'])) return { limb: 'trunk', role: 'spine' };
  return null;
}

// ---------- Forma ----------

function chainFrom(start) {
  // Sigue el camino más largo desde `start` (para ignorar dedos sueltos).
  const depth = new Map();
  const d = (j) => {
    if (depth.has(j)) return depth.get(j);
    const v = 1 + Math.max(0, ...j.children.map(d));
    depth.set(j, v);
    return v;
  };
  const chain = [start];
  let cur = start;
  while (cur.children.length) {
    cur = cur.children.reduce((a, b) => (d(b) > d(a) ? b : a));
    chain.push(cur);
  }
  return chain;
}

function subtreeSize(j) {
  return 1 + j.children.reduce((s, c) => s + subtreeSize(c), 0);
}

// Umbral de "centrado" en X: relativo a la altura/longitud, no a la anchura
// (unas alas enormes no deben hacer que las patas parezcan centrales).
const centralTolerance = (skeleton) => Math.max(0.05 * Math.max(skeleton.size.y, skeleton.size.z), 0.05);

// Punto final de una cadena: el extremo de su pieza si la tiene (R6: la pierna es una sola pieza).
function chainTip(j) {
  if (j.partCFrame && j.partSize) {
    const c = new THREE.Vector3(j.partCFrame[0], j.partCFrame[1], j.partCFrame[2]);
    const lowest = c.y - j.partSize[1] / 2;
    const away = c.clone().sub(j.restPos);
    return { pos: c.clone().add(away), lowestY: lowest };
  }
  return { pos: j.restPos, lowestY: j.restPos.y };
}

function geometryClassify(skeleton) {
  const res = {};
  const height = Math.max(skeleton.size.y, 0.01);
  const cx = skeleton.center.x;
  const tol = centralTolerance(skeleton);
  const central = (p) => Math.abs(p.x - cx) < tol;
  const roots = skeleton.joints.filter((j) => !j.parentNode);
  if (!roots.length) return res;

  // Tronco: desde la raíz, seguir el hijo central con el subárbol más grande.
  const root = roots.reduce((a, b) => (subtreeSize(b) > subtreeSize(a) ? b : a));
  const trunk = [root];
  let cur = root;
  for (;;) {
    const next = cur.children.filter((c) => central(c.restPos)).sort((a, b) => subtreeSize(b) - subtreeSize(a))[0];
    if (!next) break;
    // Una cola sale hacia atrás desde la pelvis; el tronco sigue hacia delante/arriba.
    const dir = next.restPos.clone().sub(cur.restPos);
    if (trunk.length === 1 && dir.z > Math.abs(dir.y) && cur.children.filter((c) => central(c.restPos)).length > 1) {
      const alt = cur.children.filter((c) => central(c.restPos) && c !== next)[0];
      if (alt) { trunk.push(alt); cur = alt; continue; }
    }
    trunk.push(next);
    cur = next;
  }
  // Mandíbula: último tramo corto que baja desde la cabeza.
  if (trunk.length >= 3) {
    const last = trunk[trunk.length - 1];
    const prev = trunk[trunk.length - 2];
    const prevLen = prev.restPos.distanceTo(trunk[trunk.length - 3].restPos);
    if (!last.children.length && last.restPos.distanceTo(prev.restPos) < prevLen * 0.8 && last.restPos.y < prev.restPos.y) {
      res[last.name] = { role: 'jaw', limb: 'trunk' };
      trunk.pop();
    }
  }
  const trunkSet = new Set(trunk);

  // Ramas que salen del tronco.
  const branches = [];
  for (const t of trunk) {
    for (const c of t.children) if (!trunkSet.has(c) && !res[c.name]) branches.push({ base: t, chain: chainFrom(c) });
  }
  const groundY = skeleton.ground;
  for (const b of branches) {
    const start = b.chain[0].restPos;
    const end = chainTip(b.chain[b.chain.length - 1]);
    const tip = end.pos;
    b.reachesGround = end.lowestY < groundY + height * 0.15;
    b.lateral = !central(tip) || !central(start);
    b.span = Math.abs(tip.x - start.x);
    b.goesBack = tip.z - start.z > Math.max(Math.abs(tip.x - start.x), 0.3) && !b.lateral;
  }
  const legs = branches.filter((b) => b.reachesGround && b.lateral);
  for (const b of branches) {
    if (b.reachesGround && b.lateral) b.limb = 'leg';
    else if (b.goesBack && trunk.indexOf(b.base) <= 1) b.limb = 'tail';
    else if (b.lateral) b.limb = 'arm';
    else b.limb = 'fixed';
  }
  // Brazos o alas: con 4 patas, las ramas laterales que no tocan el suelo son alas.
  // Con 2 piernas y dos pares laterales, el par más largo y alto son alas.
  const lateralFree = branches.filter((b) => b.limb === 'arm');
  if (legs.length >= 4) lateralFree.forEach((b) => (b.limb = 'wing'));
  else if (lateralFree.length >= 4) {
    const sorted = [...lateralFree].sort((a, b) => b.span - a.span);
    sorted.slice(0, 2).forEach((b) => (b.limb = 'wing'));
  }

  // Delante/detrás de las patas: según la posición respecto al centro del tronco.
  const trunkZ = trunk.reduce((s, j) => s + j.restPos.z, 0) / trunk.length;
  for (const b of branches) {
    b.region = b.limb === 'leg' && legs.length >= 4 ? (b.chain[0].restPos.z < trunkZ ? 'front' : 'hind') : null;
    b.chain.forEach((j, i) => (res[j.name] = { limb: b.limb, index: i, length: b.chain.length, region: b.region }));
    // Hijos que no están en la cadena principal (dedos...): fijos.
    const inChain = new Set(b.chain);
    const markRest = (j) => j.children.forEach((c) => { if (!inChain.has(c) && !res[c.name]) { res[c.name] = { limb: 'fixed', role: 'fixed' }; markRest(c); } });
    b.chain.forEach(markRest);
  }

  // Funciones del tronco: raíz, columna hasta el último nudo con brazos/patas/alas, luego cuello y cabeza.
  const lastLimbBase = Math.max(0, ...branches.filter((b) => b.limb !== 'tail' && b.limb !== 'fixed').map((b) => trunk.indexOf(b.base)));
  trunk.forEach((j, i) => {
    let role;
    if (i === 0) role = 'root';
    else if (i === trunk.length - 1 && i > lastLimbBase) role = 'head';
    else if (i <= lastLimbBase) role = 'spine';
    else role = 'neck';
    res[j.name] = { limb: 'trunk', role };
  });
  if (trunk.length === 1 && !branches.length) res[root.name] = { limb: 'hinge', role: 'hinge' };
  return res;
}

// Tramo concreto según la posición dentro de la cadena del miembro.
function segmentRole(limb, index, length, region) {
  if (limb === 'leg') {
    if (length >= 4) return ['leg.upper', 'leg.lower', 'leg.lower2', 'foot'][index] || 'toe';
    return ['leg.upper', 'leg.lower', 'foot'][index] || 'toe';
  }
  if (limb === 'arm') return ['arm.upper', 'arm.lower', 'hand'][index] || 'fixed';
  if (limb === 'wing') return index === 0 ? 'wing.1' : 'wing.2';
  if (limb === 'tail') return 'tail';
  if (limb === 'hinge') return 'hinge';
  return 'fixed';
}

// Resultado: { joints: { nombre: {role, side, region, confidence, reason} }, bodyType, warnings }
export function classifySkeleton(skeleton) {
  const geo = geometryClassify(skeleton);
  const tol = centralTolerance(skeleton);
  const out = {};
  const warnings = [];
  let sideConflicts = 0;

  for (const j of skeleton.joints) {
    const toks = [...tokens(j.name), ...(j.type === 'Motor6D' && !nameRole(tokens(j.name)) ? tokens(j.part) : [])];
    const byName = nameRole(toks);
    const g = geo[j.name] || { limb: 'fixed', role: 'fixed' };
    const dx = j.restPos.x - skeleton.center.x;
    const geoSide = dx > tol ? 'R' : dx < -tol ? 'L' : 'C';
    const nSide = nameSide(toks);
    if (nSide && geoSide !== 'C' && nSide !== geoSide) sideConflicts++;

    let role;
    let confidence;
    let reason;
    const geoRole = g.role || segmentRole(g.limb, g.index ?? 0, g.length ?? 1, g.region);

    if (byName) {
      let limb = byName.limb;
      if (limb === 'leg?') limb = (nSide || geoSide !== 'C') ? 'leg' : 'trunk';
      role = byName.role || (limb === 'trunk' ? 'root' : null);
      if (!role) {
        // El nombre dice el miembro ("FrontLeg_L_2"); el tramo sale de la cadena.
        const sameLimb = g.limb === limb;
        role = segmentRole(limb, sameLimb ? g.index ?? 0 : 0, sameLimb ? g.length ?? 1 : 1, g.region);
      }
      const agree = g.limb === limb || (limb === 'trunk' && g.limb === 'trunk') || role === geoRole;
      confidence = agree ? 'alta' : 'media';
      reason = agree ? 'nombre y forma coinciden' : `por el nombre; la forma sugiere "${ROLE_LABELS[geoRole] || geoRole}"`;
      // Un "cuello" sin nada detrás es la cabeza (p. ej. el Neck de R15/R6 mueve la cabeza).
      if (role === 'neck' && j.children.every((c) => nameRole(tokens(c.name))?.role === 'jaw')) role = 'head';
      if (limb === 'leg' && g.limb === 'arm' && !g.region) { confidence = 'baja'; reason = 'el nombre dice pierna pero no llega al suelo'; }
    } else {
      role = geoRole;
      confidence = g.limb === 'fixed' ? 'baja' : 'media';
      reason = g.limb === 'fixed' ? 'no se reconoce ni por nombre ni por forma' : 'deducido por la forma';
    }

    const side = ['root', 'spine', 'neck', 'head', 'jaw', 'tail'].includes(role) ? 'C' : (nSide || geoSide);
    const region = role.startsWith('leg.') || role === 'foot' || role === 'toe'
      ? (nameRegion(toks) || g.region || null)
      : null;
    out[j.name] = { role, side, region, confidence, reason };
  }

  // Corrección de la región en patas: todas las piezas de una pata comparten la de su base.
  for (const j of skeleton.joints) {
    const c = out[j.name];
    if (c.region == null && j.parentNode && out[j.parentNode.name]?.region && (c.role.startsWith('leg') || c.role === 'foot' || c.role === 'toe')) {
      c.region = out[j.parentNode.name].region;
    }
  }

  if (sideConflicts >= 2) warnings.push('Varias partes "izquierdas" están a la derecha: ¿el modelo mira hacia +Z en vez de -Z?');
  const bodyType = detectBodyType(out);
  if (bodyType === 'quadruped') {
    for (const [n, c] of Object.entries(out)) {
      if ((c.role.startsWith('leg') || c.role === 'foot') && !c.region) { c.confidence = 'baja'; c.reason = 'no sé si es pata delantera o trasera'; }
    }
  }
  return { joints: out, bodyType, warnings };
}

export function detectBodyType(joints) {
  const legs = new Set(Object.values(joints).filter((c) => c.role === 'leg.upper').map((c) => `${c.side}/${c.region}`));
  const hasHinge = Object.values(joints).some((c) => c.role === 'hinge');
  if (legs.size >= 4) return 'quadruped';
  if (legs.size >= 2) return 'biped';
  if (hasHinge) return 'object';
  return 'creature';
}
