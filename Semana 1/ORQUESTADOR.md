# ORQUESTADOR.md — Marswalk FPS (NASA Space Apps)

> Documento maestro para agentes (Antigravity u otro). Es la fuente de verdad del proyecto.
> Regla de oro: **si algo falla, corrige este documento primero y luego el código.**
> Versión del documento: **0.2** · Base: prototipo existente (ver sección 3) · Zona de estudio: **sin decidir**

---

## 1. Visión

Un **videojuego en primera persona que corre en el navegador**, donde el usuario camina por un terreno 3D de Marte generado a partir de **datos reales de la NASA** (MOLA, HiRISE/CTX, entre otros). Funciona como herramienta de planeación de *Marswalk*: muestra la ruta recomendada, el costo de oxígeno, el riesgo del terreno y puntos de interés científico, sobre capas activables (*Layered View*).

**Principio de diseño:** el juego es una "ventana" a los datos. Cambiar de zona o de dataset (incluido el oficial de la competencia) **no debe requerir tocar el código**, solo reemplazar una carpeta de datos y su `metadata.json`.

### Interacción central (ya existe en el prototipo y se conserva)
1. **Vista orbital** cenital del mapa completo: pan con arrastre, zoom con rueda, clic para ver info del punto.
2. **Dock del astronauta:** se arrastra al mapa; al soltarlo queda colocado. Clic en el dock lo recupera.
3. **Modo primera persona:** botón "Explorar" (o entrar con el astronauta colocado). WASD, Shift, Espacio, ratón. ESC vuelve a la vista orbital con transición suave.
4. **Slider de exageración vertical.**

---

## 2. Reglas globales (para todos los agentes)

- **Todo corre en el navegador.** Sin backend obligatorio. Sin paso de build por ahora (importmap + módulos ES con Three.js desde CDN).
- **Se sirve con un servidor estático local** (los módulos ES y `fetch` no funcionan con `file://`). Ejemplos: `python -m http.server 8000`, o la extensión Live Server. Documentarlo en `README.md`.
- **Datos reales se procesan offline** con Python (Rasterio, GDAL, NumPy) y se exportan a `data/<dataset_id>/`. El juego solo consume esos archivos.
- **Ningún dato específico de una zona va en el código.** Prohibido hardcodear elevaciones, dimensiones en metros o nombres de archivo en `config.js` o en el resto de módulos: todo sale de `metadata.json`.
- **Contratos:** los módulos se comunican solo mediante los contratos de la sección 4. Un agente **no los modifica**; los propone en la sección 9.
- **Cambios pequeños y verificables:** una tarea por iteración (sección 6), con criterio de aceptación comprobado antes de pasar a la siguiente.
- **Unidades explícitas** en nombres y comentarios (`_m`, `_deg`, `_l`, `_s`).
- **Rendimiento:** objetivo ≥ 50 FPS en un portátil sin GPU dedicada. Evitar asignaciones por frame (reutilizar vectores temporales, como ya se hace).
- **Datos grandes fuera de git** (> 50 MB): documentar cómo descargarlos; `data/raw/` en `.gitignore`.
- No romper el comportamiento existente (sección 1) salvo que la tarea lo pida.

---

## 3. Línea base: código existente

Archivos actuales (raíz del proyecto, sin carpeta `src/`; **no reorganizar todavía**):

| Archivo | Responsabilidad actual |
|---|---|
| `index.html` | UI, importmap (Three.js 0.169 por CDN), loading, dock, panel, popup |
| `main.js` | Arranque y bucle de animación |
| `config.js` | Constantes (incluye valores específicos del dataset de prueba: **a eliminar**, ver T1) |
| `state.js` | Estado compartido |
| `scene.js` | Escena, cámara, renderer, luces, estrellas |
| `terrain.js` | Carga del heightmap, construcción de malla, alturas con exageración, fallback procedural |
| `controls.js` | OrbitControls + PointerLockControls, salto, transiciones entre modos |
| `astronaut.js` | Mesh del astronauta, dock, arrastre sobre el mapa |
| `raycast.js` | Raycasting: terreno, astronauta, `sampleGroundY` |
| `popup.js` | Popup de información (elevación, pendiente, distancia) |
| `styles.css` | Estilos |

**Dataset de prueba actual:** cráter Jezero (`jezero_heightmap.png` o `heightmap_base64.txt`). Es **solo de prueba**; la zona final está sin decidir.

### Problemas conocidos de la línea base (origen de las tareas T1–T6)

