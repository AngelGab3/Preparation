/* Fondo de la vista orbital: solo terreno, sin "espacio".
   Oculta estrellas, disco solar, Fobos y el domo del cielo mientras state.mode === 'orbit',
   y usa un fondo terroso sin niebla oscura. En primera persona se restauran (los controla
   applyWeatherAtmosphere). Desactivar con ?space=1 para recuperar el fondo espacial. */

import { renderer, scene, camera, stars, skydome, sunDisc, phobosMoon } from './scene.js';
import { state } from './state.js';

const SPACE_BG = new URLSearchParams(window.location.search).get('space') === '1';
const GROUND_BG = 0x2a160e; // regolito oscuro, cercano al tono medio del terreno sombreado
let wasOrbit = null;

export function tickOrbitBackdrop() {
  if (SPACE_BG) return;
  const orbit = state.mode === 'orbit';

  if (orbit) {
    /* Se reaplica cada frame: applyWeatherAtmosphere() reescribe fondo/niebla al cambiar la hora solar */
    if (stars) stars.visible = false;
    if (sunDisc) sunDisc.visible = false;
    if (phobosMoon) phobosMoon.visible = false;
    if (skydome) skydome.visible = false;
    scene.fog = null;
    renderer.setClearColor(GROUND_BG, 1);
  } else if (wasOrbit !== false) {
    if (stars) stars.visible = true;
    if (sunDisc) sunDisc.visible = true;
    if (phobosMoon) phobosMoon.visible = true;
    if (skydome) skydome.visible = true;
  }
  wasOrbit = orbit;
}

/* ------------------------------------------------------------------------------------------
   Vista orbital: el mapa llena la pantalla al inicio; después el zoom y el paneo son libres.
   · Al inicio (o al cargar otro DEM) la cámara se coloca a la distancia de encuadre: el mapa llena la pantalla.
   · Luego se puede alejar hasta 3× esa distancia (se verá el fondo) y desplazar libremente;
     solo se impide que el centro del encuadre salga del mapa.
   · La vista es siempre cenital (polar = π/2 respecto al eje up de la cámara), sin inclinación.
   Desactivar con ?space=1 (mismo flag que el fondo espacial). */
/* OJO: la cámara usa camera.up = (0,0,-1), así que OrbitControls mide el ángulo polar desde el eje -Z
   del mundo (no desde la vertical +Y). La vista cenital es polar = π/2 (0 sería mirar el mapa de canto). */
const TOPDOWN_POLAR_RAD = Math.PI / 2;
let appliedPolar = false;

let fittedKey = null;

export function tickOrbitFill() {
  const oc = state.orbitControls;
  if (SPACE_BG || !oc || !oc.enabled || state.mode !== 'orbit') return;
  const intro = document.getElementById('intro-cinematic');
  if (intro && !intro.classList.contains('hidden') && !intro.classList.contains('fade-out')) return;
  const hw = state.terrainWidth / 2, hd = state.terrainDepth / 2;
  if (!(hw > 0 && hd > 0)) return;

  if (!appliedPolar) { oc.minPolarAngle = TOPDOWN_POLAR_RAD; oc.maxPolarAngle = TOPDOWN_POLAR_RAD; appliedPolar = true; }

  /* Vista cenital: el suelo visible es el rectángulo exacto de la pantalla.
       semialto  = dist · tan(fov/2)      (eje Z del mundo, vertical en pantalla)
       semiancho = semialto · aspect      (eje X del mundo, horizontal en pantalla) */
  const halfV = Math.tan((camera.fov * Math.PI / 180) / 2);
  const halfH = halfV * camera.aspect;

  /* Distancia de encuadre: el mapa llena la pantalla (sin ver nada fuera de él) */
  const fitDist = Math.min(hd / halfV, hw / halfH);

  const t = oc.target;
  const key = `${hw}x${hd}`;
  if (fittedKey !== key) {
    /* Solo al inicio (o al cargar otro DEM): encuadrar el mapa llenando la pantalla */
    fittedKey = key;
    t.set(0, 0, 0);
    camera.position.set(0, fitDist, 0);
    oc.update();
  }

  /* Después el usuario es libre: puede alejarse (verá el fondo) y desplazarse hacia los lados.
     Solo se evita perder el mapa por completo: el centro del encuadre debe quedar sobre el mapa. */
  oc.maxDistance = fitDist * 3;
  oc.minDistance = Math.min(fitDist * 0.5, Math.max(10, Math.min(hw, hd) * 0.02));

  const cx = Math.min(hw, Math.max(-hw, t.x));
  const cz = Math.min(hd, Math.max(-hd, t.z));
  if (cx !== t.x || cz !== t.z) {
    camera.position.x += cx - t.x;
    camera.position.z += cz - t.z;
    t.x = cx; t.z = cz;
  }
}
