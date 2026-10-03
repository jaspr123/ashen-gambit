"""
Ashen Gambit — faction asset builder (Blender 4.4+/5.x, headless).

Builds the four built-in armies from the extracted Synty "Simple" packs
(Unity Asset Store cache) and the CC0 Quaternius horse, then exports
web-ready GLBs + a shared humanoid animation library + manifest.json.

Never touches the source packages: everything is read from .asset-cache/
(extracted copies) and written to apps/client/public/assets/.

Usage:
  blender -b --factory-startup -P tools/blender/build_factions.py -- <repo_root> [--preview-only]
"""
import bpy, bmesh, sys, os, json, math, re
import numpy as np
from mathutils import Vector, Matrix, Euler

ARGS = sys.argv[sys.argv.index("--") + 1:]
ROOT = os.path.abspath(ARGS[0])
CACHE = os.path.join(ROOT, ".asset-cache")
UNITY = os.path.join(CACHE, "unity")
SA = os.path.join(UNITY, "SimpleApocalypse")
OUT = os.path.join(ROOT, "apps", "client", "public", "assets")
QA = os.path.join(ROOT, ".qa")
HORSE = os.path.join(CACHE, "Horse.gltf")
os.makedirs(OUT, exist_ok=True)
os.makedirs(QA, exist_ok=True)

# Piece heights in board squares (1 square = 1 world unit in the game).
HEIGHT = {"pawn": 0.82, "knight": 1.12, "bishop": 1.02, "rook": 1.0, "queen": 1.1, "king": 1.2}
MAX_FOOT = 0.92

# -------------------------------------------------------------------------- clip table (from the Unity .meta files)
CLIPS = {
    "base": {"Idle": (2, 45), "Walk": (51, 79), "Run": (82, 99), "Death_01": (492, 547), "Dead_01": (548, 549), "Death_02": (901, 970),
             "Dead_02": (970, 971), "Falling": (550, 579), "Standing_Jump": (582, 608), "Salute": (1116, 1200), "GrenadeThrow": (1037, 1106),
             "CrossArms": (781, 850), "Crouch_Idle": (990, 1000), "Idle_CheckWatch": (381, 420)},
    "melee": {"Melee_OneHanded": (810, 845), "Melee_TwoHanded": (855, 890), "Melee_Stab": (900, 930)},
    "static": {"Walk_Static": (52, 79), "Run_Static": (81, 98)},
    "ik": {"Shoot_Rifle": (72, 88), "Shoot_Handgun": (5, 22), "Shoot_Shotgun": (251, 271)},
}
CLIP_RENAME = {"Walk_Static": "Walk", "Run_Static": "Run"}  # in-place locomotion wins over root-motion versions

# -------------------------------------------------------------------------- utils
def log(*a): print("[build]", *a, flush=True)

def deselect():
    for o in bpy.context.selected_objects: o.select_set(False)

def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=True)
    return [o for o in bpy.data.objects if o not in before]

def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

def world_bbox(objs):
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != "MESH": continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = o.matrix_world
        pts.extend(mw @ v.co for v in me.vertices)
        ev.to_mesh_clear()
    if not pts: return Vector((0, 0, 0)), Vector((0, 0, 0))
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx

