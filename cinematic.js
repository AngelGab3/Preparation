/* Cinemática narrativa inicial (Tierra -> Marte -> Descenso a superficie) y Cargador de DEM (.tif / .f32) en tiempo real (Fase E · E1). */

import * as THREE from 'three';
import { camera } from './scene.js';
import { state } from './state.js';
import { loadCustomDemInRealtime } from './terrain.js';
import { spawnAstronaut } from './astronaut.js';

let cinematicActive = false;
let cinematicStart  = 0;
let cinematicRaf    = null;
const CINEMATIC_DURATION_S = 11.5;

/* Estrellas precalculadas para el lienzo espacial 2D de la cinemática */
const SPACE_STARS = Array.from({ length: 180 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: 0.6 + Math.random() * 1.6,
  a: 0.25 + Math.random() * 0.75,
  p: Math.random() * Math.PI * 2,
}));

export function initIntroCinematic() {
  const skipBtn   = document.getElementById('cinematic-skip-btn');
  const replayBtn = document.getElementById('replay-cinematic-btn');

  if (skipBtn) {
    skipBtn.addEventListener('click', () => stopIntroCinematic());
  }
  if (replayBtn) {
    replayBtn.addEventListener('click', () => startIntroCinematic());
  }

  window.addEventListener('keydown', (e) => {
    if (!cinematicActive) return;
    if (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter') {
      e.preventDefault();
      stopIntroCinematic();
    }
  });

  /* Arrancar cinemática automáticamente al iniciar la aplicación (a menos que ?nointro=1) */
  const params = new URLSearchParams(window.location.search);
  if (params.get('nointro') !== '1') {
    startIntroCinematic();
  }
}

export function startIntroCinematic() {
  const overlay = document.getElementById('intro-cinematic');
  const canvas  = document.getElementById('cinematic-canvas');
  if (!overlay || !canvas) return;

  if (state.mode === 'fp') return; // Solo desde vista orbital

  cinematicActive = true;
  cinematicStart  = performance.now();
  overlay.classList.remove('hidden', 'fade-out');

  const resizeCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
  };
  resizeCanvas();

  const step = (now) => {
    if (!cinematicActive) return;
    const elapsed_s = (now - cinematicStart) / 1000;
    const progress  = Math.min(1, elapsed_s / CINEMATIC_DURATION_S);

    renderCinematicFrame(canvas, elapsed_s, progress);
    animateOrbitalDescentCamera(elapsed_s);

    if (elapsed_s >= CINEMATIC_DURATION_S) {
      stopIntroCinematic();
      return;
    }
    cinematicRaf = requestAnimationFrame(step);
  };

  if (cinematicRaf) cancelAnimationFrame(cinematicRaf);
  cinematicRaf = requestAnimationFrame(step);
}

export function stopIntroCinematic() {
  if (!cinematicActive) return;
  cinematicActive = false;
  if (cinematicRaf) {
    cancelAnimationFrame(cinematicRaf);
    cinematicRaf = null;
  }

  /* Colocar cámara orbital en su encuadre operativo estándar sobre el terreno */
  const dim_m = Math.max(state.terrainWidth || 30000, state.terrainDepth || 30000);
  camera.position.set(0, dim_m * 1.35, dim_m * 0.18);
  if (state.orbitControls) {
    state.orbitControls.target.set(0, 0, 0);
    state.orbitControls.update();
  }

  const overlay = document.getElementById('intro-cinematic');
  if (overlay) {
    overlay.classList.add('fade-out');
    setTimeout(() => {
      if (!cinematicActive) overlay.classList.add('hidden');
    }, 550);
  }
}

