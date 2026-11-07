/* Efectos de calidad visual en primera persona (activos por defecto; ?fx=0 los desactiva):
   polvo en suspensión alrededor de la cámara y rocas con InstancedMesh. 1 unidad = 1 m. */

import * as THREE from 'three';
import { scene, camera } from './scene.js';
import { state } from './state.js';
import { sampleDemHeightRelM } from './raycast.js';

const params = new URLSearchParams(window.location.search);
const DUST_COUNT = 1400;
const DUST_BOX_M = 120;
const ROCK_CELL_M = 9;
const ROCK_RADIUS_M = 110;
const ROCK_MAX = 900;

let enabled = false;
let dust = null;
let dustOffsets = null;
let rocks = null;
let rockEx = null;
let rockCenter = new THREE.Vector2(1e9, 1e9);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();

function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function initTerrainFX() {
  if (params.get('fx') === '0') return; // activos por defecto; ?fx=0 los desactiva
  if (!state.dem) return;

  /* Polvo */
  dustOffsets = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    dustOffsets[i * 3] = (Math.random() - 0.5) * DUST_BOX_M;
    dustOffsets[i * 3 + 1] = Math.random() * 18 - 2;
    dustOffsets[i * 3 + 2] = (Math.random() - 0.5) * DUST_BOX_M;
  }
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dustOffsets, 3));
  dust = new THREE.Points(dGeo, new THREE.PointsMaterial({
    color: 0xdcae82, size: 0.18, transparent: true, opacity: 0.4, depthWrite: false, sizeAttenuation: true,
  }));
  dust.frustumCulled = false;
  dust.visible = false;
  scene.add(dust);

  /* Rocas (geometría baja, flatShading para silueta angulosa) */
  const rGeo = new THREE.IcosahedronGeometry(1, 1);
  const rMat = new THREE.MeshStandardMaterial({ color: 0x6a4a3b, roughness: 1, metalness: 0, flatShading: true });
  rocks = new THREE.InstancedMesh(rGeo, rMat, ROCK_MAX);
  rocks.count = 0;
  rocks.frustumCulled = false;
  rocks.visible = false;
  scene.add(rocks);
  enabled = true;
}

function scatterRocks(cx, cz) {
  const ex = state.exaggeration;
  const hw = state.terrainWidth / 2, hd = state.terrainDepth / 2;
  const x0 = Math.floor((cx - ROCK_RADIUS_M) / ROCK_CELL_M), x1 = Math.floor((cx + ROCK_RADIUS_M) / ROCK_CELL_M);
  const z0 = Math.floor((cz - ROCK_RADIUS_M) / ROCK_CELL_M), z1 = Math.floor((cz + ROCK_RADIUS_M) / ROCK_CELL_M);
  let n = 0;
  for (let gz = z0; gz <= z1 && n < ROCK_MAX; gz++) {
    for (let gx = x0; gx <= x1 && n < ROCK_MAX; gx++) {
      const r = hash2(gx, gz);
      if (r > 0.6) continue;
      const wx = (gx + hash2(gx + 7, gz)) * ROCK_CELL_M;
      const wz = (gz + hash2(gx, gz + 13)) * ROCK_CELL_M;
      if (Math.abs(wx) > hw - 2 || Math.abs(wz) > hd - 2) continue;
      if ((wx - cx) ** 2 + (wz - cz) ** 2 > ROCK_RADIUS_M ** 2) continue;
      const h = sampleDemHeightRelM(wx, wz);
      if (h === null) continue;
      const size = 0.12 + Math.pow(hash2(gx + 31, gz + 17), 3) * 1.3; // pocas rocas grandes
      tmpE.set(hash2(gx, gz + 3) * 6.28, hash2(gx + 5, gz) * 6.28, hash2(gx, gz + 9) * 6.28);
      tmpQ.setFromEuler(tmpE);
      tmpS.set(size * (0.8 + hash2(gx + 1, gz) * 0.6), size * 0.55, size * (0.8 + hash2(gx, gz + 1) * 0.6));
      tmpP.set(wx, h * ex + size * 0.2, wz);
      tmpM.compose(tmpP, tmpQ, tmpS);
      rocks.setMatrixAt(n++, tmpM);
    }
  }
  rocks.count = n;
  rocks.instanceMatrix.needsUpdate = true;
  rockCenter.set(cx, cz);
}

export function updateTerrainFX(dt) {
  if (!enabled) return;
  const fp = state.mode === 'fp';
  dust.visible = rocks.visible = fp;
  if (!fp) return;
  if (rockEx !== state.exaggeration) { rockEx = state.exaggeration; invalidateTerrainFX(); }

  /* Polvo: deriva con el viento y se envuelve en una caja alrededor de la cámara */
  const windMs = (state.weather?.wind_ms ?? 5) * 0.4;
  const half = DUST_BOX_M / 2;
  for (let i = 0; i < DUST_COUNT; i++) {
    const k = i * 3;
    dustOffsets[k] += windMs * dt;
    dustOffsets[k + 1] += Math.sin((dustOffsets[k] + i) * 0.1) * 0.05 * dt;
    if (dustOffsets[k] > half) dustOffsets[k] -= DUST_BOX_M;
    if (dustOffsets[k + 2] > half) dustOffsets[k + 2] -= DUST_BOX_M;
    if (dustOffsets[k + 2] < -half) dustOffsets[k + 2] += DUST_BOX_M;
  }
  dust.geometry.attributes.position.needsUpdate = true;
  const tau = state.weather?.dust_tau ?? 0.45;
  dust.material.opacity = Math.min(0.85, 0.2 + tau * 0.5);
  /* Los offsets viven en espacio local: la caja sigue al suelo bajo la cámara */
  dust.position.set(camera.position.x, camera.position.y - 1.6, camera.position.z);

  const dx = camera.position.x - rockCenter.x, dz = camera.position.z - rockCenter.y;
  if (dx * dx + dz * dz > 25 * 25) scatterRocks(camera.position.x, camera.position.z);
}

/* Las rocas dependen de la exageración: forzar re-dispersión cuando cambie */
export function invalidateTerrainFX() { rockCenter.set(1e9, 1e9); }
