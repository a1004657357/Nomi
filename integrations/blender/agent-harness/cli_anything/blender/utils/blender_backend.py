from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping


class BlenderBackendError(RuntimeError):
    """Raised when the real Blender backend cannot produce valid exports."""


@dataclass(frozen=True)
class BlenderArtifacts:
    preview: Path
    blend: Path
    model: Path

    def as_dict(self) -> dict[str, str]:
        return {
            "preview": str(self.preview),
            "blend": str(self.blend),
            "model": str(self.model),
        }


@dataclass(frozen=True)
class BlenderRenderResult:
    artifacts: BlenderArtifacts
    blender_version: str | None
    stdout: str


def build_blender_args(script_path: str | os.PathLike[str], input_path: str | os.PathLike[str], output_dir: str | os.PathLike[str]) -> list[str]:
    return [
        "--background",
        "--factory-startup",
        "--disable-autoexec",
        "--python-exit-code",
        "1",
        "--python",
        str(script_path),
        "--",
        str(input_path),
        str(output_dir),
    ]


def _candidate_paths(explicit_path: str | os.PathLike[str] | None = None) -> list[str]:
    candidates: list[str] = []
    if explicit_path:
        candidates.append(str(explicit_path))
    if os.environ.get("NOMI_BLENDER_PATH"):
        candidates.append(os.environ["NOMI_BLENDER_PATH"])
    if sys_platform() == "darwin":
        candidates.append("/Applications/Blender.app/Contents/MacOS/Blender")
    elif sys_platform() == "win32":
        candidates.extend(
            [
                r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe",
                r"C:\Program Files\Blender Foundation\Blender 4.4\blender.exe",
                r"C:\Program Files\Blender Foundation\Blender 4.3\blender.exe",
                r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
                r"C:\Program Files\Blender Foundation\Blender 4.1\blender.exe",
                r"C:\Program Files\Blender Foundation\Blender 4.0\blender.exe",
            ]
        )
    candidates.append("blender")
    return candidates


def sys_platform() -> str:
    import sys

    return sys.platform


def resolve_blender_executable(explicit_path: str | os.PathLike[str] | None = None) -> str:
    for candidate in _candidate_paths(explicit_path):
        if candidate == "blender":
            resolved = shutil.which(candidate)
            if resolved:
                return resolved
            continue
        path = Path(candidate).expanduser()
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
    raise BlenderBackendError("未找到 Blender。请安装 Blender，或设置 NOMI_BLENDER_PATH。")


def validate_export_artifacts(output_dir: str | os.PathLike[str]) -> BlenderArtifacts:
    root = Path(output_dir)
    paths = BlenderArtifacts(
        preview=root / "preview.png",
        blend=root / "scene.blend",
        model=root / "scene.glb",
    )
    for name, value in (("preview.png", paths.preview), ("scene.blend", paths.blend), ("scene.glb", paths.model)):
        if not value.is_file() or value.stat().st_size <= 0:
            raise BlenderBackendError(f"Blender 没有生成有效的 {name}")
    return paths


def _limited_detail(stdout: str, stderr: str) -> str:
    detail = (stderr.strip() or stdout.strip() or "无 Blender 输出")
    return detail[-6000:]


def render_director_manifest(
    manifest: Mapping[str, Any],
    output_dir: str | os.PathLike[str],
    *,
    blender_path: str | os.PathLike[str] | None = None,
    timeout_seconds: int = 300,
    on_process_started: Callable[[subprocess.Popen[str]], None] | None = None,
) -> BlenderRenderResult:
    if not isinstance(manifest.get("scene"), Mapping):
        raise BlenderBackendError("导演 manifest 缺少有效场景")
    if timeout_seconds < 1 or timeout_seconds > 600:
        raise BlenderBackendError("Blender 超时时间必须在 1 到 600 秒之间")
    root = Path(output_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    input_path = root / ".director-input.json"
    script_path = Path(__file__).with_name("render_scene.py")
    if not script_path.is_file():
        raise BlenderBackendError("缺少 Blender 渲染脚本")
    input_payload = {
        "title": manifest.get("title", "未命名导演草图"),
        "stage": manifest.get("stage", {"preset": "empty"}),
        "scene": manifest["scene"],
    }
    input_path.write_text(json.dumps(input_payload, ensure_ascii=False), encoding="utf-8")
    blender = resolve_blender_executable(blender_path)
    try:
        child = subprocess.Popen(
            [blender, *build_blender_args(script_path, input_path, root)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if on_process_started:
            on_process_started(child)
        stdout, stderr = child.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired as error:
        child = locals().get("child")
        if child is not None:
            child.kill()
            child.communicate()
        raise BlenderBackendError(f"Blender 渲染超时（{timeout_seconds} 秒）") from error
    except OSError as error:
        raise BlenderBackendError(f"Blender 启动失败：{error}") from error
    finally:
        input_path.unlink(missing_ok=True)
    if child.returncode != 0:
        raise BlenderBackendError(f"Blender 渲染失败（退出码 {child.returncode}）：{_limited_detail(stdout, stderr)}")
    artifacts = validate_export_artifacts(root)
    version = re.search(r"NOMI_BLENDER_VERSION=([^\r\n]+)", stdout)
    return BlenderRenderResult(
        artifacts=artifacts,
        blender_version=version.group(1).strip() if version else None,
        stdout=stdout[-6000:],
    )
