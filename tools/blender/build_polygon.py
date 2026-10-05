"""
Ashen Gambit — POLYGON faction builder (Blender 5.x, headless).

Replaces the cartoon "Simple" armies with Synty POLYGON characters (low-poly
but realistically proportioned) from the user's licensed packs, on one shared
skeleton:

  * every character from Sci-Fi City / Generic / Western / Spy is re-skinned onto
    one canonical POLYGON rig (the packs' skeletons are identical), so a single
    retargeted animation library drives all of them;
  * weapons sit in the Hand_R bone, fitted in the idle pose so they read as held
    in the fist, then rigidly skinned (follow every animation);
  * knights and Derby jockeys ride the CC0 Quaternius horse with realistic coats,
    a Western saddle and a "silks" saddle-cloth the client recolours per runner.

Reuses the utilities of build_factions.py. Writes the same manifest format, so
the client needs no changes beyond the new anim library path.

Usage:
  blender -b --factory-startup -P tools/blender/build_polygon.py -- <repo_root>
"""
import os, sys, json, math
os.environ["ASHEN_LIB"] = "1"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from mathutils import Vector, Matrix
import build_factions as bf
from build_factions import (log, deselect, import_fbx, import_gltf, world_bbox, material, hexc, link, parent_to_bone, merge_into,
                            prim_box, signature, rook_battlement, export_glb, normalise_height, head_top, preview, HEIGHT, CLIPS, CLIP_RENAME, OUT, QA, HORSE)

PB = os.path.join(bf.CACHE, "unity", "polygon", "Synty")
CHAR_FBX = {
    "scifi": os.path.join(PB, "PolygonSciFiCity", "Models", "Characters.fbx"),
    "generic": os.path.join(PB, "PolygonGeneric", "Models", "Generic_Characters.fbx"),
    "western": os.path.join(PB, "PolygonWestern", "Models", "Characters.fbx"),
    "spy": os.path.join(PB, "PolygonSpy", "Models", "Characters.fbx"),
}
ATLAS = {
    "scifi": os.path.join(PB, "PolygonSciFiCity", "Textures", "Alts", "PolygonScifi_01_A.png"),
    "generic": os.path.join(PB, "PolygonGeneric", "Textures", "Alts", "Generic_01_A.png"),
    "western": os.path.join(PB, "PolygonWestern", "Textures", "Alts", "PolygonWestern_01_A.png"),
    "spy": os.path.join(PB, "PolygonSpy", "Textures", "PolygonSpy_01_A.png"),
    "pirates": os.path.join(PB, "PolygonPirates", "Textures", "PolygonPirates_01_A.png"),
}
WEP = {
    "scifi": os.path.join(PB, "PolygonSciFiCity", "Models"), "western": os.path.join(PB, "PolygonWestern", "Models"),
    "generic": os.path.join(PB, "PolygonGeneric", "Models"), "spy": os.path.join(PB, "PolygonSpy", "Models"), "pirates": os.path.join(PB, "PolygonPirates", "Models"),
}

