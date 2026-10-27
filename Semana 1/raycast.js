/* Muestreo bilineal de suelo + pendiente real + helpers de raycasting para el puntero (1 unidad = 1 metro). */

import * as THREE from 'three';
import { camera, renderer } from './scene.js';
import { state } from './state.js';
import { CONFIG } from './config.js';

const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

export function getMouseNDC(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  return mouse;
}

/**
 * Elevación relativa a elevation_range_m[0] (en metros, sin exageración) en (x_m, z_m)
 * mediante interpolación bilineal sobre el DEM completo state.dem (o state.heights como fallback).
 */
export function sampleDemHeightRelM(x_m, z_m) {
  const w_m = state.terrainWidth;
  const d_m = state.terrainDepth;
  if (w_m <= 0 || d_m <= 0) return null;

  const u = (x_m + w_m * 0.5) / w_m;
  const v = (z_m + d_m * 0.5) / d_m;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;

  const dem  = state.dem;
  const meta = state.metadata;

  if (dem && meta && Array.isArray(meta.shape)) {
    const [rows, cols] = meta.shape;
    const minElev_m    = meta.elevation_range_m[0];
    const maxCol       = cols - 1;
    const maxRow       = rows - 1;

    const fx = u * maxCol;
    const fz = v * maxRow;

    const ix0 = Math.min(maxCol - 1, Math.max(0, Math.floor(fx)));
    const iz0 = Math.min(maxRow - 1, Math.max(0, Math.floor(fz)));
    const tx  = fx - ix0;
    const tz  = fz - iz0;

    const row0 = iz0 * cols;
    const row1 = (iz0 + 1) * cols;

    const h00 = dem[row0 + ix0];
    const h10 = dem[row0 + ix0 + 1];
    const h01 = dem[row1 + ix0];
    const h11 = dem[row1 + ix0 + 1];

    const top = h00 + (h10 - h00) * tx;
    const bot = h01 + (h11 - h01) * tx;
    const elev_m = top + (bot - top) * tz;

    return elev_m - minElev_m;
  }

  /* Fallback sobre state.heights (N×N) */
  const heights = state.heights;
  if (!heights) return null;

  const seg = CONFIG.SEGMENTS;
  const N   = seg + 1;
  const fx  = u * seg;
  const fz  = v * seg;

  const ix0 = Math.min(seg - 1, Math.max(0, Math.floor(fx)));
  const iz0 = Math.min(seg - 1, Math.max(0, Math.floor(fz)));
  const tx  = fx - ix0;
  const tz  = fz - iz0;

  const row0 = iz0 * N;
  const row1 = (iz0 + 1) * N;

  const top = heights[row0 + ix0] + (heights[row0 + ix0 + 1] - heights[row0 + ix0]) * tx;
  const bot = heights[row1 + ix0] + (heights[row1 + ix0 + 1] - heights[row1 + ix0]) * tx;
  return top + (bot - top) * tz;
}

/**
 * Altura Y del terreno (en metros, con exageración visual aplicada) en (x, z)
 * mediante interpolación bilineal. Costo O(1) sin allocs.
 */
export function sampleGroundY(x_m, z_m) {
  const hRel_m = sampleDemHeightRelM(x_m, z_m);
  return hRel_m !== null ? hRel_m * state.exaggeration : null;
}

/**
 * Pendiente real del terreno en grados en (x_m, z_m), calculada mediante
 * diferencias centrales en metros sobre el DEM sin exageración (sección 5).
 */
export function sampleSlopeDeg(x_m, z_m) {
  const dem  = state.dem;
  const meta = state.metadata;
  if (!dem || !meta) return 0;

  const [rows, cols]       = meta.shape;
  const [width_m, depth_m] = meta.size_m;
  if (cols < 2 || rows < 2 || width_m <= 0 || depth_m <= 0) return 0;

  const u = THREE.MathUtils.clamp((x_m + width_m * 0.5) / width_m, 0, 1);
  const v = THREE.MathUtils.clamp((z_m + depth_m * 0.5) / depth_m, 0, 1);

  const c = Math.round(u * (cols - 1));
  const r = Math.round(v * (rows - 1));

  const cPrev = Math.max(0, c - 1);
  const cNext = Math.min(cols - 1, c + 1);
  const rPrev = Math.max(0, r - 1);
  const rNext = Math.min(rows - 1, r + 1);

  const cellDx_m = width_m / (cols - 1);
  const cellDz_m = depth_m / (rows - 1);

  const spanX_m = (cNext - cPrev) * cellDx_m;
  const spanZ_m = (rNext - rPrev) * cellDz_m;

  const zRight = dem[r * cols + cNext];
  const zLeft  = dem[r * cols + cPrev];
  const zDown  = dem[rNext * cols + c];
  const zUp    = dem[rPrev * cols + c];

  const dzdx = spanX_m > 0 ? (zRight - zLeft) / spanX_m : 0;
  const dzdz = spanZ_m > 0 ? (zDown - zUp) / spanZ_m : 0;

  const slopeRad = Math.atan(Math.hypot(dzdx, dzdz));
  return slopeRad * (180 / Math.PI);
}

