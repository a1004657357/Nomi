# Nomi Blender Director Harness

This is a CLI-Anything harness around the locally installed Blender executable.
It builds low-fidelity blocking, camera placement, and camera-path previews for
Nomi projects.  It is intentionally not a general-purpose Python runner.

## Installation

```bash
cd integrations/blender/agent-harness
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
```

## Examples

```bash
cli-anything-blender --project-dir "/path/to/Nomi project" --json scene init --title "咖啡广告" --duration 6
cli-anything-blender --project-dir "/path/to/Nomi project" --json stage set --preset coffee_shop
cli-anything-blender --project-dir "/path/to/Nomi project" --json camera set \
  --position "4,2.4,5" --target "0,0.8,0" --fov 52 --aspect-ratio "2.39:1"
cli-anything-blender --project-dir "/path/to/Nomi project" --json camera path \
  --point "4,2.4,5" --point "1.5,1.8,3" --point "0.5,1.5,2"
cli-anything-blender --project-dir "/path/to/Nomi project" --json preview render
```

State is stored below the selected project directory:

```text
.nomi-director/
  director-manifest.json
  history.json
  exports/
    render-.../
      preview.png
      scene.blend
      scene.glb
      director-sync.json
```

## Boundaries

- The CLI accepts only director commands and validated JSON scene state.
- Blender is invoked with `--background`, `--factory-startup`, and
  `--disable-autoexec`.
- It never accepts an arbitrary `bpy` expression, shell fragment, URL, or
  output path from a director command.
- Opening and iterating on the exported `.blend` in foreground Blender is a
  separate manual workflow in this version.
