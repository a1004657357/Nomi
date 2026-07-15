from __future__ import annotations

import pytest

from cli_anything.blender.utils.blender_backend import (
    BlenderBackendError,
    build_blender_args,
    validate_export_artifacts,
)


def test_blender_backend_uses_a_restricted_background_invocation():
    args = build_blender_args("/tmp/render_scene.py", "/tmp/scene.json", "/tmp/output")

    assert args == [
        "--background",
        "--factory-startup",
        "--disable-autoexec",
        "--python-exit-code",
        "1",
        "--python",
        "/tmp/render_scene.py",
        "--",
        "/tmp/scene.json",
        "/tmp/output",
    ]


def test_export_validation_rejects_missing_or_empty_blender_artifacts(tmp_path):
    with pytest.raises(BlenderBackendError, match="preview.png"):
        validate_export_artifacts(tmp_path)

    for name in ("preview.png", "scene.blend", "scene.glb"):
        (tmp_path / name).write_bytes(b"x")
    artifacts = validate_export_artifacts(tmp_path)
    assert artifacts.preview.name == "preview.png"

    (tmp_path / "scene.glb").write_bytes(b"")
    with pytest.raises(BlenderBackendError, match="scene.glb"):
        validate_export_artifacts(tmp_path)