# (pack, mesh) characters, (pack, file, kind) weapons. kind: gun | melee.
ROSTER = {
    "remnants": {
        "gold": "#c8a046", "glow": "#e8b84a", "coat": ("bay", "chestnut"), "silks": "#c8a050",
        "pawn":   (("generic", "SM_Gen_Chr_Street_Male_02"), ("scifi", "SM_Wep_Rifle_Small_01", "gun")),
        "bishop": (("scifi", "Character_Medical_Male_01"), ("spy", "SM_Wep_Pistol_01", "gun")),
        "rook":   (("scifi", "Character_Cop_01"), ("western", "SM_Wep_Shotgun_01", "gun")),
        "queen":  (("spy", "Chr_Female_Spy"), ("scifi", "SM_Wep_SMG_01", "gun")),
        "king":   (("western", "Character_Sheriff_01"), ("scifi", "SM_Wep_Sniper_01", "gun")),
        "rider":  (("generic", "SM_Gen_Chr_Street_Female_01"), ("western", "SM_Wep_Revolver_01", "gun")),
        "jockey": (("western", "Character_Woman_01"), ("western", "SM_Wep_Shotgun_02", "gun")),
    },
    "machines": {
        "gold": "#a8b0b8", "glow": "#ff5a1f", "coat": ("grey", "black"), "silks": "#e0702a", "barding": True,
        "pawn":   (("scifi", "Character_Robot_01"), ("scifi", "SM_Wep_Knife_01", "melee")),
        "bishop": (("scifi", "Character_Hologram_Female_01"), ("scifi", "SM_Wep_Rifle_Laser_01", "gun")),
        "rook":   (("scifi", "Character_Augmented_Male_01"), ("scifi", "SM_Wep_Shotgun_Plasma_01", "gun")),
        "queen":  (("scifi", "Character_Cyber_Female_01"), ("scifi", "SM_Wep_Rifle_Plasma_01", "gun")),
        "king":   (("scifi", "Character_CyborgNinja_01"), ("scifi", "SM_Wep_Sword_01", "melee")),
        "rider":  (("scifi", "Character_Android_Female_01"), ("scifi", "SM_Wep_Sword_01", "melee")),
        "jockey": (("scifi", "Character_Cyber_Male_01"), ("scifi", "SM_Wep_MachinePistol_Gen2_01", "gun")),
    },
    "wastelanders": {
        "gold": "#9a6a3a", "glow": "#ffb02e", "coat": ("black", "dun"), "silks": "#d06a2a",
        "pawn":   (("scifi", "Character_Junky_Male_01"), ("generic", "SM_Gen_Wep_Pickaxe_01", "melee")),
        "bishop": (("generic", "SM_Gen_Chr_Charred_01"), ("pirates", "SM_Wep_Cutlass_01", "melee")),
        "rook":   (("scifi", "Character_Garbage_Male_01"), ("western", "SM_Wep_Shotgun_02", "gun")),
        "queen":  (("western", "Character_Cowgirl_01"), ("western", "SM_Wep_Rifle_01", "gun")),
        "king":   (("western", "Character_Badguy_01"), ("generic", "SM_Gen_Wep_Axe_01", "melee")),
        "rider":  (("western", "Character_Cowboy_01"), ("western", "SM_Wep_Revolver_02", "gun")),
        "jockey": (("western", "Character_Gunman_01"), ("western", "SM_Wep_Rifle_01", "gun")),
    },
    "vault": {
        "gold": "#d8dde2", "glow": "#39d0ff", "coat": ("palomino", "grey"), "silks": "#3ad0e0",
        "pawn":   (("generic", "SM_Gen_Chr_Jumpsuit_Male_01"), ("scifi", "SM_Wep_Pistol_01", "gun")),
        "bishop": (("scifi", "Character_Hacker_Female_01"), ("scifi", "SM_Wep_Syringe_Gun_01", "gun")),
        "rook":   (("generic", "SM_Gen_Chr_Space_Male_01"), ("scifi", "SM_Wep_Rifle_Base_01", "gun")),
        "queen":  (("generic", "SM_Gen_Chr_Business_Female_01"), ("scifi", "SM_Wep_Revolver_01", "gun")),
        "king":   (("generic", "SM_Gen_Chr_Business_Male_01"), ("spy", "SM_Wep_SMG_01", "gun")),
        "rider":  (("generic", "SM_Gen_Chr_Jumpsuit_Female_01"), ("scifi", "SM_Wep_MachinePistol_Gen2_01", "gun")),
        "jockey": (("generic", "SM_Gen_Chr_Jumpsuit_Male_01"), ("scifi", "SM_Wep_Rifle_Small_01", "gun")),
    },
}
BULK = {"rook": 1.12}

# Extra Derby runners, five per faction: (character, weapon, coat). Exported as factions/<f>/jockey_j1..j5.glb and
# referenced by `look` in packages/shared/src/derby/data.ts.
DERBY_JOCKEYS = {
    "remnants": [
        (("generic", "SM_Gen_Chr_Street_Male_01"), ("generic", "SM_Gen_Wep_Pickaxe_01", "melee"), "sorrel"),
        (("generic", "SM_Gen_Chr_Street_Female_02"), ("western", "SM_Wep_Rifle_01", "gun"), "black"),
        (("generic", "SM_Gen_Chr_Peasent_Male_01"), ("generic", "SM_Gen_Wep_Axe_01", "melee"), "dun"),
        (("western", "Character_Business_Man_01"), ("western", "SM_Wep_Shotgun_01", "gun"), "buckskin"),
        (("generic", "SM_Gen_Chr_Prisoner_Female_01"), ("scifi", "SM_Wep_Knife_01", "melee"), "roan"),
    ],
    "machines": [
        (("generic", "SM_Gen_Chr_Robot_01"), ("scifi", "SM_Wep_Sword_01", "melee"), "grey"),
        (("scifi", "Character_Robot_01"), ("scifi", "SM_Wep_Knife_01", "melee"), "liver"),
        (("scifi", "Character_CyberPunk_Male_01"), ("scifi", "SM_Wep_MachinePistol_Gen2_01", "gun"), "black"),
        (("scifi", "Character_Alien_Male_02"), ("scifi", "SM_Wep_Rifle_Laser_01", "gun"), "white"),
        (("scifi", "Character_Cyber_Female_01"), ("scifi", "SM_Wep_Shotgun_Plasma_01", "gun"), "roan"),
    ],
    "wastelanders": [
        (("scifi", "Character_Junky_Female_01"), ("pirates", "SM_Wep_Cutlass_01", "melee"), "chestnut"),
        (("scifi", "Character_Muscle_Male_01"), ("generic", "SM_Gen_Wep_Axe_01", "melee"), "liver"),
        (("generic", "SM_Gen_Chr_Skeleton_01"), ("western", "SM_Wep_Rifle_01", "gun"), "white"),
        (("generic", "SM_Gen_Chr_Peasent_Female_01"), ("western", "SM_Wep_Revolver_02", "gun"), "buckskin"),
        (("generic", "SM_Gen_Chr_Prisoner_Male_01"), ("generic", "SM_Gen_Wep_Pickaxe_01", "melee"), "bay"),
    ],
    "vault": [
        (("generic", "SM_Gen_Chr_Street_Female_03"), ("scifi", "SM_Wep_Revolver_01", "gun"), "white"),
        (("scifi", "Character_Rich_Female_01"), ("spy", "SM_Wep_SMG_01", "gun"), "chestnut"),
        (("scifi", "Character_Monk_Male_01"), ("scifi", "SM_Wep_Syringe_Gun_01", "gun"), "palomino"),
        (("spy", "Chr_Male_Spy_Bowtie"), ("scifi", "SM_Wep_Sniper_01", "gun"), "black"),
        (("generic", "SM_Gen_Chr_Street_Male_03"), ("spy", "SM_Wep_Pistol_01", "gun"), "sorrel"),
    ],
}

