/* Sección "Traje EVA": modelo 3D rotable con piezas clickeables, soporte vital en vivo,
 * comparativa Marte–Tierra y fórmulas del modelo de salud.
 *
 * Optimización: este módulo (y su CSS) se carga con import() solo al abrir la sección;
 * usa su propio canvas, que solo renderiza mientras la pestaña 3D está a la vista, y el
 * bucle del mapa principal se pausa mientras la sección está abierta (state.suitLabOpen). */

import './suit_lab.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createExplorer } from './character-lab/character.js';
import { state } from './state.js';
import { SUIT_CATALOG, SUIT_IDS, getSuit, tankPressureKpa, saveSuitPreference, PSI_TO_KPA } from './suits.js';
import { ROLES } from './crew.js';
import { calculateMetabolicRateW, metabolicToVO2Lmin, sustainableSpeedMs, heartRateFromVO2Reserve } from './health.js';
import { groupSustainablePace } from './health_group.js';
import { applyCrew } from './crew_ui.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');

let root = null;          // <section id="suit-lab">
let activeTab = 'suit';
let selectedPart = 'plss';
let hoverPart = null;
let liveTimer = null;

/* ------------------------------------------------------------------ 3D */
let renderer = null, scene3 = null, cam3 = null, orbit = null, character = null;
let rafId = 0, lastT = 0, idleT = 0, autoRotate = true;
const partMeshes = new Map();     // partId → Mesh[]
const partMaterials = new Map();  // partId → Material[] (clones propios de cada pieza)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDirty = false, downAt = null, turnTarget = null;

/* Clasifica cada malla del astronauta por la articulación de la que cuelga */
function classifyParts(ch) {
  const J = ch.joints;
  const ownerOf = new Map();
  /* Las articulaciones están anidadas (pelvis → cintura → cuerpo → cabeza…): al marcar una
   * no se baja a las demás, o la pelvis se quedaría con todo el astronauta. */
  const jointNodes = new Set([J.head, J.body, J.waist, J.pelvis]);
  for (const arm of J.arms) for (const n of [arm.shoulder, arm.elbow, arm.wrist, arm.handData?.group]) if (n) jointNodes.add(n);
  for (const leg of J.legs) for (const n of [leg.thigh, leg.knee, leg.foot, leg.toe]) if (n) jointNodes.add(n);
  const mark = (obj, part) => {
    if (!obj) return;
    const walk = (o) => {
      if (!ownerOf.has(o)) ownerOf.set(o, part);
      for (const child of o.children) if (!jointNodes.has(child)) walk(child);
    };
    walk(obj);
  };
  /* Lo más específico primero: manos y pies antes que brazos y piernas */
  for (const arm of J.arms) mark(arm.handData?.group, 'gloves');
  for (const leg of J.legs) { mark(leg.foot, 'boots'); mark(leg.toe, 'boots'); }
  mark(J.head, 'helmet');
  for (const leg of J.legs) { mark(leg.thigh, 'lower'); mark(leg.knee, 'lower'); }
  mark(J.pelvis, 'lower');
  mark(J.waist, 'lower');
  for (const arm of J.arms) { mark(arm.shoulder, 'torso'); mark(arm.elbow, 'torso'); mark(arm.wrist, 'torso'); }

  ch.root.updateMatrixWorld(true);
  const box = new THREE.Box3(), c = new THREE.Vector3();
  const cloneCache = new Map();
  ch.root.traverse((o) => {
    if (!o.isMesh) return;
    let part = ownerOf.get(o);
    if (!part) {
      /* Cuerpo: mochila atrás, unidad de control al pecho, el resto es torso */
      box.setFromObject(o).getCenter(c);
      if (c.z < -0.12) part = 'plss';
      else if (c.z > 0.1 && c.y > 1.15 && c.y < 1.45 && Math.abs(c.x) < 0.16) part = 'dcu';
      else part = 'torso';
    }
    /* Material propio por pieza para poder resaltarla sin teñir las demás */
    const key = `${part}:${o.material.uuid}`;
    let mat = cloneCache.get(key);
    if (!mat) {
      mat = o.material.clone();
      mat.userData.baseEmissive = mat.emissive ? mat.emissive.clone() : null;
      mat.userData.baseIntensity = mat.emissiveIntensity ?? 1;
      cloneCache.set(key, mat);
      if (!partMaterials.has(part)) partMaterials.set(part, []);
      partMaterials.get(part).push(mat);
    }
    o.material = mat;
    o.userData.suitPart = part;
    if (!partMeshes.has(part)) partMeshes.set(part, []);
    partMeshes.get(part).push(o);
  });
}

