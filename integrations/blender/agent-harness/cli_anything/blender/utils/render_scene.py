import bpy
import json
import math
import os
import sys
from mathutils import Vector


RATIOS = {
    "16:9": (960, 540),
    "9:16": (540, 960),
    "4:3": (800, 600),
    "3:4": (600, 800),
    "1:1": (720, 720),
    "2.39:1": (960, 402),
}


def arguments():
    marker = sys.argv.index("--")
    return sys.argv[marker + 1:]


def vec3(value, fallback=(0.0, 0.0, 0.0)):
    if not isinstance(value, list) or len(value) < 3:
        value = fallback
    return (float(value[0]), -float(value[2]), float(value[1]))


def rotation3(value):
    if not isinstance(value, list) or len(value) < 3:
        value = (0.0, 0.0, 0.0)
    return (float(value[0]), -float(value[2]), float(value[1]))


def scale3(value):
    if not isinstance(value, list) or len(value) < 3:
        value = (1.0, 1.0, 1.0)
    return (float(value[0]), float(value[2]), float(value[1]))


def color3(value, fallback=(0.55, 0.58, 0.62)):
    if isinstance(value, str) and len(value) == 7 and value.startswith("#"):
        try:
            return tuple(int(value[index:index + 2], 16) / 255.0 for index in (1, 3, 5))
        except ValueError:
            pass
    return fallback


def new_material(name, color):
    material = bpy.data.materials.new(name=name)
    material.diffuse_color = (*color3(color), 1.0)
    material.roughness = 0.72
    return material


def add_primitive(geometry, name, location, scale, color):
    if geometry == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=location)
    elif geometry == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, location=location)
    elif geometry == "plane":
        bpy.ops.mesh.primitive_plane_add(size=2.0, location=location)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(new_material(name + " Material", color))
    return obj


def add_mannequin(item):
    root = bpy.data.objects.new(item.get("name") or "Mannequin", None)
    root.empty_display_type = "PLAIN_AXES"
    source_scale = item.get("scale") if isinstance(item.get("scale"), list) else [1.0, 1.0, 1.0]
    root.location = vec3(item.get("position"))
    # Nomi's realtime mannequin asset is authored at roughly 2.5 scene units.
    # The primitive stand-in is unit-sized, so compensate when importing a
    # Scene3D state and use the stored Y center as a ground-placement offset.
    root.location.z = max(0.0, root.location.z - float(source_scale[1]) * 0.5)
    root.rotation_euler = rotation3(item.get("rotation"))
    root.scale = tuple(component / 2.5 for component in scale3(source_scale))
    bpy.context.collection.objects.link(root)
    color = item.get("color") or "#9ca3af"
    pieces = [
        ("Torso", "cylinder", (0.0, 0.0, 1.15), (0.34, 0.34, 0.58)),
        ("Head", "sphere", (0.0, 0.0, 1.92), (0.25, 0.25, 0.25)),
        ("Left Arm", "cylinder", (-0.48, 0.0, 1.22), (0.10, 0.10, 0.48)),
        ("Right Arm", "cylinder", (0.48, 0.0, 1.22), (0.10, 0.10, 0.48)),
        ("Left Leg", "cylinder", (-0.18, 0.0, 0.43), (0.12, 0.12, 0.48)),
        ("Right Leg", "cylinder", (0.18, 0.0, 0.43), (0.12, 0.12, 0.48)),
    ]
    for suffix, geometry, local, scale in pieces:
        obj = add_primitive(geometry, root.name + " " + suffix, local, scale, color)
        obj.parent = root
        obj.location = local
    return root


def add_light(item):
    light_type = {"directional": "SUN", "spot": "SPOT"}.get(item.get("lightType"), "POINT")
    data = bpy.data.lights.new(item.get("name") or "Light", type=light_type)
    data.energy = max(0.1, float(item.get("lightIntensity", 1.0))) * (900.0 if light_type == "POINT" else 3.0)
    data.color = color3(item.get("lightColor"), (1.0, 0.95, 0.86))
    obj = bpy.data.objects.new(item.get("name") or "Light", data)
    obj.location = vec3(item.get("position"), (3.0, 4.0, 5.0))
    obj.rotation_euler = rotation3(item.get("rotation"))
    bpy.context.collection.objects.link(obj)
    return obj


def add_prop(item):
    kind = item.get("propKind")
    geometry = {"tree": "cylinder", "streetlamp": "cylinder", "car": "box", "building": "box", "wall": "box"}.get(kind, item.get("geometry") or "box")
    return add_primitive(geometry, item.get("name") or "Prop", vec3(item.get("position")), scale3(item.get("scale")), item.get("color"))


def look_at(obj, target):
    direction = Vector(target) - obj.location
    if direction.length > 0.0001:
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_camera(item):
    data = bpy.data.cameras.new(item.get("name") or "Camera")
    data.angle = math.radians(max(6.0, min(120.0, float(item.get("fov", 45.0)))))
    data.clip_start = max(0.01, float(item.get("near", 0.1)))
    data.clip_end = max(data.clip_start + 0.1, float(item.get("far", 200.0)))
    obj = bpy.data.objects.new(item.get("name") or "Camera", data)
    obj.location = vec3(item.get("position"), (4.0, 2.4, 5.0))
    bpy.context.collection.objects.link(obj)
    look_at(obj, vec3(item.get("target"), (0.0, 0.8, 0.0)))
    return obj