# Coats: (Main, Main_Dark, Main_Light, Hair, Muzzle, Hooves)
COATS = {
    "bay":      ("#4a2a16", "#2c180b", "#62381e", "#120e0c", "#1c120c", "#2a2420"),
    "chestnut": ("#7a3a18", "#4e230e", "#934a22", "#5a2810", "#2a160c", "#3a2c22"),
    "black":    ("#171311", "#0d0b0a", "#24201d", "#0a0909", "#121010", "#1e1a18"),
    "grey":     ("#8e8b86", "#615e5a", "#aeaaa4", "#d6d3cd", "#3a3836", "#2e2b28"),
    "palomino": ("#b98a4c", "#8c6534", "#d2a66a", "#ece0c2", "#4a3828", "#3a3028"),
    "dun":      ("#8b6b45", "#5d452c", "#a6855c", "#2a1d13", "#2a2016", "#2e2620"),
    "sorrel":   ("#9a4a1c", "#6c3212", "#b45e2a", "#b8642c", "#2e1a0e", "#3a2c22"),
    "buckskin": ("#c09a5a", "#8e6e3a", "#d6b678", "#141010", "#2a2018", "#221c18"),
    "roan":     ("#7a6a68", "#4e4240", "#9a8a88", "#1e1614", "#2a2220", "#2a2624"),
    "liver":    ("#4a2414", "#30160c", "#5e3020", "#3a1c10", "#1e120c", "#2a221e"),
    "white":    ("#d8d4cc", "#aaa69e", "#ece8e0", "#f0ece4", "#8a7a70", "#4a4440"),
}

# Canonical (Sci-Fi City) right-hand finger names; Generic uses _L/_R suffixes.
def canon_bone(name):
    if name == "Jaw": return "Head"
    for base in ("Thumb_0", "IndexFinger_0", "Finger_0"):
        if name.startswith(base) and name.endswith("_R"): return name[:-2] + ".001"
        if name.startswith(base) and name.endswith("_L"): return name[:-2]
    return name


# -------------------------------------------------------------------------- canonical rig + characters
def setup_polygon():
    rig, meshes = None, {}
    for pack, path in CHAR_FBX.items():
        objs = import_fbx(path)
        arm = next(o for o in objs if o.type == "ARMATURE")
        if rig is None:
            rig = arm; rig.name = "POLY_RIG"
        for o in objs:
            if o.type != "MESH": continue
            o.hide_set(True); o.hide_render = True
            o["pack"] = pack
            key = f"{pack}:{o.name.split('.')[0]}"
            meshes[key] = o
            if arm is not rig:
                for vg in o.vertex_groups:
                    c = canon_bone(vg.name)
                    if c != vg.name:
                        if o.vertex_groups.get(c): merge_vgroup(o, vg.name, c)
                        else: vg.name = c
                mpi = o.matrix_parent_inverse.copy()
                o.parent = rig
                o.matrix_parent_inverse = mpi
                for mod in o.modifiers:
                    if mod.type == "ARMATURE": mod.object = rig
        for o in objs:
            if o is not arm and o.type not in ("MESH", "ARMATURE"): bpy.data.objects.remove(o)
        if arm is not rig:
            bpy.data.objects.remove(arm)
    log("polygon characters:", len(meshes))
    return rig, meshes

def merge_vgroup(o, src, dst):
    s, d = o.vertex_groups[src], o.vertex_groups[dst]
    for v in o.data.vertices:
        for g in v.groups:
            if g.group == s.index: d.add([v.index], g.weight, "ADD")
    o.vertex_groups.remove(s)

_mats = {}
def atlas_material(pack):
    if pack in _mats: return _mats[pack]
    img = bpy.data.images.load(ATLAS[pack], check_existing=True)
    m = material(f"MAT_poly_{pack}", (1, 1, 1), metal=0.05, rough=0.8, image=img)
    _mats[pack] = m
    return m

