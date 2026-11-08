/* Modelos 3D procedurales a escala humana (1 unidad = 1 metro) en la superficie marciana (Fase E · E2):
 * - Rover NASA Perseverance (chasis, MMRTG, 6 ruedas rocker-bogie, mástil SuperCam animado y brazo robótico PIXL/SHERLOC)
 * - Helicóptero NASA Ingenuity (fuselaje kapton dorado, 4 patas de fibra de carbono y doble rotor coaxial animado)
 * - Módulo Hábitat EVA Presurizado (domo, esclusa airlock, paneles solares, antena de alta ganancia y plataforma)
 * - Depósitos de Tubos de Muestra de Titanio (Three Forks Sample Depot) y Balizas de Peligro
 */

import * as THREE from 'three';
import { state } from './state.js';
import { sampleGroundY } from './raycast.js';

const animatedRotors = [];
const animatedMasts  = [];
const animatedPulses = [];
let companionRover = null;

export function clearAnimatedArtifactsRegistry() {
  animatedRotors.length = 0;
  animatedMasts.length  = 0;
  animatedPulses.length = 0;
  companionRover = null;
}

export function tickArtifactsAnimation(dt, elapsed_s) {
  for (const rotor of animatedRotors) {
    rotor.rotation.y += dt * (rotor.userData.speed || 9.0);
  }
  for (const mast of animatedMasts) {
    if (mast.userData.isCompanionMast && state.mode === 'fp') continue;
    const baseYaw = mast.userData.baseYaw || 0;
    mast.rotation.y = baseYaw + Math.sin(elapsed_s * 0.9 + (mast.userData.phase || 0)) * 0.45;
  }
  for (const pulse of animatedPulses) {
    const s = 1.0 + 0.14 * Math.sin(elapsed_s * 3.2 + (pulse.userData.phase || 0));
    pulse.scale.set(s, 1, s);
  }

  tickCompanionRover(dt, elapsed_s);
}

