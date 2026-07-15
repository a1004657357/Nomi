"""Electron-only typed bridge that deliberately avoids the Click dependency."""

from __future__ import annotations

import argparse
import json
import signal
import sys
from pathlib import Path
from subprocess import Popen
from typing import Any

from .core.manifest import DirectorManifestStore, ManifestValidationError, STAGE_PRESETS
from .utils.blender_backend import BlenderBackendError, render_director_manifest


_active_blender_process: Popen[str] | None = None


def _write(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _on_blender_started(process: Popen[str]) -> None:
    global _active_blender_process

    _active_blender_process = process


def _cancel_active_blender(_signal: int, _frame: object) -> None:
    if _active_blender_process and _active_blender_process.poll() is None:
        _active_blender_process.terminate()
    raise SystemExit(128 + _signal)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--scene-input", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--owner-node-id", default=None)
    parser.add_argument("--title", default=None)
    parser.add_argument("--stage-preset", choices=sorted(STAGE_PRESETS), default=None)
    parser.add_argument("--timeout-seconds", type=int, default=300)
    return parser


def run(arguments: list[str] | None = None) -> int:
    args = _parser().parse_args(arguments)
    if args.timeout_seconds < 1 or args.timeout_seconds > 600:
        raise ManifestValidationError("timeoutSeconds 必须在 1 到 600 之间")
    scene_path = Path(args.scene_input).resolve()
    if not scene_path.is_file():
        raise ManifestValidationError("sceneInput 必须是存在的文件")
    try:
        payload = json.loads(scene_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ManifestValidationError(f"无法读取导演场景输入: {error}") from error
    scene = payload.get("scene") if isinstance(payload, dict) and "scene" in payload else payload
    store = DirectorManifestStore(args.project_dir)
    manifest = store.replace_scene(scene, title=args.title)
    if args.stage_preset:
        manifest = store.set_stage(args.stage_preset)
    output_dir = store.allocate_export_dir()
    result = render_director_manifest(
        manifest,
        output_dir,
        timeout_seconds=args.timeout_seconds,
        on_process_started=_on_blender_started,
    )
    sync = {
        "schemaVersion": 1,
        "jobId": args.job_id,
        "ownerNodeId": args.owner_node_id,
        "title": manifest["title"],
        "manifestPath": str(store.manifest_path),
        "outputDir": str(output_dir),
        "artifacts": result.artifacts.as_dict(),
        "blenderVersion": result.blender_version,
    }
    sync_path = output_dir / "director-sync.json"
    sync_path.write_text(json.dumps(sync, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sync["syncPath"] = str(sync_path)
    store.record_export(sync)
    _write({"ok": True, **sync})
    return 0


def main() -> int:
    signal.signal(signal.SIGTERM, _cancel_active_blender)
    signal.signal(signal.SIGINT, _cancel_active_blender)
    try:
        return run()
    except (ManifestValidationError, BlenderBackendError) as error:
        _write({"ok": False, "error": {"message": str(error)}})
        return 1
    except Exception as error:  # Keep IPC stdout structured even for an unexpected local failure.
        _write({"ok": False, "error": {"message": f"Blender 导演桥接失败: {error}"}})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
