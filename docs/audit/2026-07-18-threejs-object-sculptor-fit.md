# Three.js Object Sculptor Fit Audit

Date: 2026-07-18
Upstream: `vinhhien112/Three.js-Object-Sculptor-Codex-Plugin`
Audited commit: `543da1fc0e45a703b0ac037fb040ce082c79a1c2`
License: MIT

## What It Really Produces

The upstream project is a real Codex plugin with a Python validation/generation toolchain. It turns reference evidence into an `ObjectSculptSpec`, generates procedural Three.js TypeScript factories, and applies deterministic plus vision-review gates.

It is not photogrammetry and does not recover an exact mesh from one image. Its own README states that GLB is not produced by default; the primary output is code and a structured spec.

## Nomi Fit

Nomi already has:

- Three.js 0.184 and `GLTFExporter`;
- project-local GLB persistence and strict GLB 2.0 mesh/bounds validation;
- orbitable model nodes and camera capture;
- Scene3D and Blender Director handoff;
- local asset provenance and non-destructive result versions.

The missing bridge is:

1. Run the Object Sculptor workflow in an isolated workspace.
2. Compile the accepted generated Three.js factory.
3. Instantiate it in a Node-disabled, isolated browser renderer.
4. Export the resulting `THREE.Object3D` through `GLTFExporter` with `binary: true`.
5. Persist and validate the GLB before creating a Nomi model3d result.
6. Keep the spec, generated source, review evidence, plugin commit, and GLB linked as provenance.

## Model Requirement

The Python scripts themselves need no generative API. Codex supplies the planning and code-authoring intelligence, and a vision-capable model is needed for the upstream acceptance workflow. Nomi's image-to-3D provider models are a separate path:

- procedural path: Codex + Object Sculptor + local Three.js export;
- reconstruction path: Hunyuan3D, HiTem3D, or Meshy 6 returns GLB directly.

The two paths should converge only after GLB validation. They should not share a misleading “native image-to-3D” label.

## Current Decision

Do not add an Object Sculptor button yet. The upstream was audited and the Nomi export primitives exist, but the isolated generated-code executor and GLB export bridge are not implemented in this slice. Exposing a canvas recipe before those pieces run end to end would create exactly the facade-only capability this audit is intended to prevent.

The next implementation slice should deliver the executor and one simple rigid-object smoke before registering a new `procedural3d` recipe. Organic characters, exact hidden surfaces, and production-perfect geometry remain out of scope even after that bridge exists.