/**
 * Devuelve el factor de costo de O₂ según la pendiente en grados y si va en ascenso/descenso,
 * usando la tabla slope_cost_factors de config_fisio.json (T7 y T8).
 */
export function getSlopeCostFactor(slope_deg, deltaElev_m = 0) {
  const factors = state.fisio.slope_cost_factors || CONFIG.SLOPE_COST_FACTORS;
  let tableFactor = 1.0;

  for (let i = 0; i < factors.length; i++) {
    const entry = factors[i];
    if (slope_deg >= entry.from_deg && slope_deg < entry.to_deg) {
      tableFactor = entry.factor;
      break;
    }
    if (i === factors.length - 1 && slope_deg >= entry.from_deg) {
      tableFactor = entry.factor;
    }
  }

  /* Si camina cuesta arriba (deltaElev_m > 0), aplica el sobrecosto completo de la pendiente;
     si camina en plano (~0), factor cercano a 1.0; si baja cuesta abajo (deltaElev_m < 0),
     el costo metabólico es menor que en subida (frenado excéntrico moderado). */
  if (deltaElev_m > 0.0005) {
    return tableFactor;
  }
  if (deltaElev_m < -0.0005) {
    return Math.max(0.85, 1.0 + (tableFactor - 1.0) * 0.25);
  }
  return 1.0 + (tableFactor - 1.0) * 0.15;
}

/** Rayo desde el puntero hacia el terreno. Devuelve array de hits. */
export function raycastTerrain(e) {
  if (!state.terrainMesh) return [];
  getMouseNDC(e);
  raycaster.setFromCamera(mouse, camera);
  raycaster.near = 0;
  raycaster.far  = Infinity;
  return raycaster.intersectObject(state.terrainMesh, false);
}

/** Rayo desde el puntero hacia el astronauta. Devuelve array de hits. */
export function raycastAstronaut(e) {
  if (!state.astronautGroup) return [];
  getMouseNDC(e);
  raycaster.setFromCamera(mouse, camera);
  raycaster.near = 0;
  raycaster.far  = Infinity;
  return raycaster.intersectObject(state.astronautGroup, true);
}

/** Rayo desde el puntero hacia los marcadores de POIs (T9). Devuelve el objeto POI impactado o null. */
export function raycastPOIs(e) {
  if (!state.poiGroup || !state.poiGroup.visible) return null;
  getMouseNDC(e);
  raycaster.setFromCamera(mouse, camera);
  raycaster.near = 0;
  raycaster.far  = Infinity;
  const hits = raycaster.intersectObject(state.poiGroup, true);
  for (let i = 0; i < hits.length; i++) {
    let obj = hits[i].object;
    while (obj) {
      if (obj.userData && obj.userData.poi) {
        return { poi: obj.userData.poi, point: hits[i].point };
      }
      obj = obj.parent;
    }
  }
  return null;
}

/**
 * Compara en consola el costo por llamada de sampleGroundY por raycast vs. bilineal (criterio T3).
 */
export function benchmarkGroundSampling(iterations = 200) {
  if (!state.terrainMesh || !state.heights) return;

  const down = new THREE.Vector3(0, -1, 0);
  const orig = new THREE.Vector3();

  /* 1. Raycast legacy */
  const t0 = performance.now();
  let sumRay = 0;
  for (let i = 0; i < iterations; i++) {
    const x = ((i * 73) % 1000) - 500;
    const z = ((i * 137) % 1000) - 500;
    orig.set(x, 20000, z);
    raycaster.set(orig, down);
    raycaster.near = 0;
    raycaster.far  = 40000;
    const hits = raycaster.intersectObject(state.terrainMesh, false);
    if (hits.length) sumRay += hits[0].point.y;
  }
  const dtRayMs = performance.now() - t0;

  /* 2. Interpolación bilineal */
  const t1 = performance.now();
  let sumBil = 0;
  for (let i = 0; i < iterations; i++) {
    const x = ((i * 73) % 1000) - 500;
    const z = ((i * 137) % 1000) - 500;
    const y = sampleGroundY(x, z);
    if (y !== null) sumBil += y;
  }
  const dtBilMs = performance.now() - t1;

  const avgRayUs = (dtRayMs * 1000) / iterations;
  const avgBilUs = (dtBilMs * 1000) / iterations;
  const speedup  = dtBilMs > 0 ? (dtRayMs / dtBilMs).toFixed(0) : '∞';

  console.log(
    `[Marswalk T3 Benchmark] (${iterations} muestras) · ` +
    `Raycast: ${(dtRayMs / iterations).toFixed(3)} ms/llamada (${avgRayUs.toFixed(1)} µs) · ` +
    `Bilineal: ${(dtBilMs / iterations).toFixed(5)} ms/llamada (${avgBilUs.toFixed(3)} µs) · ` +
    `Mejora: ~${speedup}× más rápido (Δ media Y = ${(Math.abs(sumRay - sumBil) / iterations).toFixed(3)} m)`
  );
}
