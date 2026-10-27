/* Constantes globales (1 unidad de Three.js = 1 metro). Sin imports de otros módulos propios. */

export const CONFIG = {
  DEFAULT_DATASET: 'jezero_test',

  SEGMENTS: 256,

  /* Parche local de alta resolución en 1ª persona (T5) */
  PATCH_SIZE_M:          2000, // 2 × 2 km alrededor del astronauta
  PATCH_SEGMENTS:        256,  // ~7.8 m entre vértices
  PATCH_RECENTER_DIST_M: 250,  // recentrar parche cuando el jugador se aleje > 250 m del centro

  /* Defaults fisiológicos en metros, grados, litros y segundos (contrato 4.2) */
  GRAVITY_MS2:                 3.71,
  EYE_HEIGHT_M:                1.6,
  WALK_SPEED_MS:               1.2,
  RUN_SPEED_MS:                2.5,
  JUMP_VELOCITY_MS:            3.0,
  MAX_SAFE_SLOPE_DEG:          25,
  O2_RESERVE_L:                580.0,
  O2_BASE_CONSUMPTION_L_PER_H: 50.0,
  SLOPE_COST_FACTORS: [
    { from_deg: 0,  to_deg: 5,  factor: 1.0 },
    { from_deg: 5,  to_deg: 10, factor: 1.35 },
    { from_deg: 10, to_deg: 15, factor: 1.85 },
    { from_deg: 15, to_deg: 20, factor: 2.6 },
    { from_deg: 20, to_deg: 25, factor: 3.6 },
    { from_deg: 25, to_deg: 90, factor: 5.0 },
  ],

  /* Margen al borde del mapa en metros */
  BOUNDS_MARGIN_M: 10,

  /* Umbral (m) para considerar caída libre al bajar un escalón brusco */
  FALL_THRESHOLD_M: 1.2,

  /* Damping suave del seguimiento de suelo caminando */
  WALK_Y_SMOOTHING: 25,
};
