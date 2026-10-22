// Página principal: elegir modelo, revisar sus partes, generar animaciones (plantillas o IA
// con autorrevisión), ver la revisión automática y exportar a Roblox Studio.

import { prepareSkeleton } from './skeleton.js';
import { classifySkeleton, detectBodyType, ROLES, ROLE_LABELS } from './classify.js';
import { buildMotion } from './motion.js';
import { bakeAnimation, sampleBaked } from './animation.js';
import { makeContext, buildTemplate, templatesFor } from './templates.js';
import { analyzeAnimation } from './analyze.js';
import { createViewer, renderContactSheet, pickSheetTimes } from './viewer.js';
import { toRbxmx, CONTAINERS } from './export-roblox.js';

const $ = (id) => document.getElementById(id);
const MAX_REVIEW_ROUNDS = 3;

const state = {
  raw: null, skeleton: null, roles: {}, bodyType: 'biped', motion: null, ctx: null,
  anim: null, baked: null, time: 0, playing: true, speed: 1, log: [],
};
const viewer = createViewer($('viewer'));

// ---------- Modelo ----------

async function loadSkeleton(raw) {
  const skeleton = prepareSkeleton(raw); // lanza error con mensajes en castellano si el JSON está mal
  const cls = classifySkeleton(skeleton);
  Object.assign(state, { raw, skeleton, roles: cls.joints, bodyType: cls.bodyType, warnings: cls.warnings });
  rebuildMotion();
  renderParts();
  const firstTemplate = state.bodyType === 'object' ? 'open' : 'walk';
  loadTemplate(firstTemplate);
}

// Recalcula reglas y plantillas (al cargar o al corregir una parte a mano).
function rebuildMotion() {
  state.bodyType = detectBodyType(state.roles);
  state.motion = buildMotion(state.skeleton, state.roles);
  state.ctx = makeContext(state.skeleton, state.motion, state.bodyType);
  viewer.setSkeleton(state.skeleton, state.motion);
  const typeName = { biped: 'bípedo', quadruped: 'cuadrúpedo', object: 'objeto', creature: 'criatura sin patas' }[state.bodyType];
  const kinds = new Set(state.skeleton.joints.map((j) => j.type));
  $('skeleton-info').textContent = `${state.skeleton.name}: ${typeName}, ${state.skeleton.joints.length} articulaciones (${[...kinds].join(' + ')}).`
    + (state.warnings?.length ? ` ⚠ ${state.warnings.join(' ')}` : '');
  renderTemplateButtons();
}

function renderParts() {
  const tbody = $('parts-table').querySelector('tbody');
  tbody.innerHTML = '';
  let doubts = 0;
  for (const j of state.skeleton.joints) {
    const info = state.roles[j.name];
    const doubt = info.confidence === 'baja' || info.confidence === 'media';
    if (doubt) doubts++;
    const tr = document.createElement('tr');
    if (doubt) { tr.className = 'doubt'; tr.title = `Confianza ${info.confidence}: ${info.reason}`; }
    const name = document.createElement('td');
    name.className = 'name';
    name.textContent = j.name;
    tr.appendChild(name);
    const select = (options, value, onChange) => {
      const td = document.createElement('td');
      const s = document.createElement('select');
      for (const [v, label] of options) s.add(new Option(label, v, false, v === value));
      s.onchange = () => { onChange(s.value); info.confidence = 'alta'; info.reason = 'corregido a mano'; tr.className = ''; rebuildMotion(); reloadCurrent(); updatePartsBadge(); };
      td.appendChild(s);
      tr.appendChild(td);
    };
    select(ROLES.map((r) => [r, ROLE_LABELS[r]]), info.role, (v) => (info.role = v));
    select([['L', 'Izq.'], ['C', 'Centro'], ['R', 'Der.']], info.side, (v) => (info.side = v));
    select([['', '—'], ['front', 'Delantera'], ['hind', 'Trasera']], info.region || '', (v) => (info.region = v || null));
    tbody.appendChild(tr);
  }
  updatePartsBadge();
  $('parts').open = doubts > 0;
}