def material(name, color, metal=0.2, rough=0.6, emissive=None, strength=3.0, image=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.interpolation = "Closest"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if emissive:
        bsdf.inputs["Emission Color"].default_value = (*emissive, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m

def hexc(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x ** 2.2 for x in c)  # sRGB -> linear

def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)

def rest_head(arm, bone):
    return arm.matrix_world @ arm.data.bones[bone].head_local

def rest_tail(arm, bone):
    return arm.matrix_world @ arm.data.bones[bone].tail_local

def parent_to_bone(obj, arm, bone):
    """
    Rigidly SKIN an object to one bone (vertex group weight 1 + Armature modifier).
    glTF exports bone-parented children with a bone-axis correction that does not
    match Blender, so props/plates/riders are skinned instead (proven-correct path).
    The object must currently sit at its rest-pose world placement.
    """
    bpy.context.view_layer.update()  # matrix_world is stale right after setting .location
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = mw
    deselect(); obj.select_set(True); bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        if mod.type != "ARMATURE": bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.vertex_groups.clear()
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()

def merge_into(main, parts):
    """Join rigidly-skinned parts into the main skinned mesh (one draw call per material)."""
    parts = [p for p in parts if p and p is not main and p.type == "MESH"]
    if not parts: return main
    deselect()
    for p in parts: p.select_set(True)
    main.select_set(True)
    bpy.context.view_layer.objects.active = main
    bpy.ops.object.join()
    return main

# -------------------------------------------------------------------------- primitives (for props + robots)
def prim_box(name, size, loc, mat, bevel=0.08, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = o.modifiers.new("bevel", "BEVEL")
        mod.width = bevel * min(size)
        mod.segments = 2
        mod.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(mat)
    for p in o.data.polygons: p.use_smooth = False
    return o

def prim_cyl(name, r1, r2, depth, loc, mat, rot=(0, 0, 0), verts=12):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    return o

def prim_sphere(name, r, loc, mat, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=r, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return o

def prim_torus(name, R, r, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=24, minor_segments=8, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    return o

def join(objs, name):
    deselect()
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o

# -------------------------------------------------------------------------- class signature props (built at the head top)
def signature(pc, top, scale, gold, glow):
    """Returns a list of objects forming the class silhouette marker above/around the head."""
    s = scale
    x, y, z = top
    parts = []
    if pc == "king":
        parts.append(prim_cyl("crown_band", 0.17 * s, 0.15 * s, 0.11 * s, (x, y, z + 0.03 * s), gold))
        for i in range(4):
            a = i / 4 * math.tau + math.pi / 4
            parts.append(prim_box(f"crown_pt{i}", (0.05 * s, 0.03 * s, 0.13 * s), (x + math.cos(a) * 0.15 * s, y + math.sin(a) * 0.15 * s, z + 0.12 * s), gold, 0.1))
        parts.append(prim_box("cross_v", (0.045 * s, 0.045 * s, 0.24 * s), (x, y, z + 0.27 * s), gold, 0.1))
        parts.append(prim_box("cross_h", (0.17 * s, 0.045 * s, 0.045 * s), (x, y, z + 0.3 * s), gold, 0.1))
        parts.append(prim_sphere("crown_gem", 0.035 * s, (x, y - 0.03 * s, z + 0.3 * s), glow))
    elif pc == "queen":
        parts.append(prim_torus("coronet", 0.16 * s, 0.022 * s, (x, y, z + 0.03 * s), gold))
        for i in range(7):
            a = i / 7 * math.tau
            h = (0.2 if i % 2 == 0 else 0.13) * s
            c = prim_cyl(f"spike{i}", 0.03 * s, 0.0, h, (x + math.cos(a) * 0.16 * s, y + math.sin(a) * 0.16 * s, z + 0.03 * s + h / 2), gold, verts=5)
            c.rotation_euler = (-math.sin(a) * 0.25, math.cos(a) * 0.25, 0)
            parts.append(c)
        parts.append(prim_sphere("coronet_gem", 0.035 * s, (x, y - 0.16 * s, z + 0.05 * s), glow))
    elif pc == "bishop":
        m = prim_cyl("mitre", 0.15 * s, 0.0, 0.42 * s, (x, y, z + 0.17 * s), gold, verts=4)
        m.rotation_euler = (0, 0, math.pi / 4)
        m.scale = (1, 0.6, 1)
        parts.append(m)
        parts.append(prim_box("mitre_slit", (0.025 * s, 0.01 * s, 0.26 * s), (x, y - 0.07 * s, z + 0.15 * s), glow, 0))
    return parts

def rook_battlement(center, radius, height, mat):
    """Crenellated gorget around the shoulders — the rook silhouette."""
    x, y, z = center
    parts = [prim_cyl("gorget", radius, radius * 0.92, height * 0.6, (x, y, z), mat, verts=16)]
    for i in range(6):
        a = i / 6 * math.tau
        parts.append(prim_box(f"merlon{i}", (radius * 0.42, radius * 0.3, height), (x + math.cos(a) * radius * 0.86, y + math.sin(a) * radius * 0.86, z + height * 0.55), mat, 0.08, rot=(0, 0, a)))
    return parts

# -------------------------------------------------------------------------- texture recolouring (faction identity)
def recolor(img, mode):
    """Faction palette pass on a copy of a Synty character texture."""
    new = img.copy()
    new.name = f"{img.name}_{mode}"
    px = np.array(new.pixels[:], dtype=np.float32).reshape(-1, 4)
    rgb = px[:, :3]
    lum = (rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[:, None]
    sat = (rgb.max(1) - rgb.min(1))[:, None]
    if mode == "vault":       # clean whites + vault blue
        tint = np.array([0.82, 0.9, 1.0], dtype=np.float32)
        out = np.where(sat > 0.12, lum * 1.45 * tint, lum * 1.1 * np.array([0.6, 0.72, 0.95], dtype=np.float32))
        out = np.clip(out * 0.9 + 0.06, 0, 1)
    elif mode == "wastelanders":  # rust, grime, sun-bleached leather
        out = np.clip(rgb * np.array([1.08, 0.82, 0.62], dtype=np.float32) * 0.86 + lum * np.array([0.08, 0.03, 0.0], dtype=np.float32), 0, 1)
    elif mode == "remnants":  # olive drab military
        olive = np.array([0.42, 0.45, 0.28], dtype=np.float32)
        out = np.clip(rgb * 0.55 + lum * olive * 0.9, 0, 1)
    else:
        out = rgb
    px[:, :3] = out
    new.pixels = px.ravel().tolist()
    new.pack()
    return new

# -------------------------------------------------------------------------- weapons
WEAPON_DIR = os.path.join(SA, "Models", "Weapons")

def load_weapon(fname, length, hand_world, kind="melee"):
    """Import a Synty weapon, scale it to `length`, point it forward (-Y) with the grip at the hand."""
    objs = import_fbx(os.path.join(WEAPON_DIR, fname))
    meshes = [o for o in objs if o.type == "MESH"]
    for o in objs:
        if o.type != "MESH": bpy.data.objects.remove(o)
    w = meshes[0] if len(meshes) == 1 else join(meshes, fname)
    w.parent = None
    deselect(); w.select_set(True); bpy.context.view_layer.objects.active = w
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    verts = np.array([v.co[:] for v in w.data.vertices], dtype=np.float32)
    ext = verts.max(0) - verts.min(0)
    ax = int(np.argmax(ext))
    t = (verts[:, ax] - verts[:, ax].min()) / max(1e-6, ext[ax])
    others = [i for i in range(3) if i != ax]
    def width(mask):
        sub = verts[mask][:, others]
        return float((sub.max(0) - sub.min(0)).sum()) if len(sub) else 1e9
    lo, hi = width(t < 0.15), width(t > 0.85)
    # Melee: the thinner end is the handle. Guns: grip sits toward the thicker (stock) end.
    handle_low = (lo < hi) if kind == "melee" else (lo > hi)
    grip_t = 0.12 if kind == "melee" else 0.32
    grip_coord = verts[:, ax].min() + (grip_t if handle_low else 1 - grip_t) * ext[ax]
    grip = verts.mean(0)
    grip[ax] = grip_coord
    # Move grip to origin, align long axis to -Y (forward), handle toward +Y.
    for v in w.data.vertices: v.co -= Vector(grip.tolist())
    axis_vec = [Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))][ax] * (1 if handle_low else -1)
    rot = axis_vec.rotation_difference(Vector((0, -1, 0))).to_matrix().to_4x4()
    w.data.transform(rot)
    if kind == "melee":
        # Carried at a natural angle: tip forward and up (swing animations take it from there).
        w.data.transform(Matrix.Rotation(math.radians(-30), 4, "X"))
    s = length / max(1e-6, float(ext[ax]))
    w.data.transform(Matrix.Scale(s, 4))
    w.location = hand_world
    atlas = bpy.data.images.load(os.path.join(SA, "Textures", "SimpleApocalypse_Texture.png"), check_existing=True)
    w.data.materials.clear()
    w.data.materials.append(material("MAT_weapon_atlas", (1, 1, 1), metal=0.3, rough=0.6, image=atlas))
    return w

# -------------------------------------------------------------------------- base scene: Synty rig + clips
def setup_synty():
    objs = import_fbx(os.path.join(SA, "Models", "Characters", "SA_Character.fbx"))
    arm = next(o for o in objs if o.type == "ARMATURE")
    arm.name = "SA_RIG"
    meshes = {o.name: o for o in objs if o.type == "MESH"}
    for o in meshes.values(): o.hide_render = True; o.hide_set(True)
    return arm, meshes

def import_clip_actions():
    """Import each animation FBX; keep its armature (hidden) as the retarget source. Returns {group: (armature, action)}."""
    sources = {"base": "Animations.fbx", "melee": "Animations_Melee.fbx", "static": "Animations_Static.fbx", "ik": "Animations_IK.fbx"}
    out = {}
    for key, fname in sources.items():
        before = set(bpy.data.actions)
        objs = import_fbx(os.path.join(SA, "Models", "Characters", "Animator", fname))
        act = [a for a in bpy.data.actions if a not in before][0]
        act.name = f"SRC_{key}"
        act.use_fake_user = True
        arm = next(o for o in objs if o.type == "ARMATURE")
        arm.name = f"SRC_ARM_{key}"
        for o in objs:
            if o is not arm: bpy.data.objects.remove(o)
        out[key] = (arm, act)
    return out

# Simple Apocalypse rig (target) <- SimplePeople animation rig (source). Unmapped
# target bones (Spine_jnt.001, shoulders) keep their rest relative to the parent.
BONE_MAP = {
    "Chest_jnt": "Body_jnt", "Neck_jnt": "Head_jnt",
    "Arm_Left_jnt": "UpperArm_Left_jnt", "Arm_Right_jnt": "UpperArm_Right_jnt",
    "Forearm_Left_jnt": "LowerArm_Left_jnt", "Forearm_Right_jnt": "LowerArm_Right_jnt",
}

def bake_clip(target, source, action, f0, f1, name):
    """
    Rest-offset-preserving retarget, keyed directly (no constraints):
      R_target_world = R_source_world @ (R_source_rest_world^-1 @ R_target_rest_world)
    Rotations transfer for every shared bone; the root (Hips) also takes its translation.
    Bones are processed parents-first so each child's armature-space matrix is exact.
    """
    scene = bpy.context.scene
    source.animation_data_create()
    source.animation_data.action = action
    if hasattr(source.animation_data, "action_slot") and action.slots:
        source.animation_data.action_slot = action.slots[0]
    target.animation_data_create()
    baked = bpy.data.actions.new(name)
    baked.use_fake_user = True
    target.animation_data.action = baked
    tw = target.matrix_world.copy()
    tw_inv = tw.inverted()
    sw = source.matrix_world.copy()
    order = sorted(target.data.bones, key=lambda bn: len(bn.parent_recursive))
    offsets = {}
    src_of = {}
    for bn in order:
        sname = BONE_MAP.get(bn.name, bn.name)
        sb = source.data.bones.get(sname)
        if not sb: continue
        src_of[bn.name] = sname
        s_rest = (sw @ sb.matrix_local).to_3x3().normalized()
        t_rest = (tw @ bn.matrix_local).to_3x3().normalized()
        offsets[bn.name] = s_rest.inverted() @ t_rest
    for pb in target.pose.bones: pb.rotation_mode = "QUATERNION"
    for f in range(int(f0), int(f1) + 1):
        scene.frame_set(f)
        arm_mats = {}
        for bone in order:
            pb = target.pose.bones[bone.name]
            rest = bone.matrix_local
            if bone.parent:
                parent_pose = arm_mats[bone.parent.name]
                rest_rel = bone.parent.matrix_local.inverted() @ rest
                base = parent_pose @ rest_rel
            else:
                base = rest.copy()
            if bone.name in offsets:
                spb = source.pose.bones[src_of[bone.name]]
                s_world = sw @ spb.matrix
                r_world = s_world.to_3x3().normalized() @ offsets[bone.name]
                r_arm = (tw_inv.to_3x3().normalized() @ r_world).normalized()
                if bone.parent:
                    loc_arm = base.translation
                else:
                    loc_arm = (tw_inv @ s_world).translation
                desired = Matrix.Translation(loc_arm) @ r_arm.to_4x4()
            else:
                desired = base
            basis = base.inverted() @ desired if bone.parent else rest.inverted() @ desired
            pb.matrix_basis = basis
            arm_mats[bone.name] = desired
            pb.keyframe_insert("rotation_quaternion", frame=f - int(f0))
            if not bone.parent:
                pb.keyframe_insert("location", frame=f - int(f0))
    target.animation_data.action = None
    for pb in target.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    return baked

def build_anim_library(rig_src, sources):
    """Bake every clip onto a copy of the character rig, then export one NLA track per clip."""
    arm = rig_src.copy(); arm.data = rig_src.data.copy(); link(arm)
    arm.name = "SyntyAnimRig"
    arm.hide_set(False)
    bpy.context.view_layer.update()
    baked = []
    for group, clips in CLIPS.items():
        src_arm, act = sources[group]
        for clip, (a, b) in clips.items():
            name = CLIP_RENAME.get(clip, clip)
            if any(n == name for n, _, _ in baked): continue
            baked.append((name, bake_clip(arm, src_arm, act, a, b, f"CLIP_{name}"), (a, b)))
    arm.animation_data_create()
    for name, action, (a, b) in baked:
        tr = arm.animation_data.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, 0, action)
        st.action_frame_start = a
        st.action_frame_end = b
        st.frame_start = 0
        st.frame_end = b - a
    for _, src_arm_act in sources.items():
        src_arm_act[0].animation_data.action = None
    deselect(); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    path = os.path.join(OUT, "anims", "synty_humanoid.glb")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    export_glb(path, animations=True, nla=True)
    names = [n for n, _, _ in baked]
    log("anim library", len(names), "baked clips ->", path)
    bpy.data.objects.remove(arm)
    for src_arm, _ in sources.values(): bpy.data.objects.remove(src_arm)
    return names

def export_glb(path, animations=False, nla=False):
    kwargs = dict(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                  export_animations=animations, export_skins=True, export_materials="EXPORT", export_image_format="AUTO")
    if animations:
        kwargs["export_animation_mode"] = "NLA_TRACKS" if nla else "ACTIONS"
        kwargs["export_force_sampling"] = True
        kwargs["export_optimize_animation_size"] = True
    bpy.ops.export_scene.gltf(**kwargs)

# -------------------------------------------------------------------------- humanoid pieces
PIECES = {
    "remnants": {
        "recolor": "remnants", "gold": "#c8a046", "glow": "#e8b84a",
        "pawn":   {"mesh": "SA_Char_Survivor_FemaleSoldier", "weapon": ("SA_Wep_AssaultRifle01.fbx", 0.62, "gun")},
        "bishop": {"mesh": "SA_Char_Survivor_Hazard", "weapon": ("SA_Wep_DesertEagle.fbx", 0.25, "gun")},
        "rook":   {"mesh": "SA_Char_Survivor_Male_03", "weapon": ("SA_Wep_DoublebarrelShotgun.fbx", 0.62, "gun"), "bulk": 1.18},
        "queen":  {"mesh": "SA_Char_Survivor_FemaleHero", "weapon": ("SA_Wep_AssaultRifle02.fbx", 0.62, "gun")},
        "king":   {"mesh": "SA_Char_Survivor_MaleTrenchcoat", "weapon": ("SA_Wep_DesertEagle.fbx", 0.25, "gun")},
        "rider":  {"mesh": "SA_Char_Survivor_Scout", "weapon": ("SA_Wep_Machete.fbx", 0.5, "melee")},
    },
    "wastelanders": {
        "recolor": "wastelanders", "gold": "#9a6a3a", "glow": "#ffb02e",
        "pawn":   {"mesh": "SA_Char_Survivor_Prisoner", "weapon": ("SA_Wep_Crowbar.fbx", 0.5, "melee")},
        "bishop": {"mesh": "SA_Char_Survivor_HoodedMan", "weapon": ("SA_Wep_Scythe.fbx", 0.75, "melee")},
        "rook":   {"mesh": "SA_Char_Survivor_RoadWorker", "weapon": ("SA_Wep_SledgeHammer.fbx", 0.7, "melee"), "bulk": 1.18},
        "queen":  {"mesh": "SA_Char_Survivor_FemalePyro", "weapon": ("SA_Wep_BaseballbatSaw.fbx", 0.6, "melee")},
        "king":   {"mesh": "SA_Char_Survivor_MaleHunter", "weapon": ("SA_Wep_Mace.fbx", 0.6, "melee")},
        "rider":  {"mesh": "SA_Char_Survivor_Male_04", "weapon": ("SA_Wep_baseballBat.fbx", 0.55, "melee")},
    },
    "vault": {
        "recolor": "vault", "gold": "#d8dde2", "glow": "#39d0ff",
        "pawn":   {"mesh": "SA_Char_Survivor_Biohazard", "weapon": ("SA_Wep_Pipe.fbx", 0.42, "melee")},
        "bishop": {"mesh": "SA_Char_Survivor_Doctor", "weapon": ("SA_Wep_Flaregun.fbx", 0.24, "gun")},
        "rook":   {"mesh": "SA_Char_Survivor_Hazard", "weapon": ("SA_Wep_SledgeHammer.fbx", 0.7, "melee"), "bulk": 1.2},
        "queen":  {"mesh": "SA_Char_Survivor_FemaleTrenchcoat", "weapon": ("SA_Wep_AssaultRifle02.fbx", 0.62, "gun")},
        "king":   {"mesh": "SA_Char_Survivor_OldMan", "weapon": ("SA_Wep_Katana.fbx", 0.7, "melee")},
        "rider":  {"mesh": "SA_Char_Survivor_Male_01", "weapon": ("SA_Wep_Spear.fbx", 0.8, "melee")},
    },
}

TEX = {
    "SA_Char_Survivor_FemaleSoldier": "SA_Character_FemaleSoldier", "SA_Char_Survivor_Hazard": "SA_Character_Hazard", "SA_Char_Survivor_Male_03": "SA_Character_MaleSurvivor03",
    "SA_Char_Survivor_FemaleHero": "SA_Character_FemaleHero", "SA_Char_Survivor_MaleTrenchcoat": "SA_Character_MaleTrenchcoat", "SA_Char_Survivor_Scout": "SA_Character_Scout",
    "SA_Char_Survivor_Prisoner": "SA_Character_PrisonerSurvivor", "SA_Char_Survivor_HoodedMan": "SA_Character_Survivor_02", "SA_Char_Survivor_RoadWorker": "SA_Character_RoadWorkerSurvivor",
    "SA_Char_Survivor_FemalePyro": "SA_Character_FemalePyro", "SA_Char_Survivor_MaleHunter": "SA_Character_MaleSurvivorHunter", "SA_Char_Survivor_Male_04": "SA_Character_Survivor_01",
    "SA_Char_Survivor_Biohazard": "SA_Character_Biohazard", "SA_Char_Survivor_Doctor": "SA_Character_Doctor", "SA_Char_Survivor_FemaleTrenchcoat": "SA_Character_FemaleTrenchcoat",
    "SA_Char_Survivor_OldMan": "SA_Character_OldMaleSurvivor", "SA_Char_Survivor_Male_01": "SA_Character_MaleSurvivor01",
}

_img_cache = {}
def char_material(mesh_name, mode):
    key = (mesh_name, mode)
    if key in _img_cache: return _img_cache[key]
    tex_name = TEX.get(mesh_name)
    path = os.path.join(SA, "Textures", "Characters", f"{tex_name}.png") if tex_name else None
    if not path or not os.path.exists(path):
        path = os.path.join(SA, "Textures", "SimpleApocalypse_Texture.png")
    img = bpy.data.images.load(path, check_existing=True)
    img = recolor(img, mode)
    m = material(f"MAT_{mesh_name}_{mode}", (1, 1, 1), metal=0.05, rough=0.85, image=img)
    _img_cache[key] = m
    return m

def make_character(rig, meshes, mesh_name, mode, name):
    """Duplicate the rig + one survivor mesh into an independent armature."""
    arm = rig.copy(); arm.data = rig.data.copy(); link(arm)
    arm.name = name
    arm.animation_data_clear()
    src = meshes[mesh_name]
    me = src.copy(); me.data = src.data.copy(); link(me)
    me.name = f"{name}_body"
    me.hide_set(False); me.hide_render = False
    me.parent = arm
    me.matrix_parent_inverse = src.matrix_parent_inverse.copy()
    for mod in me.modifiers:
        if mod.type == "ARMATURE": mod.object = arm
    me.data.materials.clear()
    me.data.materials.append(char_material(mesh_name, mode))
    return arm, me

def head_top(me):
    mn, mx = world_bbox([me])
    return Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mx.z)), mx.z - mn.z

