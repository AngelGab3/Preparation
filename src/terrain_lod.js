/* Terreno por chunks con LOD (quadtree) — activable con ?lod=1.
   Muestrea directamente state.dem (sin tocar terrain.js): cada chunk es una malla de
   (N+1)² vértices con falda (skirt) para ocultar grietas entre niveles. Las normales se
   calculan con diferencias centrales sobre el DEM, así no hay costuras entre chunks.
   1 unidad Three.js = 1 metro. */

import * as THREE from 'three';
import { scene, camera, renderer } from './scene.js';
import { state } from './state.js';
import { sampleDemHeightRelM } from './raycast.js';

const N = 32;                    // celdas por lado de chunk
const G = N + 3;                 // rejilla con anillo de falda
const MAX_CACHE = 450;           // chunks en caché (LRU)
const params = new URLSearchParams(window.location.search);
const SPLIT_K = Number(params.get('lodk')) || 2.4; // mayor = más detalle lejos

let active = false;
let group = null;
let L = 0;                       // lado del cuadrado raíz (m)
let maxDepth = 0;
let curEx = null;
let matFar = null;
let matNear = null;
let sharedIndex = null;
const cache = new Map();         // key -> THREE.Mesh
const visible = new Map();       // key -> THREE.Mesh
const leaves = [];

export function isLodActive() { return active; }

