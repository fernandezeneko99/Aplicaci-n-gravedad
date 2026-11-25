# QA · Gravedad (extensión CEP para After Effects)

Documento vivo de calidad. Al retomar: leer «Siguiente acción», contrastar con `git log` y ejecutar `npm test`.

## Arquitectura (resumen)

- Panel CEP (`src/index.html`, `app.js`, `meter.js`, `style.css`) con Node activado (`--enable-nodejs`).
- Motor de física en el panel: `src/engine/sim.js` (planck.js/Box2D), `scene.js` (capa → cuerpo), `pipeline.js` (flujo
  completo), `raster.js` (contorno desde PNG).
- Host ExtendScript ES3: `src/host/gravedad.jsx` (lectura de escena, controles nativos, escritura de claves),
  `geometry.jsx` (contornos vectoriales). Comunicación por `evalScript` con JSON; el resultado se pasa por archivo `.jsx`.
- Empaquetado: `node tools/pack.js` → `dist/Gravedad-<versión>.zxp` firmado; verificación `python3 tools/verify_zxp.py --strict`.
- Repositorio solo de Gravedad: **no contiene** herramientas MTN (duplicar precomps, copiar keyframes/estilos, texto,
  curvas, autocrop, deshacer precomp, renombrado, secuencias). Fuera de alcance aquí.

## Matriz de compatibilidad (provisional)

| Elemento | Declarado | Verificado aquí | Pendiente |
|---|---|---|---|
| After Effects | 2022 (22.0) o posterior (`manifest.xml`) | Modelo simulado del DOM de scripting | Probar panel instalado en AE 2022, 2024 y 2025 |
| CEP / CSXS | 11.0 | Chromium (Playwright) con CEP simulado | Carga real en CEP 11/12 |
| macOS | Sí (paquete sin binarios) | — | Instalación con ZXP Installer y UPIA |
| Windows | Sí (paquete sin binarios) | — | Instalación con ZXP Installer y UPIA |
| Instalación | `.zxp` firmado (autofirmado) y carpeta | Firma verificada (lxml + cryptography), mimetype primero | Actualizar desde 0.5.0 (`com.eneko.gravedad`) en AE real |

## Reglas de comportamiento definidas (F1)

- **Claves de Gravedad**: una clave se considera generada si cae en un fotograma que escribió la simulación y conserva el
  valor escrito (huella a 0,01 px / 0,01°; las claves se escriben ya redondeadas a centésimas). Todo lo demás es del usuario.
- **Registro**: por capa simulada, en marcadores `Gravedad · datos` del nulo de mundo (viaja con el `.aep` y con Deshacer):
  tramo y huellas de las claves generadas; copia completa de las claves originales sustituidas (valor, interpolación,
  suavizado, tangentes espaciales, itinerante); valor estático; expresión activa; padre.
- **Borrar**: quita solo claves generadas, restaura las originales y el padre. Claves añadidas o editadas después se quedan.
  Sin registro (proyecto 1.1.1, capa duplicada, nulo de mundo borrado) **no se borra** y se avisa con los nombres.
- **Fijo** (tras simular): si la capa tenía animación propia, la recupera y la sigue (cuerpo animado). Si no, se congela en
  la pose visible en el **instante actual** del cursor (limitado al tramo simulado) y recupera su padre con compensación.
- **Desactivado**: vuelve a como estaba antes de simular y deja de participar.
- **Vías**: desde el panel (botones e inspector) el cambio es inmediato. Desde Controles de efectos surte efecto al pulsar
  Simular (paso de deshacer propio «Aplicar cambios de tipo», con aviso) o Borrar; mientras tanto el panel indica
  «Tipo cambiado en …». El instante usado para Fijo es el del cursor al pulsar Simular.

## Flujos y casos