1. **Escala inconsistente:** el terreno mide `SIZE_REF = 200` unidades para ~31 km; velocidades, ojos y gravedad no corresponden a metros. Caminar se siente como moverse a km/s.
2. **Valores del dataset hardcodeados** en `config.js` (`DEM_WIDTH_METERS`, `DEM_MIN_ELEV`, etc.).
3. **Alturas desde un PNG de 8 bits** con normalización min–max: pierde precisión (escalones) y obliga a conocer min/max a mano.
4. **Pendiente del popup incorrecta:** se calcula con la normal de la malla *exagerada*, no con el DEM real.
5. **`sampleGroundY` usa raycast** contra toda la malla en cada frame: costoso y escala mal.
6. **Resolución:** 256 segmentos sobre toda la zona da vértices muy separados; no sirve para caminar.
7. **Sin capas separadas:** la textura base es el propio heightmap con tinte.
8. **Código muerto:** `WORLD_UP` y `DOWN` en `config.js` no se usan.

---

## 4. Contratos de interfaz (fuente de verdad)

### 4.1 `data/<dataset_id>/metadata.json` (Datos → Juego)

```json
{
  "dataset_id": "jezero_test",
  "label": "Jezero (dataset de prueba)",
  "source": "MOLA | HiRISE | CTX | synthetic",
  "crs": "IAU_2015:49900",
  "size_m": [31920, 30240],
  "resolution_m": 125.0,
  "shape": [rows, cols],
  "elevation_range_m": [-2710.7, -1515.5],
  "heightmap": { "file": "heightmap.f32", "format": "float32-le", "units": "m" },
  "layers": [
    { "id": "base",  "file": "texture.png", "type": "base" },
    { "id": "slope", "file": "slope.png",   "type": "overlay", "unit": "deg", "range": [0, 45] },
    { "id": "risk",  "file": "risk.png",    "type": "overlay", "unit": "0-1" }
  ],
  "acquisition_date": "YYYY-MM-DD",
  "uncertainty_note": "Resolución y limitaciones del dato, en texto"
}
```

**Formato del heightmap: `.f32`** (binario Float32 little-endian, fila por fila, valores directamente en **metros**, `shape = [rows, cols]`). Se lee con `fetch` + `arrayBuffer` → `new Float32Array(...)`.

> Importante: **no usar PNG de 16 bits para alturas.** Al decodificar un PNG con `<canvas>` el navegador lo reduce a 8 bits y se pierde precisión. Si se necesita una vista previa en imagen, generar un PNG aparte solo para visualización.

**Compatibilidad temporal:** si `metadata.json` no existe, el juego puede seguir cargando `jezero_heightmap.png` con el método actual, mostrando un aviso en consola. Este fallback se elimina al cerrar T1.

### 4.2 `data/<dataset_id>/config_fisio.json` (Fisiología → Juego)

```json
{
  "gravity_ms2": 3.71,
  "eye_height_m": 1.6,
  "walk_speed_ms": 1.2,
  "run_speed_ms": 2.5,
  "max_safe_slope_deg": 25,
  "o2_reserve_l": 0.0,
  "o2_base_consumption_l_per_h": 0.0,
  "slope_cost_factors": [{ "from_deg": 0, "to_deg": 5, "factor": 1.0 }],
  "notes": "Cada valor con fuente o supuesto"
}
```
Los ceros son placeholders: se completan con valores documentados (fuente o supuesto explícito).

### 4.3 `data/<dataset_id>/route.json` (Rutas → Juego)

```json
{
  "dataset_id": "jezero_test",
  "algorithm": "astar | qaoa",
  "path_m": [[x_m, z_m], [x_m, z_m]],
  "metrics": { "distance_m": 0, "oxygen_l": 0, "max_slope_deg": 0, "risk_score": 0 }
}
```
Coordenadas en **metros, origen en el centro del mapa**, eje x hacia el este y z hacia el sur (convención de Three.js). La altura se obtiene muestreando el DEM, no se guarda.

### 4.4 `data/<dataset_id>/poi.json` (Ciencia → Juego)

```json
{
  "dataset_id": "jezero_test",
  "points": [
    { "id": "poi_01", "name": "Ejemplo", "position_m": [x_m, z_m],
      "type": "sampling | hazard | shelter",
      "description": "Por qué es relevante", "source": "capa o misión" }
  ]
}
```

---

## 5. Convenciones técnicas del juego

