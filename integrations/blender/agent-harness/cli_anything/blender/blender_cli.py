from __future__ import annotations

import json
import shlex
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import click

from .core.manifest import DirectorManifestStore, ManifestValidationError
from .utils.blender_backend import BlenderBackendError, render_director_manifest


@dataclass
class Runtime:
    store: DirectorManifestStore
    json_output: bool


def _envelope(ok: bool, command: str, data: Any | None = None, message: str | None = None) -> dict[str, Any]:
    if ok:
        return {"ok": True, "command": command, "data": data}
    return {"ok": False, "command": command, "error": {"message": message or "未知错误"}}


def _emit(runtime: Runtime, command: str, data: Any) -> None:
    payload = _envelope(True, command, data)
    if runtime.json_output:
        click.echo(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    else:
        click.echo(json.dumps(payload, ensure_ascii=False, indent=2))


def _emit_error(json_output: bool, command: str, error: BaseException) -> None:
    payload = _envelope(False, command, message=str(error) or error.__class__.__name__)
    if json_output:
        click.echo(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    else:
        click.echo(f"错误：{payload['error']['message']}", err=True)


def _runtime(context: click.Context) -> Runtime:
    runtime = context.obj
    if not isinstance(runtime, Runtime):
        raise click.ClickException("导演 CLI 未初始化")
    return runtime


def _parse_vector(value: str, field: str) -> list[float]:
    parts = [part.strip() for part in value.split(",")]
    if len(parts) != 3:
        raise ManifestValidationError(f"{field} 必须是 x,y,z")
    try:
        return [float(part) for part in parts]
    except ValueError as error:
        raise ManifestValidationError(f"{field} 必须是数字") from error


@click.group(invoke_without_command=True)
@click.option("--project-dir", type=click.Path(file_okay=False, path_type=Path), required=True, help="Nomi 项目目录")
@click.option("--json", "json_output", is_flag=True, help="输出单行 JSON")
@click.pass_context
def cli(context: click.Context, project_dir: Path, json_output: bool) -> None:
    """Constrained local Blender director controls for a Nomi project."""
    context.obj = Runtime(store=DirectorManifestStore(project_dir), json_output=json_output)
    if context.invoked_subcommand is None:
        _run_repl(context.obj)


@cli.command("status")
@click.pass_context
def status(context: click.Context) -> None:
    runtime = _runtime(context)
    _emit(runtime, "status", {"manifest": runtime.store.load(), "manifestPath": str(runtime.store.manifest_path)})


@cli.group("scene")
def scene_group() -> None:
    """Initialize a constrained Scene3D state."""


@scene_group.command("init")
@click.option("--title", default="未命名导演草图", show_default=True)
@click.option("--aspect-ratio", type=click.Choice(["16:9", "9:16", "4:3", "3:4", "1:1", "2.39:1"]), default="16:9")
@click.option("--duration", type=click.FloatRange(0.1, 600), default=10.0, show_default=True)
@click.pass_context
def scene_init(context: click.Context, title: str, aspect_ratio: str, duration: float) -> None:
    runtime = _runtime(context)
    _emit(runtime, "scene.init", {"manifest": runtime.store.initialize(title=title, aspect_ratio=aspect_ratio, duration_seconds=duration)})


@cli.group("stage")
def stage_group() -> None:
    """Select a bounded gray-box stage preset."""


@stage_group.command("set")
@click.option("--preset", required=True)
@click.pass_context
def stage_set(context: click.Context, preset: str) -> None:
    runtime = _runtime(context)
    _emit(runtime, "stage.set", {"manifest": runtime.store.set_stage(preset)})


@cli.group("camera")
def camera_group() -> None:
    """Place the director camera or define a single camera path."""


@camera_group.command("set")
@click.option("--position", required=True)
@click.option("--target", required=True)
@click.option("--fov", type=click.FloatRange(6, 120), required=True)
@click.option("--aspect-ratio", type=click.Choice(["16:9", "9:16", "4:3", "3:4", "1:1", "2.39:1"]), required=True)
@click.pass_context
def camera_set(context: click.Context, position: str, target: str, fov: float, aspect_ratio: str) -> None:
    runtime = _runtime(context)
    _emit(
        runtime,
        "camera.set",
        {
            "manifest": runtime.store.set_camera(
                position=_parse_vector(position, "position"),
                target=_parse_vector(target, "target"),
                fov=fov,
                aspect_ratio=aspect_ratio,
            )
        },
    )


@camera_group.command("path")
@click.option("--point", "points", multiple=True, required=True, help="重复传入 x,y,z")
@click.pass_context
def camera_path(context: click.Context, points: Sequence[str]) -> None:
    runtime = _runtime(context)
    parsed = [_parse_vector(value, f"point[{index}]") for index, value in enumerate(points)]
    _emit(runtime, "camera.path", {"manifest": runtime.store.set_camera_path(parsed)})


@cli.group("preview")
def preview_group() -> None:
    """Render the current director manifest through local Blender."""


@preview_group.command("render")
@click.option("--timeout-seconds", type=click.IntRange(1, 600), default=300, show_default=True)
@click.pass_context
def preview_render(context: click.Context, timeout_seconds: int) -> None:
    runtime = _runtime(context)
    manifest = runtime.store.load()
    output_dir = runtime.store.allocate_export_dir()
    result = render_director_manifest(manifest, output_dir, timeout_seconds=timeout_seconds)
    sync = {
        "schemaVersion": 1,
        "title": manifest["title"],
        "manifestPath": str(runtime.store.manifest_path),
        "outputDir": str(output_dir),
        "artifacts": result.artifacts.as_dict(),
        "blenderVersion": result.blender_version,
    }
    sync_path = output_dir / "director-sync.json"
    sync_path.write_text(json.dumps(sync, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sync["syncPath"] = str(sync_path)
    runtime.store.record_export(sync)
    _emit(runtime, "preview.render", sync)


@cli.group("sync")
def sync_group() -> None:
    """Read the latest structured Blender export for a Nomi bridge."""


@sync_group.command("export")
@click.pass_context
def sync_export(context: click.Context) -> None:
    runtime = _runtime(context)
    _emit(runtime, "sync.export", runtime.store.load_latest_export())


@cli.command("undo")
@click.pass_context
def undo(context: click.Context) -> None:
    runtime = _runtime(context)
    _emit(runtime, "undo", {"manifest": runtime.store.undo()})


@cli.command("redo")
@click.pass_context
def redo(context: click.Context) -> None:
    runtime = _runtime(context)
    _emit(runtime, "redo", {"manifest": runtime.store.redo()})


def _run_repl(runtime: Runtime) -> None:
    if not runtime.json_output:
        click.echo("Blender 导演台 REPL。输入 status、scene init、stage set 或 exit。")
    while True:
        if runtime.json_output:
            line = sys.stdin.readline()
            if not line:
                return
        else:
            try:
                line = input("director> ")
            except EOFError:
                return
        stripped = line.strip()
        if not stripped:
            continue
        if stripped in {"exit", "quit"}:
            return
        try:
            arguments = ["--project-dir", str(runtime.store.project_dir)]
            if runtime.json_output:
                arguments.append("--json")
            arguments.extend(shlex.split(stripped))
            cli.main(args=arguments, standalone_mode=False)
        except (click.ClickException, ManifestValidationError, BlenderBackendError) as error:
            _emit_error(runtime.json_output, "repl", error)
        except Exception as error:  # pragma: no cover - defensive process boundary
            _emit_error(runtime.json_output, "repl", error)


def main() -> int:
    json_output = "--json" in sys.argv
    try:
        cli.main(standalone_mode=False)
    except click.ClickException as error:
        _emit_error(json_output, "cli", error)
        return 2
    except (ManifestValidationError, BlenderBackendError) as error:
        _emit_error(json_output, "cli", error)
        return 2
    except Exception as error:  # pragma: no cover - do not leak a traceback into JSON protocol
        _emit_error(json_output, "cli", error)
        return 1
    return 0
