# La señal — dirección visual v1

Fecha: 2026-11-05. Proyecto: Preparation / Marswalk.

La historia «La señal» fue elegida por el usuario. Estas imágenes son conceptos de dirección artística generados con la herramienta integrada imagegen: no son capturas funcionales, un modelo 3D ni fotogramas de un video existente. El paisaje es una interpretación artística de Marte; no reproduce un DEM ni una localización científica validada.

## Entregables

- [Personaje: frente, espalda y detalles](personaje-concepto.png)
- [Fotograma: la baliza al otro lado del valle](fotograma-baliza.png)
- [Prompts utilizados](prompts.md)

## Personaje

Proporciones humanas adultas, traje de tejido gris claro con mangas amarillo mostaza, juntas grafito, conexiones de soporte vital, mochila compacta y visor oscuro con reflejo bronce. El desgaste se concentra en botas, rodillas y bordes. La propuesta necesita un modelo detallado con esqueleto y texturas para una versión animada; las imágenes por sí solas no lo proporcionan.

La hoja de personaje define la identidad. En una futura producción habrá que fijar la lateralidad del escáner y la lámpara, ya que el fotograma generado contiene variaciones de continuidad. No se debe usar esta lámina como plano de ingeniería de un traje real.

## Guion de 30 segundos, más el tiempo de decisión

| Tiempo | Imagen y acción | Sonido e interfaz |
| --- | --- | --- |
| 0–5 s | Primer plano del hombro y casco en penumbra. El astronauta gira la cabeza al oír dos pulsos. | Respiración, dos pulsos de radio. Opción de saltar disponible. |
| 5–11 s | Cámara detrás del hombro: el explorador activa un instrumento científico parcialmente cubierto de polvo. Una baliza responde a lo lejos. | ARES: «Baliza localizada. Acceso por determinar». Subtítulo. |
| 11–19 s | Se incorpora. La cámara asciende y revela el valle que lo separa del destino. Se llega al fotograma de referencia. | «Analizar terreno». La historia espera el clic; el tiempo de espera no cuenta dentro de los 30 segundos. |
| 19–26 s | Tras el clic, un barrido representa pendientes y corredores de ruta sobre el relieve. | Información mínima vinculada al terreno. Los valores científicos procederán del dataset y del planificador, no del arte conceptual. |
| 26–30 s | El personaje ajusta el equipo y dirige la mirada al destino. Encuadre final abierto al paisaje. | «MARSWALK — Sigue la señal». Botón «Iniciar misión». |

## Relación con Preparation

La baliza es un objetivo ficticio de entrenamiento, que debe identificarse como tal. La ruta y las pendientes deben calcularse sobre el DEM cargado. La secuencia introduce el planificador, los puntos de interés y la exploración EVA. La cámara al hombro pertenece a la introducción: no implica sustituir los controles existentes de primera persona por un nuevo sistema de tercera persona.

La cinematografía debe mantener iluminación y escala coherentes con el simulador para evitar un salto visual brusco al comenzar la misión. La elección de una técnica de producción —3D detallado, secuencia prerenderizada o combinación— sigue pendiente; no se promete que este nivel de imagen esté implementado en tiempo real.

## Estado

Solo se han preparado referencias visuales y este guion. No se ha sustituido la introducción local, modificado el código ni enviado cambios a GitHub durante esta etapa. El siguiente paso de diseño es contrastar con el usuario el personaje y la atmósfera antes de producir la animación.