function animateOrbitalDescentCamera(elapsed_s) {
  const dim_m = Math.max(state.terrainWidth || 30000, state.terrainDepth || 30000);
  /* Durante la fase final (6.5s -> 11.5s), la cámara 3D real desciende en espiral hacia el terreno */
  const t = THREE.MathUtils.clamp((elapsed_s - 5.5) / (CINEMATIC_DURATION_S - 5.5), 0, 1);
  const ease = 1 - Math.pow(1 - t, 3);

  const startAlt = dim_m * 2.9;
  const endAlt   = dim_m * 1.35;
  const alt      = THREE.MathUtils.lerp(startAlt, endAlt, ease);

  const angle = (1 - ease) * 1.15;
  const radius = THREE.MathUtils.lerp(dim_m * 0.95, dim_m * 0.18, ease);

  camera.position.set(Math.sin(angle) * radius, alt, Math.cos(angle) * radius);
  if (state.orbitControls) {
    state.orbitControls.target.set(0, 0, 0);
    state.orbitControls.update();
  }
}

function renderCinematicFrame(canvas, elapsed_s, progress) {
  const ctx = canvas.getContext('2d');
  const w   = canvas.width;
  const h   = canvas.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const phaseEl    = document.getElementById('cinematic-phase');
  const titleEl    = document.getElementById('cinematic-title');
  const subEl      = document.getElementById('cinematic-subtitle');
  const missionsEl = document.getElementById('cinematic-missions');
  const barEl      = document.getElementById('cinematic-progress-fill');

  if (barEl) barEl.style.width = `${(progress * 100).toFixed(1)}%`;

  /*En la fase 3 (8.0s - 11.5s), hacer transparente el fondo espacial para revelar el descenso 3D real al terreno */
  const reveal3D = THREE.MathUtils.clamp((elapsed_s - 7.6) / 3.2, 0, 1);
  const bgAlpha  = 1 - reveal3D * 0.88;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = `rgba(6, 9, 14, ${bgAlpha.toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);

  /* Estrellas de fondo */
  if (bgAlpha > 0.15) {
    for (const s of SPACE_STARS) {
      const tw = 0.65 + 0.35 * Math.sin(elapsed_s * 2.5 + s.p);
      ctx.fillStyle = `rgba(215, 232, 255, ${(s.a * tw * bgAlpha).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ACTO I (0 - 4.0s): De la Tierra a Marte (Transferencia Hohmann) */
  if (elapsed_s < 4.2) {
    const t1 = THREE.MathUtils.clamp(elapsed_s / 4.0, 0, 1);
    if (phaseEl) phaseEl.textContent = '// ACTO I · TRANSFERENCIA INTERPLANETARIA HOHMANN (T+142 DÍAS)';
    if (titleEl) titleEl.textContent = 'DE LA TIERRA A MARTE · MISIÓN ARES EVA-01';
    if (subEl) {
      subEl.textContent =
        'Durante décadas, los exploradores robóticos de la NASA (MGS, Odyssey, MRO, Curiosity y Perseverance) cartografiaron un mundo extremo. Hoy, la primera tripulación humana se aproxima al Planeta Rojo.';
    }
    if (missionsEl) missionsEl.dataset.stage = '1';

    const ex = w * 0.22;
    const ey = h * 0.50;
    const er = Math.min(w, h) * 0.085 * (1 - t1 * 0.25);

    const mx = w * 0.78;
    const my = h * 0.44;
    const mr = Math.min(w, h) * (0.048 + t1 * 0.045);

    /* Arco orbital de transferencia Tierra -> Marte */
    ctx.save();
    ctx.strokeStyle = 'rgba(102, 252, 241, 0.32)';
    ctx.lineWidth   = 2 * dpr;
    ctx.setLineDash([8 * dpr, 6 * dpr]);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.quadraticCurveTo(w * 0.50, h * 0.20, mx, my);
    ctx.stroke();
    ctx.restore();

    /* Posición de la nave ARES-1 sobre la curva cuadrática */
    const shipT = THREE.MathUtils.clamp(0.12 + t1 * 0.82, 0, 1);
    const sx = (1 - shipT) * (1 - shipT) * ex + 2 * (1 - shipT) * shipT * (w * 0.50) + shipT * shipT * mx;
    const sy = (1 - shipT) * (1 - shipT) * ey + 2 * (1 - shipT) * shipT * (h * 0.20) + shipT * shipT * my;

    /* Rastro luminoso recorrido por la nave */
    ctx.save();
    ctx.strokeStyle = '#66fcf1';
    ctx.lineWidth   = 3 * dpr;
    ctx.shadowColor = '#66fcf1';
    ctx.shadowBlur  = 12 * dpr;
    ctx.beginPath();
    for (let k = 0; k <= 24; k++) {
      const u = (k / 24) * shipT;
      const px = (1 - u) * (1 - u) * ex + 2 * (1 - u) * u * (w * 0.50) + u * u * mx;
      const py = (1 - u) * (1 - u) * ey + 2 * (1 - u) * u * (h * 0.20) + u * u * my;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();

    /* Dibujar Globo de la Tierra (azul + atmósfera cian) */
    drawPlanetGlobe(ctx, ex, ey, er, '#1b6ca8', '#0a2240', '#66fcf1', 'TIERRA · ORIGEN', dpr, elapsed_s);

    /* Dibujar Globo de Marte (rojo óxido + atmósfera ámbar) */
    drawPlanetGlobe(ctx, mx, my, mr, '#d95f38', '#4a180c', '#ff8c52', 'MARTE · DESTINO', dpr, elapsed_s * 1.3);

    /* Icono y telemetría de la nave ARES-1 */
    ctx.save();
    ctx.fillStyle   = '#f6c945';
    ctx.shadowColor = '#f6c945';
    ctx.shadowBlur  = 14 * dpr;
    ctx.beginPath();
    ctx.arc(sx, sy, 5 * dpr, 0, Math.PI * 2);
    ctx.fill();

    ctx.font      = `600 ${Math.round(11 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = '#66fcf1';
    ctx.fillText(`▲ ARES-1 · ${(shipT * 54.6).toFixed(1)}M KM`, sx - 45 * dpr, sy - 14 * dpr);
    ctx.restore();

  } else if (elapsed_s < 8.0) {
    /* ACTO II (4.0 - 8.0s): Inserción Orbital y Fusión de Datos de Misiones NASA */
    const t2 = THREE.MathUtils.clamp((elapsed_s - 4.0) / 4.0, 0, 1);
    const dsLabel = state.metadata?.label || 'Cráter Jezero';
    if (phaseEl) phaseEl.textContent = '// ACTO II · INSERCIÓN ORBITAL Y SÍNTESIS MULTICAPA NASA';
    if (titleEl) titleEl.textContent = `OBJETIVO FIJADO: ${dsLabel.toUpperCase()}`;
    if (subEl) {
      subEl.textContent =
        'Integrando altimetría láser MOLA (MGS), estereofotogrametría CTX/HiRISE (MRO), mineralogía CRISM, inercia térmica THEMIS y estaciones ambientales MEDA (Perseverance) en una sola vista EVA.';
    }
    if (missionsEl) missionsEl.dataset.stage = '2';

    const cx = w * 0.5;
    const cy = h * 0.45;
    const mr = Math.min(w, h) * (0.16 + t2 * 0.14);

    drawPlanetGlobe(ctx, cx, cy, mr, '#d8613a', '#3d150a', '#ff6a3d', '', dpr, elapsed_s);

    /* Anillos de escaneo orbital sobre Marte */
    ctx.save();
    ctx.strokeStyle = 'rgba(102, 252, 241, 0.45)';
    ctx.lineWidth   = 1.5 * dpr;
    ctx.setLineDash([6 * dpr, 5 * dpr]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, mr * 1.38, mr * 0.48, -0.28, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(246, 201, 69, 0.45)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, mr * 1.22, mr * 0.85, 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    /* Retícula de bloqueo sobre el sitio de aterrizaje (Jezero / Zona de Estudio) */
    const tx = cx + mr * 0.18;
    const ty = cy - mr * 0.15;
    const lockR = (28 - t2 * 10) * dpr;

    ctx.save();
    ctx.strokeStyle = '#66fcf1';
    ctx.lineWidth   = 2 * dpr;
    ctx.beginPath();
    ctx.arc(tx, ty, lockR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tx - lockR * 1.5, ty);
    ctx.lineTo(tx + lockR * 1.5, ty);
    ctx.moveTo(tx, ty - lockR * 1.5);
    ctx.lineTo(tx, ty + lockR * 1.5);
    ctx.stroke();

    ctx.font      = `700 ${Math.round(12 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = '#66fcf1';
    ctx.fillText(`TARGET LOCK // ${dsLabel}`, tx + lockR + 10 * dpr, ty - 4 * dpr);
    ctx.fillStyle = '#f6c945';
    ctx.font      = `500 ${Math.round(10.5 * dpr)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillText(
      `RES: ${state.metadata?.resolution_m ?? 20} m/px · ELEV: [${state.metadata?.elevation_range_m?.[0] ?? -2710}m, ${state.metadata?.elevation_range_m?.[1] ?? -1515}m]`,
      tx + lockR + 10 * dpr,
      ty + 14 * dpr
    );
    ctx.restore();
  } else {
    /* ACTO III (8.0 - 11.5s): Entrada Atmosférica y Descenso al Terreno 3D */
    if (phaseEl) phaseEl.textContent = '// ACTO III · DESCENSO ORBITAL Y DESPLIEGUE EVA';
    if (titleEl) titleEl.textContent = 'ATERRIZAJE COMPLETADO · SISTEMAS PLSS Y RUTEO A*/QAOA EN LÍNEA';
    if (subEl) {
      subEl.textContent =
        'Planifica tu travesía con capas científicas, evalúa el consumo metabólico de O₂ y haz doble clic en el astronauta para caminar en 1ª persona.';
    }
    if (missionsEl) missionsEl.dataset.stage = '3';

    /* Brackets de descenso HUD sobre el terreno 3D real */
    const cx = w * 0.5;
    const cy = h * 0.45;
    const br = Math.min(w, h) * 0.22;
    ctx.save();
    ctx.strokeStyle = `rgba(102, 252, 241, ${(1 - reveal3D * 0.7).toFixed(2)})`;
    ctx.lineWidth   = 2 * dpr;
    ctx.strokeRect(cx - br, cy - br * 0.65, br * 2, br * 1.3);
    ctx.restore();
  }
}

function drawPlanetGlobe(ctx, x, y, r, colorLight, colorDark, glowColor, label, dpr, animTime) {
  ctx.save();
  /* Halo atmosférico */
  const halo = ctx.createRadialGradient(x, y, r * 0.85, x, y, r * 1.35);
  halo.addColorStop(0, `${glowColor}55`);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
  ctx.fill();

  /* Esfera iluminada */
  const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  grad.addColorStop(0, colorLight);
  grad.addColorStop(1, colorDark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  /* Meridianos / paralelos sutiles girando */
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth   = 1 * dpr;
  for (let i = -2; i <= 2; i++) {
    const phase = ((i * 0.32 + animTime * 0.08) % 1 + 1) % 1 - 0.5;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(phase) * r * 1.8, r * 0.98, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (label) {
    ctx.fillStyle = '#e8ecf2';
    ctx.font      = `700 ${Math.round(11 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + r + 22 * dpr);
  }
  ctx.restore();
}

/* ============================================================================
 * CARGADOR DE DEM (.tif GeoTIFF Float32 / .f32) EN TIEMPO REAL EN EL NAVEGADOR
 * ============================================================================ */

export function initRealtimeDemLoader() {
  const uploadBtn = document.getElementById('upload-dem-btn');
  const fileInput = document.getElementById('upload-dem-input');
  const statusEl  = document.getElementById('upload-dem-status');

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        await handleRealtimeDemFile(file, statusEl);
        fileInput.value = '';
      }
    });
  }

  /* Soporte Drag & Drop sobre la ventana para cargar un .tif o .f32 al instante en vivo */
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
    }
  });

  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    const file = e.dataTransfer.files[0];
    const ext  = file.name.toLowerCase();
    if (ext.endsWith('.tif') || ext.endsWith('.tiff') || ext.endsWith('.f32')) {
      e.preventDefault();
      await handleRealtimeDemFile(file, statusEl);
    }
  });
}