| Flujo | Caso | Resultado | Evidencia (automatizada, After simulado) | Pendiente en After real |
|---|---|---|---|---|
| F1 Asignar tipo | Dinámico → Fijo tras simular, cursor al inicio (A con claves propias) | OK: recupera su animación propia; B se apoya en A | `qa-regressions` «Fijo con el cursor al inicio» | AE-1 |
| F1 | Dinámico → Fijo, cursor a mitad (B sin animación) | OK: congelado en la pose visible; colisiona ahí | «Fijo con el cursor a mitad» | AE-1 |
| F1 | Dinámico → Desactivado (inspector) | OK: vuelve a como estaba; A ya no choca con B | «Desactivado: B vuelve…» | AE-1 |
| F1 | Cambio en Controles de efectos → Simular / Borrar | OK: se aplica al simular con aviso y al borrar; panel avisa antes | «mismo cambio desde Controles…», «también se aplica al Borrar» | AE-2 |
| F1 | Borrar restaura claves propias (valor, HOLD, suavizado, tangentes) | OK | «Borrar restaura las claves propias…» | AE-1 |
| F1 | Claves añadidas/editadas tras simular | OK: sobreviven | «claves que el usuario añade o edita…» | AE-1 |
| F1 | Re-simular 2 veces y borrar | OK: no se confunden claves generadas con originales | «re-simular dos veces…» | — |
| F1 | Cerrar/reabrir (contexto ExtendScript nuevo, mismo proyecto) | OK: el registro persiste | «cerrar y reabrir…» | AE-3 (guardar `.aep`, cerrar AE, reabrir) |
| F1 | Duplicar capa simulada | OK: limpiar una no toca la otra; la copia no se borra a ciegas | «duplicar una capa simulada…» | AE-1 |
| F1 | Proyecto 1.1.1 (solo ids) | OK: no borra a ciegas, avisa | «proyecto de la 1.1.1…» | AE-3 |
| F1 | Capa con padre: Desactivado / Fijo a mitad | OK: padre recuperado sin saltos | «capa con padre…» (2 pruebas) | AE-1 |
| F1 | Deshacer tras Fijo/Desactivado/Borrar | Sin verificar (el modelo simulado no implementa Deshacer) | — | AE-4 |
| F2 Partículas | Dos clics sin selección | OK: una sola forma de ejemplo reutilizada | «F2 · dos clics sin selección» | AE-5 |
| F2 | Doble clic (emisor recién creado seleccionado) | OK: no duplica; explica qué hacer | «F2 · doble clic…» | AE-5 |
| F2 | Emisor + capas seleccionadas | OK: se añaden como formas sin repetir | «F2 · emisor + capas…» | AE-5 |
| F3 Colisiones | Bola 3–8 px a 3000–15000 px/s contra tabla dinámica de 3 px | OK (antes atravesaba en 5 de 6) | «F3 · bola de radio…» (3) | — |
| F3 | 60 partículas a 6000 px/s dentro de anillo dinámico de 4 px | OK (antes escapaban 31) | «F3 · partículas…» | — |
| F3 | Pesado sobre ligero (7,8:0,2 y 100:0,1), pila de 15 cajas | OK sin cambios (solape < 0,4 px) | `f3.js` | — |
| F4 Mundo | Luna → Espacio → Tierra | OK: vuelve a 160 | «F4 · Luna → Espacio → Tierra» | AE-6 |
| F4 | Techo + Paredes off/on; memoria tras Simular/Borrar | OK | «F4 · …» (5) | AE-6 |
| F5 Fuerzas | Por defecto afecta a todas | OK (comportamiento anterior) | «F5 · por defecto…» | — |
| F5 | «Solo a la capa»; capa borrada; acotada a un emisor | OK: solo esa capa; sin capa no se aplica y avisa | «F5 · …» (3) | AE-6 |
| Integridad | Fallo a mitad de escribir; reintento | OK: registro guardado; Borrar restaura; reintento limpio | «fallo a mitad…», «reintento…» | — |
| Integridad | Cambiar de composición durante el cálculo | OK: se escribe en la simulada | «cambiar de composición mientras…» | AE-6 |
| Uso | Doble clic en Simular | OK: no cancela (antes sí) | `panel.test.js` «doble clic» | — |