const HOVER_COLOR = new THREE.Color(0x66fcf1), SELECT_COLOR = new THREE.Color(0xff6a3d);
function paintParts() {
  for (const [part, mats] of partMaterials) {
    const mode = part === selectedPart ? 2 : part === hoverPart ? 1 : 0;
    for (const m of mats) {
      if (!m.emissive) continue;
      if (mode === 0) {
        m.emissive.copy(m.userData.baseEmissive);
        m.emissiveIntensity = m.userData.baseIntensity;
      } else {
        m.emissive.copy(mode === 2 ? SELECT_COLOR : HOVER_COLOR);
        m.emissiveIntensity = mode === 2 ? 0.55 : 0.35;
      }
    }
  }
}

function init3D(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene3 = new THREE.Scene();
  cam3 = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  cam3.position.set(1.6, 1.3, 4.7);

  scene3.add(new THREE.HemisphereLight(0xffe2c4, 0x40261a, 1.25));
  const key = new THREE.DirectionalLight(0xfff1dd, 2.4); key.position.set(2.5, 4, 3); scene3.add(key);
  const rim = new THREE.DirectionalLight(0x66fcf1, 0.9); rim.position.set(-3, 2, -3); scene3.add(rim);
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.95, 0.05, 48),
    new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.8, metalness: 0.3 }),
  );
  pad.position.y = -0.025;
  scene3.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.008, 8, 64), new THREE.MeshBasicMaterial({ color: 0x66fcf1 }));
  ring.rotation.x = Math.PI / 2;
  scene3.add(ring);

  character = createExplorer();
  /* El modelo no usa sombras aquí: una pasada de sombras sobre 237 mil triángulos no aporta en esta vista */
  character.root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  scene3.add(character.root);
  classifyParts(character);
  paintParts();
  /* Para pruebas y depuración: mallas por pieza clickeable */
  canvas.dataset.parts = JSON.stringify(Object.fromEntries([...partMeshes].map(([part, meshes]) => [part, meshes.length])));

  orbit = new OrbitControls(cam3, canvas);
  orbit.target.set(0, 0.98, 0);
  orbit.enablePan = false;
  orbit.minDistance = 1.6;
  orbit.maxDistance = 7;
  orbit.enableDamping = true;
  orbit.addEventListener('start', () => { autoRotate = false; });
  orbit.update();

  const setPointer = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    pointerDirty = true;
  };
  canvas.addEventListener('pointermove', setPointer);
  canvas.addEventListener('pointerleave', () => { hoverPart = null; paintParts(); canvas.style.cursor = 'grab'; });
  canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    /* Clic = seleccionar pieza; arrastre = rotar (no selecciona) */
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    setPointer(e);
    const part = pickPart();
    if (part) selectPart(part);
  });
}

function pickPart() {
  raycaster.setFromCamera(pointer, cam3);
  const hit = raycaster.intersectObject(character.root, true)[0];
  return hit?.object?.userData?.suitPart || null;
}

function resize3D() {
  if (!renderer) return;
  const canvas = renderer.domElement;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    cam3.aspect = w / h;
    cam3.updateProjectionMatrix();
  }
}

function frame(t) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
  lastT = t;
  resize3D();
  idleT += dt;
  character.pose(idleT, 'idle');
  if (autoRotate) {
    character.root.rotation.y += dt * 0.35;
  } else if (turnTarget !== null) {
    const cur = character.root.rotation.y;
    const d = Math.atan2(Math.sin(turnTarget - cur), Math.cos(turnTarget - cur));
    character.root.rotation.y = cur + d * Math.min(1, dt * 6);
    if (Math.abs(d) < 0.01) turnTarget = null;
  }
  if (pointerDirty) {
    pointerDirty = false;
    const part = pickPart();
    if (part !== hoverPart) {
      hoverPart = part;
      paintParts();
      renderer.domElement.style.cursor = part ? 'pointer' : 'grab';
      const tip = root.querySelector('#suit-hover-tip');
      const comp = part && currentSuit().components.find((c) => c.id === part);
      if (tip) tip.textContent = comp ? comp.name : 'Arrastra para rotar · clic en una pieza para ver su ficha';
    }
  }
  orbit.update();
  renderer.render(scene3, cam3);
}

function start3D() {
  if (rafId || activeTab !== 'suit') return;
  if (!renderer) init3D(root.querySelector('#suit-canvas'));
  lastT = performance.now();
  rafId = requestAnimationFrame(frame);
}
function stop3D() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

/* ------------------------------------------------------------------ datos */
function currentSuit() {
  return getSuit(state.health?.cfg?.suit_id);
}
function player() {
  return state.health?.members?.[0];
}
function cfg() {
  return state.health.cfg;
}

function metabolicAt(member, c, speed, slope_deg) {
  return calculateMetabolicRateW({
    body_mass_kg: member.body_mass_kg, suit_mass_kg: c.suit_mass_kg, suit_true_mass_kg: c.suit_true_mass_kg,
    walk_speed_ms: speed, signed_slope_deg: slope_deg,
    terrain_factor: c.terrain_factor * (c.suit_mobility_factor ?? 1),
  }, c).metabolic_rate_w;
}