def make_character(rig, meshes, key, name):
    arm = rig.copy(); arm.data = rig.data.copy(); link(arm)
    arm.name = name
    arm.animation_data_clear()
    src = meshes[key]
    me = src.copy(); me.data = src.data.copy(); link(me)
    me.name = f"{name}_body"
    me.hide_set(False); me.hide_render = False
    me.parent = arm
    me.matrix_parent_inverse = src.matrix_parent_inverse.copy()
    for mod in me.modifiers:
        if mod.type == "ARMATURE": mod.object = arm
    me.data.materials.clear()
    me.data.materials.append(atlas_material(src["pack"]))
    return arm, me


# -------------------------------------------------------------------------- animation library (SimplePeople clips -> POLYGON rig)
def poly_bone_map(src_arm):
    """POLYGON target bone -> SimplePeople source bone. Spine segments are found from the source hierarchy."""
    b = src_arm.data.bones
    lower = next(c.name for c in b["Hips_jnt"].children if c.name in ("Body_jnt", "Spine_jnt"))
    upper = "Spine_jnt" if lower == "Body_jnt" else "Body_jnt"
    m = {"Hips": "Hips_jnt", "Spine_01": lower, "Spine_03": upper, "Head": "Head_jnt"}
    for side, s in (("L", "Left"), ("R", "Right")):
        m.update({f"Shoulder_{side}": f"UpperArm_{s}_jnt", f"Elbow_{side}": f"LowerArm_{s}_jnt", f"Hand_{side}": f"Hand_{s}_jnt",
                  f"UpperLeg_{side}": f"UpperLeg_{s}_jnt", f"LowerLeg_{side}": f"LowerLeg_{s}_jnt", f"Ankle_{side}": f"Foot_{s}_jnt"})
    return m

def bake_clip(target, source, action, f0, f1, name, bone_map, translate=("Hips",)):
    """
    Rest-offset-preserving retarget (see build_factions.bake_clip), plus hip
    translation for rigs whose Hips sit under a Root bone: the source hip's
    world displacement is scaled by the hip-height ratio and applied in the
    target's armature space, so falls and jumps keep their vertical motion.
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
    tw, sw = target.matrix_world.copy(), source.matrix_world.copy()
    tw_inv = tw.inverted()
    order = sorted(target.data.bones, key=lambda bn: len(bn.parent_recursive))
    offsets, src_of = {}, {}
    for bn in order:
        sb = source.data.bones.get(bone_map.get(bn.name, ""))
        if not sb: continue
        src_of[bn.name] = sb.name
        offsets[bn.name] = (sw @ sb.matrix_local).to_3x3().normalized().inverted() @ (tw @ bn.matrix_local).to_3x3().normalized()
    s_hip_rest = (sw @ source.data.bones["Hips_jnt"].matrix_local).translation
    t_hip_rest = (tw @ target.data.bones["Hips"].matrix_local).translation
    k = t_hip_rest.z / max(1e-6, s_hip_rest.z)
    for pb in target.pose.bones: pb.rotation_mode = "QUATERNION"
    for f in range(int(f0), int(f1) + 1):
        scene.frame_set(f)
        arm_mats = {}
        for bone in order:
            pb = target.pose.bones[bone.name]
            rest = bone.matrix_local
            base = arm_mats[bone.parent.name] @ (bone.parent.matrix_local.inverted() @ rest) if bone.parent else rest.copy()
            if bone.name in offsets:
                s_world = sw @ source.pose.bones[src_of[bone.name]].matrix
                r_arm = (tw_inv.to_3x3().normalized() @ (s_world.to_3x3().normalized() @ offsets[bone.name])).normalized()
                if bone.name in translate:
                    delta = (s_world.translation - s_hip_rest) * k
                    loc_arm = (tw_inv @ (t_hip_rest + delta))
                else:
                    loc_arm = base.translation
                desired = Matrix.Translation(loc_arm) @ r_arm.to_4x4()
            else:
                desired = base
            pb.matrix_basis = (base.inverted() @ desired) if bone.parent else (rest.inverted() @ desired)
            arm_mats[bone.name] = desired
            pb.keyframe_insert("rotation_quaternion", frame=f - int(f0))
            if not bone.parent or bone.name in translate:
                pb.keyframe_insert("location", frame=f - int(f0))
    target.animation_data.action = None
    for pb in target.pose.bones: pb.matrix_basis = Matrix.Identity(4)
    return baked

def build_anim_library(rig):
    sources = bf.import_clip_actions()
    bone_map = poly_bone_map(next(iter(sources.values()))[0])
    log("bone map", bone_map)
    arm = rig.copy(); arm.data = rig.data.copy(); link(arm)
    arm.name = "PolygonAnimRig"
    arm.hide_set(False)
    bpy.context.view_layer.update()
    baked = []
    for group, clips in CLIPS.items():
        src_arm, act = sources[group]
        for clip, (a, b) in clips.items():
            name = CLIP_RENAME.get(clip, clip)
            if any(n == name for n, _, _ in baked): continue
            baked.append((name, bake_clip(arm, src_arm, act, a, b, f"CLIP_{name}", bone_map), (a, b)))
    arm.animation_data_create()
    for name, action, (a, b) in baked:
        tr = arm.animation_data.nla_tracks.new(); tr.name = name
        st = tr.strips.new(name, 0, action)
        st.frame_start = 0
    for src_arm, _ in sources.values(): src_arm.animation_data.action = None
    deselect(); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    path = os.path.join(OUT, "anims", "polygon_humanoid.glb")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    export_glb(path, animations=True, nla=True)
    log("anim library", len(baked), "clips ->", path)
    idle = next(act for n, act, _ in baked if n == "Idle")
    bpy.data.objects.remove(arm)
    for src_arm, _ in sources.values(): bpy.data.objects.remove(src_arm)
    return [n for n, _, _ in baked], idle


# -------------------------------------------------------------------------- weapons
def load_weapon(pack, fname):
    """POLYGON weapons: pivot at the grip; guns point -Y with the top +Z; blades point +Z."""
    objs = import_fbx(os.path.join(WEP[pack], fname + ".fbx"))
    ms = [o for o in objs if o.type == "MESH"]
    for o in objs:
        if o.type != "MESH": bpy.data.objects.remove(o)
    w = ms[0] if len(ms) == 1 else bf.join(ms, fname)
    w.parent = None
    deselect(); w.select_set(True); bpy.context.view_layer.objects.active = w
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ext = max(w.dimensions)
    if ext < 0.05: w.data.transform(Matrix.Scale(100.0, 4))  # a few packs author weapons in centimetres
    w.data.materials.clear()
    w.data.materials.append(atlas_material(pack))
    w.name = f"wep_{fname}"
    return w

def look_basis(fwd, up):
    """Matrix whose -Y column is `fwd` and +Z is (orthogonalised) `up` — the weapon's local frame."""
    f = fwd.normalized()
    x = f.cross(up).normalized()          # right
    z = x.cross(f).normalized()           # up
    y = -f
    return Matrix(((x.x, y.x, z.x, 0), (x.y, y.y, z.y, 0), (x.z, y.z, z.z, 0), (0, 0, 0, 1)))

