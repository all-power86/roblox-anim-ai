// Vista previa 3D de cualquier esqueleto y "hojas de capturas" (varios fotogramas en una imagen)
// para que la IA y el usuario revisen la animación.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { forwardKinematics } from './skeleton.js';
import { sampleBaked } from './animation.js';

const COLORS = {
  trunk: 0x2f6fd6, head: 0xf5cd30, arm: 0xf2b84b, leg: 0x4b974b, tail: 0x9b59b6,
  wing: 0xd64545, hinge: 0x8b5a2b, fixed: 0x8a93a3,
};
function colorFor(role) {
  if (!role) return COLORS.fixed;
  if (['root', 'spine', 'neck'].includes(role)) return COLORS.trunk;
  if (role === 'head' || role === 'jaw') return COLORS.head;
  if (role.startsWith('arm') || role === 'hand') return COLORS.arm;
  if (role.startsWith('leg') || role === 'foot' || role === 'toe') return COLORS.leg;
  if (role === 'tail') return COLORS.tail;
  if (role.startsWith('wing')) return COLORS.wing;
  if (role === 'hinge') return COLORS.hinge;
  return COLORS.fixed;
}

// Construye las mallas de un esqueleto. Cada articulación es un Object3D cuya matriz
// se pone directamente con la cinemática directa.
function buildRigMeshes(skeleton, motion) {
  const group = new THREE.Group();
  const nodes = {};
  const faceMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const j of skeleton.joints) {
    const node = new THREE.Object3D();
    node.matrixAutoUpdate = false;
    const role = motion?.joints[j.name]?.role;
    const mat = new THREE.MeshStandardMaterial({ color: colorFor(role), roughness: 0.75 });
    const toLocal = j.restWorld.clone().invert();

    if (j.partOffset && j.partSize) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...j.partSize), mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(j.partOffset);
      mesh.castShadow = true;
      node.add(mesh);
    } else {
      // Hueso: una barra hasta cada hijo (o una bola si es el extremo).
      const r = j.radius || 0.15;
      const targets = j.children.length ? j.children.map((c) => c.restPos.clone().applyMatrix4(toLocal)) : [];
      for (const target of targets) {
        const len = target.length();
        if (len < 1e-3) continue;
        const childR = Math.min(r, (j.children.find((c) => c.restPos.clone().applyMatrix4(toLocal).distanceTo(target) < 1e-6)?.radius) || r);
        const geo = new THREE.CylinderGeometry(childR * 0.85, r, len, 10);
        geo.translate(0, len / 2, 0);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), target.clone().normalize());
        mesh.castShadow = true;
        node.add(mesh);
      }
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat);
      ball.castShadow = true;
      node.add(ball);
    }

    // "Cara": marca negra en la parte delantera de la cabeza para ver hacia dónde mira.
    if (role === 'head') {
      const front = new THREE.Vector3(0, 0, -1).transformDirection(toLocal);
      const size = j.partSize ? Math.min(...j.partSize) : (j.radius || 0.3) * 2;
      const eye = new THREE.Mesh(new THREE.BoxGeometry(size * 0.5, size * 0.12, size * 0.12), faceMat);
      eye.position.copy(front.multiplyScalar(size * 0.5));
      if (j.partOffset) eye.position.add(new THREE.Vector3().setFromMatrixPosition(j.partOffset));
      node.add(eye);
    }
    group.add(node);
    nodes[j.name] = node;
  }
  return { group, nodes };
}

function makeScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d2330);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(6, 14, -8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x3a4250 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(80, 80, 0x56606f, 0x46505e);
  grid.position.y = 0.01;
  scene.add(grid);
  return { scene, sun, ground, grid };
}

function applyPose(rig, skeleton, pose) {
  const fk = forwardKinematics(skeleton, pose);
  for (const j of skeleton.joints) rig.nodes[j.name].matrix.copy(fk[j.name]);
  return fk;
}

// Encuadre de cámara según el tamaño del modelo y la vista.
const VIEWS = {
  frente34: { label: '3/4 frontal', dir: [0.55, 0.35, -1] },
  lado: { label: 'lado derecho', dir: [1, 0.15, 0] },
  frente: { label: 'frente', dir: [0, 0.2, -1] },
  arriba: { label: 'arriba', dir: [0.2, 1.4, -0.4] },
};
function frame(camera, skeleton, viewKey, margin = 1.35) {
  const size = skeleton.size;
  const center = skeleton.center.clone();
  center.y = skeleton.ground + size.y * 0.5;
  // Tamaño visible desde cada vista (de lado no importa la envergadura de las alas).
  const visible = viewKey === 'lado' ? Math.max(size.y, size.z) : viewKey === 'frente' ? Math.max(size.x, size.y) : Math.max(size.y, size.z, size.x * 0.75);
  const radius = visible * 0.62 * margin + 0.5;
  const dist = radius / Math.tan((camera.fov * Math.PI) / 360);
  const dir = new THREE.Vector3(...VIEWS[viewKey].dir).normalize();
  camera.position.copy(center).add(dir.multiplyScalar(dist));
  camera.lookAt(center);
  return center;
}

// ---------- Visor interactivo ----------

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);
  const { scene, ground, grid } = makeScene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  let rig = null;
  let skeleton = null;

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    renderer,
    setSkeleton(sk, motion) {
      if (rig) scene.remove(rig.group);
      skeleton = sk;
      rig = buildRigMeshes(sk, motion);
      scene.add(rig.group);
      ground.position.y = sk.ground;
      grid.position.y = sk.ground + 0.01;
      controls.target.copy(frame(camera, sk, 'frente34', 1.9));
      applyPose(rig, sk, {});
    },
    setPose(pose) { if (rig) applyPose(rig, skeleton, pose); },
    render() { controls.update(); renderer.render(scene, camera); },
  };
}

// ---------- Hoja de capturas ----------
// Devuelve un canvas con `times.length` columnas x `views.length` filas, con rótulos.

export function renderContactSheet(skeleton, motion, baked, times, views = ['frente34', 'lado'], tile = 300) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(tile, tile);
  renderer.shadowMap.enabled = true;
  const { scene, ground, grid } = makeScene();
  ground.position.y = skeleton.ground;
  grid.position.y = skeleton.ground + 0.01;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  const rig = buildRigMeshes(skeleton, motion);
  scene.add(rig.group);

  const label = 22;
  const canvas = document.createElement('canvas');
  canvas.width = tile * times.length;
  canvas.height = (tile + label) * views.length;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#12151c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '14px system-ui, sans-serif';

  views.forEach((view, row) => {
    frame(camera, skeleton, view);
    times.forEach((t, col) => {
      applyPose(rig, skeleton, sampleBaked(baked, t));
      renderer.render(scene, camera);
      const x = col * tile;
      const y = row * (tile + label);
      ctx.drawImage(renderer.domElement, x, y + label);
      ctx.fillStyle = '#e8ebf0';
      ctx.fillText(`t=${t.toFixed(2)} s · ${VIEWS[view].label}`, x + 6, y + 16);
    });
  });
  renderer.dispose();
  return canvas;
}

// Momentos representativos: los keyframes (máx. `max`), repartidos por la animación.
export function pickSheetTimes(anim, max = 8) {
  const times = [...new Set(anim.keyframes.map((k) => k.time))].sort((a, b) => a - b);
  if (anim.loop && times.length > 1) times.pop(); // el último repite el primero
  if (times.length <= max) return times;
  return Array.from({ length: max }, (_, i) => times[Math.round((i * (times.length - 1)) / (max - 1))]);
}
