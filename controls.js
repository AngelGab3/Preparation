/* OrbitControls + PointerLockControls + salto + transiciones + Visor HUD Sci-Fi (T7). */

import * as THREE from 'three';
import { OrbitControls }       from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

import { camera, renderer } from './scene.js';
import { state } from './state.js';
import { CONFIG } from './config.js';
import { sampleGroundY, sampleDemHeightRelM, sampleSlopeDeg, getSlopeCostFactor } from './raycast.js';
import { applyHeights, enableLocalPatch, updateLocalPatchIfNeeded, disableLocalPatch, toggleDustStormSimulation, computeEmergencyEvacuationRoute } from './terrain.js';
import { spawnAstronaut, recallAstronaut } from './astronaut.js';
import { hideInfoPopup, syncPopupHeight } from './popup.js';
import { queryAresCopilot, showTransmissionOnHUD, speakCopilotRadio } from './copilot.js';

const modeBtn = document.getElementById('mode-btn');
const hintEl  = document.querySelector('.hint');
const hSlider = document.getElementById('h-slider');
const hValue  = document.getElementById('h-value');

/* Elementos del Visor HUD Sci-Fi (T7) */
const hudElevEl          = document.getElementById('hud-elev');
const hudSlopeEl         = document.getElementById('hud-slope');
const hudSpeedEl         = document.getElementById('hud-speed');
const hudO2El            = document.getElementById('hud-o2');
const hudO2PctEl         = document.getElementById('hud-o2-pct');
const hudO2RateEl        = document.getElementById('hud-o2-rate');
const hudO2BarEl         = document.getElementById('hud-o2-bar');
const hudFluxBarEl       = document.getElementById('hud-flux-bar');
const hudAlertEl         = document.getElementById('hud-slope-alert');
const hudAlertTextEl     = document.getElementById('hud-alert-text');
const hudStatusLineEl    = document.getElementById('hud-status-line');
const hudDatasetTagEl    = document.getElementById('hud-dataset-tag');
const hudResetO2Btn      = document.getElementById('hud-reset-o2');
const hudTimerEl         = document.getElementById('hud-timer');
const hudCompassTrackEl  = document.getElementById('hud-compass-track');
const reticleSlopeFillEl = document.getElementById('reticle-slope-fill');
const reticleSegsEl      = document.getElementById('reticle-segments');
const badgeWalkEl        = document.getElementById('badge-walk');
const badgeRunEl         = document.getElementById('badge-run');
const badgeSlopeEl       = document.getElementById('badge-slope');
const badgeO2El          = document.getElementById('badge-o2');
const minimapCanvas      = document.getElementById('hud-minimap');
const minimapCtx         = minimapCanvas ? minimapCanvas.getContext('2d') : null;

/* Elementos de Ciencia Interactiva en 1ª Persona y Bitácora EVA (E3) */
const hudSciCountEl      = document.getElementById('hud-sci-count');
const hudSciListEl       = document.getElementById('hud-sci-list');
const hudInteractEl      = document.getElementById('hud-interact-prompt');
const hudInteractTextEl  = document.getElementById('hud-interact-text');
const hudToastEl         = document.getElementById('hud-science-toast');
const hudToastTitleEl    = document.getElementById('hud-toast-title');
const hudToastSpectrumEl = document.getElementById('hud-toast-spectrum');
const hudToastDescEl     = document.getElementById('hud-toast-desc');
const hudToastSourceEl   = document.getElementById('hud-toast-source');
let toastTimeoutId       = null;

/* Estado interno del salto y misión */
let vy = 0;
let isGrounded = true;
let evaElapsed_s = 0;
let minimapFrameCounter = 0;