def palm_world(arm, pose=True):
    """Centre of the right palm (pose or rest), from the hand and middle-finger bones."""
    get = (lambda b: arm.matrix_world @ arm.pose.bones[b].head) if pose else (lambda b: arm.matrix_world @ arm.data.bones[b].head_local)
    hand, mid, thumb = get("Hand_R"), get("Finger_01.001"), get("Thumb_01.001")
    palm = hand + (mid - hand) * 0.55
    return palm, (mid - hand).normalized(), (thumb - hand).normalized()

def weapon_frame(kind, palm, fingers, thumb, raised=False):
    """Desired weapon world matrix in the reference pose."""
    if kind == "gun":
        fwd = Vector((0, -1, -0.15 if raised else -0.55))
        up = Vector((0, -0.3, 1))
    else:
        fwd = Vector((0, -0.8, 0.55 if not raised else 0.9))
        up = Vector((0, 1, 0.4))
    m = look_basis(fwd, up)
    if kind != "gun":
        # Blades are authored pointing +Z: rotate so the blade follows `fwd`.
        m = m @ Matrix.Rotation(math.radians(-90), 4, "X")
    return Matrix.Translation(palm) @ m

def attach_weapon(arm, w, kind, idle_action):
    """Fit in the idle pose, convert back to the rest pose, rigidly skin to Hand_R."""
    arm.animation_data_create()
    arm.animation_data.action = idle_action
    if hasattr(arm.animation_data, "action_slot") and idle_action.slots:
        arm.animation_data.action_slot = idle_action.slots[0]
    arm.data.pose_position = "POSE"
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    palm, fingers, thumb = palm_world(arm, pose=True)
    W_idle = weapon_frame(kind, palm, fingers, thumb)
    P = arm.matrix_world @ arm.pose.bones["Hand_R"].matrix
    R = arm.matrix_world @ arm.data.bones["Hand_R"].matrix_local
    W_rest = R @ P.inverted() @ W_idle
    w.data.transform(W_rest)
    arm.animation_data.action = None
    for pb in arm.pose.bones: pb.matrix_basis = Matrix.Identity(4)
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    parent_to_bone(w, arm, "Hand_R")
    return w


