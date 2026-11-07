/* Overlay de métricas de rendimiento (activar con ?stats=1): FPS, frame time, triángulos,
   draw calls, geometrías/texturas en GPU, chunks LOD y heap JS (solo Chrome). */

import { renderer } from './scene.js';
import { state } from './state.js';

let el = null;
let frames = 0;
let acc = 0;
let worst = 0;
let last = performance.now();

export function initStats() {
  if (new URLSearchParams(window.location.search).get('stats') !== '1') return;
  el = document.createElement('pre');
  el.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:9999;margin:0;padding:6px 9px;' +
    'font:11px/1.35 ui-monospace,Menlo,monospace;color:#9fffb0;background:rgba(0,0,0,.65);' +
    'border:1px solid #2a5;border-radius:4px;pointer-events:none;white-space:pre';
  document.body.appendChild(el);
}

export function tickStats() {
  if (!el) return;
  const now = performance.now();
  const dt = now - last;
  last = now;
  frames++; acc += dt; worst = Math.max(worst, dt);
  if (acc < 500) return;
  const info = renderer.info;
  const mem = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : 'n/d';
  const lod = state.lodStats ? `${state.lodStats.visible} vis / ${state.lodStats.cached} cache (d${state.lodStats.maxDepth})` : 'off';
  el.textContent =
    `FPS ${(frames * 1000 / acc).toFixed(0)}  frame ${(acc / frames).toFixed(1)} ms (peor ${worst.toFixed(0)})\n` +
    `Tris ${info.render.triangles.toLocaleString()}  Calls ${info.render.calls}\n` +
    `Geo ${info.memory.geometries}  Tex ${info.memory.textures}  Heap ${mem}\n` +
    `LOD ${lod}  modo ${state.mode}`;
  frames = 0; acc = 0; worst = 0;
}
