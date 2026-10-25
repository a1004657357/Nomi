# 3D Camera Proxy Implementation Plan

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** Turn an image-derived GLB into a controllable camera proxy that can be orbit-adjusted, numerically framed, and captured back to a new connected image node.

**Architecture:** Keep `image.multiview.reconstruct3d` as the source-to-GLB path. Extend the existing `model3d` viewer with a persisted spherical camera state and an offscreen render capture API. A small node-body controller owns camera UI, persists captures to project assets, and creates a new image node with camera provenance.

**Tech Stack:** React 18, React Three Fiber, drei OrbitControls, Three.js, Zustand, Vitest.

---

### Task 1: Camera State Contract

**Files:**
- Create: `src/workbench/generationCanvas/nodes/model3d/model3dCamera.ts`
- Create: `src/workbench/generationCanvas/nodes/model3d/model3dCamera.test.ts`

**Steps:**
1. Add failing tests for normalization, spherical position conversion, round trips, and capture dimensions.
2. Run the focused test and confirm it fails because the module is missing.
3. Implement the smallest typed camera contract.
4. Run the focused test and confirm it passes.

### Task 2: Non-Destructive Capture Action

**Files:**
- Create: `src/workbench/generationCanvas/nodes/model3d/model3dCameraCapture.ts`
- Create: `src/workbench/generationCanvas/nodes/model3d/model3dCameraCapture.test.ts`

**Steps:**
1. Add failing tests proving a capture creates a new image node, preserves the source model, records camera provenance, and connects the nodes.
2. Implement the capture action using the existing project screenshot persistence path.
3. Verify persistence failure does not mutate the canvas.

### Task 3: Interactive Model Viewer

**Files:**
- Modify: `src/workbench/generationCanvas/nodes/model3d/Model3DViewer.tsx`
- Create: `src/workbench/generationCanvas/nodes/model3d/Model3DCameraNodeBody.tsx`
- Modify: `src/workbench/generationCanvas/nodes/GenerationNodePreviewBody.tsx`

**Steps:**
1. Expose a viewer capture handle that renders the current camera to an offscreen target.
2. Synchronize OrbitControls with persisted azimuth, elevation, distance, FOV, and target.
3. Add compact icon controls for camera settings, reset, and capture.
4. Persist a capture as a new connected image node.

### Task 4: Image Entry Point

**Files:**
- Modify: `src/workbench/generationCanvas/nodes/NodeImageEditToolbar.tsx`
- Modify: `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx`

**Steps:**
1. Add a `3D 机位` image action.
2. Open the existing capability inspector preselected to `image.multiview.reconstruct3d`.
3. Keep provider/model selection and spend confirmation in the existing recipe flow.

### Task 5: Gate 8 Evidence

**Files:**
- Create: `docs/audit/2026-07-18-ai-capability-slice-3d-camera-proxy.md`

**Steps:**
1. Record supported inputs, model boundary, provenance, cost gate, and failure behavior.
2. Run focused tests, typecheck, renderer build, and local runtime smoke.
3. Record evidence without advancing the product gate.
