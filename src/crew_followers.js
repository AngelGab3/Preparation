/* Compañeros de tripulación en 3D: siguen al jugador en cuña con la misma mecánica que
 * el rover Robert (punto de acompañamiento + giro suave + velocidad proporcional a la distancia).
 * Solo existen en modo grupo y solo se ven en superficie (1ª / 3ª persona). */

import * as THREE from 'three';
import { scene, camera } from './scene.js';
import { state } from './state.js';
import { sampleGroundY } from './raycast.js';
import { ROLES } from './crew.js';

const LATERAL_M = 2.3;        // separación lateral por fila de la cuña
const BACK_M = 1.4;           // retraso de cada fila respecto a la anterior
const AHEAD_M = 0.9;          // la primera fila va un poco por delante: visible en 1ª y 3ª persona
const TELEPORT_DIST_M = 60;   // si quedaron muy lejos, reaparecen detrás del jugador
const WALK_REF_MS = 1.2;

const followers = [];         // { group, character, memberId, role, name, x, z, yaw, gaitTime, gaitWeight, idleTime, placed, moving }

function makeLabelSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 44px "JetBrains Mono", ui-monospace, monospace';
  const w = Math.min(492, ctx.measureText(text).width + 56);
  const x0 = (512 - w) / 2;
  ctx.fillStyle = 'rgba(9, 18, 22, 0.78)';
  ctx.beginPath(); ctx.roundRect(x0, 12, w, 72, 16); ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(x0, 12, 12, 72);
  ctx.fillStyle = '#e8eaed';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256 + 6, 50, 440);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.15, 0.215, 1);
  sprite.position.y = 2.2;
  sprite.name = 'crewLabel';
  return sprite;
}

/* Astronauta ligero para los compañeros (~2 mil triángulos, 18 mallas). El modelo detallado del
 * jugador tiene ~237 mil triángulos y 278 mallas: cinco copias hundirían los FPS en un portátil. */
const SUIT_WHITE = 0xbfbba9, SUIT_DARK = 0x282c2b, SUIT_SHELL = 0xbebdac;

function createLightAstronaut(roleColor) {
  const root = new THREE.Group();
  const fabric = new THREE.MeshStandardMaterial({ color: SUIT_WHITE, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: SUIT_DARK, roughness: 0.75 });
  const shell = new THREE.MeshStandardMaterial({ color: SUIT_SHELL, roughness: 0.45, metalness: 0.2 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x997045, roughness: 0.15, metalness: 1 });
  const role = new THREE.MeshStandardMaterial({ color: roleColor, emissive: roleColor, emissiveIntensity: 0.5, roughness: 0.5 });
  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  /* Torso + mochila PLSS + unidad de control al pecho */
  const body = new THREE.Group();
  body.position.y = 0.92;
  root.add(body);
  add(body, new THREE.CapsuleGeometry(0.215, 0.34, 4, 12), fabric, 0, 0.36, 0);
  add(body, new THREE.BoxGeometry(0.46, 0.62, 0.2), shell, 0, 0.4, -0.25);        // PLSS
  add(body, new THREE.BoxGeometry(0.34, 0.07, 0.03), role, 0, 0.64, -0.355);      // banda del rol (espalda)
  add(body, new THREE.BoxGeometry(0.2, 0.13, 0.07), dark, 0, 0.36, 0.215);        // DCU
  add(body, new THREE.CapsuleGeometry(0.19, 0.1, 4, 12), fabric, 0, 0.02, 0);     // cadera
  /* Casco + visor dorado */
  add(body, new THREE.SphereGeometry(0.2, 18, 14), shell, 0, 0.84, 0);
  const v = add(body, new THREE.SphereGeometry(0.168, 16, 12, 0, Math.PI * 2, 0.35, 1.25), visor, 0, 0.84, 0.062);
  v.rotation.x = Math.PI / 2;

  /* Extremidades: pivote en hombro/cadera para el balanceo de marcha */
  const limb = (parent, x, y, len, radius, withRole) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    parent.add(pivot);
    add(pivot, new THREE.CapsuleGeometry(radius, len, 4, 10), fabric, 0, -len / 2 - radius * 0.4, 0);
    if (withRole) add(pivot, new THREE.CylinderGeometry(radius + 0.008, radius + 0.008, 0.05, 12), role, 0, -0.1, 0);
    return pivot;
  };
  const armL = limb(body, 0.29, 0.6, 0.46, 0.075, true);
  const armR = limb(body, -0.29, 0.6, 0.46, 0.075, true);
  add(armL, new THREE.SphereGeometry(0.075, 10, 8), dark, 0, -0.56, 0);           // guantes
  add(armR, new THREE.SphereGeometry(0.075, 10, 8), dark, 0, -0.56, 0);
  const legL = limb(root, 0.12, 0.9, 0.62, 0.1, false);
  const legR = limb(root, -0.12, 0.9, 0.62, 0.1, false);
  add(legL, new THREE.BoxGeometry(0.17, 0.12, 0.3), dark, 0, -0.84, 0.04);        // botas
  add(legR, new THREE.BoxGeometry(0.17, 0.12, 0.3), dark, 0, -0.84, 0.04);

  return {
    root,
    /* t = fase de marcha (s, ciclo de 3.6 s como el jugador); w = 0 parado … 1 caminando */
    pose(t, w, idle) {
      const ph = (t / 3.6) * Math.PI * 4;
      const swing = Math.sin(ph) * 0.55 * w;
      legL.rotation.x = swing; legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.7; armR.rotation.x = swing * 0.7;
      armL.rotation.z = 0.12; armR.rotation.z = -0.12;
      body.position.y = 0.92 + Math.abs(Math.cos(ph)) * 0.035 * w + Math.sin(idle * 1.3) * 0.006 * (1 - w);
      body.rotation.x = 0.1 * w;
      body.rotation.y = Math.sin(idle * 0.4) * 0.12 * (1 - w);
    },
    dispose() {
      root.traverse((o) => o.geometry?.dispose());
      for (const m of [fabric, dark, shell, visor, role]) m.dispose();
    },
  };
}

