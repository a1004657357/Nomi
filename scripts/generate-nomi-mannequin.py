#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0

"""Generate Nomi's first-party director mannequin and locomotion GLBs.

Run with Blender, not the system Python:

  /Applications/Blender.app/Contents/MacOS/Blender \
    --background --factory-startup \
    --python scripts/generate-nomi-mannequin.py -- \
    --output-dir /tmp/nomi-mannequin

The geometry, rig, and animation keyframes in this file are original,
programmatic project assets. Bone names retain the existing Mixamo-compatible
API spelling so saved Scene3D poses remain backward compatible; no external
mesh, rig, or animation data is imported.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


MODEL_FILE = "nomi-mannequin.glb"
ANIMATION_FILE = "nomi-mannequin-animations.glb"
FPS = 24


def blender_point(value: tuple[float, float, float]) -> tuple[float, float, float]:
    """Convert the script's glTF-style Y-up coordinates to Blender Z-up."""
    x, y, z = value
    return (x, -z, y)


def blender_scale(value: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = value
    return (x, z, y)


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args(argv)


def add_bone(
    armature_data: bpy.types.Armature,
    name: str,
    head: tuple[float, float, float],
    tail: tuple[float, float, float],
    *,
    parent: str | None = None,
    connected: bool = False,
    roll: float = 0,
) -> bpy.types.EditBone:
    bone = armature_data.edit_bones.new(name)
    bone.head = blender_point(head)
    bone.tail = blender_point(tail)
    bone.roll = roll
    if parent:
        bone.parent = armature_data.edit_bones[parent]
        bone.use_connect = connected
    return bone


def create_armature() -> bpy.types.Object:
    armature_data = bpy.data.armatures.new("NomiDirectorRig")
    armature = bpy.data.objects.new("NomiDirectorRig", armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    add_bone(armature_data, "mixamorigHips", (0, 0.92, 0), (0, 1.02, 0))
    add_bone(
        armature_data,
        "mixamorigSpine",
        (0, 1.02, 0),
        (0, 1.18, 0),
        parent="mixamorigHips",
        connected=True,
    )
    add_bone(
        armature_data,
        "mixamorigSpine1",
        (0, 1.18, 0),
        (0, 1.34, 0),
        parent="mixamorigSpine",
        connected=True,
    )
    add_bone(
        armature_data,
        "mixamorigSpine2",
        (0, 1.34, 0),
        (0, 1.48, 0),
        parent="mixamorigSpine1",
        connected=True,
    )
    add_bone(
        armature_data,
        "mixamorigNeck",
        (0, 1.48, 0),
        (0, 1.57, 0.02),
        parent="mixamorigSpine2",
        connected=True,
    )
    add_bone(
        armature_data,
        "mixamorigHead",
        (0, 1.57, 0.02),
        (0, 1.73, 0.06),
        parent="mixamorigNeck",
        connected=True,
    )
    add_bone(
        armature_data,
        "mixamorigHeadTop_End",
        (0, 1.73, 0.06),
        (0, 1.84, 0.09),
        parent="mixamorigHead",
        connected=True,
    )

    for side, sign in (("Left", 1), ("Right", -1)):
        shoulder = f"mixamorig{side}Shoulder"
        arm = f"mixamorig{side}Arm"
        forearm = f"mixamorig{side}ForeArm"
        hand = f"mixamorig{side}Hand"
        middle = f"mixamorig{side}HandMiddle1"
        add_bone(
            armature_data,
            shoulder,
            (0, 1.45, 0),
            (0.16 * sign, 1.45, 0),
            parent="mixamorigSpine2",
            roll=math.pi,
        )
        add_bone(
            armature_data,
            arm,
            (0.16 * sign, 1.45, 0),
            (0.45 * sign, 1.45, 0),
            parent=shoulder,
            connected=True,
            roll=math.pi,
        )
        add_bone(
            armature_data,
            forearm,
            (0.45 * sign, 1.45, 0),
            (0.72 * sign, 1.45, 0),
            parent=arm,
            connected=True,
            roll=math.pi,
        )
        add_bone(
            armature_data,
            hand,
            (0.72 * sign, 1.45, 0),
            (0.84 * sign, 1.45, 0),
            parent=forearm,
            connected=True,
            roll=math.pi,
        )
        add_bone(
            armature_data,
            middle,
            (0.84 * sign, 1.45, 0),
            (0.94 * sign, 1.45, 0),
            parent=hand,
            connected=True,
            roll=math.pi,
        )

        upper_leg = f"mixamorig{side}UpLeg"
        leg = f"mixamorig{side}Leg"
        foot = f"mixamorig{side}Foot"
        toe = f"mixamorig{side}ToeBase"
        toe_end = f"mixamorig{side}Toe_End"
        hip_x = 0.105 * sign
        add_bone(
            armature_data,
            upper_leg,
            (hip_x, 0.94, 0),
            (hip_x, 0.53, 0),
            parent="mixamorigHips",
            roll=math.pi,
        )
        add_bone(
            armature_data,
            leg,
            (hip_x, 0.53, 0),
            (hip_x, 0.12, 0),
            parent=upper_leg,
            connected=True,
            roll=math.pi,
        )
        add_bone(
            armature_data,
            foot,
            (hip_x, 0.12, 0),
            (hip_x, 0.04, 0.115),
            parent=leg,
            connected=True,
            roll=math.pi,
        )
        add_bone(
            armature_data,
            toe,
            (hip_x, 0.04, 0.115),
            (hip_x, 0.04, 0.28),
            parent=foot,
            connected=True,
            roll=math.pi,
        )
        add_bone(
            armature_data,
            toe_end,
            (hip_x, 0.04, 0.28),
            (hip_x, 0.04, 0.34),
            parent=toe,
            connected=True,
            roll=math.pi,
        )

    bpy.ops.object.mode_set(mode="OBJECT")
    armature["nomiAssetOrigin"] = "Self-authored procedural Nomi director mannequin"
    armature["nomiAssetLicense"] = "Apache-2.0"
    armature["nomiRigCompatibility"] = "mixamorig bone-name API only"
    return armature


def assign_rigid_weight(obj: bpy.types.Object, bone_name: str) -> None:
    group = obj.vertex_groups.new(name=bone_name)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")


def apply_object_transform(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)


def add_sphere(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    bone_name: str,
    material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=16,
        ring_count=10,
        location=blender_point(location),
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = blender_scale(scale)
    obj.data.materials.append(material)
    apply_object_transform(obj)
    assign_rigid_weight(obj, bone_name)
    return obj


def add_boot(
    name: str,
    center_x: float,
    foot_bone_name: str,
    toe_bone_name: str,
    material: bpy.types.Material,
) -> bpy.types.Object:
    half_width = 0.055
    bottom_y = 0.02
    rings = [
        (-0.08, 0.115, (1.0, 0.0)),
        (0.075, 0.10, (0.8, 0.2)),
        (0.15, 0.078, (0.2, 0.8)),
        (0.30, 0.062, (0.0, 1.0)),
    ]
    vertices: list[tuple[float, float, float]] = []
    weights: list[tuple[float, float]] = []
    for z, top_y, ring_weights in rings:
        vertices.extend(
            [
                (center_x - half_width, bottom_y, z),
                (center_x + half_width, bottom_y, z),
                (center_x + half_width, top_y, z),
                (center_x - half_width, top_y, z),
            ]
        )
        weights.extend([ring_weights] * 4)

    faces: list[tuple[int, ...]] = [(0, 3, 2, 1)]
    for ring_index in range(len(rings) - 1):
        start = ring_index * 4
        next_start = start + 4
        faces.extend(
            [
                (start, start + 1, next_start + 1, next_start),
                (start + 3, next_start + 3, next_start + 2, start + 2),
                (start, next_start, next_start + 3, start + 3),
                (start + 1, start + 2, next_start + 2, next_start + 1),
            ]
        )
    last = (len(rings) - 1) * 4
    faces.append((last, last + 1, last + 2, last + 3))

    mesh_data = bpy.data.meshes.new(f"{name}Mesh")
    mesh_data.from_pydata([blender_point(vertex) for vertex in vertices], [], faces)
    mesh_data.update()
    obj = bpy.data.objects.new(name, mesh_data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)

    foot_group = obj.vertex_groups.new(name=foot_bone_name)
    toe_group = obj.vertex_groups.new(name=toe_bone_name)
    for index, (foot_weight, toe_weight) in enumerate(weights):
        if foot_weight > 0:
            foot_group.add([index], foot_weight, "REPLACE")
        if toe_weight > 0:
            toe_group.add([index], toe_weight, "REPLACE")
    return obj


def add_glove(
    name: str,
    side_sign: int,
    forearm_bone_name: str,
    hand_bone_name: str,
    finger_bone_name: str,
    material: bpy.types.Material,
) -> bpy.types.Object:
    center_y = 1.45
    rings = [
        (0.69, 0.030, 0.030, (1.0, 0.0, 0.0)),
        (0.74, 0.030, 0.030, (0.35, 0.65, 0.0)),
        (0.84, 0.032, 0.034, (0.0, 0.8, 0.2)),
        (0.93, 0.024, 0.026, (0.0, 0.0, 1.0)),
    ]
    vertices: list[tuple[float, float, float]] = []
    weights: list[tuple[float, float, float]] = []
    for distance, half_height, half_depth, ring_weights in rings:
        x = distance * side_sign
        vertices.extend(
            [
                (x, center_y - half_height, -half_depth),
                (x, center_y - half_height, half_depth),
                (x, center_y + half_height, half_depth),
                (x, center_y + half_height, -half_depth),
            ]
        )
        weights.extend([ring_weights] * 4)

    faces: list[tuple[int, ...]] = [(0, 1, 2, 3)]
    for ring_index in range(len(rings) - 1):
        start = ring_index * 4
        next_start = start + 4
        faces.extend(
            [
                (start, next_start, next_start + 1, start + 1),
                (start + 3, start + 2, next_start + 2, next_start + 3),
                (start, start + 3, next_start + 3, next_start),
                (start + 1, next_start + 1, next_start + 2, start + 2),
            ]
        )
    last = (len(rings) - 1) * 4
    faces.append((last, last + 3, last + 2, last + 1))
    if side_sign < 0:
        faces = [tuple(reversed(face)) for face in faces]

    mesh_data = bpy.data.meshes.new(f"{name}Mesh")
    mesh_data.from_pydata([blender_point(vertex) for vertex in vertices], [], faces)
    mesh_data.update()
    obj = bpy.data.objects.new(name, mesh_data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)

    forearm_group = obj.vertex_groups.new(name=forearm_bone_name)
    hand_group = obj.vertex_groups.new(name=hand_bone_name)
    finger_group = obj.vertex_groups.new(name=finger_bone_name)
    for index, (forearm_weight, hand_weight, finger_weight) in enumerate(weights):
        if forearm_weight > 0:
            forearm_group.add([index], forearm_weight, "REPLACE")
        if hand_weight > 0:
            hand_group.add([index], hand_weight, "REPLACE")
        if finger_weight > 0:
            finger_group.add([index], finger_weight, "REPLACE")
    return obj


def add_segment(
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    radius_start: float,
    radius_end: float,
    bone_name: str,
    material: bpy.types.Material,
) -> bpy.types.Object:
    start_vector = Vector(blender_point(start))
    end_vector = Vector(blender_point(end))
    direction = end_vector - start_vector
    bpy.ops.mesh.primitive_cone_add(
        vertices=12,
        radius1=radius_start,
        radius2=radius_end,
        depth=direction.length,
        location=(start_vector + end_vector) * 0.5,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    obj.data.materials.append(material)
    apply_object_transform(obj)
    assign_rigid_weight(obj, bone_name)
    return obj


def create_mesh(armature: bpy.types.Object) -> bpy.types.Object:
    material = bpy.data.materials.new("NomiMannequinGray")
    material.diffuse_color = (0.47, 0.52, 0.58, 1)
    material.roughness = 0.72
    parts: list[bpy.types.Object] = []

    parts.extend(
        [
            add_sphere("Pelvis", (0, 0.98, 0), (0.16, 0.12, 0.12), "mixamorigHips", material),
            add_segment("Abdomen", (0, 1.02, 0), (0, 1.18, 0), 0.11, 0.13, "mixamorigSpine", material),
            add_segment("Torso", (0, 1.18, 0), (0, 1.43, 0), 0.13, 0.18, "mixamorigSpine1", material),
            add_segment("UpperTorso", (0, 1.34, 0), (0, 1.49, 0), 0.18, 0.14, "mixamorigSpine2", material),
            add_segment("Neck", (0, 1.48, 0), (0, 1.58, 0), 0.065, 0.06, "mixamorigNeck", material),
            add_sphere("Head", (0, 1.69, -0.005), (0.115, 0.145, 0.11), "mixamorigHead", material),
        ]
    )

    for side, sign in (("Left", 1), ("Right", -1)):
        parts.extend(
            [
                add_sphere(
                    f"{side}ShoulderJoint",
                    (0.17 * sign, 1.45, 0),
                    (0.075, 0.075, 0.075),
                    f"mixamorig{side}Shoulder",
                    material,
                ),
                add_segment(
                    f"{side}UpperArm",
                    (0.18 * sign, 1.45, 0),
                    (0.45 * sign, 1.45, 0),
                    0.07,
                    0.06,
                    f"mixamorig{side}Arm",
                    material,
                ),
                add_segment(
                    f"{side}ForeArm",
                    (0.45 * sign, 1.45, 0),
                    (0.72 * sign, 1.45, 0),
                    0.05,
                    0.04,
                    f"mixamorig{side}ForeArm",
                    material,
                ),
                add_glove(
                    f"{side}Glove",
                    sign,
                    f"mixamorig{side}ForeArm",
                    f"mixamorig{side}Hand",
                    f"mixamorig{side}HandMiddle1",
                    material,
                ),
                add_segment(
                    f"{side}Thigh",
                    (0.105 * sign, 0.91, 0),
                    (0.105 * sign, 0.53, 0),
                    0.095,
                    0.075,
                    f"mixamorig{side}UpLeg",
                    material,
                ),
                add_segment(
                    f"{side}Shin",
                    (0.105 * sign, 0.53, 0),
                    (0.105 * sign, 0.12, 0),
                    0.072,
                    0.052,
                    f"mixamorig{side}Leg",
                    material,
                ),
                add_boot(
                    f"{side}Boot",
                    0.105 * sign,
                    f"mixamorig{side}Foot",
                    f"mixamorig{side}ToeBase",
                    material,
                ),
            ]
        )

    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    mesh = bpy.context.object
    mesh.name = "NomiMannequinMesh"
    modifier = mesh.modifiers.new("NomiDirectorRig", "ARMATURE")
    modifier.object = armature
    mesh.parent = armature
    mesh["nomiAssetOrigin"] = "Generated by scripts/generate-nomi-mannequin.py"
    return mesh


def reset_pose(armature: bpy.types.Object) -> None:
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler = (0, 0, 0)
        pose_bone.location = (0, 0, 0)
        pose_bone.scale = (1, 1, 1)


def key_pose(
    armature: bpy.types.Object,
    frame: int,
    rotations: dict[str, tuple[float, float, float]],
    *,
    hip_bob: float = 0,
) -> None:
    reset_pose(armature)
    for bone_name, degrees in rotations.items():
        pose_bone = armature.pose.bones.get(bone_name)
        if not pose_bone:
            raise RuntimeError(f"Unknown animation bone: {bone_name}")
        pose_bone.rotation_euler = tuple(math.radians(value) for value in degrees)
        pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
    hips = armature.pose.bones["mixamorigHips"]
    hips.location.y = hip_bob
    hips.keyframe_insert(data_path="location", frame=frame, group="mixamorigHips")


def create_action(
    armature: bpy.types.Object,
    name: str,
    frames: list[tuple[int, dict[str, tuple[float, float, float]], float]],
) -> bpy.types.Action:
    action = bpy.data.actions.new(name=name)
    action.use_fake_user = True
    armature.animation_data_create()
    armature.animation_data.action = action
    for frame, rotations, hip_bob in frames:
        key_pose(armature, frame, rotations, hip_bob=hip_bob)
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
    armature.animation_data.action = None
    return action


def create_actions(armature: bpy.types.Object) -> None:
    walk_a = {
        "mixamorigLeftUpLeg": (-26, 0, 0),
        "mixamorigRightUpLeg": (26, 0, 0),
        "mixamorigLeftLeg": (8, 0, 0),
        "mixamorigRightLeg": (34, 0, 0),
        "mixamorigLeftFoot": (8, 0, 0),
        "mixamorigRightFoot": (-12, 0, 0),
        "mixamorigSpine1": (0, 4, 0),
    }
    walk_b = {
        "mixamorigLeftUpLeg": (26, 0, 0),
        "mixamorigRightUpLeg": (-26, 0, 0),
        "mixamorigLeftLeg": (34, 0, 0),
        "mixamorigRightLeg": (8, 0, 0),
        "mixamorigLeftFoot": (-12, 0, 0),
        "mixamorigRightFoot": (8, 0, 0),
        "mixamorigSpine1": (0, -4, 0),
    }
    neutral = {
        "mixamorigLeftUpLeg": (0, 0, 0),
        "mixamorigRightUpLeg": (0, 0, 0),
        "mixamorigLeftLeg": (12, 0, 0),
        "mixamorigRightLeg": (12, 0, 0),
        "mixamorigLeftFoot": (-4, 0, 0),
        "mixamorigRightFoot": (-4, 0, 0),
        "mixamorigSpine1": (0, 0, 0),
    }
    create_action(
        armature,
        "walk",
        [
            (1, walk_a, 0),
            (7, neutral, 0.018),
            (13, walk_b, 0),
            (19, neutral, 0.018),
            (25, walk_a, 0),
        ],
    )

    run_a = {
        "mixamorigLeftUpLeg": (-44, 0, 0),
        "mixamorigRightUpLeg": (35, 0, 0),
        "mixamorigLeftLeg": (18, 0, 0),
        "mixamorigRightLeg": (62, 0, 0),
        "mixamorigLeftFoot": (10, 0, 0),
        "mixamorigRightFoot": (-20, 0, 0),
        "mixamorigSpine": (8, 0, 0),
    }
    run_b = {
        "mixamorigLeftUpLeg": (35, 0, 0),
        "mixamorigRightUpLeg": (-44, 0, 0),
        "mixamorigLeftLeg": (62, 0, 0),
        "mixamorigRightLeg": (18, 0, 0),
        "mixamorigLeftFoot": (-20, 0, 0),
        "mixamorigRightFoot": (10, 0, 0),
        "mixamorigSpine": (8, 0, 0),
    }
    run_neutral = {
        "mixamorigLeftUpLeg": (2, 0, 0),
        "mixamorigRightUpLeg": (2, 0, 0),
        "mixamorigLeftLeg": (42, 0, 0),
        "mixamorigRightLeg": (42, 0, 0),
        "mixamorigLeftFoot": (-10, 0, 0),
        "mixamorigRightFoot": (-10, 0, 0),
        "mixamorigSpine": (10, 0, 0),
    }
    create_action(
        armature,
        "run",
        [
            (1, run_a, 0),
            (5, run_neutral, 0.045),
            (9, run_b, 0),
            (13, run_neutral, 0.045),
            (17, run_a, 0),
        ],
    )


def select_export_objects(armature: bpy.types.Object, mesh: bpy.types.Object) -> None:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature


def export_glb(
    output_path: Path,
    armature: bpy.types.Object,
    mesh: bpy.types.Object,
    *,
    animations: bool,
) -> None:
    select_export_objects(armature, mesh)
    bpy.context.scene.render.fps = FPS
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_animations=animations,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_range=False,
        export_def_bones=True,
        export_skins=True,
        export_materials="EXPORT",
        export_extras=True,
        export_yup=True,
        export_apply=False,
    )


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    armature = create_armature()
    mesh = create_mesh(armature)
    export_glb(output_dir / MODEL_FILE, armature, mesh, animations=False)

    create_actions(armature)
    export_glb(output_dir / ANIMATION_FILE, armature, mesh, animations=True)

    for path in (output_dir / MODEL_FILE, output_dir / ANIMATION_FILE):
        if not path.exists() or path.stat().st_size < 1_000:
            raise RuntimeError(f"Failed to generate {path}")
        print(f"generated {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
