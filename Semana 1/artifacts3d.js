/* Modelos 3D procedurales a escala humana (1 unidad = 1 metro) en la superficie marciana (Fase E · E2):
 * - Rover NASA Perseverance (chasis, MMRTG, 6 ruedas rocker-bogie, mástil SuperCam animado y brazo robótico PIXL/SHERLOC)
 * - Helicóptero NASA Ingenuity (fuselaje kapton dorado, 4 patas de fibra de carbono y doble rotor coaxial animado)
 * - Módulo Hábitat EVA Presurizado (domo, esclusa airlock, paneles solares, antena de alta ganancia y plataforma)
 * - Depósitos de Tubos de Muestra de Titanio (Three Forks Sample Depot) y Balizas de Peligro
 */

import * as THREE from 'three';
import { sampleGroundY } from './raycast.js';

const animatedRotors = [];
const animatedMasts  = [];
const animatedPulses = [];

export function clearAnimatedArtifactsRegistry() {
  animatedRotors.length = 0;
  animatedMasts.length  = 0;
  animatedPulses.length = 0;
}

export function tickArtifactsAnimation(dt, elapsed_s) {
  for (const rotor of animatedRotors) {
    rotor.rotation.y += dt * (rotor.userData.speed || 9.0);
  }
  for (const mast of animatedMasts) {
    const baseYaw = mast.userData.baseYaw || 0;
    mast.rotation.y = baseYaw + Math.sin(elapsed_s * 0.9 + (mast.userData.phase || 0)) * 0.45;
  }
  for (const pulse of animatedPulses) {
    const s = 1.0 + 0.14 * Math.sin(elapsed_s * 3.2 + (pulse.userData.phase || 0));
    pulse.scale.set(s, 1, s);
  }
}

/**
 * Construye el conjunto 3D a escala humana (1:1 en metros) asociado a un POI según su tipo e índice.
 * Cada sub-elemento se posiciona en Y usando sampleGroundY(worldX, worldZ) para asentarse sobre laderas reales.
 */