async function handleRealtimeDemFile(file, statusEl) {
  try {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = `Procesando "${file.name}" en tiempo real…`;
    }

    const buf  = await file.arrayBuffer();
    const name = file.name.replace(/\.[^.]+$/, '');
    const lower = file.name.toLowerCase();

    let parsed;
    if (lower.endsWith('.tif') || lower.endsWith('.tiff')) {
      parsed = parseGeoTiffFloat32InBrowser(buf);
    } else if (lower.endsWith('.f32')) {
      parsed = parseRawFloat32InBrowser(buf);
    } else {
      throw new Error('Formato no soportado. Usa un archivo .tif (GeoTIFF Float32) o .f32.');
    }

    const t0 = performance.now();
    const { metadata, shelterPos_m } = await loadCustomDemInRealtime({
      datasetId: name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'custom_dem',
      label: `${name} (Tiempo Real)`,
      rows: parsed.rows,
      cols: parsed.cols,
      res_m: parsed.res_m,
      demFloat32: parsed.demFloat32,
      source: lower.endsWith('.tif') || lower.endsWith('.tiff') ? 'GeoTIFF Cargado en Vivo' : 'Float32 Cargado en Vivo',
      uncertaintyNote: `DEM "${file.name}" (${parsed.cols}×${parsed.rows} px, ${parsed.res_m} m/px) procesado en tiempo real en el navegador.`,
    });

    /* Reubicar automáticamente al astronauta en la zona plana de aterrizaje (Refugio detectado) */
    if (shelterPos_m) {
      spawnAstronaut(shelterPos_m[0], shelterPos_m[1]);
    }

    const elapsedMs = (performance.now() - t0).toFixed(0);
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = `✓ ${metadata.shape[1]}×${metadata.shape[0]} px (${metadata.resolution_m} m/px) listo en ${elapsedMs} ms`;
    }
  } catch (err) {
    console.error('[Marswalk] Error procesando DEM en tiempo real:', err);
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = `⚠ ${err.message}`;
    }
  }
}

