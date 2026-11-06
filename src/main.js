/* Entry point: arranca la app y orquesta el bucle. */
import './styles.css';
import './signal-intro.css';
import * as THREE from 'three';
import { state } from './state.js';
import { renderer, scene, camera, stars } from './scene.js';
import { loadHeightmap, tickRouteAnimation, updateSolarCycle } from './terrain.js';
import { initAstronaut } from './astronaut.js';
import { initPopup, tickPopup } from './popup.js';
import { initControls, updateControls } from './controls.js';
import { benchmarkGroundSampling } from './raycast.js';
import { initIntroCinematic, initRealtimeDemLoader, isIntroCinematicActive, tickIntroCinematic } from './cinematic.js';
import { tickArtifactsAnimation } from './artifacts3d.js';
import { initCopilotUI } from './copilot.js';
import { createSoloHealth, createGroupHealth, loadHealthModePreference } from './health_group.js';

async function loadConfigHealth(datasetId) {
  try {
    const res = await fetch(`data/${datasetId}/config_health.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function initHealthState() {
  const mode = loadHealthModePreference();
  const raw = await loadConfigHealth(state.datasetId || 'jezero_test');
  const cfgOverrides = raw ? { ...raw } : {};
  delete cfgOverrides.members;
  delete cfgOverrides.dataset_id;
  delete cfgOverrides.note;

  if (mode === 'group' && raw?.members) {
    state.health = createGroupHealth(raw.members, cfgOverrides);
  } else {
    state.health = createSoloHealth(cfgOverrides);
  }
  state.healthMode = state.health.mode;
  console.log('[MarsWalk] Health inicializado:', state.health.mode, state.health.members.length, 'miembro(s)');
}


const clock = new THREE.Clock();

(async () => {
  /* 1. Controles primero (crea OrbitControls que otros módulos necesitan) */
  initControls();

  /* 2. Cargar terreno */
  await loadHeightmap();
  benchmarkGroundSampling(200);
  await initHealthState();
  /* 3. Inicializar astronauta (dock + drag) */
  initAstronaut();

  /* 4. Popup de info y Copiloto ARES-AI (E6) */
  initPopup();
  initCopilotUI();

  /* 5. Ocultar pantalla de carga si no hubo error fatal e iniciar E1 (Cinemática + Cargador DEM en vivo) */
  const loadingEl = document.getElementById('loading');
  if (!loadingEl.classList.contains('error')) {
    loadingEl.classList.add('hidden');
    initRealtimeDemLoader();
    initIntroCinematic();
  }

  /* 6. Bucle */
  animate();
})();

function animate() {
  requestAnimationFrame(animate);
  const frameDelta_s = clock.getDelta();
  const dt = Math.min(frameDelta_s, 0.05);

  if (isIntroCinematicActive()) {
    tickIntroCinematic(frameDelta_s);
    return;
  }

  if (stars) stars.rotation.y += 0.015 * dt;

  updateControls(dt);
  tickPopup();
  tickRouteAnimation(dt);
  tickArtifactsAnimation(dt, clock.elapsedTime);
  updateSolarCycle(dt);

  renderer.render(scene, camera);
}