# -------------------------------------------------------------------------- pieces
def build_piece(rig, meshes, faction, pc, idle):
    cfg = ROSTER[faction]
    (cpack, cmesh), (wpack, wfile, kind) = cfg[pc]
    name = f"{faction}_{pc}"
    arm, me = make_character(rig, meshes, f"{cpack}:{cmesh}", name)
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    top, h = head_top(me)
    s = h / 1.8
    gold = material(f"MAT_gold_{faction}", hexc(cfg["gold"]), metal=0.85, rough=0.35, emissive=hexc(cfg["glow"]), strength=0.4)
    glow = material(f"MAT_glow_{faction}", hexc(cfg["glow"]), emissive=hexc(cfg["glow"]), strength=6.0)
    parts = []
    for p in signature(pc, (top.x, top.y, top.z - 0.05 * s), 0.9 * s, gold, glow):
        parent_to_bone(p, arm, "Head"); parts.append(p)
    if pc == "rook":
        chest = arm.matrix_world @ arm.data.bones["Spine_03"].head_local
        for p in rook_battlement((chest.x, chest.y, chest.z + 0.16 * s), 0.3 * s, 0.12 * s, gold):
            parent_to_bone(p, arm, "Spine_03"); parts.append(p)
    try:
        w = load_weapon(wpack, wfile)
        attach_weapon(arm, w, kind, idle)
        parts.append(w)
    except Exception as e:
        import traceback; traceback.print_exc()
        log("weapon failed", wfile, e)
    me = merge_parts(me, parts)
    arm.data.pose_position = "POSE"
    normalise_height(arm, [me], HEIGHT[pc] * BULK.get(pc, 1.0) ** 0.25)
    return arm, [me]


# -------------------------------------------------------------------------- horses + riders
def set_coat(hmesh, coat):
    names = ("Main", "Main_Dark", "Main_Light", "Hair", "Muzzle", "Hooves")
    cols = dict(zip(names, COATS[coat]))
    for slot in hmesh.material_slots:
        base = slot.material.name.split(".")[0]
        m = slot.material.copy(); slot.material = m
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf and base in cols and not bsdf.inputs["Base Color"].is_linked:
            c = hexc(cols[base])
            bsdf.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1)
            bsdf.inputs["Roughness"].default_value = 0.55 if base == "Hair" else 0.7

def rotate_world(arm, bone, axis, deg):
    """Rotate a pose bone about a world axis through its head (bone-axis independent)."""
    pb = arm.pose.bones[bone]
    head = pb.head.copy()
    ax = (arm.matrix_world.inverted().to_3x3() @ Vector(axis)).normalized()
    R = Matrix.Translation(head) @ Matrix.Rotation(math.radians(deg), 4, ax) @ Matrix.Translation(-head)
    pb.matrix = R @ pb.matrix
    bpy.context.view_layer.update()

def seat_rider(arm):
    """Riding pose: thighs forward and apart, shins down, forearms forward to the reins."""
    for side, sgn in (("L", 1), ("R", -1)):
        rotate_world(arm, f"UpperLeg_{side}", (1, 0, 0), -80)
        rotate_world(arm, f"UpperLeg_{side}", (0, 0, 1), 24 * sgn)
        rotate_world(arm, f"LowerLeg_{side}", (1, 0, 0), 78)
        rotate_world(arm, f"Shoulder_{side}", (0, 1, 0), 68 * sgn)
        rotate_world(arm, f"Elbow_{side}", (1, 0, 0), -65)
    rotate_world(arm, "Spine_01", (1, 0, 0), -8)

def barding(harm):
    """Steel plates over the horse's head, neck and body for the Machines."""
    steel = material("MAT_barding", hexc("#5c636b"), metal=0.85, rough=0.35)
    trim = material("MAT_barding_trim", hexc("#ff5a1f"), emissive=hexc("#ff5a1f"), strength=4.0)
    parts = []
    for b in harm.data.bones:
        n = b.name.lower()
        if not any(k in n for k in ("torso", "neck", "head")) or "ear" in n: continue
        h, t = bf.rest_head(harm, b.name), bf.rest_tail(harm, b.name)
        L = (t - h).length
        if L < 1e-4: continue
        d = (t - h).normalized()
        rot = Vector((0, 0, 1)).rotation_difference(d).to_euler()
        th = L * (0.75 if "torso" in n else 0.6)
        o = prim_box(f"bd_{b.name}", (th * 1.05, th * 0.35, L * 0.9), (h + t) / 2 + Vector((0, 0, th * 0.35)), steel, 0.2, rot=rot)
        parent_to_bone(o, harm, b.name); parts.append(o)
        if n.startswith("head"):
            e = prim_box(f"bd_visor_{b.name}", (th * 0.9, th * 0.08, th * 0.15), (h + t) / 2 + Vector((0, -th * 0.1, th * 0.5)), trim, 0.1, rot=rot)
            parent_to_bone(e, harm, b.name); parts.append(e)
    return parts