function makeIndex() {
  const idx = new Uint16Array((G - 1) * (G - 1) * 6);
  let k = 0;
  for (let j = 0; j < G - 1; j++) {
    for (let i = 0; i < G - 1; i++) {
      const a = j * G + i, b = a + 1, c = a + G, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  return new THREE.BufferAttribute(idx, 1);
}

function makeDetailBump() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  let s = 90210;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wave = Math.sin((x / size) * Math.PI * 8) * Math.cos((y / size) * Math.PI * 8) * 24;
      const v = Math.max(0, Math.min(255, 128 + wave + (rnd() - 0.5) * 100));
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const rep = Math.max(1, state.terrainWidth / 6); // un ciclo cada ~6 m
  tex.repeat.set(rep, rep);
  return tex;
}

export function initTerrainLOD() {
  if (params.get('lod') !== '1' || !state.dem || !state.metadata) return;
  const w = state.terrainWidth, d = state.terrainDepth;
  const res = state.metadata.resolution_m || Math.max(w, d) / Math.max(...state.metadata.shape);
  L = Math.max(w, d);
  maxDepth = Math.max(1, Math.ceil(Math.log2(L / (N * res))));
  sharedIndex = makeIndex();

  const map = state.terrainMesh?.material?.map || null;
  const base = { map, color: 0xffffff, roughness: 0.96, metalness: 0.02, side: THREE.DoubleSide };
  matFar = new THREE.MeshStandardMaterial(base);
  matNear = new THREE.MeshStandardMaterial({ ...base, bumpMap: makeDetailBump(), bumpScale: 0.7 });

  group = new THREE.Group();
  group.name = 'terrainLOD';
  scene.add(group);
  state.lodGroup = group;
  active = true;
  console.log(`[Marswalk LOD] activo · raíz ${L.toFixed(0)} m · profundidad ${maxDepth} · hoja ${(L / 2 ** maxDepth).toFixed(1)} m (${(L / 2 ** maxDepth / N).toFixed(2)} m/vértice)`);
}

function buildChunk(depth, ix, iy) {
  const size = L / 2 ** depth;
  const cx = -L / 2 + (ix + 0.5) * size;
  const cz = -L / 2 + (iy + 0.5) * size;
  const w = state.terrainWidth, d = state.terrainDepth, ex = state.exaggeration;
  const step = size / N;
  const eps = Math.max(step, state.metadata.resolution_m || 1);
  const skirt = Math.max(1, size * 0.06);
  const hw = w / 2, hd = d / 2;
  const hAt = (x, z) => sampleDemHeightRelM(
    Math.min(hw, Math.max(-hw, x)), Math.min(hd, Math.max(-hd, z))) ?? 0;

  const pos = new Float32Array(G * G * 3);
  const nor = new Float32Array(G * G * 3);
  const uv = new Float32Array(G * G * 2);
  let p = 0, q = 0;
  for (let j = 0; j < G; j++) {
    const jj = j - 1, cj = Math.min(N, Math.max(0, jj));
    const lz = (cj - N / 2) * step, wz = cz + lz;
    for (let i = 0; i < G; i++) {
      const ii = i - 1, ci = Math.min(N, Math.max(0, ii));
      const lx = (ci - N / 2) * step, wx = cx + lx;
      const h = hAt(wx, wz);
      const edge = ii < 0 || ii > N || jj < 0 || jj > N;
      pos[p] = lx; pos[p + 1] = h * ex - (edge ? skirt : 0); pos[p + 2] = lz;
      const dhx = (hAt(wx + eps, wz) - hAt(wx - eps, wz)) / (2 * eps) * ex;
      const dhz = (hAt(wx, wz + eps) - hAt(wx, wz - eps)) / (2 * eps) * ex;
      const inv = 1 / Math.hypot(dhx, 1, dhz);
      nor[p] = -dhx * inv; nor[p + 1] = inv; nor[p + 2] = -dhz * inv;
      uv[q] = Math.min(1, Math.max(0, (wx + hw) / w));
      uv[q + 1] = 1 - Math.min(1, Math.max(0, (wz + hd) / d));
      p += 3; q += 2;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(sharedIndex);
  geo.computeBoundingSphere();
  const near = depth >= maxDepth - 1;
  const mesh = new THREE.Mesh(geo, near ? matNear : matFar);
  mesh.position.set(cx, 0, cz);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);
  mesh.userData.lod = true;
  return mesh;
}

function select(depth, ix, iy, topY) {
  const size = L / 2 ** depth;
  const cx = -L / 2 + (ix + 0.5) * size;
  const cz = -L / 2 + (iy + 0.5) * size;
  const hs = size / 2;
  if (Math.abs(cx) - hs >= state.terrainWidth / 2 || Math.abs(cz) - hs >= state.terrainDepth / 2) return;
  const cp = camera.position;
  const dx = Math.max(Math.abs(cp.x - cx) - hs, 0);
  const dz = Math.max(Math.abs(cp.z - cz) - hs, 0);
  const dy = cp.y > topY ? cp.y - topY : (cp.y < 0 ? -cp.y : 0);
  const dist = Math.hypot(dx, dy, dz);
  if (depth < maxDepth && dist < size * SPLIT_K) {
    for (let k = 0; k < 4; k++) select(depth + 1, ix * 2 + (k & 1), iy * 2 + (k >> 1), topY);
  } else {
    leaves.push([depth, ix, iy]);
  }
}

function clearCache() {
  for (const m of visible.values()) group.remove(m);
  visible.clear();
  for (const m of cache.values()) m.geometry.dispose();
  cache.clear();
}

export function updateTerrainLOD() {
  if (!active) return;
  if (curEx !== state.exaggeration) { clearCache(); curEx = state.exaggeration; }

  /* Sincronizar textura compuesta (capas) y ocultar mallas legacy (siguen existiendo para raycast/estado) */
  const map = state.terrainMesh?.material?.map || null;
  if (matFar.map !== map) {
    matFar.map = map; matNear.map = map;
    matFar.needsUpdate = true; matNear.needsUpdate = true;
  }
  if (state.terrainMesh) state.terrainMesh.visible = false;
  if (state.localPatchMesh) state.localPatchMesh.visible = false;

  const range = state.metadata.elevation_range_m;
  const topY = (range[1] - range[0]) * state.exaggeration;
  leaves.length = 0;
  select(0, 0, 0, topY);

  const want = new Set();
  for (const [depth, ix, iy] of leaves) {
    const key = `${depth}_${ix}_${iy}`;
    want.add(key);
    let mesh = cache.get(key);
    if (mesh) { cache.delete(key); } else { mesh = buildChunk(depth, ix, iy); }
    cache.set(key, mesh); // reinsertar = más reciente (LRU)
    if (!visible.has(key)) { group.add(mesh); visible.set(key, mesh); }
  }
  for (const [key, mesh] of visible) {
    if (!want.has(key)) { group.remove(mesh); visible.delete(key); }
  }
  if (cache.size > MAX_CACHE) {
    for (const [key, mesh] of cache) {
      if (cache.size <= MAX_CACHE) break;
      if (visible.has(key)) continue;
      mesh.geometry.dispose();
      cache.delete(key);
    }
  }
  state.lodStats = { visible: visible.size, cached: cache.size, maxDepth };
}
