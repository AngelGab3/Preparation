import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createExplorer } from './character.js';

// --- Escena limpia: sin suelo, sin cuadrícula, sin niebla ---
const scene = new T.Scene();
scene.background = new T.Color(0x111413);

const camera = new T.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 50);
camera.position.set(0, 1.3, 3.4);

const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
document.getElementById('stage').appendChild(renderer.domElement);

// Iluminación de estudio para resaltar materiales del traje y visor
const pmrem = new T.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.04);
scene.environment = environment.texture;
scene.environmentIntensity = 0.65;
room.dispose();
pmrem.dispose();

const keyLight = new T.DirectionalLight(0xffeed8, 2.8);
keyLight.position.set(2.5, 4.0, 3.5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.bias = -0.0005;
scene.add(keyLight);

const fillLight = new T.DirectionalLight(0xb4d8e7, 1.4);
fillLight.position.set(-3.0, 1.8, 1.5);
scene.add(fillLight);

const rimLight = new T.DirectionalLight(0xffffff, 2.0);
rimLight.position.set(0, 2.8, -3.2);
scene.add(rimLight);

const ambLight = new T.AmbientLight(0xffffff, 0.45);
scene.add(ambLight);

// Controles orbitales centrados en el pecho del astronauta
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 0.8;
controls.maxDistance = 7.0;
controls.update();

// Modelo del astronauta
const explorer = createExplorer();
scene.add(explorer.root);

// Animación y modos
let mode = 'idle';
let time = 0;
const clock = new T.Clock();

function setMode(newMode) {
  mode = newMode;
  time = 0;
  document.querySelectorAll('[data-mode]').forEach(b => {
    const active = b.dataset.mode === newMode;
    b.setAttribute('aria-pressed', String(active));
    b.classList.toggle('active', active);
  });
}

document.querySelectorAll('[data-mode]').forEach(b => {
  b.onclick = () => setMode(b.dataset.mode);
});

const resetCamBtn = document.getElementById('reset-cam');
if (resetCamBtn) {
  resetCamBtn.onclick = () => {
    camera.position.set(0, 1.3, 3.4);
    controls.target.set(0, 0.95, 0);
    controls.update();
  };
}

// Atajos de teclado: 1: Reposo, 2: Mirar, 3: Escáner, 4: Caminar
window.addEventListener('keydown', (e) => {
  if (e.key === '1') setMode('idle');
  else if (e.key === '2') setMode('turn');
  else if (e.key === '3') setMode('scan');
  else if (e.key === '4') setMode('walk');
  else if (e.key === 'r' || e.key === 'R') resetCamBtn?.click();
});

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
window.addEventListener('resize', resize);

const loadingEl = document.getElementById('loading');
if (loadingEl) loadingEl.hidden = true;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;

  explorer.pose(time, mode);
  controls.update();
  renderer.render(scene, camera);
}

tick();
