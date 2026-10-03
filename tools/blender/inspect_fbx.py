"""Headless inspection of an FBX/GLB: objects, armatures, actions. Never saves anything.
blender -b --factory-startup -P inspect_fbx.py -- <file>"""
import bpy, sys
path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
if path.lower().endswith(".fbx"):
    try:
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
    except Exception as e:
        print("import_scene.fbx failed", e); bpy.ops.wm.fbx_import(filepath=path)
else:
    bpy.ops.import_scene.gltf(filepath=path)
print("FILE", path)
for o in bpy.data.objects:
    extra = ""
    if o.type == "MESH":
        extra = f"verts={len(o.data.vertices)} mats={[m.name for m in o.data.materials if m]} dims={tuple(round(d,2) for d in o.dimensions)}"
    if o.type == "ARMATURE":
        extra = f"bones={len(o.data.bones)} first={[b.name for b in o.data.bones][:6]}"
    print(f"OBJ {o.type:8s} {o.name:40s} parent={o.parent.name if o.parent else '-'} {extra}")
for a in bpy.data.actions:
    print(f"ACTION {a.name:50s} frames={tuple(round(f) for f in a.frame_range)}")
