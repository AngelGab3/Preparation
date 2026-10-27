/* Mesh del astronauta + dock + drag sobre el mapa. */

import * as THREE from 'three';
import { scene, renderer } from './scene.js';
import { state } from './state.js';
import { sampleGroundY, raycastAstronaut, raycastTerrain } from './raycast.js';

const dockEl    = document.getElementById('astronaut-dock');
const dockLabel = dockEl.querySelector('.dock-label');

/* ----------------------------------------------------------------- mesh */
function createAstronautMesh() {
  const g = new THREE.Group();

  const whiteMat  = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.45, metalness: 0.1 });
  const darkMat   = new THREE.MeshStandardMaterial({ color: 0x2a3542, roughness: 0.25, metalness: 0.85 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xff6a3d, emissive: 0xff6a3d, emissiveIntensity: 0.7,
    roughness: 0.15, metalness: 0.9
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 6, 12), whiteMat);
  body.position.y = 1.0;
  g.add(body);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 16), darkMat);
  helmet.position.y = 1.9;
  g.add(helmet);

  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 16, 16, 0, Math.PI, Math.PI * 0.35, Math.PI * 0.65),
    accentMat
  );
  visor.position.set(0, 1.9, 0.18);
  visor.rotation.y = Math.PI / 2;
  g.add(visor);

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.35), whiteMat);
  pack.position.set(0, 1.05, -0.4);
  g.add(pack);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.15, 32),
    new THREE.MeshBasicMaterial({ color: 0xff6a3d, side: THREE.DoubleSide,
      transparent: true, opacity: 0.65, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 18, 6),
    new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true,
      opacity: 0.22, depthWrite: false })
  );
  beam.position.y = 9;
  g.add(beam);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true,
      opacity: 0.09, depthWrite: false })
  );
  halo.position.y = 1.2;
  g.add(halo);

  const dim_m = Math.max(state.terrainWidth, state.terrainDepth);
  g.scale.setScalar(dim_m * 0.0125);
  return g;
}

/* --------------------------------------------------------------- spawn */
export function spawnAstronaut(x, z) {
  const y = sampleGroundY(x, z) ?? 0;

  if (state.astronautGroup) {
    const dim_m = Math.max(state.terrainWidth, state.terrainDepth);
    state.astronautGroup.scale.setScalar(dim_m * 0.0125);
    state.astronautGroup.position.set(x, y, z);
    state.astronautPosition.copy(state.astronautGroup.position);
    return;
  }

  state.astronautGroup = createAstronautMesh();
  state.astronautGroup.position.set(x, y, z);
  state.astronautPosition.copy(state.astronautGroup.position);
  scene.add(state.astronautGroup);

  dockEl.classList.add('placed');
  dockEl.classList.remove('dragging');
  dockEl.title = 'Clic para recuperar el astronauta';
  dockLabel.textContent = 'En el mapa · clic para recuperar';
}

/* -------------------------------------------------------------- recall */
export function recallAstronaut() {
  if (!state.astronautGroup) return;

  scene.remove(state.astronautGroup);
  state.astronautGroup.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
  state.astronautGroup = null;

  dockEl.classList.remove('placed');
  dockEl.title = 'Arrastra el astronauta al mapa';
  dockLabel.textContent = 'Arrastra al mapa';

  state.hooks.onRecallAstronaut?.();
}

/* ------------------------------------------------------------ position */
function updateAstronautFromPointer(e) {
  if (!state.astronautGroup) return;
  const hits = raycastTerrain(e);
  if (hits.length > 0) state.astronautGroup.position.copy(hits[0].point);
}

function finalizeAstronautPosition() {
  if (!state.astronautGroup) return;
  const p = state.astronautGroup.position;
  const inBounds = Math.abs(p.x) <= state.boundsX && Math.abs(p.z) <= state.boundsZ;

  if (!inBounds) {
    recallAstronaut();
    return;
  }
  const y = sampleGroundY(p.x, p.z);
  if (y !== null) {
    state.astronautGroup.position.y = y;
    state.astronautPosition.copy(state.astronautGroup.position);
  }
}

/* -------------------------------------------------------- dock events */
export function initAstronaut() {
  /* Colocar al astronauta inicialmente junto al Refugio / Rover Perseverance para que al entrar en 1ª persona los vea frente a sí */
  const shelterPOI = Array.isArray(state.pois) ? state.pois.find((p) => p.type === 'shelter') : null;
  if (shelterPOI && Array.isArray(shelterPOI.position_m)) {
    spawnAstronaut(shelterPOI.position_m[0] + 6, shelterPOI.position_m[1] + 13);
  } else {
    spawnAstronaut(0, 0);
  }

  /* --- Drag desde el dock --- */
  dockEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    if (!state.terrainMesh) return;
    if (state.astronautGroup) return;   // ya colocado → el click hace recall

    spawnAstronaut(0, 0);
    state.interaction.isDraggingAstronaut = true;
    if (state.orbitControls) state.orbitControls.enabled = false;
    dockEl.classList.add('dragging');
    dockEl.setPointerCapture(e.pointerId);

    updateAstronautFromPointer(e);
    e.preventDefault();
  });

  dockEl.addEventListener('pointermove', (e) => {
    if (!state.interaction.isDraggingAstronaut) return;
    updateAstronautFromPointer(e);
  });

  dockEl.addEventListener('pointerup', (e) => {
    if (!state.interaction.isDraggingAstronaut) return;
    state.interaction.isDraggingAstronaut = false;
    state.interaction.lastDockDragEnd = performance.now();

    if (state.orbitControls) state.orbitControls.enabled = true;
    dockEl.classList.remove('dragging');
    try { dockEl.releasePointerCapture(e.pointerId); } catch (_) {}

    finalizeAstronautPosition();
  });

  /* --- Click sobre el dock cuando el astronauta está colocado → recall --- */
  dockEl.addEventListener('click', () => {
    if (!state.astronautGroup) return;
    if (performance.now() - state.interaction.lastDockDragEnd < 300) return;
    recallAstronaut();
  });

  /* --- Drag del astronauta ya colocado, sobre el mapa --- */
  const canvas = renderer.domElement;

  canvas.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'orbit') return;
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    if (!state.astronautGroup) return;

    const hits = raycastAstronaut(e);
    if (hits.length === 0) return;

    /* Drag del astronauta → bloquear OrbitControls y no dejar burbujear */
    e.stopPropagation();
    e.preventDefault();
    state.interaction.isDraggingAstronaut = true;
    if (state.orbitControls) state.orbitControls.enabled = false;
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture(e.pointerId);
  }, { capture: true });

  canvas.addEventListener('pointermove', (e) => {
    if (state.interaction.isDraggingAstronaut) {
      updateAstronautFromPointer(e);
      return;
    }
    /* Hover */
    if (state.mode === 'orbit' && state.astronautGroup) {
      const hits = raycastAstronaut(e);
      canvas.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!state.interaction.isDraggingAstronaut) return;
    state.interaction.isDraggingAstronaut = false;
    if (state.orbitControls) state.orbitControls.enabled = true;
    canvas.style.cursor = 'grab';
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    finalizeAstronautPosition();
  });
}