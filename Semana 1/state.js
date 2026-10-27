/* Estado compartido de la aplicación Marswalk 3D */

import * as THREE from 'three';
import { CONFIG } from './config.js';

export const state = {
  mode: 'orbit',
  exaggeration: 2.0,

  datasetId: null,
  metadata: null,
  dem: null,           // Float32Array original (rows × cols) en metros reales sin exageración
  baseTexture: null,
  layers: [],          // Capas registradas desde metadata.json (T6): [{ id, label, enable(), disable(), setOpacity(v) }]

  /* Parámetros fisiológicos activos (de config_fisio.json o defaults de CONFIG) */
  fisio: {
    gravity_ms2:                 CONFIG.GRAVITY_MS2,
    eye_height_m:                CONFIG.EYE_HEIGHT_M,
    walk_speed_ms:               CONFIG.WALK_SPEED_MS,
    run_speed_ms:                CONFIG.RUN_SPEED_MS,
    jump_velocity_ms:            CONFIG.JUMP_VELOCITY_MS,
    max_safe_slope_deg:          CONFIG.MAX_SAFE_SLOPE_DEG,
    o2_reserve_l:                CONFIG.O2_RESERVE_L,
    o2_base_consumption_l_per_h: CONFIG.O2_BASE_CONSUMPTION_L_PER_H,
    slope_cost_factors:          CONFIG.SLOPE_COST_FACTORS,
  },

  /* Estado telemétrico del HUD (T7) */
  hud: {
    elev_m:       0,
    slope_deg:    0,
    speed_ms:     0,
    o2Remaining_l: CONFIG.O2_RESERVE_L,
    o2Rate_l_h:   0,
    slopeWarning: false,
  },

  /* Condiciones ambientales actuales en vivo (Mars 2020 MEDA Weather + Simulador de Tormenta, E4) */
  weather: {
    mode:           'nominal', // 'nominal' | 'dust_storm'
    temp_c:         -63,       // °C
    pressure_hpa:   7.4,       // hPa (mbar)
    wind_ms:        5.2,       // m/s
    dust_tau:       0.45,      // Opacidad óptica atmosférica (τ)
    uv_level:       'MODERADO',
    thermalPenalty: 1.0,       // Multiplicador de gasto PLSS por regulación térmica/visibilidad
  },

  /* Efemérides solares y modelo radiativo físico marciano en tiempo real */
  solar: {
    lat_deg:                18.38,  // Latitud planetocéntrica (°N, Cráter Jezero por defecto)
    lon_deg:                77.58,  // Longitud planetocéntrica (°E, Cráter Jezero por defecto)
    ls_deg:                 142.0,  // Longitud solar areocéntrica Ls (0°..360°; 251° = perihelio, 71° = afelio)
    ltst_h:                 10.5,   // Hora Solar Verdadera Local (LTST, 0..24 h)
    autoCycle:              false,  // Animación continua del ciclo diurno marciano
    distance_au:            1.564,  // Distancia heliocéntrica r(Ls) en Unidades Astronómicas (AU)
    toa_irradiance_wm2:     556.0,  // Irradiancia en el tope de la atmósfera I_TOA = 1361 / r² (W/m²)
    surface_irradiance_wm2: 412.0,  // Irradiancia global en superficie tras ley de Beer-Lambert con τ (W/m²)
    declination_deg:        15.2,   // Declinación solar δ (°) con oblicuidad axial de Marte ε = 25.19°
    elevation_deg:          66.4,   // Elevación solar α_sun sobre el horizonte local (°)
    azimuth_deg:            112.0,  // Acimut solar γ_sun desde el Norte hacia el Este (0°..360°)
    airmass:                1.09,   // Masa óptica de aire marciano m(α_sun)
    phase:                  'DIA',  // 'DIA' | 'CREPUSCULO_AZUL' | 'NOCHE'
  },

  /* Estado de planificación de ruta A* / QAOA (T8 y Fase D - contrato 4.3) */
  route: null,          // { dataset_id, algorithm, path_m: [[x_m, z_m], ...], metrics: { distance_m, oxygen_l, max_slope_deg, risk_score } }
  qaoaRoute: null,      // Ruta QAOA para comparación frente a A* (Fase D)
  routeAlgorithm: 'astar', // 'astar' | 'qaoa' | 'compare'
  routeStart_m: null,   // [x_m, z_m]
  routeGoal_m: null,    // [x_m, z_m]
  routeSelectMode: null, // null | 'start' | 'goal'
  routeGroup: null,

  /* Puntos de interés científico / operativo (T9 - contrato 4.4) */
  pois: [],             // [{ id, name, position_m: [x_m, z_m], type: 'sampling'|'hazard'|'shelter', description, source }]
  poiGroup: null,
  poiLayerEnabled: true,
  poiLayerOpacity: 1.0,
  completedPOIs: new Set(), // IDs de POIs analizados/recolectados en 1ª persona (E3)
  nearestPOI: null,         // { poi, dist_m } cuando el astronauta está a < 28 m en 1ª persona (E3)

  terrainMesh: null,
  terrainGeo: null,
  heights: null,       // Float32Array (N×N) en metros relativos a elevation_range_m[0], sin exageración
  terrainWidth: 1000,  // _m (eje X)
  terrainDepth: 1000,  // _m (eje Z)
  boundsX: 490,        // _m
  boundsZ: 490,        // _m

  /* Parche local de alta resolución en 1ª persona (T5) */
  localPatchMesh: null,
  localPatchGeo: null,
  localPatchHeights: null,
  localPatchCenter: new THREE.Vector2(0, 0),

  orbitControls: null,
  fpControls: null,

  astronautGroup: null,
  astronautPosition: new THREE.Vector3(0, 0, 0),

  transition: null,

  interaction: {
    isDraggingAstronaut: false,
    lastDockDragEnd: 0,
  },

  hooks: {
    onRecallAstronaut: null,
  },
};