def bone_end(arm, bone):
    """
    Where a bone visually ends. FBX import (no automatic bone orientation) leaves
    tails pointing +Z, so use the child's head when there is one, else extend
    along the parent->bone direction.
    """
    b = arm.data.bones[bone]
    if b.children:
        return rest_head(arm, b.children[0].name)
    h = rest_head(arm, bone)
    if b.parent:
        d = (h - rest_head(arm, b.parent.name))
        return h + d * 0.9
    return rest_tail(arm, bone)

def hand_from_vertices(points, elbow, shoulder):
    """Fist centre: mean of the forearm vertices furthest along the upper-arm direction."""
    d = (elbow - shoulder).normalized()
    proj = [((p - elbow).dot(d), p) for p in points]
    if not proj: return elbow + d * 0.4
    far = max(x for x, _ in proj)
    sel = [p for x, p in proj if x > far * 0.8]
    c = Vector((0, 0, 0))
    for p in sel: c += p
    return c / len(sel)

def hand_from_mesh(arm, me, side="Right"):
    gi = me.vertex_groups.get(f"Forearm_{side}_jnt")
    pts = []
    if gi:
        for v in me.data.vertices:
            for g in v.groups:
                if g.group == gi.index and g.weight > 0.5: pts.append(me.matrix_world @ v.co)
    return hand_from_vertices(pts, rest_head(arm, f"Forearm_{side}_jnt"), rest_head(arm, f"Arm_{side}_jnt"))