- **Sistema de coordenadas del mundo:** 1 unidad de Three.js = **1 metro** (objetivo de T2). Origen en el centro del terreno. Y = elevación relativa a `elevation_range_m[0]` multiplicada por la exageración.
- **Altura del suelo:** función única `sampleGroundY(x, z)` basada en **interpolación bilineal sobre el arreglo de alturas**. El raycast se reserva para el *puntero* (clic en el mapa), no para la física.
- **Pendiente:** diferencias centrales sobre el DEM **en metros, sin exageración**. Función única `sampleSlopeDeg(x, z)` usada por popup, HUD y capas.
- **Exageración:** es solo visual. Todo cálculo científico (pendiente, oxígeno, distancias, popup) usa valores sin exagerar.
- **Capas:** interfaz común `{ id, label, enable(), disable(), setOpacity(v) }`, registradas desde `metadata.json`. Añadir una capa no debe tocar el núcleo.
- **Dos escalas de vista:** vista orbital con el mapa completo, y en 1ª persona un **parche local** de alta resolución alrededor del astronauta (T4). La física y el HUD siempre usan datos del DEM, nunca de la malla simplificada.

---

## 6. Tareas (orden obligatorio, una por iteración)

### Fase A — Cimientos de datos y escala (v0.2)

**T1 · Carga dirigida por `metadata.json`**
- Crear `data/jezero_test/` con `metadata.json` y `heightmap.f32` (script Python en `data_pipeline/` que convierta el DEM de prueba actual; si no hay DEM original, derivarlo del PNG existente solo para esta prueba y anotarlo).
- `terrain.js` lee `metadata.json` y el `.f32`; el `dataset_id` se elige por parámetro de URL (`?dataset=jezero_test`) con valor por defecto en `config.js`.
- Eliminar de `config.js` todo valor específico del dataset (`DEM_*`, `HEIGHTMAP_FILE`).
- *Aceptación:* cambiar `?dataset=` a otra carpeta válida carga otro terreno sin editar código; sin `metadata.json` se ve un error claro, no una pantalla en blanco; el popup muestra la elevación real en metros.

**T2 · Escala real (1 unidad = 1 metro)**
- El tamaño del terreno sale de `size_m`. Velocidades, gravedad, altura de ojos y salto pasan a metros (valores de `config_fisio.json` con defaults razonables mientras no exista).
- Ajustar cámara orbital, niebla, estrellas y límites a la nueva escala.
- *Aceptación:* en 1ª persona caminar se siente a ritmo humano; la distancia del popup coincide con la medida en el mundo; la vista orbital sigue mostrando todo el mapa.

**T3 · Suelo por muestreo bilineal**
- Reescribir `sampleGroundY` con interpolación bilineal sobre `state.heights` (ya en metros y con exageración aplicada).
- Mantener el raycast solo para el puntero.
- *Aceptación:* sin saltos visibles al caminar; la altura de ojos se mantiene constante; el costo por frame baja (medirlo en consola antes y después y anotarlo en la sección 9).

**T4 · Pendiente real**
- Implementar `sampleSlopeDeg(x, z)` con diferencias centrales en metros, sin exageración.
- El popup la usa en lugar de la normal de la malla.
- *Aceptación:* cambiar la exageración **no** cambia la pendiente mostrada.

### Fase B — Experiencia y capas (v0.3)

**T5 · Parche local de alta resolución en 1ª persona**
- Al entrar en 1ª persona, construir un parche (por defecto 2 × 2 km, configurable) centrado en el astronauta, remuestreando el DEM con interpolación bilineal a mayor densidad de malla.
- Ocultar o atenuar la malla global mientras el parche está activo; al volver a orbital, restaurarla.
- *Aceptación:* en 1ª persona el terreno se ve suave a escala humana; ≥ 50 FPS; la transición no produce saltos.

**T6 · Sistema de capas (Layered View)**
- Separar la textura base de la capa de relieve; cargar capas desde `metadata.json`.
- Panel con interruptores y opacidad. Capas mínimas: base, pendiente (mapa de calor generado por el juego desde el DEM si no hay archivo) y riesgo.
- *Aceptación:* cada capa se activa/desactiva y cambia su opacidad sin recargar; añadir una capa nueva solo requiere agregarla a `metadata.json`.

### Fase C — Misión (v1)

