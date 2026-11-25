# Gravedad 1.3 · física 2D nativa para After Effects

Extensión (panel CEP) con **motor de física incluido**: no necesita plugins compilados, así que el mismo
`Gravedad-1.3.0.zxp` funciona en **macOS y Windows** (After Effects 2022 o posterior).

La física se calcula en el panel (Box2D vía [planck.js](https://github.com/piqnt/planck.js), MIT) y se escribe como
**fotogramas clave de Posición y Rotación**: el resultado se reproduce al instante, se renderiza en cualquier equipo y
se deshace con Ctrl/Cmd+Z.

## Instalar

1. Si tienes **Gravedad Nativa 0.6.x**, desinstálala primero (usa otro identificador y quedaría un panel roto).
   La 0.5.0 se sustituye sola.
2. Instala `Gravedad-1.3.0.zxp` con un instalador de ZXP (por ejemplo *ZXP Installer* de aescripts, gratuito), o con
   el instalador de Adobe desde la terminal:
   - macOS:
     ```bash
     "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install ~/Downloads/Gravedad-1.3.0.zxp
     ```
   - Windows (PowerShell):
     ```bash
     & "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "$HOME\Downloads\Gravedad-1.3.0.zxp"
     ```
3. Reinicia After Effects y abre **Ventana › Extensiones › Gravedad**.

Instalación manual (alternativa): descomprime `Gravedad-1.3.0-carpeta.zip` y copia la carpeta `Gravedad` a
`~/Library/Application Support/Adobe/CEP/extensions/` (macOS) o `%APPDATA%\Adobe\CEP\extensions\` (Windows).

## Uso

| Botón | Qué hace |
|---|---|
| **Dinámico** | Las capas seleccionadas caen y chocan. El contorno se detecta solo: formas (incluidas cóncavas), máscaras, texto, PNG/PSD con alfa, vídeo y precomposiciones. Un trazo sin relleno es un recipiente hueco. |
| **Fijo** | Suelos, rampas, recipientes. Si la capa está animada, empuja a los demás siguiendo su animación. |
| **Fuerza** | Ventilador: gira la flecha para orientar. Alt+clic crea un atractor (intensidad negativa = repulsor). |
| **Partículas** | Emisor que genera capas físicas a partir de las capas seleccionadas (varias = formas al azar, ideal para confeti). |
| **Unir capas** | Pivote, barra rígida o muelle entre los puntos de anclaje. Con una sola capa, queda colgada de su anclaje (péndulo). |
| **Simular** | Calcula el área de trabajo y escribe las claves. Vuelve a pulsar tras cualquier cambio. |
| **Borrar simulación** | Devuelve las capas a su pose de partida y elimina las partículas generadas. |

### Medidor de fotogramas

Bajo **Simular**, una tira con un hueco por fotograma del área de trabajo (como la caché de Blender):
verde = simulado y al día · naranja rayado = la escena cambió después de simular · rojo = calculando (con
fotogramas por segundo y tiempo restante) · marcas blancas = choques · línea rosa = tiempo actual de After.
Haz clic o arrastra sobre él para mover el tiempo de After. Mientras calcula, el botón pasa a **Cancelar**.

### Ajustes en el panel

- **Capas seleccionadas**: tipo, forma, materiales (goma, pelota, madera, metal, piedra, hielo, papel, gelatina),
  densidad, fricción, rebote e impulso inicial; se aplican a todas las capas seleccionadas a la vez.
- **Ajustes del mundo**: gravedad (espacio, Luna, Marte, Tierra, Júpiter o a mano), dirección, suelo/lados/techo,
  resistencia del aire, calidad (rápida → máxima) y marcadores al chocar.

### Bordes y contornos

El borde de colisión es el borde **visible**: el relleno más el trazo que sobresale (medio grosor), círculos con su
trazo, trazos sin relleno como recipientes huecos, máscaras en modo Añadir con su expansión, y el alfa real para
texto, precomposiciones, metraje y formas con modificadores (recortar, combinar, repetidor…). Las puntas afiladas
llegan hasta el pico. Los agujeros interiores (una letra O, un dónut) se rellenan.

Cada cuerpo recibe controles nativos en *Controles de efectos*: tipo, forma (automática/caja/círculo), densidad,
fricción, rebote e impulso inicial (velocidad, dirección y giro). Una animación propia justo antes del área de trabajo
sirve de lanzamiento. El nulo **Gravedad · Mundo** guarda gravedad, dirección, suelo/lados/techo, resistencia del aire,
calidad (pasos por segundo) y marcadores al chocar.

Las capas pueden tener padre (se quita conservando la pose), dimensiones separadas, entrar más tarde (aparecen en su
punto de entrada) y escalas no uniformes.

### Calidad automática

La calidad elegida es un mínimo: Gravedad la sube sola (y lo dice en los avisos) cuando la escena lo necesita para no
dar resultados falsos: densidades muy distintas apiladas, gravedad muy alta, o paredes dinámicas finas con cuerpos
rápidos. Las relaciones de densidad extremas se limitan (1000:1 con gravedad terrestre, menos con más gravedad) y
también se avisa. Si dos capas empiezan exactamente en el mismo sitio (por ejemplo, una capa duplicada sin mover), el
aviso las nombra con su número de capa.

## Desarrollo

```bash
npm install
```
```bash
npm test
```
```bash
npm run build
```
```bash
python3 tools/verify_zxp.py --strict dist/Gravedad-1.3.0.zxp
```

- `src/` es la extensión tal cual se empaqueta. `src/host/*.jsx` es ExtendScript (ES3, solo ASCII: `node tools/ascii-jsx.js`).
- `test/mock-ae.js` imita el modelo de scripting de After para probar el host de extremo a extremo; `test/panel.test.js`
  ejecuta el panel real en Chromium contra ese modelo.
- `tools/pack.js` firma con un certificado autofirmado en `.cert/` (se crea si falta; no se sube al repositorio).
  Conserva esa carpeta para firmar las siguientes versiones con el mismo certificado.
- Batería de escenas del motor (más de 10 000, reanudable): `node tools/battery/run.js --workers 3`; repetir un caso por
  semilla: `node tools/battery/run.js --family <familia> --seed <n>`. Detalles en `QA_PROGRESS.md`.
