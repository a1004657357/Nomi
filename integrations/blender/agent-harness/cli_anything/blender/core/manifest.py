from __future__ import annotations

import copy
import json
import math
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


JsonObject = dict[str, Any]

SCHEMA_VERSION = 1
MAX_HISTORY_ENTRIES = 30
ASPECT_RATIOS = {"16:9", "9:16", "4:3", "3:4", "1:1", "2.39:1"}
OBJECT_TYPES = {"mesh", "model", "light", "group", "mannequin", "mannequinCrowd", "prop"}
GEOMETRIES = {"box", "sphere", "cylinder", "plane"}
PROP_KINDS = {"car", "building", "tree", "streetlamp", "wall"}
LIGHT_TYPES = {"point", "directional", "spot"}
STAGE_PRESETS = {"empty", "studio", "coffee_shop", "city_street", "interior_room"}


class ManifestValidationError(ValueError):
    """Raised when data is outside the director-manifest contract."""


def _record(value: object, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ManifestValidationError(f"{field} 必须是对象")
    return value


def _string(value: object, field: str, default: str = "", max_length: int = 256) -> str:
    if value is None:
        return default
    if not isinstance(value, str):
        raise ManifestValidationError(f"{field} 必须是字符串")
    output = value.strip()
    if not output:
        return default
    if "\x00" in output or len(output) > max_length:
        raise ManifestValidationError(f"{field} 长度或字符无效")
    return output


def _number(
    value: object,
    field: str,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ManifestValidationError(f"{field} 必须是有限数字")
    output = float(value)
    if output < minimum or output > maximum:
        raise ManifestValidationError(f"{field} 必须在 {minimum} 到 {maximum} 之间")
    return output


def _vector(value: object, field: str, default: Sequence[float], minimum: float = -10000, maximum: float = 10000) -> list[float]:
    if value is None:
        return [float(item) for item in default]
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)) or len(value) != 3:
        raise ManifestValidationError(f"{field} 必须是三个数字组成的向量")
    return [_number(item, f"{field}[{index}]", 0, minimum, maximum) for index, item in enumerate(value)]


def _color(value: object, field: str, default: str) -> str:
    output = _string(value, field, default, max_length=7)
    if len(output) != 7 or not output.startswith("#") or any(char not in "0123456789abcdefABCDEF" for char in output[1:]):
        raise ManifestValidationError(f"{field} 必须是 #RRGGBB")
    return output.lower()


def _id(value: object, field: str, default: str) -> str:
    output = _string(value, field, default, max_length=128)
    if not output:
        raise ManifestValidationError(f"{field} 不能为空")
    return output


def _default_camera(aspect_ratio: str = "16:9") -> JsonObject:
    return {
        "id": "director-camera",
        "name": "导演相机",
        "visible": True,
        "position": [4.0, 2.4, 5.0],
        "rotation": [-0.36, 0.68, 0.0],
        "target": [0.0, 0.8, 0.0],
        "fov": 45.0,
        "aspectRatio": aspect_ratio,
        "lensDepth": 0.0,
        "near": 0.1,
        "far": 200.0,
    }


def default_scene(aspect_ratio: str = "16:9", duration_seconds: float = 10) -> JsonObject:
    if aspect_ratio not in ASPECT_RATIOS:
        raise ManifestValidationError("aspectRatio 不受支持")
    duration = _number(duration_seconds, "durationSeconds", 10, 0.1, 600)
    return {
        "objects": [
            {
                "id": "director-subject",
                "name": "主体",
                "type": "mannequin",
                "visible": True,
                "position": [0.0, 1.25, 0.0],
                "rotation": [0.0, 0.0, 0.0],
                "scale": [2.5, 2.5, 2.5],
                "color": "#ef4444",
                "geometry": "box",
            }
        ],
        "cameras": [_default_camera(aspect_ratio)],
        "trajectories": [],
        "trajectoryBindings": [],
        "trajectoryGroups": [],
        "sceneTimeline": {"totalDuration": duration},
        "environment": {
            "preset": "city",
            "showGrid": True,
            "showAxes": True,
            "showSky": False,
            "darkMode": False,
            "backgroundColor": "#f6f3ee",
            "panoramaRotation": 0.0,
            "environmentMode": "panorama",
            "sphereRadius": 50.0,
        },
        "editorCamera": {
            "position": [-5.0, 3.2, 6.0],
            "target": [0.0, 0.75, 0.0],
            "rotation": [0.0, 0.0, 0.0],
            "mode": "edit",
        },
    }