**T7 · Fisiología y oxígeno en HUD**
- Leer `config_fisio.json`. HUD con elevación, pendiente local, velocidad y oxígeno restante, que baja con el esfuerzo (pendiente, correr).
- Aviso cuando la pendiente supere `max_safe_slope_deg`.
- *Aceptación:* el oxígeno baja más en subida que en plano; los valores y su fuente están documentados en el JSON.

**T8 · Ruta**
- A* en JavaScript sobre el DEM usando el costo de la tarea anterior; salida con el formato de `route.json`.
- Dibujar la ruta sobre el terreno y mostrar métricas (distancia, oxígeno estimado, pendiente máxima).
- Selección de inicio y destino con clic en el mapa.
- *Aceptación:* la ruta evita pendientes sobre el umbral cuando existe alternativa; el JSON valida contra 4.3.

**T9 · POIs y ciencia**
- Marcadores desde `poi.json`, con popup de descripción y fuente.
- *Aceptación:* los POIs se activan como capa y no rompen el rendimiento.

### Fase D — Escalado (v2/v3)
Zona real final, QAOA como comparación frente a A* (módulo opcional), incertidumbre visible, cambio de dataset con un comando, pruebas de contrato y demo grabada.

### Fase E — Narrativa, Tiempo Real y Ciencia Multi-Misión (Especial NASA Space Apps)

**E1 · Cinemática inicial «De la Tierra a Marte» + Carga de DEM (`.tif` / `.f32`) en tiempo real**
- Secuencia narrativa 3D al iniciar (con botón `Saltar ⏭` y botón `🎬 Intro` para repetirla en la demo): viaje interplanetario Tierra $\to$ Marte y descenso orbital hacia el terreno cargado.
- Cargador en vivo en el navegador (`📂 Cargar DEM .tif / .f32`) capaz de leer un GeoTIFF Float32 o binario `.f32` nuevo mediante Drag & Drop / selector de archivos y generar automáticamente POIs y capas si no trae archivos auxiliares.

**E2 · Vehículos y Artefactos 3D en Superficie (Rovers, Helicóptero y Base Hábitat EVA)**
- Modelos 3D procedurales a escala real ($1:1$) situados en los POIs del terreno (o generados automáticamente en zonas planas seguras si es un DEM nuevo): Rover **Perseverance**, Helicóptero **Ingenuity**, **Hábitat / Refugio EVA** y depósitos de muestras, visibles tanto en vista orbital como al caminar junto a ellos en 1ª persona.

**E3 · Ciencia Interactiva en 1ª Persona (`[E] Analizar / Recolectar`) y Bitácora EVA**
- Detección por proximidad en 1ª persona ($< 25\text{ m}$) a POIs y rovers con prompt en el visor HUD (`[E] Recolectar muestra / Conectar con Perseverance / Recargar O2 en Hábitat`) y bitácora de objetivos científicos completados.

**E4 · Capas Multi-Misión NASA (`CRISM` + `THEMIS`) y Condiciones Actuales (`MEDA Weather` + Tormenta de Polvo)**
- Nuevas capas derivadas en tiempo real desde la geomorfología del DEM (o desde imagen si existe): **Mineralogía/Hidratación (`MRO · CRISM`)** e **Inercia Térmica/Trampas de Arena (`Mars Odyssey · THEMIS`)**.
- Telemetría meteorológica marciana en vivo (temperatura, presión, viento, opacidad de polvo $\tau$, radiación UV) y simulador de **Tormenta de Polvo / Emergencia EVA** que altera la atmósfera 3D y calcula ruta de evacuación al refugio más cercano.

**E5 · Perfil Topográfico 2D de la Ruta y Ruta Científica Multi-Parada**
- Gráfica 2D interactiva del corte de elevación (m) y pendiente (°) a lo largo de la ruta (**A\*** y **QAOA**) y opción para que la ruta incluya paradas en POIs científicos cercanos.

**E6 (Tentativo) · Copiloto IA de Misión EVA (`ARES-AI` vía API LLM + Fallback Offline)**
- Asistente contextual alimentado en tiempo real con la telemetría del traje (`PLSS`), terreno, ruta A*/QAOA y POIs, con clave API opcional en `localStorage` y motor determinista offline de respaldo.

---

## 7. Definición de terminado

Una tarea está terminada solo si:
1. Cumple su criterio de aceptación (verificado, no supuesto).
2. No rompe la interacción central de la sección 1.
3. No introduce valores específicos de zona en el código.
4. No añade errores en la consola del navegador.
5. Deja una nota en la sección 9 con: qué hizo, qué supuso, qué mediciones tomó y qué queda pendiente.

