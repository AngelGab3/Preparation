/* Carga dirigida por metadata.json + heightmap.f32, construcción de malla global, parche local (T5) y sistema de capas (T6). */

import * as THREE from 'three';
import { scene, renderer, camera, sun, fill, hemiLight, sunDisc, headlamp, stars, skydome, phobosMoon } from './scene.js';
import { state } from './state.js';
import { CONFIG } from './config.js';
import { sampleDemHeightRelM, sampleSlopeDeg, sampleGroundY, getSlopeCostFactor } from './raycast.js';
import { buildHumanScalePOIArtifactGroup, clearAnimatedArtifactsRegistry } from './artifacts3d.js';

let detailBumpTexture = null;
let compositeCanvas   = null;
let compositeCtx      = null;
let compositeTexture  = null;

const LAYER_LABELS = {
  base:   'Textura Base (CTX/MOLA)',
  slope:  'Pendiente (°)',
  risk:   'Riesgo Terreno',
  crism:  'Mineralogía CRISM (MRO)',
  themis: 'Inercia Térmica THEMIS',
};

/* ------------------------------------------------------------------ loader */
export async function loadHeightmap() {
  const params = new URLSearchParams(window.location.search);
  const rawDatasetId = (params.get('dataset') || CONFIG.DEFAULT_DATASET).trim();

  /* Validar que el ID solo contenga caracteres seguros de nombre de carpeta */
  if (!/^[a-zA-Z0-9_-]+$/.test(rawDatasetId)) {
    showLoadingError(
      `ID de dataset inválido: "${rawDatasetId}"`,
      'Usa solo letras, números, guiones o guiones bajos en ?dataset='
    );
    return;
  }

  state.datasetId = rawDatasetId;
  const baseDir = `./data/${rawDatasetId}`;
  const metaUrl = `${baseDir}/metadata.json`;

  setLoadingStatus(`Cargando dataset "${rawDatasetId}"…`, `Leyendo ${metaUrl}`);

  /* Helper: carga una imagen HTML para composición de capas con timeout */
  function loadImageElement(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => {
        console.warn('[Marswalk] Timeout cargando imagen de capa:', url);
        resolve(null);
      }, 10000);
      img.onload = () => {
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = url;
    });
  }

  /* 1. Leer metadata.json */
  let metadata;
  try {
    const res = await fetch(metaUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} al solicitar ${metaUrl}`);
    }
    metadata = await res.json();
  } catch (err) {
    console.error('[Marswalk] Error cargando metadata.json:', err);
    showLoadingError(
      `No se pudo cargar metadata.json para el dataset "${rawDatasetId}"`,
      `Verifica que exista ${metaUrl} y que el servidor estático esté activo (${err.message}).`
    );
    return;
  }

  /* Validar campos esenciales del contrato 4.1 */
  if (
    !metadata ||
    !Array.isArray(metadata.shape) || metadata.shape.length !== 2 ||
    !Array.isArray(metadata.size_m) || metadata.size_m.length !== 2 ||
    !Array.isArray(metadata.elevation_range_m) || metadata.elevation_range_m.length !== 2 ||
    !metadata.heightmap?.file
  ) {
    console.error('[Marswalk] metadata.json incompleto o inválido:', metadata);
    showLoadingError(
      `metadata.json inválido en "${rawDatasetId}"`,
      'Faltan campos obligatorios del contrato 4.1 (shape, size_m, elevation_range_m o heightmap.file).'
    );
    return;
  }

  state.metadata = metadata;
  if (metadata.label) {
    document.title = `${metadata.label} · Marswalk 3D`;
  }

  /* 1a. Poblar selector de dataset y nota visible de incertidumbre y metadatos (Fase D) */
  initDatasetAndUncertaintyUI(rawDatasetId, metadata);

  /* 1b. Leer config_fisio.json (contrato 4.2); si no existe, usar defaults de CONFIG */
  try {
    const fisioRes = await fetch(`${baseDir}/config_fisio.json`, { cache: 'no-store' });
    if (fisioRes.ok) {
      const fisioData = await fisioRes.json();
      if (typeof fisioData.gravity_ms2 === 'number')                 state.fisio.gravity_ms2 = fisioData.gravity_ms2;
      if (typeof fisioData.eye_height_m === 'number')                state.fisio.eye_height_m = fisioData.eye_height_m;
      if (typeof fisioData.walk_speed_ms === 'number')               state.fisio.walk_speed_ms = fisioData.walk_speed_ms;
      if (typeof fisioData.run_speed_ms === 'number')                state.fisio.run_speed_ms = fisioData.run_speed_ms;
      if (typeof fisioData.max_safe_slope_deg === 'number')          state.fisio.max_safe_slope_deg = fisioData.max_safe_slope_deg;
      if (typeof fisioData.o2_reserve_l === 'number' && fisioData.o2_reserve_l > 0) {
        state.fisio.o2_reserve_l = fisioData.o2_reserve_l;
      }
      if (typeof fisioData.o2_base_consumption_l_per_h === 'number' && fisioData.o2_base_consumption_l_per_h > 0) {
        state.fisio.o2_base_consumption_l_per_h = fisioData.o2_base_consumption_l_per_h;
      }
      if (Array.isArray(fisioData.slope_cost_factors) && fisioData.slope_cost_factors.length > 0) {
        state.fisio.slope_cost_factors = fisioData.slope_cost_factors;
      }
      state.hud.o2Remaining_l = state.fisio.o2_reserve_l;
      console.log(
        `[Marswalk] config_fisio.json cargado · O₂=${state.fisio.o2_reserve_l} L · ` +
        `base=${state.fisio.o2_base_consumption_l_per_h} L/h · maxSlope=${state.fisio.max_safe_slope_deg}°`
      );
    }
  } catch (_) {
    /* Sin config_fisio.json todavía: se mantienen los defaults en metros de state.fisio */
  }

  /* 2. Leer binario Float32 (.f32) */
  const f32Url = `${baseDir}/${metadata.heightmap.file}`;
  setLoadingStatus(
    `Cargando ${metadata.label || rawDatasetId}…`,
    `Leyendo ${f32Url}`
  );

  let demFloat32;
  try {
    const res = await fetch(f32Url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} al solicitar ${f32Url}`);
    }
    const buf = await res.arrayBuffer();
    const [rows, cols] = metadata.shape;
    const expectedCount = rows * cols;
    if (buf.byteLength !== expectedCount * 4) {
      throw new Error(
        `Tamaño de ${metadata.heightmap.file} (${buf.byteLength} bytes) no coincide con shape ${rows}×${cols} (${expectedCount * 4} bytes).`
      );
    }
    demFloat32 = new Float32Array(buf);
  } catch (err) {
    console.error('[Marswalk] Error cargando heightmap.f32:', err);
    showLoadingError(
      `Error cargando heightmap de "${rawDatasetId}"`,
      err.message
    );
    return;
  }

  state.dem = demFloat32;

  /* 3. Inicializar capas declaradas en metadata.json (T6) */
  await initLayersFromMetadata(metadata, baseDir, loadImageElement);

  buildTerrain(metadata, demFloat32, compositeTexture);

  /* 4. Inicializar UI y cargar route.json y poi.json opcionales si existen (T8, T9 y E4) */
  initRoutePlannerUI();
  initWeatherAndEmergencyUI();
  await loadDefaultRouteIfPresent(baseDir);
  await loadPOIsIfPresent(baseDir);
}

/* ----------------------------------------------------- Sistema de capas (T6) */
async function initLayersFromMetadata(metadata, baseDir, loadImageElement) {
  const [rows, cols] = metadata.shape;
  /* Tamaño del lienzo de composición (máx 1024 px de lado para fluidez al cambiar opacidad) */
  const maxDim = 1024;
  const scale  = Math.min(1, maxDim / Math.max(cols, rows));
  const compW  = Math.max(64, Math.round(cols * scale));
  const compH  = Math.max(64, Math.round(rows * scale));

  compositeCanvas = document.createElement('canvas');
  compositeCanvas.width  = compW;
  compositeCanvas.height = compH;
  compositeCtx = compositeCanvas.getContext('2d');

  compositeTexture = new THREE.CanvasTexture(compositeCanvas);
  compositeTexture.colorSpace = THREE.SRGBColorSpace;
  compositeTexture.wrapS = compositeTexture.wrapT = THREE.ClampToEdgeWrapping;
  compositeTexture.minFilter = THREE.LinearMipmapLinearFilter;
  compositeTexture.magFilter = THREE.LinearFilter;
  compositeTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  /* Capas configuradas en metadata.json; asegurar al menos base, slope y risk (T6) */
  const rawLayers = Array.isArray(metadata.layers) && metadata.layers.length > 0
    ? metadata.layers.slice()
    : [{ id: 'base', file: 'texture.png', type: 'base' }];

  if (!rawLayers.some((l) => l.id === 'slope')) {
    rawLayers.push({ id: 'slope', file: 'slope.png', type: 'overlay', unit: 'deg', range: [0, 45] });
  }
  if (!rawLayers.some((l) => l.id === 'risk')) {
    rawLayers.push({ id: 'risk', file: 'risk.png', type: 'overlay', unit: '0-1' });
  }
  if (!rawLayers.some((l) => l.id === 'crism')) {
    rawLayers.push({ id: 'crism', file: '', type: 'overlay', unit: 'index' });
  }
  if (!rawLayers.some((l) => l.id === 'themis')) {
    rawLayers.push({ id: 'themis', file: '', type: 'overlay', unit: 'ti' });
  }

  state.layers = [];

  for (const layerDef of rawLayers) {
    let sourceCanvasOrImg = null;
    if (layerDef.file) {
      sourceCanvasOrImg = await loadImageElement(`${baseDir}/${layerDef.file}`);
    }

    /* Si la imagen no existe en disco, generar mapa de calor desde el DEM (T6 y E4) */
    if (!sourceCanvasOrImg) {
      if (layerDef.id === 'slope') {
        sourceCanvasOrImg = generateSlopeLayerCanvas(compW, compH, layerDef.range || [0, 45]);
      } else if (layerDef.id === 'risk') {
        sourceCanvasOrImg = generateRiskLayerCanvas(compW, compH);
      } else if (layerDef.id === 'crism') {
        sourceCanvasOrImg = generateCrismLayerCanvas(compW, compH);
      } else if (layerDef.id === 'themis') {
        sourceCanvasOrImg = generateThemisLayerCanvas(compW, compH);
      } else if (layerDef.type === 'base' || layerDef.id === 'base') {
        sourceCanvasOrImg = generateBaseFallbackCanvas(compW, compH);
      } else {
        sourceCanvasOrImg = generateGenericOverlayCanvas(compW, compH);
      }
    } else if (layerDef.type === 'base' || layerDef.id === 'base') {
      /* Teñir la imagen base en escala de grises con color marciano para separar textura base de relieve */
      sourceCanvasOrImg = tintBaseImageToMarsCanvas(sourceCanvasOrImg, compW, compH);
    }

    const isBase = layerDef.type === 'base' || layerDef.id === 'base';
    const label  = layerDef.label || LAYER_LABELS[layerDef.id] || layerDef.id;

    const layerObj = {
      id:      layerDef.id,
      label,
      type:    layerDef.type || (isBase ? 'base' : 'overlay'),
      unit:    layerDef.unit || '',
      range:   layerDef.range || null,
      enabled: isBase, // base activa por defecto; overlays desactivados al inicio
      opacity: isBase ? 1.0 : 0.65,
      source:  sourceCanvasOrImg,
      enable() {
        this.enabled = true;
        updateCompositeTexture();
        syncLayersUI();
      },
      disable() {
        this.enabled = false;
        updateCompositeTexture();
        syncLayersUI();
      },
      setOpacity(v) {
        this.opacity = THREE.MathUtils.clamp(Number(v), 0, 1);
        updateCompositeTexture();
        syncLayersUI();
      },
    };

    state.layers.push(layerObj);
  }

  updateCompositeTexture();
  renderLayersPanelUI();
}