def add_stage(stage):
    preset = stage.get("preset") if isinstance(stage, dict) else "empty"
    add_primitive("plane", "Nomi Floor", (0.0, 0.0, 0.0), (15.0, 15.0, 1.0), "#666d76")
    if preset == "coffee_shop":
        add_primitive("cylinder", "Coffee Table", (0.0, 0.0, 1.0), (1.5, 1.5, 0.45), "#7c5a42")
        add_primitive("cylinder", "Coffee Cup", (0.0, 0.0, 1.62), (0.24, 0.24, 0.24), "#f4e5cf")
        add_primitive("box", "Cafe Counter", (0.0, 4.5, 1.5), (6.0, 1.0, 1.5), "#4e342e")
    elif preset == "city_street":
        add_primitive("box", "Street", (0.0, 0.0, 0.06), (12.0, 4.0, 0.06), "#3e454d")
        add_primitive("box", "Building Left", (-5.0, 3.5, 3.0), (2.5, 2.5, 3.0), "#7a828c")
        add_primitive("box", "Building Right", (5.0, 3.5, 3.0), (2.5, 2.5, 3.0), "#8a9199")
    elif preset == "interior_room":
        add_primitive("box", "Back Wall", (0.0, 5.0, 3.0), (10.0, 0.15, 3.0), "#c7c2b9")
        add_primitive("box", "Left Wall", (-5.0, 0.0, 3.0), (0.15, 10.0, 3.0), "#d2cdc4")
        add_primitive("box", "Room Table", (0.0, 0.0, 1.0), (2.5, 1.5, 0.75), "#8e6e55")


def apply_trajectory_keys(scene_data, runtime_objects, fps):
    trajectories = {item.get("id"): item for item in scene_data.get("trajectories", [])}
    for binding in scene_data.get("trajectoryBindings", []):
        trajectory = trajectories.get(binding.get("trajectoryId"))
        points = trajectory.get("points", []) if trajectory else []
        if len(points) < 2:
            continue
        if binding.get("direction") == "reverse":
            points = list(reversed(points))
        start = float(binding.get("startTime", 0.0))
        end = max(start + 0.01, float(binding.get("endTime", start + 1.0)))
        for item in binding.get("objects", []):
            obj = runtime_objects.get(item.get("objectId"))
            if obj is None:
                continue
            for index, point in enumerate(points):
                ratio = point.get("timeRatio")
                ratio = float(ratio) if isinstance(ratio, (int, float)) else index / max(1, len(points) - 1)
                obj.location = vec3(point.get("position"))
                obj.keyframe_insert(data_path="location", frame=max(1, round((start + (end - start) * ratio) * fps) + 1))


def main():
    input_path, output_dir = arguments()
    with open(input_path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    scene_data = payload.get("scene") or {}
    stage = payload.get("stage") or {"preset": "empty"}
    os.makedirs(output_dir, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"

    environment = scene_data.get("environment") or {}
    scene.world.color = color3(environment.get("backgroundColor"), (0.045, 0.055, 0.07))
    add_stage(stage)

    runtime_objects = {}
    has_light = False
    for item in scene_data.get("objects", []):
        if item.get("visible", True) is False:
            continue
        if item.get("type") == "light":
            obj = add_light(item)
            has_light = True
        elif item.get("type") in ("mannequin", "mannequinCrowd"):
            obj = add_mannequin(item)
        elif item.get("type") == "prop":
            obj = add_prop(item)
        else:
            obj = add_primitive(item.get("geometry") or "box", item.get("name") or "Object", vec3(item.get("position")), scale3(item.get("scale")), item.get("color"))
            obj.rotation_euler = rotation3(item.get("rotation"))
        runtime_objects[item.get("id")] = obj

    if not has_light:
        add_light({"name": "Key Light", "lightType": "directional", "position": [4, 6, 3], "rotation": [-0.7, 0.3, -0.5], "lightIntensity": 2.0})
        add_light({"name": "Fill Light", "lightType": "point", "position": [-4, 3, 2], "lightIntensity": 0.7, "lightColor": "#b9d7ff"})

    cameras = []
    for item in scene_data.get("cameras", []):
        if item.get("visible", True) is False:
            continue
        camera = add_camera(item)
        runtime_objects[item.get("id")] = camera
        cameras.append((camera, item))
    if not cameras:
        fallback = {"id": "director-camera", "name": "Director Camera", "position": [6, 4, 7], "target": [0, 0.8, 0], "fov": 48, "aspectRatio": "16:9"}
        camera = add_camera(fallback)
        runtime_objects[fallback["id"]] = camera
        cameras.append((camera, fallback))
    scene.camera = cameras[0][0]

    fps = 24
    scene.render.fps = fps
    duration = max(0.1, float((scene_data.get("sceneTimeline") or {}).get("totalDuration", 1.0)))
    scene.frame_end = max(1, round(duration * fps))
    apply_trajectory_keys(scene_data, runtime_objects, fps)

    width, height = RATIOS.get(cameras[0][1].get("aspectRatio"), RATIOS["16:9"])
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = os.path.join(output_dir, "preview.png")
    scene.frame_set(1)
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output_dir, "scene.blend"))
    bpy.ops.export_scene.gltf(filepath=os.path.join(output_dir, "scene.glb"), export_format="GLB")
    print("NOMI_BLENDER_VERSION=" + bpy.app.version_string)


if __name__ == "__main__":
    main()