/* Temporales */
const _fwd     = new THREE.Vector3();
const _right   = new THREE.Vector3();
const _move    = new THREE.Vector3();
const _lookDir = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ init */
export function initControls() {
  /* Orbit */
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, 0, 0);
  orbit.enableDamping      = true;
  orbit.dampingFactor      = 0.08;
  orbit.enableRotate       = false;
  orbit.enablePan          = true;
  orbit.screenSpacePanning = true;
  orbit.minDistance        = 30;
  orbit.maxDistance        = 600;
  orbit.minPolarAngle      = 0;
  orbit.maxPolarAngle      = Math.PI;
  orbit.mouseButtons = {
    LEFT:   THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT:  null
  };
  orbit.update();
  state.orbitControls = orbit;

  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  /* FP */
  const fp = new PointerLockControls(camera, renderer.domElement);
  state.fpControls = fp;

  fp.addEventListener('lock',   () => document.body.classList.add('fp'));
  fp.addEventListener('unlock', () => { if (state.mode === 'fp') leaveFirstPerson(); });

  /* Botón modo */
  modeBtn.addEventListener('click', () => {
    if (state.mode === 'fp') leaveFirstPerson();
    else enterFirstPerson();
  });

  /* Slider */
  hSlider.addEventListener('input', () => {
    const ex = parseFloat(hSlider.value);
    hValue.textContent = ex.toFixed(2) + '×';
    applyHeights(ex);
    syncPopupHeight();

    if (state.astronautGroup) {
      const y = sampleGroundY(
        state.astronautGroup.position.x,
        state.astronautGroup.position.z
      );
      if (y !== null) {
        state.astronautGroup.position.y = y;
        state.astronautPosition.y = y;
      }
    }
  });

  /* Botón recarga de oxígeno (T7) */
  if (hudResetO2Btn) {
    hudResetO2Btn.addEventListener('click', () => {
      state.hud.o2Remaining_l = state.fisio.o2_reserve_l;
      renderHUD();
    });
  }

  /* Teclado */
  window.addEventListener('keydown', (e) => {
    if (state.mode === 'fp') {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (e.code === 'KeyE' && !e.repeat) {
        e.preventDefault();
        triggerFirstPersonScienceInteraction();
      }
      if (e.code === 'KeyT' && !e.repeat) {
        e.preventDefault();
        toggleDustStormSimulation();
        if (state.weather?.mode === 'dust_storm') computeEmergencyEvacuationRoute();
      }
      if (e.code === 'KeyC' && !e.repeat) {
        e.preventDefault();
        triggerCopilotRadioComms();
      }
    }
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur',  () => keys.clear());

  async function triggerCopilotRadioComms() {
    const isStorm   = state.weather?.mode === 'dust_storm';
    const slopeWarn = (state.hud?.slope_deg ?? 0) > (state.fisio?.max_safe_slope_deg || 25);
    const o2Pct     = Math.round(((state.hud?.o2Remaining_l ?? 580) / (state.fisio?.o2_reserve_l || 580)) * 100);

    let query = 'Reporte de situación general y seguridad de misión';
    if (isStorm) query = 'Alerta de tormenta de polvo: ¿cuál es el protocolo de evacuación urgente?';
    else if (o2Pct < 30) query = 'Oxígeno bajo: ¿puedo completar la ruta o debo regresar a la base?';
    else if (slopeWarn) query = 'Pendiente empinada peligrosa: ¿cómo evito el riesgo de resbalamiento?';
    else if (state.nearestPOI?.poi) query = `Sitio cercano detectado (${state.nearestPOI.poi.name}): ¿qué ciencia o muestras debo registrar?`;

    showTransmissionOnHUD('Sintonizando radio CAPCOM ARES-AI (Llama 3)...');
    try {
      const res = await queryAresCopilot(query);
      showTransmissionOnHUD(res.text);
      speakCopilotRadio(res.text);
    } catch (_) {
      showTransmissionOnHUD('Canal de radio ARES-AI activo. Telemetría de vuelo nominal.');
    }
  }

  /* Hook de recall (evita import circular astronaut → controls) */
  state.hooks.onRecallAstronaut = () => {
    if (state.mode === 'fp') leaveFirstPerson();
    state.hud.o2Remaining_l = state.fisio.o2_reserve_l;
    evaElapsed_s = 0;
  };

  /* Hook para visitar un POI o sitio en 1ª persona desde el popup (E2) */
  state.hooks.onVisitPointFP = (tx_m, tz_m) => {
    spawnAstronaut(tx_m + 5.5, tz_m + 12.5);
    enterFirstPerson({ x: tx_m + 2.0, z: tz_m + 1.5 });
  };

  updateUI();
}

const keys = new Set();

/* --------------------------------------------------------- modo orbital */
export function enterFirstPerson(lookTarget = null) {
  if (!state.terrainMesh || state.mode === 'fp') return;

  if (!state.astronautGroup) spawnAstronaut(0, 0);

  state.mode = 'fp';
  state.orbitControls.enabled = false;
  keys.clear();
  vy = 0;
  isGrounded = true;
  hideInfoPopup();

  camera.up.set(0, 1, 0);

  const px = state.astronautPosition.x;
  const pz = state.astronautPosition.z;
  enableLocalPatch(px, pz);

  const groundY = sampleGroundY(px, pz);
  camera.position.x = px;
  camera.position.z = pz;
  camera.position.y = (groundY !== null ? groundY : state.astronautPosition.y) + state.fisio.eye_height_m;

  /* Si hay un objetivo explícito o un POI/Rover cercano (< 40 m), orientar la mirada hacia él */
  let targetX = px * 0.7;
  let targetZ = pz * 0.7 - 1;
  if (lookTarget && typeof lookTarget.x === 'number' && typeof lookTarget.z === 'number') {
    targetX = lookTarget.x;
    targetZ = lookTarget.z;
  } else if (Array.isArray(state.pois)) {
    let bestDist = 40;
    for (const poi of state.pois) {
      if (!Array.isArray(poi.position_m)) continue;
      const d = Math.hypot(poi.position_m[0] - px, poi.position_m[1] - pz);
      if (d > 0.5 && d < bestDist) {
        bestDist = d;
        targetX = poi.position_m[0];
        targetZ = poi.position_m[1];
      }
    }
  }
  const targetGroundY = sampleGroundY(targetX, targetZ) ?? (groundY ?? 0);
  camera.lookAt(targetX, targetGroundY + 1.4, targetZ);

  if (state.astronautGroup) state.astronautGroup.visible = false;

  updateUI();
  state.fpControls.lock();
}

export function leaveFirstPerson() {
  if (state.mode !== 'fp') return;
  state.mode = 'orbit';
  keys.clear();
  if (state.fpControls.isLocked) state.fpControls.unlock();

  disableLocalPatch();
  camera.up.set(0, 0, -1);

  const target = state.astronautGroup
    ? state.astronautGroup.position.clone()
    : new THREE.Vector3(0, 0, 0);
  target.y = 0;

  const dim_m = Math.max(state.terrainWidth, state.terrainDepth);
  const camEnd = new THREE.Vector3(target.x, dim_m * 1.4, target.z + 0.001);

  state.transition = {
    t: 0, duration: 0.8,
    fromPos:    camera.position.clone(),
    toPos:      camEnd,
    fromTarget: state.orbitControls.target.clone(),
    toTarget:   target,
    fromUp:     camera.up.clone(),
    toUp:       new THREE.Vector3(0, 0, -1),
  };
  state.orbitControls.enabled = false;

  if (state.astronautGroup) state.astronautGroup.visible = true;
  updateUI();
}

/* ------------------------------------------------------------- update */
export function updateControls(dt) {
  if (state.mode === 'fp') {
    evaElapsed_s += dt;
    updateFirstPerson(dt);
  } else if (state.transition) {
    updateTransition(dt);
    updateOrbitalTelemetry();
  } else {
    state.orbitControls.update();
    updateOrbitalTelemetry();
  }
  renderHUD();
}

function updateFirstPerson(dt) {
  const prevX_m    = camera.position.x;
  const prevZ_m    = camera.position.z;
  const prevElev_m = sampleDemHeightRelM(prevX_m, prevZ_m) ?? 0;

  /* --- Salto (m/s y m/s²) --- */
  if (keys.has('Space') && isGrounded) {
    vy = state.fisio.jump_velocity_ms;
    isGrounded = false;
  }

  /* --- Mirada horizontal --- */
  camera.getWorldDirection(_fwd);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, -1);
  _fwd.normalize();
  _right.crossVectors(_fwd, WORLD_UP).normalize();

  /* --- Movimiento horizontal (m/s) --- */
  let forwardInput = 0, strafeInput = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp'))    forwardInput += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown'))  forwardInput -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) strafeInput  += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft'))  strafeInput  -= 1;

  const running  = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const canMove  = state.hud.o2Remaining_l > 0;
  const speed_ms = canMove
    ? (running ? state.fisio.run_speed_ms : state.fisio.walk_speed_ms)
    : 0;

  _move.set(0, 0, 0)
       .addScaledVector(_fwd, forwardInput)
       .addScaledVector(_right, strafeInput);

  if (_move.lengthSq() > 0 && speed_ms > 0) {
    _move.normalize().multiplyScalar(speed_ms * dt);
    camera.position.x += _move.x;
    camera.position.z += _move.z;
  }

  /* --- Bounds --- */
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -state.boundsX, state.boundsX);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -state.boundsZ, state.boundsZ);

  /* --- Actualizar parche local si el jugador se aleja del centro (T5) --- */
  updateLocalPatchIfNeeded(camera.position.x, camera.position.z);

  /* --- Física vertical (en metros) --- */
  const groundY = sampleGroundY(camera.position.x, camera.position.z);
  if (groundY !== null) {
    const targetY = groundY + state.fisio.eye_height_m;

    if (isGrounded) {
      const dy = targetY - camera.position.y;
      if (dy < -CONFIG.FALL_THRESHOLD_M) {
        /* Caída desde un escalón → física */
        isGrounded = false;
        vy = 0;
      } else {
        /* Seguimiento suave del terreno caminando */
        const k = 1 - Math.exp(-CONFIG.WALK_Y_SMOOTHING * dt);
        camera.position.y += dy * k;
      }
    }

    if (!isGrounded) {
      vy -= state.fisio.gravity_ms2 * dt;
      camera.position.y += vy * dt;

      if (camera.position.y <= targetY) {
        camera.position.y = targetY;
        vy = 0;
        isGrounded = true;
      }
    }

    /* Sincronizar astronauta (X/Z sigue al jugador; Y = suelo) */
    state.astronautPosition.set(camera.position.x, groundY, camera.position.z);
    if (state.astronautGroup) state.astronautGroup.position.copy(state.astronautPosition);
  }

  /* --- Telemetría y consumo de oxígeno en 1ª persona (T7) --- */
  const curX_m    = camera.position.x;
  const curZ_m    = camera.position.z;
  const curElev_m = sampleDemHeightRelM(curX_m, curZ_m) ?? 0;
  const minElev_m = state.metadata ? state.metadata.elevation_range_m[0] : 0;

  const stepDist_m  = Math.hypot(curX_m - prevX_m, curZ_m - prevZ_m);
  const actualSpeed = dt > 1e-5 ? stepDist_m / dt : 0;
  const deltaElev_m = curElev_m - prevElev_m;
  const slope_deg   = sampleSlopeDeg(curX_m, curZ_m);

  /* Si está en movimiento: calcular pendiente direccional efectiva del paso + pendiente del terreno */
  const isMoving = stepDist_m > 1e-4;
  const baseRate_l_h = state.fisio.o2_base_consumption_l_per_h;
  const thermalMult  = state.weather?.thermalPenalty || 1.0;
  let o2Rate_l_h = baseRate_l_h * 0.45 * thermalMult; // tasa basal en reposo de pie (~22.5 L/h)

  if (isMoving) {
    const slopeFactor = getSlopeCostFactor(slope_deg, deltaElev_m);
    const effortMult  = running ? 2.2 : 1.0;
    const climbGrade  = stepDist_m > 0 ? deltaElev_m / stepDist_m : 0;
    const climbBonus  = climbGrade > 0 ? 1.0 + climbGrade * 4.5 : Math.max(0.8, 1.0 + climbGrade * 0.8);
    o2Rate_l_h = baseRate_l_h * effortMult * slopeFactor * climbBonus * thermalMult;
  }

  const consumed_l = (o2Rate_l_h / 3600) * dt;
  state.hud.o2Remaining_l = Math.max(0, state.hud.o2Remaining_l - consumed_l);
  state.hud.elev_m        = minElev_m + curElev_m;
  state.hud.slope_deg     = slope_deg;
  state.hud.speed_ms      = actualSpeed;
  state.hud.o2Rate_l_h    = o2Rate_l_h;
  state.hud.slopeWarning  = slope_deg > state.fisio.max_safe_slope_deg;
}