def hand_pos(arm, side="Right"):
    """Robots (no skinned body): extend the forearm by the upper-arm length ratio."""
    sh, el = rest_head(arm, f"Arm_{side}_jnt"), rest_head(arm, f"Forearm_{side}_jnt")
    return el + (el - sh) * 0.95

def normalise_height(root, objs, target, foot=MAX_FOOT):
    bpy.context.view_layer.update()
    mn, mx = world_bbox(objs)
    h = mx.z - mn.z
    k = target / max(h, 1e-6)
    footprint = max(mx.x - mn.x, mx.y - mn.y) * k
    if footprint > foot: k *= foot / footprint
    root.scale = root.scale * k
    bpy.context.view_layer.update()
    mn, mx = world_bbox(objs)
    root.location.z -= mn.z
    root.location.x -= (mn.x + mx.x) / 2
    root.location.y -= (mn.y + mx.y) / 2

def build_humanoid(rig, meshes, faction, pc, cfg, fstyle):
    name = f"{faction}_{pc}"
    arm, me = make_character(rig, meshes, cfg["mesh"], fstyle["recolor"], name)
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    top, h = head_top(me)
    s = h / 3.0  # Synty characters are ~3 units tall in the imported scene
    gold = material(f"MAT_gold_{faction}", hexc(fstyle["gold"]), metal=0.85, rough=0.35, emissive=hexc(fstyle["glow"]), strength=0.4)
    glow = material(f"MAT_glow_{faction}", hexc(fstyle["glow"]), emissive=hexc(fstyle["glow"]), strength=6.0)
    parts = []
    for p in signature(pc, (top.x, top.y, top.z - 0.08 * s), 1.6 * s, gold, glow):
        parent_to_bone(p, arm, "Neck_jnt"); parts.append(p)
    if pc == "rook":
        chest = rest_head(arm, "Chest_jnt")
        for p in rook_battlement((chest.x, chest.y, chest.z + 0.25 * s), 0.55 * s * cfg.get("bulk", 1.0), 0.22 * s, gold):
            parent_to_bone(p, arm, "Chest_jnt"); parts.append(p)
    if cfg.get("weapon"):
        fname, frac, kind = cfg["weapon"]
        try:
            w = load_weapon(fname, frac * h, hand_from_mesh(arm, me), kind)
            parent_to_bone(w, arm, "Forearm_Right_jnt"); parts.append(w)
        except Exception as e:
            log("weapon failed", fname, e)
    me = merge_into(me, parts)
    arm.data.pose_position = "POSE"
    normalise_height(arm, [me], HEIGHT[pc] * cfg.get("bulk", 1.0) ** 0.25)
    return arm, [me]

