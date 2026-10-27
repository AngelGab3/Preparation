/* Escena, cámara, renderer y luces. Exporta la cámara y el renderer
   porque los demás módulos los necesitan para raycastear. */

import * as THREE from 'three';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d10);

export const camera = new THREE.PerspectiveCamera(
  60, window.innerWidth / window.innerHeight, 0.2, 500000
);
camera.up.set(0, 0, -1);       // vista cenital (evita gimbal lock)
camera.position.set(0, 40000, 0);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app').appendChild(renderer.domElement);

/* Luces */
export const hemiLight = new THREE.HemisphereLight(0xffd9c0, 0x241811, 1.1);
scene.add(hemiLight);

export const sun = new THREE.DirectionalLight(0xfff1e0, 2.2);
sun.position.set(-14000, 20000, 11000);
scene.add(sun);

export const fill = new THREE.DirectionalLight(0x8fb4ff, 0.35);
fill.position.set(12000, 6000, -14000);
scene.add(fill);

/* Linterna frontal EVA en el casco para exploración nocturna / crepuscular en 1ª persona */
export const headlampSpot = new THREE.SpotLight(0xeaf4ff, 0, 85, Math.PI / 4.2, 0.35, 1.2);
headlampSpot.position.set(0, 0, 0);
camera.add(headlampSpot);
camera.add(headlampSpot.target);
headlampSpot.target.position.set(0, 0, -20);

export const headlampFill = new THREE.PointLight(0xeaf4ff, 0, 16, 1.4);
camera.add(headlampFill);
scene.add(camera);

/* Referencia retrocompatible para el resto de módulos */
export const headlamp = {
  set intensity(v) {
    headlampSpot.intensity = v * 2.4;
    headlampFill.intensity = v * 0.75;
  },
  get intensity() {
    return headlampSpot.intensity;
  }
};

/* ------------------------------------------- Domo Atmosférico Marciano Físico (Skydome) */
function createMartianAtmosphericDome() {
  const geo = new THREE.SphereGeometry(1, 36, 24);
  geo.scale(-1, 1, 1); // Invertir normales hacia el interior de la cúpula

  const vertexShader = `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `;

  const fragmentShader = `
    uniform vec3 topColor;       // Color en el cenit marciano
    uniform vec3 bottomColor;    // Color en el horizonte (butterscotch / salmón / niebla)
    uniform vec3 sunDirection;   // Dirección normalizada del Sol
    uniform vec3 mieColor;       // Color del halo de dispersión frontal Mie
    uniform float mieIntensity;  // Intensidad del halo solar
    uniform float opacity;       // Opacidad general (1 diurno -> 0 nocturno)
    uniform float horizonBias;   // Curvatura del gradiente vertical
    varying vec3 vWorldPosition;

    void main() {
      vec3 dir = normalize(vWorldPosition);
      float h = clamp(dir.y * 1.6 + horizonBias, 0.0, 1.0);
      float grad = pow(h, 0.65);

      // Mezcla base del gradiente vertical marciano (Horizonte butterscotch -> Cenit ocre oscuro)
      vec3 sky = mix(bottomColor, topColor, grad);

      // Dispersión frontal Mie alrededor del disco solar (cono azul en atardecer, dorado en día)
      float cosTheta = max(dot(dir, sunDirection), 0.0);
      float mie = pow(cosTheta, 28.0) * mieIntensity;
      float wideMie = pow(cosTheta, 6.0) * (mieIntensity * 0.28);
      sky += mieColor * (mie + wideMie);

      gl_FragColor = vec4(sky, opacity);
    }
  `;

  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      topColor:      { value: new THREE.Color(0x754328) },
      bottomColor:   { value: new THREE.Color(0xdca678) },
      sunDirection:  { value: new THREE.Vector3(0, 1, 0) },
      mieColor:      { value: new THREE.Color(0xffeed6) },
      mieIntensity:  { value: 0.65 },
      opacity:       { value: 1.0 },
      horizonBias:   { value: 0.12 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    transparent: true,
    fog: false,
  });

  const dome = new THREE.Mesh(geo, mat);
  dome.scale.setScalar(80000);
  scene.add(dome);
  return dome;
}

export const skydome = createMartianAtmosphericDome();

/* ------------------------------------------- Luna Marciana: Fobos (Phobos) en el cielo nocturno */
function createPhobosMoonSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  /* Silueta irregular ovoide tipo asteroide capturado */
  ctx.save();
  ctx.translate(64, 64);
  ctx.scale(1.15, 0.88);
  const grad = ctx.createRadialGradient(-10, -12, 4, 0, 0, 48);
  grad.addColorStop(0.0, '#f2ece4');
  grad.addColorStop(0.45, '#c5beb4');
  grad.addColorStop(0.85, '#6a645d');
  grad.addColorStop(1.0, 'rgba(30, 28, 25, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 46, 0, Math.PI * 2);
  ctx.fill();

  /* Cráter Stickney */
  ctx.fillStyle = 'rgba(60, 55, 50, 0.45)';
  ctx.beginPath();
  ctx.ellipse(-14, -8, 14, 11, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: 0xdfdcd8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(2600);
  scene.add(sprite);
  return sprite;
}

export const phobosMoon = createPhobosMoonSprite();

/* Disco solar físico en el cielo marciano (~0.35° de diámetro angular + halo de dispersión Mie) */
function createMartianSunDisc() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(128, 128, 2, 128, 128, 126);
  grad.addColorStop(0.0,  'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.11, 'rgba(255, 244, 224, 0.96)');
  grad.addColorStop(0.26, 'rgba(255, 198, 145, 0.42)');
  grad.addColorStop(0.55, 'rgba(135, 175, 235, 0.14)'); // Cono azulado de dispersión Mie hacia adelante
  grad.addColorStop(1.0,  'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: 0xfff2e2,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(6500);
  scene.add(sprite);
  return sprite;
}

export const sunDisc = createMartianSunDisc();

/* Resize */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ------------------------------------------------------------- Estrellas */
function createStars() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.2, 'rgba(235, 245, 255, 0.85)');
  grad.addColorStop(0.5, 'rgba(180, 210, 255, 0.25)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const starTexture = new THREE.CanvasTexture(canvas);

  const starCount = 3500;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);

  const palette = [
    new THREE.Color(0xffffff), // Blanco puro
    new THREE.Color(0xd6e8ff), // Azul tenue
    new THREE.Color(0xffeedd), // Blanco cálido
    new THREE.Color(0xffd2a6), // Anaranjado estelar sutil
  ];

  for (let i = 0; i < starCount; i++) {
    /* Esfera celeste normalizada (radio entre 1.0 y 1.9); se escala según dim_m del terreno */
    const r = 1.0 + Math.random() * 0.9;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const c = palette[Math.floor(Math.random() * palette.length)];
    const brightness = 0.5 + Math.random() * 0.5;
    colors[i * 3]     = c.r * brightness;
    colors[i * 3 + 1] = c.g * brightness;
    colors[i * 3 + 2] = c.b * brightness;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 4,
    sizeAttenuation: false, // Tamaño en píxeles de pantalla independiente de la escala en metros
    map: starTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false, // Inmune a la niebla del terreno para verse siempre nítidas
  });

  const stars = new THREE.Points(geo, mat);
  stars.scale.setScalar(100000);
  scene.add(stars);
  return stars;
}

export const stars = createStars();
