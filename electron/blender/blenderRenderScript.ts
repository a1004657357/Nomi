export const BLENDER_RENDER_SCRIPT = String.raw`
import bpy
import json
import math
import os
import sys
from mathutils import Vector


def args_after_separator():
    marker = sys.argv.index("--")
    return sys.argv[marker + 1:]


def vec3(value, fallback=(0.0, 0.0, 0.0)):
    if not isinstance(value, list) or len(value) < 3:
        value = fallback
    return (float(value[0]), -float(value[2]), float(value[1]))


def rotation3(value):
    if not isinstance(value, list) or len(value) < 3:
        value = [0.0, 0.0, 0.0]
    return (float(value[0]), -float(value[2]), float(value[1]))


def scale3(value):
    if not isinstance(value, (list, tuple)) or len(value) < 3:
        value = [1.0, 1.0, 1.0]
    return (float(value[0]), float(value[2]), float(value[1]))


def color4(value, fallback=(0.55, 0.58, 0.62, 1.0)):
    if isinstance(value, str) and value.startswith("#") and len(value) in (7, 9):
        try:
            return tuple(int(value[i:i + 2], 16) / 255.0 for i in (1, 3, 5)) + (1.0,)
        except ValueError:
            pass
    return fallback


def material(name, color):
    item = bpy.data.materials.new(name=name)
    item.diffuse_color = color4(color)
    item.roughness = 0.72
    return item


def add_primitive(geometry, name, location, scale, color, scene_scale=True):
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
    obj.scale = scale3(scale) if scene_scale else tuple(float(v) for v in scale)
    obj.data.materials.append(material(name + " Material", color))
    return obj


def add_mannequin(item):
    origin = vec3(item.get("position"))
    root = bpy.data.objects.new(item.get("name") or "Mannequin", None)
    root.empty_display_type = "PLAIN_AXES"
    root.location = origin
    bpy.context.collection.objects.link(root)
    skin = item.get("color") or "#9ca3af"
    pieces = [
        ("Torso", "cylinder", (0.0, 0.0, 1.15), (0.34, 0.34, 0.58)),
        ("Head", "sphere", (0.0, 0.0, 1.92), (0.25, 0.25, 0.25)),
        ("Left Arm", "cylinder", (-0.48, 0.0, 1.22), (0.10, 0.10, 0.48)),
        ("Right Arm", "cylinder", (0.48, 0.0, 1.22), (0.10, 0.10, 0.48)),
        ("Left Leg", "cylinder", (-0.18, 0.0, 0.43), (0.12, 0.12, 0.48)),
        ("Right Leg", "cylinder", (0.18, 0.0, 0.43), (0.12, 0.12, 0.48)),
    ]
    for suffix, geometry, local_position, scale in pieces:
        obj = add_primitive(geometry, root.name + " " + suffix, local_position, scale, skin, False)
        obj.parent = root
    root.rotation_euler = rotation3(item.get("rotation"))
    root.scale = scale3(item.get("scale"))
    return root


def add_light(item):
    light_type = {"directional": "SUN", "spot": "SPOT"}.get(item.get("lightType"), "POINT")
    data = bpy.data.lights.new(item.get("name") or "Light", type=light_type)
    data.energy = max(1.0, float(item.get("lightIntensity", 1.0))) * (900.0 if light_type == "POINT" else 3.0)
    data.color = color4(item.get("lightColor"), (1.0, 0.95, 0.86, 1.0))[:3]
    obj = bpy.data.objects.new(item.get("name") or "Light", data)
    obj.location = vec3(item.get("position"), (3, 4, 5))
    obj.rotation_euler = rotation3(item.get("rotation"))
    bpy.context.collection.objects.link(obj)
    return obj


def look_at(obj, target):
    direction = Vector(target) - obj.location
    if direction.length > 0.0001:
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_camera(item):
    data = bpy.data.cameras.new(item.get("name") or "Camera")
    data.angle = math.radians(max(1.0, min(179.0, float(item.get("fov", 45.0)))))
    data.clip_start = max(0.001, float(item.get("near", 0.1)))
    data.clip_end = max(data.clip_start + 1.0, float(item.get("far", 200.0)))
    obj = bpy.data.objects.new(item.get("name") or "Camera", data)
    obj.location = vec3(item.get("position"), (4, 2, 5))
    bpy.context.collection.objects.link(obj)
    target_position = vec3(item.get("target"), (0, 1, 0))
    look_at(obj, target_position)
    target = bpy.data.objects.new(obj.name + " Target", None)
    target.empty_display_type = "SPHERE"
    target.empty_display_size = 0.12
    target.location = target_position
    bpy.context.collection.objects.link(target)
    constraint = obj.constraints.new(type="TRACK_TO")
    constraint.target = target
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"
    return obj


def set_trajectory_keys(scene_data, runtime_objects, fps):
    trajectories = {item.get("id"): item for item in scene_data.get("trajectories", [])}
    for binding in scene_data.get("trajectoryBindings", []):
        trajectory = trajectories.get(binding.get("trajectoryId"))
        points = trajectory.get("points", []) if trajectory else []
        if len(points) < 2:
            continue
        if binding.get("direction") == "reverse":
            points = list(reversed(points))
        start = float(binding.get("startTime", 0.0))
        end = max(start, float(binding.get("endTime", start + 1.0)))
        for bound in binding.get("objects", []):
            obj = runtime_objects.get(bound.get("objectId"))
            if obj is None:
                continue
            for index, point in enumerate(points):
                ratio = point.get("timeRatio")
                ratio = float(ratio) if isinstance(ratio, (int, float)) else index / max(1, len(points) - 1)
                obj.location = vec3(point.get("position"))
                obj.keyframe_insert(data_path="location", frame=max(1, round((start + (end - start) * ratio) * fps) + 1))


def main():
    input_path, output_dir = args_after_separator()
    with open(input_path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    scene_data = payload.get("scene") or payload
    os.makedirs(output_dir, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    engines = {item.identifier for item in scene.bl_rna.properties["render"].fixed_type.properties["engine"].enum_items}
    if "BLENDER_EEVEE_NEXT" in engines:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    elif "BLENDER_EEVEE" in engines:
        scene.render.engine = "BLENDER_EEVEE"

    environment = scene_data.get("environment") or {}
    world = bpy.data.worlds.new("Nomi World") if bpy.data.worlds.get("Nomi World") is None else bpy.data.worlds["Nomi World"]
    scene.world = world
    world.color = color4(environment.get("backgroundColor"), (0.045, 0.055, 0.07, 1.0))[:3]

    floor = add_primitive("plane", "Nomi Floor", (0, 0, 0), (15, 15, 1), "#5f6670", False)
    floor.data.materials[0].roughness = 0.9

    runtime_objects = {}
    has_light = False
    for item in scene_data.get("objects", []):
        if item.get("visible", True) is False:
            continue
        object_type = item.get("type")
        if object_type == "light":
            obj = add_light(item)
            has_light = True
        elif object_type in ("mannequin", "mannequinCrowd"):
            obj = add_mannequin(item)
        else:
            geometry = item.get("geometry") or ("cylinder" if item.get("propKind") in ("tree", "streetlamp") else "box")
            obj = add_primitive(geometry, item.get("name") or "Scene Object", vec3(item.get("position")), item.get("scale", [1, 1, 1]), item.get("color"))
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
        fallback = {"id": "nomi-camera", "name": "Nomi Camera", "position": [6, 4, 7], "target": [0, 1, 0], "fov": 48, "aspectRatio": "16:9"}
        camera = add_camera(fallback)
        runtime_objects[fallback["id"]] = camera
        cameras.append((camera, fallback))

    scene.camera = cameras[0][0]
    fps = 24
    scene.render.fps = fps
    duration = max(1.0, float((scene_data.get("sceneTimeline") or {}).get("totalDuration", 1.0)))
    scene.frame_end = max(1, round(duration * fps))
    set_trajectory_keys(scene_data, runtime_objects, fps)

    aspect = cameras[0][1].get("aspectRatio", "16:9")
    ratios = {"16:9": (960, 540), "9:16": (540, 960), "4:3": (800, 600), "3:4": (600, 800), "1:1": (720, 720), "2.39:1": (960, 402)}
    width, height = ratios.get(aspect, (960, 540))
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.join(output_dir, "preview.png")
    scene.render.film_transparent = False
    scene.frame_set(1)
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output_dir, "scene.blend"))
    bpy.ops.export_scene.gltf(filepath=os.path.join(output_dir, "scene.glb"), export_format="GLB")
    print("NOMI_BLENDER_VERSION=" + bpy.app.version_string)


if __name__ == "__main__":
    main()
`
