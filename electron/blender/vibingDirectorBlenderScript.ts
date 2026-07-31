/** Exported for the opt-in real-Blender smoke test; production writes this to a temporary file. */
export const VIBING_DIRECTOR_BLENDER_SCRIPT = String.raw`
import bpy
import json
import math
import os
import sys
from mathutils import Vector

RATIOS = {
    "16:9": (960, 540), "9:16": (540, 960), "4:3": (800, 600),
    "3:4": (600, 800), "1:1": (720, 720), "2.39:1": (960, 402),
}
DIRECTOR_COLLECTION = "Nomi Director"

def args_after_separator():
    marker = sys.argv.index("--")
    return sys.argv[marker + 1:]

def vec3(value, fallback=(0.0, 0.0, 0.0)):
    if not isinstance(value, list) or len(value) != 3:
        value = fallback
    return (float(value[0]), -float(value[2]), float(value[1]))

def director_vec3(value):
    return [float(value[0]), float(value[2]), -float(value[1])]

def director_rot3(value):
    return [
        math.degrees(float(value[0])),
        math.degrees(float(value[2])),
        -math.degrees(float(value[1])),
    ]

def director_scale3(value):
    return [float(value[0]), float(value[2]), float(value[1])]

def rot3(value):
    if not isinstance(value, list) or len(value) != 3:
        value = (0.0, 0.0, 0.0)
    # Director plans use degrees so the agent can express facing directions as 0/90/180.
    return (math.radians(float(value[0])), math.radians(-float(value[2])), math.radians(float(value[1])))

def angle_delta(value, target):
    return math.atan2(math.sin(float(value) - float(target)), math.cos(float(value) - float(target)))

def scale3(value):
    if not isinstance(value, list) or len(value) != 3:
        value = (1.0, 1.0, 1.0)
    return (float(value[0]), float(value[2]), float(value[1]))

def color3(value, fallback=(0.55, 0.58, 0.62)):
    if isinstance(value, str) and len(value) == 7 and value.startswith("#"):
        try:
            return tuple(int(value[index:index + 2], 16) / 255.0 for index in (1, 3, 5))
        except ValueError:
            pass
    return fallback

def director_collection():
    collection = bpy.data.collections.get(DIRECTOR_COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(DIRECTOR_COLLECTION)
        bpy.context.scene.collection.children.link(collection)
    return collection

def move_to_collection(obj, collection):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    collection.objects.link(obj)

def tag(obj, object_id):
    obj["nomi_director_id"] = object_id
    return obj

def remove_collection_objects(collection):
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

def remove_factory_startup_objects():
    # A replace plan starts from Blender's factory scene. Its Cube/Camera/Light
    # must not leak into the Director stage or block the generated layout.
    for name in ("Cube", "Camera", "Light"):
        obj = bpy.data.objects.get(name)
        if obj is not None:
            bpy.data.objects.remove(obj, do_unlink=True)

def material(name, color):
    item = bpy.data.materials.new(name=name)
    item.diffuse_color = (*color3(color), 1.0)
    item.roughness = 0.72
    return item

def primitive(collection, geometry, name, location, scale, color, object_id=None):
    if geometry == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=location)
    elif geometry == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, location=location)
    elif geometry == "torus":
        bpy.ops.mesh.primitive_torus_add(major_radius=0.14, minor_radius=0.028, location=location)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material(name + " Material", color))
    move_to_collection(obj, collection)
    return tag(obj, object_id) if object_id else obj

def marker_part(collection, root, geometry, name, location, scale, color, rotation=(0.0, 0.0, 0.0)):
    obj = primitive(collection, geometry, name, (0.0, 0.0, 0.0), scale, color)
    obj.parent = root
    obj.location = location
    obj.rotation_euler = rotation
    return obj

def marker_role(action):
    role = str(action.get("role") or "").strip().lower()
    if role:
        return role
    source = (str(action.get("id") or "") + " " + str(action.get("name") or "")).lower()
    if "cup" in source or "咖啡杯" in source or "杯" in source:
        return "cup"
    if "laptop" in source or "电脑" in source:
        return "laptop"
    if "plate" in source or "cake" in source or "盘" in source or "蛋糕" in source:
        return "plate"
    if "chair" in source or "椅" in source:
        return "chair"
    if "table" in source or "桌" in source:
        return "table"
    if "actor" in source or "char" in source or "角色" in source or "人物" in source or "咖啡师" in source:
        return "actor_seated"
    return "prop"

def table_proxy(collection, root, color):
    marker_part(collection, root, "cylinder", root.name + " Base", (0.0, 0.0, 0.06), (0.52, 0.52, 0.06), color)
    marker_part(collection, root, "cylinder", root.name + " Pedestal", (0.0, 0.0, 0.36), (0.14, 0.14, 0.3), color)
    marker_part(collection, root, "cylinder", root.name + " Top", (0.0, 0.0, 0.72), (0.9, 0.9, 0.08), color)

def chair_proxy(collection, root, color):
    marker_part(collection, root, "box", root.name + " Seat", (0.0, 0.0, 0.44), (0.46, 0.46, 0.06), color)
    marker_part(collection, root, "box", root.name + " Back", (0.0, 0.38, 0.88), (0.46, 0.06, 0.48), color)
    for x in (-0.36, 0.36):
        for y in (-0.34, 0.34):
            marker_part(collection, root, "box", root.name + " Leg", (x, y, 0.21), (0.045, 0.045, 0.21), color)

def seated_actor_proxy(collection, root, color):
    marker_part(collection, root, "box", root.name + " Hips", (0.0, 0.0, 0.58), (0.24, 0.21, 0.1), color)
    marker_part(collection, root, "cylinder", root.name + " Torso", (0.0, 0.02, 0.93), (0.22, 0.18, 0.34), color)
    marker_part(collection, root, "sphere", root.name + " Head", (0.0, -0.02, 1.52), (0.21, 0.21, 0.21), color)
    for side, x in (("Left", -0.14), ("Right", 0.14)):
        marker_part(collection, root, "box", root.name + " " + side + " Thigh", (x, -0.28, 0.52), (0.09, 0.28, 0.09), color)
        marker_part(collection, root, "box", root.name + " " + side + " Calf", (x, -0.54, 0.28), (0.09, 0.08, 0.28), color)
        marker_part(collection, root, "box", root.name + " " + side + " Arm", (x * 2.0, -0.1, 0.98), (0.07, 0.11, 0.3), color)

def standing_actor_proxy(collection, root, color):
    marker_part(collection, root, "cylinder", root.name + " Torso", (0.0, 0.0, 1.05), (0.24, 0.19, 0.48), color)
    marker_part(collection, root, "sphere", root.name + " Head", (0.0, 0.0, 1.78), (0.21, 0.21, 0.21), color)
    for side, x in (("Left", -0.14), ("Right", 0.14)):
        marker_part(collection, root, "box", root.name + " " + side + " Leg", (x, 0.0, 0.43), (0.09, 0.1, 0.43), color)
        marker_part(collection, root, "box", root.name + " " + side + " Arm", (x * 2.1, 0.0, 1.1), (0.07, 0.1, 0.36), color)

def cup_proxy(collection, root, color):
    marker_part(collection, root, "cylinder", root.name + " Body", (0.0, 0.0, 0.1), (0.15, 0.15, 0.1), color)
    marker_part(collection, root, "torus", root.name + " Handle", (0.17, 0.0, 0.12), (1.0, 1.0, 1.0), color, (math.radians(90), 0.0, 0.0))

def laptop_proxy(collection, root, color):
    marker_part(collection, root, "box", root.name + " Base", (0.0, 0.0, 0.04), (0.35, 0.24, 0.04), color)
    marker_part(collection, root, "box", root.name + " Screen", (0.0, 0.17, 0.22), (0.35, 0.025, 0.22), color, (math.radians(65), 0.0, 0.0))

def plate_proxy(collection, root, color):
    marker_part(collection, root, "cylinder", root.name + " Plate", (0.0, 0.0, 0.025), (0.28, 0.28, 0.025), color)
    marker_part(collection, root, "cylinder", root.name + " Cake", (0.0, 0.0, 0.1), (0.15, 0.15, 0.07), "#d4a373")

def add_stage(collection, preset):
    primitive(collection, "box", "Nomi Floor", (0.0, 0.0, -0.06), (7.0, 7.0, 0.06), "#4b5563", "stage-floor")
    if preset == "coffee_shop":
        primitive(collection, "box", "Cafe Back Wall", (0.0, 4.8, 2.8), (7.0, 0.08, 2.8), "#c9b8a8", "stage-back-wall")
        primitive(collection, "box", "Cafe Window Wall", (-4.8, 0.0, 2.8), (0.08, 4.8, 2.8), "#d8c7b8", "stage-window-wall")
        primitive(collection, "box", "Cafe Window", (-4.7, -0.8, 2.5), (0.03, 2.0, 1.55), "#93c5d8", "stage-window")
        primitive(collection, "box", "Cafe Counter", (0.0, 4.0, 1.1), (4.4, 0.65, 1.1), "#4e342e", "stage-counter")
        primitive(collection, "box", "Cafe Counter Top", (0.0, 3.65, 2.22), (4.7, 0.2, 0.12), "#8b5e3c", "stage-counter-top")
        primitive(collection, "box", "Espresso Machine", (0.0, 3.4, 2.75), (0.8, 0.35, 0.5), "#475569", "stage-espresso-machine")
    elif preset == "city_street":
        primitive(collection, "box", "Street", (0.0, 0.0, 0.03), (12.0, 4.0, 0.04), "#374151", "stage-street")
        primitive(collection, "box", "Building Left", (-5.5, 3.2, 3.0), (2.5, 2.5, 3.0), "#6b7280", "stage-building-left")
        primitive(collection, "box", "Building Right", (5.5, 3.2, 3.0), (2.5, 2.5, 3.0), "#9ca3af", "stage-building-right")
    elif preset == "interior_room":
        primitive(collection, "box", "Back Wall", (0.0, 5.0, 3.0), (10.0, 0.1, 3.0), "#d6d3d1", "stage-back-wall")
        primitive(collection, "box", "Left Wall", (-5.0, 0.0, 3.0), (0.1, 10.0, 3.0), "#e7e5e4", "stage-left-wall")

def marker(collection, action):
    root = bpy.data.objects.new(action.get("name") or "Blocking Marker", None)
    root.empty_display_type = "PLAIN_AXES"
    root.location = vec3(action.get("position"))
    root.rotation_euler = rot3(action.get("rotation"))
    root.scale = scale3(action.get("scale"))
    collection.objects.link(root)
    tag(root, action.get("id"))
    tint = action.get("color") or "#60a5fa"
    role = marker_role(action)
    root["nomi_role"] = role
    if role == "table":
        table_proxy(collection, root, tint)
    elif role == "chair":
        chair_proxy(collection, root, tint)
    elif role == "actor_standing":
        standing_actor_proxy(collection, root, tint)
    elif role.startswith("actor"):
        seated_actor_proxy(collection, root, tint)
    elif role == "cup":
        cup_proxy(collection, root, tint)
    elif role == "laptop":
        laptop_proxy(collection, root, tint)
    elif role == "plate":
        plate_proxy(collection, root, tint)
    else:
        marker_part(collection, root, "box", root.name + " Prop", (0.0, 0.0, 0.22), (0.24, 0.24, 0.22), tint)
    return root

def imported_asset(collection, action, assets):
    source = assets.get(action.get("assetId"))
    if not source:
        raise RuntimeError("assetId 不在本机资产库")
    before = set(bpy.data.objects.keys())
    extension = os.path.splitext(source)[1].lower()
    if extension in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=source)
    elif extension == ".fbx":
        bpy.ops.import_scene.fbx(filepath=source)
    elif extension == ".obj":
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=source)
        else:
            bpy.ops.import_scene.obj(filepath=source)
    elif extension == ".blend":
        with bpy.data.libraries.load(source, link=False) as (data_from, data_to):
            data_to.objects = data_from.objects
        for obj in data_to.objects:
            if obj is not None and not obj.users_collection:
                bpy.context.scene.collection.objects.link(obj)
    else:
        raise RuntimeError("不支持的本机资产格式")
    new_objects = [bpy.data.objects[name] for name in set(bpy.data.objects.keys()) - before]
    root = bpy.data.objects.new(action.get("name") or "Imported Asset", None)
    root.empty_display_type = "CUBE"
    root.location = vec3(action.get("position"))
    root.rotation_euler = rot3(action.get("rotation"))
    root.scale = scale3(action.get("scale"))
    collection.objects.link(root)
    tag(root, action.get("id"))
    root["nomi_role"] = "asset"
    for obj in new_objects:
        if obj.parent is None:
            obj.parent = root
        move_to_collection(obj, collection)
    return root

def find_object(collection, object_ref):
    matches = [obj for obj in collection.objects if obj.get("nomi_director_id") == object_ref or obj.name == object_ref]
    return matches[0] if len(matches) == 1 else None

def look_at(obj, target, remember=False):
    direction = Vector(target) - obj.location
    if direction.length > 0.0001:
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    if remember:
        obj["nomi_look_at"] = [float(target[0]), float(target[1]), float(target[2])]

def director_camera(collection):
    existing = find_object(collection, "director-camera")
    if existing is not None and existing.type == "CAMERA":
        if "nomi_framing" not in existing:
            existing["nomi_framing"] = "all"
        if "nomi_look_at" not in existing:
            forward = existing.rotation_euler.to_matrix() @ Vector((0.0, 0.0, -1.0))
            existing["nomi_look_at"] = list(existing.location + forward * 10.0)
        return existing
    data = bpy.data.cameras.new("Nomi Director Camera")
    obj = bpy.data.objects.new("Nomi Director Camera", data)
    collection.objects.link(obj)
    tag(obj, "director-camera")
    obj.location = vec3([5.0, 2.4, 6.0])
    obj.data.angle = math.radians(45.0)
    obj["nomi_aspect_ratio"] = "16:9"
    obj["nomi_framing"] = "all"
    look_at(obj, vec3([0.0, 1.0, 0.0]), True)
    return obj

def apply_camera(collection, action):
    obj = director_camera(collection)
    if action.get("name"):
        obj.name = action.get("name")
    if action.get("position"):
        obj.location = vec3(action.get("position"))
    if action.get("lookAt"):
        look_at(obj, vec3(action.get("lookAt")), True)
    if action.get("fov"):
        obj.data.angle = math.radians(max(1.0, min(160.0, float(action.get("fov")))))
    if action.get("aspectRatio") in RATIOS:
        obj["nomi_aspect_ratio"] = action.get("aspectRatio")
    framing = action.get("framing")
    target_ref = action.get("targetRef")
    if target_ref and framing is None:
        framing = "target"
    if framing in ("all", "target", "fixed"):
        obj["nomi_framing"] = framing
        if framing != "target" and "nomi_target_ref" in obj:
            del obj["nomi_target_ref"]
    if target_ref:
        obj["nomi_target_ref"] = str(target_ref)
    bpy.context.scene.camera = obj
    return obj

def apply_camera_path(collection, action):
    obj = director_camera(collection)
    obj["nomi_framing"] = "fixed"
    if "nomi_target_ref" in obj:
        del obj["nomi_target_ref"]
    points = action.get("points") or []
    duration = max(0.1, float(action.get("durationSec") or 3.0))
    fps = 24
    for index, point in enumerate(points):
        obj.location = vec3(point)
        frame = 1 + round((duration * fps) * index / max(1, len(points) - 1))
        obj.keyframe_insert(data_path="location", frame=frame)
    bpy.context.scene.frame_end = max(bpy.context.scene.frame_end, 1 + round(duration * fps))
    bpy.context.scene.camera = obj

def object_bounds(root):
    points = []
    for obj in [root] + list(root.children_recursive):
        if obj.type != "MESH" or not hasattr(obj, "bound_box"):
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        return None
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    return minimum, maximum

def load_relations():
    raw = bpy.context.scene.get("nomi_relations_json")
    if not raw:
        return []
    try:
        value = json.loads(str(raw))
        return value if isinstance(value, list) else []
    except Exception:
        return []

def save_relations(relations):
    bpy.context.scene["nomi_relations_json"] = json.dumps(relations, ensure_ascii=False)

def relation_objects(collection, relation):
    subject_ref = str(relation.get("subjectRef") or "")
    target_ref = str(relation.get("targetRef") or "")
    subject = find_object(collection, subject_ref)
    target = find_object(collection, target_ref)
    missing = []
    if subject is None:
        missing.append(subject_ref or "未指定 subjectRef")
    if target is None:
        missing.append(target_ref or "未指定 targetRef")
    if missing:
        raise RuntimeError("空间关系「" + str(relation.get("id") or "未命名") + "」找不到对象：" + "、".join(missing))
    return subject, target

def upsert_relation(collection, action):
    subject, target = relation_objects(collection, action)
    relation = {
        "id": str(action.get("id")),
        "kind": str(action.get("kind")),
        "subjectRef": str(action.get("subjectRef")),
        "targetRef": str(action.get("targetRef")),
    }
    if relation["kind"] == "distance":
        distance = float(action.get("distance") or 0.0)
        if distance <= 0.0:
            raise RuntimeError("distance 空间关系缺少有效距离")
        relation["distance"] = distance
    if bool(action.get("mutual")):
        relation["mutual"] = True
    if relation["kind"] == "support":
        relation["offset"] = [
            float(subject.location.x - target.location.x),
            float(subject.location.y - target.location.y),
        ]
    if relation["kind"] == "offset":
        delta = subject.location - target.location
        relation["relativeOffset"] = [float(delta.x), float(delta.y), float(delta.z)]
        relation["relativeRotation"] = [
            angle_delta(subject.rotation_euler[index], target.rotation_euler[index])
            for index in range(3)
        ]
    relations = [item for item in load_relations() if str(item.get("id") or "") != relation["id"]]
    relations.append(relation)
    save_relations(relations)

def remove_relation(relation_ref):
    relations = load_relations()
    next_relations = [item for item in relations if str(item.get("id") or "") != str(relation_ref)]
    if len(next_relations) == len(relations):
        raise RuntimeError("当前没有空间关系「" + str(relation_ref) + "」")
    save_relations(next_relations)

def remove_object_relations(object_ref):
    save_relations([
        item for item in load_relations()
        if str(item.get("subjectRef") or "") != str(object_ref)
        and str(item.get("targetRef") or "") != str(object_ref)
    ])

def facing_error_degrees(subject, target):
    direction = target.location - subject.location
    direction.z = 0.0
    if direction.length <= 0.0001:
        return 0.0
    direction.normalize()
    forward = subject.rotation_euler.to_matrix() @ Vector((0.0, -1.0, 0.0))
    forward.z = 0.0
    if forward.length <= 0.0001:
        return 180.0
    forward.normalize()
    dot = max(-1.0, min(1.0, forward.dot(direction)))
    return math.degrees(math.acos(dot))

def face_object(subject, target):
    direction = target.location - subject.location
    direction.z = 0.0
    if direction.length <= 0.0001:
        return
    subject.rotation_euler.z = math.atan2(float(direction.x), float(-direction.y))

def apply_relation(collection, relation):
    subject, target = relation_objects(collection, relation)
    kind = str(relation.get("kind") or "")
    if kind == "support":
        offset = relation.get("offset")
        if not isinstance(offset, list) or len(offset) != 2:
            offset = [subject.location.x - target.location.x, subject.location.y - target.location.y]
            relation["offset"] = [float(offset[0]), float(offset[1])]
        subject.location.x = target.location.x + float(offset[0])
        subject.location.y = target.location.y + float(offset[1])
        bpy.context.view_layer.update()
        subject_bounds = object_bounds(subject)
        target_bounds = object_bounds(target)
        if subject_bounds is None or target_bounds is None:
            raise RuntimeError("support 空间关系需要可计算边界的对象")
        subject.location.z += float(target_bounds[1].z - subject_bounds[0].z)
        return
    if kind == "distance":
        distance = float(relation.get("distance") or 0.0)
        direction = subject.location - target.location
        direction.z = 0.0
        if direction.length <= 0.0001:
            direction = Vector((0.0, -1.0, 0.0))
        direction.normalize()
        subject.location.x = target.location.x + direction.x * distance
        subject.location.y = target.location.y + direction.y * distance
        return
    if kind == "offset":
        offset = relation.get("relativeOffset")
        if not isinstance(offset, list) or len(offset) != 3:
            delta = subject.location - target.location
            offset = [float(delta.x), float(delta.y), float(delta.z)]
            relation["relativeOffset"] = offset
        subject.location = target.location + Vector((float(offset[0]), float(offset[1]), float(offset[2])))
        rotation = relation.get("relativeRotation")
        if not isinstance(rotation, list) or len(rotation) != 3:
            rotation = [0.0, 0.0, 0.0]
            relation["relativeRotation"] = rotation
        subject.rotation_euler = tuple(target.rotation_euler[index] + float(rotation[index]) for index in range(3))
        return
    if kind in ("facing", "line_of_sight"):
        face_object(subject, target)
        if bool(relation.get("mutual")):
            face_object(target, subject)
        return
    raise RuntimeError("不支持的空间关系：" + kind)

def enforce_relations(collection):
    relations = load_relations()
    rank = {"support": 0, "distance": 1, "facing": 2, "line_of_sight": 2, "offset": 3}
    for relation in sorted(relations, key=lambda item: rank.get(str(item.get("kind") or ""), 99)):
        apply_relation(collection, relation)
        bpy.context.view_layer.update()
    save_relations(relations)
    return relations

def spatial_report(collection, relations):
    checks = []
    for relation in relations:
        subject, target = relation_objects(collection, relation)
        relation_id = str(relation.get("id") or "")
        kind = str(relation.get("kind") or "")
        status = "passed"
        message = ""
        measured = None
        expected = None
        rotation_measured = None
        rotation_expected = None
        if kind == "support":
            bpy.context.view_layer.update()
            subject_bounds = object_bounds(subject)
            target_bounds = object_bounds(target)
            gap = float(subject_bounds[0].z - target_bounds[1].z) if subject_bounds and target_bounds else 999.0
            measured = abs(gap)
            expected = 0.0
            status = "passed" if abs(gap) <= 0.02 else "failed"
            message = "承托接触间隙 " + str(round(abs(gap), 4)) + "m"
        elif kind == "distance":
            delta = subject.location - target.location
            measured = math.hypot(float(delta.x), float(delta.y))
            expected = float(relation.get("distance") or 0.0)
            status = "passed" if abs(measured - expected) <= 0.02 else "failed"
            message = "水平距离 " + str(round(measured, 4)) + "m"
        elif kind == "offset":
            offset = relation.get("relativeOffset")
            expected_offset = Vector((
                float(offset[0]) if isinstance(offset, list) and len(offset) == 3 else 0.0,
                float(offset[1]) if isinstance(offset, list) and len(offset) == 3 else 0.0,
                float(offset[2]) if isinstance(offset, list) and len(offset) == 3 else 0.0,
            ))
            measured = float(((subject.location - target.location) - expected_offset).length)
            expected = 0.0
            rotation = relation.get("relativeRotation")
            if not isinstance(rotation, list) or len(rotation) != 3:
                rotation = [0.0, 0.0, 0.0]
            rotation_measured = max(
                abs(math.degrees(angle_delta(subject.rotation_euler[index] - target.rotation_euler[index], rotation[index])))
                for index in range(3)
            )
            rotation_expected = 0.0
            status = "passed" if measured <= 0.02 and rotation_measured <= 2.0 else "failed"
            message = "相对位置误差 " + str(round(measured, 4)) + "m，朝向误差 " + str(round(rotation_measured, 3)) + "°"
        elif kind in ("facing", "line_of_sight"):
            errors = [facing_error_degrees(subject, target)]
            if bool(relation.get("mutual")):
                errors.append(facing_error_degrees(target, subject))
            measured = max(errors)
            expected = 0.0
            status = "passed" if measured <= 2.0 else "failed"
            message = "朝向误差 " + str(round(measured, 3)) + "°"
        checks.append({
            "relationId": relation_id,
            "kind": kind,
            "status": status,
            "message": message,
            **({"measured": measured} if measured is not None else {}),
            **({"expected": expected} if expected is not None else {}),
            **({"rotationMeasured": rotation_measured} if rotation_measured is not None else {}),
            **({"rotationExpected": rotation_expected} if rotation_expected is not None else {}),
        })
    return {
        "version": 1,
        "passed": all(check.get("status") != "failed" for check in checks),
        "checks": checks,
    }

def focus_roots(collection, camera):
    framing = str(camera.get("nomi_framing") or "all")
    if framing == "fixed":
        return []
    if framing == "target":
        target_ref = str(camera.get("nomi_target_ref") or "")
        target = find_object(collection, target_ref)
        if target is None:
            raise RuntimeError("无法找到相机目标：" + (target_ref or "未指定"))
        return [target]
    roots = []
    for obj in collection.objects:
        object_id = str(obj.get("nomi_director_id") or "")
        if not object_id or object_id == "director-camera" or object_id.startswith("stage-"):
            continue
        if obj.type in ("CAMERA", "LIGHT"):
            continue
        roots.append(obj)
    if roots:
        return roots
    return [
        obj for obj in collection.objects
        if str(obj.get("nomi_director_id") or "").startswith("stage-")
    ]

def frame_camera(collection, camera):
    roots = focus_roots(collection, camera)
    if not roots:
        return []
    bpy.context.view_layer.update()
    bounds = [item for item in (object_bounds(root) for root in roots) if item is not None]
    if not bounds:
        return []
    minimum = Vector((
        min(item[0].x for item in bounds),
        min(item[0].y for item in bounds),
        min(item[0].z for item in bounds),
    ))
    maximum = Vector((
        max(item[1].x for item in bounds),
        max(item[1].y for item in bounds),
        max(item[1].z for item in bounds),
    ))
    center = (minimum + maximum) * 0.5
    radius = max((maximum - minimum).length * 0.5, 0.25)
    previous_target_value = camera.get("nomi_look_at")
    previous_target = Vector(previous_target_value) if previous_target_value and len(previous_target_value) == 3 else center
    view_direction = previous_target - camera.location
    if view_direction.length <= 0.0001:
        view_direction = camera.rotation_euler.to_matrix() @ Vector((0.0, 0.0, -1.0))
    view_direction.normalize()
    width, height = RATIOS.get(camera.get("nomi_aspect_ratio", "16:9"), RATIOS["16:9"])
    aspect = max(0.1, float(width) / float(height))
    horizontal_fov = max(math.radians(1.0), min(math.radians(160.0), float(camera.data.angle)))
    vertical_fov = 2.0 * math.atan(math.tan(horizontal_fov * 0.5) / aspect)
    half_fov = max(math.radians(0.5), min(horizontal_fov, vertical_fov) * 0.5)
    distance = max(radius / max(0.05, math.sin(half_fov)) * 1.18, radius * 1.6, 1.5)
    camera.location = center - view_direction * distance
    camera.data.clip_start = max(0.01, min(0.1, distance - radius * 1.2))
    camera.data.clip_end = max(200.0, distance + radius * 8.0)
    look_at(camera, center, True)
    return [str(root.get("nomi_director_id") or root.name) for root in roots]

def preview_camera_payload(camera, focus_ids):
    target = camera.get("nomi_look_at")
    if not target or len(target) != 3:
        target = list(camera.location + camera.rotation_euler.to_matrix() @ Vector((0.0, 0.0, -1.0)) * 10.0)
    framing = str(camera.get("nomi_framing") or "all")
    payload = {
        "id": "director-camera",
        "name": camera.name,
        "position": director_vec3(camera.location),
        "lookAt": director_vec3(target),
        "fov": math.degrees(float(camera.data.angle)),
        "aspectRatio": str(camera.get("nomi_aspect_ratio") or "16:9"),
        "framing": framing,
        "focusIds": focus_ids,
    }
    target_ref = str(camera.get("nomi_target_ref") or "")
    if framing == "target" and target_ref:
        payload["targetRef"] = target_ref
    return payload

def object_transforms_payload(collection):
    transforms = []
    for obj in collection.objects:
        object_id = str(obj.get("nomi_director_id") or "")
        if not object_id or object_id == "director-camera" or object_id.startswith("stage-"):
            continue
        if obj.type in ("CAMERA", "LIGHT"):
            continue
        transforms.append({
            "id": object_id,
            "name": obj.name,
            "position": director_vec3(obj.location),
            "rotation": director_rot3(obj.rotation_euler),
            "scale": director_scale3(obj.scale),
        })
    return transforms

def ensure_lights(collection):
    if any(obj.type == "LIGHT" for obj in collection.objects):
        return
    data = bpy.data.lights.new("Nomi Key Light", type="AREA")
    data.energy = 850
    obj = bpy.data.objects.new("Nomi Key Light", data)
    obj.location = (4.0, -4.0, 6.0)
    collection.objects.link(obj)
    look_at(obj, (0.0, 0.0, 1.0))

def apply_plan(payload):
    plan = payload.get("plan") or {}
    collection = director_collection()
    if plan.get("mode") == "replace":
        remove_collection_objects(collection)
        remove_factory_startup_objects()
        save_relations([])
    assets = {item.get("id"): item.get("path") for item in payload.get("assets") or [] if item.get("id") and item.get("path")}
    for action in plan.get("actions") or []:
        op = action.get("op")
        if op == "set_stage":
            add_stage(collection, action.get("preset") or "empty")
        elif op == "add_marker":
            marker(collection, action)
        elif op == "place_asset":
            imported_asset(collection, action, assets)
        elif op == "move_object":
            obj = find_object(collection, action.get("objectRef"))
            if obj is None:
                raise RuntimeError("无法找到要调整的 Blender 对象")
            if action.get("position"):
                obj.location = vec3(action.get("position"))
            if action.get("rotation"):
                obj.rotation_euler = rot3(action.get("rotation"))
            if action.get("scale"):
                obj.scale = scale3(action.get("scale"))
            if action.get("name"):
                obj.name = action.get("name")
        elif op == "remove_object":
            obj = find_object(collection, action.get("objectRef"))
            if obj is None:
                raise RuntimeError("无法找到要移除的 Blender 对象")
            remove_object_relations(action.get("objectRef"))
            for child in list(obj.children_recursive):
                bpy.data.objects.remove(child, do_unlink=True)
            bpy.data.objects.remove(obj, do_unlink=True)
        elif op == "set_relation":
            upsert_relation(collection, action)
        elif op == "remove_relation":
            remove_relation(action.get("relationRef"))
        elif op == "set_camera":
            apply_camera(collection, action)
        elif op == "set_camera_path":
            apply_camera_path(collection, action)
    relations = enforce_relations(collection)
    ensure_lights(collection)
    camera = director_camera(collection)
    bpy.context.scene.camera = camera
    focus_ids = frame_camera(collection, camera)
    return camera, focus_ids, spatial_report(collection, relations)

def main():
    plan_path, output_dir = args_after_separator()
    with open(plan_path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    os.makedirs(output_dir, exist_ok=True)
    camera, focus_ids, relation_report = apply_plan(payload)
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.fps = 24
    aspect = camera.get("nomi_aspect_ratio", "16:9")
    width, height = RATIOS.get(aspect, RATIOS["16:9"])
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.join(output_dir, "preview.png")
    scene.render.film_transparent = False
    scene.frame_set(1)
    bpy.ops.render.render(write_still=True)
    blend = os.path.join(output_dir, "scene.blend")
    model = os.path.join(output_dir, "scene.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.export_scene.gltf(filepath=model, export_format="GLB")
    print(json.dumps({"ok": True, "jobId": payload.get("jobId"), "blenderVersion": bpy.app.version_string, "previewCamera": preview_camera_payload(camera, focus_ids), "spatialReport": relation_report, "objectTransforms": object_transforms_payload(director_collection()), "artifacts": {"preview": os.path.join(output_dir, "preview.png"), "blend": blend, "model": model}}, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": {"message": str(error)}}, ensure_ascii=False))
        raise
`;
