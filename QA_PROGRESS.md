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

## Flujos y casos

| Flujo | Caso | Resultado | Evidencia | Pendiente |
|---|---|---|---|---|
| Asignar tipo | Dinámico → Fijo tras simular (F1) | FALLA: conserva claves viejas y el Fijo sigue la trayectoria antigua | `repro.js`: tipo `kinematic`, 42 claves | Corregir |
| Asignar tipo | Dinámico → Desactivado tras simular (F1b) | FALLA: claves quedan, «Borrar» no las limpia | `repro.js`: `cleared = 0` | Corregir |
| Partículas | Dos clics sin selección / con emisor seleccionado (F2) | FALLA: círculos y emisores duplicados | `repro.js`: 2 formas, 2 emisores | Corregir |
| Colisiones | Dinámico rápido contra dinámico fino (F3) | No reproducido en el primer caso | `repro.js`: x máx 978 < 1000 | Explorar casos más extremos |
| Mundo | Luna → Espacio → Tierra; techo + paredes off/on (F4) | FALLA: pierde gravedad (160→980) y techo | `repro.js` | Corregir |
| Fuerzas | Ventilador afecta a todo (F5) | Por diseño, sin forma de acotarlo | `repro.js` | Añadir «Solo afecta a» |

## Registro de trabajo

- Sesión 1 (QA): auditoría, reproducción de F1–F5.

## Siguiente acción

Corregir F1 (cambio de tipo tras simular) con prueba de regresión en `test/qa-regressions.test.js`.
