/* Popup de información estilo Google Maps al hacer click en el terreno o en un POI (T9). */

import * as THREE from 'three';
import { camera } from './scene.js';
import { state } from './state.js';
import { raycastTerrain, raycastPOIs, sampleGroundY, sampleSlopeDeg } from './raycast.js';
import { setRouteWaypoint, computeAStarRoute, renderRouteMetricsUI } from './terrain.js';

const popupEl       = document.getElementById('info-popup');
const popupTitle    = document.getElementById('info-title');
const popupPoiBadge = document.getElementById('info-poi-badge');
const popupPoiMeta  = document.getElementById('info-poi-meta');
const popupPoiDesc  = document.getElementById('info-poi-desc');
const popupPoiSrc   = document.getElementById('info-poi-source');
const popupX        = document.getElementById('info-elev');
const popupS        = document.getElementById('info-slope');
const popupD        = document.getElementById('info-dist');
const popupClose    = popupEl.querySelector('.info-close');
const setStartBtn   = document.getElementById('popup-set-start');
const setGoalBtn    = document.getElementById('popup-set-goal');
const visitFpBtn    = document.getElementById('popup-visit-fp');

const POI_TYPE_LABELS = {
  sampling: 'Muestreo',
  hazard:   'Peligro',
  shelter:  'Refugio',
};

let visible = false;
const worldPoint = new THREE.Vector3();
let selectedGroundHeight_m = 0; // elevación relativa sin exagerar en el punto seleccionado
let activePOI = null;

/* ----------------------------------------------------------------- init */
export function initPopup() {
  popupClose.addEventListener('click', (e) => {
    e.stopPropagation();
    hideInfoPopup();
  });

  if (setStartBtn) {
    setStartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setRouteWaypoint('start', worldPoint.x, worldPoint.z);
    });
  }

  if (setGoalBtn) {
    setGoalBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setRouteWaypoint('goal', worldPoint.x, worldPoint.z);
    });
  }

  if (visitFpBtn) {
    visitFpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.hooks.onVisitPointFP?.(worldPoint.x, worldPoint.z);
    });
  }

  const canvas = document.getElementById('app');
  let downInfo = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'orbit') return;
    if (state.interaction.isDraggingAstronaut) return;
    downInfo = { x: e.clientX, y: e.clientY, t: performance.now() };
  });

  canvas.addEventListener('pointerup', (e) => {
    if (state.mode !== 'orbit' || !downInfo) { downInfo = null; return; }
    if (state.interaction.isDraggingAstronaut) { downInfo = null; return; }

    const dx = e.clientX - downInfo.x;
    const dy = e.clientY - downInfo.y;
    const dt = performance.now() - downInfo.t;
    downInfo = null;

    if (Math.hypot(dx, dy) > 5 || dt > 400) return;   // fue pan, no click

    /* 1. Verificar si el clic fue sobre un marcador POI (T9) */
    const poiHit = raycastPOIs(e);
    if (poiHit && !state.routeSelectMode) {
      const [px_m, pz_m] = poiHit.poi.position_m;
      const py_m = sampleGroundY(px_m, pz_m) ?? poiHit.point.y;
      showInfoPopup(new THREE.Vector3(px_m, py_m, pz_m), poiHit.poi);
      return;
    }

    /* 2. Raycast contra el terreno */
    const hits = raycastTerrain(e);
    if (hits.length === 0) return;

    const pt = hits[0].point;

    /* Si está activo el modo de selección de Inicio/Destino con clic en el mapa (T8) */
    if (state.routeSelectMode === 'start') {
      state.routeStart_m = [Number(pt.x.toFixed(1)), Number(pt.z.toFixed(1))];
      state.routeSelectMode = 'goal';
      setRouteWaypoint('start', pt.x, pt.z);
      state.routeSelectMode = 'goal';
      renderRouteMetricsUI();
      return;
    }
    if (state.routeSelectMode === 'goal') {
      state.routeSelectMode = null;
      if (state.routeStart_m) {
        computeAStarRoute(state.routeStart_m[0], state.routeStart_m[1], pt.x, pt.z);
      } else {
        setRouteWaypoint('goal', pt.x, pt.z);
      }
      return;
    }

    showInfoPopup(pt, null);
  });
}