function updateOrbitalTelemetry() {
  if (!state.metadata) return;
  const minElev_m = state.metadata.elevation_range_m[0];
  const px = state.astronautGroup ? state.astronautPosition.x : 0;
  const pz = state.astronautGroup ? state.astronautPosition.z : 0;
  const relElev_m = sampleDemHeightRelM(px, pz) ?? 0;
  const slope_deg = sampleSlopeDeg(px, pz);

  state.hud.elev_m       = minElev_m + relElev_m;
  state.hud.slope_deg    = slope_deg;
  state.hud.speed_ms     = 0;
  state.hud.o2Rate_l_h   = 0;
  state.hud.slopeWarning = slope_deg > state.fisio.max_safe_slope_deg;
}

function formatEvaTime(sec) {
  const totalTenths = Math.floor(sec * 10);
  const tenths = totalTenths % 10;
  const totalSec = Math.floor(totalTenths / 10);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${tenths}`;
}

function renderHUD() {
  if (!state.metadata || !hudElevEl) return;

  const h = state.hud;
  const reserve_l = Math.max(state.fisio.o2_reserve_l, 1);
  const pct = THREE.MathUtils.clamp((h.o2Remaining_l / reserve_l) * 100, 0, 100);
  const maxSafe = state.fisio.max_safe_slope_deg || 25;

  /* Cajas inferiores derechas y barras inferiores izquierdas */
  hudElevEl.textContent   = `${h.elev_m.toFixed(0)} m`;
  hudSlopeEl.textContent  = `${h.slope_deg.toFixed(1)}°`;
  hudSlopeEl.style.color  = h.slopeWarning ? '#ff3855' : '';
  if (hudO2PctEl) hudO2PctEl.textContent = `${pct.toFixed(0)}%`;
  hudSpeedEl.textContent  = `${h.speed_ms.toFixed(1)} m/s`;
  hudO2El.textContent     = `${h.o2Remaining_l.toFixed(1)} L`;
  hudO2RateEl.textContent = `${h.o2Rate_l_h.toFixed(1)} L/h`;

  if (hudTimerEl) {
    hudTimerEl.textContent = formatEvaTime(evaElapsed_s);
  }
  if (hudDatasetTagEl && state.datasetId) {
    hudDatasetTagEl.textContent = state.datasetId.toUpperCase();
  }

  /* Barra principal de O2 */
  if (hudO2BarEl) {
    hudO2BarEl.style.width = `${pct.toFixed(1)}%`;
    hudO2BarEl.classList.toggle('low', pct <= 40 && pct > 15);
    hudO2BarEl.classList.toggle('critical', pct <= 15);
  }

  /* Barra secundaria de flujo metabólico (0..250 L/h) */
  if (hudFluxBarEl) {
    const fluxPct = THREE.MathUtils.clamp((h.o2Rate_l_h / 220) * 100, 6, 100);
    hudFluxBarEl.style.width = `${fluxPct.toFixed(0)}%`;
  }

  /* Retícula central en 1ª persona */
  if (reticleSlopeFillEl) {
    const sPct = THREE.MathUtils.clamp((h.slope_deg / (maxSafe * 1.4)) * 100, 4, 100);
    reticleSlopeFillEl.style.width = `${sPct.toFixed(0)}%`;
    reticleSlopeFillEl.style.background = h.slopeWarning ? '#ff3855' : '#66fcf1';
  }
  if (reticleSegsEl) {
    const spans = reticleSegsEl.children;
    const litCount = Math.round(THREE.MathUtils.clamp((h.speed_ms / state.fisio.run_speed_ms) * spans.length, 0, spans.length));
    for (let i = 0; i < spans.length; i++) {
      spans[i].classList.toggle('lit', i < litCount);
    }
  }

  /* Badges de estado inferiores */
  const isRunning = h.speed_ms > state.fisio.walk_speed_ms * 1.25;
  if (badgeWalkEl)  badgeWalkEl.classList.toggle('active', h.speed_ms > 0.05);
  if (badgeRunEl)   badgeRunEl.classList.toggle('active', isRunning);
  if (badgeSlopeEl) {
    badgeSlopeEl.classList.toggle('active', !h.slopeWarning && h.slope_deg > 8);
    badgeSlopeEl.classList.toggle('danger', h.slopeWarning);
  }
  if (badgeO2El) {
    badgeO2El.classList.toggle('active', pct > 15);
    badgeO2El.classList.toggle('danger', pct <= 15);
  }

  /* Alerta superior izquierda // MALFUNCTIONS */
  const o2Critical = pct <= 15;
  const isStorm    = state.weather?.mode === 'dust_storm';
  if (hudAlertEl && hudAlertTextEl) {
    if (h.slopeWarning) {
      hudAlertEl.hidden = false;
      hudAlertTextEl.textContent = `Pendiente peligrosa (${h.slope_deg.toFixed(1)}° > ${maxSafe}°) · Sobrecosto O₂`;
    } else if (o2Critical) {
      hudAlertEl.hidden = false;
      hudAlertTextEl.textContent = `Reserva de O₂ crítica (${pct.toFixed(0)}%) · Recarga requerida`;
    } else if (isStorm) {
      hudAlertEl.hidden = false;
      hudAlertTextEl.textContent = `TORMENTA DE POLVO (τ=${state.weather.dust_tau}) · Visibilidad reducida · Evacuar a Refugio`;
    } else {
      hudAlertEl.hidden = true;
    }
  }
  if (hudStatusLineEl) {
    hudStatusLineEl.textContent = h.slopeWarning
      ? 'Precaución: terreno escarpado detectado'
      : `Estabilidad nominal · Consumo ${h.o2Rate_l_h.toFixed(0)} L/h`;
  }

  /* Brújula y Mini-radar topográfico */
  camera.getWorldDirection(_lookDir);
  const yawRad = Math.atan2(_lookDir.x, -_lookDir.z); // 0 = Norte (-Z), +pi/2 = Este (+X)
  const yawDeg = ((yawRad * 180) / Math.PI + 360) % 360;
  if (hudCompassTrackEl) {
    const shiftPx = -((yawDeg / 360) * 260);
    hudCompassTrackEl.style.transform = `translateX(${shiftPx.toFixed(1)}px)`;
  }

  if (minimapCtx && (++minimapFrameCounter % 4 === 0)) {
    drawHudMinimap(yawRad);
  }

  /* Actualizar proximidad a Rovers / POIs y bitácora científica en 1ª persona (E3) */
  updateProximityScienceHUD();
}

function updateProximityScienceHUD() {
  const pois = Array.isArray(state.pois) ? state.pois : [];
  const totalPois = pois.length;
  const doneCount = state.completedPOIs ? state.completedPOIs.size : 0;

  if (hudSciCountEl) {
    hudSciCountEl.textContent = `${doneCount} / ${totalPois} POIs`;
  }

  if (state.mode !== 'fp') {
    if (hudInteractEl) hudInteractEl.hidden = true;
    state.nearestPOI = null;
    return;
  }

  const px = camera.position.x;
  const pz = camera.position.z;
  let closest = null;
  let minDist = 28.0; // Radio de interacción en metros a escala humana (28 m)

  for (const poi of pois) {
    if (!Array.isArray(poi.position_m)) continue;
    const d = Math.hypot(poi.position_m[0] - px, poi.position_m[1] - pz);
    if (d < minDist) {
      minDist = d;
      closest = { poi, dist_m: d };
    }
  }

  state.nearestPOI = closest;

  if (hudInteractEl && hudInteractTextEl) {
    if (closest) {
      const { poi, dist_m } = closest;
      const alreadyDone = state.completedPOIs.has(poi.id);
      hudInteractEl.hidden = false;
      hudInteractEl.className = `hud-interact-prompt ${poi.type || 'sampling'} ${alreadyDone ? 'done' : ''}`;

      let actionVerb = 'RECOLECTAR MUESTRA & ESCANEAR ESPECTRO';
      if (poi.type === 'shelter') {
        actionVerb = 'CONECTAR CON PERSEVERANCE & RECARGAR O₂ EN HÁBITAT';
      } else if (poi.type === 'hazard') {
        actionVerb = 'REGISTRAR ALERTA GEOTÉCNICA DE TERRENO';
      }
      const prefix = alreadyDone ? '✓ RE-INSPECCIONAR' : actionVerb;
      hudInteractTextEl.textContent = `${prefix} · ${poi.name} (${dist_m.toFixed(1)} m)`;
    } else {
      hudInteractEl.hidden = true;
    }
  }
}

function triggerFirstPersonScienceInteraction() {
  if (state.mode !== 'fp' || !state.nearestPOI) return;
  const { poi } = state.nearestPOI;

  state.completedPOIs.add(poi.id);

  /* Si interactúa con el Refugio / Hábitat + Rover Perseverance, recargar O2 al 100% */
  let spectrumLine = '';
  if (poi.type === 'shelter') {
    state.hud.o2Remaining_l = state.fisio.o2_reserve_l;
    spectrumLine = '⚡ ENLACE SUPERCAM / INGENUITY ACTIVO · RESERVA PLSS O₂ RECARGADA AL 100% (580.0 L)';
  } else if (poi.type === 'hazard') {
    spectrumLine = `⚠ TELEMETRÍA GEOTÉCNICA: Pendiente local ${state.hud.slope_deg.toFixed(1)}° · Regolito inestable registrado`;
  } else {
    /* Firma espectral simulada basada en misiones reales CRISM / PIXL */
    const signatures = [
      '🔬 ESPECTRO CRISM/PIXL: Filosilicatos Fe/Mg + Carbonatos hidratados · Biofirma: ALTA',
      '🔬 ESPECTRO SHERLOC/PIXL: Sulfatos hidratados + Sílice amorfa · Tubo de titanio sellado',
      '🔬 ESPECTRO SUPERCAM LIBS: Olivino alterado + Carbonato de magnesio · Muestra #EVA catalogada',
    ];
    const idx = Math.abs(poi.id.charCodeAt(poi.id.length - 1) || 0) % signatures.length;
    spectrumLine = signatures[idx];
  }

  /* Actualizar lista en la Bitácora EVA superior izquierda */
  if (hudSciListEl) {
    const completedNames = state.pois
      .filter((p) => state.completedPOIs.has(p.id))
      .map((p) => `<div class="sci-log-item">✓ ${p.name}</div>`)
      .join('');
    hudSciListEl.innerHTML = completedNames || 'Acércate a un Rover o POI y pulsa [E]';
  }

  /* Mostrar tarjeta de telemetría científica en el visor durante 6 segundos */
  if (hudToastEl) {
    hudToastEl.hidden = false;
    if (hudToastTitleEl)    hudToastTitleEl.textContent    = `✓ ${poi.name.toUpperCase()}`;
    if (hudToastSpectrumEl) hudToastSpectrumEl.textContent = spectrumLine;
    if (hudToastDescEl)     hudToastDescEl.textContent     = poi.description || '';
    if (hudToastSourceEl)   hudToastSourceEl.textContent   = `Misión / Instrumento: ${poi.source || 'NASA Multi-Mission'}`;

    if (toastTimeoutId) clearTimeout(toastTimeoutId);
    toastTimeoutId = setTimeout(() => {
      if (hudToastEl) hudToastEl.hidden = true;
    }, 6500);
  }

  renderHUD();
}

function drawHudMinimap(yawRad) {
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  minimapCtx.clearRect(0, 0, w, h);

  /* Fondo oscuro sci-fi */
  minimapCtx.fillStyle = 'rgba(6, 16, 20, 0.92)';
  minimapCtx.fillRect(0, 0, w, h);

  const px = state.astronautGroup ? state.astronautPosition.x : camera.position.x;
  const pz = state.astronautGroup ? state.astronautPosition.z : camera.position.z;
  const scanRadius_m = 1000; // ventana de 2×2 km alrededor del astronauta

  /* Curvas/celdas de nivel y zonas de pendiente alta (> max_safe_slope_deg) en rojo como en HUD_IDEA.jpeg */
  const cols = 30;
  const rows = 18;
  const cellW = w / cols;
  const cellH = h / rows;
  const maxSafe = state.fisio.max_safe_slope_deg || 25;

  for (let r = 0; r < rows; r++) {
    const dz_m = ((r / (rows - 1)) - 0.5) * 2 * scanRadius_m;
    for (let c = 0; c < cols; c++) {
      const dx_m = ((c / (cols - 1)) - 0.5) * 2 * scanRadius_m;
      const wx_m = px + dx_m;
      const wz_m = pz + dz_m;
      const s_deg = sampleSlopeDeg(wx_m, wz_m);
      const elevRel = sampleDemHeightRelM(wx_m, wz_m) ?? 0;

      if (s_deg > maxSafe) {
        minimapCtx.fillStyle = 'rgba(255, 56, 85, 0.68)';
        minimapCtx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
      } else {
        /* Bandas topográficas cian/verdosas */
        const band = Math.floor(elevRel / 25) % 2 === 0;
        minimapCtx.fillStyle = band
          ? 'rgba(45, 168, 158, 0.22)'
          : 'rgba(20, 80, 78, 0.14)';
        minimapCtx.fillRect(c * cellW, r * cellH, cellW, cellH);
      }
    }
  }

  /* Rejilla táctica sutil */
  minimapCtx.strokeStyle = 'rgba(102, 252, 241, 0.12)';
  minimapCtx.lineWidth = 1;
  for (let x = 30; x < w; x += 30) {
    minimapCtx.beginPath();
    minimapCtx.moveTo(x, 0);
    minimapCtx.lineTo(x, h);
    minimapCtx.stroke();
  }
  for (let y = 26; y < h; y += 26) {
    minimapCtx.beginPath();
    minimapCtx.moveTo(0, y);
    minimapCtx.lineTo(w, y);
    minimapCtx.stroke();
  }

  /* Dibujar ruta A* si pasa por el área del mini-radar (T8) */
  if (state.route && Array.isArray(state.route.path_m) && state.route.path_m.length >= 2) {
    minimapCtx.strokeStyle = '#66fcf1';
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    let started = false;
    for (let i = 0; i < state.route.path_m.length; i++) {
      const [rx_m, rz_m] = state.route.path_m[i];
      const mx = ((rx_m - px) / (2 * scanRadius_m) + 0.5) * w;
      const my = ((rz_m - pz) / (2 * scanRadius_m) + 0.5) * h;
      if (!started) {
        minimapCtx.moveTo(mx, my);
        started = true;
      } else {
        minimapCtx.lineTo(mx, my);
      }
    }
    minimapCtx.stroke();
  }

  /* Dibujar POIs activos en el mini-radar (T9) */
  if (state.poiLayerEnabled && Array.isArray(state.pois)) {
    for (let i = 0; i < state.pois.length; i++) {
      const poi = state.pois[i];
      if (!Array.isArray(poi.position_m)) continue;
      const [px_m, pz_m] = poi.position_m;
      const mx = ((px_m - px) / (2 * scanRadius_m) + 0.5) * w;
      const my = ((pz_m - pz) / (2 * scanRadius_m) + 0.5) * h;
      if (mx < -4 || mx > w + 4 || my < -4 || my > h + 4) continue;

      minimapCtx.fillStyle = poi.type === 'hazard'
        ? '#ff3855'
        : poi.type === 'shelter'
        ? '#55f29b'
        : '#66fcf1';
      minimapCtx.beginPath();
      minimapCtx.arc(mx, my, 3, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  }

  /* Cono de visión / flecha amarilla del astronauta en el centro */
  const cx = w * 0.5;
  const cy = h * 0.5;
  minimapCtx.save();
  minimapCtx.translate(cx, cy);
  minimapCtx.rotate(yawRad);

  /* Haz de escaneo amarillo translúcido */
  minimapCtx.fillStyle = 'rgba(246, 201, 69, 0.22)';
  minimapCtx.beginPath();
  minimapCtx.moveTo(0, 0);
  minimapCtx.lineTo(-16, -32);
  minimapCtx.lineTo(16, -32);
  minimapCtx.closePath();
  minimapCtx.fill();

  /* Flecha amarilla del jugador */
  minimapCtx.fillStyle = '#f6c945';
  minimapCtx.beginPath();
  minimapCtx.moveTo(0, -8);
  minimapCtx.lineTo(6, 6);
  minimapCtx.lineTo(0, 3);
  minimapCtx.lineTo(-6, 6);
  minimapCtx.closePath();
  minimapCtx.fill();
  minimapCtx.restore();
}

function updateTransition(dt) {
  const tr = state.transition;
  tr.t = Math.min(1, tr.t + dt / tr.duration);
  const e = tr.t < 0.5 ? 2 * tr.t * tr.t : 1 - Math.pow(-2 * tr.t + 2, 2) / 2;

  camera.position.lerpVectors(tr.fromPos, tr.toPos, e);
  state.orbitControls.target.lerpVectors(tr.fromTarget, tr.toTarget, e);
  camera.up.lerpVectors(tr.fromUp, tr.toUp, e).normalize();
  camera.lookAt(state.orbitControls.target);

  if (tr.t >= 1) {
    state.transition = null;
    state.orbitControls.enabled = true;
    state.orbitControls.update();
  }
}

/* ------------------------------------------------------------------- UI */
function updateUI() {
  const isFP = state.mode === 'fp';
  modeBtn.textContent = isFP ? 'Volver a Vista Orbital' : 'Explorar (1ª Persona)';
  hintEl.textContent  = isFP
    ? 'WASD = Moverse · Shift = Correr · Space = Saltar · Ratón = Mirar · ESC = Salir'
    : 'Arrastra = Mover mapa · Rueda = Zoom · Clic = Info · Arrastra el astronauta al mapa';
  document.body.classList.toggle('fp', isFP);
}
