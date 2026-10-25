from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def installed_cli() -> str:
    return str(Path(sys.executable).with_name("cli-anything-blender"))


def run_cli(project_dir: Path, *arguments: str, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [installed_cli(), "--project-dir", str(project_dir), "--json", *arguments],
        input=stdin,
        text=True,
        capture_output=True,
        check=False,
    )


def read_json_output(result: subprocess.CompletedProcess[str]) -> dict[str, object]:
    assert result.stdout.strip(), result.stderr
    return json.loads(result.stdout)


def test_installed_cli_persists_director_commands_and_emits_json(tmp_path):
    project_dir = tmp_path / "coffee-project"

    initialized = run_cli(project_dir, "scene", "init", "--title", "咖啡广告", "--duration", "5")
    assert initialized.returncode == 0, initialized.stderr
    assert read_json_output(initialized)["ok"] is True

    staged = run_cli(project_dir, "stage", "set", "--preset", "coffee_shop")
    assert staged.returncode == 0, staged.stderr
    camera = run_cli(
        project_dir,
        "camera",
        "set",
        "--position",
        "4,2.4,5",
        "--target",
        "0,0.8,0",
        "--fov",
        "52",
        "--aspect-ratio",
        "2.39:1",
    )
    assert camera.returncode == 0, camera.stderr

    status = run_cli(project_dir, "status")
    body = read_json_output(status)
    assert body["ok"] is True
    assert body["data"]["manifest"]["title"] == "咖啡广告"
    assert body["data"]["manifest"]["stage"]["preset"] == "coffee_shop"
    assert body["data"]["manifest"]["scene"]["cameras"][0]["fov"] == 52.0


def test_invalid_command_has_a_structured_error_and_no_stdout_traceback(tmp_path):
    result = run_cli(tmp_path / "bad-project", "stage", "set", "--preset", "unbounded")

    assert result.returncode != 0
    body = read_json_output(result)
    assert body["ok"] is False
    assert "preset" in body["error"]["message"]
    assert "Traceback" not in result.stdout


def test_no_subcommand_enters_a_repl_that_can_return_status_and_exit(tmp_path):
    result = run_cli(tmp_path / "repl-project", stdin="status\nexit\n")

    assert result.returncode == 0, result.stderr
    messages = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    assert messages[0]["command"] == "status"
