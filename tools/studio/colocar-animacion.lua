--[[
  Coloca una KeyframeSequence donde el Editor de Animaciones de Studio la busca.
  (Úsalo solo si, tras "Insert from File", la animación no aparece en el menú Load.)

  Cómo usarlo:
  1. En el Explorador selecciona el muñeco (Model). Si la KeyframeSequence no está dentro
     del muñeco, selecciónala también (Ctrl+clic).
  2. Abre View > Command Bar, pega este script entero y pulsa Enter.

  Qué hace (según lo que se sabe del Editor de Animaciones desde diciembre de 2023):
  - Las animaciones guardadas viven en ServerStorage > RBX_ANIMSAVES > <entrada del muñeco>.
  - El muñeco tiene un ObjectValue "AnimSaves" cuyo Value apunta a esa entrada.
  Si el editor ya creó esa estructura, la reutiliza; si no, la crea.
]]
local Selection = game:GetService("Selection")
local ServerStorage = game:GetService("ServerStorage")

local rig, kfs
for _, obj in ipairs(Selection:Get()) do
	if obj:IsA("KeyframeSequence") then kfs = obj
	elseif obj:IsA("Model") then rig = obj end
end
assert(rig, "Selecciona el muñeco (Model) en el Explorador")
kfs = kfs or rig:FindFirstChildWhichIsA("KeyframeSequence", true)
assert(kfs, "No encuentro ninguna KeyframeSequence dentro del muñeco ni en la selección")

local animSaves = ServerStorage:FindFirstChild("RBX_ANIMSAVES")
if not animSaves then
	animSaves = Instance.new("Folder")
	animSaves.Name = "RBX_ANIMSAVES"
	animSaves.Parent = ServerStorage
end

local link = rig:FindFirstChild("AnimSaves")
local store = link and link:IsA("ObjectValue") and link.Value or nil
if not store then
	store = Instance.new("ObjectValue")
	store.Name = rig.Name
	store.Value = rig
	store.Parent = animSaves
end

kfs.Parent = store -- mover la animación antes de tocar el contenedor viejo

if not (link and link:IsA("ObjectValue") and link.Value == store) then
	if link then link:Destroy() end -- contenedor importado (Folder u ObjectValue vacío)
	local newLink = Instance.new("ObjectValue")
	newLink.Name = "AnimSaves"
	newLink.Value = store
	newLink.Parent = rig
end

print(("Animación '%s' colocada en %s. Abre el Editor de Animaciones > ... > Load."):format(kfs.Name, store:GetFullName()))