## Rendimiento (medido)

| Medida | Escena | Antes | Después | Herramienta |
|---|---|---|---|---|
| Llamadas al DOM · resumen ligero | 300 cuerpos + 40 capas | 4 880 | 2 780 (−43 %) | `scratchpad/hostbench.js` (contador en el modelo simulado) |
| Llamadas al DOM · resumen completo (cada ≥ 4 s) | ídem | 27 574 | 16 634 (−40 %) | ídem |
| Llamadas al DOM · leer escena | ídem | 83 462 | 36 732 (−56 %) | ídem |
| Llamadas al DOM · re-simular (sin contar las internas de `setValuesAtTimes`) | 300 cuerpos, 150 fot. | 170 473 | 64 033 (−62 %) | `scratchpad/applybench.js` |
| Llamadas al DOM · Borrar | ídem | 119 757 | 84 577 (−29 %) | ídem |
| Motor · 500 cuerpos, 300 fot. | — | 10,0 s | 10,8 s (+8 %, coste de F3) | `scratchpad/bench.js` (mediana de 3) |
| Motor · 400 partículas, 300 fot. | — | 4,2 s | 4,8 s (+14 %, coste de F3) | ídem |

Los scripts de medición están en la carpeta temporal de la sesión; su contenido está descrito en el registro para rehacerlos
(`hostbench.js`: escena de 300 rectángulos dinámicos, contador envolviendo `property`, `valueAtTime`, `keyTime`, `keyValue`).

## Procedimientos pendientes en After Effects real (no disponible en este entorno)

Proyecto de prueba: composición 1280×720, 25 fps, 4 s. Capa de forma «suelo» (1200×40, y=700, Fijo), «A» (elipse 80,
x=400 y=200, claves propias de Posición en 0 s y 1,5 s con suavizado y salida HOLD), «B» (rect 60, x=400 y=40). A y B Dinámico.

- **AE-1** Simular. Cursor en 0 s → A a Fijo desde el panel: A recupera sus 2 claves con su interpolación. Cursor en 0,8 s →
  B a Fijo: B queda sin claves en su pose de 0,8 s. Simular: B no se mueve y A choca con él. B a Desactivado: B vuelve a
  x=400 y=40. Borrar: A recupera sus claves originales exactas. Duplicar B antes de Borrar: la copia no cambia.
- **AE-2** Repetir con el desplegable «Gravedad · Tipo» en Controles de efectos: el panel muestra «Tipo cambiado en B».
  Pulsar Simular: aviso y dos pasos de deshacer («Aplicar cambios de tipo» y «Simular»).
- **AE-3** Tras simular, guardar el `.aep`, cerrar After, reabrir y Borrar: las claves originales vuelven. Abrir un proyecto
  simulado con 1.1.1 y Borrar: no se tocan sus claves y se avisa.
- **AE-4** Tras cada acción (Fijo, Desactivado, Borrar, Simular), Ctrl/Cmd+Z deja el proyecto exactamente como antes y
  Ctrl/Cmd+Shift+Z lo rehace; el registro (marcadores del nulo de mundo) acompaña.

- **AE-5** Sin selección pulsar Partículas dos veces: una sola «Forma de partícula» y el segundo clic explica que hay un
  emisor seleccionado. Seleccionar emisor + 2 capas y pulsar: aparecen «Capa de partícula 2/3».
- **AE-6** Ajustes del mundo: Luna → interruptor Espacio → Tierra: 160 px/s². Activar Techo, quitar y poner Paredes: el techo
  vuelve. Ventilador con «A todas las capas» apagado y «Solo a la capa» = A: solo A se mueve; borrar A: aviso.
  Cambiar de composición mientras simula una escena larga: las claves aparecen en la composición original.

