# Codex Blender Director Bridge

Date: 2026-07-10
Status: implemented and locally verified
Gate: 8 - AI capability integration

## Goal

Let a local Codex session turn an approved, structured director plan into a
real Blender blocking and camera-move sketch, then import the preview, editable
`.blend`, and GLB output into the active Nomi project.  The first slice must be
usable without embedding Blender inside Electron or granting the model arbitrary
`bpy` execution.

## Architecture

1. `integrations/blender/agent-harness` is a CLI-Anything-compatible Python
   package.  Its public executable is `cli-anything-blender`.
2. The CLI persists a validated `director-manifest.json` below the selected
   Nomi project at `.nomi-director/`.  It exposes only fixed operations:
   `scene init`, `stage set`, `camera set`, `camera path`, `preview render`,
   `sync export`, `undo`, and `redo`.
3. `preview render` calls the installed Blender binary in background mode with
   `--factory-startup` and `--disable-autoexec`.  A bundled Blender Python
   script constructs only the primitives, mannequins, cameras, lights, and
   paths described by the manifest.
4. Electron calls the CLI through a typed IPC bridge.  The bridge imports its
   three exported files through Nomi's existing asset store, so the existing
   Scene3D output-node behavior remains the single canvas representation.
5. The renderer exposes a clear `Blender 导演预演` action.  It writes the
   current Scene3D state into the director manifest, asks Blender to render it,
   and uses the existing connected output-node pathway for the result.

## Explicit Boundaries

- No embedded Blender window in Electron in this slice.
- No arbitrary shell command, arbitrary Python, URL, or unrestricted file-path
  argument can be supplied by a model through the bridge.
- A foreground Blender add-on and live bidirectional sync are intentionally
  deferred.  The editable `.blend` artifact is the handoff for live Blender
  work; the manifest remains the source of structured directing intent.
- The first real-backend acceptance target is macOS Blender 4.0.1, which is
  installed on this machine.  Other versions and platforms remain unverified.

## Implementation Tasks

### Task 1: Harness state contract

Files:
- `integrations/blender/agent-harness/BLENDER.md`
- `integrations/blender/agent-harness/TEST.md`
- `integrations/blender/agent-harness/cli_anything/blender/core/manifest.py`
- `integrations/blender/agent-harness/cli_anything/blender/tests/test_core.py`

Test first:
- a new manifest is normalized with a version, scene, stage, camera, and
  history revision;
- invalid vector and unknown primitive values are rejected;
- undo/redo restore immutable saved revisions.

Implementation:
- create the versioned manifest schema and atomic file persistence;
- expose typed mutation helpers with bounded numeric values.

### Task 2: CLI-Anything command surface

Files:
- `integrations/blender/agent-harness/setup.py`
- `integrations/blender/agent-harness/cli_anything/blender/__main__.py`
- `integrations/blender/agent-harness/cli_anything/blender/blender_cli.py`
- `integrations/blender/agent-harness/cli_anything/blender/tests/test_full_e2e.py`

Test first:
- installed CLI has JSON-only output;
- command mutations persist between subprocess calls;
- no subcommand opens a REPL rather than failing;
- invalid command input emits a structured error without a traceback on stdout.

Implementation:
- installable Click executable and REPL;
- fixed subcommands, state selection by `--project-dir`, and JSON envelope.

### Task 3: Real Blender backend

Files:
- `integrations/blender/agent-harness/cli_anything/blender/utils/blender_backend.py`
- `integrations/blender/agent-harness/cli_anything/blender/utils/render_scene.py`

Test first:
- backend command arguments always include background, factory-startup,
  disabled autoexec, and a separator before data paths;
- export parser rejects missing or empty artifacts.

Implementation:
- invoke installed Blender without shell interpolation;
- convert manifest state into the existing Nomi-compatible scene shape;
- export `preview.png`, `scene.blend`, `scene.glb`, and `director-sync.json`.

### Task 4: Nomi bridge and director action

Files:
- `electron/blender/directorCli.ts`
- `electron/main.ts`
- `electron/preload.ts`
- `src/desktop/bridge.ts`
- `src/workbench/generationCanvas/nodes/Scene3DEditor.tsx`
- focused Vitest coverage under `electron/blender/` and `src/.../scene3d/`.

Test first:
- Electron bridge only accepts a typed director render request;
- it imports the three artifacts through `writeAsset` with director provenance;
- bad CLI JSON and missing export files fail with a useful diagnostic;
- UI result mapping preserves the current Scene3D output-node contract.

Implementation:
- add a protected `nomi:scene3d:render-director-blender` IPC channel;
- reuse current output node creation and project-switch protection;
- make the director action visible and distinguish it from the legacy direct
  scene renderer.

### Task 5: End-to-end validation

1. Run Python core and subprocess tests from an isolated virtual environment.
2. Install the harness editable and use its installed executable.
3. Run one real Blender background render in a temporary project directory;
   verify non-empty PNG, BLEND, GLB, and sync JSON.
4. Run targeted Vitest tests, Electron typecheck, then inspect the changed
   production build surface.
5. Update the Gate 8 audit with exact proof and residual risk.

## Acceptance

- A Codex session can call `cli-anything-blender` with a project directory and
  fixed director commands to produce a nonblank local Blender preview plus
  editable scene assets.
- Nomi can invoke the same command path and attach the artifacts to a Scene3D
  node without exposing arbitrary code execution.
- JSON output, undo/redo, validation, error messages, unit tests, subprocess
  tests, and at least one real Blender smoke are all verified.

## Verification Completed

- Harness state, command, backend-argument, and installed-executable tests:
  8 passed in the isolated harness virtual environment.
- Electron bridge, Scene3D output mapping, capability-core routing, RPC, and
  MCP protocol tests passed in the Nomi Vitest suite.
- Real macOS Blender 4.0.1 runs produced non-empty PNG, BLEND, GLB, and sync
  JSON through both `cli-anything-blender` and the no-Click Electron bridge.
- A running Nomi instance accepted `node scripts/nomi.mjs director render` for
  a fresh `scene3d` node, created connected preview and GLB nodes, and returned
  the Blender version. The temporary verification project was then deleted via
  Nomi's project API.
