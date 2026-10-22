# Animador IA para Roblox (prototipo)

Escribes una descripción ("saludar con la mano"), la IA (Claude) genera los keyframes
de una animación R15 y la página la muestra en 3D.

## Cómo arrancarlo

1. Instala Node.js 20 o superior (https://nodejs.org).
2. En esta carpeta, ejecuta una vez: `npm install`
3. Arranca el servidor:
   - Solo demos (sin IA): `npm start`
   - Con IA: `ANTHROPIC_API_KEY=tu_clave npm start`
     (en Windows PowerShell: `$env:ANTHROPIC_API_KEY="tu_clave"; npm start`)
4. Abre http://localhost:3000

Opcional: `ANIM_MODEL=claude-haiku-5-5` usa un modelo más barato y rápido (menos preciso).

## Llevar la animación a Roblox Studio

1. En la web, pulsa **Descargar para Roblox Studio (.rbxmx)**.
2. En Roblox Studio, crea un muñeco R15: pestaña **Avatar → Rig Builder → R15 → Block Rig**.
3. En el Explorador, clic derecho sobre el muñeco → **Insert from File…** → elige el `.rbxmx`.
   Dentro del muñeco aparece `AnimSaves` con la animación.
   (Si el muñeco ya tenía un `AnimSaves`, mueve la animación dentro del que ya existía y borra el nuevo.)
4. Abre **Avatar → Animation Editor**, selecciona el muñeco y, en el menú **⋯ → Load**, elige la animación.
5. Desde ahí la puedes retocar y publicarla con **⋯ → Publish to Roblox** para usarla en tu juego.

## Archivos

- `server.js` — servidor web y llamada a la IA (instrucciones para la IA en `SYSTEM_PROMPT`).
- `public/rig.js` — el muñeco R15: piezas, articulaciones y medidas.
- `public/presets.js` — animaciones de demo hechas a mano.
- `public/animation.js` — cálculo de poses (lo usan la vista previa y la exportación).
- `public/export-roblox.js` — crea el archivo `.rbxmx` (KeyframeSequence) para Roblox Studio.
- `public/app.js` — escena 3D y reproductor de keyframes.
- `public/index.html`, `public/style.css` — la página.

## Formato de la animación

```json
{
  "name": "Saludar", "duration": 2.2, "loop": true,
  "keyframes": [
    { "time": 0.35, "easing": "Cubic", "rootOffset": {"x":0,"y":0,"z":0},
      "poses": [ { "joint": "RightShoulder", "rx": 0, "ry": 0, "rz": 100 } ] }
  ]
}
```

Rotaciones en grados, como `CFrame.Angles(rx, ry, rz)` sobre el Motor6D del mismo nombre.
El personaje mira hacia -Z (convención de Roblox), así que exportar a una KeyframeSequence es directo.