- **AE-7 · Duplicar a mano un círculo con Gravedad aplicada.** Capa de forma «bola» (elipse 80, x=640 y=200), Dinámico.
  1. Antes de simular, Ctrl/Cmd+D. Resultado esperado: la copia tiene los mismos 8 controles «Gravedad ·» con los mismos
     valores; Controles de efectos de la copia no muestra controles repetidos.
  2. Sin mover la copia, Simular. Resultado observado en el modelo: las dos caen exactamente superpuestas, como un único
     círculo (**F6, abierto**). Resultado esperado tras corregir F6: aviso «bola y su copia empiezan en el mismo sitio».
  3. Mover la copia a x=800 en el fotograma inicial y Simular: dos círculos que caen y chocan entre sí sin solaparse.
  4. Simular, después duplicar la bola ya simulada (la copia lleva sus claves), mover la copia en 0 s a x=900 y re-simular:
     la copia cae desde x=900.
  5. Borrar: la bola original queda sin claves en su pose de partida; la copia recupera las claves que heredó (Gravedad no
     sabe que eran de la simulación) y el aviso debe nombrarla una sola vez (**F7, abierto**).
  6. Ctrl/Cmd+Z tras cada paso deja la composición como estaba.
- **AE-8 · Dinámico → Fijo → Dinámico revisando los controladores.** «bola» Dinámico con Densidad 3, Fricción 0,7,
  Rebote 0,5, Impulso 200, Dirección del impulso 45°, Giro inicial 30. Simular. Repetir tres veces, una por vía:
  botones Fijo/Dinámico del panel, segmento Tipo del inspector, desplegable «Gravedad · Tipo» en Controles de efectos.
  1. Cursor en 0,8 s → pasar a Fijo. Esperado: «Gravedad · Tipo» = Fijo; Posición sin claves, en la pose visible a 0,8 s;
     siguen 8 controles con los mismos valores. Por la vía de Controles de efectos, el cambio de claves ocurre al pulsar
     Simular y el panel muestra antes «Tipo cambiado en bola».
  2. Volver a Dinámico. Esperado: «Gravedad · Tipo» = Dinámico; siguen 8 controles, los valores intactos (también el impulso).
  3. Simular. Esperado: cae desde la pose congelada de 0,8 s (no desde la original, que solo se recupera con Ctrl/Cmd+Z) y con
     el impulso de 200 px/s a 45°.
  4. Repetir el paso 1 con el cursor en 0 s: queda en su pose de partida.
  5. El inspector del panel y el medidor reflejan cada estado sin parpadeos («Simulada · al día» / «Tipo cambiado…»).

## Cobertura de los casos de la lista original (revisión antes de cerrar QA)

| Caso | Procedimiento en After | Cubierto por pruebas automatizadas (modelo de After) | Pendiente dentro de After Effects |
|---|---|---|---|
| Duplicar a mano un círculo con Gravedad aplicada | **AE-7** (nuevo). AE-1 solo duplicaba B, un rectángulo, y solo miraba Borrar | Copia con controles idénticos y dos círculos simulados (`caso 1a`); copia de un círculo ya simulado y movida (`caso 1c`); Borrar no toca una copia sin registro (`F1 · duplicar una capa simulada`, rectángulo); copia con controles, ambas se simulan (`variants-host`) | AE-7 completo; F6 y F7 sin corregir |
| Controladores al pasar de Dinámico a Fijo y de vuelta a Dinámico | **AE-8** (nuevo). AE-1/AE-2 solo pasaban a Fijo o Desactivado, sin volver ni revisar los controles | `caso 2` × 3 vías (panel, inspector, Controles de efectos): tipo, 8 controles sin duplicar, valores intactos, pose congelada, impulso conservado; `F1 · pasar a Fijo y volver a Dinámico` (cursor en 0 s); reasignar no duplica controles (`host.test`) | AE-8 completo: menú desplegable real (`setPropertyParameters`), Deshacer, aspecto en Controles de efectos |

### Hallazgos abiertos de esta revisión

