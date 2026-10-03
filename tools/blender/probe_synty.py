"""Probe the Synty Simple rig + animation takes (read-only).
blender -b --factory-startup -P probe_synty.py -- <unity_cache_dir>"""
import bpy, sys, os

root = sys.argv[sys.argv.index("--") + 1]
SA = os.path.join(root, "SimpleApocalypse", "Models")
bpy.ops.wm.read_factory_settings(use_empty=True)

def imp(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=True)
    return [o for o in bpy.data.objects if o not in before]

objs = imp(os.path.join(SA, "Characters", "SA_Character.fbx"))
arm = next(o for o in objs if o.type == "ARMATURE")
print("SCENE FPS", bpy.context.scene.render.fps, "unit scale", bpy.context.scene.unit_settings.scale_length)
print("ARM", arm.name, "scale", tuple(round(s, 4) for s in arm.scale), "rot", tuple(round(r, 3) for r in arm.rotation_euler))
for b in arm.data.bones:
    print("BONE", b.name, "parent", b.parent.name if b.parent else "-", "head", tuple(round(v, 3) for v in b.head_local), "len", round(b.length, 3))
m = next(o for o in objs if o.name == "SA_Char_Survivor_Scout")
print("MESH", m.name, "dims", tuple(round(d, 3) for d in m.dimensions), "matrix_world scale", tuple(round(s, 4) for s in m.matrix_world.to_scale()), "parent", m.parent.name if m.parent else "-")
import mathutils
bb = [m.matrix_world @ mathutils.Vector(c) for c in m.bound_box]
print("MESH WORLD Z", round(min(v.z for v in bb), 3), round(max(v.z for v in bb), 3))

for name in ["Animations.fbx", "Animations_Melee.fbx", "Animations_Static.fbx", "Animations_IK.fbx"]:
    before_actions = set(bpy.data.actions)
    o2 = imp(os.path.join(SA, "Characters", "Animator", name))
    for a in bpy.data.actions:
        if a not in before_actions:
            print("ACTION", name, a.name, "range", tuple(a.frame_range), "fps", bpy.context.scene.render.fps)
    a2 = next((o for o in o2 if o.type == "ARMATURE"), None)
    if a2:
        print("  ANIMARM", a2.name, "scale", tuple(round(s, 4) for s in a2.scale), "bones", len(a2.data.bones), [b.name for b in a2.data.bones][:3])

w = imp(os.path.join(SA, "Weapons", "SA_Wep_Crowbar.fbx"))
for o in w:
    print("WEAPON", o.name, o.type, "loc", tuple(round(v, 3) for v in o.location), "dims", tuple(round(d, 3) for d in o.dimensions), "scale", tuple(round(s, 3) for s in o.scale))
