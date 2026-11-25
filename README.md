# Gravedad 1.0 · física 2D nativa para After Effects

Extensión (panel CEP) con **motor de física incluido**: no necesita plugins compilados, así que el mismo
`Gravedad-1.0.0.zxp` funciona en **macOS y Windows** (After Effects 2022 o posterior).

La física se calcula en el panel (Box2D vía [planck.js](https://github.com/piqnt/planck.js), MIT) y se escribe como
**fotogramas clave de Posición y Rotación**: el resultado se reproduce al instante, se renderiza en cualquier equipo y
se deshace con Ctrl/Cmd+Z.

## Instalar

1. Si tienes **Gravedad Nativa 0.6.x**, desinstálala primero (usa otro identificador y quedaría un panel roto).
   La 0.5.0 se sustituye sola.
2. Instala `Gravedad-1.0.0.zxp` con un instalador de ZXP (por ejemplo *ZXP Installer* de aescripts, gratuito), o con
   el instalador de Adobe desde la terminal:
   - macOS:
     ```bash
     "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install ~/Downloads/Gravedad-1.0.0.zxp
     ```
   - Windows (PowerShell):
     ```bash
     & "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "$HOME\Downloads\Gravedad-1.0.0.zxp"
     ```
3. Reinicia After Effects y abre **Ventana › Extensiones › Gravedad**.

Instalación manual (alternativa): descomprime `Gravedad-1.0.0-carpeta.zip` y copia la carpeta `Gravedad` a
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

Cada cuerpo recibe controles nativos en *Controles de efectos*: tipo, forma (automática/caja/círculo), densidad,
fricción, rebote e impulso inicial (velocidad, dirección y giro). Una animación propia justo antes del área de trabajo
sirve de lanzamiento. El nulo **Gravedad · Mundo** guarda gravedad, dirección, suelo/lados/techo, resistencia del aire,
calidad (pasos por segundo) y marcadores al chocar.

Las capas pueden tener padre (se quita conservando la pose), dimensiones separadas, entrar más tarde (aparecen en su
punto de entrada) y escalas no uniformes.

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
python3 tools/verify_zxp.py --strict dist/Gravedad-1.0.0.zxp
```

- `src/` es la extensión tal cual se empaqueta. `src/host/*.jsx` es ExtendScript (ES3, solo ASCII: `node tools/ascii-jsx.js`).
- `test/mock-ae.js` imita el modelo de scripting de After para probar el host de extremo a extremo; `test/panel.test.js`
  ejecuta el panel real en Chromium contra ese modelo.
- `tools/pack.js` firma con un certificado autofirmado en `.cert/` (se crea si falta; no se sube al repositorio).
  Conserva esa carpeta para firmar las siguientes versiones con el mismo certificado.