export function buildHumanScalePOIArtifactGroup(poi, poiIndex = 0, opacity = 1.0) {
  const root = new THREE.Group();
  root.userData = { poi, isArtifactRoot: true };

  const [cx_m, cz_m] = poi.position_m;
  const cy_m = sampleGroundY(cx_m, cz_m) ?? 0;

  /* Helper para colocar cualquier sub-objeto en offset (dx, dz) asentado exactamente sobre el relieve local */
  const placeOnGround = (obj3d, dx_m, dz_m, extraY_m = 0) => {
    const wx = cx_m + dx_m;
    const wz = cz_m + dz_m;
    const wy = (sampleGroundY(wx, wz) ?? cy_m) - cy_m + extraY_m;
    obj3d.position.set(dx_m, wy, dz_m);
    obj3d.traverse((child) => {
      if (child.isMesh) {
        child.userData = { ...child.userData, poi };
      }
    });
    root.add(obj3d);
  };

  /* 1. Haz vertical holográfico sutil para localizar el sitio a distancia mientras se camina en 1ª persona */
  const hexColor = poi.type === 'hazard' ? 0xff3855 : poi.type === 'shelter' ? 0x55f29b : 0x66fcf1;
  const beaconMat = new THREE.MeshBasicMaterial({
    color: hexColor,
    transparent: true,
    opacity: 0.22 * opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beaconBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.55, 42, 12, 1, true), beaconMat);
  beaconBeam.position.set(0, 21, 0);
  beaconBeam.userData = { poi, baseOpacity: 0.22 };
  root.add(beaconBeam);

  const groundRing = new THREE.Mesh(
    new THREE.RingGeometry(2.8, 3.3, 32),
    new THREE.MeshBasicMaterial({
      color: hexColor,
      transparent: true,
      opacity: 0.55 * opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  groundRing.rotation.x = -Math.PI / 2;
  groundRing.position.set(0, 0.12, 0);
  groundRing.userData = { poi, baseOpacity: 0.55, phase: poiIndex * 1.1 };
  animatedPulses.push(groundRing);
  root.add(groundRing);

  if (poi.type === 'shelter') {
    /* COMPLEJO DE ATERRIZAJE: Hábitat EVA + Rover Perseverance + Helicóptero Ingenuity */
    const habitat = createMarsHabitatMesh();
    placeOnGround(habitat, 0, 0, 0);

    const perseverance = createPerseveranceRoverMesh(poiIndex);
    perseverance.rotation.y = 0.45;
    placeOnGround(perseverance, 8.5, 5.0, 0);

    const ingenuity = createIngenuityHelicopterMesh(poiIndex);
    ingenuity.rotation.y = -0.3;
    placeOnGround(ingenuity, 4.8, 9.2, 0);
  } else if (poi.type === 'sampling') {
    /* SITIO DE MUESTREO CIENTÍFICO: Depósito de tubos de muestra + Estación espectrométrica (+ Rover en sitios clave) */
    const depot = createSampleDepotMesh(poiIndex);
    placeOnGround(depot, 0, 0, 0);

    if (poiIndex % 2 === 1) {
      /* En sitios de muestreo destacados (ej. Delta Three Forks), colocar un Rover en plena operación científica */
      const sciRover = createPerseveranceRoverMesh(poiIndex + 10);
      sciRover.rotation.y = -0.85;
      placeOnGround(sciRover, 4.2, -3.2, 0);
    }
  } else if (poi.type === 'hazard') {
    /* ZONA DE PELIGRO: Balizas estroboscópicas de advertencia EVA */
    const hazardRig = createHazardWarningRigMesh(poiIndex);
    placeOnGround(hazardRig, 0, 0, 0);
  }

  return root;
}

/**
 * Construye un modelo 3D detallado del Rover NASA Perseverance (~3.0 m × 2.7 m × 2.2 m).
 */
export function createPerseveranceRoverMesh(seed = 0) {
  const rover = new THREE.Group();
  rover.name = 'perseveranceRover';

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xedeae2, roughness: 0.45, metalness: 0.25 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd4a238, roughness: 0.32, metalness: 0.72 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x22272e, roughness: 0.65, metalness: 0.45 });
  const alumMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.4,  metalness: 0.75 });
  const lensMat = new THREE.MeshBasicMaterial({ color: 0x66fcf1 });
  const laserMat = new THREE.MeshBasicMaterial({ color: 0xff3855 });

  /* 1. Ruedas (6 ruedas de Ø 0.52 m con suspensión rocker-bogie) */
  const wheelGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.24, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.26, 10);
  hubGeo.rotateZ(Math.PI / 2);

  const wheelPositions = [
    [-1.12, 0.27,  1.08], [1.12, 0.27,  1.08], // Delanteras
    [-1.18, 0.27,  0.0],  [1.18, 0.27,  0.0],  // Centrales
    [-1.12, 0.27, -1.08], [1.12, 0.27, -1.08], // Traseras
  ];

  for (const [wx, wy, wz] of wheelPositions) {
    const wMesh = new THREE.Mesh(wheelGeo, darkMat);
    wMesh.position.set(wx, wy, wz);
    rover.add(wMesh);

    const hMesh = new THREE.Mesh(hubGeo, alumMat);
    hMesh.position.set(wx, wy, wz);
    rover.add(hMesh);

    /* Puntal de suspensión hacia el chasis */
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.68, 8), alumMat);
    strut.position.set(wx * 0.82, 0.55, wz * 0.88);
    strut.rotation.z = wx > 0 ? 0.32 : -0.32;
    rover.add(strut);
  }

  /* 2. Chasis principal (WEB - Warm Electronics Box) */
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.58, 2.15), bodyMat);
  chassis.position.set(0, 0.86, 0);
  rover.add(chassis);

  const goldBelly = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.18, 2.05), goldMat);
  goldBelly.position.set(0, 0.54, 0);
  rover.add(goldBelly);

  /* Cubierta superior de instrumentos con detalles técnicos */
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.08, 1.95), alumMat);
  deck.position.set(0, 1.18, 0);
  rover.add(deck);

  /* 3. Generador nuclear MMRTG trasero inclinado hacia arriba con aletas radiadoras */
  const mmrtgGroup = new THREE.Group();
  mmrtgGroup.position.set(0, 1.05, -1.25);
  mmrtgGroup.rotation.x = -0.45;
  const rtgCore = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.85, 12), bodyMat);
  mmrtgGroup.add(rtgCore);
  const rtgFin1 = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.04), alumMat);
  const rtgFin2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.75, 0.62), alumMat);
  mmrtgGroup.add(rtgFin1, rtgFin2);
  rover.add(mmrtgGroup);

  /* 4. Antena de alta ganancia UHF/X-Band en la cubierta trasera */
  const hgaPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), alumMat);
  hgaPole.position.set(-0.45, 1.42, -0.55);
  rover.add(hgaPole);
  const hgaDish = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.06, 16), goldMat);
  hgaDish.position.set(-0.45, 1.66, -0.55);
  hgaDish.rotation.x = 0.35;
  rover.add(hgaDish);

  /* 5. Mástil Remoto (RSM) y cabezal SuperCam + Mastcam-Z (animado) */
  const mastPole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.95, 10), bodyMat);
  mastPole.position.set(0.42, 1.65, 0.68);
  rover.add(mastPole);

  const mastHead = new THREE.Group();
  mastHead.position.set(0.42, 2.18, 0.68);
  mastHead.userData = { baseYaw: 0, phase: seed * 1.7 };

  const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.32), bodyMat);
  mastHead.add(headBox);

  /* Lente láser circular de SuperCam */
  const superCamLens = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16), lensMat);
  superCamLens.rotation.x = Math.PI / 2;
  superCamLens.position.set(0, 0.04, 0.16);
  mastHead.add(superCamLens);

  /* Visores estéreo Mastcam-Z */
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.05), darkMat);
  eyeL.position.set(-0.15, -0.05, 0.16);
  const eyeR = eyeL.clone();
  eyeR.position.set(0.15, -0.05, 0.16);
  mastHead.add(eyeL, eyeR);

  animatedMasts.push(mastHead);
  rover.add(mastHead);

  /* 6. Brazo robótico frontal articulado con torreta PIXL / SHERLOC y haz láser de análisis */
  const armGroup = new THREE.Group();
  armGroup.position.set(-0.15, 0.95, 1.08);

  const boom1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.85, 8), alumMat);
  boom1.rotation.x = Math.PI / 2 - 0.35;
  boom1.position.set(0, -0.14, 0.38);
  armGroup.add(boom1);

  const boom2 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8), alumMat);
  boom2.rotation.x = Math.PI / 2 + 0.55;
  boom2.position.set(0, -0.42, 0.88);
  armGroup.add(boom2);

  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.22, 12), darkMat);
  turret.position.set(0, -0.62, 1.15);
  armGroup.add(turret);

  /* Haz láser rojo de espectrometría apuntando a una roca objetivo frente al rover */
  const laserBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.025, 0.35, 8), laserMat);
  laserBeam.position.set(0, -0.78, 1.15);
  armGroup.add(laserBeam);

  rover.add(armGroup);

  /* Roca marciana bajo el brazo del rover */
  const targetRock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.28, 1),
    new THREE.MeshStandardMaterial({ color: 0x7c432b, roughness: 0.92 })
  );
  targetRock.scale.set(1.3, 0.65, 1.1);
  targetRock.position.set(-0.15, 0.12, 2.23);
  rover.add(targetRock);

  return rover;
}

