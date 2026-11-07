# Marswalk 3D — Exploración EVA e Inteligencia Topográfica en Marte

Aplicación 3D interactiva en navegador (ES Modules + Three.js, sin empaquetador) para exploración orbital y en primera persona de modelos digitales de elevación (DEM) marcianos, con telemetría fisiológica EVA (`PLSS`), sistema de capas científicas (*Layered View*), puntos de interés (`POIs`) y planificación de rutas seguras mediante **A\* (Clásico)** y **QAOA (Cuántico-inspirado)**.

---

## 1. Inicio rápido (Servidor estático local)

Ejecuta un servidor HTTP estático desde la raíz del proyecto (`Prototype/`):

```bash
python3 -m http.server 8000
```

Abre en el navegador:
- **Cráter Jezero (CTX 20 m/px):** `http://localhost:8000/?dataset=jezero_test`
- **Cráter Sintético (Validación 50 m/px):** `http://localhost:8000/?dataset=synth_crater`

*(También puedes cambiar de dataset directamente desde el selector desplegable del panel superior izquierdo).*

---

## 2. Pipeline de datos (Conversión de un nuevo DEM en un comando)

Para convertir cualquier GeoTIFF de elevación marciana (Float32) al contrato estándar `data/<dataset_id>/` (`metadata.json`, `heightmap.f32`, `texture.png`, `config_fisio.json`), ejecuta:

```bash
python3 data_pipeline/convert_dem.py \
  --dem "Semana 1/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif" \
  --texture "Semana 1/jezero_heightmap.png" \
  --dataset-id jezero_test
```

> El script utiliza únicamente la biblioteca estándar de Python (`struct`, `zlib`, `json`, `math`), sin depender de GDAL/rasterio.

### Validación automática de contratos (Sección 4)

Verifica que todos los datasets en `data/` cumplan los contratos `4.1` (`metadata.json` + `.f32`), `4.2` (`config_fisio.json`), `4.3` (`route.json`) y `4.4` (`poi.json`):

```bash
python3 data_pipeline/validate_contracts.py
```

---

## 3. Controles y funcionalidades principales

### Vista Orbital
- **Rotar / Zoom / Paneo:** Clic izquierdo + arrastrar / Rueda del ratón / Clic derecho + arrastrar.
- **Inspección científica y POIs:** Haz clic sobre cualquier punto del terreno o sobre un marcador 3D de POI para abrir el popup con elevación real (m), pendiente real (°), distancia al astronauta y cita científica.
- **Reubicar astronauta:** Arrastra el marcador del astronauta sobre el terreno o usa el botón **«Mover astronauta aquí»** en el popup.
- **Capas de visualización (*Layered View*):** Activa/desactiva y regula la opacidad de `Textura Base`, `Pendiente (°)`, `Riesgo Terreno` y `POIs Ciencia`.
- **Planificador de Ruta (A\* / QAOA):**
  - Alterna entre **`A* (Clásico)`**, **`QAOA (Cuántico)`** o **`A* vs QAOA`** (comparación simultánea en el terreno).
  - Usa **«📍 Elegir Inicio / Destino»** (o los botones **«🚩 Fijar Inicio (A)»** / **«🏁 Fijar Destino (B)»** del popup) para trazar la ruta óptima proyectada sobre el relieve con flechas direccionales y exportar `route.json`.

### Vista en Primera Persona (Visor EVA · PLSS)
- **Entrar:** Doble clic sobre el marcador del astronauta (o botón **«Entrar en 1ª persona»** del popup).
- **Movimiento:** `W` `A` `S` `D` o flechas para caminar ($1.2\text{ m/s}$), `Shift` para correr ($2.5\text{ m/s}$), `Espacio` para saltar ($g = 3.71\text{ m/s}^2$), `Esc` para volver a la vista orbital.
- **HUD EVA en tiempo real:** Reserva y flujo metabólico de $\text{O}_2$ según pendiente e inclinación de marcha, alerta de pendiente crítica ($> 25^\circ$), pulso cardíaco, brújula y mini-radar topográfico de $2 \times 2\text{ km}$ con ruta y POIs cercanos.


## Pantalla de inicio: Tierra → Marte → visor EVA

La portada narra tres escenas 3D. En la Tierra, el astronauta camina hacia un cohete de mayor tamaño y este despega. El viaje muestra Sol, Tierra, Marte y la ruta punteada del cohete. En Marte, el cohete aterriza, el astronauta sale y la cámara avanza hasta su visor. La secuencia termina con terreno marciano en primera persona, polvo en movimiento y el botón «Ir al mapa principal». El botón «Saltar introducción» está disponible desde el inicio y durante el viaje para abrir el mapa inmediatamente. La música y los efectos sintetizados con Web Audio comienzan tras la interacción del usuario; «Repetir viaje» reinicia la historia.

Ejecutar con `npm install && npm run dev` y abrir `http://localhost:8000/?dataset=jezero_test`. `?nointro=1` abre el mapa directamente. Los terrenos y planetas de la introducción son representaciones artísticas; el DEM científico solo se utiliza en el mapa principal.

### Visor EVA en primera persona

Al entrar a explorar se muestra primero el astronauta en tercera persona. Pulsa `V` o el botón de vista para entrar al casco: aparecen el contorno curvo, los cierres laterales y el reflejo tenue del visor. La telemetría de oxígeno, pendiente, velocidad, radar y avisos se distribuye junto a los bordes; la mira queda pequeña en el centro. Pulsa `V` otra vez para volver a tercera persona. El marco no aparece en la vista orbital ni en tercera persona.

La marcha en tercera persona usa cintura y punta de bota articuladas, contramovimiento de hombros y cadera, flexión de rodillas, tobillos, muñecas y dedos, y una pose amortiguada al saltar. El ciclo sigue la velocidad real del astronauta y continúa internamente mientras se usa el casco para que el regreso a tercera persona no corte el movimiento.

La secuencia se comprobó visualmente en Vite desde la Tierra hasta el visor EVA; también se verificó el botón final y el acceso al mapa. El mapa conserva su cargador y controles. El mapa usa ahora el mismo astronauta articulado de la introducción al entrar en tercera persona. La marcha, el giro, el arranque, la frenada y el seguimiento de cámara usan interpolación dependiente del tiempo; al detenerse, el personaje vuelve a una pose de reposo con movimiento sutil. `V` alterna con el visor en primera persona. Falta validar el rendimiento y los controles con teclado/ratón en dispositivos físicos.