function updatePartsBadge() {
  const doubts = Object.values(state.roles).filter((r) => r.confidence !== 'alta').length;
  $('parts-badge').textContent = doubts ? `· ${doubts} dudosas, revísalas` : '· todo claro';
}

$('skeleton-select').onchange = async (e) => {
  try { await loadSkeleton(await (await fetch(`skeletons/${e.target.value}.json`)).json()); }
  catch (err) { setStatus(err.message, true); }
};
$('skeleton-file').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await loadSkeleton(JSON.parse(await file.text()));
    setStatus(`Esqueleto "${file.name}" cargado.`);
  } catch (err) {
    setStatus(`No se pudo cargar el esqueleto: ${err.message}`, true);
  }
  e.target.value = '';
};

// ---------- Animaciones ----------

function setAnimation(anim, { keepLog = false } = {}) {
  state.anim = anim;
  state.baked = bakeAnimation(anim, state.skeleton, state.motion);
  state.time = 0;
  state.playing = true;
  $('play').textContent = '⏸';
  $('timeline').max = anim.duration;
  $('anim-name').textContent = `${anim.name} · ${anim.duration.toFixed(2)} s${anim.loop ? ' · bucle' : ''} · ${anim.keyframes.length} keyframes`;
  if (!keepLog) { state.log = []; renderLog(); }
  renderIssues(analyzeAnimation(anim, state.skeleton, state.motion, { legLength: state.ctx.legLength }).issues);
}

function loadTemplate(id) {
  const anim = buildTemplate(id, state.ctx);
  if (!anim) return setStatus('Esta plantilla no tiene sentido para este modelo.', true);
  setAnimation(anim);
  document.querySelectorAll('#templates button').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
  setStatus(`Plantilla "${anim.name}" (sin IA).`);
}

// Al corregir una parte, se recalcula la animación actual con las nuevas reglas.
function reloadCurrent() {
  if (!state.anim) return;
  if (state.anim.template && !state.log.length) return loadTemplate(state.anim.template);
  setAnimation(state.anim, { keepLog: true });
}

function renderTemplateButtons() {
  const box = $('templates');
  box.innerHTML = '';
  for (const t of templatesFor(state.bodyType)) {
    const b = document.createElement('button');
    b.textContent = t.label;
    b.dataset.id = t.id;
    b.onclick = () => loadTemplate(t.id);
    box.appendChild(b);
  }
}

function renderIssues(issues) {
  const ul = $('issues');
  ul.innerHTML = '';
  if (!issues.length) {
    ul.innerHTML = '<li class="ok">✓ Sin fallos detectados</li>';
    return;
  }
  for (const i of issues) {
    const li = document.createElement('li');
    li.className = i.severity;
    li.textContent = i.message;
    ul.appendChild(li);
  }
}

function renderLog() {
  $('log-box').hidden = !state.log.length;
  const ol = $('log');
  ol.innerHTML = '';
  for (const e of state.log) {
    const li = document.createElement('li');
    const title = document.createElement('b');
    title.textContent = e.title;
    li.appendChild(title);
    if (e.text) li.append(document.createElement('br'), e.text);
    if (e.image) { const img = document.createElement('img'); img.src = e.image; img.alt = 'Capturas revisadas'; li.appendChild(img); }
    ol.appendChild(li);
  }
  $('log-box').open = true;
}

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

// ---------- IA con autorrevisión ----------