| # | Hallazgo | Impacto | Estado |
|---|---|---|---|
| F6 | Un círculo duplicado sin mover empieza exactamente sobre el original y ambos caen superpuestos como uno (Box2D no puede separar dos círculos concéntricos idénticos) | Resultado incorrecto silencioso | Abierto. Propuesta: avisar al simular de cuerpos con la misma pose y forma |
| F7 | Tras Borrar, una copia restaurada aparece también como «no tocada» en el aviso, y con el mismo nombre que el original | Mensaje confuso | Abierto. Propuesta: excluir del aviso las capas restauradas y añadir el índice de capa |

### Corregido durante esta revisión (panel)

- El aviso «Desactualizada» / «Tipo cambiado en …» parpadeaba con cada refresco ligero: se conserva el último resumen
  completo de la misma composición y simulación.
- Con el puntero quieto sobre Simular, la ayuda tapaba el resultado («Simulado en…») y los errores: ahora el resultado se
  mantiene visible unos segundos. Regresión `panel: con el puntero quieto sobre Simular…` (falla con el código anterior).

## Batería de escenas del motor (sesión 2)

Comandos:

- Batería completa (retoma desde el último lote guardado en `qa/battery/state/`): `node tools/battery/run.js --workers 3`
- Lote piloto sin guardar (10 escenas por familia): `node tools/battery/run.js --pilot`
- Repetir un caso por semilla (y reducirlo si falla): `node tools/battery/run.js --family <familia> --seed <n>`
- Volver a comprobar con el código actual los fallos guardados: `node tools/battery/recheck.js [pase1/failures]`
- Resumen del progreso guardado: `node tools/battery/run.js --summary`

15 familias con oráculo propio (`tools/battery/families.js`) y comprobaciones genéricas (`lib.js`): valores finitos,
longitud de trayectorias, saltos imposibles, contención con paredes cerradas, penetración entre contornos visibles (SAT).
Determinismo: cada 10.ª escena se repite y se comparan las trayectorias byte a byte. Estrés: 12 escenas extremas aparte.

### Lote 1 (motor de la 1.2.x) — `qa/battery/pase1/summary.json` y `qa/battery/pase1/failures/`

10 800 escenas distintas · 1 080 repeticiones de determinismo (0 discrepancias) · 102 escenas con fallo.

| Grupo | Escenas | Causa | Resolución |
|---|---|---|---|
| Inercia con impulsos ≥ 20000 px/s y giros de 100000°/s (piloto) | — | **Motor**: Box2D recortaba el avance a 2 m y el giro a 90° por subpaso | **B1** (`maxTranslation` 40 m, `maxRotation` 12π) |
| Pilas con densidades muy distintas (piloto) | — | **Motor**: penetración hasta 40 px desde 1000:1 | **B2** calidad mínima según la relación y límite de relación, con aviso |
| Anillo dinámico fino con partículas rápidas (piloto) | — | **Motor**: bala contra bala sin choque continuo; partículas apretadas a través de la pared | **B3** solo cuerpos compactos son bala; calidad mínima pared/velocidad |
| Caída libre con gravedad 1 px/s² | 4 | **Motor**: Box2D duerme cuerpos por debajo de 0,5 px/s | **B4** umbrales de reposo 0,1 px/s y 0,4°/s |
| Inicios superpuestos | 16 | **Motor**: separación a 6000–14000 px/s, peor a más calidad | **B5** corrección de posición limitada a 800 px/s |
| Pilas con densidades 0,01–200 y gravedad 1750–2500 | 3 | **Motor**: umbrales de B2 medidos solo con gravedad terrestre | **B6** calidad y límite escalados con la gravedad |
| Contención en el fotograma 0 | 29 | Generador: formas giradas que empezaban fuera | Generador corregido |
| Fuerza acotada a un cuerpo/emisor | 36 | Generador: el cuerpo empujado cruzaba los carriles de los demás | Generador corregido |
| Dispersión de partículas | 6 | Oráculo: partículas desviadas por otras cercanas | Oráculo corregido |
| Pared fina dinámica | 3 | Oráculo: la tabla gira con el impacto (no hay cruce) | Oráculo: cruce real entre fotogramas |
| Cadena | 1 | Tolerancia: el error crece con g·dt²·eslabones | Tolerancia ajustada |
| Duplicados | 2 | Oráculo: el obstáculo lleva la copia contra el original entre dos fotogramas | Oráculo corregido; la identidad era independiente |
| Contención / pilas (penetración) | 6 | Resueltas por B2–B6 | — |