def _normalize_object(value: object, index: int) -> JsonObject:
    raw = _record(value, f"scene.objects[{index}]")
    object_type = _string(raw.get("type"), f"scene.objects[{index}].type", "mesh")
    if object_type not in OBJECT_TYPES:
        raise ManifestValidationError(f"scene.objects[{index}].type 不受支持")
    geometry = _string(raw.get("geometry"), f"scene.objects[{index}].geometry", "box")
    if geometry not in GEOMETRIES:
        raise ManifestValidationError(f"scene.objects[{index}].geometry 不受支持")
    prop_kind = _string(raw.get("propKind"), f"scene.objects[{index}].propKind", "")
    if object_type == "prop" and prop_kind not in PROP_KINDS:
        raise ManifestValidationError(f"scene.objects[{index}].propKind 不受支持")
    scale = _vector(raw.get("scale"), f"scene.objects[{index}].scale", [1, 1, 1], 0.01, 1000)
    light_type = _string(raw.get("lightType"), f"scene.objects[{index}].lightType", "point")
    if light_type not in LIGHT_TYPES:
        raise ManifestValidationError(f"scene.objects[{index}].lightType 不受支持")
    return {
        "id": _id(raw.get("id"), f"scene.objects[{index}].id", f"director-object-{index + 1}"),
        "name": _string(raw.get("name"), f"scene.objects[{index}].name", f"对象{index + 1}"),
        "type": object_type,
        "visible": raw.get("visible") is not False,
        "position": _vector(raw.get("position"), f"scene.objects[{index}].position", [0, 0.5, 0]),
        "rotation": _vector(raw.get("rotation"), f"scene.objects[{index}].rotation", [0, 0, 0]),
        "scale": scale,
        "color": _color(raw.get("color"), f"scene.objects[{index}].color", "#808080"),
        "geometry": geometry,
        **({"propKind": prop_kind} if object_type == "prop" else {}),
        "lightType": light_type,
        "lightColor": _color(raw.get("lightColor"), f"scene.objects[{index}].lightColor", "#ffffff"),
        "lightIntensity": _number(raw.get("lightIntensity"), f"scene.objects[{index}].lightIntensity", 2, 0, 10000),
    }


def _normalize_camera(value: object, index: int) -> JsonObject:
    raw = _record(value, f"scene.cameras[{index}]")
    aspect_ratio = _string(raw.get("aspectRatio"), f"scene.cameras[{index}].aspectRatio", "16:9")
    if aspect_ratio not in ASPECT_RATIOS:
        raise ManifestValidationError(f"scene.cameras[{index}].aspectRatio 不受支持")
    near = _number(raw.get("near"), f"scene.cameras[{index}].near", 0.1, 0.01, 1000)
    far = _number(raw.get("far"), f"scene.cameras[{index}].far", 200, near + 0.01, 100000)
    return {
        "id": _id(raw.get("id"), f"scene.cameras[{index}].id", f"director-camera-{index + 1}"),
        "name": _string(raw.get("name"), f"scene.cameras[{index}].name", f"相机{index + 1}"),
        "visible": raw.get("visible") is not False,
        "position": _vector(raw.get("position"), f"scene.cameras[{index}].position", [4, 2.4, 5]),
        "rotation": _vector(raw.get("rotation"), f"scene.cameras[{index}].rotation", [-0.36, 0.68, 0]),
        "target": _vector(raw.get("target"), f"scene.cameras[{index}].target", [0, 0.8, 0]),
        "fov": _number(raw.get("fov"), f"scene.cameras[{index}].fov", 45, 6, 120),
        "aspectRatio": aspect_ratio,
        "lensDepth": _number(raw.get("lensDepth"), f"scene.cameras[{index}].lensDepth", 0, -100, 100),
        "near": near,
        "far": far,
        "shakeAmplitude": _number(raw.get("shakeAmplitude"), f"scene.cameras[{index}].shakeAmplitude", 0, 0, 100),
    }