async function api(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function sheetImage(anim) {
  const baked = bakeAnimation(anim, state.skeleton, state.motion);
  return renderContactSheet(state.skeleton, state.motion, baked, pickSheetTimes(anim, 8), ['frente34', 'lado'], 200).toDataURL('image/png');
}

$('generate').onclick = async () => {
  const prompt = $('prompt').value.trim();
  if (!prompt) return setStatus('Escribe primero qué quieres animar.', true);
  const roles = Object.fromEntries(Object.entries(state.roles).map(([k, v]) => [k, { role: v.role, side: v.side, region: v.region }]));
  const base = { prompt, skeleton: state.raw, roles, bodyType: state.bodyType };
  $('generate').disabled = true;
  const started = performance.now();
  state.log = [];
  try {
    setStatus('La IA está creando la animación a partir de la plantilla…');
    const gen = await api('/api/generate', base);
    let anim = gen.animation;
    state.log.push({ title: `Generada (plantilla base: ${gen.template})`, text: gen.dropped?.length ? `Articulaciones desconocidas ignoradas: ${gen.dropped.join(', ')}` : '' });
    setAnimation(anim, { keepLog: true });
    renderLog();

    if ($('self-review').checked) {
      for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
        const { issues } = analyzeAnimation(anim, state.skeleton, state.motion, { legLength: state.ctx.legLength });
        const image = sheetImage(anim);
        setStatus(`Autorrevisión ${round}/${MAX_REVIEW_ROUNDS}: la IA está mirando las capturas…`);
        const rev = await api('/api/review', { ...base, animation: anim, image, issues, iteration: round });
        const problems = (rev.problems || []).map((p) => `• ${p.detail}`).join('\n');
        state.log.push({
          title: `Ronda ${round}: ${rev.ok ? 'aprobada' : 'corregida'}`,
          text: [`Fallos automáticos: ${issues.length ? issues.map((i) => i.message).join(' ') : 'ninguno'}`, problems, rev.changes ? `Cambios: ${rev.changes}` : ''].filter(Boolean).join('\n'),
          image,
        });
        renderLog();
        if (rev.ok || !rev.animation) break;
        anim = rev.animation;
        setAnimation(anim, { keepLog: true });
      }
    }
    anim.reviewLog = state.log.map(({ title, text }) => ({ title, text }));
    window.__ultimaAnimacion = anim; // para tools/prueba-ia.mjs
    setAnimation(anim, { keepLog: true });
    setStatus(`¡Lista! (${((performance.now() - started) / 1000).toFixed(0)} s)`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    $('generate').disabled = false;
  }
};

// ---------- Reproductor ----------

$('play').onclick = () => {
  state.playing = !state.playing;
  $('play').textContent = state.playing ? '⏸' : '▶';
  if (state.playing && !state.anim.loop && state.time >= state.anim.duration) state.time = 0;
};
$('timeline').oninput = (e) => { state.time = Number(e.target.value); state.playing = false; $('play').textContent = '▶'; };
$('speed').onchange = (e) => { state.speed = Number(e.target.value); };

// ---------- Exportar ----------

for (const [value, label] of Object.entries(CONTAINERS)) $('container').add(new Option(label, value));
function download(content, type, ext) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.skeleton.name}-${state.anim.name}`.replace(/[^\w\-áéíóúñ ]+/gi, '').trim() + `.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}
$('export-roblox').onclick = () => download(toRbxmx(state.anim, state.skeleton, state.motion, { container: $('container').value }), 'application/xml', 'rbxmx');
$('download').onclick = () => download(JSON.stringify(state.anim, null, 2), 'application/json', 'json');

// ---------- Bucle de dibujo ----------

let last = performance.now();
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (state.anim) {
    if (state.playing) {
      state.time += dt * state.speed;
      if (state.time > state.anim.duration) {
        if (state.anim.loop) state.time %= state.anim.duration;
        else { state.time = state.anim.duration; state.playing = false; $('play').textContent = '▶'; }
      }
    }
    viewer.setPose(sampleBaked(state.baked, state.time));
    $('timeline').value = state.time;
    $('time').textContent = `${state.time.toFixed(2)} s`;
  }
  viewer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

fetch('/api/status').then((r) => r.json()).then((s) => {
  if (!s.ai) setStatus('Sin clave de IA en el servidor: puedes usar las plantillas.');
}).catch(() => {});

$('skeleton-select').dispatchEvent(new Event('change'));