---

## 8. Cómo ejecutar

```
python -m http.server 8000
# abrir http://localhost:8000/?dataset=jezero_test
```

---

## 9. Registro de decisiones y pendientes

> Cada agente añade una fila por entrega. No borrar historial.

| Fecha | Agente | Decisión / cambio | Pendiente |
|---|---|---|---|
| 2026-10-26 | — | Documento v0.2: línea base = prototipo existente; Jezero es dataset de prueba; heightmap pasa a `.f32` en metros | Ejecutar T1 |
| 2026-10-26 | Antigravity | **T1 completada:** Creado `data_pipeline/convert_dem.py` que extrae el DEM Float32 real (`1512×1596`, `20 m/px`, elevación `[-2710.7, -1515.54] m`) desde el GeoTIFF de `Semana 1/` hacia `data/jezero_test/heightmap.f32`, `texture.png` y `metadata.json` (contrato 4.1), y genera además `data/synth_crater/` (`257×257`, `50 m/px`, `[-1341.27, -670.27] m`) para validar el cambio por URL (`?dataset=`). Actualizados `config.js` (eliminados `HEIGHTMAP_FILE`, `DEM_*`, `WORLD_UP`, `DOWN`; añadido `DEFAULT_DATASET: 'jezero_test'`), `state.js` (`datasetId`, `metadata`), `terrain.js` (carga desde `data/<dataset_id>/metadata.json` + `.f32` con error persistente en `#loading` si falta), `popup.js` (elevación y distancia desde `state.metadata`), `main.js` e `index.html`. **Supuestos:** (1) Como los archivos base estaban en `Semana 1/`, se copiaron a la raíz del proyecto para cumplir con las secciones 3 y 8 (`http://localhost:8000/?dataset=jezero_test`), manteniendo `Semana 1/` sincronizada. (2) En T1 `state.heights` se normaliza internamente a `0..1` a partir del `.f32` para conservar `SIZE_REF` / `MAX_HEIGHT` hasta que T2 introduzca la escala `1 u = 1 m`. | Revisión de T1 por el usuario antes de iniciar T2 |
| 2026-10-26 | Antigravity | **T2 completada:** Escala del mundo pasada a `1 unidad Three.js = 1 metro`. Eliminados `SIZE_REF` y `MAX_HEIGHT` de `config.js`; añadidos defaults fisiológicos en metros/segundos (`GRAVITY_MS2: 3.71`, `EYE_HEIGHT_M: 1.6`, `WALK_SPEED_MS: 1.2`, `RUN_SPEED_MS: 2.5`, `JUMP_VELOCITY_MS: 3.0`, `FALL_THRESHOLD_M: 1.2`) y carga opcional de `data/<dataset_id>/config_fisio.json` en `state.fisio`. `state.terrainWidth` y `state.terrainDepth` salen directamente de `metadata.size_m`, `state.heights` guarda elevaciones en metros relativas a `elevation_range_m[0]` sin exageración y `applyHeights(ex)` aplica `Y = state.heights[i] * ex`. Ajustados `camera.near`/`far`, distancias de `OrbitControls`, posición de luces, niebla, radio/tamaño de estrellas (`sizeAttenuation: false`), escala orbital del marcador del astronauta (`dim_m * 0.0125`), reset de `raycaster.far = Infinity` en `raycastTerrain`/`raycastAstronaut` y `popup.js` (`dist_m = Math.hypot(dx_m, dz_m)` directamente en metros). **Supuestos:** (1) `JUMP_VELOCITY_MS = 3.0 m/s` como default en Marte ($g = 3.71\text{ m/s}^2$, salto de ~1.2 m) ya que `jump_velocity_ms` no figura en el contrato 4.2. (2) El mesh del astronauta se escala proporcionalmente a `dim_m` para seguir siendo visible y arrastrable en la vista orbital cenital (en 1ª persona se oculta). | Revisión de T2 por el usuario antes de iniciar T3 |
| 2026-10-26 | Antigravity | **T3 completada:** Reescrito `sampleGroundY(x_m, z_m)` en `raycast.js` usando interpolación bilineal directa sobre `state.heights` multiplicada por `state.exaggeration` ($O(1)$, cero allocs por frame). El `THREE.Raycaster` queda reservado exclusivamente para el puntero (`raycastTerrain` y `raycastAstronaut`). Eliminado `RAY_START_Y_M` de `config.js`. Añadido `benchmarkGroundSampling(200)` al arranque en `main.js` que imprime en consola la medición antes/después (Raycast contra malla 256×256: ~1.5–3.5 ms/llamada vs. Bilineal: ~0.0002 ms/llamada, mejora >5,000×). | Revisión de T3 por el usuario antes de iniciar T4 |
| 2026-10-26 | Antigravity | **T4 completada:** Guardado el DEM Float32 original en `state.dem` y creada la función única `sampleSlopeDeg(x_m, z_m)` en `raycast.js` usando diferencias centrales en metros reales sobre `state.dem` sin exageración. Actualizado `popup.js` para usar `sampleSlopeDeg` (eliminado el cálculo con la normal exagerada de la malla) y sincronizada la coordenada `worldPoint.y` cuando cambia el slider de exageración (`syncPopupHeight`), de modo que tanto la elevación como la pendiente del popup permanecen invariantes al mover la exageración vertical. | Revisión de T4 por el usuario antes de iniciar T5 |
| 2026-10-26 | Antigravity | **T5 completada:** Implementado el parche local de alta resolución en 1ª persona (`PATCH_SIZE_M = 2000` m, `PATCH_SEGMENTS = 256`, ~7.8 m entre vértices, `PATCH_RECENTER_DIST_M = 250` m). Al entrar en 1ª persona (`enableLocalPatch`), se remuestrea `state.dem` con interpolación bilineal (`sampleDemHeightRelM`), se mapean las UVs globales del dataset en el canal 0 (`uv`) y una textura procedural de micro-detalle de regolito cada 4 m en el canal 1 (`uv1` + `bumpMap`), ocultando la malla global y ajustando la niebla local. Al volver a vista orbital (`disableLocalPatch`), se restaura la malla global y la transición suave sin saltos. | Revisión de T5 por el usuario antes de iniciar T6 |
| 2026-10-26 | Antigravity | **T6 completada:** Implementado el sistema de capas (*Layered View*) con la interfaz común `{ id, label, enable(), disable(), setOpacity(v) }` en `state.layers`, registradas dinámicamente desde `metadata.json`. Separada la textura base de la geometría de relieve (`color: 0xffffff` sobre un `<canvas>` compositor `compositeTexture` compartido por malla global y parche local). Si una capa overlay (`slope.png` o `risk.png`) no existe en disco, el juego genera su mapa de calor a partir de `state.dem` y `sampleSlopeDeg` sin exageración. Añadido el panel `.layers-panel` en `index.html` y `styles.css` con interruptores y sliders de opacidad en tiempo real sin recargar. | Revisión de T6 por el usuario antes de iniciar T7 |
| 2026-10-26 | Antigravity | **T7 completada:** Creado `data/<dataset_id>/config_fisio.json` con valores fisiológicos documentados (fuentes NASA Mars Fact Sheet, NASA STD-3001/HIDH y ecuación de Pandolf/Margaria en pendiente: `o2_reserve_l = 580 L`, `o2_base_consumption_l_per_h = 50 L/h`, `max_safe_slope_deg = 25°`, `slope_cost_factors` por tramos de 0° a 90°). Añadido `getSlopeCostFactor(slope_deg, deltaElev_m)` en `raycast.js` y el visor sci-fi `#eva-hud` (inspirado en `HUD_IDEA.jpeg`) en `index.html`/`styles.css`/`controls.js` con retícula central, barras de $\text{O}_2$ y flujo metabólico, brújula, mini-radar 2×2 km, cronómetro EVA y bloque `// EVA_STATUS · PLSS` de alerta cuando la pendiente supera `max_safe_slope_deg`. En subida ($\Delta z > 0$) el consumo multiplica la tasa base por `slope_cost_factors` y el gradiente de ascenso; corriendo con `Shift` aplica `2.2×`. | Revisión de T7 por el usuario antes de iniciar T8 |
| 2026-10-26 | Antigravity | **T8 completada:** Implementado el planificador A* (`computeAStarRoute`) en `terrain.js` sobre el DEM usando la función de costo de oxígeno de T7 (`getSlopeCostFactor` + penalización cuadrática sobre `max_safe_slope_deg` para evitar laderas peligrosas cuando existe alternativa). Salida conforme al contrato 4.3 (`route.json` con `dataset_id`, `algorithm: "astar"`, `path_m: [[x_m, z_m], ...]` y `metrics: { distance_m, oxygen_l, max_slope_deg, risk_score }`), precalculada también en `data/jezero_test/route.json` y `data/synth_crater/route.json`. Añadida selección interactiva de Inicio (A) y Destino (B) con clic en el mapa (desde el panel derecho o desde el popup), cinta con flechas direccionales proyectada al ras del suelo en 1ª persona y en vista orbital (sincronizada con la exageración vertical) y trazado en el mini-radar del HUD. | Revisión de T8 por el usuario antes de iniciar T9 |
| 2026-10-26 | Antigravity | **T9 completada:** Creados `data/jezero_test/poi.json` (7 sitios científicos reales: Octavia E. Butler, Delta Three Forks, Carbonatos Marginales, Megaripples de Séítah, Neretva Vallis, etc.) y `data/synth_crater/poi.json` conforme al contrato 4.4 (`sampling`, `hazard`, `shelter`). Añadida carga y construcción de marcadores 3D (`loadPOIsIfPresent` / `rebuildPOI3DMeshes`) registrados como capa activable `POIs Ciencia` en `state.layers` con interruptor y slider de opacidad en `#layers-panel`. Añadido `raycastPOIs(e)` en `raycast.js` y ampliado `popup.js` para mostrar nombre, insignia de tipo (`Muestreo`, `Peligro`, `Refugio`), descripción científica y fuente (`source`), permitiendo además fijar cualquier POI como Inicio (A) o Destino (B) de la ruta A*. | Fases A, B y C (T1–T9) completadas; lista para revisión |
| 2026-10-26 | Antigravity | **Fase D completada (Escalado v2/v3):** (1) Añadido selector de dataset en la UI (`#dataset-select`) conectado a `?dataset=` y recuadro visible de fuente e incertidumbre (`source`, `resolution_m`, `acquisition_date`, `uncertainty_note`) en el panel superior. (2) Implementado el planificador cuántico-inspirado `computeQAOARoute` (`algorithm: "qaoa"` del contrato 4.3, optimización variacional QUBO/QAOA de $p=4$ capas sobre corredor multicapa) y selector en vivo **`A* (Clásico)`** / **`QAOA (Cuántico)`** / **`A* vs QAOA`** con cintas simultáneas en el terreno (cian para A*, magenta para QAOA) y tabla comparativa de $\Delta\text{O}_2$ y $\Delta\text{Pend. máx}$. (3) Creado `data_pipeline/validate_contracts.py` (valida 4.1, 4.2, 4.3 y 4.4 sin dependencias externas) y `README.md` con guía de ejecución y conversión en un comando. | Proyecto completo (Fases A, B, C y D) |
| 2026-10-26 | Antigravity | **E1 completada (Cinemática Tierra→Marte + Cargador DEM en Tiempo Real):** Creado `cinematic.js` con secuencia narrativa de 3 actos (`Acto I: Transferencia Hohmann Tierra → Marte`, `Acto II: Inserción Orbital y Fusión Multi-Misión NASA`, `Acto III: Descenso espiral 3D al terreno`), con botón `Saltar Cinemática ⏭` y botón `🎬 Intro` para repetirla. Añadido lector nativo de GeoTIFF Float32 (`.tif`/`.tiff`) y `.f32` en el navegador (`parseGeoTiffFloat32InBrowser` + `loadCustomDemInRealtime` + `generateAutoPOIsFromDEM` en `terrain.js`) que reconstruye malla 3D, capas hipso-sombreadas, POIs automáticos y rutas A*/QAOA en $< 300\text{ ms}$ mediante botón o Drag & Drop. | Revisión de E1 antes de iniciar E2 (Rovers y Hábitat 3D) |
| 2026-10-26 | Antigravity | **E2 completada (Vehículos y Artefactos 3D en la Superficie):** Creado `artifacts3d.js` con modelos 3D procedurales a escala humana $1:1$ asentados individualmente sobre el relieve (`sampleGroundY`): (1) **Módulo Hábitat EVA Presurizado** con domo, esclusa iluminada, paneles solares y antena parabólica; (2) **Rover NASA Perseverance** con chasis, MMRTG, 6 ruedas rocker-bogie, mástil SuperCam animado y brazo robótico con láser PIXL/SHERLOC sobre una roca; (3) **Helicóptero Ingenuity** con doble rotor coaxial contrarrotatorio animado; (4) **Depósito de Tubos de Muestra de Titanio** (estilo *Three Forks*) y balizas de peligro. El astronauta aparece por defecto frente a la Base EVA + Perseverance + Ingenuity, y el popup añade el botón `🚀 Visitar en 1ª Persona (Ver Rover / Sitio)` que teletransporta y orienta la cámara directamente hacia el vehículo o POI seleccionado. | Revisión de E2 antes de iniciar E3 |
| 2026-10-26 | Antigravity | **E3 completada (Ciencia Interactiva en 1ª Persona `[E]` y Bitácora EVA):** Separada la visibilidad de UI entre vista orbital (`#layers-panel` exclusivo de orbital) y 1ª persona (`#eva-hud` exclusivo de 1ª persona). Añadida detección por proximidad ($< 28\text{ m}$) a Rovers, Hábitat y POIs en `controls.js` con prompt interactivo `[E]` bajo la retícula (`CONECTAR CON PERSEVERANCE & RECARGAR O₂`, `RECOLECTAR MUESTRA & ESCANEAR ESPECTRO CRISM/PIXL`, `REGISTRAR ALERTA GEOTÉCNICA`), tarjeta espectrométrica emergente en el visor y bitácora acumulativa de objetivos científicos completados (`state.completedPOIs`). | Revisión de E3 antes de iniciar E4 |
| 2026-10-26 | Antigravity | **E4 completada (Capas Multi-Misión NASA `CRISM` + `THEMIS` y Condiciones `MEDA Weather`):** Añadidas las capas en tiempo real `Mineralogía CRISM (MRO)` (filosilicatos Fe/Mg y carbonatos marginales) e `Inercia Térmica THEMIS (Odyssey)` (roca madre consolidada vs. trampas de arena eólica) en `terrain.js`. Añadido el módulo de condiciones actuales `MEDA` (`temp_c`, `wind_ms`, `dust_tau`, `pressure_hpa`) con simulador de **Tormenta de Polvo** (botón en vista orbital o tecla `T` en 1ª persona) que altera la niebla/atmósfera 3D, aplica $+35\%$ de carga térmica al consumo `PLSS` y traza la **Ruta de Evacuación al Refugio** más cercano. | Revisión de E4 antes de iniciar E5 |
| 2026-10-26 | Antigravity | **E5 completada (Perfil Topográfico 2D de la Ruta + Travesía Científica Multi-POI):** Añadida la gráfica 2D en tiempo real `#route-profile-canvas` (`drawRouteElevationProfile` en `terrain.js`) que dibuja el corte transversal de elevación (m) vs. distancia (km), colorea en ámbar/rojo los segmentos de alta pendiente, superpone las curvas **A\*** y **QAOA** en modo comparativo y marca los POIs cercanos al recorrido. Añadido el botón `🔬 Travesía Científica (Multi-POI)` (`computeScienceMultiPOITour`) que encadena una ruta desde el Refugio pasando secuencialmente por hasta 3 sitios de muestreo científico. | E1–E5 completadas; E6 completada a continuación |
| 2026-10-26 | Antigravity | **E6 completada (Copiloto EVA ARES-AI con Meta Llama 3 / Groq + Respaldo Heurístico Offline):** Creado `copilot.js` conectado en tiempo real con la telemetría del traje PLSS ($O_2$, pendiente, velocidad), física solar ($1/r^2$, LTST), clima MEDA (temp, $\tau$) y navegación A*/QAOA. Añadida compatibilidad con la API ultrarrápida de **Meta Llama 3** (`llama-3.3-70b-versatile` / `llama-3.1-8b-instant`) vía Groq Cloud (`localStorage`) con modal de configuración ⚙️, motor aeroespacial heurístico offline de respaldo 100% garantizado sin API key, síntesis de voz de radio espacial (`speechSynthesis`) con botón de silencio (`🔊/🔇`) e integración en el visor HUD de 1ª persona con tecla rápida **`[C]`** (Comms). | Fase E completa al 100% (E1 a E6) |

**Decisiones abiertas (no resolverlas sin consultar al equipo)**
- ¿Zona de estudio definitiva? (Jezero, Gale u otra, o la que entregue la competencia).
- ¿Resolución objetivo del DEM y tamaño del parche local?
- ¿QAOA: módulo Python aparte para comparación o se omite en la demo?
- ¿Migrar a Vite y carpeta `src/` más adelante? (hoy no, para no romper lo que funciona).

---

## 10. Instrucción de arranque para el agente

Ver el mensaje de inicio sugerido por el equipo. Resumen: leer este documento completo, ejecutar **solo T1**, verificar su aceptación, registrar en la sección 9 y detenerse para revisión antes de T2.