def _normalize_trajectory(value: object, index: int) -> JsonObject:
    raw = _record(value, f"scene.trajectories[{index}]")
    raw_points = raw.get("points", [])
    if not isinstance(raw_points, list):
        raise ManifestValidationError(f"scene.trajectories[{index}].points 必须是数组")
    points: list[JsonObject] = []
    for point_index, point_value in enumerate(raw_points):
        point = _record(point_value, f"scene.trajectories[{index}].points[{point_index}]")
        points.append(
            {
                "id": _id(point.get("id"), f"scene.trajectories[{index}].points[{point_index}].id", f"trajectory-{index + 1}-point-{point_index + 1}"),
                "position": _vector(point.get("position"), f"scene.trajectories[{index}].points[{point_index}].position", [0, 0, 0]),
                "timeRatio": _number(point.get("timeRatio"), f"scene.trajectories[{index}].points[{point_index}].timeRatio", point_index / max(1, len(raw_points) - 1), 0, 1),
            }
        )
    return {
        "id": _id(raw.get("id"), f"scene.trajectories[{index}].id", f"director-trajectory-{index + 1}"),
        "name": _string(raw.get("name"), f"scene.trajectories[{index}].name", f"轨迹{index + 1}"),
        "points": points,
        "tension": _number(raw.get("tension"), f"scene.trajectories[{index}].tension", 0.5, 0, 1),
        "closed": raw.get("closed") is True,
        "color": _color(raw.get("color"), f"scene.trajectories[{index}].color", "#ef4444"),
    }


def _normalize_binding(value: object, index: int, trajectory_ids: set[str], object_ids: set[str]) -> JsonObject:
    raw = _record(value, f"scene.trajectoryBindings[{index}]")
    trajectory_id = _id(raw.get("trajectoryId"), f"scene.trajectoryBindings[{index}].trajectoryId", "")
    if trajectory_id not in trajectory_ids:
        raise ManifestValidationError(f"scene.trajectoryBindings[{index}].trajectoryId 不存在")
    raw_objects = raw.get("objects", [])
    if not isinstance(raw_objects, list) or not raw_objects:
        raise ManifestValidationError(f"scene.trajectoryBindings[{index}].objects 不能为空")
    objects: list[JsonObject] = []
    for object_index, object_value in enumerate(raw_objects):
        item = _record(object_value, f"scene.trajectoryBindings[{index}].objects[{object_index}]")
        object_id = _id(item.get("objectId"), f"scene.trajectoryBindings[{index}].objects[{object_index}].objectId", "")
        if object_id not in object_ids:
            raise ManifestValidationError(f"scene.trajectoryBindings[{index}].objects[{object_index}].objectId 不存在")
        objects.append({"objectId": object_id, "offsetRatio": _number(item.get("offsetRatio"), f"scene.trajectoryBindings[{index}].objects[{object_index}].offsetRatio", 0, -1, 1)})
    start = _number(raw.get("startTime"), f"scene.trajectoryBindings[{index}].startTime", 0, 0, 600)
    end = _number(raw.get("endTime"), f"scene.trajectoryBindings[{index}].endTime", max(1, start + 1), start + 0.01, 600)
    direction = _string(raw.get("direction"), f"scene.trajectoryBindings[{index}].direction", "forward")
    if direction not in {"forward", "reverse"}:
        raise ManifestValidationError(f"scene.trajectoryBindings[{index}].direction 不受支持")
    return {
        "id": _id(raw.get("id"), f"scene.trajectoryBindings[{index}].id", f"director-binding-{index + 1}"),
        "trajectoryId": trajectory_id,
        "objects": objects,
        "startTime": start,
        "endTime": end,
        "direction": direction,
        **({"fovFrom": _number(raw.get("fovFrom"), f"scene.trajectoryBindings[{index}].fovFrom", 45, 6, 120)} if raw.get("fovFrom") is not None else {}),
        **({"fovTo": _number(raw.get("fovTo"), f"scene.trajectoryBindings[{index}].fovTo", 45, 6, 120)} if raw.get("fovTo") is not None else {}),
    }