def build_mount(rig, meshes, faction, who, coat, name, spec=None):
    """`spec` = ((pack, mesh), (pack, weapon, kind)) overrides the faction roster's `who` entry."""
    cfg = ROSTER[faction]
    objs = import_gltf(HORSE)
    harm = next(o for o in objs if o.type == "ARMATURE")
    hmesh = next(o for o in objs if o.type == "MESH" and o.name.startswith("Horse"))
    for o in objs:
        if o not in (harm, hmesh) and o.type == "MESH": bpy.data.objects.remove(o)
    harm.name = name
    harm.data.pose_position = "REST"
    for a in list(bpy.data.actions):
        if a.name in bf.HORSE_CLIPS: a.use_fake_user = True
    set_coat(hmesh, coat)
    bpy.context.view_layer.update()
    hmn, hmx = world_bbox([hmesh])
    horse_h, horse_len = hmx.z - hmn.z, hmx.y - hmn.y
    seat_bone = "Back" if "Back" in harm.data.bones else ("Torso" if "Torso" in harm.data.bones else harm.data.bones[0].name)
    parts = []
    if cfg.get("barding"): parts += barding(harm)

    # ---- rider, posed and baked to a static mesh
    (cpack, cmesh), (wpack, wfile, kind) = spec or cfg[who]
    rarm, rme = make_character(rig, meshes, f"{cpack}:{cmesh}", f"{name}_rider_tmp")
    rarm.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    seat_rider(rarm)
    hips_w = rarm.matrix_world @ rarm.pose.bones["Hips"].head
    palm, fingers, thumb = palm_world(rarm, pose=True)
    deselect(); rme.select_set(True); bpy.context.view_layer.objects.active = rme
    for mod in list(rme.modifiers):
        if mod.type == "ARMATURE": bpy.ops.object.modifier_apply(modifier=mod.name)
    mw = rme.matrix_world.copy(); rme.parent = None; rme.matrix_world = mw
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    rme.vertex_groups.clear()
    bpy.data.objects.remove(rarm)
    weapon = None
    try:
        weapon = load_weapon(wpack, wfile)
        weapon.data.transform(weapon_frame(kind, palm, fingers, thumb, raised=True))
    except Exception as e:
        log("rider weapon failed", wfile, e)
    # Scale rider (and weapon) to the horse, seat by the hips.
    rmn, rmx = world_bbox([rme])
    k = (horse_h * 0.66) / max(1e-6, rmx.z - rmn.z)
    seat = Vector(((hmn.x + hmx.x) / 2, (hmn.y + hmx.y) / 2 + horse_len * 0.04, hmn.z + horse_h * 0.62))
    xf = Matrix.Translation(seat - hips_w * k) @ Matrix.Scale(k, 4)
    rme.data.transform(xf)
    rme.name = f"{name}_rider"
    parent_to_bone(rme, harm, seat_bone); parts.append(rme)
    if weapon:
        weapon.data.transform(xf)
        parent_to_bone(weapon, harm, seat_bone); parts.append(weapon)

    # ---- saddle + silks cloth (the client recolours MAT_silks per Derby runner)
    silks = material("MAT_silks", hexc(cfg["silks"]), metal=0.0, rough=0.8)
    cloth = prim_box("silks", (horse_len * 0.2, horse_len * 0.24, horse_h * 0.012), (seat.x, seat.y, seat.z - horse_h * 0.055), silks, 0.02)
    cloth.scale = (1, 1, 1)
    parent_to_bone(cloth, harm, seat_bone); parts.append(cloth)
    leather = material("MAT_saddle", hexc("#5a3a22"), metal=0.0, rough=0.65)
    seat_z = seat.z - horse_h * 0.035
    sad = prim_box("saddle", (horse_len * 0.15, horse_len * 0.2, horse_h * 0.04), (seat.x, seat.y, seat_z), leather, 0.35)
    parent_to_bone(sad, harm, seat_bone); parts.append(sad)
    pommel = prim_box("pommel", (horse_len * 0.05, horse_len * 0.04, horse_h * 0.06), (seat.x, seat.y - horse_len * 0.09, seat_z + horse_h * 0.03), leather, 0.4)
    parent_to_bone(pommel, harm, seat_bone); parts.append(pommel)
    cantle = prim_box("cantle", (horse_len * 0.12, horse_len * 0.03, horse_h * 0.05), (seat.x, seat.y + horse_len * 0.09, seat_z + horse_h * 0.025), leather, 0.4)
    parent_to_bone(cantle, harm, seat_bone); parts.append(cantle)
    main = merge_parts(hmesh, parts)
    harm.data.pose_position = "POSE"
    normalise_height(harm, [main], HEIGHT["knight"])
    return harm, [main]


def merge_parts(main, parts):
    """Join parts into `main`, first unifying UV-layer names so every part keeps its texture
    (glTF horses use "UVMap", POLYGON meshes "map1"; mismatched names would leave the
    joined parts sampling an empty layer)."""
    want = "map1"
    for m in [main] + [p for p in parts if p and p.type == "MESH"]:
        uvs = m.data.uv_layers
        if not uvs: uvs.new(name=want)          # e.g. the vertex-coloured horse
        while len(uvs) > 1: uvs.remove(uvs[-1])  # drop secondary channels (map11)
        uvs[0].name = want
    out = merge_into(main, parts)
    for uv in out.data.uv_layers: uv.active_render = uv.name == want
    return out


def export_piece(root, objs, path, horse=False):
    deselect()
    root.select_set(True)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = root
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if horse:
        root.animation_data_create()
        for a in bpy.data.actions:
            if a.name in ("Attack_Headbutt", "Attack_Kick", "Death", "Gallop", "Gallop_Jump", "Idle", "Idle_HitReact1", "Idle_HitReact2", "Walk"):
                tr = root.animation_data.nla_tracks.new(); tr.name = a.name
                tr.strips.new(a.name, 0, a)
        export_glb(path, animations=True, nla=True)
    else:
        export_glb(path, animations=False)
    log("exported", path, f"{os.path.getsize(path) / 1024:.0f} KB")