/**
 * Construye el Helicóptero Marciano NASA Ingenuity con rotores coaxiales animados.
 */
export function createIngenuityHelicopterMesh(seed = 0) {
  const heli = new THREE.Group();
  heli.name = 'ingenuityHelicopter';

  const goldMat   = new THREE.MeshStandardMaterial({ color: 0xe2af3c, roughness: 0.3, metalness: 0.8 });
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.5, metalness: 0.5 });
  const solarMat  = new THREE.MeshStandardMaterial({ color: 0x162b4d, roughness: 0.25, metalness: 0.7 });

  /* Fuselaje cúbico térmico (escala ligeramente realzada ~1.8× para apreciarse con claridad a paso humano) */
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.38), goldMat);
  box.position.set(0, 0.42, 0);
  heli.add(box);

  /* Mástil central del rotor */
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.52, 8), carbonMat);
  mast.position.set(0, 0.72, 0);
  heli.add(mast);

  /* Rotor coaxial 1 (inferior) */
  const rotor1 = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.015, 0.14), carbonMat);
  rotor1.position.set(0, 0.78, 0);
  rotor1.userData = { speed: 11.0 };
  animatedRotors.push(rotor1);
  heli.add(rotor1);

  /* Rotor coaxial 2 (superior contrarrotatorio) */
  const rotor2 = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.015, 0.14), carbonMat);
  rotor2.position.set(0, 0.88, 0);
  rotor2.rotation.y = Math.PI / 2;
  rotor2.userData = { speed: -11.0 };
  animatedRotors.push(rotor2);
  heli.add(rotor2);

  /* Panel solar rectangular en la cúspide */
  const solarPanel = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.02, 0.26), solarMat);
  solarPanel.position.set(0, 0.98, 0);
  heli.add(solarPanel);

  /* 4 patas de aterrizaje de fibra de carbono */
  const legAngles = [Math.PI * 0.25, Math.PI * 0.75, -Math.PI * 0.25, -Math.PI * 0.75];
  for (const ang of legAngles) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.65, 6), carbonMat);
    leg.position.set(Math.cos(ang) * 0.32, 0.22, Math.sin(ang) * 0.32);
    leg.rotation.z = -Math.cos(ang) * 0.55;
    leg.rotation.x =  Math.sin(ang) * 0.55;
    heli.add(leg);
  }

  return heli;
}