`node tools/battery/recheck.js pase1/failures` con el código actual: las 102 pasan. Regresiones B1–B6 en
`test/engine-limits.test.js` (16 pruebas: 8 fallan con el motor de la 1.2.x; 4 con el anterior a B4–B6).

## Registro de trabajo

- Sesión 1 (QA): auditoría, reproducción de F1–F5. F1 corregido con registro de claves por capa; 19 pruebas de regresión
  (`test/qa-regressions.test.js`), 12 de ellas fallan con el código anterior. Batería completa: 228/228.

- Sesión 1 (cont.): F2, F3, F4, F5, integridad (fallo a mitad, cambio de composición), doble clic y rendimiento del host.
  Cada corrección con regresión que falla con el código anterior. Batería completa: 249/249.

## Resultados por capa de verificación (1.2.0)

| Capa | Qué | Resultado | Dónde |
|---|---|---|---|
| Código | `npm test`: 263 pruebas (motor, contornos, alfa, host contra After simulado, ES3, regresiones QA, panel en Chromium) | 263/263 | Contenedor Linux, Node 22, Chromium de Playwright |
| Empaquetado | `node tools/pack.js` → `dist/Gravedad-1.2.1.zxp` (144 KB, 28 archivos firmados) | Firma válida, `mimetype` primero sin comprimir | `python3 tools/verify_zxp.py --strict` |
| Paquete | Panel ejecutado desde el `.zxp` extraído | 9/9 pruebas de panel | `GRAVEDAD_SRC=<extraído> node --test test/panel.test.js` |
| After Effects real | Instalación, carga del panel, AE-1 … AE-6, Deshacer/Rehacer, guardar y reabrir | **Pendiente** (no hay After en este entorno) | Ver procedimientos |

Re-simular usa un atajo cuando la propiedad tiene exactamente las claves escritas (no las recorre); Borrar solo lee valores.
Regresiones: clave añadida entre simulaciones, tramo más corto, punto de entrada más tarde, atajo sin lecturas de valor.

Casos de editor añadidos en esta tanda: metraje con archivo ausente (caja + aviso), nombres con tildes, comillas, barras y
emojis, capa con remapeo de tiempo.

## Experiencia de uso (revisada)

- Mensajes de error del host revisados: cada uno dice qué hacer (composición sin abrir, nulo, capa de audio, control de
  Gravedad seleccionado, fallo al crear controles).
- Panel en 260, 380 y 600 px con avisos, cambio de tipo pendiente y todas las secciones abiertas: sin desbordes ni textos de
  botón cortados; el estado de Simular ya no se corta en 260 px (prueba «tres anchos»).
- Recursos al cerrar: el panel solo mantiene un intervalo de latido (se salta con el panel oculto) y un `ResizeObserver`;
  CEP destruye la página al cerrar el panel. Sin procesos ni archivos abiertos tras cerrar.

## Siguiente acción

0. Corregir F6 (aviso de cuerpos superpuestos al simular) y F7 (aviso de Borrar), con regresión cada uno.

1. **Necesita intervención (entorno con After Effects):** instalar `dist/Gravedad-1.2.1.zxp` sobre una instalación con 0.5.0
   (mismo id `com.eneko.gravedad`) en macOS y Windows con ZXP Installer, comprobar que el panel abre desde
   Ventana › Extensiones › Gravedad y ejecutar AE-1 … AE-6 en AE 2022, 2024 y 2025. Anotar aquí cada resultado.
2. Mientras tanto (ejecutable aquí): revisar los mensajes del panel en tamaños 260–600 px con secciones abiertas y repasar
   recursos activos al cerrar el panel (intervalo del latido, `ResizeObserver`); medir el tiempo de escritura de claves
   (`apply`) con el contador de `hostbench.js` sobre 300 cuerpos.
