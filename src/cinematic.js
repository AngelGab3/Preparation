/* Live DEM loader; the landing intro is isolated in signal-intro.js. */
import { loadCustomDemInRealtime } from './terrain.js';
import { spawnAstronaut } from './astronaut.js';
import { isIntroCinematicActive } from './signal-intro.js';
export { initIntroCinematic, startIntroCinematic, stopIntroCinematic, isIntroCinematicActive, tickIntroCinematic } from './signal-intro.js';

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
    if (isIntroCinematicActive()) { e.preventDefault(); return; }
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
