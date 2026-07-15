# cli-anything-blender

`cli-anything-blender` is a stateful wrapper around local Blender for Nomi's
director workflow.  It retains only a versioned `director-manifest.json`, not a
remote session or an executable code channel.

Run `cli-anything-blender --help` for the command tree.  Add `--json` whenever
a caller needs a machine-readable single-line result.

The render command emits a low-fidelity preview, editable `.blend`, and GLB
file.  Only the files named in its structured `artifacts` object are intended
for a Nomi importer.