# -------------------------------------------------------------------------- knights: rider on a (mechanical or living) horse
HORSE_CLIPS = ("Attack_Headbutt", "Attack_Kick", "Death", "Gallop", "Gallop_Jump", "Idle", "Idle_2", "Idle_HitReact1", "Idle_HitReact2", "Walk", "Eating", "Idle_Headlow", "Jump_toIdle")

def build_knight(rig, meshes, faction, fstyle, robot=False):
    name = f"{faction}_knight"
    objs = import_gltf(HORSE)
    harm = next(o for o in objs if o.type == "ARMATURE")
    hmesh = next(o for o in objs if o.type == "MESH" and o.name.startswith("Horse"))
    for o in objs:
        if o not in (harm, hmesh) and o.type == "MESH": bpy.data.objects.remove(o)
    harm.name = name
    harm.data.pose_position = "REST"
    for a in list(bpy.data.actions):
        if a.name in HORSE_CLIPS: a.use_fake_user = True
    tint = {"remnants": "#6b6a50", "wastelanders": "#5a3a28", "vault": "#c8d4e0", "machines": "#3a3e44"}[faction]
    for slot in hmesh.material_slots:
        m = slot.material.copy(); slot.material = m
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf and not bsdf.inputs["Base Color"].is_linked:
            c = bsdf.inputs["Base Color"].default_value
            t = hexc(tint)
            bsdf.inputs["Base Color"].default_value = (c[0] * 0.4 + t[0] * 0.6, c[1] * 0.4 + t[1] * 0.6, c[2] * 0.4 + t[2] * 0.6, 1)
    bpy.context.view_layer.update()
    hmn, hmx = world_bbox([hmesh])
    horse_h = hmx.z - hmn.z
    seat_bone = "Back" if "Back" in harm.data.bones else harm.data.bones[0].name
    parts = []
    main = hmesh
    if robot:
        plates = steed_plates(harm, fstyle)
        bpy.data.objects.remove(hmesh)
        main = plates[0]
        parts += plates[1:]
    # ---- rider: seated pose baked to a static mesh, then rigidly skinned to the horse's back
    rcfg = fstyle["rider"]
    rarm, rme = make_character(rig, meshes, rcfg["mesh"], fstyle["recolor"], f"{name}_rider_tmp")
    pose = {"UpperLeg_Left_jnt": (-80, 0, -12), "UpperLeg_Right_jnt": (-80, 0, 12), "LowerLeg_Left_jnt": (85, 0, 0), "LowerLeg_Right_jnt": (85, 0, 0),
            "Arm_Left_jnt": (0, 0, 60), "Arm_Right_jnt": (0, 0, -60), "Forearm_Left_jnt": (0, -70, 0), "Forearm_Right_jnt": (0, 70, 0)}
    for b, (x, y, z) in pose.items():
        pb = rarm.pose.bones.get(b)
        if pb:
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = Euler((math.radians(x), math.radians(y), math.radians(z)))
    bpy.context.view_layer.update()
    hips_w = rarm.matrix_world @ rarm.pose.bones["Hips_jnt"].head
    elbow_w = rarm.matrix_world @ rarm.pose.bones["Forearm_Right_jnt"].head
    shoulder_w = rarm.matrix_world @ rarm.pose.bones["Arm_Right_jnt"].head
    deselect(); rme.select_set(True); bpy.context.view_layer.objects.active = rme
    for mod in list(rme.modifiers):
        if mod.type == "ARMATURE": bpy.ops.object.modifier_apply(modifier=mod.name)
    mw = rme.matrix_world.copy(); rme.parent = None; rme.matrix_world = mw
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    gi = rme.vertex_groups.get("Forearm_Right_jnt")
    pts = [v.co.copy() for v in rme.data.vertices if gi and any(g.group == gi.index and g.weight > 0.5 for g in v.groups)]
    hand_w = hand_from_vertices(pts, elbow_w, shoulder_w)
    rme.vertex_groups.clear()
    bpy.data.objects.remove(rarm)
    # Scale to the horse and seat by the hips (rider and horse both face -Y).
    rmn, rmx = world_bbox([rme])
    k = (horse_h * 0.62) / max(1e-6, rmx.z - rmn.z)
    xf = Matrix.Scale(k, 4)
    rme.data.transform(xf)
    hips_w, hand_w = xf @ hips_w, xf @ hand_w
    seat = Vector(((hmn.x + hmx.x) / 2, (hmn.y + hmx.y) / 2 + (hmx.y - hmn.y) * 0.04, hmn.z + horse_h * 0.6))
    off = seat - hips_w
    rme.data.transform(Matrix.Translation(off))
    hand_w = hand_w + off
    rme.name = f"{name}_rider"
    parent_to_bone(rme, harm, seat_bone); parts.append(rme)
    top, rh = head_top(rme)
    glow = material(f"MAT_glow_{faction}", hexc(fstyle["glow"]), emissive=hexc(fstyle["glow"]), strength=6.0)
    crest = prim_box("plume", (0.05 * rh, 0.32 * rh, 0.12 * rh), (top.x, top.y - 0.05 * rh, top.z + 0.02 * rh), glow, 0.2)
    parent_to_bone(crest, harm, seat_bone); parts.append(crest)
    fname, frac, kind = rcfg["weapon"]
    try:
        w = load_weapon(fname, frac * rh * 1.2, Vector((0, 0, 0)), kind)
        w.location = hand_w
        parent_to_bone(w, harm, seat_bone); parts.append(w)
    except Exception as e:
        log("rider weapon failed", e)
    main = merge_into(main, parts)
    harm.data.pose_position = "POSE"
    normalise_height(harm, [main], HEIGHT["knight"])
    return harm, [main]

