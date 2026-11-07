/* Mesh del astronauta + dock + drag sobre el mapa. */

import * as THREE from 'three';
import { scene, renderer } from './scene.js';
import { state } from './state.js';
import { sampleGroundY, raycastAstronaut, raycastTerrain } from './raycast.js';

const dockEl    = document.getElementById('astronaut-dock');
const dockLabel = dockEl.querySelector('.dock-label');

/* ----------------------------------------------------------------- mesh */
let walkPhase = 0;

function createAstronautMesh() {
  const g = new THREE.Group();

  const whiteMat  = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.45, metalness: 0.1 });
  const darkMat   = new THREE.MeshStandardMaterial({ color: 0x2a3542, roughness: 0.25, metalness: 0.85 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xff6a3d, emissive: 0xff6a3d, emissiveIntensity: 0.7,
    roughness: 0.15, metalness: 0.9
  });

  const suit = new THREE.Group();
  suit.name = 'suitBody';

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.72, 6, 12), whiteMat);
  body.position.y = 1.12;
  suit.add(body);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 16), darkMat);
  helmet.position.y = 1.9;
  suit.add(helmet);

  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.31, 16, 16, 0, Math.PI, Math.PI * 0.35, Math.PI * 0.65),
    accentMat
  );
  visor.position.set(0, 1.9, 0.17);
  visor.rotation.y = Math.PI / 2;
  suit.add(visor);

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.78, 0.34), whiteMat);
  pack.position.set(0, 1.15, -0.36);
  suit.add(pack);

  const packAccent = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), accentMat);
  packAccent.position.set(0, 1.38, -0.54);
  suit.add(packAccent);

  /* Extremidades articuladas para vista en 3ª persona */
  const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.48, 4, 8), whiteMat);
  leftLeg.position.set(-0.17, 0.42, 0);
  leftLeg.name = 'leftLeg';
  suit.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.48, 4, 8), whiteMat);
  rightLeg.position.set(0.17, 0.42, 0);
  rightLeg.name = 'rightLeg';
  suit.add(rightLeg);

  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.44, 4, 8), whiteMat);
  leftArm.position.set(-0.44, 1.12, 0);
  leftArm.name = 'leftArm';
  suit.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.44, 4, 8), whiteMat);
  rightArm.position.set(0.44, 1.12, 0);
  rightArm.name = 'rightArm';
  suit.add(rightArm);

  g.add(suit);

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
  visible,
  x,
  y,
  z,
  yawRad,
  walkSpeed = 0,
  dt = 0.016,
  isGrounded = true,
}) {
  const g = state.astronautGroup;
  if (!g) return;

  g.position.set(x, y, z);

  if (!visible) {
    g.visible = false;
    return;
  }

  g.visible = true;
  /* Escala métrica real (~1.75 m de altura total) */
  g.scale.setScalar(0.85);

  const markers = g.getObjectByName('orbitalMarkers');
  if (markers) markers.visible = false;

  /* Rotación horizontal suave hacia la dirección de avance/mirada */
  const curYaw = g.rotation.y;
  const diff = Math.atan2(Math.sin(yawRad - curYaw), Math.cos(yawRad - curYaw));
  g.rotation.y = curYaw + diff * Math.min(1, dt * 12);

  /* Animación de marcha en 3ª persona */
  const suit = g.getObjectByName('suitBody');
  if (!suit) return;
  const lLeg = suit.getObjectByName('leftLeg');
  const rLeg = suit.getObjectByName('rightLeg');
  const lArm = suit.getObjectByName('leftArm');
  const rArm = suit.getObjectByName('rightArm');

  if (!isGrounded) {
    suit.position.y = 0.05;
    if (lLeg) lLeg.rotation.x = 0.35;
    if (rLeg) rLeg.rotation.x = -0.25;
    if (lArm) lArm.rotation.x = -0.45;
    if (rArm) rArm.rotation.x = 0.35;
  } else if (walkSpeed > 0.05) {
    walkPhase += dt * (4.0 + walkSpeed * 2.4);
    const swing = Math.sin(walkPhase) * Math.min(0.65, 0.25 + walkSpeed * 0.14);
    suit.position.y = Math.abs(Math.sin(walkPhase)) * 0.045;
    if (lLeg) lLeg.rotation.x = swing;
    if (rLeg) rLeg.rotation.x = -swing;
    if (lArm) lArm.rotation.x = -swing * 0.8;
    if (rArm) rArm.rotation.x = swing * 0.8;
  } else {
    suit.position.y = 0;
    const damp = Math.max(0, 1 - dt * 10);
    if (lLeg) lLeg.rotation.x *= damp;
    if (rLeg) rLeg.rotation.x *= damp;
    if (lArm) lArm.rotation.x *= damp;
    if (rArm) rArm.rotation.x *= damp;
  }
}

/* Restaura la escala y los marcadores orbitales al volver al mapa cenital */
export function restoreAstronautOrbitalVisuals() {
  const g = state.astronautGroup;
  if (!g) return;
  const dim_m = Math.max(state.terrainWidth, state.terrainDepth);
  g.visible = true;
  g.scale.setScalar(dim_m * 0.0125);
  g.rotation.set(0, 0, 0);
  const markers = g.getObjectByName('orbitalMarkers');
  if (markers) markers.visible = true;
  const suit = g.getObjectByName('suitBody');
  if (suit) {
    suit.position.y = 0;
    ['leftLeg', 'rightLeg', 'leftArm', 'rightArm'].forEach((n) => {
      const part = suit.getObjectByName(n);
      if (part) part.rotation.set(0, 0, 0);
    });
  }
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