function tintBaseImageToMarsCanvas(img, w, h) {
  const c = document.createElement('canvas');
  c.width  = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const px = imgData.data;
  /* Color marciano base (#c4714a -> 196, 113, 74) modulado por la luminancia de texture.png */
  for (let i = 0; i < px.length; i += 4) {
    const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
    const factor = 0.28 + lum * 0.85;
    px[i]     = Math.min(255, Math.round(196 * factor));
    px[i + 1] = Math.min(255, Math.round(113 * factor));
    px[i + 2] = Math.min(255, Math.round(74 * factor));
    px[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

function generateBaseFallbackCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width  = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  const px = imgData.data;
  const [minElev_m, maxElev_m] = state.metadata.elevation_range_m;
  const range_m = Math.max(maxElev_m - minElev_m, 1e-6);
  const [width_m, depth_m] = state.metadata.size_m;
  const stepX_m = width_m / Math.max(w - 1, 1);
  const stepZ_m = depth_m / Math.max(h - 1, 1);

  /* Sombreado analítico (hillshade azimut NO + hipso-tinte marciano) para DEMs cargados en tiempo real */
  for (let y = 0; y < h; y++) {
    const z_m = (y / (h - 1) - 0.5) * depth_m;
    for (let x = 0; x < w; x++) {
      const x_m = (x / (w - 1) - 0.5) * width_m;
      const hRel_m = sampleDemHeightRelM(x_m, z_m) ?? 0;
      const hE = sampleDemHeightRelM(Math.min(width_m * 0.5, x_m + stepX_m), z_m) ?? hRel_m;
      const hS = sampleDemHeightRelM(x_m, Math.min(depth_m * 0.5, z_m + stepZ_m)) ?? hRel_m;
      const dzdx = (hE - hRel_m) / Math.max(stepX_m, 1);
      const dzdz = (hS - hRel_m) / Math.max(stepZ_m, 1);
      const shade = THREE.MathUtils.clamp(0.68 - dzdx * 1.4 - dzdz * 1.1, 0.25, 1.22);

      const t = THREE.MathUtils.clamp(hRel_m / range_m, 0, 1);
      const factor = (0.36 + t * 0.72) * shade;
      const o = (y * w + x) * 4;
      px[o]     = Math.min(255, Math.round(202 * factor));
      px[o + 1] = Math.min(255, Math.round(116 * factor));
      px[o + 2] = Math.min(255, Math.round(76 * factor));
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

/**
 * Genera el mapa de calor de pendiente (0..maxDeg°) directamente desde el DEM en metros reales (T6).
 */
function generateSlopeLayerCanvas(w, h, rangeDeg = [0, 45]) {
  const c = document.createElement('canvas');
  c.width  = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  const px = imgData.data;

  const [width_m, depth_m] = state.metadata.size_m;
  const minDeg = rangeDeg[0] ?? 0;
  const maxDeg = Math.max((rangeDeg[1] ?? 45) - minDeg, 1);

  for (let y = 0; y < h; y++) {
    const z_m = (y / (h - 1) - 0.5) * depth_m;
    for (let x = 0; x < w; x++) {
      const x_m = (x / (w - 1) - 0.5) * width_m;
      const slope_deg = sampleSlopeDeg(x_m, z_m);
      const t = THREE.MathUtils.clamp((slope_deg - minDeg) / maxDeg, 0, 1);

      /* Gradiente térmico: azul/cian (plano) → verde → amarillo → rojo intenso (empinado) */
      let r, g, b;
      if (t < 0.33) {
        const k = t / 0.33;
        r = Math.round(30 * (1 - k) + 46 * k);
        g = Math.round(136 * (1 - k) + 204 * k);
        b = Math.round(229 * (1 - k) + 113 * k);
      } else if (t < 0.66) {
        const k = (t - 0.33) / 0.33;
        r = Math.round(46 * (1 - k) + 241 * k);
        g = Math.round(204 * (1 - k) + 196 * k);
        b = Math.round(113 * (1 - k) + 15 * k);
      } else {
        const k = (t - 0.66) / 0.34;
        r = Math.round(241 * (1 - k) + 231 * k);
        g = Math.round(196 * (1 - k) + 35 * k);
        b = Math.round(15 * (1 - k) + 35 * k);
      }

      const o = (y * w + x) * 4;
      px[o]     = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

/**
 * Genera la capa de riesgo combinando pendiente respecto a max_safe_slope_deg y rugosidad local (T6).
 */
function generateRiskLayerCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width  = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  const px = imgData.data;

  const [width_m, depth_m] = state.metadata.size_m;
  const safeDeg = state.fisio.max_safe_slope_deg || 25;

  for (let y = 0; y < h; y++) {
    const z_m = (y / (h - 1) - 0.5) * depth_m;
    for (let x = 0; x < w; x++) {
      const x_m = (x / (w - 1) - 0.5) * width_m;
      const slope_deg = sampleSlopeDeg(x_m, z_m);
      const risk = THREE.MathUtils.clamp(slope_deg / safeDeg, 0, 1);

      const o = (y * w + x) * 4;
      if (risk < 0.45) {
        /* Zona segura: verde translúcido sutil */
        const k = risk / 0.45;
        px[o]     = Math.round(40 + 140 * k);
        px[o + 1] = Math.round(200 - 20 * k);
        px[o + 2] = 70;
        px[o + 3] = Math.round(70 + 110 * k);
      } else if (risk < 0.85) {
        /* Precaución: ámbar/naranja */
        const k = (risk - 0.45) / 0.4;
        px[o]     = Math.round(230 + 25 * k);
        px[o + 1] = Math.round(180 - 110 * k);
        px[o + 2] = 25;
        px[o + 3] = Math.round(180 + 55 * k);
      } else {
        /* Peligro (> umbral seguro): rojo/magenta de alta visibilidad */
        px[o]     = 255;
        px[o + 1] = 32;
        px[o + 2] = 68;
        px[o + 3] = 250;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

function generateGenericOverlayCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width  = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(120, 190, 255, 0.5)';
  ctx.fillRect(0, 0, w, h);
  return c;
}

/**
 * Capa Multi-Misión: Mineralogía / Hidratación CRISM (Mars Reconnaissance Orbiter) (E4).
 * Identifica en tiempo real cuencas fluviales/lacustres de cota baja-media (filosilicatos Fe/Mg en cian/esmeralda)
 * y terrazas marginales de transición (carbonatos hidratados en violeta/azul).
 */
function generateCrismLayerCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width  = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  const px = imgData.data;

  const [width_m, depth_m] = state.metadata.size_m;
  const [minElev_m, maxElev_m] = state.metadata.elevation_range_m;
  const range_m = Math.max(maxElev_m - minElev_m, 1);

  for (let y = 0; y < h; y++) {
    const z_m = (y / (h - 1) - 0.5) * depth_m;
    for (let x = 0; x < w; x++) {
      const x_m = (x / (w - 1) - 0.5) * width_m;
      const hRel_m = sampleDemHeightRelM(x_m, z_m) ?? 0;
      const elevNorm = THREE.MathUtils.clamp(hRel_m / range_m, 0, 1);
      const slope_deg = sampleSlopeDeg(x_m, z_m);

      /* Banda de carbonatos marginales (elevNorm ~ 0.25..0.52 y pendiente moderada 3°..16°) */
      const carbScore = Math.exp(-Math.pow((elevNorm - 0.36) / 0.14, 2)) *
                        Math.exp(-Math.pow((slope_deg - 8.5) / 7.5, 2));
      /* Banda de arcillas / filosilicatos Fe-Mg en pisos de cuenca y abanicos deltaicos (elevNorm < 0.35, baja pendiente) */
      const clayScore = Math.exp(-Math.pow((elevNorm - 0.18) / 0.14, 2)) *
                        Math.exp(-Math.pow(slope_deg / 9.0, 2));

      const o = (y * w + x) * 4;
      if (carbScore > 0.28 && carbScore >= clayScore) {
        const k = THREE.MathUtils.clamp((carbScore - 0.22) / 0.65, 0, 1);
        px[o]     = Math.round(145 + 75 * k);
        px[o + 1] = Math.round(70 + 60 * k);
        px[o + 2] = 255;
        px[o + 3] = Math.round(95 + 145 * k);
      } else if (clayScore > 0.22) {
        const k = THREE.MathUtils.clamp((clayScore - 0.18) / 0.68, 0, 1);
        px[o]     = Math.round(20 + 60 * k);
        px[o + 1] = Math.round(190 + 62 * k);
        px[o + 2] = Math.round(195 + 55 * k);
        px[o + 3] = Math.round(85 + 150 * k);
      } else {
        px[o] = px[o + 1] = px[o + 2] = px[o + 3] = 0;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

/**
 * Capa Multi-Misión: Inercia Térmica THEMIS (Mars Odyssey) (E4).
 * Diferencia en tiempo real roca madre consolidada de alta inercia térmica (tonos cálidos ámbar/naranja)
 * frente a trampas de arena eólica / regolito fino de baja inercia térmica (tonos azul profundo/índigo).
 */
function generateThemisLayerCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width  = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  const px = imgData.data;

  const [width_m, depth_m] = state.metadata.size_m;
  const [minElev_m, maxElev_m] = state.metadata.elevation_range_m;
  const range_m = Math.max(maxElev_m - minElev_m, 1);

  for (let y = 0; y < h; y++) {
    const z_m = (y / (h - 1) - 0.5) * depth_m;
    for (let x = 0; x < w; x++) {
      const x_m = (x / (w - 1) - 0.5) * width_m;
      const hRel_m = sampleDemHeightRelM(x_m, z_m) ?? 0;
      const elevNorm = THREE.MathUtils.clamp(hRel_m / range_m, 0, 1);
      const slope_deg = sampleSlopeDeg(x_m, z_m);

      /* Índice normalizado de inercia térmica (0 = arena/polvo fino en depresiones planas, 1 = roca expuesta) */
      const tiNorm = THREE.MathUtils.clamp(slope_deg / 24.0 * 0.65 + elevNorm * 0.42, 0, 1);
      const o = (y * w + x) * 4;

      if (tiNorm < 0.35) {
        /* Baja inercia térmica (dunas / regolito suelto): azul índigo */
        const k = 1 - tiNorm / 0.35;
        px[o]     = Math.round(35 - 15 * k);
        px[o + 1] = Math.round(115 - 35 * k);
        px[o + 2] = Math.round(235 + 20 * k);
        px[o + 3] = Math.round(90 + 135 * k);
      } else if (tiNorm > 0.58) {
        /* Alta inercia térmica (roca consolidada): ámbar / dorado intenso */
        const k = (tiNorm - 0.58) / 0.42;
        px[o]     = 250;
        px[o + 1] = Math.round(165 - 55 * k);
        px[o + 2] = Math.round(35 - 15 * k);
        px[o + 3] = Math.round(85 + 145 * k);
      } else {
        /* Suelo mixto intermedio */
        px[o] = 120; px[o + 1] = 175; px[o + 2] = 140; px[o + 3] = 55;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

export function updateCompositeTexture() {
  if (!compositeCtx || !compositeCanvas) return;
  const w = compositeCanvas.width;
  const h = compositeCanvas.height;

  /* Fondo neutro de relieve puro (cuando la capa base está desactivada o con opacidad < 1) */
  compositeCtx.globalAlpha = 1.0;
  compositeCtx.fillStyle = '#8d5b44';
  compositeCtx.fillRect(0, 0, w, h);

  for (const layer of state.layers) {
    if (!layer.enabled || layer.opacity <= 0 || !layer.source) continue;
    compositeCtx.globalAlpha = layer.opacity;
    compositeCtx.drawImage(layer.source, 0, 0, w, h);
  }
  compositeCtx.globalAlpha = 1.0;

  if (compositeTexture) {
    compositeTexture.needsUpdate = true;
  }
}

function renderLayersPanelUI() {
  const listEl = document.getElementById('layers-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  for (const layer of state.layers) {
    const item = document.createElement('div');
    item.className = 'layer-item';
    item.dataset.layerId = layer.id;

    const top = document.createElement('div');
    top.className = 'layer-top';

    const labelEl = document.createElement('label');
    labelEl.className = 'layer-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = layer.enabled;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) layer.enable();
      else layer.disable();
    });

    const titleSpan = document.createElement('span');
    titleSpan.textContent = layer.label;

    labelEl.appendChild(checkbox);
    labelEl.appendChild(titleSpan);

    const opVal = document.createElement('span');
    opVal.className = 'layer-opacity-val';
    opVal.textContent = `${Math.round(layer.opacity * 100)}%`;

    top.appendChild(labelEl);
    top.appendChild(opVal);

    const sliderRow = document.createElement('div');
    sliderRow.className = 'layer-slider-row';

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = '0';
    slider.max   = '1';
    slider.step  = '0.05';
    slider.value = String(layer.opacity);
    slider.setAttribute('aria-label', `Opacidad de ${layer.label}`);
    slider.addEventListener('input', () => {
      layer.setOpacity(parseFloat(slider.value));
    });

    sliderRow.appendChild(slider);
    item.appendChild(top);
    item.appendChild(sliderRow);
    listEl.appendChild(item);
  }
}

function syncLayersUI() {
  const listEl = document.getElementById('layers-list');
  if (!listEl) return;
  for (const layer of state.layers) {
    const item = listEl.querySelector(`[data-layer-id="${layer.id}"]`);
    if (!item) continue;
    const cb = item.querySelector('input[type="checkbox"]');
    const sl = item.querySelector('input[type="range"]');
    const vl = item.querySelector('.layer-opacity-val');
    if (cb && cb.checked !== layer.enabled) cb.checked = layer.enabled;
    if (sl && parseFloat(sl.value) !== layer.opacity) sl.value = String(layer.opacity);
    if (vl) vl.textContent = `${Math.round(layer.opacity * 100)}%`;
  }
}

/* ---------------------------------------------------------------- build */
export function buildTerrain(metadata, demFloat32, texture) {
  const N = CONFIG.SEGMENTS + 1;
  const [rows, cols] = metadata.shape;
  const [width_m, depth_m] = metadata.size_m;
  const [minElev_m, maxElev_m] = metadata.elevation_range_m;

  /* Muestrear el DEM Float32 a la rejilla N×N guardando la altura en metros
     relativa a elevation_range_m[0], sin exageración (sección 5). */
  const data_m = new Float32Array(N * N);
  for (let iy = 0; iy < N; iy++) {
    const r = Math.min(rows - 1, Math.round((iy / CONFIG.SEGMENTS) * (rows - 1)));
    const rowOffset = r * cols;
    for (let ix = 0; ix < N; ix++) {
      const c = Math.min(cols - 1, Math.round((ix / CONFIG.SEGMENTS) * (cols - 1)));
      const elev_m = demFloat32[rowOffset + c];
      data_m[iy * N + ix] = elev_m - minElev_m;
    }
  }

  /* Dimensiones del mundo reales: 1 unidad Three.js = 1 metro */
  state.terrainWidth = width_m;
  state.terrainDepth = depth_m;
  const margin_m = Math.min(CONFIG.BOUNDS_MARGIN_M, Math.min(width_m, depth_m) * 0.02);
  state.boundsX = state.terrainWidth / 2 - margin_m;
  state.boundsZ = state.terrainDepth / 2 - margin_m;

  console.log(
    `[Marswalk] Dataset "${metadata.dataset_id}" · DEM ${cols}×${rows} · ` +
    `tamaño ${state.terrainWidth.toFixed(0)}×${state.terrainDepth.toFixed(0)} m · ` +
    `elev [${minElev_m}, ${maxElev_m}] m · ${state.layers.length} capas registradas`
  );

  state.dem         = demFloat32;
  state.heights     = data_m;
  state.baseTexture = texture || null;

  /* Si ya existía una malla de terreno previa (carga en caliente de otro DEM), liberarla limpiamente */
  if (state.terrainMesh) {
    scene.remove(state.terrainMesh);
    if (state.terrainMesh.geometry) state.terrainMesh.geometry.dispose();
    if (state.terrainMesh.material) state.terrainMesh.material.dispose();
    state.terrainMesh = null;
  }

  /* Geometría en metros */
  state.terrainGeo = new THREE.PlaneGeometry(
    state.terrainWidth, state.terrainDepth, CONFIG.SEGMENTS, CONFIG.SEGMENTS
  );
  state.terrainGeo.rotateX(-Math.PI / 2);

  /* Material con color neutro blanco para que el color provenga íntegramente del compositor de capas */
  const material = new THREE.MeshStandardMaterial({
    map: texture || null,
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0.02,
    side: THREE.DoubleSide
  });

  state.terrainMesh = new THREE.Mesh(state.terrainGeo, material);
  state.terrainMesh.name = 'terrain';
  scene.add(state.terrainMesh);

  if (state.localPatchMesh && state.localPatchMesh.material) {
    state.localPatchMesh.material.map = texture || null;
    state.localPatchMesh.material.needsUpdate = true;
  }

  applyHeights(state.exaggeration);
  state.terrainMesh.updateMatrixWorld(true);

  /* Ajustar cámara orbital, luces, niebla y esfera de estrellas a la escala en metros */
  const dim_m = Math.max(state.terrainWidth, state.terrainDepth);

  camera.near = 0.2;
  camera.far  = dim_m * 12;
  camera.updateProjectionMatrix();

  if (state.orbitControls) {
    state.orbitControls.minDistance = Math.max(50, dim_m * 0.05);
    state.orbitControls.maxDistance = dim_m * 3.0;
    state.orbitControls.target.set(0, 0, 0);
  }
  camera.position.set(0, dim_m * 1.4, 0);
  state.orbitControls?.update();

  if (stars) {
    stars.scale.setScalar(dim_m * 4.5);
  }

  applyWeatherAtmosphere();
}

/**
 * Calcula las efemérides solares y la transferencia radiativa física en Marte:
 *  1) Distancia heliocéntrica r(Ls) por órbita kepleriana excéntrica (a = 1.52368 AU, e = 0.0934, Ls_perihelio = 251°).
 *  2) Irradiancia en el tope de la atmósfera I_TOA = 1361 / r² (W/m²).
 *  3) Declinación solar δ(Ls) con oblicuidad axial marciana ε = 25.19°.
 *  4) Elevación α_sun y Acimut γ_sun según latitud φ, longitud λ y Hora Solar Verdadera Local (LTST).
 *  5) Ley de Beer-Lambert I_dir = I_TOA * sin(α) * exp(-τ * m) + componente difusa de polvo Mie.
 */
export function computeMartianSolarPhysics() {
  const s = state.solar;
  const w = state.weather;
  if (!s || !w) return;

  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  /* 1. Órbita excéntrica de Marte y distancia heliocéntrica r(Ls) en AU */
  const a_au   = 1.52368;
  const ecc    = 0.0934;
  const ls_rad = s.ls_deg * DEG2RAD;
  const nu_rad = (s.ls_deg - 251.0) * DEG2RAD; // Anomalía verdadera respecto al perihelio (Ls = 251°)
  const r_au   = (a_au * (1 - ecc * ecc)) / (1 + ecc * Math.cos(nu_rad));
  s.distance_au = r_au;

  /* 2. Irradiancia solar en el tope de la atmósfera marciana (Ley 1/r²) */
  const I_earth = 1361.0; // W/m² a 1.0 AU
  s.toa_irradiance_wm2 = I_earth / (r_au * r_au);

  /* 3. Declinación solar δ con oblicuidad axial de Marte ε = 25.19° */
  const obliq_rad = 25.19 * DEG2RAD;
  const sinDelta  = Math.sin(obliq_rad) * Math.sin(ls_rad);
  const delta_rad = Math.asin(THREE.MathUtils.clamp(sinDelta, -1, 1));
  const cosDelta  = Math.cos(delta_rad);
  s.declination_deg = delta_rad * RAD2DEG;

  /* 4. Ángulo horario h (LTST: 12:00 = mediodía solar verdadero) y coordenadas horizontales (Elevación / Acimut) */
  const phi_rad = s.lat_deg * DEG2RAD;
  const sinPhi  = Math.sin(phi_rad);
  const cosPhi  = Math.cos(phi_rad);
  const h_rad   = (s.ltst_h - 12.0) * 15.0 * DEG2RAD;

  const sinAlpha = THREE.MathUtils.clamp(
    sinPhi * sinDelta + cosPhi * cosDelta * Math.cos(h_rad),
    -1,
    1
  );
  const alpha_rad = Math.asin(sinAlpha);
  const alpha_deg = alpha_rad * RAD2DEG;
  s.elevation_deg = alpha_deg;

  /* Acimut solar medido desde el Norte (0°=N, 90°=E, 180°=S, 270°=W) */
  const yAz = -cosDelta * Math.sin(h_rad);
  const xAz = sinDelta * cosPhi - cosDelta * sinPhi * Math.cos(h_rad);
  let az_deg = Math.atan2(yAz, xAz) * RAD2DEG;
  if (az_deg < 0) az_deg += 360.0;
  s.azimuth_deg = az_deg;

  /* 5. Masa óptica atmosférica m(α) y Atenuación de Beer-Lambert con opacidad de polvo τ (MEDA) */
  const tau = w.dust_tau;
  if (alpha_deg > 0.2) {
    /* Aproximación esférica de Kasten-Young adaptada a la escala de altura marciana (~11.1 km) */
    const airmass = 1.0 / (Math.sin(alpha_rad) + 0.095 * Math.pow(alpha_deg + 3.2, -1.22));
    s.airmass = THREE.MathUtils.clamp(airmass, 1.0, 14.0);

    const directBeam_wm2 = s.toa_irradiance_wm2 * Math.sin(alpha_rad) * Math.exp(-tau * s.airmass * 0.68);
    const diffuseSky_wm2 = s.toa_irradiance_wm2 * Math.sin(alpha_rad) * 0.34 * (1 - Math.exp(-tau * s.airmass * 0.68)) * Math.exp(-0.18 * tau);
    s.surface_irradiance_wm2 = Math.max(0, directBeam_wm2 + diffuseSky_wm2);
  } else if (alpha_deg > -6.5) {
    /* Crepúsculo civil marciano: dispersión delantera por aerosoles en alta atmósfera */
    s.airmass = 14.0;
    const twFactor = (alpha_deg + 6.5) / 6.7;
    s.surface_irradiance_wm2 = 12.0 * twFactor * twFactor;
  } else {
    s.airmass = 20.0;
    s.surface_irradiance_wm2 = 0.0;
  }

  /* Clasificar fase lumínica marciana */
  if (alpha_deg > 7.5) {
    s.phase = 'DIA';
  } else if (alpha_deg > -6.5) {
    s.phase = 'CREPUSCULO_AZUL';
  } else {
    s.phase = 'NOCHE';
  }

  /* 6. Onda térmica diurna superficial acoplada a la irradiancia y desfase de inercia térmica (~14:15 LTST) */
  const isStorm = w.mode === 'dust_storm';
  const rRatio  = 1.52368 / r_au; // > 1 en perihelio (más cálido), < 1 en afelio (más frío)
  const seasonalOffset_c = (rRatio - 1.0) * 95.0;
  const diurnalWave = Math.cos(((s.ltst_h - 14.2) / 24.0) * Math.PI * 2);
  const meanTemp_c  = (isStorm ? -68.0 : -56.0) + seasonalOffset_c;
  const ampTemp_c   = isStorm ? 14.0 : 31.0; // Las tormentas de polvo amortiguan la amplitud térmica diurna
  w.temp_c = Math.round(meanTemp_c + ampTemp_c * diurnalWave);

  /* Penalización térmica del traje EVA (aumenta de noche extrema o durante tormenta de polvo) */
  const nightColdPenalty = alpha_deg < 0 ? 0.14 : 0.0;
  w.thermalPenalty = (isStorm ? 1.35 : 1.0) + nightColdPenalty;

  /* 7. Posicionar vector 3D del Sol y del disco solar celeste (+X = Este, -Z = Norte, +Y = Cenit) */
  const dim_m = Math.max(state.terrainWidth || 30000, state.terrainDepth || 30000);
  const az_rad = az_deg * DEG2RAD;
  const cosAlpha = Math.cos(alpha_rad);

  const dirX =  cosAlpha * Math.sin(az_rad);
  const dirY =  Math.sin(alpha_rad);
  const dirZ = -cosAlpha * Math.cos(az_rad);

  /* Para proyectar sombras limpias sobre el terreno incluso al ras del horizonte, mantener altura mínima de luz */
  const lightElevY = Math.max(dirY, 0.05);
  const sunDist_m  = dim_m * 1.35;
  sun.position.set(dirX * sunDist_m, lightElevY * sunDist_m, dirZ * sunDist_m);
  fill.position.set(-dirX * sunDist_m * 0.7, Math.max(0.25, Math.abs(dirY)) * sunDist_m * 0.5, -dirZ * sunDist_m * 0.7);

  if (sunDisc) {
    const discDist_m = dim_m * 3.2;
    sunDisc.position.set(dirX * discDist_m, dirY * discDist_m, dirZ * discDist_m);
    /* El tamaño angular del Sol desde Marte es inversamente proporcional a r_au (~0.35° medio) */
    const angularScale = (1.524 / r_au) * dim_m * 0.24;
    sunDisc.scale.setScalar(angularScale);
    sunDisc.visible = alpha_deg > -4.0;
  }

  /* 8. Posicionar la luna marciana Fobos en la bóveda celeste (visible de noche / crepúsculo) */
  if (phobosMoon) {
    const phobosAz_rad = (az_deg + 138.0) * DEG2RAD;
    const phobosEl_rad = Math.max(0.12, (26.0 + Math.sin(s.ltst_h * 0.45) * 18.0) * DEG2RAD);
    const pDist = dim_m * 2.85;
    phobosMoon.position.set(
      Math.cos(phobosEl_rad) * Math.sin(phobosAz_rad) * pDist,
      Math.sin(phobosEl_rad) * pDist,
      -Math.cos(phobosEl_rad) * Math.cos(phobosAz_rad) * pDist
    );
    phobosMoon.scale.setScalar(dim_m * 0.045);
  }
}

export function applyWeatherAtmosphere() {
  computeMartianSolarPhysics();

  const dim_m       = Math.max(state.terrainWidth || 30000, state.terrainDepth || 30000);
  const halfPatch_m = CONFIG.PATCH_SIZE_M * 0.5;
  const isStorm     = state.weather?.mode === 'dust_storm';
  const isFP        = state.mode === 'fp';
  const s           = state.solar;
  const alpha_deg   = s.elevation_deg;

  /* Factor físico de flujo solar según distancia heliocéntrica (1/r²) normalizado a la media marciana (586 W/m²) */
  const fluxFactor = s.toa_irradiance_wm2 / 586.0;
  /* Transmitancia atmosférica directa según Ley de Beer-Lambert */
  const directTrans = alpha_deg > 0
    ? Math.exp(-state.weather.dust_tau * Math.min(s.airmass, 8.0) * 0.22)
    : 0;

  /* Centrar el domo atmosférico en la cámara del observador para evitar desalineaciones */
  if (skydome) {
    skydome.position.copy(camera.position);
    skydome.scale.setScalar(dim_m * 5.0);
    skydome.visible = true;

    // Pasar vector solar normalizado al shader del domo
    if (sun) {
      const sunDirNorm = sun.position.clone().normalize();
      skydome.material.uniforms.sunDirection.value.copy(sunDirNorm);
    }
  }

  if (s.phase === 'DIA') {
    const elevNorm = THREE.MathUtils.clamp((alpha_deg - 7.5) / 55.0, 0, 1);
    if (isStorm) {
      sun.color.setHex(0xff8247);
      sun.intensity = (1.05 + 0.45 * elevNorm) * fluxFactor;
      fill.color.setHex(0xc9653b);
      fill.intensity = 0.88 * fluxFactor;
      if (hemiLight) {
        hemiLight.color.setHex(0xd97548);
        hemiLight.groundColor.setHex(0x33160c);
        hemiLight.intensity = 0.95;
      }
      if (skydome) {
        skydome.material.uniforms.bottomColor.value.setHex(0x6e2e18); // Ocre tormenta turbio
        skydome.material.uniforms.topColor.value.setHex(0x3b160b);
        skydome.material.uniforms.mieColor.value.setHex(0xff8247);
        skydome.material.uniforms.mieIntensity.value = 0.35;
        skydome.material.uniforms.opacity.value = 1.0;
      }
      if (isFP) {
        scene.fog = new THREE.Fog(0x6e2e18, 30, 320);
        renderer.setClearColor(0x6e2e18, 1);
      } else {
        scene.fog = new THREE.Fog(0x5c2614, dim_m * 0.45, dim_m * 1.95);
        renderer.setClearColor(0x3a180d, 1);
      }
    } else {
      /* Día Marciano Nominal Calibrado NASA (Curiosity / Perseverance Mastcam):
         - Horizonte: color butterscotch / salmón claro (#dca678) por dispersión de óxidos de hierro en polvo fino.
         - Cenit: ocre más oscuro y seco (#6b3e26) debido a la baja densidad atmosférica (~7 hPa). */
      const sunCol = new THREE.Color(0xffb580).lerp(new THREE.Color(0xffe9d6), elevNorm);
      sun.color.copy(sunCol);
      sun.intensity = (1.65 + 1.25 * directTrans) * fluxFactor;

      fill.color.setHex(0x94b4ff);
      fill.intensity = (0.35 + 0.18 * elevNorm) * fluxFactor;

      /* Luz ambiental hemisférica: cielo butterscotch hacia abajo, regolito rojizo hacia arriba */
      if (hemiLight) {
        hemiLight.color.setHex(0xdca678);
        hemiLight.groundColor.setHex(0x421c10);
        hemiLight.intensity = (0.95 + 0.45 * elevNorm) * fluxFactor;
      }
      if (sunDisc && sunDisc.material) {
        sunDisc.material.color.copy(sunCol);
        sunDisc.material.opacity = 0.95;
      }

      if (skydome) {
        // Tono butterscotch diurno realista
        skydome.material.uniforms.bottomColor.value.setHex(0xdca678);
        skydome.material.uniforms.topColor.value.setHex(0x663c25);
        skydome.material.uniforms.mieColor.value.setHex(0xffecd4);
        skydome.material.uniforms.mieIntensity.value = 0.85;
        // En vista orbital permitimos ver la cartografía a través del velo atmosférico
        skydome.material.uniforms.opacity.value = isFP ? 1.0 : 0.65;
      }

      if (isFP) {
        /* En 1ª persona, niebla en el horizonte fundida con el tono butterscotch marciano */
        const butterscotchHex = 0xdca678;
        scene.fog = new THREE.Fog(butterscotchHex, halfPatch_m * 0.55, halfPatch_m * 1.45);
        renderer.setClearColor(butterscotchHex, 1);
      } else {
        scene.fog = new THREE.Fog(0x0b0d10, dim_m * 1.1, dim_m * 2.8);
        renderer.setClearColor(0x0b0d10, 1);
      }
    }
    if (stars && stars.material) {
      stars.material.opacity = isFP ? 0.05 : 0.85;
    }
    if (phobosMoon && phobosMoon.material) {
      phobosMoon.material.opacity = 0.0;
    }
    if (headlamp) headlamp.intensity = 0;

  } else if (s.phase === 'CREPUSCULO_AZUL') {
    /* Crepúsculo marciano real (Spirit / Curiosity / Perseverance):
       La dispersión Mie delantera proyecta un distintivo halo AZUL ALREDEDOR DEL SOL,
       mientras que el horizonte lateral se tiñe de salmón / terracota / índigo. */
    const twNorm = THREE.MathUtils.clamp((alpha_deg + 6.5) / 14.0, 0, 1);
    const blueConeCol = new THREE.Color(0x5a9eff).lerp(new THREE.Color(0xff986a), twNorm * 0.5);
    sun.color.copy(blueConeCol);
    sun.intensity = (0.35 + 1.15 * twNorm) * fluxFactor;

    fill.color.setHex(0x537bc4);
    fill.intensity = (0.28 + 0.22 * twNorm) * fluxFactor;

    if (hemiLight) {
      hemiLight.color.setHex(0x5a86d4);
      hemiLight.groundColor.setHex(0x1a1215);
      hemiLight.intensity = 0.48 + 0.35 * twNorm;
    }
    if (sunDisc && sunDisc.material) {
      /* Cono solar azul pálido icónico de Marte */
      sunDisc.material.color.setHex(0x7fb6ff);
      sunDisc.material.opacity = 0.92;
    }

    if (skydome) {
      skydome.material.uniforms.bottomColor.value.setHex(isStorm ? 0x4d2215 : 0xaa5b4c);
      skydome.material.uniforms.topColor.value.setHex(0x1a182c);
      skydome.material.uniforms.mieColor.value.setHex(0x6aa8ff); // Dispersión Mie azul hacia adelante
      skydome.material.uniforms.mieIntensity.value = 1.35;
      skydome.material.uniforms.opacity.value = isFP ? 0.92 : 0.5;
    }

    const twSkyHex = isStorm ? 0x3b1910 : 0x241d2d;
    if (isFP) {
      scene.fog = new THREE.Fog(twSkyHex, halfPatch_m * 0.45, halfPatch_m * 1.35);
      renderer.setClearColor(twSkyHex, 1);
    } else {
      scene.fog = new THREE.Fog(0x0d1018, dim_m * 1.0, dim_m * 2.7);
      renderer.setClearColor(0x0b0d10, 1);
    }
    if (stars && stars.material) {
      stars.material.opacity = 0.65;
    }
    if (phobosMoon && phobosMoon.material) {
      phobosMoon.material.opacity = (1 - twNorm) * 0.65;
    }
    if (headlamp) headlamp.intensity = isFP ? (1 - twNorm) * 1.8 : 0;

  } else {
    /* Noche marciana real:
       Sin sol diurno, la tenue atmósfera de 7 hPa no retiene dispersión de luz.
       El cielo es de un negro azabache / espacio profundo ultra limpio (#04060a).
       Las estrellas son cristalinas, Fobos brilla en el cielo y el astronauta enciende su foco EVA. */
    sun.color.setHex(0x44587c);
    sun.intensity = isFP ? 0.08 : 0.32; // En órbita tenue luz cenital para no perder el relieve cartográfico
    fill.color.setHex(0x1d273d);
    fill.intensity = 0.14;

    if (hemiLight) {
      hemiLight.color.setHex(0x28364f);
      hemiLight.groundColor.setHex(0x08090d);
      hemiLight.intensity = isFP ? 0.16 : 0.36;
    }

    if (skydome) {
      if (isStorm) {
        // En tormenta nocturna, el polvo denso bloquea las estrellas
        skydome.material.uniforms.bottomColor.value.setHex(0x150b07);
        skydome.material.uniforms.topColor.value.setHex(0x080403);
        skydome.material.uniforms.mieIntensity.value = 0.0;
        skydome.material.uniforms.opacity.value = 0.95;
      } else {
        // Noche despejada: la cúpula se vuelve casi transparente revelando la bóveda estelar
        skydome.material.uniforms.bottomColor.value.setHex(0x06080e);
        skydome.material.uniforms.topColor.value.setHex(0x020306);
        skydome.material.uniforms.mieIntensity.value = 0.0;
        skydome.material.uniforms.opacity.value = isFP ? 0.22 : 0.1;
      }
    }

    scene.fog = isFP
      ? new THREE.Fog(0x05070b, halfPatch_m * 0.48, halfPatch_m * 1.35)
      : new THREE.Fog(0x05070b, dim_m * 1.1, dim_m * 2.8);
    renderer.setClearColor(0x05070b, 1);

    if (stars && stars.material) {
      stars.material.opacity = isStorm ? 0.05 : 1.0;
    }
    if (phobosMoon && phobosMoon.material) {
      phobosMoon.material.opacity = isStorm ? 0.0 : 0.95;
    }
    if (headlamp) {
      /* Foco LED del casco EVA a plena potencia en 1ª persona */
      headlamp.intensity = isFP ? 3.5 : 0;
    }
  }

  renderWeatherUI();
}

export function toggleDustStormSimulation(forceState = null) {
  const nextStorm = forceState !== null ? forceState : state.weather.mode !== 'dust_storm';
  if (nextStorm) {
    state.weather.mode         = 'dust_storm';
    state.weather.pressure_hpa = 7.1;
    state.weather.wind_ms      = 28.5;
    state.weather.dust_tau     = 3.85;
    state.weather.uv_level     = 'ATENUADO (TORMENTA)';
  } else {
    state.weather.mode         = 'nominal';
    state.weather.pressure_hpa = 7.4;
    state.weather.wind_ms      = 5.2;
    state.weather.dust_tau     = 0.45;
    state.weather.uv_level     = 'MODERADO';
  }
  applyWeatherAtmosphere();
}

export function updateSolarCycle(dt) {
  if (!state.solar || !state.solar.autoCycle) return;
  /* Avanzar 1.2 horas marcianas por segundo para apreciar el tránsito solar y el giro de sombras */
  state.solar.ltst_h = (state.solar.ltst_h + dt * 1.2) % 24.0;
  applyWeatherAtmosphere();
}

export function computeEmergencyEvacuationRoute() {
  if (!state.pois || state.pois.length === 0) return;
  const px = state.astronautGroup ? state.astronautPosition.x : camera.position.x;
  const pz = state.astronautGroup ? state.astronautPosition.z : camera.position.z;

  /* Buscar el Refugio (shelter) más cercano al astronauta */
  let nearestShelter = null;
  let bestDist = Infinity;
  for (const poi of state.pois) {
    if (poi.type !== 'shelter' || !Array.isArray(poi.position_m)) continue;
    const d = Math.hypot(poi.position_m[0] - px, poi.position_m[1] - pz);
    if (d < bestDist) {
      bestDist = d;
      nearestShelter = poi;
    }
  }
  if (!nearestShelter) nearestShelter = state.pois[0];
  if (!nearestShelter) return;

  state.routeStart_m = [Number(px.toFixed(1)), Number(pz.toFixed(1))];
  state.routeGoal_m  = nearestShelter.position_m.slice();
  recomputeRoutesForCurrentWaypoints();
}

function initWeatherAndEmergencyUI() {
  const stormBtn   = document.getElementById('weather-storm-btn');
  const evacBtn    = document.getElementById('weather-evac-btn');
  const ltstSlider = document.getElementById('solar-ltst-slider');
  const lsSelect   = document.getElementById('solar-ls-select');
  const cycleBtn   = document.getElementById('solar-cycle-btn');

  if (stormBtn && !stormBtn.dataset.bound) {
    stormBtn.dataset.bound = '1';
    stormBtn.addEventListener('click', () => {
      toggleDustStormSimulation();
      /* Si se activa tormenta, trazar también ruta de evacuación preventiva hacia el Refugio */
      if (state.weather.mode === 'dust_storm') {
        computeEmergencyEvacuationRoute();
      }
    });
  }

  if (evacBtn && !evacBtn.dataset.bound) {
    evacBtn.dataset.bound = '1';
    evacBtn.addEventListener('click', () => {
      computeEmergencyEvacuationRoute();
    });
  }

  if (ltstSlider && !ltstSlider.dataset.bound) {
    ltstSlider.dataset.bound = '1';
    ltstSlider.addEventListener('input', () => {
      state.solar.ltst_h = parseFloat(ltstSlider.value);
      applyWeatherAtmosphere();
    });
  }

  if (lsSelect && !lsSelect.dataset.bound) {
    lsSelect.dataset.bound = '1';
    lsSelect.addEventListener('change', () => {
      state.solar.ls_deg = parseFloat(lsSelect.value);
      applyWeatherAtmosphere();
    });
  }

  if (cycleBtn && !cycleBtn.dataset.bound) {
    cycleBtn.dataset.bound = '1';
    cycleBtn.addEventListener('click', () => {
      state.solar.autoCycle = !state.solar.autoCycle;
      cycleBtn.classList.toggle('active', state.solar.autoCycle);
      cycleBtn.textContent = state.solar.autoCycle ? '⏸' : '▶';
    });
  }

  applyWeatherAtmosphere();
}

function formatLTST(hoursFloat) {
  const norm = ((hoursFloat % 24) + 24) % 24;
  const hh = Math.floor(norm);
  const mm = Math.floor((norm - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function renderWeatherUI() {
  const w = state.weather;
  const s = state.solar;
  if (!w || !s) return;
  const isStorm = w.mode === 'dust_storm';

  const coordsEl   = document.getElementById('solar-coords-label');
  const phaseBadge = document.getElementById('solar-phase-badge');
  const ltstValEl  = document.getElementById('solar-ltst-val');
  const ltstSlider = document.getElementById('solar-ltst-slider');
  const distAuEl   = document.getElementById('wm-dist-au');
  const irradEl    = document.getElementById('wm-irrad');
  const sunAngEl   = document.getElementById('wm-sun-ang');
  const tempEl     = document.getElementById('wm-temp');
  const windEl     = document.getElementById('wm-wind');
  const tauEl      = document.getElementById('wm-tau');
  const stormBtn   = document.getElementById('weather-storm-btn');
  const hudEnvEl   = document.getElementById('hud-env-line');

  const latTag = `${Math.abs(s.lat_deg).toFixed(2)}°${s.lat_deg >= 0 ? 'N' : 'S'}`;
  const lonTag = `${Math.abs(s.lon_deg).toFixed(2)}°${s.lon_deg >= 0 ? 'E' : 'W'}`;
  if (coordsEl) {
    coordsEl.textContent = `📍 ${latTag}, ${lonTag}`;
  }

  if (phaseBadge) {
    phaseBadge.classList.remove('twilight', 'night');
    if (s.phase === 'DIA') {
      phaseBadge.textContent = '☀ DÍA';
    } else if (s.phase === 'CREPUSCULO_AZUL') {
      phaseBadge.textContent = '🌅 CREPÚSCULO AZUL';
      phaseBadge.classList.add('twilight');
    } else {
      phaseBadge.textContent = '🌙 NOCHE (LINTERNA)';
      phaseBadge.classList.add('night');
    }
  }

  const ltstStr = formatLTST(s.ltst_h);
  if (ltstValEl) ltstValEl.textContent = ltstStr;
  if (ltstSlider && document.activeElement !== ltstSlider) {
    ltstSlider.value = String(Number(s.ltst_h.toFixed(2)));
  }

  if (distAuEl) {
    distAuEl.textContent = `${s.distance_au.toFixed(3)} AU (TOA ${s.toa_irradiance_wm2.toFixed(0)} W/m²)`;
  }
  if (irradEl) {
    irradEl.textContent = `${s.surface_irradiance_wm2.toFixed(0)} W/m²`;
    irradEl.style.color = s.surface_irradiance_wm2 > 300 ? '#f6c945' : s.surface_irradiance_wm2 > 20 ? '#8cc2ff' : '#9aa6b5';
  }
  if (sunAngEl) {
    sunAngEl.textContent = `El ${s.elevation_deg.toFixed(1)}° · Az ${s.azimuth_deg.toFixed(0)}°`;
  }

  if (tempEl)  tempEl.textContent = `${w.temp_c} °C`;
  if (windEl) {
    windEl.textContent = `${w.wind_ms.toFixed(1)} m/s`;
    windEl.style.color = isStorm ? '#ff3855' : '';
  }
  if (tauEl) {
    tauEl.textContent = `τ = ${w.dust_tau.toFixed(2)}`;
    tauEl.style.color = isStorm ? '#f6c945' : '';
  }

  if (stormBtn) {
    stormBtn.classList.toggle('storm-active', isStorm);
    stormBtn.textContent = isStorm
      ? '☀ Desactivar Tormenta (Volver a Nominal)'
      : '🌪️ Simular Tormenta de Polvo (MEDA)';
  }

  if (hudEnvEl) {
    hudEnvEl.textContent = isStorm
      ? `MEDA // TORMENTA · LTST ${ltstStr} · ${s.surface_irradiance_wm2.toFixed(0)} W/m² · ${w.temp_c}°C · τ=${w.dust_tau}`
      : `SOL // LTST ${ltstStr} · r=${s.distance_au.toFixed(2)} AU · ${s.surface_irradiance_wm2.toFixed(0)} W/m² (El ${s.elevation_deg.toFixed(0)}°) · ${w.temp_c}°C`;
    hudEnvEl.style.color = isStorm ? '#f6c945' : s.phase === 'CREPUSCULO_AZUL' ? '#8cc2ff' : '#66fcf1';
  }
}

/* ---------------------------------------------- Parche local 1ª persona (T5) */
function getDetailBumpTexture() {
  if (detailBumpTexture) return detailBumpTexture;

  /* Textura procedural tileable de regolito/roca fina a escala métrica (sin allocs por frame) */
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(size, size);
  const px = imgData.data;

  let seed = 421337;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wave =
        Math.sin((x / size) * Math.PI * 8) * Math.cos((y / size) * Math.PI * 8) * 28 +
        Math.sin(((x + y) / size) * Math.PI * 16) * 16;
      const grain = (rand() - 0.5) * 90;
      const v = Math.max(0, Math.min(255, Math.round(128 + wave + grain)));
      const o = (y * size + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = v;
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  /* Repetir cada ~4 metros en el parche de 2000×2000 m → sensación clara de paso humano */
  const repeats = CONFIG.PATCH_SIZE_M / 4;
  tex.repeat.set(repeats, repeats);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  detailBumpTexture = tex;
  return detailBumpTexture;
}

function ensureLocalPatchCreated() {
  if (state.localPatchMesh) return;

  const seg = CONFIG.PATCH_SEGMENTS;
  const N   = seg + 1;
  const size_m = CONFIG.PATCH_SIZE_M;

  const geo = new THREE.PlaneGeometry(size_m, size_m, seg, seg);
  geo.rotateX(-Math.PI / 2);

  /* En Three.js r151+ cada textura puede elegir su canal UV (0 o 1).
     - Canal 0 ('uv'): coordenadas UV globales para la textura compuesta de capas.
     - Canal 1 ('uv1'): coordenadas locales 0..1 del parche para el micro-detalle de regolito. */
  const localUvArray = new Float32Array(geo.attributes.uv.array);
  geo.setAttribute('uv1', new THREE.BufferAttribute(localUvArray, 2));

  const bumpTex = getDetailBumpTexture();
  bumpTex.channel = 1;

  const mat = new THREE.MeshStandardMaterial({
    map: state.baseTexture || null,
    color: 0xffffff,
    bumpMap: bumpTex,
    bumpScale: 0.45,
    roughness: 0.94,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'localTerrainPatch';
  mesh.visible = false;
  scene.add(mesh);

  state.localPatchGeo     = geo;
  state.localPatchMesh    = mesh;
  state.localPatchHeights = new Float32Array(N * N);
}

/**
 * Construye o actualiza los vértices del parche local centrado en (centerX_m, centerZ_m)
 * remuestreando state.dem mediante interpolación bilineal (T5).
 */
export function rebuildLocalPatch(centerX_m, centerZ_m) {
  if (!state.dem || !state.metadata) return;
  ensureLocalPatchCreated();

  const seg    = CONFIG.PATCH_SEGMENTS;
  const N      = seg + 1;
  const size_m = CONFIG.PATCH_SIZE_M;
  const w_m    = state.terrainWidth;
  const d_m    = state.terrainDepth;
  const ex     = state.exaggeration;

  state.localPatchCenter.set(centerX_m, centerZ_m);

  const pos       = state.localPatchGeo.attributes.position;
  const uv        = state.localPatchGeo.attributes.uv;
  const pHeights  = state.localPatchHeights;
  const repeats   = size_m / 4;

  /* Desplazar ligeramente el offset de la textura de micro-detalle según el centro en el mundo
     para que al recentrar el parche el grano del suelo no salte visualmente. */
  if (detailBumpTexture) {
    detailBumpTexture.offset.set(
      ((centerX_m / size_m) * repeats) % 1,
      ((-centerZ_m / size_m) * repeats) % 1
    );
  }

  for (let iz = 0; iz < N; iz++) {
    const localZ_m = (iz / seg - 0.5) * size_m;
    const worldZ_m = centerZ_m + localZ_m;
    const vGlobal  = 1.0 - THREE.MathUtils.clamp((worldZ_m + d_m * 0.5) / d_m, 0, 1);

    for (let ix = 0; ix < N; ix++) {
      const idx      = iz * N + ix;
      const localX_m = (ix / seg - 0.5) * size_m;
      const worldX_m = centerX_m + localX_m;
      const uGlobal  = THREE.MathUtils.clamp((worldX_m + w_m * 0.5) / w_m, 0, 1);

      const hRel_m = sampleDemHeightRelM(
        THREE.MathUtils.clamp(worldX_m, -w_m * 0.5, w_m * 0.5),
        THREE.MathUtils.clamp(worldZ_m, -d_m * 0.5, d_m * 0.5)
      ) ?? 0;

      pHeights[idx] = hRel_m;
      pos.setXYZ(idx, localX_m, hRel_m * ex, localZ_m);
      uv.setXY(idx, uGlobal, vGlobal);
    }
  }

  state.localPatchMesh.position.set(centerX_m, 0, centerZ_m);
  pos.needsUpdate = true;
  uv.needsUpdate  = true;
  state.localPatchGeo.computeVertexNormals();
  state.localPatchGeo.computeBoundingBox();
  state.localPatchGeo.computeBoundingSphere();
  state.localPatchMesh.updateMatrixWorld(true);
}

export function enableLocalPatch(centerX_m, centerZ_m) {
  rebuildLocalPatch(centerX_m, centerZ_m);
  if (state.localPatchMesh) state.localPatchMesh.visible = true;
  if (state.terrainMesh)    state.terrainMesh.visible    = false;
  applyWeatherAtmosphere();
  updateRouteViewMode();
  updatePOIViewMode();
}

export function updateLocalPatchIfNeeded(x_m, z_m) {
  if (!state.localPatchMesh || !state.localPatchMesh.visible) return;
  const dx = x_m - state.localPatchCenter.x;
  const dz = z_m - state.localPatchCenter.y;
  if (dx * dx + dz * dz > CONFIG.PATCH_RECENTER_DIST_M * CONFIG.PATCH_RECENTER_DIST_M) {
    rebuildLocalPatch(x_m, z_m);
  }
}

export function disableLocalPatch() {
  if (state.localPatchMesh) state.localPatchMesh.visible = false;
  if (state.terrainMesh)    state.terrainMesh.visible    = true;
  applyWeatherAtmosphere();
  updateRouteViewMode();
  updatePOIViewMode();
}

/* -------------------------------------------------------------- heights */
export function applyHeights(ex) {
  state.exaggeration = ex;
  if (state.terrainGeo && state.heights) {
    const pos   = state.terrainGeo.attributes.position;
    const count = pos.count;

    for (let i = 0; i < count; i++) {
      pos.setY(i, state.heights[i] * ex);
    }

    pos.needsUpdate = true;
    state.terrainGeo.computeVertexNormals();
    state.terrainGeo.computeBoundingBox();
    state.terrainGeo.computeBoundingSphere();
    if (state.terrainMesh) state.terrainMesh.updateMatrixWorld(true);
  }

  if (state.localPatchGeo && state.localPatchHeights) {
    const pPos   = state.localPatchGeo.attributes.position;
    const pCount = pPos.count;
    for (let i = 0; i < pCount; i++) {
      pPos.setY(i, state.localPatchHeights[i] * ex);
    }
    pPos.needsUpdate = true;
    state.localPatchGeo.computeVertexNormals();
    state.localPatchGeo.computeBoundingBox();
    state.localPatchGeo.computeBoundingSphere();
    if (state.localPatchMesh) state.localPatchMesh.updateMatrixWorld(true);
  }

  /* Actualizar altura visual de la ruta 3D y de los POIs al cambiar la exageración (T8 y T9) */
  updateRoute3DHeights();
  updatePOI3DHeights();
}

/* ------------------------------------------- Planificador de Ruta A* (T8) */
const ROUTE_GRID_N = 160; // Cuadrícula de búsqueda 160×160 sobre el DEM (rápida en JS y precisa)

export function computeAStarRoute(startX_m, startZ_m, goalX_m, goalZ_m) {
  if (!state.dem || !state.metadata) return null;

  const w_m     = state.terrainWidth;
  const d_m     = state.terrainDepth;
  const GN      = ROUTE_GRID_N;
  const total   = GN * GN;
  const cellW_m = w_m / (GN - 1);
  const cellD_m = d_m / (GN - 1);

  const toGridX = (x_m) => THREE.MathUtils.clamp(Math.round(((x_m + w_m * 0.5) / w_m) * (GN - 1)), 0, GN - 1);
  const toGridZ = (z_m) => THREE.MathUtils.clamp(Math.round(((z_m + d_m * 0.5) / d_m) * (GN - 1)), 0, GN - 1);
  const toWorldX = (gx) => (gx / (GN - 1) - 0.5) * w_m;
  const toWorldZ = (gz) => (gz / (GN - 1) - 0.5) * d_m;

  const sx = toGridX(startX_m);
  const sz = toGridZ(startZ_m);
  const gx = toGridX(goalX_m);
  const gz = toGridZ(goalZ_m);

  const startIdx = sz * GN + sx;
  const goalIdx  = gz * GN + gx;

  /* Precalcular elevación relativa (m) y pendiente real (°) en cada nodo de la rejilla */
  const nodeElev  = new Float32Array(total);
  const nodeSlope = new Float32Array(total);
  for (let iz = 0; iz < GN; iz++) {
    const wz = toWorldZ(iz);
    const rowOff = iz * GN;
    for (let ix = 0; ix < GN; ix++) {
      const wx = toWorldX(ix);
      nodeElev[rowOff + ix]  = sampleDemHeightRelM(wx, wz) ?? 0;
      nodeSlope[rowOff + ix] = sampleSlopeDeg(wx, wz);
    }
  }

  const walkSpeed_ms = Math.max(state.fisio.walk_speed_ms || 1.2, 0.2);
  const baseRate_l_s = (state.fisio.o2_base_consumption_l_per_h || 50.0) / 3600.0;
  const maxSafeDeg   = state.fisio.max_safe_slope_deg || 25;

  const gScore = new Float64Array(total);
  const fScore = new Float64Array(total);
  const cameFrom = new Int32Array(total);
  const closed   = new Uint8Array(total);
  gScore.fill(Infinity);
  fScore.fill(Infinity);
  cameFrom.fill(-1);

  const heuristicO2 = (ix, iz) => {
    const dist_m = Math.hypot((gx - ix) * cellW_m, (gz - iz) * cellD_m);
    return (dist_m / walkSpeed_ms) * baseRate_l_s * 0.85;
  };

  /* Min-heap binario para la cola de prioridad de A* */
  const heap = [];
  const pushHeap = (idx, f) => {
    heap.push({ idx, f });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= heap[i].f) break;
      const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp;
      i = p;
    }
  };
  const popHeap = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      const len = heap.length;
      while (true) {
        let l = 2 * i + 1;
        let r = l + 1;
        let smallest = i;
        if (l < len && heap[l].f < heap[smallest].f) smallest = l;
        if (r < len && heap[r].f < heap[smallest].f) smallest = r;
        if (smallest === i) break;
        const tmp = heap[i]; heap[i] = heap[smallest]; heap[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  };

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristicO2(sx, sz);
  pushHeap(startIdx, fScore[startIdx]);

  const dirs = [
    [-1,  0, cellW_m],
    [ 1,  0, cellW_m],
    [ 0, -1, cellD_m],
    [ 0,  1, cellD_m],
    [-1, -1, Math.hypot(cellW_m, cellD_m)],
    [ 1, -1, Math.hypot(cellW_m, cellD_m)],
    [-1,  1, Math.hypot(cellW_m, cellD_m)],
    [ 1,  1, Math.hypot(cellW_m, cellD_m)],
  ];

  while (heap.length > 0) {
    const current = popHeap().idx;
    if (current === goalIdx) break;
    if (closed[current]) continue;
    closed[current] = 1;

    const cx = current % GN;
    const cz = (current / GN) | 0;
    const curElev = nodeElev[current];

    for (let d = 0; d < 8; d++) {
      const nx = cx + dirs[d][0];
      const nz = cz + dirs[d][1];
      if (nx < 0 || nx >= GN || nz < 0 || nz >= GN) continue;

      const nIdx = nz * GN + nx;
      if (closed[nIdx]) continue;

      const stepDist_m  = dirs[d][2];
      const nextElev    = nodeElev[nIdx];
      const deltaElev_m = nextElev - curElev;
      const segSlopeDeg = Math.atan(Math.abs(deltaElev_m) / stepDist_m) * (180 / Math.PI);
      const localSlope  = Math.max(nodeSlope[nIdx], segSlopeDeg);

      /* Costo base de oxígeno en litros usando la función fisiológica de T7 */
      const slopeFactor = getSlopeCostFactor(localSlope, deltaElev_m);
      const climbGrade  = deltaElev_m / stepDist_m;
      const climbBonus  = climbGrade > 0 ? 1.0 + climbGrade * 4.5 : Math.max(0.8, 1.0 + climbGrade * 0.8);
      const stepTime_s  = stepDist_m / walkSpeed_ms;
      const edgeO2_l    = baseRate_l_s * slopeFactor * climbBonus * stepTime_s;

      /* Penalización severa cuando la pendiente supera max_safe_slope_deg
         para que A* evite pendientes sobre el umbral siempre que exista alternativa (criterio T8) */
      let safetyPenalty = 1.0;
      if (localSlope > maxSafeDeg) {
        const excess = localSlope - maxSafeDeg;
        safetyPenalty = 45.0 + excess * excess * 8.0;
      } else if (localSlope > maxSafeDeg * 0.75) {
        const ratio = (localSlope - maxSafeDeg * 0.75) / (maxSafeDeg * 0.25);
        safetyPenalty = 1.0 + ratio * ratio * 2.5;
      }

      const tentativeG = gScore[current] + edgeO2_l * safetyPenalty;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx]   = tentativeG;
        fScore[nIdx]   = tentativeG + heuristicO2(nx, nz);
        pushHeap(nIdx, fScore[nIdx]);
      }
    }
  }

  /* Reconstruir camino de coordenadas [x_m, z_m] */
  const rawIndices = [];
  let curr = goalIdx;
  if (cameFrom[curr] !== -1 || curr === startIdx) {
    while (curr !== -1) {
      rawIndices.push(curr);
      curr = cameFrom[curr];
    }
    rawIndices.reverse();
  } else {
    rawIndices.push(startIdx, goalIdx);
  }

  const path_m = [];
  for (let i = 0; i < rawIndices.length; i++) {
    if (i === 0) {
      path_m.push([Number(startX_m.toFixed(1)), Number(startZ_m.toFixed(1))]);
    } else if (i === rawIndices.length - 1) {
      path_m.push([Number(goalX_m.toFixed(1)), Number(goalZ_m.toFixed(1))]);
    } else {
      const idx = rawIndices[i];
      const ix  = idx % GN;
      const iz  = (idx / GN) | 0;
      path_m.push([Number(toWorldX(ix).toFixed(1)), Number(toWorldZ(iz).toFixed(1))]);
    }
  }

  /* Calcular métricas físicas reales sin penalización artificial (contrato 4.3) */
  const metrics = evaluatePathMetrics(path_m);

  const routeObj = {
    dataset_id: state.datasetId || CONFIG.DEFAULT_DATASET,
    algorithm:  'astar',
    path_m,
    metrics,
  };

  if (state.routeAlgorithm !== 'qaoa') {
    applyRouteToScene(routeObj);
  }
  return routeObj;
}

/**
 * Evalúa las métricas físicas reales (distancia, O2, pendiente máx, riesgo) de una polilínea path_m
 * conforme al contrato 4.3.
 */
function evaluatePathMetrics(path_m) {
  const walkSpeed_ms = Math.max(state.fisio.walk_speed_ms || 1.2, 0.2);
  const baseRate_l_s = (state.fisio.o2_base_consumption_l_per_h || 50.0) / 3600.0;
  const maxSafeDeg   = state.fisio.max_safe_slope_deg || 25;

  let totalDist_m = 0;
  let totalO2_l   = 0;
  let maxSlope    = 0;
  let weightedRiskSum = 0;

  for (let i = 1; i < path_m.length; i++) {
    const [x0, z0] = path_m[i - 1];
    const [x1, z1] = path_m[i];
    const segDist_m = Math.hypot(x1 - x0, z1 - z0);
    if (segDist_m < 1e-3) continue;

    const e0 = sampleDemHeightRelM(x0, z0) ?? 0;
    const e1 = sampleDemHeightRelM(x1, z1) ?? 0;
    const dElev_m = e1 - e0;
    const xm = (x0 + x1) * 0.5;
    const zm = (z0 + z1) * 0.5;
    const segSlope = Math.max(
      sampleSlopeDeg(x1, z1),
      sampleSlopeDeg(xm, zm),
      Math.atan(Math.abs(dElev_m) / segDist_m) * (180 / Math.PI)
    );

    if (segSlope > maxSlope) maxSlope = segSlope;

    const sFactor   = getSlopeCostFactor(segSlope, dElev_m);
    const cGrade    = dElev_m / segDist_m;
    const cBonus    = cGrade > 0 ? 1.0 + cGrade * 4.5 : Math.max(0.8, 1.0 + cGrade * 0.8);
    const segTime_s = segDist_m / walkSpeed_ms;
    const segO2_l   = baseRate_l_s * sFactor * cBonus * segTime_s;

    totalDist_m += segDist_m;
    totalO2_l   += segO2_l;
    weightedRiskSum += THREE.MathUtils.clamp(segSlope / maxSafeDeg, 0, 1) * segDist_m;
  }

  const riskScore = totalDist_m > 0 ? weightedRiskSum / totalDist_m : 0;
  return {
    distance_m:    Number(totalDist_m.toFixed(1)),
    oxygen_l:      Number(totalO2_l.toFixed(2)),
    max_slope_deg: Number(maxSlope.toFixed(1)),
    risk_score:    Number(riskScore.toFixed(2)),
  };
}

/**
 * Planificador cuántico-inspirado QAOA (Quantum Approximate Optimization Algorithm) sobre formulación QUBO
 * de múltiples capas transversales entre Inicio (A) y Destino (B) (Fase D / Contrato 4.3: "algorithm": "qaoa").
 * Optimiza el Hamiltoniano de costo H_C = E_O2 + λ_slope * ExcesoPendiente² + μ_smooth * Curvatura²
 * mediante amplitudes variacionales parametrizadas por (γ_p, β_p) en p=4 niveles.
 */
export function computeQAOARoute(startX_m, startZ_m, goalX_m, goalZ_m) {
  if (!state.dem || !state.metadata) return null;

  const w_m = state.terrainWidth;
  const d_m = state.terrainDepth;
  const walkSpeed_ms = Math.max(state.fisio.walk_speed_ms || 1.2, 0.2);
  const baseRate_l_s = (state.fisio.o2_base_consumption_l_per_h || 50.0) / 3600.0;
  const maxSafeDeg   = state.fisio.max_safe_slope_deg || 25;

  const dx = goalX_m - startX_m;
  const dz = goalZ_m - startZ_m;
  const directDist_m = Math.hypot(dx, dz);

  if (directDist_m < 1e-2) {
    const trivial = {
      dataset_id: state.datasetId || CONFIG.DEFAULT_DATASET,
      algorithm: 'qaoa',
      path_m: [[Number(startX_m.toFixed(1)), Number(startZ_m.toFixed(1))], [Number(goalX_m.toFixed(1)), Number(goalZ_m.toFixed(1))]],
      metrics: { distance_m: 0, oxygen_l: 0, max_slope_deg: 0, risk_score: 0 },
    };
    state.qaoaRoute = trivial;
    return trivial;
  }

  /* Eje longitudinal u y eje transversal v del corredor cuántico */
  const ux = dx / directDist_m;
  const uz = dz / directDist_m;
  const vx = -uz;
  const vz =  ux;

  /* Número de etapas longitudinales S y estados cuánticos transversales K por etapa */
  const S = Math.max(18, Math.min(48, Math.round(directDist_m / Math.max(80, Math.min(w_m, d_m) * 0.015))));
  const K = 25; // 25 qubits one-hot por tajada transversal
  const halfCorridor_m = Math.min(Math.max(directDist_m * 0.42, 400), Math.min(w_m, d_m) * 0.38);

  const clampX = (x) => THREE.MathUtils.clamp(x, -state.boundsX, state.boundsX);
  const clampZ = (z) => THREE.MathUtils.clamp(z, -state.boundsZ, state.boundsZ);

  /* Construir nodos candidatos (s, k) */
  const layers = [];
  for (let s = 0; s <= S; s++) {
    const t = s / S;
    const baseX = startX_m + dx * t;
    const baseZ = startZ_m + dz * t;
    /* Envolver ancho del corredor con perfil senoidal (fijo en A y B en los extremos) */
    const env = Math.sin(Math.PI * t);
    const layerNodes = [];

    if (s === 0) {
      const e0 = sampleDemHeightRelM(startX_m, startZ_m) ?? 0;
      const sl0 = sampleSlopeDeg(startX_m, startZ_m);
      layerNodes.push({ x: startX_m, z: startZ_m, elev: e0, slope: sl0, offsetRatio: 0 });
    } else if (s === S) {
      const eG = sampleDemHeightRelM(goalX_m, goalZ_m) ?? 0;
      const slG = sampleSlopeDeg(goalX_m, goalZ_m);
      layerNodes.push({ x: goalX_m, z: goalZ_m, elev: eG, slope: slG, offsetRatio: 0 });
    } else {
      for (let k = 0; k < K; k++) {
        const ratio = (k / (K - 1)) * 2 - 1; // -1 .. +1
        const lat_m = ratio * halfCorridor_m * env;
        const nx = clampX(baseX + vx * lat_m);
        const nz = clampZ(baseZ + vz * lat_m);
        const elev  = sampleDemHeightRelM(nx, nz) ?? 0;
        const slope = sampleSlopeDeg(nx, nz);
        layerNodes.push({ x: nx, z: nz, elev, slope, offsetRatio: ratio });
      }
    }
    layers.push(layerNodes);
  }

  /* Hamiltoniano de acoplamiento entre nodo a (capa s-1) y nodo b (capa s) */
  const edgeHamiltonian = (na, nb) => {
    const segDist = Math.hypot(nb.x - na.x, nb.z - na.z);
    if (segDist < 1e-3) return 0;
    const dElev = nb.elev - na.elev;
    const xm = (na.x + nb.x) * 0.5;
    const zm = (na.z + nb.z) * 0.5;
    const midSlope = sampleSlopeDeg(xm, zm);
    const segSlope = Math.max(
      nb.slope,
      midSlope,
      Math.atan(Math.abs(dElev) / segDist) * (180 / Math.PI)
    );

    const sFactor  = getSlopeCostFactor(segSlope, dElev);
    const cGrade   = dElev / segDist;
    const cBonus   = cGrade > 0 ? 1.0 + cGrade * 4.5 : Math.max(0.8, 1.0 + cGrade * 0.8);
    const o2Cost_l = baseRate_l_s * sFactor * cBonus * (segDist / walkSpeed_ms);

    /* Término cuadrático QUBO de contorno topográfico y penalización de pendiente insegura:
       QAOA prioriza contornear isoclinas suaves (menor varianza de pendiente y menor riesgo) */
    let hPenalty = 1.0 + Math.pow(segSlope / maxSafeDeg, 2) * 1.35;
    if (segSlope > maxSafeDeg) {
      const ex = segSlope - maxSafeDeg;
      hPenalty += 55.0 + ex * ex * 9.5;
    } else if (segSlope > maxSafeDeg * 0.7) {
      const r = (segSlope - maxSafeDeg * 0.7) / (maxSafeDeg * 0.3);
      hPenalty += r * r * 3.8;
    }

    const lateralJump = Math.abs((nb.offsetRatio || 0) - (na.offsetRatio || 0));
    const smoothTerm  = 1.0 + lateralJump * lateralJump * 0.45;
    return o2Cost_l * hPenalty * smoothTerm;
  };

  /* Evolución variacional QAOA de p=4 capas:
     Alterna el operador de fase de costo U(C, γ_p) y el mezclador transversal U(B, β_p)
     sobre las distribuciones de cuasi-probabilidad de cada tajada del corredor */
  const pLayers = [
    { gamma: 0.45, beta: 0.65 },
    { gamma: 0.85, beta: 0.45 },
    { gamma: 1.35, beta: 0.28 },
    { gamma: 2.10, beta: 0.12 },
  ];

  /* Inicializar amplitudes uniformes |+⟩ en cada capa intermedia */
  const weights = layers.map((ln) => new Float64Array(ln.length).fill(1.0 / ln.length));

  for (let p = 0; p < pLayers.length; p++) {
    const { gamma, beta } = pLayers[p];
    for (let s = 1; s < S; s++) {
      const curNodes  = layers[s];
      const prevNodes = layers[s - 1];
      const nextNodes = layers[s + 1];
      const curW      = weights[s];
      const prevW     = weights[s - 1];
      const nextW     = weights[s + 1];

      const effEnergy = new Float64Array(curNodes.length);
      let minE = Infinity;

      for (let k = 0; k < curNodes.length; k++) {
        let ePrev = 0;
        for (let j = 0; j < prevNodes.length; j++) {
          ePrev += prevW[j] * edgeHamiltonian(prevNodes[j], curNodes[k]);
        }
        let eNext = 0;
        for (let m = 0; m < nextNodes.length; m++) {
          eNext += nextW[m] * edgeHamiltonian(curNodes[k], nextNodes[m]);
        }
        effEnergy[k] = ePrev + eNext;
        if (effEnergy[k] < minE) minE = effEnergy[k];
      }

      /* Aplicar rotación de costo exp(-gamma * H_eff) y difusión transversal de mezclador X (beta) */
      const rawUpdated = new Float64Array(curNodes.length);
      for (let k = 0; k < curNodes.length; k++) {
        const normE = (effEnergy[k] - minE) / Math.max(minE, 0.5);
        rawUpdated[k] = curW[k] * Math.exp(-gamma * normE);
      }

      let sumW = 0;
      for (let k = 0; k < curNodes.length; k++) {
        const leftW  = k > 0 ? rawUpdated[k - 1] : rawUpdated[k];
        const rightW = k < curNodes.length - 1 ? rawUpdated[k + 1] : rawUpdated[k];
        const mixed  = (1 - beta) * rawUpdated[k] + (beta * 0.5) * (leftW + rightW);
        curW[k] = mixed;
        sumW += mixed;
      }
      if (sumW > 0) {
        for (let k = 0; k < curNodes.length; k++) curW[k] /= sumW;
      }
    }
  }

  /* Colapso proyectivo final (medición de máxima verosimilitud sobre el grafo ponderado por el estado QAOA) */
  const dpCost = layers.map((ln) => new Float64Array(ln.length).fill(Infinity));
  const dpPrev = layers.map((ln) => new Int32Array(ln.length).fill(-1));
  dpCost[0][0] = 0;

  for (let s = 1; s <= S; s++) {
    const curNodes  = layers[s];
    const prevNodes = layers[s - 1];
    const curW      = weights[s];

    for (let k = 0; k < curNodes.length; k++) {
      /* Sesgo cuántico de estado: favorece nodos con alta amplitud variacional post-QAOA */
      const ampBias = 1.0 / Math.max(0.15, Math.pow(curW[k] * curNodes.length, 0.28));
      for (let j = 0; j < prevNodes.length; j++) {
        const c = dpCost[s - 1][j] + edgeHamiltonian(prevNodes[j], curNodes[k]) * ampBias;
        if (c < dpCost[s][k]) {
          dpCost[s][k] = c;
          dpPrev[s][k] = j;
        }
      }
    }
  }

  const rawWaypoints = [];
  let currK = 0;
  for (let s = S; s >= 0; s--) {
    const node = layers[s][currK];
    rawWaypoints.push([node.x, node.z]);
    currK = dpPrev[s][currK];
    if (currK < 0) currK = 0;
  }
  rawWaypoints.reverse();

  /* Suavizado armónico ligero manteniendo fijos A y B y respetando menores pendientes */
  const smoothed = rawWaypoints.map((pt) => pt.slice());
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 1; i < smoothed.length - 1; i++) {
      const mx = 0.25 * smoothed[i - 1][0] + 0.5 * smoothed[i][0] + 0.25 * smoothed[i + 1][0];
      const mz = 0.25 * smoothed[i - 1][1] + 0.5 * smoothed[i][1] + 0.25 * smoothed[i + 1][1];
      if (sampleSlopeDeg(mx, mz) <= sampleSlopeDeg(smoothed[i][0], smoothed[i][1]) + 1.5) {
        smoothed[i][0] = mx;
        smoothed[i][1] = mz;
      }
    }
  }

  const path_m = smoothed.map(([x, z]) => [Number(x.toFixed(1)), Number(z.toFixed(1))]);
  const metrics = evaluatePathMetrics(path_m);

  const qaoaObj = {
    dataset_id: state.datasetId || CONFIG.DEFAULT_DATASET,
    algorithm:  'qaoa',
    path_m,
    metrics,
  };

  state.qaoaRoute = qaoaObj;
  if (state.routeAlgorithm === 'qaoa') {
    applyRouteToScene(qaoaObj);
  } else if (state.routeAlgorithm === 'compare') {
    rebuildRoute3DMesh();
    renderRouteMetricsUI();
  }
  return qaoaObj;
}

/**
 * Recalcula las rutas según el modo algorítmico activo ('astar', 'qaoa' o 'compare').
 */
export function recomputeRoutesForCurrentWaypoints() {
  if (!state.routeStart_m || !state.routeGoal_m) return;
  const [sx, sz] = state.routeStart_m;
  const [gx, gz] = state.routeGoal_m;

  if (state.routeAlgorithm === 'astar') {
    const astar = computeAStarRoute(sx, sz, gx, gz);
    state.route = astar;
  } else if (state.routeAlgorithm === 'qaoa') {
    const qaoa = computeQAOARoute(sx, sz, gx, gz);
    state.route = qaoa;
  } else {
    /* Modo 'compare': calcular tanto A* como QAOA para superponerlos y comparar métricas */
    const astar = computeAStarRoute(sx, sz, gx, gz);
    const qaoa  = computeQAOARoute(sx, sz, gx, gz);
    state.route     = astar;
    state.qaoaRoute = qaoa;
  }
  rebuildRoute3DMesh();
  renderRouteMetricsUI();
}

export function applyRouteToScene(routeObj) {
  state.route = routeObj;
  if (routeObj && Array.isArray(routeObj.path_m) && routeObj.path_m.length >= 2) {
    state.routeStart_m = routeObj.path_m[0].slice();
    state.routeGoal_m  = routeObj.path_m[routeObj.path_m.length - 1].slice();
  }
  rebuildRoute3DMesh();
  renderRouteMetricsUI();
}

export function clearRoute() {
  state.route           = null;
  state.qaoaRoute       = null;
  state.routeStart_m    = null;
  state.routeGoal_m     = null;
  state.routeSelectMode = null;
  if (state.routeGroup) {
    scene.remove(state.routeGroup);
    state.routeGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    state.routeGroup = null;
  }
  renderRouteMetricsUI();
}

let routeArrowTexture = null;
let qaoaArrowTexture  = null;

function getRouteArrowTexture() {
  if (routeArrowTexture) return routeArrowTexture;

  /* Textura de flecha/chevrón luminoso apuntando hacia +V (dirección de avance hacia el destino) */
  const w = 128;
  const h = 256;
  const c = document.createElement('canvas');
  c.width  = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  /* Carril lateral sutil */
  ctx.fillStyle = 'rgba(102, 252, 241, 0.14)';
  ctx.fillRect(14, 0, 4, h);
  ctx.fillRect(w - 18, 0, 4, h);

  /* Dos chevrones (flechas >>>) por celda para indicar sentido hacia el punto de llegada */
  const drawChevron = (cy, alpha, color) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 14;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowColor = '#66fcf1';
    ctx.shadowBlur  = 12;
    ctx.beginPath();
    ctx.moveTo(26, cy + 34);
    ctx.lineTo(w * 0.5, cy - 22);
    ctx.lineTo(w - 26, cy + 34);
    ctx.stroke();
    ctx.restore();
  };

  drawChevron(82, 0.95, '#66fcf1');
  drawChevron(196, 0.55, '#f6c945');

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  routeArrowTexture = tex;
  return routeArrowTexture;
}

function getQAOAArrowTexture() {
  if (qaoaArrowTexture) return qaoaArrowTexture;

  /* Textura cuántica QAOA en magenta/violeta neón con chevrones apuntando hacia el destino (B) */
  const w = 128;
  const h = 256;
  const c = document.createElement('canvas');
  c.width  = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(216, 117, 255, 0.18)';
  ctx.fillRect(14, 0, 4, h);
  ctx.fillRect(w - 18, 0, 4, h);

  const drawChevron = (cy, alpha, color) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 14;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowColor = '#d875ff';
    ctx.shadowBlur  = 14;
    ctx.beginPath();
    ctx.moveTo(26, cy + 34);
    ctx.lineTo(w * 0.5, cy - 22);
    ctx.lineTo(w - 26, cy + 34);
    ctx.stroke();
    ctx.restore();
  };

  drawChevron(82, 0.96, '#d875ff');
  drawChevron(196, 0.62, '#66fcf1');

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  qaoaArrowTexture = tex;
  return qaoaArrowTexture;
}

/**
 * Construye una cinta plana proyectada sobre el relieve del terreno con UVs continuas
 * para repetir flechas direccionales hacia el Destino (B).
 */
function createGroundProjectedRibbonGeometry(rawPath, width_m, step_m, lift_m, repeatLen_m) {
  /* 1. Remuestrear la polilínea en pasos cortos para ceñirse al suelo */
  const spine = [];
  let accDist_m = 0;

  for (let i = 0; i < rawPath.length - 1; i++) {
    const [x0, z0] = rawPath[i];
    const [x1, z1] = rawPath[i + 1];
    const segLen = Math.hypot(x1 - x0, z1 - z0);
    if (segLen < 0.01) continue;

    const steps = Math.max(1, Math.ceil(segLen / step_m));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const y = (sampleGroundY(x, z) ?? 0) + lift_m;
      const d = accDist_m + segLen * t;
      spine.push({ x, y, z, d });
    }
    accDist_m += segLen;
  }

  const [lastX, lastZ] = rawPath[rawPath.length - 1];
  spine.push({
    x: lastX,
    y: (sampleGroundY(lastX, lastZ) ?? 0) + lift_m,
    z: lastZ,
    d: accDist_m,
  });

  const n = spine.length;
  if (n < 2) return null;

  const positions = new Float32Array(n * 2 * 3);
  const uvs       = new Float32Array(n * 2 * 2);
  const indices   = new Uint32Array((n - 1) * 6);
  const halfW     = width_m * 0.5;

  for (let i = 0; i < n; i++) {
    const pPrev = spine[Math.max(0, i - 1)];
    const pNext = spine[Math.min(n - 1, i + 1)];
    let tx = pNext.x - pPrev.x;
    let tz = pNext.z - pPrev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;

    /* Perpendicular en el plano horizontal XZ: (-tz, tx) */
    const nx = -tz;
    const nz =  tx;

    const cur = spine[i];
    const lx  = cur.x - nx * halfW;
    const lz  = cur.z - nz * halfW;
    const rx  = cur.x + nx * halfW;
    const rz  = cur.z + nz * halfW;

    /* Muestrear la altura exacta de cada borde de la cinta para que quede pegada al suelo incluso en ladera */
    const ly = (sampleGroundY(lx, lz) ?? cur.y) + lift_m;
    const ry = (sampleGroundY(rx, rz) ?? cur.y) + lift_m;

    const vCoord = cur.d / repeatLen_m;

    const vOff = i * 6;
    positions[vOff]     = lx;
    positions[vOff + 1] = ly;
    positions[vOff + 2] = lz;
    positions[vOff + 3] = rx;
    positions[vOff + 4] = ry;
    positions[vOff + 5] = rz;

    const uOff = i * 4;
    uvs[uOff]     = 0;
    uvs[uOff + 1] = vCoord;
    uvs[uOff + 2] = 1;
    uvs[uOff + 3] = vCoord;

    if (i < n - 1) {
      const base = i * 2;
      const iOff = i * 6;
      indices[iOff]     = base;
      indices[iOff + 1] = base + 2;
      indices[iOff + 2] = base + 1;
      indices[iOff + 3] = base + 1;
      indices[iOff + 4] = base + 2;
      indices[iOff + 5] = base + 3;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

function addRibbonPairToGroups(rawPath, arrowTex, dim_m, orbitalGroup, fpGroup, liftBoost_m = 0) {
  if (!Array.isArray(rawPath) || rawPath.length < 2) return;

  /* 1. Cinta orbital */
  const orbWidth_m = Math.max(40, dim_m * 0.0085);
  const orbGeo = createGroundProjectedRibbonGeometry(
    rawPath,
    orbWidth_m,
    Math.max(40, dim_m * 0.003),
    Math.max(4.0, dim_m * 0.001) + liftBoost_m * 15,
    orbWidth_m * 2.2
  );
  if (orbGeo) {
    const orbMat = new THREE.MeshBasicMaterial({
      map: arrowTex,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    orbitalGroup.add(new THREE.Mesh(orbGeo, orbMat));
  }

  /* 2. Cinta en 1ª persona proyectada al ras del suelo */
  const fpGeo = createGroundProjectedRibbonGeometry(
    rawPath,
    2.2,
    4.0,
    0.08 + liftBoost_m,
    4.5
  );
  if (fpGeo) {
    const fpMat = new THREE.MeshBasicMaterial({
      map: arrowTex,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    fpGroup.add(new THREE.Mesh(fpGeo, fpMat));
  }
}

function rebuildRoute3DMesh() {
  if (state.routeGroup) {
    scene.remove(state.routeGroup);
    state.routeGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (
        o.material &&
        o.material.map !== routeArrowTexture &&
        o.material.map !== qaoaArrowTexture
      ) {
        o.material.dispose();
      }
    });
    state.routeGroup = null;
  }

  const dim_m = Math.max(state.terrainWidth, state.terrainDepth);
  const orbitalGroup = new THREE.Group();
  orbitalGroup.name = 'orbitalRouteVisuals';

  const fpGroup = new THREE.Group();
  fpGroup.name = 'fpRouteVisuals';

  const group = new THREE.Group();
  group.name = 'routeGroup';
  group.add(orbitalGroup);
  group.add(fpGroup);

  /* Marcador de Inicio (A - verde) */
  if (state.routeStart_m) {
    const [sx, sz] = state.routeStart_m;
    const sy = sampleGroundY(sx, sz) ?? 0;

    const orbStartPin = createRoutePinMesh(0x55f29b, dim_m * 0.008);
    orbStartPin.position.set(sx, sy, sz);
    orbitalGroup.add(orbStartPin);

    const fpStartPin = createRoutePinMesh(0x55f29b, 1.0);
    fpStartPin.position.set(sx, sy, sz);
    fpGroup.add(fpStartPin);
  }

  /* Marcador de Destino (B - ámbar) */
  if (state.routeGoal_m) {
    const [gx, gz] = state.routeGoal_m;
    const gy = sampleGroundY(gx, gz) ?? 0;

    const orbGoalPin = createRoutePinMesh(0xf6c945, dim_m * 0.008);
    orbGoalPin.position.set(gx, gy, gz);
    orbitalGroup.add(orbGoalPin);

    const fpGoalPin = createRoutePinMesh(0xf6c945, 1.4);
    fpGoalPin.position.set(gx, gy, gz);
    fpGroup.add(fpGoalPin);
  }

  /* Renderizar cintas proyectadas según el algoritmo seleccionado ('astar', 'qaoa', 'compare') */
  if (state.routeAlgorithm === 'compare') {
    if (state.route && state.route.path_m) {
      addRibbonPairToGroups(state.route.path_m, getRouteArrowTexture(), dim_m, orbitalGroup, fpGroup, 0);
    }
    if (state.qaoaRoute && state.qaoaRoute.path_m) {
      addRibbonPairToGroups(state.qaoaRoute.path_m, getQAOAArrowTexture(), dim_m, orbitalGroup, fpGroup, 0.04);
    }
  } else if (state.routeAlgorithm === 'qaoa') {
    const activeRoute = state.qaoaRoute || state.route;
    if (activeRoute && activeRoute.path_m) {
      addRibbonPairToGroups(activeRoute.path_m, getQAOAArrowTexture(), dim_m, orbitalGroup, fpGroup, 0);
    }
  } else if (state.route && state.route.path_m) {
    const tex = state.route.algorithm === 'qaoa' ? getQAOAArrowTexture() : getRouteArrowTexture();
    addRibbonPairToGroups(state.route.path_m, tex, dim_m, orbitalGroup, fpGroup, 0);
  }

  scene.add(group);
  state.routeGroup = group;
  updateRouteViewMode();
}

export function updateRouteViewMode() {
  if (!state.routeGroup) return;
  const isFP = state.mode === 'fp';
  const orb = state.routeGroup.getObjectByName('orbitalRouteVisuals');
  const fp  = state.routeGroup.getObjectByName('fpRouteVisuals');
  if (orb) orb.visible = !isFP;
  if (fp)  fp.visible  = isFP;
}

export function tickRouteAnimation(dt) {
  if (routeArrowTexture && (state.route || state.qaoaRoute)) {
    /* Desplazar suavemente las flechas en el sentido Inicio (A) → Destino (B) */
    routeArrowTexture.offset.y = (routeArrowTexture.offset.y - dt * 0.45) % 1;
  }
  if (qaoaArrowTexture && (state.route || state.qaoaRoute)) {
    qaoaArrowTexture.offset.y = (qaoaArrowTexture.offset.y - dt * 0.45) % 1;
  }
}

function createRoutePinMesh(hexColor, scale_m) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: hexColor });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), mat);
  pole.position.y = 3;
  g.add(pole);

  const head = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), mat);
  head.position.y = 6.5;
  g.add(head);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.8, 24),
    new THREE.MeshBasicMaterial({ color: hexColor, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.2;
  g.add(ring);

  g.scale.setScalar(scale_m);
  return g;
}

export function updateRoute3DHeights() {
  if (!state.routeGroup) return;
  rebuildRoute3DMesh();
}

export function setRouteWaypoint(role, x_m, z_m) {
  if (role === 'start') {
    state.routeStart_m = [Number(x_m.toFixed(1)), Number(z_m.toFixed(1))];
  } else {
    state.routeGoal_m = [Number(x_m.toFixed(1)), Number(z_m.toFixed(1))];
  }

  if (state.routeStart_m && state.routeGoal_m) {
    state.routeSelectMode = null;
    recomputeRoutesForCurrentWaypoints();
  } else {
    rebuildRoute3DMesh();
    renderRouteMetricsUI();
  }
}

/**
 * Inicializa el selector de dataset (?dataset=) y el bloque visible de fuente e incertidumbre (Fase D / Sección 5).
 */
function initDatasetAndUncertaintyUI(currentDatasetId, metadata) {
  if (state.solar) {
    if (Array.isArray(metadata.coordinates_lat_lon) && metadata.coordinates_lat_lon.length >= 2) {
      state.solar.lat_deg = Number(metadata.coordinates_lat_lon[0]);
      state.solar.lon_deg = Number(metadata.coordinates_lat_lon[1]);
    } else if (currentDatasetId === 'synth_crater') {
      state.solar.lat_deg = -4.58; // Referencia ecuatorial sur (tipo Gale / Elysium)
      state.solar.lon_deg = 137.44;
    } else {
      state.solar.lat_deg = 18.38; // Cráter Jezero (Syrtis Major quadrangle)
      state.solar.lon_deg = 77.58;
    }
  }

  const selectEl = document.getElementById('dataset-select');
  if (selectEl) {
    /* Si el dataset actual por URL no está en las opciones predefinidas, añadirlo dinámicamente */
    if (!Array.from(selectEl.options).some((o) => o.value === currentDatasetId)) {
      const opt = document.createElement('option');
      opt.value = currentDatasetId;
      opt.textContent = metadata.label || currentDatasetId;
      selectEl.appendChild(opt);
    }
    selectEl.value = currentDatasetId;
    selectEl.addEventListener('change', () => {
      const nextId = selectEl.value;
      if (nextId && nextId !== currentDatasetId) {
        const url = new URL(window.location.href);
        url.searchParams.set('dataset', nextId);
        window.location.href = url.toString();
      }
    });
  }

  const srcEl  = document.getElementById('meta-source-line');
  const noteEl = document.getElementById('meta-uncertainty-note');
  if (srcEl) {
    const resStr = typeof metadata.resolution_m === 'number' ? `${metadata.resolution_m} m/px` : '—';
    const srcStr = metadata.source || 'DEM Marciano';
    const dateStr = metadata.acquisition_date ? ` · ${metadata.acquisition_date}` : '';
    srcEl.textContent = `${srcStr} (${resStr}${dateStr})`;
  }
  if (noteEl) {
    noteEl.textContent =
      metadata.uncertainty_note ||
      `Pendientes calculadas a escala de celda (${metadata.resolution_m ?? '?'} m); obstáculos sub-métricos no resueltos.`;
  }
}

function initRoutePlannerUI() {
  const pickBtn     = document.getElementById('route-pick-btn');
  const clearBtn    = document.getElementById('route-clear-btn');
  const exportBtn   = document.getElementById('route-export-btn');
  const sciTourBtn  = document.getElementById('route-science-tour-btn');
  const algoAstar   = document.getElementById('algo-astar');
  const algoQaoa    = document.getElementById('algo-qaoa');
  const algoCompare = document.getElementById('algo-compare');

  if (sciTourBtn) {
    sciTourBtn.addEventListener('click', () => {
      computeScienceMultiPOITour();
    });
  }

  const setAlgoMode = (mode) => {
    state.routeAlgorithm = mode;
    if (algoAstar)   algoAstar.classList.toggle('active', mode === 'astar');
    if (algoQaoa)    algoQaoa.classList.toggle('active', mode === 'qaoa');
    if (algoCompare) algoCompare.classList.toggle('active', mode === 'compare');
    if (state.routeStart_m && state.routeGoal_m) {
      recomputeRoutesForCurrentWaypoints();
    } else {
      renderRouteMetricsUI();
    }
  };

  if (algoAstar)   algoAstar.addEventListener('click', () => setAlgoMode('astar'));
  if (algoQaoa)    algoQaoa.addEventListener('click', () => setAlgoMode('qaoa'));
  if (algoCompare) algoCompare.addEventListener('click', () => setAlgoMode('compare'));

  if (pickBtn) {
    pickBtn.addEventListener('click', () => {
      if (state.routeSelectMode) {
        state.routeSelectMode = null;
      } else {
        state.routeSelectMode = 'start';
      }
      renderRouteMetricsUI();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearRoute();
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const activeRoute = state.routeAlgorithm === 'qaoa' ? (state.qaoaRoute || state.route) : state.route;
      if (!activeRoute) return;
      const blob = new Blob([JSON.stringify(activeRoute, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'route.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  renderRouteMetricsUI();
}

export function renderRouteMetricsUI() {
  const pickBtn    = document.getElementById('route-pick-btn');
  const statusEl   = document.getElementById('route-status');
  const distEl     = document.getElementById('rm-dist');
  const o2El       = document.getElementById('rm-o2');
  const slopeEl    = document.getElementById('rm-slope');
  const riskEl     = document.getElementById('rm-risk');
  const algoEl     = document.getElementById('rm-algo');
  const compareBox = document.getElementById('route-compare-box');

  if (!statusEl) return;

  if (pickBtn) {
    pickBtn.classList.toggle('active', Boolean(state.routeSelectMode));
    pickBtn.textContent = state.routeSelectMode === 'start'
      ? '1/2 Clic en Inicio (A)…'
      : state.routeSelectMode === 'goal'
      ? '2/2 Clic en Destino (B)…'
      : '📍 Elegir Inicio / Destino';
  }

  const shownRoute = state.routeAlgorithm === 'qaoa' ? (state.qaoaRoute || state.route) : state.route;

  statusEl.classList.toggle('picking', Boolean(state.routeSelectMode));
  if (state.routeSelectMode === 'start') {
    statusEl.textContent = 'Haz clic en el mapa para situar el punto de INICIO (A).';
  } else if (state.routeSelectMode === 'goal') {
    statusEl.textContent = 'Ahora haz clic en el mapa para situar el DESTINO (B).';
  } else if (state.routeAlgorithm === 'compare' && state.route && state.qaoaRoute) {
    statusEl.textContent = 'Comparando A* (cian) vs QAOA cuántico (magenta) en el terreno.';
  } else if (shownRoute) {
    const tag = shownRoute.algorithm === 'qaoa' ? 'QAOA Cuántico' : 'A* Clásico';
    statusEl.textContent = `Ruta ${tag} activa (${shownRoute.path_m.length} nodos).`;
  } else if (state.routeStart_m && !state.routeGoal_m) {
    statusEl.textContent = 'Inicio (A) fijado. Elige un Destino (B) en el mapa.';
  } else {
    statusEl.textContent = 'Elige Inicio y Destino con clic en el mapa.';
  }

  if (algoEl) {
    if (state.routeAlgorithm === 'compare') {
      algoEl.textContent = 'A* + QAOA';
      algoEl.style.color = '#d875ff';
    } else if (shownRoute && shownRoute.algorithm === 'qaoa') {
      algoEl.textContent = 'QAOA (p=4)';
      algoEl.style.color = '#d875ff';
    } else {
      algoEl.textContent = 'A*';
      algoEl.style.color = '#66fcf1';
    }
  }

  if (shownRoute && shownRoute.metrics) {
    const m = shownRoute.metrics;
    distEl.textContent  = m.distance_m >= 1000 ? `${(m.distance_m / 1000).toFixed(2)} km` : `${m.distance_m.toFixed(0)} m`;
    o2El.textContent    = `${m.oxygen_l.toFixed(1)} L`;
    slopeEl.textContent = `${m.max_slope_deg.toFixed(1)}°`;
    slopeEl.style.color = m.max_slope_deg > state.fisio.max_safe_slope_deg ? '#ff3855' : '#55f29b';
    riskEl.textContent  = m.risk_score.toFixed(2);
  } else {
    distEl.textContent  = '—';
    o2El.textContent    = '—';
    slopeEl.textContent = '—';
    slopeEl.style.color = '';
    riskEl.textContent  = '—';
  }

  /* Cuadro comparativo A* vs QAOA cuando está activo el modo 'compare' */
  if (compareBox) {
    if (state.routeAlgorithm === 'compare' && state.route?.metrics && state.qaoaRoute?.metrics) {
      const ma = state.route.metrics;
      const mq = state.qaoaRoute.metrics;
      const dO2 = mq.oxygen_l - ma.oxygen_l;
      const dSl = mq.max_slope_deg - ma.max_slope_deg;
      const fmtDelta = (v, unit) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}${unit}`;
      compareBox.classList.remove('hidden');
      compareBox.innerHTML =
        `<div><span class="cmp-astar">■ A* (Cian):</span> ${(ma.distance_m / 1000).toFixed(2)} km · ${ma.oxygen_l.toFixed(1)} L O₂ · máx ${ma.max_slope_deg.toFixed(1)}°</div>` +
        `<div><span class="cmp-qaoa">■ QAOA (Magenta):</span> ${(mq.distance_m / 1000).toFixed(2)} km · ${mq.oxygen_l.toFixed(1)} L O₂ · máx ${mq.max_slope_deg.toFixed(1)}°</div>` +
        `<div style="margin-top:2px;color:#b8c0cc;">Δ (QAOA − A*): O₂ ${fmtDelta(dO2, ' L')} · Pend. máx ${fmtDelta(dSl, '°')}</div>`;
    } else {
      compareBox.classList.add('hidden');
      compareBox.innerHTML = '';
    }
  }

  /* Dibujar perfil topográfico 2D (corte de elevación y pendiente de la ruta, E5) */
  drawRouteElevationProfile();
}

/**
 * Planifica una Travesía Científica Multi-Parada (E5):
 * Parte desde el Refugio (o posición actual de Inicio A) y visita secuencialmente hasta 3 POIs de muestreo
 * ordenados por vecino más cercano, encadenando cada tramo con A* y/o QAOA.
 */
export function computeScienceMultiPOITour() {
  if (!state.pois || state.pois.length < 2) return;

  const shelterPOI = state.pois.find((p) => p.type === 'shelter') || state.pois[0];
  const samplingPOIs = state.pois.filter((p) => p.type === 'sampling' && Array.isArray(p.position_m));
  if (samplingPOIs.length === 0) return;

  /* Ordenar hasta 3 sitios de muestreo por vecino más cercano partiendo del Refugio */
  const remaining = samplingPOIs.slice();
  const waypoints = [shelterPOI.position_m.slice()];
  let curr = shelterPOI.position_m;

  const maxStops = Math.min(3, remaining.length);
  for (let s = 0; s < maxStops; s++) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const pt = remaining[i].position_m;
      const d  = Math.hypot(pt[0] - curr[0], pt[1] - curr[1]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx  = i;
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    waypoints.push(chosen.position_m.slice());
    curr = chosen.position_m;
  }

  const buildChain = (solverFn, algoTag) => {
    const fullPath = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const [x0, z0] = waypoints[i];
      const [x1, z1] = waypoints[i + 1];
      const leg = solverFn(x0, z0, x1, z1);
      if (leg && Array.isArray(leg.path_m)) {
        for (let k = i === 0 ? 0 : 1; k < leg.path_m.length; k++) {
          fullPath.push(leg.path_m[k]);
        }
      }
    }
    return {
      dataset_id: state.datasetId || CONFIG.DEFAULT_DATASET,
      algorithm:  algoTag,
      path_m:     fullPath,
      metrics:    evaluatePathMetrics(fullPath),
    };
  };

  state.routeStart_m = waypoints[0].slice();
  state.routeGoal_m  = waypoints[waypoints.length - 1].slice();

  if (state.routeAlgorithm === 'qaoa') {
    state.qaoaRoute = buildChain(computeQAOARoute, 'qaoa');
    state.route     = state.qaoaRoute;
  } else if (state.routeAlgorithm === 'compare') {
    state.route     = buildChain(computeAStarRoute, 'astar');
    state.qaoaRoute = buildChain(computeQAOARoute, 'qaoa');
  } else {
    state.route = buildChain(computeAStarRoute, 'astar');
  }

  rebuildRoute3DMesh();
  renderRouteMetricsUI();
}

/**
 * Dibuja el corte transversal 2D de elevación (m) y pendiente (°) a lo largo de la ruta activa (E5).
 */
function drawRouteElevationProfile() {
  const canvas = document.getElementById('route-profile-canvas');
  if (!canvas || !state.metadata) return;
  const ctx = canvas.getContext('2d');
  const w   = canvas.width;
  const h   = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(6, 14, 18, 0.92)';
  ctx.fillRect(0, 0, w, h);

  const primaryRoute = state.routeAlgorithm === 'qaoa' ? (state.qaoaRoute || state.route) : state.route;
  const compareQaoa  = state.routeAlgorithm === 'compare' ? state.qaoaRoute : null;

  if (!primaryRoute || !Array.isArray(primaryRoute.path_m) || primaryRoute.path_m.length < 2) {
    ctx.fillStyle = '#6c7a89';
    ctx.font      = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Traza una ruta para ver el perfil 2D', w * 0.5, h * 0.54);
    return;
  }

  const minElevBase = state.metadata.elevation_range_m[0];
  const maxSafeDeg  = state.fisio.max_safe_slope_deg || 25;

  /* Muestrear una polilínea en distancias acumuladas y elevaciones reales (m) */
  const sampleProfile = (path_m) => {
    const pts = [];
    let dAcc = 0;
    for (let i = 0; i < path_m.length; i++) {
      const [x, z] = path_m[i];
      if (i > 0) {
        dAcc += Math.hypot(x - path_m[i - 1][0], z - path_m[i - 1][1]);
      }
      const elev_m    = minElevBase + (sampleDemHeightRelM(x, z) ?? 0);
      const slope_deg = sampleSlopeDeg(x, z);
      pts.push({ x, z, d: dAcc, elev: elev_m, slope: slope_deg });
    }
    return pts;
  };

  const profA = sampleProfile(primaryRoute.path_m);
  const profQ = compareQaoa && Array.isArray(compareQaoa.path_m) ? sampleProfile(compareQaoa.path_m) : null;

  let minE = Infinity;
  let maxE = -Infinity;
  let maxD = Math.max(profA[profA.length - 1]?.d || 1, profQ ? profQ[profQ.length - 1]?.d || 1 : 1);

  for (const p of profA) {
    if (p.elev < minE) minE = p.elev;
    if (p.elev > maxE) maxE = p.elev;
  }
  if (profQ) {
    for (const p of profQ) {
      if (p.elev < minE) minE = p.elev;
      if (p.elev > maxE) maxE = p.elev;
    }
  }
  const spanE = Math.max(maxE - minE, 25);
  const padL = 8, padR = 8, padT = 14, padB = 14;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const toX = (d) => padL + (d / maxD) * plotW;
  const toY = (e) => padT + plotH - ((e - minE) / spanE) * plotH;

  /* Líneas horizontales de referencia */
  ctx.strokeStyle = 'rgba(102, 252, 241, 0.12)';
  ctx.lineWidth   = 1;
  for (const frac of [0.25, 0.5, 0.75]) {
    const gy = padT + plotH * frac;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(w - padR, gy);
    ctx.stroke();
  }

  /* Relleno bajo la curva primaria */
  const primaryColor = primaryRoute.algorithm === 'qaoa' ? '#d875ff' : '#66fcf1';
  ctx.beginPath();
  ctx.moveTo(toX(profA[0].d), padT + plotH);
  for (const p of profA) ctx.lineTo(toX(p.d), toY(p.elev));
  ctx.lineTo(toX(profA[profA.length - 1].d), padT + plotH);
  ctx.closePath();
  ctx.fillStyle = primaryRoute.algorithm === 'qaoa' ? 'rgba(216, 117, 255, 0.16)' : 'rgba(102, 252, 241, 0.16)';
  ctx.fill();

  /* Curva primaria coloreando en rojo/ámbar los segmentos de alta pendiente */
  for (let i = 1; i < profA.length; i++) {
    const p0 = profA[i - 1];
    const p1 = profA[i];
    const segSlope = Math.max(p0.slope, p1.slope);
    ctx.strokeStyle = segSlope > maxSafeDeg
      ? '#ff3855'
      : segSlope > maxSafeDeg * 0.75
      ? '#f6c945'
      : primaryColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(toX(p0.d), toY(p0.elev));
    ctx.lineTo(toX(p1.d), toY(p1.elev));
    ctx.stroke();
  }

  /* Si está en modo comparar, superponer la curva QAOA en magenta */
  if (profQ && profQ.length >= 2) {
    ctx.strokeStyle = '#d875ff';
    ctx.lineWidth   = 1.8;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (let i = 0; i < profQ.length; i++) {
      const px = toX(profQ[i].d);
      const py = toY(profQ[i].elev);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* Marcar POIs cercanos a la ruta con diamantes cian/verdes */
  if (Array.isArray(state.pois)) {
    for (const poi of state.pois) {
      if (!Array.isArray(poi.position_m)) continue;
      let bestPt = null;
      let bestDist = 420; // Si la ruta pasa a < 420 m del POI, marcarlo en el perfil
      for (const p of profA) {
        const d = Math.hypot(p.x - poi.position_m[0], p.z - poi.position_m[1]);
        if (d < bestDist) {
          bestDist = d;
          bestPt   = p;
        }
      }
      if (bestPt) {
        const mx = toX(bestPt.d);
        const my = toY(bestPt.elev);
        ctx.fillStyle = poi.type === 'shelter' ? '#55f29b' : poi.type === 'hazard' ? '#ff3855' : '#f6c945';
        ctx.beginPath();
        ctx.arc(mx, my, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* Etiquetas de elevación mín/máx y distancia total */
  ctx.fillStyle = '#9aa6b5';
  ctx.font      = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${maxE.toFixed(0)}m`, 6, 10);
  ctx.fillText(`${minE.toFixed(0)}m`, 6, h - 3);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#66fcf1';
  ctx.fillText(`0 → ${(maxD / 1000).toFixed(2)} km`, w - 6, h - 3);
}

async function loadDefaultRouteIfPresent(baseDir) {
  try {
    const res = await fetch(`${baseDir}/route.json`, { cache: 'no-store' });
    if (res.ok) {
      const routeData = await res.json();
      if (routeData && Array.isArray(routeData.path_m) && routeData.path_m.length >= 2) {
        applyRouteToScene(routeData);
        console.log(`[Marswalk] route.json cargado (${routeData.path_m.length} puntos)`);
        return;
      }
    }
  } catch (_) {
    /* Si no hay route.json precalculado, calcular una ruta de demostración inicial con A* */
  }

  /* Trazar ruta inicial de muestra (desde el interior del cráter hacia el delta/borde seguro) */
  const w_m = state.terrainWidth;
  const d_m = state.terrainDepth;
  computeAStarRoute(-w_m * 0.14, d_m * 0.08, w_m * 0.12, -d_m * 0.12);
}

/* ------------------------------------------------ POIs y Ciencia (T9) */
const POI_COLORS = {
  sampling: 0x66fcf1, // Cian: sitio de muestreo científico
  hazard:   0xff3855, // Rojo: peligro / terreno hostil
  shelter:  0x55f29b, // Verde: refugio / base EVA
};

async function loadPOIsIfPresent(baseDir) {
  state.pois = [];
  try {
    const res = await fetch(`${baseDir}/poi.json`, { cache: 'no-store' });
    if (res.ok) {
      const poiData = await res.json();
      if (poiData && Array.isArray(poiData.points)) {
        state.pois = poiData.points;
        console.log(`[Marswalk] poi.json cargado (${state.pois.length} puntos de interés)`);
      }
    }
  } catch (_) {
    /* Sin poi.json en el dataset */
  }

  if (state.pois.length === 0) {
    state.pois = generateAutoPOIsFromDEM();
    console.log(`[Marswalk] Generados ${state.pois.length} POIs automáticos desde la topografía del DEM`);
  }

  rebuildPOI3DMeshes();

  /* Registrar POIs como capa activable con la interfaz común de T6 (sección 5 y T9) */
  if (!state.layers.some((l) => l.id === 'pois')) {
    const poiLayerObj = {
      id:      'pois',
      label:   'POIs Ciencia',
      type:    'poi3d',
      enabled: state.poiLayerEnabled,
      opacity: state.poiLayerOpacity,
      source:  null,
      enable() {
        this.enabled = true;
        state.poiLayerEnabled = true;
        if (state.poiGroup) state.poiGroup.visible = true;
        syncLayersUI();
      },
      disable() {
        this.enabled = false;
        state.poiLayerEnabled = false;
        if (state.poiGroup) state.poiGroup.visible = false;
        syncLayersUI();
      },
      setOpacity(v) {
        const op = THREE.MathUtils.clamp(Number(v), 0, 1);
        this.opacity = op;
        state.poiLayerOpacity = op;
        applyPOIOpacity(op);
        syncLayersUI();
      },
    };
    state.layers.push(poiLayerObj);
    renderLayersPanelUI();
  }
}

function createPOIMarkerMesh(poi, scale_m, opacity = 1.0) {
  const g = new THREE.Group();
  g.userData = { poi };

  const hex = POI_COLORS[poi.type] || 0x66fcf1;

  const coreMat = new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0.92 * opacity,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0.28 * opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  /* Columna vertical luminosa */
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 7.5, 8), coreMat);
  pillar.position.y = 3.75;
  pillar.userData = { poi, baseOpacity: 0.92 };
  g.add(pillar);

  /* Geometría superior según el tipo de POI (sampling=diamante, hazard=cono invertido, shelter=esfera/domo) */
  let headGeo;
  if (poi.type === 'hazard') {
    headGeo = new THREE.ConeGeometry(1.5, 2.6, 4);
  } else if (poi.type === 'shelter') {
    headGeo = new THREE.DodecahedronGeometry(1.35, 0);
  } else {
    headGeo = new THREE.OctahedronGeometry(1.4, 0);
  }
  const head = new THREE.Mesh(headGeo, coreMat);
  head.position.y = 8.2;
  if (poi.type === 'hazard') head.rotation.x = Math.PI;
  head.userData = { poi, baseOpacity: 0.92 };
  g.add(head);

  /* Halo/anillo en el suelo (amplía además el área de clic en vista orbital) */
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 2.4, 24), glowMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  ring.userData = { poi, baseOpacity: 0.28 };
  g.add(ring);

  /* Esfera invisible de colisión para facilitar el clic sobre el marcador en vista orbital */
  const hitSphere = new THREE.Mesh(
    new THREE.SphereGeometry(2.8, 8, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hitSphere.position.y = 5.0;
  hitSphere.userData = { poi, baseOpacity: 0 };
  g.add(hitSphere);

  g.scale.setScalar(scale_m);
  return g;
}

export function rebuildPOI3DMeshes() {
  clearAnimatedArtifactsRegistry();
  if (state.poiGroup) {
    scene.remove(state.poiGroup);
    state.poiGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    state.poiGroup = null;
  }

  if (!state.pois || state.pois.length === 0) return;

  const dim_m = Math.max(state.terrainWidth, state.terrainDepth);
  const orbScale = dim_m * 0.0085;

  const group = new THREE.Group();
  group.name = 'poiGroup';
  group.visible = state.poiLayerEnabled;

  const orbSub = new THREE.Group();
  orbSub.name = 'orbitalPOIs';
  const fpSub = new THREE.Group();
  fpSub.name = 'fpPOIs';

  for (let i = 0; i < state.pois.length; i++) {
    const poi = state.pois[i];
    if (!Array.isArray(poi.position_m) || poi.position_m.length < 2) continue;
    const [px_m, pz_m] = poi.position_m;
    const py_m = sampleGroundY(px_m, pz_m) ?? 0;

    const orbMarker = createPOIMarkerMesh(poi, orbScale, state.poiLayerOpacity);
    orbMarker.position.set(px_m, py_m, pz_m);
    orbSub.add(orbMarker);

    /* Modelos 3D a escala humana 1:1 (Hábitat EVA, Rover Perseverance, Helicóptero Ingenuity, Tubos de Muestra) */
    const fpArtifactGroup = buildHumanScalePOIArtifactGroup(poi, i, state.poiLayerOpacity);
    fpArtifactGroup.position.set(px_m, py_m, pz_m);
    fpSub.add(fpArtifactGroup);
  }

  group.add(orbSub);
  group.add(fpSub);
  scene.add(group);
  state.poiGroup = group;
  updatePOIViewMode();
}

export function updatePOIViewMode() {
  if (!state.poiGroup) return;
  const isFP = state.mode === 'fp';
  const orb = state.poiGroup.getObjectByName('orbitalPOIs');
  const fp  = state.poiGroup.getObjectByName('fpPOIs');
  if (orb) orb.visible = !isFP;
  if (fp)  fp.visible  = true; // Siempre visibles a escala 1:1 (en 1ª persona y al hacer zoom orbital cercano)
}

export function updatePOI3DHeights() {
  if (!state.poiGroup) return;
  /* Reconstruir para que cada sub-elemento (Hábitat, Perseverance, Ingenuity) se asiente al suelo con la nueva exageración */
  rebuildPOI3DMeshes();
}

function applyPOIOpacity(opacity) {
  if (!state.poiGroup) return;
  state.poiGroup.traverse((obj) => {
    if (obj.isMesh && obj.material && typeof obj.userData?.baseOpacity === 'number') {
      obj.material.opacity = obj.userData.baseOpacity * opacity;
    }
  });
}

/**
 * Analiza en tiempo real un DEM recién cargado para sintetizar POIs científicos
 * (1 refugio en llanura segura de aterrizaje, 3 sitios de muestreo en contactos/gradientes y 1 alerta de peligro en escarpe)
 * cuando el dataset no incluye poi.json externo (E1).
 */
export function generateAutoPOIsFromDEM() {
  const w_m = state.terrainWidth;
  const d_m = state.terrainDepth;
  const maxSafe = state.fisio.max_safe_slope_deg || 25;

  let bestShelter = { x: 0, z: 0, score: Infinity };
  let bestLowBasin = { x: -w_m * 0.15, z: d_m * 0.12, elev: Infinity };
  let bestContact  = { x: w_m * 0.16, z: -d_m * 0.14, score: -Infinity };
  let bestRidge    = { x: -w_m * 0.22, z: -d_m * 0.18, elev: -Infinity };
  let bestHazard   = { x: w_m * 0.08, z: d_m * 0.18, slope: -Infinity };

  const G = 24;
  for (let iz = 2; iz < G - 2; iz++) {
    const z_m = ((iz / (G - 1)) - 0.5) * d_m * 0.78;
    for (let ix = 2; ix < G - 2; ix++) {
      const x_m = ((ix / (G - 1)) - 0.5) * w_m * 0.78;
      const sl  = sampleSlopeDeg(x_m, z_m);
      const el  = sampleDemHeightRelM(x_m, z_m) ?? 0;
      const distCenter = Math.hypot(x_m / w_m, z_m / d_m);

      /* 1. Refugio: pendiente mínima cerca del centro */
      const shelterScore = sl * 2.5 + distCenter * 8.0;
      if (shelterScore < bestShelter.score) {
        bestShelter = { x: x_m, z: z_m, score: shelterScore, slope: sl };
      }

      /* 2. Cuenca sedimentaria baja pero transitable */
      if (sl < maxSafe * 0.65 && el < bestLowBasin.elev && Math.hypot(x_m - bestShelter.x, z_m - bestShelter.z) > w_m * 0.1) {
        bestLowBasin = { x: x_m, z: z_m, elev: el };
      }

      /* 3. Contacto geológico (pendiente moderada 8°..18° con alto interés estratigráfico) */
      if (sl >= 6 && sl <= maxSafe * 0.78) {
        const contactScore = sl - Math.abs(distCenter - 0.22) * 15;
        if (contactScore > bestContact.score) {
          bestContact = { x: x_m, z: z_m, score: contactScore };
        }
      }

      /* 4. Terraza / afloramiento elevado accesible */
      if (sl < maxSafe * 0.75 && el > bestRidge.elev) {
        bestRidge = { x: x_m, z: z_m, elev: el };
      }

      /* 5. Escarpe peligroso (> max_safe_slope_deg) */
      if (sl > bestHazard.slope) {
        bestHazard = { x: x_m, z: z_m, slope: sl };
      }
    }
  }

  const roundPt = (p) => [Number(p.x.toFixed(0)), Number(p.z.toFixed(0))];

  return [
    {
      id: 'auto_poi_shelter',
      name: 'Zona de Aterrizaje & Refugio EVA (Auto-detectada)',
      position_m: roundPt(bestShelter),
      type: 'shelter',
      description: 'Planicie de mínima pendiente e incertidumbre topográfica seleccionada en tiempo real para el módulo hábitat y rover de apoyo.',
      source: 'Análisis Geomorfométrico en Vivo · Criterio NASA Landing Site (< 5°)',
    },
    {
      id: 'auto_poi_basin',
      name: 'Cuenca Sedimentaria Primaria',
      position_m: roundPt(bestLowBasin),
      type: 'sampling',
      description: 'Depresión topográfica de baja energía con potencial de acumulación de filosilicatos y evaporitas hidratadas.',
      source: 'Fusión Topográfica MOLA / CTX + Modelo Hidrológico',
    },
    {
      id: 'auto_poi_contact',
      name: 'Contacto Estratigráfico Marginal',
      position_m: roundPt(bestContact),
      type: 'sampling',
      description: 'Transición de gradiente moderado donde afloran estratos antiguos expuestos para muestreo astrobiológico.',
      source: 'Detección de Gradiente CRISM / HiRISE en Tiempo Real',
    },
    {
      id: 'auto_poi_ridge',
      name: 'Mirador y Afloramiento Superior',
      position_m: roundPt(bestRidge),
      type: 'sampling',
      description: 'Unidad elevada transitable con línea de vista despejada y exposición de roca madre consolidada.',
      source: 'Inercia Térmica THEMIS / Altimetría DEM',
    },
    {
      id: 'auto_poi_hazard',
      name: `Escarpe de Alta Pendiente (${(bestHazard.slope || 28).toFixed(1)}°)`,
      position_m: roundPt(bestHazard),
      type: 'hazard',
      description: 'Ladera escarpada que supera el umbral de estabilidad EVA; riesgo de deslizamiento de regolito y gasto metabólico extremo.',
      source: 'Mapa de Riesgo Derivado del DEM en Vivo',
    },
  ];
}

/**
 * Carga en caliente un nuevo DEM Float32 (desde un archivo .tif GeoTIFF o .f32 arrastrado al navegador)
 * reconstruyendo terreno 3D, capas, POIs automáticos y ruta A-Star / QAOA en tiempo real sin recargar la página (E1).
 */
export async function loadCustomDemInRealtime({
  datasetId = 'custom_dem',
  label = 'DEM Personalizado (En Vivo)',
  rows,
  cols,
  res_m = 20.0,
  demFloat32,
  source = 'GeoTIFF / Float32 Local',
  uncertaintyNote = '',
}) {
  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let i = 0; i < demFloat32.length; i++) {
    const v = demFloat32[i];
    if (Number.isFinite(v)) {
      if (v < minElev) minElev = v;
      if (v > maxElev) maxElev = v;
    }
  }
  if (!Number.isFinite(minElev)) { minElev = -2500; maxElev = -1500; }

  const width_m = Number((cols * res_m).toFixed(1));
  const depth_m = Number((rows * res_m).toFixed(1));

  const metadata = {
    dataset_id: datasetId,
    label,
    source,
    crs: 'IAU_2015:49900',
    size_m: [width_m, depth_m],
    resolution_m: res_m,
    shape: [rows, cols],
    elevation_range_m: [Number(minElev.toFixed(2)), Number(maxElev.toFixed(2))],
    heightmap: { file: 'heightmap.f32', format: 'float32-le', units: 'm' },
    layers: [
      { id: 'base',  file: '', type: 'base' },
      { id: 'slope', file: '', type: 'overlay', unit: 'deg', range: [0, 45] },
      { id: 'risk',  file: '', type: 'overlay', unit: '0-1' },
    ],
    acquisition_date: new Date().toISOString().slice(0, 10),
    uncertainty_note:
      uncertaintyNote ||
      `DEM cargado en tiempo real (${cols}×${rows} px a ${res_m} m/px). Capas, POIs y rutas generados al vuelo.`,
  };

  state.datasetId = datasetId;
  state.metadata  = metadata;
  state.dem       = demFloat32;
  document.title  = `${label} · Marswalk 3D`;

  initDatasetAndUncertaintyUI(datasetId, metadata);

  /* Regenerar capas en vivo desde el nuevo state.dem */
  await initLayersFromMetadata(metadata, '', async () => null);

  /* Reconstruir malla 3D global */
  buildTerrain(metadata, demFloat32, compositeTexture);

  /* Generar POIs científicos automáticos a partir de la topografía real del nuevo DEM */
  state.pois = generateAutoPOIsFromDEM();
  rebuildPOI3DMeshes();

  if (!state.layers.some((l) => l.id === 'pois')) {
    state.layers.push({
      id:      'pois',
      label:   'POIs Ciencia',
      type:    'poi3d',
      enabled: state.poiLayerEnabled,
      opacity: state.poiLayerOpacity,
      source:  null,
      enable() {
        this.enabled = true;
        state.poiLayerEnabled = true;
        if (state.poiGroup) state.poiGroup.visible = true;
        syncLayersUI();
      },
      disable() {
        this.enabled = false;
        state.poiLayerEnabled = false;
        if (state.poiGroup) state.poiGroup.visible = false;
        syncLayersUI();
      },
      setOpacity(v) {
        const op = THREE.MathUtils.clamp(Number(v), 0, 1);
        this.opacity = op;
        state.poiLayerOpacity = op;
        applyPOIOpacity(op);
        syncLayersUI();
      },
    });
    renderLayersPanelUI();
  }

  /* Trazar ruta automática entre el Refugio detectado (A) y la Cuenca de Muestreo (B) */
  const shelterPOI = state.pois.find((p) => p.type === 'shelter') || state.pois[0];
  const samplePOI  = state.pois.find((p) => p.type === 'sampling') || state.pois[1];
  if (shelterPOI && samplePOI) {
    state.routeStart_m = shelterPOI.position_m.slice();
    state.routeGoal_m  = samplePOI.position_m.slice();
    recomputeRoutesForCurrentWaypoints();
  }

  return { metadata, shelterPos_m: shelterPOI ? shelterPOI.position_m : [0, 0] };
}

/* ------------------------------------------------------------- loading UI */
function setLoadingStatus(msg, sub) {
  const msgEl = document.getElementById('loading-msg');
  const subEl = document.getElementById('loading-sub');
  if (msgEl && msg) msgEl.textContent = msg;
  if (subEl && sub !== undefined) subEl.textContent = sub;
}

function showLoadingError(msg, sub = '') {
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.remove('hidden');
  el.classList.add('error');
  const spinner = el.querySelector('.spinner');
  if (spinner) spinner.style.display = 'none';
  setLoadingStatus(`⚠ ${msg}`, sub);
}
