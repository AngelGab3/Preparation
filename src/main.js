/* Entry point: arranca la app y orquesta el bucle. */
import './styles.css';
import './signal-intro.css';
import * as THREE from 'three';
import { state } from './state.js';
import { CONFIG } from './config.js';
import { renderer, scene, camera, stars } from './scene.js';
import { loadHeightmap, tickRouteAnimation, updateSolarCycle } from './terrain.js';
import { initAstronaut } from './astronaut.js';
import { initPopup, tickPopup } from './popup.js';
import { initControls, updateControls } from './controls.js';
import { benchmarkGroundSampling } from './raycast.js';
import { initIntroCinematic, initRealtimeDemLoader, isIntroCinematicActive, tickIntroCinematic } from './cinematic.js';
import { tickArtifactsAnimation } from './artifacts3d.js';
import { initCopilotUI } from './copilot.js';
import { initTerrainLOD, updateTerrainLOD } from './terrain_lod.js';
import { initTerrainFX, updateTerrainFX } from './terrain_fx.js';
import { tickOrbitBackdrop, tickOrbitFill } from './orbit_backdrop.js';
import { initStats, tickStats } from './stats.js';
import { initMobileTabs } from './mobile_tabs.js';
import { loadHealthModePreference } from './health_group.js';
import { loadCrew, sanitizeCrew, generateCrew, makeRng, buildHealthFromCrew } from './crew.js';
import { initCrewUI } from './crew_ui.js';
import { loadSuitPreference } from './suits.js';
import { syncCrewFollowers, tickCrewFollowers } from './crew_followers.js';

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
  const raw = await loadConfigHealth(state.datasetId || CONFIG.DEFAULT_DATASET);
  const cfgOverrides = raw ? { ...raw } : {};
  delete cfgOverrides.members;
  delete cfgOverrides.dataset_id;
  delete cfgOverrides.note;
  /* El traje elegido por el usuario gana sobre el del dataset */
  const savedSuit = loadSuitPreference();
  if (savedSuit) cfgOverrides.suit_id = savedSuit;
  state.healthCfgOverrides = cfgOverrides;

  /* Tripulación: la guardada por el usuario > la del dataset > una generada */
  const saved = loadCrew();
  const fromDataset = sanitizeCrew(raw?.members || []);
  state.crew = saved || (fromDataset.length ? fromDataset : generateCrew(3, makeRng(2026)));
  state.healthMode = loadHealthModePreference() === 'group' && state.crew.length > 1 ? 'group' : 'solo';
  state.health = buildHealthFromCrew(state.healthMode, state.crew, cfgOverrides);
  console.log('[MarsWalk] Health inicializado:', state.health.mode, state.health.members.length, 'miembro(s)');
}


/* La sección "Traje EVA" (modelo 3D + tablas) va en un chunk aparte que se descarga al primer clic */
function initSuitLabButton() {
  const btn = document.getElementById('suit-lab-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { openSuitLab } = await import('./suit_lab.js');
      openSuitLab();
    } catch (err) {
      console.error('[MarsWalk] No se pudo cargar la sección Traje:', err);
    } finally {
      btn.disabled = false;
    }
  });
}

const clock = new THREE.Clock();

(async () => {
  /* 1. Controles primero (crea OrbitControls que otros módulos necesitan) */
  initControls();
  initMobileTabs();

  /* 2. Cargar terreno */
  await loadHeightmap();
  initStats();
  initTerrainLOD();
  initTerrainFX();
  benchmarkGroundSampling(200);
  await initHealthState();
  initCrewUI();
  syncCrewFollowers();
  initSuitLabButton();
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

  /* Con la sección Traje abierta el mapa queda tapado: no se simula ni se dibuja */
  if (state.suitLabOpen) return;

  if (isIntroCinematicActive()) {
    tickIntroCinematic(frameDelta_s);
    return;
  }

  if (stars) stars.rotation.y += 0.015 * dt;

  updateControls(dt);
  tickPopup();
  tickRouteAnimation(dt);
  tickArtifactsAnimation(dt, clock.elapsedTime);
  tickCrewFollowers(dt);
  updateSolarCycle(dt);

  tickOrbitFill();
  tickOrbitBackdrop();
  updateTerrainLOD();
  updateTerrainFX(dt);
  renderer.render(scene, camera);
  tickStats();
}