def normalize_scene(value: object) -> JsonObject:
    raw = _record(value, "scene")
    base = default_scene()
    raw_objects = raw.get("objects", base["objects"])
    raw_cameras = raw.get("cameras", base["cameras"])
    raw_trajectories = raw.get("trajectories", [])
    raw_bindings = raw.get("trajectoryBindings", [])
    if not isinstance(raw_objects, list) or not isinstance(raw_cameras, list):
        raise ManifestValidationError("scene.objects 和 scene.cameras 必须是数组")
    if not isinstance(raw_trajectories, list) or not isinstance(raw_bindings, list):
        raise ManifestValidationError("scene.trajectories 和 scene.trajectoryBindings 必须是数组")
    objects = [_normalize_object(item, index) for index, item in enumerate(raw_objects)]
    cameras = [_normalize_camera(item, index) for index, item in enumerate(raw_cameras)]
    trajectories = [_normalize_trajectory(item, index) for index, item in enumerate(raw_trajectories)]
    all_ids = [item["id"] for item in objects] + [item["id"] for item in cameras]
    if len(all_ids) != len(set(all_ids)):
        raise ManifestValidationError("scene 中的对象和相机 id 必须唯一")
    trajectory_ids = {item["id"] for item in trajectories}
    if len(trajectory_ids) != len(trajectories):
        raise ManifestValidationError("scene.trajectories id 必须唯一")
    bindings = [_normalize_binding(item, index, trajectory_ids, set(all_ids)) for index, item in enumerate(raw_bindings)]
    timeline = _record(raw.get("sceneTimeline", base["sceneTimeline"]), "scene.sceneTimeline")
    environment = _record(raw.get("environment", base["environment"]), "scene.environment")
    editor_camera = _record(raw.get("editorCamera", base["editorCamera"]), "scene.editorCamera")
    return {
        "objects": objects,
        "cameras": cameras,
        "trajectories": trajectories,
        "trajectoryBindings": bindings,
        "trajectoryGroups": [],
        "sceneTimeline": {"totalDuration": _number(timeline.get("totalDuration"), "scene.sceneTimeline.totalDuration", 10, 0.1, 600)},
        "environment": {
            "preset": _string(environment.get("preset"), "scene.environment.preset", "city"),
            "showGrid": environment.get("showGrid") is not False,
            "showAxes": environment.get("showAxes") is not False,
            "showSky": environment.get("showSky") is True,
            "darkMode": environment.get("darkMode") is True,
            "backgroundColor": _color(environment.get("backgroundColor"), "scene.environment.backgroundColor", "#f6f3ee"),
            "panoramaRotation": _number(environment.get("panoramaRotation"), "scene.environment.panoramaRotation", 0, -360, 360),
            "environmentMode": "sphere" if environment.get("environmentMode") == "sphere" else "panorama",
            "sphereRadius": _number(environment.get("sphereRadius"), "scene.environment.sphereRadius", 50, 1, 10000),
        },
        "editorCamera": {
            "position": _vector(editor_camera.get("position"), "scene.editorCamera.position", [-5, 3.2, 6]),
            "target": _vector(editor_camera.get("target"), "scene.editorCamera.target", [0, 0.75, 0]),
            "rotation": _vector(editor_camera.get("rotation"), "scene.editorCamera.rotation", [0, 0, 0]),
            "mode": "fly" if editor_camera.get("mode") == "fly" else "edit",
        },
    }


