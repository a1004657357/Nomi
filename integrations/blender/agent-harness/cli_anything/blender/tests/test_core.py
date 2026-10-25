from __future__ import annotations

import json

import pytest

from cli_anything.blender.core.manifest import (
    DirectorManifestStore,
    ManifestValidationError,
    normalize_scene,
)


def test_initialize_creates_a_versioned_scene_and_history(tmp_path):
    store = DirectorManifestStore(tmp_path)

    manifest = store.initialize(title="咖啡广告", aspect_ratio="16:9", duration_seconds=6)

    assert manifest["schemaVersion"] == 1
    assert manifest["title"] == "咖啡广告"
    assert manifest["scene"]["sceneTimeline"]["totalDuration"] == 6
    assert manifest["scene"]["cameras"][0]["aspectRatio"] == "16:9"
    assert store.manifest_path.is_file()
    assert store.history_path.is_file()
    assert json.loads(store.manifest_path.read_text(encoding="utf-8"))["title"] == "咖啡广告"


def test_invalid_scene_values_are_rejected_before_they_reach_blender():
    with pytest.raises(ManifestValidationError, match="scale"):
        normalize_scene(
            {
                "objects": [
                    {
                        "id": "unsafe-object",
                        "name": "坏对象",
                        "type": "mesh",
                        "visible": True,
                        "position": [0, 0, 0],
                        "rotation": [0, 0, 0],
                        "scale": [0, 1, 1],
                        "geometry": "box",
                    }
                ],
                "cameras": [],
            }
        )

    with pytest.raises(ManifestValidationError, match="geometry"):
        normalize_scene(
            {
                "objects": [
                    {
                        "id": "bad-geometry",
                        "name": "坏几何体",
                        "type": "mesh",
                        "visible": True,
                        "position": [0, 0, 0],
                        "rotation": [0, 0, 0],
                        "scale": [1, 1, 1],
                        "geometry": "python_exec",
                    }
                ],
                "cameras": [],
            }
        )


def test_stage_camera_and_path_mutations_are_undoable_across_store_instances(tmp_path):
    store = DirectorManifestStore(tmp_path)
    store.initialize(title="走位草图")
    store.set_stage("coffee_shop")
    store.set_camera(
        position=[4, 2.4, 5],
        target=[0, 0.8, 0],
        fov=52,
        aspect_ratio="2.39:1",
    )
    updated = store.set_camera_path([[4, 2.4, 5], [1.5, 1.8, 3], [0.5, 1.5, 2]])

    assert updated["stage"]["preset"] == "coffee_shop"
    assert updated["scene"]["cameras"][0]["fov"] == 52
    assert updated["scene"]["trajectoryBindings"][0]["objects"][0]["objectId"] == "director-camera"
    assert len(updated["scene"]["trajectories"][0]["points"]) == 3

    reopened = DirectorManifestStore(tmp_path)
    after_undo = reopened.undo()
    assert after_undo["scene"]["trajectories"] == []
    assert reopened.undo()["scene"]["cameras"][0]["fov"] == 45
    redone = reopened.redo()
    assert redone["scene"]["cameras"][0]["fov"] == 52
    assert redone["stage"]["preset"] == "coffee_shop"
