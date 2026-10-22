// Página principal: dibuja el muñeco R15 en 3D, reproduce animaciones
// y pide nuevas animaciones a la IA a través del servidor.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { JOINTS } from './rig.js';
import { PRESETS } from './presets.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

// ---------- Escena 3D ----------

const viewer = $('viewer');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
viewer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2330);
scene.fog = new THREE.Fog(0x1d2330, 25, 60);

// El personaje mira hacia -Z (como en Roblox), así que la cámara se pone delante, en -Z.
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
camera.position.set(6, 6, -12);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 3, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(5, 12, -6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x3a4250 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(40, 40, 0x56606f, 0x46505e);
grid.position.y = 0.01;
scene.add(grid);

// ---------- Muñeco R15 ----------

const bones = {}; // nombre de articulación -> THREE.Group que gira
for (const j of JOINTS) {
  const group = new THREE.Group();
  group.name = j.name;
  group.position.fromArray(j.offset);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...j.size),
    new THREE.MeshStandardMaterial({ color: j.color, roughness: 0.7 }),
  );
  mesh.position.fromArray(j.center);
  mesh.castShadow = true;
  group.add(mesh);
  (j.parent ? bones[j.parent] : scene).add(group);
  bones[j.name] = group;
}

// Cara (ojos y sonrisa) en el lado -Z de la cabeza, para saber hacia dónde mira.
const faceMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
for (const x of [-0.22, 0.22]) {
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.02), faceMat);
  eye.position.set(x, 0.72, -0.61);
  bones.Neck.add(eye);
}
const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.02), faceMat);
mouth.position.set(0, 0.38, -0.61);
bones.Neck.add(mouth);

const rootRest = bones.Root.position.clone();

// ---------- Reproductor de animación ----------

let anim = null;
let tracks = {}; // articulación -> [{ t, q, easing }]
let rootTrack = []; // [{ t, v, easing }]
let time = 0;
let playing = true;
let speed = 1;

function loadAnimation(a) {
  anim = a;
  tracks = {};
  rootTrack = [];
  for (const k of a.keyframes) {
    for (const p of k.poses) {
      if (!bones[p.joint]) continue;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx * DEG, p.ry * DEG, p.rz * DEG, 'XYZ'));
      (tracks[p.joint] ||= []).push({ t: k.time, q, easing: k.easing });
    }
    if (k.rootOffset) {
      rootTrack.push({ t: k.time, v: new THREE.Vector3(k.rootOffset.x, k.rootOffset.y, k.rootOffset.z), easing: k.easing });
    }
  }
  time = 0;
  $('timeline').max = a.duration;
  renderKeyframeList();
  playing = true;
  $('play').textContent = '⏸';
}

function ease(kind, x) {
  if (kind === 'Constant') return 0;
  if (kind === 'Cubic') return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  return x;
}

// Busca los dos keyframes que rodean el instante t y devuelve cuánto mezclar entre ellos.
function segment(track, t) {
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

const tmpQ = new THREE.Quaternion();
function applyPose(t) {
  for (const j of JOINTS) {
    const track = tracks[j.name];
    if (!track) {
      bones[j.name].quaternion.identity();
      continue;
    }
    const [a, b, f] = segment(track, t);
    tmpQ.slerpQuaternions(a.q, b.q, f);
    bones[j.name].quaternion.copy(tmpQ);
  }
  bones.Root.position.copy(rootRest);
  if (rootTrack.length) {
    const [a, b, f] = segment(rootTrack, t);
    bones.Root.position.add(a.v.clone().lerp(b.v, f));
  }
}

// ---------- Panel ----------

function renderKeyframeList() {
  $('anim-name').textContent = `${anim.name} · ${anim.duration.toFixed(2)} s${anim.loop ? ' · bucle' : ''}`;
  const list = $('keyframes');
  list.innerHTML = '';
  for (const k of anim.keyframes) {
    const li = document.createElement('li');
    const poses = k.poses.map((p) => `${p.joint}(${[p.rx, p.ry, p.rz].map((v) => Math.round(v)).join(', ')})`).join(' ');
    const off = k.rootOffset && (k.rootOffset.x || k.rootOffset.y || k.rootOffset.z)
      ? ` desplazamiento(${[k.rootOffset.x, k.rootOffset.y, k.rootOffset.z].map((v) => v.toFixed(2)).join(', ')})`
      : '';
    li.innerHTML = `<b>${k.time.toFixed(2)} s</b> ${k.easing} — `;
    li.append(poses + off);
    li.dataset.time = k.time;
    list.appendChild(li);
  }
}

function highlightKeyframe(t) {
  let active = null;
  for (const li of $('keyframes').children) {
    li.classList.remove('active');
    if (Number(li.dataset.time) <= t + 1e-6) active = li;
  }
  active?.classList.add('active');
}

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

$('play').onclick = () => {
  playing = !playing;
  $('play').textContent = playing ? '⏸' : '▶';
  if (playing && !anim.loop && time >= anim.duration) time = 0;
};
$('timeline').oninput = (e) => {
  time = Number(e.target.value);
  playing = false;
  $('play').textContent = '▶';
};
$('speed').onchange = (e) => { speed = Number(e.target.value); };
for (const btn of document.querySelectorAll('[data-preset]')) {
  btn.onclick = () => {
    loadAnimation(PRESETS[btn.dataset.preset]);
    setStatus(`Demo cargada: ${PRESETS[btn.dataset.preset].name}`);
  };
}
$('download').onclick = () => {
  const blob = new Blob([JSON.stringify(anim, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${anim.name.replace(/[^\w\-áéíóúñ ]+/gi, '').trim() || 'animacion'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('generate').onclick = async () => {
  const prompt = $('prompt').value.trim();
  if (!prompt) return setStatus('Escribe primero qué quieres que haga el personaje.', true);
  $('generate').disabled = true;
  setStatus('La IA está creando la animación… (puede tardar unos 20–40 segundos)');
  const started = performance.now();
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desconocido');
    loadAnimation(data.animation);
    setStatus(`¡Lista! Generada en ${((performance.now() - started) / 1000).toFixed(0)} s.`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    $('generate').disabled = false;
  }
};

fetch('/api/status').then((r) => r.json()).then((s) => {
  if (!s.ai) setStatus('Modo demo: falta configurar la clave de la IA. Prueba los botones de demo.');
}).catch(() => {});

// ---------- Bucle de dibujo ----------

function resize() {
  const { clientWidth: w, clientHeight: h } = viewer;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (anim) {
    if (playing) {
      time += dt * speed;
      if (time > anim.duration) {
        if (anim.loop) time %= anim.duration;
        else { time = anim.duration; playing = false; $('play').textContent = '▶'; }
      }
    }
    applyPose(time);
    $('timeline').value = time;
    $('time').textContent = `${time.toFixed(2)} s`;
    highlightKeyframe(time);
  }
  controls.update();
  renderer.render(scene, camera);
});

loadAnimation(PRESETS.saludar);