def steed_plates(harm, fstyle):
    """Mechanical steed: armour plates skinned to the horse's bones (the organic mesh is dropped)."""
    paint = material("MAT_mach_paint", hexc("#c98a1c"), metal=0.55, rough=0.45)
    dark = material("MAT_mach_dark", hexc("#2e3134"), metal=0.8, rough=0.4)
    eye = material("MAT_mach_eye", hexc("#ff5a1f"), emissive=hexc("#ff5a1f"), strength=8.0)
    parts = []
    for b in harm.data.bones:
        n = b.name.lower()
        if any(k in n for k in ("ear", "eye", "tongue", "jaw", "tail", "ik", "pole", "root")): continue
        h, t = rest_head(harm, b.name), rest_tail(harm, b.name)
        L = (t - h).length
        if L < 1e-4: continue
        d = (t - h).normalized()
        rot = Vector((0, 0, 1)).rotation_difference(d).to_euler()
        thick = L * (0.95 if any(k in n for k in ("body", "back", "torso", "neck", "head")) else 0.5)
        mat = paint if any(k in n for k in ("body", "back", "torso", "neck", "head", "upperleg", "thigh", "shoulder")) else dark
        o = prim_box(f"st_{b.name}", (thick, thick, L * 1.05), (h + t) / 2, mat, 0.15, rot=rot)
        parent_to_bone(o, harm, b.name); parts.append(o)
        if n.startswith("head"):
            for side in (-1, 1):
                e = prim_sphere(f"st_eye{side}_{b.name}", thick * 0.16, (h + t) / 2 + Vector((side * thick * 0.45, 0, thick * 0.1)), eye)
                parent_to_bone(e, harm, b.name); parts.append(e)
    return parts

