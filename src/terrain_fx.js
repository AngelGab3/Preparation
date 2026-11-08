/* Efectos de calidad visual en primera persona (activos por defecto; ?fx=0 los desactiva):
   polvo en suspensión alrededor de la cámara y rocas con InstancedMesh. 1 unidad = 1 m. */

import * as THREE from 'three';
import { scene, camera } from './scene.js';
import { state } from './state.js';
import { sampleDemHeightRelM } from './raycast.js';

const params = new URLSearchParams(window.location.search);
const DUST_COUNT = 1400;
const DUST_BOX_M = 120;
const ROCK_CELL_M = 8;
const ROCK_RADIUS_M = 165;
const ROCK_MAX = 1100;
const PEBBLE_MAX = 2200;

let enabled = false;
let dust = null;
let dustOffsets = null;
let rocks = null;
let pebbles = null;
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

  /* Cantos, bloques y grava separados: una llamada de dibujo por tamaño. */
  const rGeo = new THREE.IcosahedronGeometry(1, 0);
  const pGeo = new THREE.DodecahedronGeometry(1, 0);
  const rMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: true });
  rocks = new THREE.InstancedMesh(rGeo, rMat, ROCK_MAX);
  pebbles = new THREE.InstancedMesh(pGeo, rMat.clone(), PEBBLE_MAX);
  for (const mesh of [rocks, pebbles]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
  }
  enabled = true;
}

const rockColors = [0x6b4537, 0x86513c, 0x9b6348, 0xb57a58, 0x714b3d].map((c) => new THREE.Color(c));
const pebbleColors = [0x714433, 0x9b6549, 0xc08560, 0x5d3e33].map((c) => new THREE.Color(c));

function scatterRocks(cx, cz) {
  const ex = state.exaggeration;
  const hw = state.terrainWidth / 2, hd = state.terrainDepth / 2;
  const x0 = Math.floor((cx - ROCK_RADIUS_M) / ROCK_CELL_M), x1 = Math.floor((cx + ROCK_RADIUS_M) / ROCK_CELL_M);
  const z0 = Math.floor((cz - ROCK_RADIUS_M) / ROCK_CELL_M), z1 = Math.floor((cz + ROCK_RADIUS_M) / ROCK_CELL_M);
  let n = 0, small = 0;
  for (let gz = z0; gz <= z1 && n < ROCK_MAX; gz++) {
    for (let gx = x0; gx <= x1 && n < ROCK_MAX; gx++) {
      const r = hash2(gx, gz);
      if (r > .69) continue;
      const wx = (gx + hash2(gx + 7, gz)) * ROCK_CELL_M;
      const wz = (gz + hash2(gx, gz + 13)) * ROCK_CELL_M;
      if (Math.abs(wx) > hw - 2 || Math.abs(wz) > hd - 2) continue;
      if ((wx - cx) ** 2 + (wz - cz) ** 2 > ROCK_RADIUS_M ** 2) continue;
      if (state.pois?.some((poi) => poi.type === 'shelter' &&
        (wx - poi.position_m[0]) ** 2 + (wz - poi.position_m[1]) ** 2 < 10 ** 2)) continue;
      const h = sampleDemHeightRelM(wx, wz);
      if (h === null) continue;
      const size = .18 + Math.pow(hash2(gx + 31, gz + 17), 3.4) * 2.1;
      tmpE.set((hash2(gx, gz + 3) - .5) * .3, hash2(gx + 5, gz) * 6.28, (hash2(gx, gz + 9) - .5) * .3);
      tmpQ.setFromEuler(tmpE);
      tmpS.set(size * (.72 + hash2(gx + 1, gz) * .62),
        size * (.35 + hash2(gx + 6, gz) * .38),
        size * (.74 + hash2(gx, gz + 1) * .65));
      tmpP.set(wx, h * ex + size * .12, wz);
      tmpM.compose(tmpP, tmpQ, tmpS);
      rocks.setMatrixAt(n, tmpM);
      rocks.setColorAt(n, rockColors[Math.floor(hash2(gx + 43, gz) * rockColors.length)]);
      n++;

      // Grava agrupada a los pies de bloques mayores, también asentada sobre el DEM.
      const pieces = 1 + Math.floor(hash2(gx + 79, gz + 6) * 3);
      for (let j = 0; j < pieces && small < PEBBLE_MAX; j++) {
        const a = hash2(gx + 111 + j, gz + 17) * Math.PI * 2;
        const dist = size * (.8 + hash2(gx + 53, gz + j) * 2.2);
        const px = wx + Math.cos(a) * dist, pz = wz + Math.sin(a) * dist;
        const ph = sampleDemHeightRelM(px, pz);
        if (ph === null) continue;
        const ps = .045 + hash2(gx + j * 17, gz + 29) * .18;
        tmpP.set(px, ph * ex + ps * .16, pz);
        tmpS.set(ps * 1.25, ps * .48, ps);
        tmpE.set(0, a, 0);
        tmpQ.setFromEuler(tmpE);
        tmpM.compose(tmpP, tmpQ, tmpS);
        pebbles.setMatrixAt(small, tmpM);
        pebbles.setColorAt(small, pebbleColors[Math.floor(hash2(gx + j, gz + 71) * pebbleColors.length)]);
        small++;
      }
    }
  }
  rocks.count = n;
  pebbles.count = small;
  rocks.instanceMatrix.needsUpdate = true;
  pebbles.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
  rockCenter.set(cx, cz);
}

export function updateTerrainFX(dt) {
  if (!enabled) return;
  const fp = state.mode === 'fp';
  dust.visible = rocks.visible = pebbles.visible = fp;
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