/* Hace que el Rover del asentamiento ("Robert") siga al astronauta como mascota robótica en la superficie */
function tickCompanionRover(dt, elapsed_s) {
  if (!companionRover || !companionRover.parent) return;
  const ud = companionRover.userData;
  const { cx_m, cz_m } = ud.shelterBase;
  const cy_m = sampleGroundY(cx_m, cz_m) ?? ud.shelterBase.cy_m;

  if (state.mode !== 'fp') {
    /* En vista orbital se mantiene junto al asentamiento */
    const wy = sampleGroundY(ud.worldX, ud.worldZ) ?? cy_m;
    companionRover.position.set(ud.worldX - cx_m, wy - cy_m, ud.worldZ - cz_m);
    return;
  }

  const ax = state.astronautPosition.x;
  const az = state.astronautPosition.z;

  /* Si el astronauta apareció muy lejos (> 85 m), acercar a Robert a 10 m detrás para que llegue rodando */
  const rawDx = ax - ud.worldX;
  const rawDz = az - ud.worldZ;
  const rawDist = Math.hypot(rawDx, rawDz);
  if (rawDist > 85) {
    const ang = Math.atan2(rawDx, rawDz);
    ud.worldX = ax - Math.sin(ang) * 10.0;
    ud.worldZ = az - Math.cos(ang) * 10.0;
    ud.yaw = ang;
  }

  /* Punto de acompañamiento: ~3.2 m a un costado del astronauta para verlo bien sin chocar */
  const toRoverAng = Math.atan2(ud.worldX - ax, ud.worldZ - az);
  const followDist = 3.2;
  const goalX = THREE.MathUtils.clamp(ax + Math.sin(toRoverAng) * followDist, -state.boundsX, state.boundsX);
  const goalZ = THREE.MathUtils.clamp(az + Math.cos(toRoverAng) * followDist, -state.boundsZ, state.boundsZ);

  const gx = goalX - ud.worldX;
  const gz = goalZ - ud.worldZ;
  const gDist = Math.hypot(gx, gz);

  let stepDist = 0;
  if (gDist > 0.25) {
    const moveYaw = Math.atan2(gx, gz);
    const diffYaw = Math.atan2(Math.sin(moveYaw - ud.yaw), Math.cos(moveYaw - ud.yaw));
    ud.yaw += diffYaw * Math.min(1, dt * 5.5);

    const speed = Math.min(3.6, 0.85 + gDist * 0.9);
    stepDist = Math.min(gDist, speed * dt);
    ud.worldX += (gx / gDist) * stepDist;
    ud.worldZ += (gz / gDist) * stepDist;
  }

  const wy = sampleGroundY(ud.worldX, ud.worldZ) ?? cy_m;
  companionRover.position.set(ud.worldX - cx_m, wy - cy_m, ud.worldZ - cz_m);

  /* Inclinación suave (pitch/roll) según la pendiente del terreno bajo las ruedas */
  const sYaw = Math.sin(ud.yaw);
  const cYaw = Math.cos(ud.yaw);
  const yFront = sampleGroundY(ud.worldX + sYaw * 1.1, ud.worldZ + cYaw * 1.1) ?? wy;
  const yBack  = sampleGroundY(ud.worldX - sYaw * 1.1, ud.worldZ - cYaw * 1.1) ?? wy;
  const targetPitch = THREE.MathUtils.clamp(-Math.atan2(yFront - yBack, 2.2), -0.38, 0.38);
  ud.pitch = (ud.pitch || 0) + (targetPitch - (ud.pitch || 0)) * Math.min(1, dt * 8);

  companionRover.rotation.order = 'YXZ';
  companionRover.rotation.y = ud.yaw;
  companionRover.rotation.x = ud.pitch;

  /* Girar las 6 ruedas al avanzar */
  if (stepDist > 1e-4 && Array.isArray(ud.wheels)) {
    const dRot = stepDist / 0.27;
    for (const w of ud.wheels) {
      w.rotation.x += dRot;
    }
  }

  /* Cabezal SuperCam / Mastcam-Z mirando curiosamente al astronauta como mascota */
  if (ud.mastHead) {
    const lookWorldYaw = Math.atan2(ax - ud.worldX, az - ud.worldZ);
    const relYaw = THREE.MathUtils.clamp(
      Math.atan2(Math.sin(lookWorldYaw - ud.yaw), Math.cos(lookWorldYaw - ud.yaw)),
      -1.35,
      1.35
    );
    ud.mastHead.rotation.y += (relYaw - ud.mastHead.rotation.y) * Math.min(1, dt * 6);
    ud.mastHead.rotation.z = Math.sin(elapsed_s * 2.4) * 0.07;
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
    /* COMPLEJO DE ATERRIZAJE: Hábitat EVA + Rover Perseverance ("Robert", compañero móvil) + Helicóptero Ingenuity */
    const habitat = createMarsHabitatMesh();
    placeOnGround(habitat, 0, 0, 0);

    // Un único Robert: conservar el rover del último refugio, que ya era el compañero móvil.
    const roverHome = state.pois.filter((p) => p.type === 'shelter').at(-1);
    if (poi === roverHome) {
      const perseverance = createPerseveranceRoverMesh(poiIndex, true);
      perseverance.rotation.y = 0.45;
      placeOnGround(perseverance, 8.5, 5.0, 0);
      perseverance.userData.shelterBase = { cx_m, cz_m, cy_m };
      perseverance.userData.worldX = cx_m + 8.5;
      perseverance.userData.worldZ = cz_m + 5.0;
      perseverance.userData.yaw = 0.45;
      companionRover = perseverance;
    }

    const ingenuity = createIngenuityHelicopterMesh(poiIndex);
    ingenuity.rotation.y = -0.3;
    placeOnGround(ingenuity, 4.8, 9.2, 0);
  } else if (poi.type === 'sampling') {
    /* SITIO DE MUESTREO CIENTÍFICO: Depósito de tubos de muestra + Estación espectrométrica (+ Rover en sitios clave) */
    const depot = createSampleDepotMesh(poiIndex);
    placeOnGround(depot, 0, 0, 0);


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
export function createPerseveranceRoverMesh(seed = 0, isCompanion = false) {
  const rover = new THREE.Group();
  rover.name = isCompanion ? 'companionRoverRobert' : 'perseveranceRover';
  rover.userData.wheels = [];

  const shell = new THREE.MeshStandardMaterial({ color: 0xe6dfd0, roughness: 0.7, metalness: 0.2 });
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xf5eee0, roughness: 0.54, metalness: 0.12 });
  const foil = new THREE.MeshStandardMaterial({ color: 0x8b6034, roughness: 0.72, metalness: 0.42 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xb16a3a, roughness: 0.52, metalness: 0.58 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x252629, roughness: 0.88 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x373533, roughness: 0.96 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9c9b91, roughness: 0.48, metalness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x10151a, roughness: 0.16, metalness: 0.22 });

  const part = (parent, geometry, material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (parent, dimensions, material, x, y, z) =>
    part(parent, new THREE.BoxGeometry(...dimensions), material, x, y, z);
  const cylinder = (parent, radius, height, material, x, y, z, sides = 12) =>
    part(parent, new THREE.CylinderGeometry(radius, radius, height, sides), material, x, y, z);
  const beam = (parent, from, to, radius, material) => {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const direction = end.clone().sub(start);
    const mesh = cylinder(parent, radius, direction.length(), material,
      (start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  };

  // Seis ruedas con nervaduras y aros que giran junto con la llanta.
  for (const side of [-1, 1]) {
    for (const z of [1.08, 0, -1.08]) {
      const x = side * (z === 0 ? 1.18 : 1.12);
      const wheel = new THREE.Group();
      wheel.position.set(x, .29, z);
      rover.add(wheel);
      const rim = cylinder(wheel, .285, .26, tire, 0, 0, 0, 20);
      rim.rotation.z = Math.PI / 2;
      const inner = cylinder(wheel, .19, .275, metal, 0, 0, 0, 20);
      inner.rotation.z = Math.PI / 2;
      const outerX = side * .151;
      const ring = part(wheel, new THREE.TorusGeometry(.17, .023, 6, 20), copper, outerX, 0, 0);
      ring.rotation.y = Math.PI / 2;
      const axle = cylinder(wheel, .075, .32, carbon, outerX, 0, 0);
      axle.rotation.z = Math.PI / 2;
      for (let i = 0; i < 14; i++) {
        const angle = i * Math.PI * 2 / 14;
        const lug = box(wheel, [.275, .022, .065], carbon, 0,
          Math.cos(angle) * .286, Math.sin(angle) * .286);
        lug.rotation.x = angle;
      }
      rover.userData.wheels.push(wheel);
    }

    // Rocker-bogie: dos articulaciones por costado y barras de suspensión expuestas.
    const x = side * .83;
    const pivot = part(rover, new THREE.SphereGeometry(.11, 10, 8), metal, x, .73, .06);
    pivot.name = 'rockerPivot';
    beam(rover, [x, .73, .06], [side * 1.12, .33, 1.08], .055, metal);
    beam(rover, [x, .73, .06], [side * 1.02, .51, -.55], .055, metal);
    beam(rover, [side * 1.02, .51, -.55], [side * 1.18, .33, 0], .047, metal);
    beam(rover, [side * 1.02, .51, -.55], [side * 1.12, .33, -1.08], .047, metal);
    beam(rover, [side * .78, .65, .65], [side * 1.12, .42, 1.08], .026, copper);
  }

  // Cuerpo de electrónica y aislamiento térmico dorado, bajo una cubierta ancha.
  box(rover, [1.55, .55, 2.12], foil, 0, .83, 0);
  box(rover, [1.62, .16, 2.18], carbon, 0, .53, 0);
  box(rover, [1.62, .28, 1.86], shell, 0, 1.04, -.08);
  for (const side of [-1, 1]) {
    box(rover, [.055, .22, 1.62], foil, side * .82, .84, 0);
    for (const z of [-.65, -.2, .25, .7]) {
      box(rover, [.025, .13, .06], copper, side * .86, .84, z);
    }
  }
  box(rover, [1.96, .09, 2.46], carbon, 0, 1.23, 0);
  for (const side of [-1, 1]) {
    box(rover, [.75, .055, 2.52], shell, side * 1.36, 1.23, .02);
    box(rover, [.62, .012, 2.18], carbon, side * 1.36, 1.27, .02);
    for (const z of [-.78, -.27, .24, .75]) {
      box(rover, [.62, .014, .025], copper, side * 1.36, 1.28, z);
    }
  }
  box(rover, [.62, .12, .45], ceramic, 0, 1.29, 1.0);
  box(rover, [.22, .045, .12], copper, 0, 1.37, 1.1);

  // Generador trasero, aletas y cableado visible en la cubierta.
  const generator = cylinder(rover, .24, .85, shell, 0, 1.48, -1.2);
  generator.rotation.x = -.55;
  for (const z of [-1.48, -1.3, -1.12, -.94]) {
    box(rover, [.57, .43, .035], metal, 0, 1.51, z);
  }
  beam(rover, [-.52, 1.28, -.78], [-.52, 1.53, -1.21], .022, copper);
  beam(rover, [-.48, 1.53, -1.21], [.12, 1.51, -1.22], .022, copper);

  // Antena de plato y antena vertical independientes del cabezal móvil.
  beam(rover, [-.53, 1.25, -.55], [-.53, 1.75, -.55], .035, metal);
  const dish = cylinder(rover, .31, .045, copper, -.53, 1.8, -.55, 24);
  dish.rotation.x = -.38;
  cylinder(rover, .07, .058, carbon, -.53, 1.83, -.55);
  beam(rover, [.57, 1.26, -.73], [.57, 2.0, -.73], .018, metal);
  cylinder(rover, .045, .08, shell, .57, 2.03, -.73);

  // Mástil alto y barra de cámaras estéreo, inspirado en la silueta de la referencia.
  beam(rover, [.27, 1.28, .35], [.27, 2.43, .35], .085, ceramic);
  for (const y of [1.47, 1.72, 1.97]) {
    cylinder(rover, .095, .055, metal, .27, y, .35);
  }
  const mastHead = new THREE.Group();
  mastHead.position.set(.27, 2.48, .35);
  mastHead.userData = { baseYaw: 0, phase: seed * 1.7, isCompanionMast: isCompanion };
  box(mastHead, [1.05, .17, .25], shell, 0, 0, 0);
  box(mastHead, [.22, .21, .28], metal, 0, -.13, 0);
  for (const side of [-1, 1]) {
    box(mastHead, [.27, .25, .31], ceramic, side * .38, .08, .09);
    const lensRim = cylinder(mastHead, .09, .035, copper, side * .38, .08, .265, 18);
    lensRim.rotation.x = Math.PI / 2;
    const lens = cylinder(mastHead, .067, .039, glass, side * .38, .08, .29, 18);
    lens.rotation.x = Math.PI / 2;
    cylinder(mastHead, .026, .048, metal, side * .38, .08, .315);
  }
  box(mastHead, [.21, .18, .31], carbon, 0, .085, .12);
  const superCam = cylinder(mastHead, .078, .08, glass, 0, .085, .3, 18);
  superCam.rotation.x = Math.PI / 2;
  rover.userData.mastHead = mastHead;
  animatedMasts.push(mastHead);
  rover.add(mastHead);

  // Brazo robótico frontal de dos tramos, articulaciones y torreta de muestras.
  const armGroup = new THREE.Group();
  armGroup.position.set(-.5, .92, 1.05);
  cylinder(armGroup, .16, .22, metal, 0, 0, 0);
  beam(armGroup, [0, 0, .05], [-.38, -.22, .54], .073, ceramic);
  cylinder(armGroup, .12, .18, copper, -.38, -.22, .54);
  beam(armGroup, [-.38, -.22, .54], [-.62, -.46, 1.08], .057, metal);
  cylinder(armGroup, .16, .21, carbon, -.62, -.46, 1.08);
  box(armGroup, [.23, .16, .23], ceramic, -.62, -.53, 1.2);
  for (const side of [-1, 1]) {
    beam(armGroup, [-.62 + side * .065, -.55, 1.2],
      [-.62 + side * .15, -.61, 1.34], .019, metal);
  }
  if (isCompanion) armGroup.rotation.x = -.18;
  rover.add(armGroup);

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

  const shell = new THREE.MeshStandardMaterial({ color: 0xeae4d9, roughness: 0.7, metalness: 0.18 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x9b9b96, roughness: 0.48, metalness: 0.62 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2f363b, roughness: 0.72, metalness: 0.25 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x304c55, roughness: 0.16, metalness: 0.25, emissive: 0x10272e, emissiveIntensity: 0.35 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xbd7852, roughness: 0.58, metalness: 0.42 });
  const solar = new THREE.MeshStandardMaterial({ color: 0x1c3441, roughness: 0.3, metalness: 0.5 });
  const entry = new THREE.MeshBasicMaterial({ color: 0x72edbd });

  const part = (parent, geometry, material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (parent, size, material, x, y, z) =>
    part(parent, new THREE.BoxGeometry(...size), material, x, y, z);
  const tube = (parent, radius, length, material, x, y, z, sides = 16) =>
    part(parent, new THREE.CylinderGeometry(radius, radius, length, sides), material, x, y, z);
  const beam = (parent, from, to, radius, material) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const mesh = tube(parent, radius, dir.length(), material,
      (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, 8);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return mesh;
  };

  // Núcleo presurizado compacto: diámetro 2.8 m, sin la antigua plataforma de 9.6 m.
  tube(hab, 1.48, .18, trim, 0, .14, 0, 24);
  for (const a of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    const x = Math.sin(a) * 1.1, z = Math.cos(a) * 1.1;
    tube(hab, .075, .44, trim, x, .39, z, 8);
  }
  tube(hab, 1.38, 1.56, shell, 0, 1.39, 0, 24);
  const dome = part(hab,
    new THREE.SphereGeometry(1.38, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    shell, 0, 2.17, 0);
  dome.name = 'habitatDome';
  const ring = part(hab, new THREE.TorusGeometry(1.4, .045, 8, 32), copper, 0, 2.17, 0);
  ring.rotation.x = Math.PI / 2;
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI * 2 / 10;
    beam(hab, [Math.sin(a) * 1.36, 2.19, Math.cos(a) * 1.36],
      [Math.sin(a) * .22, 3.53, Math.cos(a) * .22], .025, trim);
    if (i % 2 === 0) {
      const window = box(hab, [.31, .3, .06], glass,
        Math.sin(a) * 1.385, 1.51, Math.cos(a) * 1.385);
      window.rotation.y = a;
    }
  }
  tube(hab, .24, .08, dark, 0, 3.53, 0, 12);

  // Dos módulos cilíndricos pequeños con remates curvos, unidos al núcleo.
  for (const side of [-1, 1]) {
    const connector = tube(hab, .46, .78, trim, side * 1.56, 1.38, -.12, 16);
    connector.rotation.z = Math.PI / 2;
    const inner = tube(hab, .39, .82, dark, side * 1.56, 1.38, -.12, 16);
    inner.rotation.z = Math.PI / 2;

    const pod = new THREE.Group();
    pod.position.set(side * 3.03, 1.27, -.12);
    pod.rotation.y = side * Math.PI / 2;
    hab.add(pod);
    const barrel = tube(pod, .82, 1.9, shell, 0, 0, 0, 20);
    barrel.rotation.x = Math.PI / 2;
    for (const z of [-.95, .95]) {
      const cap = part(pod, new THREE.SphereGeometry(.82, 18, 10), shell, 0, 0, z);
      cap.scale.z = .53;
    }
    for (const z of [-.78, 0, .78]) {
      const hoop = part(pod, new THREE.TorusGeometry(.83, .025, 6, 24), copper, 0, 0, z);
      hoop.name = 'pressureHoop';
    }
    for (const z of [-.4, .4]) {
      const window = box(pod, [.045, .27, .33], glass, .82, .12, z);
      window.rotation.z = -.08;
      const opposite = box(pod, [.045, .27, .33], glass, -.82, .12, z);
      opposite.rotation.z = .08;
    }
    for (const z of [-.65, .65]) {
      for (const x of [-.5, .5]) {
        beam(pod, [x, -.55, z], [x * 1.12, -1.2, z], .055, trim);
        box(pod, [.27, .06, .2], dark, x * 1.12, -1.22, z);
      }
    }
    box(pod, [.68, .045, 1.3], dark, 0, .83, 0);
  }

  // Esclusa frontal con luz de acceso y rampa corta.
  box(hab, [1.25, 1.45, 1.38], shell, 0, 1.17, 2.01);
  box(hab, [1.28, .12, 1.4], trim, 0, 1.89, 2.01);
  box(hab, [.88, 1.23, .055], dark, 0, 1.13, 2.73);
  box(hab, [.68, 1.05, .06], glass, 0, 1.13, 2.77);
  box(hab, [.72, .065, .07], entry, 0, 1.77, 2.79);
  const ramp = box(hab, [.9, .06, .84], trim, 0, .3, 3.08);
  ramp.rotation.x = -.24;
  const airlockLight = new THREE.PointLight(0x72edbd, .8, 6, 1.8);
  airlockLight.position.set(0, 1.83, 2.84);
  hab.add(airlockLight);

  // Paneles solares detrás de la estación, sin ampliar la huella lateral.
  for (const side of [-1, 1]) {
    const x = side * 2.13;
    box(hab, [2.18, .055, .85], dark, x, 1.15, -2.2);
    box(hab, [2.03, .012, .72], solar, x, 1.19, -2.2);
    for (const stripe of [-.54, 0, .54]) {
      box(hab, [.02, .014, .72], trim, x + stripe, 1.2, -2.2);
    }
    beam(hab, [x, 1.1, -2.2], [x, .12, -2.2], .045, trim);
  }

  // Antena y baliza de comunicaciones sobre el núcleo.
  beam(hab, [-.44, 3.3, -.24], [-.44, 4.04, -.24], .035, trim);
  const dish = tube(hab, .35, .05, shell, -.44, 4.03, -.24, 20);
  dish.rotation.x = -.42;
  tube(hab, .065, .08, copper, -.44, 4.07, -.24, 10);
  beam(hab, [.45, 3.36, -.17], [.45, 4.12, -.17], .018, trim);
  part(hab, new THREE.SphereGeometry(.065, 8, 6), entry, .45, 4.15, -.17);

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
