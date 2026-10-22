# Formato de esqueleto universal (`roblox-anim-ai/skeleton@1`)

Un archivo JSON que describe cualquier cosa animable de Roblox: personajes R15/R6,
criaturas con mallas y huesos (Meshy, Blender), u objetos con bisagras.
El futuro plugin de Studio lo exportará automáticamente; también se puede escribir a mano.

## Ejemplo mínimo (una puerta)

```json
{
  "format": "roblox-anim-ai/skeleton@1",
  "name": "Puerta",
  "rootPart": "Marco",
  "joints": [
    {
      "name": "Bisagra",
      "type": "Motor6D",
      "parent": null,
      "part": "Hoja",
      "cframe": [-2, 3.5, 0,  1, 0, 0,  0, 1, 0,  0, 0, 1],
      "partSize": [4, 7, 0.3],
      "partCFrame": [0, 3.5, 0,  1, 0, 0,  0, 1, 0,  0, 0, 1]
    }
  ]
}
```

## Campos generales

| Campo | Obligatorio | Qué es |
|---|---|---|
| `format` | sí | Siempre `"roblox-anim-ai/skeleton@1"`. |
| `name` | no | Nombre para mostrar. |
| `rootPart` | sí | Pieza que **no** se anima y de la que cuelga todo (normalmente `HumanoidRootPart`; en una malla con huesos, la MeshPart). Es la raíz del árbol de poses del `.rbxmx`. |
| `ground` | no | Altura del suelo (studs). Si falta, se usa el punto más bajo del modelo en reposo. |
| `joints` | sí | Lista de articulaciones (ver abajo). |

## Cada articulación (`joints[]`)

| Campo | Obligatorio | Qué es |
|---|---|---|
| `name` | sí | Nombre del `Motor6D`, `AnimationConstraint` o `Bone`. Debe ser único. |
| `type` | sí | `"Motor6D"`, `"AnimationConstraint"` (rigs R15 nuevos de Studio) o `"Bone"`. Las entradas `"BallSocketConstraint"` se aceptan y se ignoran (solo son física del ragdoll). |
| `parent` | sí | Nombre de la articulación padre, o `null` si cuelga directamente de `rootPart`. En un Motor6D o AnimationConstraint, el padre es la articulación cuya pieza es el `Part0` (o el padre de `Attachment0`) de este. |
| `part` | Motor6D/AnimationConstraint: sí. Bone raíz: sí | Motor6D/AnimationConstraint: nombre del `Part1` (la pieza que mueve, el padre de `Attachment1`; la pose del `.rbxmx` lleva este nombre). Bone sin padre: la MeshPart que contiene el hueso. |
| `cframe` | sí | Marco de la articulación **en reposo, en coordenadas de mundo**: los 12 números de `CFrame:GetComponents()`. Motor6D: `Part0.CFrame * C0`. AnimationConstraint: `Attachment0.WorldCFrame`. Bone: `Bone.WorldCFrame`. |
| `partSize`, `partCFrame` | no | Tamaño y CFrame de mundo del `Part1` (Motor6D/AnimationConstraint). Sirven para dibujar la vista previa y detectar choques. |
| `radius` | no | Grosor aproximado del hueso (Bone), para la vista previa y los choques. |
| `role`, `side` | no | Fuerza la función de la parte (ver lista) y el lado (`L`, `R`, `C`). Si faltan, se detectan solos. |
| `hingeAxis` | no | Solo bisagras: eje de giro en mundo, p. ej. `[0, 1, 0]`. |

## Convenciones

- Unidades en studs; eje Y hacia arriba.
- **El modelo debe mirar hacia -Z** (la dirección "delante" de Roblox, `LookVector`). El plugin lo normalizará.
- La pose en reposo es la del momento de exportar. Los ángulos de las animaciones son relativos a ella.

## Funciones (`role`)

`root` (raíz/pelvis), `spine` (columna), `neck` (cuello), `head` (cabeza), `jaw` (mandíbula),
`tail` (cola), `arm.clavicle`, `arm.upper`, `arm.lower`, `hand`, `leg.upper`, `leg.lower`,
`leg.lower2` (corvejón de patas de 3 tramos), `foot`, `toe`, `wing.1` (base del ala),
`wing.2` (resto del ala), `hinge` (bisagra), `fixed` (no se anima).

## Cómo se aplica la animación

Para cada articulación el programa calcula un giro local `T` (y una traslación en la raíz):

- Motor6D: `Part1.CFrame = Part0.CFrame * C0 * T * C1:Inverse()`, es decir, `Motor6D.Transform = T`.
- AnimationConstraint: `Part1.CFrame = Attachment0.WorldCFrame * T * Attachment1.CFrame:Inverse()`, es decir, `AnimationConstraint.Transform = T`.
- Bone: `Bone.Transform = T`.

En el `.rbxmx`, cada `Pose` guarda ese `T` en su `CFrame`.
