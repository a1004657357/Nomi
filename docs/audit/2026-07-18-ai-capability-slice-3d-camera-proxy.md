# AI Capability Slice: 3D Camera Proxy

## Gate

- Current gate: 8 - AI capability integration
- Scope: image-to-3D provider result -> controllable local camera -> non-destructive image capture
- Release state: internal source-build validation only; this document does not approve a production launch

## User Contract

1. A source image opens the existing `image.multiview.reconstruct3d` recipe.
2. The user chooses an actually connected `image_to_3d` model and confirms spend through the existing gate.
3. A successful GLB result opens as a `model3d` camera proxy.
4. Orbit drag and numeric controls edit azimuth, elevation, distance, FOV, and target.
5. Capture renders the current camera at the selected aspect ratio and long edge.
6. Capture always creates a new connected image node; it never replaces the GLB or an earlier capture.

## Model Boundary

- Exact: camera transform relative to the generated proxy, output framing, capture dimensions, provenance.
- Inferred: geometry, texture, scale, and all surfaces hidden in the source image.
- Not claimed: photogrammetry, exact single-image mesh recovery, or factual reconstruction of unseen content.
- Provider selection remains catalog-driven. No model identifier is hard-coded into the camera UI.

## Cost And Failure Controls

- Image-to-3D remains inside the existing capability recipe spend confirmation.
- Orbiting, numeric camera edits, and local capture do not call a model.
- A failed project-asset write creates no capture node.
- A capture failure leaves the source GLB result and previous captures unchanged.
- Missing or invalid GLB results block capture with an explicit user-facing error.

## Provenance

Each captured image records:

- source model node id and source model result id
- upstream model key when available
- full normalized camera state
- output width and height
- local camera provider marker: `nomi-local-3d-camera`
- source edge from the GLB node to the captured image node

## Procedural Three.js Backend Boundary

`Three.js Object Sculptor` can be added later as a second producer of camera proxies, but it is not treated as an active provider in this slice. Its native output is procedural Three.js code plus an `ObjectSculptSpec`, while the current Nomi model node consumes GLB. A reviewed integration must therefore either:

1. export the generated Three.js object to a self-contained GLB, or
2. run generated code in a separately sandboxed procedural-model node.

The camera and capture contract in this slice is backend-independent once a valid viewable model is available.

## Evaluation Cases

- Normalize malformed persisted camera values without NaN or invalid ranges.
- Round-trip spherical camera state through Cartesian position.
- Preserve exact 16:9, 9:16, and 1:1 capture dimensions.
- Create one new image node per capture and preserve the source GLB result.
- Preserve source category and force the captured image to use the normal shot-frame preview.
- Refuse mutation when screenshot persistence fails.
- Verify image toolbar opens the existing 3D reconstruction recipe rather than bypassing model selection.
- Prevent a local camera capture from inheriting the current default image model.
- Restore a persisted camera without letting GLB auto-fit overwrite it on reload.

## Live Source-Build Evidence

- Runtime: Electron source build with DevTools on `127.0.0.1:9224`; Capability Core reported `appOpen: true`.
- Project: `workspace-384d04b9-a12f-4702-9a5b-4ec29bea0a02` (`Gate 8 创作能力验收（可查看）`).
- Fixture: existing local Blender GLB imported as `camera-proxy-coffee.glb`; no paid model request was made.
- Rendering: the WebGL canvas rendered the GLB with non-uniform scene pixels and exposed orbit plus numeric camera controls.
- Orbit persistence: a pointer drag changed azimuth from `36.87°` to `-0.21°` and the project record updated.
- Reload persistence: azimuth was then set to `72°`; after a full Electron restart the control and project record both remained `72°`.
- Capture: `9:16` at `2K` produced a persisted `1152×2048` PNG and a new reference-connected image node.
- Provenance: the final capture records provider `nomi-local-3d-camera`, the full camera state, source model ids, and output dimensions.
- Model isolation: the final capture has `modelAutoSelectDisabled: true` and no image-provider model metadata.

## Acceptance Check

- [x] Camera contract tests pass.
- [x] Capture mutation tests pass.
- [x] Frontend TypeScript check passes.
- [x] Renderer production build passes after integration.
- [x] Source-build UI shows camera controls on a real GLB result.
- [x] A real capture is persisted and appears as a connected image node.