# -------------------------------------------------------------------------- machines: chunky robots rigidly skinned to the humanoid rig
MACHINE_BULK = {"pawn": 0.85, "bishop": 0.9, "rook": 1.35, "queen": 1.0, "king": 1.2}

def build_machine(rig, faction, pc, fstyle):
    name = f"{faction}_{pc}"
    arm = rig.copy(); arm.data = rig.data.copy(); link(arm)
    arm.name = name
    arm.animation_data_clear()
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    b = MACHINE_BULK[pc]
    H = rest_head(arm, "Neck_jnt").z * 1.45
    paint = material("MAT_mach_paint", hexc("#c98a1c"), metal=0.55, rough=0.45)
    dark = material("MAT_mach_dark", hexc("#2e3134"), metal=0.8, rough=0.4)
    trim = material("MAT_mach_trim", hexc("#8a8f96"), metal=0.9, rough=0.3, emissive=hexc("#ff5a1f"), strength=0.3)
    eye = material("MAT_mach_eye", hexc("#ff5a1f"), emissive=hexc("#ff5a1f"), strength=8.0)
    FWD = Vector((0, -1, 0))  # Synty rig faces -Y in Blender
    parts = []

    def add(o, bone):
        parent_to_bone(o, arm, bone)
        parts.append(o)

    def limb(bone, thick, mat, extra=1.0):
        h, t = rest_head(arm, bone), (hand_pos(arm, bone.split("_")[1]) if bone.startswith("Forearm") else bone_end(arm, bone))
        d = (t - h).normalized()
        rot = Vector((0, 0, 1)).rotation_difference(d).to_euler()
        add(prim_box(f"m_{bone}", (thick, thick, (t - h).length * extra), (h + t) / 2, paint if mat == "paint" else dark, 0.18, rot=rot), bone)
        add(prim_sphere(f"m_joint_{bone}", thick * 0.62, h, dark), bone)

    hips, chest, neck = rest_head(arm, "Hips_jnt"), rest_head(arm, "Chest_jnt"), rest_head(arm, "Neck_jnt")
    add(prim_box("m_pelvis", (0.30 * H * b, 0.18 * H * b, 0.12 * H), hips, dark, 0.15), "Hips_jnt")
    add(prim_cyl("m_abdomen", 0.09 * H * b, 0.11 * H * b, (chest - hips).length * 0.8, (hips + chest) / 2, dark, verts=10), "Spine_jnt")
    add(prim_box("m_chest", (0.44 * H * b, 0.27 * H * b, 0.25 * H), chest + Vector((0, 0, 0.04 * H)), paint, 0.12), "Chest_jnt")
    add(prim_box("m_vent", (0.2 * H * b, 0.02 * H, 0.08 * H), chest + Vector((0, -0.14 * H * b, 0.05 * H)), dark, 0.1), "Chest_jnt")
    add(prim_sphere("m_core", 0.035 * H, chest + Vector((0.12 * H * b, -0.14 * H * b, 0.1 * H)), eye), "Chest_jnt")
    add(prim_box("m_pack", (0.3 * H * b, 0.12 * H, 0.22 * H), chest + Vector((0, 0.18 * H * b, 0.03 * H)), dark, 0.12), "Chest_jnt")
    add(prim_cyl("m_exhaust", 0.025 * H, 0.03 * H, 0.18 * H, chest + Vector((0.09 * H * b, 0.2 * H * b, 0.2 * H)), trim, verts=8), "Chest_jnt")
    head_c = neck + Vector((0, 0, 0.12 * H))
    add(prim_box("m_head", (0.2 * H, 0.2 * H, 0.17 * H), head_c, paint, 0.15), "Neck_jnt")
    add(prim_box("m_visor", (0.16 * H, 0.03 * H, 0.05 * H), head_c + Vector((0, -0.1 * H, 0.01 * H)), dark, 0.1), "Neck_jnt")
    add(prim_sphere("m_eye", 0.035 * H, head_c + Vector((0, -0.115 * H, 0.012 * H)), eye), "Neck_jnt")
    add(prim_cyl("m_antenna", 0.006 * H, 0.006 * H, 0.14 * H, head_c + Vector((0.07 * H, 0.04 * H, 0.15 * H)), trim, verts=6), "Neck_jnt")
    for side in ("Left", "Right"):
        sh = rest_head(arm, f"Arm_{side}_jnt")
        add(prim_box(f"m_pauldron_{side}", (0.15 * H * b, 0.17 * H * b, 0.09 * H * b), sh + Vector((0, 0, 0.05 * H)), paint, 0.2), f"Arm_{side}_jnt")
        limb(f"Arm_{side}_jnt", 0.085 * H * b, "dark")
        limb(f"Forearm_{side}_jnt", 0.11 * H * b, "paint", 1.05)
        limb(f"UpperLeg_{side}_jnt", 0.12 * H * b, "paint")
        limb(f"LowerLeg_{side}_jnt", 0.13 * H * b, "dark")
        ft = rest_head(arm, f"Foot_{side}_jnt")
        add(prim_box(f"m_foot_{side}", (0.13 * H * b, 0.22 * H * b, 0.06 * H), ft + FWD * 0.05 * H + Vector((0, 0, -0.02 * H)), dark, 0.15), f"Foot_{side}_jnt")
    hand = hand_pos(arm)
    if pc in ("pawn", "queen"):
        for dx in (-0.04, 0.04):
            add(prim_box(f"claw{dx}", (0.035 * H, 0.16 * H, 0.04 * H), hand + Vector((dx * H, 0, 0)) + FWD * 0.08 * H, trim, 0.2), "Forearm_Right_jnt")
    elif pc == "rook":
        add(prim_box("ram", (0.2 * H, 0.2 * H, 0.2 * H), hand + FWD * 0.06 * H, dark, 0.15), "Forearm_Right_jnt")
    else:
        add(prim_cyl("saw", 0.1 * H, 0.1 * H, 0.015 * H, hand + FWD * 0.1 * H, trim, rot=(0, math.pi / 2, 0), verts=16), "Forearm_Right_jnt")
    gold = material("MAT_mach_crown", hexc("#8a8f96"), metal=0.9, rough=0.3, emissive=hexc("#ff5a1f"), strength=0.3)
    s = H / 3.0
    for p in signature(pc, (head_c.x, head_c.y, head_c.z + 0.07 * H), 1.6 * s, gold, eye):
        add(p, "Neck_jnt")
    if pc == "rook":
        for p in rook_battlement((chest.x, chest.y, chest.z + 0.17 * H), 0.3 * H * b, 0.1 * H, gold):
            add(p, "Chest_jnt")
    main = merge_into(parts[0], parts[1:])
    main.name = f"{name}_body"
    arm.data.pose_position = "POSE"
    normalise_height(arm, [main], HEIGHT[pc] * (1.05 if pc == "rook" else 1.0))
    return arm, [main]