/* ------------------------------------------------------------- visibility */
export function showInfoPopup(p, poi = null) {
  worldPoint.copy(p);
  selectedGroundHeight_m = state.exaggeration > 0 ? p.y / state.exaggeration : 0;
  activePOI = poi;
  visible = true;
  popupEl.classList.add('visible');
  popupEl.setAttribute('aria-hidden', 'false');
  updateContent();
  updatePosition();
}

export function syncPopupHeight() {
  if (!visible) return;
  const y = sampleGroundY(worldPoint.x, worldPoint.z);
  worldPoint.y = y !== null ? y : selectedGroundHeight_m * state.exaggeration;
}

export function hideInfoPopup() {
  visible = false;
  activePOI = null;
  popupEl.classList.remove('visible');
  popupEl.setAttribute('aria-hidden', 'true');
}

/* ------------------------------------------------------------- contenido */
function updateContent() {
  if (!state.metadata) return;

  if (activePOI) {
    if (popupTitle) popupTitle.textContent = activePOI.name || activePOI.id;
    if (popupPoiBadge) {
      popupPoiBadge.hidden = false;
      popupPoiBadge.className = `info-poi-badge ${activePOI.type || 'sampling'}`;
      popupPoiBadge.textContent = POI_TYPE_LABELS[activePOI.type] || activePOI.type || 'POI';
    }
    if (popupPoiMeta) {
      popupPoiMeta.hidden = false;
      if (popupPoiDesc) popupPoiDesc.textContent = activePOI.description || '';
      if (popupPoiSrc)  popupPoiSrc.textContent  = activePOI.source ? `Fuente: ${activePOI.source}` : '';
    }
  } else {
    if (popupTitle) popupTitle.textContent = 'Sitio seleccionado';
    if (popupPoiBadge) popupPoiBadge.hidden = true;
    if (popupPoiMeta)  popupPoiMeta.hidden  = true;
  }

  const minElev_m  = state.metadata.elevation_range_m[0];
  const realElev_m = minElev_m + selectedGroundHeight_m;

  /* Pendiente real sobre el DEM en metros, sin exageración (T4) */
  const slope_deg = sampleSlopeDeg(worldPoint.x, worldPoint.z);

  const dx_m = worldPoint.x - state.astronautPosition.x;
  const dz_m = worldPoint.z - state.astronautPosition.z;
  const dist_m = Math.hypot(dx_m, dz_m);

  popupX.textContent = `${realElev_m.toLocaleString('es-ES', { maximumFractionDigits: 0 })} m`;
  popupS.textContent = `${slope_deg.toFixed(1)}°`;
  popupD.textContent = dist_m >= 1000
    ? `${(dist_m / 1000).toFixed(2)} km`
    : `${dist_m.toFixed(0)} m`;
}

/* -------------------------------------------------------------- posición */
function updatePosition() {
  const projected = worldPoint.clone().project(camera);
  if (projected.z > 1) { popupEl.style.opacity = '0'; return; }
  popupEl.style.opacity = '';

  let x = (projected.x * 0.5 + 0.5) * window.innerWidth;
  let y = (-projected.y * 0.5 + 0.5) * window.innerHeight;

  const pw = 260, ph = activePOI ? 220 : 165;
  x = Math.max(pw / 2 + 8, Math.min(window.innerWidth - pw / 2 - 8, x));

  let below = false;
  if (y - ph - 18 < 8) { below = true; y += 18; }

  popupEl.style.left = `${x}px`;
  popupEl.style.top  = `${y}px`;
  popupEl.classList.toggle('below', below);
}

/* Llamado cada frame desde main.js */
export function tickPopup() {
  if (!visible) return;
  updatePosition();
  updateContent();
}