function createFollower(member) {
  const group = new THREE.Group();
  group.name = `crewFollower_${member.id}`;
  const color = ROLES[member.role]?.color || '#66fcf1';
  const character = createLightAstronaut(color);
  group.add(character.root);
  group.add(makeLabelSprite(member.name || member.id, color));
  group.visible = false;
  scene.add(group);
  return {
    group, character, memberId: member.id, role: member.role, name: member.name,
    x: 0, z: 0, yaw: 0, gaitTime: Math.random() * 3.6, gaitWeight: 0, idleTime: Math.random() * 5, placed: false,
  };
}

function disposeFollower(f) {
  scene.remove(f.group);
  f.character.dispose();
  const label = f.group.getObjectByName('crewLabel');
  label?.material?.map?.dispose();
  label?.material?.dispose();
}

/* Ajusta los compañeros 3D a la tripulación actual (el miembro 0 es el jugador) */
export function syncCrewFollowers() {
  const wanted = state.healthMode === 'group' && Array.isArray(state.crew) ? state.crew.slice(1) : [];
  /* Quitar los que ya no están o cambiaron de nombre/rol (se recrean con su etiqueta nueva) */
  for (let i = followers.length - 1; i >= 0; i--) {
    const f = followers[i];
    const m = wanted.find((w) => w.id === f.memberId);
    if (!m || m.name !== f.name || m.role !== f.role) {
      disposeFollower(f);
      followers.splice(i, 1);
    }
  }
  for (const m of wanted) {
    if (!followers.some((f) => f.memberId === m.id)) followers.push(createFollower(m));
  }
  followers.sort((a, b) => wanted.findIndex((w) => w.id === a.memberId) - wanted.findIndex((w) => w.id === b.memberId));
}

export function getCrewFollowerCount() {
  return followers.length;
}

/* Formación en cuña: cada compañero tiene un puesto a un lado del jugador (la primera fila,
 * algo adelantada). Así se ven en 1ª y 3ª persona y nunca quedan dentro de la cámara. */
function slotOffset(i) {
  const row = Math.floor(i / 2) + 1;
  return { side: (i % 2 === 0 ? 1 : -1) * LATERAL_M * row, back: BACK_M * (row - 1) - AHEAD_M };
}