# -------------------------------------------------------------------------- export + preview
FLIP_FACING = False  # Synty rigs, Quaternius horses and robots all face Blender -Y == glTF +Z (the game convention)

def export_piece(root, objs, path):
    if FLIP_FACING and not root.name.endswith("_knight"):
        root.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ root.matrix_world
        bpy.context.view_layer.update()
    deselect()
    root.select_set(True)
    for o in objs:
        if o: o.select_set(True)
    bpy.context.view_layer.objects.active = root
    os.makedirs(os.path.dirname(path), exist_ok=True)
    has_actions = root.animation_data is not None or root.name.endswith("_knight")
    if root.name.endswith("_knight"):
        # Horse clips travel with the knight.
        root.animation_data_create()
        for a in bpy.data.actions:
            if a.name in ("Attack_Headbutt", "Attack_Kick", "Death", "Gallop", "Gallop_Jump", "Idle", "Idle_HitReact1", "Idle_HitReact2", "Walk"):
                tr = root.animation_data.nla_tracks.new(); tr.name = a.name
                tr.strips.new(a.name, 0, a)
        export_glb(path, animations=True, nla=True)
    else:
        export_glb(path, animations=False)
    log("exported", path, f"{os.path.getsize(path) / 1024:.0f} KB")

def preview(layout, path):
    """Workbench contact sheet of every exported piece."""
    scene = bpy.context.scene
    for o in bpy.data.objects: o.hide_render = True
    for name in layout:
        root = bpy.data.objects[name]
        root.hide_render = False
        for c in root.children_recursive:
            c.hide_render = False
            c.hide_set(False)
    for name, (x, y) in layout.items():
        o = bpy.data.objects[name]
        o.location.x += x
        o.location.y += y
    cam_data = bpy.data.cameras.new("qa_cam"); cam = bpy.data.objects.new("qa_cam", cam_data); link(cam)
    cam_data.type = "ORTHO"; cam_data.ortho_scale = 8.4
    cam.location = (3.0, -9, 4.2); cam.rotation_euler = (math.radians(72), 0, 0)
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = 1800, 1200
    scene.render.filepath = path
    world = bpy.data.worlds.new("qa"); scene.world = world
    world.color = (0.08, 0.07, 0.06)
    bpy.ops.render.render(write_still=True)
    for name, (x, y) in layout.items():
        o = bpy.data.objects[name]
        o.location.x -= x
        o.location.y -= y
    log("preview", path)

# -------------------------------------------------------------------------- main
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    rig, meshes = setup_synty()
    sources = import_clip_actions()
    clip_names = build_anim_library(rig, sources)
    if "--anims-only" in ARGS:
        log("anims-only build done")
        return
    manifest = {"version": 2, "factions": {}, "animations": {"humanoid": "anims/synty_humanoid.glb", "clips": clip_names}}
    layout = {}
    order = ["pawn", "knight", "bishop", "rook", "queen", "king"]
    for fi, faction in enumerate(["remnants", "machines", "wastelanders", "vault"]):
        fstyle = PIECES.get(faction, {"recolor": "none", "gold": "#8a8f96", "glow": "#ff5a1f", "rider": {"mesh": "SA_Char_Survivor_Hazard", "weapon": ("SA_Wep_Crowbar.fbx", 0.5, "melee")}})
        entry = {"pieces": {}}
        for pi, pc in enumerate(order):
            try:
                if pc == "knight":
                    root, objs = build_knight(rig, meshes, faction, fstyle, robot=(faction == "machines"))
                    clips = {"IDLE": "Idle", "MOVE": "Walk", "RUN": "Gallop", "ATTACK_READY": "Idle_HitReact2", "ATTACK_PRIMARY": "Attack_Headbutt", "ATTACK_HEAVY": "Attack_Kick",
                             "ATTACK_STAB": "Attack_Headbutt", "HIT_LIGHT": "Idle_HitReact1", "HIT_HEAVY": "Idle_HitReact2", "DEATH_LIGHT": "Death", "DEATH_HEAVY": "Death", "JUMP": "Gallop_Jump"}
                    entry["pieces"][pc] = {"file": f"factions/{faction}/{pc}.glb", "node": root.name, "animations": "self", "clips": clips, "mechanical": faction == "machines"}
                elif faction == "machines":
                    root, objs = build_machine(rig, faction, pc, fstyle)
                    entry["pieces"][pc] = {"file": f"factions/{faction}/{pc}.glb", "node": root.name, "animations": "humanoid", "mechanical": True}
                else:
                    root, objs = build_humanoid(rig, meshes, faction, pc, fstyle[pc], fstyle)
                    entry["pieces"][pc] = {"file": f"factions/{faction}/{pc}.glb", "node": root.name, "animations": "humanoid"}
                export_piece(root, objs, os.path.join(OUT, "factions", faction, f"{pc}.glb"))
                layout[root.name] = (pi * 1.2 - 3.0, fi * 1.6)
            except Exception as e:
                import traceback; traceback.print_exc()
                log("FAILED", faction, pc, e)
        manifest["factions"][faction] = entry
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    log("manifest written")
    preview(layout, os.path.join(QA, "factions_preview.png"))

if __name__ == "__main__" and not os.environ.get("ASHEN_LIB"):
    main()
