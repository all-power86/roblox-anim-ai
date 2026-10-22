# Animador IA para Roblox

Web que crea animaciones para cualquier cosa con esqueleto de Roblox (personajes R15/R6,
criaturas con huesos como las de Meshy, objetos con bisagras) a partir de una descripción
en texto, y las descarga como `.rbxmx` para Roblox Studio.

**Cómo funciona:**

1. Cargas un esqueleto. El programa clasifica cada parte (columna, patas, alas, cola…) y te deja corregirla.
2. Elige una **plantilla de movimiento** real (caminar, atacar…) y la adapta a ese esqueleto.
3. La IA (Claude) la modifica para cumplir tu descripción.
4. **Autorrevisión:** se dibujan capturas de la animación, la IA las mira junto con una lista de fallos medidos automáticamente (partes que se atraviesan, pies que patinan, giros imposibles…) y la corrige, como mucho 3 veces.

Capturas de las pruebas: [docs/capturas](docs/capturas/README.md).

## Arrancarlo

1. Instala Node.js 20 o superior (https://nodejs.org).
2. En esta carpeta, ejecuta una vez: `npm install`
3. Arranca:
   - Solo plantillas (sin IA): `npm start`
   - Con IA: `ANIM_ANTHROPIC_KEY=tu_clave npm start`
     (Windows PowerShell: `$env:ANIM_ANTHROPIC_KEY="tu_clave"; npm start`)
     En el entorno de la nube de Claude Code usa ese nombre: `ANTHROPIC_API_KEY` está reservado y no llega a la sesión.
4. Abre http://localhost:3000

La clave de la IA **solo** la lee el servidor. Nunca se envía al navegador.

Opcional: `ANIM_MODEL=claude-sonnet-5-5` usa un modelo más barato (la mitad de precio, algo menos fino).

**Coste aproximado con el modelo por defecto (Claude Opus 5.5): entre 0,20 y 0,80 $ por animación**,
según cuántas rondas de revisión haga. Medido en la prueba real: 0,38 $ (2 rondas) y 0,79 $ (3 rondas).
El consumo de cada llamada se guarda en `logs/revisiones.jsonl`.

## Usar la web

1. **Modelo:** elige un esqueleto de prueba o carga el tuyo (JSON, ver [formato](docs/formato-esqueleto.md)).
   En "Partes detectadas", las marcadas con ⚠ son dudosas: comprueba su función y cámbiala si hace falta.
2. **Animación:** pulsa una plantilla para verla al instante (sin IA), o escribe una descripción y pulsa
   **Generar con IA**. Con "Autorrevisión" marcado verás en "Registro de la IA" qué detectó y corrigió en cada ronda.
3. **Revisión automática:** lista de fallos medidos en la animación actual (rojo = grave, naranja = medio).
4. **Exportar:** elige el contenedor y descarga el `.rbxmx`.

## Probar el `.rbxmx` en Roblox Studio

En `docs/ejemplos/` hay archivos listos para probar sin arrancar la web.

### A. Personaje R15 o R6

1. Abre un sitio vacío en Studio.
2. **Avatar → Rig Builder → R15** (o R6) **→ Block Rig**. Aparece un muñeco llamado "Rig".
3. Clic derecho sobre el muñeco en el Explorador → **Insert from File…** → elige `R15-Caminar-Folder.rbxmx`.
4. **Avatar → Animation Editor**, haz clic en el muñeco.
5. Studio muestra el aviso **"Migrar clips de animación"**: marca **Migrar** y acepta. Es normal en las versiones
   nuevas de Studio (mueve la animación a `ServerStorage › RBX_ANIMSAVES`).
6. Abre el menú **⋯ → Load** y elige "Caminar". Pulsa Play para verla.

**Probado en Studio (22/10/2026):** el contenedor **Folder** funciona (es el que usa la web por defecto).
Si en alguna versión de Studio no apareciera, prueba `R15-Caminar-ObjectValue.rbxmx`, o inserta
`R15-Caminar-SoloKeyframeSequence.rbxmx`, selecciona el muñeco, abre **View → Command Bar**, pega
[`tools/studio/colocar-animacion.lua`](tools/studio/colocar-animacion.lua) y pulsa Enter.

### B. Criatura con huesos (Bone)

1. Clic derecho en **Workspace** → **Insert from File…** → `Modelo-Lobo-huesos.rbxmx`.
   Es un modelo de prueba solo con huesos (sin malla visible); si no ves los huesos, selecciónalos en el Explorador.
2. Inserta `Lobo-Caminar-Folder.rbxmx` dentro del modelo "Lobo" y sigue los pasos 4–6 de arriba.
3. Al reproducir, los huesos deben moverse con las patas alternándose.

**Probado en Studio (22/10/2026):** el Editor de Animaciones carga la animación del lobo y lista toda la
jerarquía de huesos (`Hips`, `Spine1`, `Chest`, `HindLeg_L_1`…) con sus fotogramas.
Falta ver la reproducción con Play para juzgar cómo se mueve.
4. Lo mismo con `Modelo-Dragon-huesos.rbxmx` y `Dragon-Atacar-Folder.rbxmx`.

## Pruebas automáticas

- `npm test`: comprueba el sentido de giro de todas las articulaciones (237 casos), pasa la revisión automática
  por todas las plantillas y verifica que los 114 `.rbxmx` generados reproducen exactamente la vista previa.
  También comprueba que la revisión detecta el mordisco real del lobo que fallaba en Studio (cabeza hacia arriba
  y cuerpo que no se lanza) y que el R15 nuevo con AnimationConstraint exporta igual que el de Motor6D.
- IA simulada (sin clave ni coste): `node tests/mock-anthropic.mjs 4010` y en otra terminal
  `ANIM_ANTHROPIC_KEY=x ANTHROPIC_BASE_URL=http://localhost:4010 npm start`.
- Capturas: `node tools/capture.mjs docs/capturas` (necesita Playwright y el servidor arrancado).

## Archivos

| Archivo | Qué hace |
|---|---|
| `server.js` | Servidor web y API (`/api/generate`, `/api/review`). |
| `server/ai.js` | Instrucciones y llamadas a Claude. Registro en `logs/revisiones.jsonl`. |
| `public/skeleton.js` | Formato de esqueleto universal y cinemática directa. |
| `public/classify.js` | Clasificación automática de partes por función. |
| `public/motion.js` | Reglas por articulación: ejes de doblar/lateral/girar y límites. |
| `public/templates.js` | Plantillas de movimiento por función. |
| `public/animation.js` | Formato de animación, ajuste al suelo y pies fijos. |
| `public/analyze.js` | Detección automática de fallos. |
| `public/viewer.js` | Vista 3D y hojas de capturas. |
| `public/export-roblox.js` | Exportación `.rbxmx` (Motor6D, AnimationConstraint y Bone). |
| `public/skeletons/` | Esqueletos de prueba (se generan con `npm run skeletons`). |
| `docs/` | Formato de esqueleto, capturas y ejemplos para Studio. |

## Limitaciones conocidas

- **Prueba real con IA (22/10/2026):** R15 "caminar cansado" (0,38 $) y lobo "atacar mordiendo" (0,79 $); resultados en
  [docs/prueba-ia](docs/prueba-ia/). Revisadas en Studio pose a pose: el R15 bien; el lobo levantaba la cabeza al morder
  y apenas se lanzaba hacia delante. Ya está corregido (la IA no podía mover el cuerpo y ahora la revisión detecta
  los dos fallos), pero falta repetir la prueba real.
- **R15 nuevo con AnimationConstraint: sin probar en Studio.** El `.rbxmx` es idéntico al del R15 con Motor6D,
  porque las poses llevan el nombre de la pieza que mueve cada articulación. Todavía no hay un script de Studio
  que lea el rig y genere el JSON del esqueleto: hay que escribirlo a mano o usar `r15-nuevo.json`.
- El modelo debe mirar hacia -Z en el esqueleto (el futuro plugin lo normalizará).
- Los ángulos son relativos a la pose de reposo. Las plantillas suponen brazos caídos; en un modelo en pose "T"
  los brazos quedarán más abiertos.
- En los saltos de cuadrúpedos las patas delanteras patinan un poco durante el impulso, y en el saludo del lobo
  la pata que se levanta roza el suelo al despegar (avisos naranjas).