/**
 * Construye el Módulo Hábitat EVA Presurizado (Domo + Airlock + Paneles Solares + Antena Comms).
 */
export function createMarsHabitatMesh() {
  const hab = new THREE.Group();
  hab.name = 'marsEvaHabitat';

  const whiteMat  = new THREE.MeshStandardMaterial({ color: 0xf0f2f5, roughness: 0.5, metalness: 0.2 });
  const metalMat  = new THREE.MeshStandardMaterial({ color: 0x6e7885, roughness: 0.4, metalness: 0.7 });
  const solarMat  = new THREE.MeshStandardMaterial({ color: 0x15315c, roughness: 0.3, metalness: 0.65 });
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xf6c945 });
  const greenLightMat = new THREE.MeshBasicMaterial({ color: 0x55f29b });

  /* Plataforma circular de cimentación */
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.8, 0.28, 24), metalMat);
  pad.position.set(0, 0.14, 0);
  hab.add(pad);

  /* Cilindro base presurizado y domo hemisférico superior */
  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 2.2, 24), whiteMat);
  cylinder.position.set(0, 1.38, 0);
  hab.add(cylinder);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(3.4, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
    whiteMat
  );
  dome.position.set(0, 2.48, 0);
  hab.add(dome);

  /* Esclusa de aire frontal (Airlock EVA) con baliza verde de acceso seguro */
  const airlock = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.1, 2.2), metalMat);
  airlock.position.set(0, 1.25, 3.6);
  hab.add(airlock);

  const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.65), greenLightMat);
  doorGlow.position.set(0, 1.15, 4.72);
  hab.add(doorGlow);

  /* Luz guía de la esclusa (ilumina el umbral de entrada por la noche) */
  const airlockLight = new THREE.PointLight(0x55f29b, 1.2, 16, 1.8);
  airlockLight.position.set(0, 2.1, 4.9);
  hab.add(airlockLight);

  /* Ventanas iluminadas del hábitat */
  for (const ang of [-0.7, 0.7, 2.1, -2.1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 0.12), windowMat);
    win.position.set(Math.sin(ang) * 3.38, 1.85, Math.cos(ang) * 3.38);
    win.rotation.y = ang;
    hab.add(win);
  }

  /* 2 matrices de paneles solares laterales */
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 1.8), solarMat);
    wing.position.set(side * 5.4, 1.15, -0.5);
    wing.rotation.x = 0.28;
    hab.add(wing);

    const support = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.15, 8), metalMat);
    support.position.set(side * 4.2, 0.6, -0.5);
    hab.add(support);
  }

  /* Antena parabólica de enlace Tierra-Marte sobre el domo */
  const commsPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8), metalMat);
  commsPole.position.set(-1.1, 5.8, -0.8);
  hab.add(commsPole);

  const commsDish = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.45, 16, 1, true), whiteMat);
  commsDish.position.set(-1.1, 6.55, -0.8);
  commsDish.rotation.x = Math.PI * 0.72;
  hab.add(commsDish);

  return hab;
}