/* Valor actual en el modelo del parámetro que toca cada pieza */
function paramValue(param) {
  const c = cfg();
  switch (param) {
    case 'o2_capacity_l_equiv': return `${f(c.o2_capacity_l_equiv)} L por traje`;
    case 'suit_mass_kg': return `${f(c.suit_true_mass_kg)} kg reales → ${f(c.suit_mass_kg, 1)} kg de carga en Marte`;
    case 'co2': return c.co2_removal === 'continuous' ? 'Eliminación continua' : `Cartucho de ${f(c.co2_capacity_l)} L de CO₂`;
    case 'suit_pressure_kpa': return `${f(c.suit_pressure_kpa, 1)} kPa → +${f(c.suit_pressure_overhead_fraction * 100)} % de gasto`;
    case 'suit_mobility_factor': return `× ${f(c.suit_mobility_factor, 2)} sobre η = ${f(c.terrain_factor, 2)}`;
    case 'terrain_factor': return `η = ${f(c.terrain_factor * (c.suit_mobility_factor ?? 1), 2)} efectivo`;
    case 'max_safe_slope_deg': return `${f(c.max_safe_slope_deg)}° de pendiente segura`;
    case 'thermal_lcvg_efficiency': return `${f(c.thermal_lcvg_efficiency * 100)} % del calor retirado`;
    case 'thermal': return `T núcleo inicial ${f(c.t_core_initial_c, 1)} °C · alerta ${f(c.t_core_warning_c, 1)} °C`;
    case 'alerts': return `O₂ bajo < ${f(c.o2_critical_threshold_l)} L · FC > 85 % · T > ${f(c.t_core_warning_c, 1)} °C`;
    default: return null;
  }
}

/* ------------------------------------------------------------------ pestaña Traje */
function renderSuitTab() {
  const suit = currentSuit();
  const c = cfg();
  const p = player();
  const pace = groupSustainablePace(state.health, 0);
  const side = root.querySelector('#suit-side');
  side.innerHTML = `
    <div class="sl-card">
      <div class="sl-kicker">${esc(suit.agency)} · ${esc(suit.era)}</div>
      <h3>${esc(suit.name)} <small>${esc(suit.full_name)}</small></h3>
      <p>${esc(suit.summary)}</p>
      <div class="sl-chips">
        <span><b>${f(suit.total_mass_kg)} kg</b>masa</span>
        <span><b>${f(suit.operating_pressure_kpa, 1)} kPa</b>presión</span>
        <span><b>${f(suit.o2_primary_l_equiv)} L</b>O₂</span>
        <span><b>${f(suit.eva_nominal_h)} h</b>EVA nominal</span>
      </div>
      <div class="sl-note">Hecho para: <b>${esc(suit.designed_for)}</b> · Con este traje ${esc(p?.name || 'el astronauta')} sostiene
        <b>${f(sustainableSpeedMs(p, c, 0), 2)} m/s</b> en plano${state.health.mode === 'group' ? ` y el grupo <b>${f(pace.pace_ms, 2)} m/s</b>` : ''}.</div>
    </div>
    <div class="sl-parts" role="tablist" aria-label="Piezas del traje">
      ${suit.components.map((comp) => `<button type="button" class="sl-part${comp.id === selectedPart ? ' active' : ''}" data-part="${comp.id}">${esc(comp.name)}</button>`).join('')}
    </div>
    <div id="suit-part-card" class="sl-card sl-part-card"></div>
    <div class="sl-sources"><span>Fuentes:</span> ${suit.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(' · ')}</div>`;
  renderPartCard();
}

function renderPartCard() {
  const suit = currentSuit();
  const comp = suit.components.find((x) => x.id === selectedPart) || suit.components[0];
  const card = root.querySelector('#suit-part-card');
  if (!card) return;
  card.innerHTML = `
    <h4>${esc(comp.name)}</h4>
    <p>${esc(comp.description)}</p>
    <table class="sl-specs">
      ${comp.specs.map((s) => `<tr><th>${esc(s.label)}</th><td>${esc(s.value)}</td><td><span class="sl-conf ${s.conf}" title="${s.conf === 'publicado' ? 'Cifra de una fuente pública' : 'Valor de diseño del modelo'}">${s.conf}</span></td></tr>`).join('')}
    </table>
    <div class="sl-affects-title">Cómo influye en el modelo de salud</div>
    <ul class="sl-affects">
      ${comp.affects.map((a) => { const v = paramValue(a.param); return `<li>${esc(a.text)}${v ? `<span class="sl-live">Ahora: ${esc(v)}</span>` : ''}</li>`; }).join('')}
    </ul>
    ${partMeshes.has(comp.id) || !renderer ? '' : '<div class="sl-note">Pieza interior: no se ve en el modelo 3D.</div>'}`;
  root.querySelectorAll('.sl-part').forEach((b) => b.classList.toggle('active', b.dataset.part === comp.id));
}