/**
 * Lector nativo en navegador de archivos GeoTIFF Float32 sin compresión (como los DTM MRO/CTX/MOLA de la NASA).
 */
function parseGeoTiffFloat32InBrowser(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (arrayBuffer.byteLength < 16) {
    throw new Error('Archivo TIFF demasiado pequeño o corrupto.');
  }

  const byteOrder = String.fromCharCode(view.getUint8(0), view.getUint8(1));
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') {
    throw new Error('Encabezado TIFF inválido (no es II ni MM).');
  }

  const magic = view.getUint16(2, littleEndian);
  if (magic !== 42) {
    throw new Error(`Magic number TIFF no soportado (${magic}).`);
  }

  const ifdOffset = view.getUint32(4, littleEndian);
  const numEntries = view.getUint16(ifdOffset, littleEndian);

  const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };
  const tags = {};

  for (let i = 0; i < numEntries; i++) {
    const entryPos  = ifdOffset + 2 + i * 12;
    const tagId     = view.getUint16(entryPos, littleEndian);
    const fieldType = view.getUint16(entryPos + 2, littleEndian);
    const count     = view.getUint32(entryPos + 4, littleEndian);
    const typeSize  = typeSizes[fieldType] || 1;
    const totalBytes = count * typeSize;
    const valOffset  = totalBytes <= 4 ? entryPos + 8 : view.getUint32(entryPos + 8, littleEndian);

    if (fieldType === 2) {
      let s = '';
      for (let c = 0; c < count; c++) {
        const ch = view.getUint8(valOffset + c);
        if (ch !== 0) s += String.fromCharCode(ch);
      }
      tags[tagId] = s;
    } else if (fieldType === 3) {
      const arr = [];
      for (let c = 0; c < count; c++) arr.push(view.getUint16(valOffset + c * 2, littleEndian));
      tags[tagId] = count === 1 ? arr[0] : arr;
    } else if (fieldType === 4) {
      const arr = [];
      for (let c = 0; c < count; c++) arr.push(view.getUint32(valOffset + c * 4, littleEndian));
      tags[tagId] = count === 1 ? arr[0] : arr;
    } else if (fieldType === 12) {
      const arr = [];
      for (let c = 0; c < count; c++) arr.push(view.getFloat64(valOffset + c * 8, littleEndian));
      tags[tagId] = count === 1 ? arr[0] : arr;
    }
  }

  const cols        = Number(tags[256] || 0);
  const rows        = Number(tags[257] || 0);
  const bits        = Array.isArray(tags[258]) ? tags[258][0] : Number(tags[258] || 32);
  const compression = Number(tags[259] || 1);

  if (!cols || !rows) {
    throw new Error('No se encontraron dimensiones válidas en el GeoTIFF.');
  }
  if (compression !== 1 || bits !== 32) {
    throw new Error(`Se requiere GeoTIFF Float32 sin compresión (recibido: ${bits}-bit, compresión=${compression}).`);
  }

  let stripOffsets = tags[273];
  let stripBytes   = tags[279];
  if (!Array.isArray(stripOffsets)) stripOffsets = [stripOffsets];
  if (!Array.isArray(stripBytes))   stripBytes   = [stripBytes];

  /* Escala en metros por píxel (Tag GeoTIFF 33550 ModelPixelScaleTag) */
  let res_m = 20.0;
  if (Array.isArray(tags[33550]) && tags[33550][0] > 0) {
    res_m = Number(tags[33550][0].toFixed(2));
  }

  let nodataVal = null;
  if (typeof tags[42113] === 'string') {
    const parsedNodata = parseFloat(tags[42113]);
    if (!Number.isNaN(parsedNodata)) nodataVal = parsedNodata;
  }

  const totalSamples = rows * cols;
  const demFloat32   = new Float32Array(totalSamples);
  let writeIdx       = 0;

  for (let s = 0; s < stripOffsets.length; s++) {
    const off   = stripOffsets[s];
    const bLen  = stripBytes[s];
    const count = Math.floor(bLen / 4);
    for (let k = 0; k < count && writeIdx < totalSamples; k++) {
      demFloat32[writeIdx++] = view.getFloat32(off + k * 4, littleEndian);
    }
  }

  /* Limpiar valores NoData / NaN reemplazándolos por la elevación mínima válida */
  let minValid = Infinity;
  for (let i = 0; i < totalSamples; i++) {
    const v = demFloat32[i];
    const isNodata = !Number.isFinite(v) || (nodataVal !== null && Math.abs(v - nodataVal) < 1) || v < -1e10 || v > 1e10;
    if (!isNodata && v < minValid) minValid = v;
  }
  if (!Number.isFinite(minValid)) minValid = -2500;

  for (let i = 0; i < totalSamples; i++) {
    const v = demFloat32[i];
    const isNodata = !Number.isFinite(v) || (nodataVal !== null && Math.abs(v - nodataVal) < 1) || v < -1e10 || v > 1e10;
    if (isNodata) demFloat32[i] = minValid;
  }

  return { rows, cols, res_m, demFloat32 };
}

function parseRawFloat32InBrowser(arrayBuffer) {
  if (arrayBuffer.byteLength % 4 !== 0) {
    throw new Error('El tamaño del archivo .f32 no es múltiplo de 4 bytes.');
  }
  const demFloat32 = new Float32Array(arrayBuffer);
  const total = demFloat32.length;

  /* Si coincide con dimensiones conocidas (ej. 1512×1596 de Jezero), usarlas; si no, asumir rejilla cuadrada */
  let rows = Math.round(Math.sqrt(total));
  let cols = Math.floor(total / rows);
  if (total === 1512 * 1596) {
    rows = 1512;
    cols = 1596;
  }
  return { rows, cols, res_m: 20.0, demFloat32 };
}