/**
 * Construye un Depósito de Tubos de Muestra de Titanio (estilo Three Forks Sample Depot) + Trípode Espectrómetro.
 */
function createSampleDepotMesh() {
  const g = new THREE.Group();
  const titaniumMat = new THREE.MeshStandardMaterial({ color: 0xdce2ea, roughness: 0.25, metalness: 0.85 });
  const goldMat     = new THREE.MeshStandardMaterial({ color: 0xe6b43c, roughness: 0.3,  metalness: 0.8 });
  const cyanMat     = new THREE.MeshBasicMaterial({ color: 0x66fcf1 });
  const darkMat     = new THREE.MeshStandardMaterial({ color: 0x242a33, roughness: 0.6,  metalness: 0.4 });

  /* Trípode científico con baliza cian */
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.28, 0.45), goldMat);
  head.position.set(0, 1.45, 0);
  g.add(head);

  const beaconOrb = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), cyanMat);
  beaconOrb.position.set(0, 1.92, 0);
  g.add(beaconOrb);

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.65, 8), darkMat);
    leg.position.set(Math.cos(a) * 0.38, 0.72, Math.sin(a) * 0.38);
    leg.rotation.z = -Math.cos(a) * 0.28;
    leg.rotation.x =  Math.sin(a) * 0.28;
    g.add(leg);
  }

  /* 3 tubos de muestra de titanio sellados en el suelo alrededor del trípode */
  const tubeOffsets = [
    [-0.95, 0.65, 0.4],
    [ 0.85, 0.75, -0.5],
    [ 0.25, -1.05, 1.1],
  ];
  for (const [tx, tz, rot] of tubeOffsets) {
    const tube = new THREE.Group();
    const cyl  = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.55, 12), titaniumMat);
    cyl.rotation.z = Math.PI / 2;
    const cap  = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.12, 12), goldMat);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = 0.24;
    tube.add(cyl, cap);
    tube.position.set(tx, 0.07, tz);
    tube.rotation.y = rot;
    g.add(tube);
  }

  return g;
}

/**
 * Construye una Baliza de Alerta de Terreno Hostil (POI hazard).
 */
function createHazardWarningRigMesh() {
  const g = new THREE.Group();
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x26292e, roughness: 0.6, metalness: 0.5 });
  const redMat  = new THREE.MeshBasicMaterial({ color: 0xff3855 });
  const ambMat  = new THREE.MeshBasicMaterial({ color: 0xf6c945 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.25, 8), darkMat);
  base.position.set(0, 0.12, 0);
  g.add(base);

  const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.4, 8), darkMat);
  pylon.position.set(0, 1.3, 0);
  g.add(pylon);

  const warnCone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.95, 4), redMat);
  warnCone.position.set(0, 2.85, 0);
  warnCone.rotation.x = Math.PI;
  g.add(warnCone);

  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.35, 12), ambMat);
  stripe.position.set(0, 1.95, 0);
  g.add(stripe);

  return g;
}