function selectPart(part, fromList = false) {
  selectedPart = part;
  autoRotate = false;
  /* Al elegir desde la lista, el modelo gira para enseñar la pieza (la mochila está en la espalda) */
  if (fromList && character && cam3) {
    const toCam = Math.atan2(cam3.position.x - orbit.target.x, cam3.position.z - orbit.target.z);
    turnTarget = toCam + (part === 'plss' ? Math.PI : 0);
  }
  paintParts();
  renderPartCard();
}

/* ------------------------------------------------------------------ pestaña Soporte vital */
const MARS_PRESSURE_KPA = 0.61, EARTH_PRESSURE_KPA = 101.3;

function renderLifeTab() {
  const suit = currentSuit();
  const c = cfg();
  const el = root.querySelector('#suit-tab-life');
  const members = state.health.members;
  const rows = members.map((m) => {
    const cap = m.o2_capacity_l_equiv || c.o2_capacity_l_equiv;
    const pct = Math.max(0, Math.min(100, (m.o2_remaining_l / cap) * 100));
    const pk = tankPressureKpa(suit, m.o2_remaining_l, cap);
    const phys = m.physiology;
    const vo2Walk = metabolicToVO2Lmin(metabolicAt(m, c, sustainableSpeedMs(m, c, 0), 0), c.rer_assumed);
    const role = ROLES[m.role];
    const cls = pct < 10 ? 'crit' : pct < 25 ? 'warn' : '';
    const co2 = c.co2_removal === 'continuous'
      ? '<span class="ok">continuo</span>'
      : `<span class="${m.co2_cartridge_used_frac > 0.85 ? 'crit' : ''}">${f((m.co2_cartridge_used_frac || 0) * 100)} % usado</span>`;
    return `<tr>
      <th><span class="sl-dot" style="background:${role?.color || '#66fcf1'}"></span>${esc(m.name || m.id)}</th>
      <td class="sl-bar-cell"><div class="sl-bar ${cls}"><i style="width:${pct.toFixed(1)}%"></i></div><span>${f(pct)} %</span></td>
      <td>${f(m.o2_remaining_l)} / ${f(cap)} L</td>
      <td>${f(pk / 1000, 2)} MPa<small>${f(pk / PSI_TO_KPA)} psi</small></td>
      <td>${f(m.o2_remaining_l / phys.vo2_rest_l_min / 60, 1)} h<small>en reposo</small></td>
      <td>${f(m.o2_remaining_l / vo2Walk / 60, 1)} h<small>caminando</small></td>
      <td>${co2}</td>
      <td>${f(m.dose_usv || 0, 1)} µSv<small>${f((m.career_dose_fraction || 0) * 100, 1)} % de carrera</small></td>
    </tr>`;
  }).join('');

  const p = player();
  const acts = [
    ['En reposo', null, 0],
    ['Caminando en plano', sustainableSpeedMs(p, c, 0), 0],
    ['Subiendo 10°', sustainableSpeedMs(p, c, 10), 10],
    ['Subiendo 20°', sustainableSpeedMs(p, c, 20), 20],
  ].map(([label, v, slope]) => {
    const M = v == null ? null : metabolicAt(p, c, v, slope);
    const vo2 = v == null ? p.physiology.vo2_rest_l_min : metabolicToVO2Lmin(M, c.rer_assumed);
    const hr = heartRateFromVO2Reserve(vo2, p.physiology);
    const over = M != null && M > p.physiology.max_sustainable_m_w * 1.001;
    return `<tr class="${over ? 'over' : ''}"><th>${label}</th><td>${v == null ? '—' : `${f(v, 2)} m/s`}</td><td>${M == null ? '—' : `${f(M)} W`}</td>
      <td>${f(vo2, 2)} L/min</td><td>${f(hr)} bpm</td><td>${f(c.o2_capacity_l_equiv / vo2 / 60, 1)} h</td><td>${over ? 'No sostenible' : 'Sostenible'}</td></tr>`;
  }).join('');

  const delta = c.suit_pressure_kpa - MARS_PRESSURE_KPA;
  el.innerHTML = `
    <div class="sl-grid2">
      <div class="sl-card">
        <h4>Tanques de O₂ de la tripulación <span class="sl-livetag">en vivo</span></h4>
        <div class="sl-scroll"><table class="sl-table">
          <thead><tr><th>Astronauta</th><th>Tanque primario</th><th>O₂</th><th>Presión</th><th colspan="2">Autonomía</th><th>CO₂</th><th>Radiación</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="sl-note">La presión del tanque baja en proporción al O₂ restante (gas ideal a temperatura constante).
          Tanque lleno: ${f(suit.o2_primary_pressure_kpa / 1000, 1)} MPa. Reserva de emergencia: ${f(suit.o2_secondary_min)} min a ${f(suit.o2_secondary_pressure_kpa / 1000, 1)} MPa.</div>
      </div>
      <div class="sl-card">
        <h4>Presiones</h4>
        <div class="sl-pressures">
          ${[['Dentro del traje', c.suit_pressure_kpa, 'var(--hud-cyan)'], ['Marte (Jezero)', MARS_PRESSURE_KPA, 'var(--accent)'], ['Tierra (nivel del mar)', EARTH_PRESSURE_KPA, '#55f29b']]
    .map(([label, v, color]) => `<div><span>${label}</span><div class="sl-pbar"><i style="width:${Math.max(1.2, (v / EARTH_PRESSURE_KPA) * 100).toFixed(1)}%;background:${color}"></i></div><b>${f(v, v < 5 ? 2 : 1)} kPa</b></div>`).join('')}
        </div>
        <div class="sl-note">El traje aguanta <b>${f(delta, 1)} kPa</b> de diferencia con el exterior (${f(c.suit_pressure_kpa / MARS_PRESSURE_KPA)} veces la presión de Marte).
          Con O₂ puro a ${f(c.suit_pressure_kpa, 1)} kPa el astronauta respira una presión parcial de O₂ mayor que en la Tierra (21.2 kPa).
          Mover articulaciones presurizadas añade <b>+${f(c.suit_pressure_overhead_fraction * 100)} %</b> al gasto metabólico.</div>
      </div>
    </div>
    <div class="sl-card">
      <h4>Autonomía de ${esc(p.name || 'el astronauta')} según la actividad <small>(tanque lleno, al ritmo que puede sostener)</small></h4>
      <div class="sl-scroll"><table class="sl-table">
        <thead><tr><th>Actividad</th><th>Ritmo</th><th>Metabolismo</th><th>Consumo de O₂</th><th>FC</th><th>Autonomía</th><th>Estado</th></tr></thead>
        <tbody>${acts}</tbody>
      </table></div>
      <div class="sl-note">Límite sostenible de ${esc(p.name || 'el astronauta')}: ${f(p.physiology.max_sustainable_m_w)} W (60 % de su VO₂máx de ${f(p.physiology.vo2max_ml_kg_min)} mL/kg/min). Agua: ${f(c.potable_water_capacity_l, 1)} L · Enfriamiento: ${esc(suit.cooling)}.</div>
    </div>`;
}

