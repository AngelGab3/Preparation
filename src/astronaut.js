/* Mesh del astronauta + dock + drag sobre el mapa. */

import * as THREE from 'three';
import { scene, renderer } from './scene.js';
import { state } from './state.js';
import { sampleGroundY, raycastAstronaut, raycastTerrain } from './raycast.js';
import { createExplorer } from './character-lab/character.js';

const dockEl    = document.getElementById('astronaut-dock');
const dockLabel = dockEl.querySelector('.dock-label');

/* ----------------------------------------------------------------- mesh */
let gaitTime = 0;
let idleTime = 0;
let gaitWeight = 0;
let runWeight = 0;
let airWeight = 0;
let turnBank = 0;
const characters = new WeakMap();
const visualTarget = new THREE.Vector3();

function createAstronautMesh() {
  const g = new THREE.Group();
  const character = createExplorer();
  characters.set(g, character);
  g.add(character.root);
  /* Marcadores orbitales (visibles solo en vista orbital) */
  const orbitalMarkers = new THREE.Group();
  orbitalMarkers.name = 'orbitalMarkers';

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.15, 32),
    new THREE.MeshBasicMaterial({ color: 0xff6a3d, side: THREE.DoubleSide,
      transparent: true, opacity: 0.65, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  orbitalMarkers.add(ring);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 18, 6),
    new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true,
      opacity: 0.22, depthWrite: false })
  );
  beam.position.y = 9;
  orbitalMarkers.add(beam);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true,
      opacity: 0.09, depthWrite: false })
  );
  halo.position.y = 1.2;
  orbitalMarkers.add(halo);

  g.add(orbitalMarkers);

  const dim_m = Math.max(state.terrainWidth, state.terrainDepth);
  g.scale.setScalar(dim_m * 0.0125);
  return g;
}

/* Actualiza escala, pose y orientación del astronauta en 3ª persona (1 unidad = 1 metro) */
export function updateAstronautThirdPersonVisuals({
  visible, x, y, z, yawRad, walkSpeed = 0, dt = 0.016, isGrounded = true,
}) {
  const g = state.astronautGroup;
  if (!g) return;
  const character = characters.get(g);
  if (!character) return;

  // Mantener el ciclo del cuerpo activo bajo el visor evita saltos al volver a tercera persona.
  g.visible = visible;
  g.scale.setScalar(0.95);
  const markers = g.getObjectByName('orbitalMarkers');
  if (markers) markers.visible = false;

  const turn = 1 - Math.exp(-9 * dt);
  const diff = Math.atan2(Math.sin(yawRad - g.rotation.y), Math.cos(yawRad - g.rotation.y));
  const yawStep = diff * turn;
  g.rotation.y += yawStep;
  visualTarget.set(x, y, z);
  g.position.lerp(visualTarget, 1 - Math.exp(-18 * dt));

  const walkSpeedMs = Math.max(.1, state.fisio.walk_speed_ms || 1.2);
  const runSpeedMs = Math.max(walkSpeedMs + .1, state.fisio.run_speed_ms || 2.5);
  const targetWeight = Math.min(1, walkSpeed / walkSpeedMs);
  gaitWeight += (targetWeight - gaitWeight) * (1 - Math.exp(-7 * dt));
  const targetRun = THREE.MathUtils.clamp((walkSpeed - walkSpeedMs) / (runSpeedMs - walkSpeedMs), 0, 1);
  runWeight += (targetRun - runWeight) * (1 - Math.exp(-5 * dt));
  airWeight += ((isGrounded ? 0 : 1) - airWeight) * (1 - Math.exp(-11 * dt));
  const turnSpeed = dt > 0 ? yawStep / dt : 0;
  const targetBank = THREE.MathUtils.clamp(turnSpeed / 2, -1, 1) * gaitWeight;
  turnBank += (targetBank - turnBank) * (1 - Math.exp(-8 * dt));
  if (walkSpeed > .02 && isGrounded) {
    gaitTime = (gaitTime + dt * 3.6 * Math.min(2.2, walkSpeed / walkSpeedMs)) % 3.6;
  }
  idleTime += dt;
  if (gaitWeight < .01 && airWeight < .01) {
    character.pose(idleTime, 'idle');
  } else {
    character.pose(gaitTime, 'locomotion', gaitWeight, runWeight, turnBank, airWeight);
  }
}

/* Restaura la escala y los marcadores orbitales al volver al mapa cenital */
export function restoreAstronautOrbitalVisuals() {
  const g = state.astronautGroup;
  if (!g) return;
  gaitWeight = 0; runWeight = 0; airWeight = 0; turnBank = 0;
  g.visible = true;
  g.position.copy(state.astronautPosition);
  g.scale.setScalar(Math.max(state.terrainWidth, state.terrainDepth) * 0.0125);
  g.rotation.set(0, 0, 0);
  const markers = g.getObjectByName('orbitalMarkers');
  if (markers) markers.visible = true;
  characters.get(g)?.pose(0, 'idle');
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
  const textures = new Set();
  state.astronautGroup.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      for (const material of [].concat(obj.material)) {
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        material.dispose();
      }
    }
  });
  textures.forEach((texture) => texture.dispose());
  characters.delete(state.astronautGroup);
  state.astronautGroup = null;
  gaitTime = 0; idleTime = 0; gaitWeight = 0; runWeight = 0; airWeight = 0; turnBank = 0;

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