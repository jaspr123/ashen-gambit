"""
Ashen Gambit — arena set-dressing pack (Blender 4.4+/5.x, headless).

Imports a curated list of Synty Simple Apocalypse props from the extracted
Unity cache, normalises each to a ground-centred origin at game scale
(1 board square ~= 1 person), textures them with the shared atlas and exports
one environment.glb with one named root node per prop. Updates manifest.json.

Usage: blender -b --factory-startup -P tools/blender/build_environment.py -- <repo_root>
"""
import bpy, sys, os, json
from mathutils import Vector, Matrix

ROOT = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
SA = os.path.join(ROOT, ".asset-cache", "unity", "SimpleApocalypse", "Models")
ATLAS = os.path.join(ROOT, ".asset-cache", "unity", "SimpleApocalypse", "Textures", "SimpleApocalypse_Texture.png")
OUT = os.path.join(ROOT, "apps", "client", "public", "assets")

# category -> (folder, scale, names). 1 game unit ~ 1.8 m for props/vehicles; skyline is exaggerated.
CATALOG = {
    "building": ("Buildings", 60.0, [
        "SA_Bld_Building_Damaged_01", "SA_Bld_Building_Damaged_02", "SA_Bld_Building_Damaged_03", "SA_Bld_Apartment_Damaged_01",
        "SA_Bld_Office_Damaged_01", "SA_Bld_Office_Damaged_02", "SA_Bld_OfficeOld_01", "SA_Bld_OfficeOld_02", "SA_Bld_OfficeOld_03",
        "SA_Bld_Mall_Damaged_01", "SA_Bld_Church_Damaged_01", "SA_Bld_HospitalBuildingMain_Damaged_01", "SA_Bld_WarehouseOld_Damaged_01",
        "SA_Bld_WarehouseOld_Damaged_02", "SA_Bld_PoliceStation_Damaged_01", "SA_Bld_TownHall_Damaged_01", "SA_Bld_PetrolStation_Damaged_01",
        "SA_Bld_ShopOld_Damaged_01", "SA_Bld_CoolingTowerLarge_Damaged_01", "SA_Bld_WaterTower_01", "SA_Bld_PowerLineLarge_01",
    ]),
    "vehicle": ("Props", 55.0, [
        "SA_Prop_BurntBrown_Car_01", "SA_Prop_BurntBrown_Car_02", "SA_Prop_BurntBlack_Car_01", "SA_Prop_BurntBrown_FamilyCar_01",
        "SA_Prop_BurntBrown_FamilyCar_03", "SA_Prop_BurntBlack_Van_01", "SA_Prop_BurntBrown_Ute_01", "SA_Prop_BurntAPC_01",
        "SA_Prop_BurntTank_01", "SA_Prop_BurntBrown_Bus_01", "SA_Prop_BurntBlack_RV_01",
        "SA_Prop_ShippingContainer_01", "SA_Prop_Billboard_Burnt_01", "SA_Prop_BuildingRubble_01",
    ]),
    "prop": ("Props", 55.0, [
        "SA_Prop_Barrier_01", "SA_Prop_Barrier_02", "SA_Prop_Barrier_03", "SA_Prop_Rubble_01", "SA_Prop_Rubble_02", "SA_Prop_Rubble_03",
        "SA_Prop_Rubble_04", "SA_Prop_BurnBarrel_01", "SA_Prop_Barrel_01", "SA_Prop_BarrelTipped_01",
        "SA_Prop_TirePile_01", "SA_Prop_TirePile_02", "SA_Prop_TirePile_03", "SA_Prop_SpikeFence_02", "SA_Prop_SpikeFence_03",
        "SA_Prop_Fence_Corrugated_Damaged_01", "SA_Prop_Fence_Wire_Damaged_01", "SA_Prop_TreeDeadBurnt_01", "SA_Prop_TreeDeadBurnt_02",
        "SA_Prop_TreeDeadBurnt_03", "SA_Prop_WarningSign_Damaged_01", "SA_Prop_TrafficLight_Damaged_01", "SA_Prop_FloodLight_01",
        "SA_Prop_AmmoCrate_01", "SA_Prop_Crate_01",
    ]),
}

def log(*a): print("[env]", *a, flush=True)

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    atlas = bpy.data.images.load(ATLAS)
    mat = bpy.data.materials.new("SA_Atlas")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = atlas
    tex.interpolation = "Closest"
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    roots, names = [], []
    for cat, (folder, scale, items) in CATALOG.items():
        for name in items:
            path = os.path.join(SA, folder, f"{name}.fbx")
            if not os.path.exists(path):
                log("missing", name); continue
            before = set(bpy.data.objects)
            bpy.ops.import_scene.fbx(filepath=path)
            objs = [o for o in bpy.data.objects if o not in before]
            meshes = [o for o in objs if o.type == "MESH"]
            for o in objs:
                if o.type != "MESH": bpy.data.objects.remove(o)
            if not meshes: continue
            for o in meshes:
                o.select_set(False)
            bpy.ops.object.select_all(action="DESELECT")
            for o in meshes: o.select_set(True)
            bpy.context.view_layer.objects.active = meshes[0]
            if len(meshes) > 1: bpy.ops.object.join()
            o = bpy.context.active_object
            o.parent = None
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            # Ground-centre the origin and apply game scale.
            vs = [o.matrix_world @ v.co for v in o.data.vertices]
            mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
            mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
            centre = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
            o.data.transform(Matrix.Translation(-centre))
            o.data.transform(Matrix.Scale(scale, 4))
            o.location = (0, 0, 0)
            o.data.materials.clear()
            o.data.materials.append(mat)
            o.name = name
            o.data.name = name
            for p in o.data.polygons: p.use_smooth = False
            roots.append(o)
            names.append(f"{cat}:{name}")
    bpy.ops.object.select_all(action="DESELECT")
    for o in roots: o.select_set(True)
    path = os.path.join(OUT, "environment.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_animations=False, export_image_format="AUTO")
    log("exported", path, f"{os.path.getsize(path) / 1024:.0f} KB", len(names), "props")
    mpath = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {"version": 2, "factions": {}}
    manifest["environment"] = {"file": "environment.glb", "props": names}
    json.dump(manifest, open(mpath, "w"), indent=2)
    log("manifest updated")

main()