def normalize_manifest(value: object) -> JsonObject:
    raw = _record(value, "manifest")
    schema_version = raw.get("schemaVersion", SCHEMA_VERSION)
    if schema_version != SCHEMA_VERSION:
        raise ManifestValidationError(f"不支持的 manifest 版本: {schema_version}")
    stage = _record(raw.get("stage", {"preset": "empty"}), "stage")
    preset = _string(stage.get("preset"), "stage.preset", "empty")
    if preset not in STAGE_PRESETS:
        raise ManifestValidationError("stage.preset 不受支持")
    revision = _number(raw.get("revision"), "revision", 0, 0, 1_000_000)
    if not revision.is_integer():
        raise ManifestValidationError("revision 必须是整数")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "revision": int(revision),
        "title": _string(raw.get("title"), "title", "未命名导演草图"),
        "stage": {"preset": preset},
        "scene": normalize_scene(raw.get("scene", default_scene())),
    }


def _write_json_atomic(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


class DirectorManifestStore:
    """Atomic, project-scoped manifest storage with bounded undo/redo snapshots."""

    def __init__(self, project_dir: str | os.PathLike[str]):
        self.project_dir = Path(project_dir).expanduser().resolve()
        self.state_dir = self.project_dir / ".nomi-director"
        self.manifest_path = self.state_dir / "director-manifest.json"
        self.history_path = self.state_dir / "history.json"
        self.exports_dir = self.state_dir / "exports"
        self.latest_export_path = self.exports_dir / "latest.json"

    def initialize(self, title: str = "未命名导演草图", aspect_ratio: str = "16:9", duration_seconds: float = 10) -> JsonObject:
        manifest = normalize_manifest(
            {
                "schemaVersion": SCHEMA_VERSION,
                "revision": 0,
                "title": title,
                "stage": {"preset": "empty"},
                "scene": default_scene(aspect_ratio, duration_seconds),
            }
        )
        _write_json_atomic(self.manifest_path, manifest)
        _write_json_atomic(self.history_path, {"schemaVersion": SCHEMA_VERSION, "undo": [], "redo": []})
        return manifest

    def load(self) -> JsonObject:
        if not self.manifest_path.is_file():
            return self.initialize()
        try:
            raw = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ManifestValidationError(f"无法读取导演 manifest: {error}") from error
        return normalize_manifest(raw)

    def _load_history(self) -> JsonObject:
        if not self.history_path.is_file():
            return {"schemaVersion": SCHEMA_VERSION, "undo": [], "redo": []}
        try:
            raw = json.loads(self.history_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ManifestValidationError(f"无法读取导演历史: {error}") from error
        if not isinstance(raw, Mapping) or not isinstance(raw.get("undo"), list) or not isinstance(raw.get("redo"), list):
            raise ManifestValidationError("导演历史格式无效")
        return {"schemaVersion": SCHEMA_VERSION, "undo": raw["undo"][-MAX_HISTORY_ENTRIES:], "redo": raw["redo"][-MAX_HISTORY_ENTRIES:]}

    def _mutate(self, mutation: Callable[[JsonObject], None]) -> JsonObject:
        current = self.load()
        candidate = copy.deepcopy(current)
        mutation(candidate)
        candidate["revision"] = current["revision"] + 1
        normalized = normalize_manifest(candidate)
        history = self._load_history()
        history["undo"] = (history["undo"] + [current])[-MAX_HISTORY_ENTRIES:]
        history["redo"] = []
        _write_json_atomic(self.manifest_path, normalized)
        _write_json_atomic(self.history_path, history)
        return normalized

    def replace_scene(self, scene: object, title: str | None = None) -> JsonObject:
        normalized_scene = normalize_scene(scene)

        def mutation(manifest: JsonObject) -> None:
            manifest["scene"] = normalized_scene
            if title is not None:
                manifest["title"] = title

        return self._mutate(mutation)

    def set_stage(self, preset: str) -> JsonObject:
        if preset not in STAGE_PRESETS:
            raise ManifestValidationError(f"stage preset 不受支持: {preset}")
        return self._mutate(lambda manifest: manifest.__setitem__("stage", {"preset": preset}))

    def set_camera(self, position: object, target: object, fov: object, aspect_ratio: str) -> JsonObject:
        if aspect_ratio not in ASPECT_RATIOS:
            raise ManifestValidationError(f"aspectRatio 不受支持: {aspect_ratio}")
        normalized_position = _vector(position, "camera.position", [4, 2.4, 5])
        normalized_target = _vector(target, "camera.target", [0, 0.8, 0])
        normalized_fov = _number(fov, "camera.fov", 45, 6, 120)

        def mutation(manifest: JsonObject) -> None:
            cameras = manifest["scene"]["cameras"]
            if not cameras:
                cameras.append(_default_camera(aspect_ratio))
            camera = cameras[0]
            camera.update({"position": normalized_position, "target": normalized_target, "fov": normalized_fov, "aspectRatio": aspect_ratio})

        return self._mutate(mutation)

    def set_camera_path(self, points: Sequence[object]) -> JsonObject:
        if len(points) < 2:
            raise ManifestValidationError("camera path 至少需要两个点")
        normalized_points = [_vector(value, f"camera.path[{index}]", [0, 0, 0]) for index, value in enumerate(points)]

        def mutation(manifest: JsonObject) -> None:
            scene = manifest["scene"]
            cameras = scene["cameras"]
            if not cameras:
                cameras.append(_default_camera())
            camera_id = cameras[0]["id"]
            duration = scene["sceneTimeline"]["totalDuration"]
            trajectory = {
                "id": "director-camera-path",
                "name": "导演相机路径",
                "points": [
                    {"id": f"director-camera-path-point-{index + 1}", "position": point, "timeRatio": index / (len(normalized_points) - 1)}
                    for index, point in enumerate(normalized_points)
                ],
                "tension": 0.5,
                "closed": False,
                "color": "#f59e0b",
            }
            binding = {
                "id": "director-camera-binding",
                "trajectoryId": trajectory["id"],
                "objects": [{"objectId": camera_id, "offsetRatio": 0.0}],
                "startTime": 0.0,
                "endTime": duration,
                "direction": "forward",
            }
            scene["trajectories"] = [item for item in scene["trajectories"] if item["id"] != trajectory["id"]] + [trajectory]
            scene["trajectoryBindings"] = [item for item in scene["trajectoryBindings"] if item["id"] != binding["id"]] + [binding]

        return self._mutate(mutation)

    def undo(self) -> JsonObject:
        current = self.load()
        history = self._load_history()
        if not history["undo"]:
            raise ManifestValidationError("没有可撤销的导演操作")
        prior = normalize_manifest(history["undo"].pop())
        history["redo"] = (history["redo"] + [current])[-MAX_HISTORY_ENTRIES:]
        _write_json_atomic(self.manifest_path, prior)
        _write_json_atomic(self.history_path, history)
        return prior

    def redo(self) -> JsonObject:
        current = self.load()
        history = self._load_history()
        if not history["redo"]:
            raise ManifestValidationError("没有可重做的导演操作")
        future = normalize_manifest(history["redo"].pop())
        history["undo"] = (history["undo"] + [current])[-MAX_HISTORY_ENTRIES:]
        _write_json_atomic(self.manifest_path, future)
        _write_json_atomic(self.history_path, history)
        return future

    def allocate_export_dir(self) -> Path:
        self.exports_dir.mkdir(parents=True, exist_ok=True)
        output_dir = self.exports_dir / f"render-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
        output_dir.mkdir(parents=False, exist_ok=False)
        return output_dir

    def record_export(self, payload: JsonObject) -> None:
        _write_json_atomic(self.latest_export_path, payload)

    def load_latest_export(self) -> JsonObject:
        if not self.latest_export_path.is_file():
            raise ManifestValidationError("尚未生成 Blender 导演预演")
        try:
            raw = json.loads(self.latest_export_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ManifestValidationError(f"无法读取 Blender 导演导出: {error}") from error
        if not isinstance(raw, dict):
            raise ManifestValidationError("Blender 导演导出格式无效")
        return raw