const viewDir = new THREE.Vector3();
let heading = null;           // rumbo de marcha suavizado (no gira con solo mirar alrededor)
let lastPX = 0, lastPZ = 0;

export function tickCrewFollowers(dt) {
  if (!followers.length) return;
  const onSurface = state.mode === 'fp' && !!state.astronautGroup;
  if (!onSurface) {
    for (const f of followers) { f.group.visible = false; f.placed = false; }
    heading = null;
    return;
  }

  const px = state.astronautPosition.x;
  const pz = state.astronautPosition.z;
  if (heading === null) {
    /* Rumbo inicial = hacia donde mira la cámara (la cámara de 3ª persona va detrás del jugador) */
    camera.getWorldDirection(viewDir);
    /* Durante el descenso desde órbita la cámara mira casi en vertical: ahí se usa el rumbo del cuerpo */
    heading = Math.hypot(viewDir.x, viewDir.z) > 0.3 ? Math.atan2(viewDir.x, viewDir.z) : state.astronautGroup.rotation.y;
  } else {
    const mx = px - lastPX, mz = pz - lastPZ;
    if (Math.hypot(mx, mz) > 0.004) {
      const moveYaw = Math.atan2(mx, mz);
      const d = Math.atan2(Math.sin(moveYaw - heading), Math.cos(moveYaw - heading));
      heading += d * Math.min(1, dt * 2.5);
    }
  }
  lastPX = px; lastPZ = pz;
  const fwdX = Math.sin(heading), fwdZ = Math.cos(heading);
  const rightX = Math.cos(heading), rightZ = -Math.sin(heading);

  followers.forEach((f, i) => {
    const { side, back } = slotOffset(i);
    const goalX = THREE.MathUtils.clamp(px - fwdX * back + rightX * side, -state.boundsX, state.boundsX);
    const goalZ = THREE.MathUtils.clamp(pz - fwdZ * back + rightZ * side, -state.boundsZ, state.boundsZ);

    if (!f.placed || Math.hypot(px - f.x, pz - f.z) > TELEPORT_DIST_M) {
      f.x = goalX; f.z = goalZ; f.yaw = heading; f.placed = true;
    }

    const gx = goalX - f.x, gz = goalZ - f.z;
    const gDist = Math.hypot(gx, gz);

    /* Misma mecánica que Robert: giro suave hacia el objetivo y velocidad proporcional a la distancia */
    let speed = 0;
    if (gDist > (f.moving ? 0.12 : 0.45)) {
      f.moving = true;
      const moveYaw = Math.atan2(gx, gz);
      const diffYaw = Math.atan2(Math.sin(moveYaw - f.yaw), Math.cos(moveYaw - f.yaw));
      f.yaw += diffYaw * Math.min(1, dt * 6);
      const step = Math.min(gDist, Math.min(3.6, 0.5 + gDist * 0.9) * dt);
      f.x += (gx / gDist) * step;
      f.z += (gz / gDist) * step;
      speed = dt > 1e-5 ? step / dt : 0;
    } else {
      f.moving = false;
      /* Parado: se orienta como el grupo */
      const d = Math.atan2(Math.sin(heading - f.yaw), Math.cos(heading - f.yaw));
      f.yaw += d * Math.min(1, dt * 3);
    }

    const y = sampleGroundY(f.x, f.z) ?? state.astronautPosition.y;
    f.group.position.set(f.x, y, f.z);
    f.group.rotation.y = f.yaw;

    /* Si la cámara queda encima de un compañero (giro brusco), se oculta para no tapar la vista */
    const camDist = Math.hypot(camera.position.x - f.x, camera.position.z - f.z);
    f.group.visible = camDist > 0.9;
    const label = f.group.getObjectByName('crewLabel');
    if (label) label.visible = camDist > 2.2;

    const target = Math.min(1, speed / WALK_REF_MS);
    f.gaitWeight += (target - f.gaitWeight) * (1 - Math.exp(-7 * dt));
    if (speed > 0.02) f.gaitTime = (f.gaitTime + dt * 3.6 * Math.min(2.2, speed / WALK_REF_MS)) % 3.6;
    f.idleTime += dt;
    f.character.pose(f.gaitTime, f.gaitWeight, f.idleTime);
  });
}