KNIGHT_CLIPS = {"IDLE": "Idle", "MOVE": "Walk", "RUN": "Gallop", "ATTACK_READY": "Idle_HitReact2", "ATTACK_PRIMARY": "Attack_Headbutt", "ATTACK_HEAVY": "Attack_Kick",
                "ATTACK_STAB": "Attack_Headbutt", "HIT_LIGHT": "Idle_HitReact1", "HIT_HEAVY": "Idle_HitReact2", "DEATH_LIGHT": "Death", "DEATH_HEAVY": "Death", "JUMP": "Gallop_Jump"}

def build_derby_jockeys(rig, meshes, faction, manifest, layout, fi):
    for ji, (char, wep, coat) in enumerate(DERBY_JOCKEYS.get(faction, []), start=1):
        key = f"j{ji}"
        try:
            root, objs = build_mount(rig, meshes, faction, "jockey", coat, f"{faction}_jockey_{key}", spec=(char, wep))
            export_piece(root, objs, os.path.join(OUT, "factions", faction, f"jockey_{key}.glb"), horse=True)
            manifest.setdefault("derby", {}).setdefault(faction, {})[key] = {"file": f"factions/{faction}/jockey_{key}.glb", "node": root.name, "clips": KNIGHT_CLIPS}
            layout[root.name] = ((6 + ji) * 1.2 - 3.0, fi * 1.6)
        except Exception as e:
            import traceback; traceback.print_exc()
            log("FAILED", faction, "jockey", key, e)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    rig, meshes = setup_polygon()
    clip_names, idle = build_anim_library(rig)
    manifest = {"version": 3, "style": "polygon", "factions": {}, "animations": {"humanoid": "anims/polygon_humanoid.glb", "clips": clip_names}, "derby": {}}
    layout = {}
    order = ["pawn", "knight", "bishop", "rook", "queen", "king"]
    only = [a for a in bf.ARGS[1:] if not a.startswith("--")]
    derby_only = "--derby" in bf.ARGS
    if derby_only:
        # Rebuild just the extra Derby runners and merge them into the existing manifest.
        manifest = json.load(open(os.path.join(OUT, "manifest.json")))
    for fi, faction in enumerate(ROSTER):
        if only and faction not in only: continue
        if derby_only:
            build_derby_jockeys(rig, meshes, faction, manifest, layout, fi)
            continue
        entry = {"pieces": {}}
        coat_a, coat_b = ROSTER[faction]["coat"]
        for pi, pc in enumerate(order):
            try:
                if pc == "knight":
                    root, objs = build_mount(rig, meshes, faction, "rider", coat_a, f"{faction}_knight")
                    export_piece(root, objs, os.path.join(OUT, "factions", faction, "knight.glb"), horse=True)
                    entry["pieces"][pc] = {"file": f"factions/{faction}/knight.glb", "node": root.name, "animations": "self", "clips": KNIGHT_CLIPS, "mechanical": False}
                else:
                    root, objs = build_piece(rig, meshes, faction, pc, idle)
                    export_piece(root, objs, os.path.join(OUT, "factions", faction, f"{pc}.glb"))
                    entry["pieces"][pc] = {"file": f"factions/{faction}/{pc}.glb", "node": root.name, "animations": "humanoid", "mechanical": faction == "machines"}
                layout[root.name] = (pi * 1.2 - 3.0, fi * 1.6)
            except Exception as e:
                import traceback; traceback.print_exc()
                log("FAILED", faction, pc, e)
        try:
            root, objs = build_mount(rig, meshes, faction, "jockey", coat_b, f"{faction}_jockey")
            export_piece(root, objs, os.path.join(OUT, "factions", faction, "jockey.glb"), horse=True)
            manifest["derby"].setdefault(faction, {})["b"] = {"file": f"factions/{faction}/jockey.glb", "node": root.name, "clips": KNIGHT_CLIPS}
            layout[root.name] = (6 * 1.2 - 3.0, fi * 1.6)
        except Exception as e:
            import traceback; traceback.print_exc()
            log("FAILED", faction, "jockey", e)
        build_derby_jockeys(rig, meshes, faction, manifest, layout, fi)
        manifest["factions"][faction] = entry
    if not only or derby_only:
        # Keep the environment entry written by build_environment.py.
        try:
            old = json.load(open(os.path.join(OUT, "manifest.json")))
            if "environment" in old: manifest["environment"] = old["environment"]
        except Exception: pass
        with open(os.path.join(OUT, "manifest.json"), "w") as f:
            json.dump(manifest, f, indent=2)
        log("manifest written")
    preview(layout, os.path.join(QA, "polygon_preview.png"))

if __name__ == "__main__":
    main()
