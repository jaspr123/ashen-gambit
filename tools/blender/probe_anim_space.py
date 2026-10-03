"""Compare world-space hips/neck of the character rig vs the animation source rig (read-only)."""
import bpy, sys, os
root = sys.argv[sys.argv.index("--") + 1]
SA = os.path.join(root, ".asset-cache", "unity", "SimpleApocalypse", "Models", "Characters")
bpy.ops.wm.read_factory_settings(use_empty=True)
def imp(p):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=p, automatic_bone_orientation=False, ignore_leaf_bones=True)
    return [o for o in bpy.data.objects if o not in before]
rig = next(o for o in imp(os.path.join(SA, "SA_Character.fbx")) if o.type == "ARMATURE")
src = next(o for o in imp(os.path.join(SA, "Animator", "Animations.fbx")) if o.type == "ARMATURE")
for o in (rig, src):
    print("OBJ", o.name, "rot", tuple(round(r, 3) for r in o.rotation_euler), "scale", tuple(round(s, 4) for s in o.scale))
    for b in ("Root_jnt", "Hips_jnt", "Neck_jnt"):
        pb = o.pose.bones.get(b)
        if pb:
            print("  ", b, "world head", tuple(round(v, 3) for v in (o.matrix_world @ pb.head)), "rest head(local)", tuple(round(v, 2) for v in pb.bone.head_local))
scene = bpy.context.scene
for f in (2, 20):
    scene.frame_set(f)
    print("FRAME", f)
    for b in ("Root_jnt", "Hips_jnt", "Neck_jnt"):
        pb = src.pose.bones.get(b)
        if pb: print("   src", b, tuple(round(v, 3) for v in (src.matrix_world @ pb.head)))
print("SRC action", src.animation_data.action.name if src.animation_data and src.animation_data.action else None)
print("SRC parent of Hips", src.data.bones["Hips_jnt"].parent.name if src.data.bones["Hips_jnt"].parent else None)
r = src.data.bones["Root_jnt"]
print("Root_jnt rest matrix", [tuple(round(x, 3) for x in row) for row in r.matrix_local])
h1 = rig.data.bones["Hips_jnt"]; h2 = src.data.bones["Hips_jnt"]
print("Hips rest rig", [tuple(round(x, 3) for x in row) for row in h1.matrix_local])
print("Hips rest src", [tuple(round(x, 3) for x in row) for row in h2.matrix_local])
