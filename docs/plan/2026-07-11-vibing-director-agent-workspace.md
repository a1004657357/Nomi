# VIBING Director Implementation Plan

> **For Codex:** Use the implementation-builder skill and execute this plan as a Gate 8 AI-capability slice.

**Goal:** Add an independent, conversation-driven 3D director workspace whose source of truth is owned by the new director node, not by a legacy `scene3d` node or Blender.

**Architecture:** `vibingDirector` stores a compact director document containing a reusable Scene3D state, creative brief, and shot beats. The Agent receives a compact state summary and can only issue typed scene patches; the renderer validates and applies a patch after user confirmation. The existing Three.js director editor remains the interactive stage, while Blender is a later optional preview/export consumer of the same state.

**Tech Stack:** React 18, Zustand generation canvas store, React Three Fiber Scene3D editor, Electron AgentChatV2, Zod, Vitest.

---

### Task 1: Define the independent director document and patch protocol

**Files:**
- Create: `src/workbench/generationCanvas/nodes/vibingDirector/vibingDirectorState.ts`
- Create: `src/workbench/generationCanvas/nodes/vibingDirector/vibingDirectorState.test.ts`
- Create: `electron/ai/vibingDirectorTools.ts`
- Test: `electron/ai/vibingDirectorTools.test.ts`

1. Write reducer tests for initial state, actor/prop creation, camera updates, scene templates, beats, and rejected malformed patches.
2. Add a pure, serializable director state that embeds `Scene3DState`; no renderer-only objects or arbitrary executable script are allowed.
3. Implement typed patches for brief, stage template, actors, props, object movement, camera, camera path, beats, and deletion.
4. Keep patches declarative and validate object references by stable id or an unambiguous name.
5. Add backend Zod schemas for exactly the supported Agent patches.

### Task 2: Add a first-class VIBING Director canvas node

**Files:**
- Modify: `src/workbench/generationCanvas/nodes/registry.ts`
- Modify: `src/workbench/generationCanvas/nodes/renderRegistry.tsx`
- Modify: `src/workbench/generationCanvas/model/generationCanvasTypes.ts`
- Modify: `src/workbench/generationCanvas/components/CanvasToolbar.tsx`
- Modify: `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx`
- Create: `src/workbench/generationCanvas/nodes/VibingDirectorEditor.tsx`
- Test: `src/workbench/generationCanvas/nodes/VibingDirectorEditor.test.ts`

1. Write a registry test showing `vibingDirector` is available from the add menu, defaults to the scene category, and is not a generation model.
2. Register `vibingDirector` with a distinct label/icon/default size.
3. Render a compact node card that shows brief/beat count, an independent-state badge, and an entry point to the full director desk.
4. Persist its state under `node.meta.vibingDirectorState`; do not read or mutate `meta.scene3dState`.

### Task 3: Reuse the 3D stage as a director surface, not as the data owner

**Files:**
- Modify: `src/workbench/generationCanvas/nodes/scene3d/Scene3DFullscreen.tsx`
- Create: `src/workbench/generationCanvas/nodes/vibingDirector/VibingDirectorFullscreen.tsx`
- Test: `src/workbench/generationCanvas/nodes/vibingDirector/VibingDirectorFullscreen.test.tsx`

1. Add an optional, tabbed sidecar slot to `Scene3DFullscreen`; ordinary Scene3D nodes remain unchanged without the slot.
2. Build `VibingDirectorFullscreen` around the shared stage, passing only `vibingDirectorState.scene` into the stage and writing manual changes back into the director document.
3. Use the sidecar for the Director Agent and beat list so chat, manual scene edits, and camera controls are visible in one workspace.
4. Preserve the existing screenshot and take-recording behavior behind callbacks; no Blender task is required for editing.

### Task 4: Connect the Director Agent through a dedicated tool group

**Files:**
- Modify: `electron/ai/agentChatV2.ts`
- Modify: `electron/ai/agentChatHarness.ts`
- Modify: `electron/events/eventLogRepository.ts`
- Create: `skills/workbench-vibing-director/SKILL.md`
- Create: `src/workbench/generationCanvas/nodes/vibingDirector/vibingDirectorAgentClient.ts`
- Create: `src/workbench/generationCanvas/nodes/vibingDirector/VibingDirectorAssistantPanel.tsx`
- Test: `electron/ai/agentChatV2.test.ts` or focused new test

1. Write tests proving the `workbench.vibing-director` skill receives only director read/patch tools and has an adequate loop step limit.
2. Add `read_vibing_director` (read-only) and `apply_vibing_director_patch` (write, confirmation required) to a dedicated Agent tool group.
3. Add a dedicated skill prompt that forces an inspect -> explain -> typed patch flow and prohibits raw Blender Python or arbitrary JavaScript.
4. Implement the panel with streamed messages, model picker, cancel, explicit Apply/Skip action, and compact state context.
5. Give each director node its own conversation key without breaking project-memory event attribution.

### Task 5: Add the Blender handoff as an optional consumer

**Files:**
- Modify: `src/workbench/generationCanvas/nodes/VibingDirectorEditor.tsx`
- Modify: `electron/capabilityCore/core.ts` only if a dedicated external capability is required
- Test: focused output mapping test

1. Add a clearly secondary `Blender 预演/导出` action that consumes `vibingDirectorState.scene`.
2. Keep the existing legacy Scene3D Blender button intact.
3. Make any image/GLB output attach to the VIBING Director node, never substitute the source state.

### Task 6: Verify the slice

1. Run targeted reducer, schema, Agent-tool and editor tests.
2. Run `pnpm run typecheck`, `pnpm run lint:ci`, `pnpm test`, and `pnpm run build`.
3. Restart the Electron source app and verify that a new VIBING Director node opens a stage, accepts a safe Agent patch, and retains a subsequent manual edit.
4. Do not advance the product stage; Gate 8 acceptance remains subject to an explicit review.