/* ------------------------------------------------------------------ pestaña Marte vs Tierra */
function renderCompareTab() {
  const suit = currentSuit();
  const c = cfg();
  const p = player();
  const earthCfg = { ...c, gravity_correction_mode: 'none', suit_mass_kg: suit.total_mass_kg, suit_true_mass_kg: suit.total_mass_kg };
  const v = 0.8;
  const mMars = metabolicAt(p, c, v, 0), mEarth = metabolicAt(p, earthCfg, v, 0);
  const mMars10 = metabolicAt(p, c, v, 10), mEarth10 = metabolicAt(p, earthCfg, v, 10);
  const gR = c.gravity_ms2 / c.gravity_earth_ms2;
  const doseMars = (c.surface_dose_rate_usv_h * 24) / 1000, doseEarth = 2.4 / 365;
  const env = [
    ['Gravedad', `${f(c.gravity_ms2, 2)} m/s²`, `${f(c.gravity_earth_ms2, 2)} m/s²`, `${f(gR * 100)} % de la terrestre: todo pesa menos, pero la masa (inercia) es la misma.`],
    ['Presión atmosférica', '0.61 kPa', '101.3 kPa', 'Menos del 1 %: sin traje presurizado el agua del cuerpo herviría a 37 °C.'],
    ['Atmósfera', '95 % CO₂ · 0.16 % O₂', '78 % N₂ · 21 % O₂', 'Irrespirable: todo el O₂ va en el tanque.'],
    ['Temperatura media', '−63 °C', '+15 °C', 'El traje debe aislar del frío y a la vez sacar el calor del cuerpo.'],
    ['Radiación (dosis)', `${f(doseMars, 2)} mSv/día`, `${f(doseEarth, 4)} mSv/día`, `${f(doseMars / doseEarth)} veces más: sin campo magnético ni atmósfera densa (RAD/Curiosity).`],
    ['Luz solar', '586 W/m²', '1361 W/m²', '43 %: Marte está 1.52 veces más lejos del Sol.'],
    ['Duración del día', '24 h 39 min (sol)', '24 h', 'Casi igual: los turnos de EVA se planifican por soles.'],
  ];
  const suitRows = [
    [`Peso del traje ${esc(suit.name)}`, `${f(suit.total_mass_kg * gR, 1)} kg-f`, `${f(suit.total_mass_kg)} kg-f`, 'Lo que “se siente” cargar.'],
    [`Peso de ${esc(p.name || 'astronauta')} + traje`, `${f((p.body_mass_kg + suit.total_mass_kg) * gR, 1)} kg-f`, `${f(p.body_mass_kg + suit.total_mass_kg)} kg-f`, ''],
    [`Caminar en plano a ${v} m/s`, `${f(mMars)} W`, `${f(mEarth)} W`, `En la Tierra costaría ${f(mEarth / mMars, 1)} veces más.`],
    ['Subir una cuesta de 10°', `${f(mMars10)} W`, `${f(mEarth10)} W`, mEarth10 > p.physiology.max_sustainable_m_w * 2 ? 'En la Tierra sería imposible con este traje.' : ''],
    ['Autonomía de O₂ caminando en plano', `${f(c.o2_capacity_l_equiv / metabolicToVO2Lmin(mMars, c.rer_assumed) / 60, 1)} h`, `${f(c.o2_capacity_l_equiv / metabolicToVO2Lmin(mEarth, c.rer_assumed) / 60, 1)} h`, 'Mismo tanque, distinto gasto.'],
  ];
  const table = (rows) => `<div class="sl-scroll"><table class="sl-table sl-compare">
      <thead><tr><th></th><th class="mars">Marte</th><th class="earth">Tierra</th><th>Qué significa</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><th>${r[0]}</th><td class="mars">${r[1]}</td><td class="earth">${r[2]}</td><td class="why">${r[3]}</td></tr>`).join('')}</tbody>
    </table></div>`;
  root.querySelector('#suit-tab-compare').innerHTML = `
    <div class="sl-card"><h4>El entorno</h4>${table(env)}</div>
    <div class="sl-card"><h4>El mismo traje y el mismo astronauta en los dos planetas <small>(calculado con el modelo)</small></h4>${table(suitRows)}
      <div class="sl-note">Para la Tierra se usa Pandolf sin corrección de gravedad y con la masa completa del traje como carga.
        Con cargas mayores que el peso del cuerpo la fórmula sale de su rango validado: tómalo como orden de magnitud.</div></div>`;
}

/* ------------------------------------------------------------------ pestaña Fórmulas */
function renderFormulasTab() {
  const c = cfg();
  const p = player();
  const phys = p.physiology;
  const gR = c.gravity_ms2 / c.gravity_earth_ms2;
  const eta = c.terrain_factor * (c.suit_mobility_factor ?? 1);
  const v = sustainableSpeedMs(p, c, 5);
  const M = metabolicAt(p, c, v, 5);
  const vo2 = metabolicToVO2Lmin(M, c.rer_assumed);
  const eo2 = 19.6 + ((c.rer_assumed - 0.7) / 0.3) * 1.5;
  const hr = heartRateFromVO2Reserve(vo2, phys);
  const items = [
    {
      title: '1 · Gasto metabólico al caminar (Pandolf, 1977)',
      eq: 'M = 1.5·W + 2·(W + L)·(L / W)² + η·(W + L)·(1.5·V² + 0.35·V·G)',
      vars: 'W masa corporal (kg) · L carga (kg) · V velocidad (m/s) · G pendiente (%) · η factor de terreno',
      now: `W = ${f(p.body_mass_kg)} kg, L = ${f(c.suit_mass_kg, 1)} kg, η = ${f(eta, 2)}`,
      src: 'Pandolf, Givoni & Goldman (1977), J. Appl. Physiol. 43(4)',
    },
    {
      title: '2 · Corrección a gravedad de Marte',
      eq: 'L = m_traje · (g_M / g_T)\nM = base + k·η·(W + L)·1.5·V² + η·(W + m_traje)·0.35·V·G·(g_M / g_T)',
      vars: 'La marcha en plano usa un factor empírico k; subir es trabajo contra la gravedad y escala con g usando la masa real',
      now: `g_M/g_T = ${f(gR, 3)}, k = ${f(c.gravity_empirical_factor, 2)}, m_traje = ${f(c.suit_true_mass_kg)} kg → L = ${f(c.suit_mass_kg, 1)} kg`,
      src: 'Supuesto del modelo MarsWalk; el término de pendiente coincide con m·g·v / 0.25 de eficiencia muscular',
    },
    {
      title: '3 · Sobrecoste por presión del traje',
      eq: 'M_total = M · (1 + f_p)',
      vars: 'f_p fracción extra por doblar articulaciones presurizadas',
      now: `f_p = ${f(c.suit_pressure_overhead_fraction, 2)} a ${f(c.suit_pressure_kpa, 1)} kPa → a ${f(v, 2)} m/s y 5°: M = ${f(M)} W`,
      src: 'Estimación conservadora; modelo articular de Newman–Barratt fuera de alcance',
    },
    {
      title: '4 · Consumo de oxígeno y CO₂ producido',
      eq: 'VO₂ = M · 60 / (E_O₂ · 1000)      E_O₂ = 19.6 + (RER − 0.7) / 0.3 · 1.5  kJ/L\nVCO₂ = RER · VO₂',
      vars: 'VO₂ en L/min · RER cociente respiratorio',
      now: `RER = ${f(c.rer_assumed, 2)} → E_O₂ = ${f(eo2, 2)} kJ/L → VO₂ = ${f(vo2, 2)} L/min, VCO₂ = ${f(vo2 * c.rer_assumed, 2)} L/min`,
      src: 'Equivalente calórico del O₂ (tabla de Lusk)',
    },
    {
      title: '5 · Capacidad aeróbica de cada astronauta',
      eq: 'VO₂máx(edad) = VO₂máx(25) · (1 − 0.01·(edad − 25))\nM_sostenible = 0.60 · VO₂máx · E_O₂ · 1000 / 60',
      vars: 'VO₂máx(25) depende del sexo y la condición física; baja ~1 % por año',
      now: `${esc(p.name || 'Astronauta')}: ${f(phys.vo2max_ml_kg_min, 1)} mL/kg/min → ${f(phys.vo2max_l_min, 2)} L/min → sostiene ${f(phys.max_sustainable_m_w)} W`,
      src: 'ACSM Guidelines for Exercise Testing and Prescription',
    },
    {
      title: '6 · Frecuencia cardíaca (reserva de VO₂)',
      eq: 'FC = FC_rep + (FC_máx − FC_rep) · (VO₂ − VO₂_rep) / (VO₂máx − VO₂_rep)\nFC_máx = 220 − edad',
      vars: 'VO₂_rep = 3.5 mL/kg/min',
      now: `FC_rep = ${f(phys.hr_rest_bpm)}, FC_máx = ${f(phys.hr_max_bpm)} → FC = ${f(hr)} bpm`,
      src: 'Swain & Leutholtz (1997), Med. Sci. Sports Exerc. 29(3)',
    },
    {
      title: '7 · Tanque de oxígeno',
      eq: 'O₂(t) = O₂_inicial − ∫ VO₂ dt      autonomía = O₂ / VO₂\nP_tanque = P_lleno · O₂ / O₂_inicial',
      vars: 'Gas ideal a temperatura constante',
      now: `${f(p.o2_remaining_l)} de ${f(c.o2_capacity_l_equiv)} L → ${f(p.o2_remaining_l / vo2 / 60, 1)} h a este ritmo`,
      src: 'Ley de Boyle',
    },
    {
      title: '8 · Temperatura corporal',
      eq: 'ΔT = [ M·(1 − ε) − k·(T − T_amb) ] · Δt / (m · c_p)',
      vars: 'ε eficiencia de la prenda de enfriamiento · k pérdida por el aislamiento (0.5 W/K) · c_p = 3.5 kJ/kg·K',
      now: `ε = ${f(c.thermal_lcvg_efficiency, 2)}; en modo nominal el enfriamiento mantiene T ≤ ${f(c.t_core_initial_c + 0.4, 1)} °C`,
      src: 'Balance de calor de Gagge simplificado',
    },
    {
      title: '9 · Hidratación',
      eq: 'sudor = 0.4 · (M / 600) · (1 + 0.2·máx(0, T − 37))  L/h\ndéficit = ∫ (sudor − agua bebida) dt',
      vars: 'Alerta al perder 2 % de la masa corporal; crítico al 4 %',
      now: `A ${f(M)} W: ${f(0.4 * (M / 600), 2)} L/h de sudor frente a ${f(c.potable_water_provision_l_h, 2)} L/h de agua`,
      src: 'Sawka et al. (2007), ACSM Position Stand',
    },
    {
      title: '10 · Radiación',
      eq: 'D = Ḋ · t      fracción de carrera = (D_previa + D) / 600 mSv',
      vars: 'Ḋ dosis equivalente de rayos cósmicos en superficie',
      now: `Ḋ = ${f(c.surface_dose_rate_usv_h, 1)} µSv/h (0.67 mSv/día) → EVA de 8 h: ${f(c.surface_dose_rate_usv_h * 8)} µSv`,
      src: 'Hassler et al. (2014), Science 343 · NASA-STD-3001',
    },
    {
      title: '11 · Ritmo sostenible del grupo',
      eq: 'v_i = máx { v ≤ v_máx : M_i(v, pendiente) ≤ M_sostenible,i }\nv_grupo = mín_i v_i',
      vars: 'El grupo camina al paso del miembro más limitado',
      now: `A 5°: ${esc(p.name || 'astronauta')} ${f(v, 2)} m/s · grupo ${f(groupSustainablePace(state.health, 5).pace_ms, 2)} m/s`,
      src: 'Modelo MarsWalk (bisección sobre la fórmula 2–3)',
    },
    {
      title: '12 · Coste de cada tramo de ruta',
      eq: 'coste = distancia · ( 1 + Σ w_k·f_k / Σ w_k )',
      vars: 'f_k penalización de cada dimensión activa (pendiente, metabolismo, FC, O₂, térmico, hidratación, radiación)',
      now: `Pesos: ${Object.entries(c.route_weights).filter(([, w]) => w > 0).map(([k, w]) => `${k} ${w}`).join(' · ')}`,
      src: 'A* sobre la malla del DEM',
    },
  ];
  root.querySelector('#suit-tab-formulas').innerHTML = `
    <div class="sl-note sl-formulas-intro">Los valores “Ahora” usan a <b>${esc(p.name || 'el astronauta')}</b> con el traje <b>${esc(currentSuit().name)}</b>, subiendo 5° a su ritmo sostenible.</div>
    <div class="sl-formulas">${items.map((it) => `
      <article class="sl-card sl-formula">
        <h4>${it.title}</h4>
        <pre>${esc(it.eq)}</pre>
        <div class="sl-vars">${esc(it.vars)}</div>
        <div class="sl-live">Ahora: ${it.now}</div>
        <div class="sl-src">${esc(it.src)}</div>
      </article>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ estructura */
const TABS = { suit: 'Traje 3D', life: 'Soporte vital', compare: 'Marte vs Tierra', formulas: 'Fórmulas' };
const RENDER = { suit: renderSuitTab, life: renderLifeTab, compare: renderCompareTab, formulas: renderFormulasTab };

function build() {
  root.innerHTML = `
    <div class="sl-shell" role="dialog" aria-modal="true" aria-label="Traje EVA y soporte vital">
      <header class="sl-header">
        <div class="sl-title">// TRAJE EVA</div>
        <label class="sl-suit-pick">Traje
          <select id="suit-select">${SUIT_IDS.map((id) => `<option value="${id}">${esc(SUIT_CATALOG[id].name)} · ${esc(SUIT_CATALOG[id].agency)}</option>`).join('')}</select>
        </label>
        <nav class="sl-tabs" role="tablist">
          ${Object.entries(TABS).map(([id, label]) => `<button type="button" role="tab" class="sl-tab" data-tab="${id}">${label}</button>`).join('')}
        </nav>
        <button type="button" id="suit-close" class="sl-close" aria-label="Cerrar">✕</button>
      </header>
      <div class="sl-body">
        <section id="suit-tab-suit" class="sl-pane sl-pane-suit">
          <div class="sl-stage">
            <canvas id="suit-canvas"></canvas>
            <div id="suit-hover-tip" class="sl-tip">Arrastra para rotar · clic en una pieza para ver su ficha</div>
            <div class="sl-model-note">Modelo 3D genérico: los datos cambian con el traje elegido</div>
          </div>
          <aside id="suit-side" class="sl-side"></aside>
        </section>
        <section id="suit-tab-life" class="sl-pane"></section>
        <section id="suit-tab-compare" class="sl-pane"></section>
        <section id="suit-tab-formulas" class="sl-pane"></section>
      </div>
    </div>`;

  root.querySelector('#suit-close').addEventListener('click', closeSuitLab);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) closeSuitLab(); });
  root.querySelector('.sl-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
  root.querySelector('#suit-select').addEventListener('change', (e) => {
    state.healthCfgOverrides = { ...state.healthCfgOverrides, suit_id: e.target.value };
    saveSuitPreference(e.target.value);
    applyCrew();               // recalcula salud, ritmo y marca rutas como desactualizadas
    RENDER[activeTab]();
  });
  root.querySelector('#suit-side').addEventListener('click', (e) => {
    const b = e.target.closest('[data-part]');
    if (b) selectPart(b.dataset.part, true);
  });
}

function showTab(tab) {
  activeTab = tab;
  root.querySelectorAll('.sl-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-selected', b.dataset.tab === tab);
  });
  root.querySelectorAll('.sl-pane').forEach((p) => { p.hidden = p.id !== `suit-tab-${tab}`; });
  RENDER[tab]();
  if (tab === 'suit') start3D(); else stop3D();
  clearInterval(liveTimer);
  /* Solo la pestaña de soporte vital necesita refresco periódico */
  liveTimer = tab === 'life' ? setInterval(renderLifeTab, 1000) : null;
}

function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeSuitLab(); }
}

export function openSuitLab() {
  root = document.getElementById('suit-lab');
  if (!root || !state.health) return;
  if (!root.firstChild) build();
  root.hidden = false;
  state.suitLabOpen = true;
  document.body.classList.add('suit-lab-open');
  root.querySelector('#suit-select').value = currentSuit().id;
  document.addEventListener('keydown', onKey, true);
  showTab(activeTab);
  root.querySelector('#suit-close').focus();
}

export function closeSuitLab() {
  if (!root) return;
  stop3D();
  clearInterval(liveTimer);
  liveTimer = null;
  root.hidden = true;
  state.suitLabOpen = false;
  document.body.classList.remove('suit-lab-open');
  document.removeEventListener('keydown', onKey, true);
  document.getElementById('suit-lab-btn')?.focus();
}

