/* Entry point: arranca la app y orquesta el bucle. */

import * as THREE from 'three';
import { state } from './state.js';
import { renderer, scene, camera, stars } from './scene.js';
import { loadHeightmap, tickRouteAnimation, updateSolarCycle } from './terrain.js';
import { initAstronaut, spawnAstronaut } from './astronaut.js';
import { initPopup, tickPopup } from './popup.js';
import { initControls, updateControls } from './controls.js';
import { benchmarkGroundSampling } from './raycast.js';
import { initIntroCinematic, initRealtimeDemLoader } from './cinematic.js';
import { tickArtifactsAnimation } from './artifacts3d.js';
import { initCopilotUI } from './copilot.js';

const clock = new THREE.Clock();

(async () => {
  /* 1. Controles primero (crea OrbitControls que otros módulos necesitan) */
  initControls();

  /* 2. Cargar terreno */
  await loadHeightmap();
  benchmarkGroundSampling(200);

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
  const dt = Math.min(clock.getDelta(), 0.05);

  if (stars) stars.rotation.y += 0.015 * dt;

  updateControls(dt);
  tickPopup();
  tickRouteAnimation(dt);
  tickArtifactsAnimation(dt, clock.elapsedTime);
  updateSolarCycle(dt);

  renderer.render(scene, camera);
}