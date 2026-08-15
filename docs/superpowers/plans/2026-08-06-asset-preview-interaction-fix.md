# Asset Preview Interaction Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the real first frame for cross-project videos in the asset library and make image, video, and audio assets actionable from the Preview workspace.

**Architecture:** Resolve a filmstrip request from the project encoded in a `nomi-local://asset/<projectId>/...` URL before falling back to an explicit or active project. Replace the audio-only asset-to-timeline path with one generic path that builds and duration-probes all three media kinds. Give `AssetLibraryContent` an explicit `canvas` or `timeline` usage context so one card has one meaningful primary action in each workspace.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, Electron bridge, FFmpeg filmstrip cache.

---

### Task 1: Resolve video filmstrips against the owning project

**Files:**
- Create: `src/media/nomiLocalAssetUrl.ts`
- Create: `src/media/useFilmstrip.test.ts`
- Modify: `src/media/useFilmstrip.ts`
- Modify: `src/workbench/assets/assetLibrarySources.ts`
- Modify: `src/workbench/assets/assetLibrarySources.test.ts`
- Modify: `src/workbench/assets/AssetVideoCover.tsx`

- [ ] **Step 1: Write the failing filmstrip ownership tests**

Add pure resolver tests that require URL ownership to beat both explicit and active projects, explicit ownership to beat the active project for non-local URLs, and malformed/empty inputs to resolve safely:

```ts
expect(resolveFilmstripRequest(
  'nomi-local://asset/project%20a/assets/video.mp4',
  { explicitProjectId: 'project-b', activeProjectId: 'project-c' },
)).toEqual({
  videoUrl: 'nomi-local://asset/project%20a/assets/video.mp4',
  projectId: 'project a',
  key: 'project a::nomi-local://asset/project%20a/assets/video.mp4',
})
expect(resolveFilmstripRequest('https://cdn.test/video.mp4', {
  explicitProjectId: 'project-b',
  activeProjectId: 'project-c',
})?.projectId).toBe('project-b')
expect(resolveFilmstripRequest('', { activeProjectId: 'project-c' })).toBeNull()
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `pnpm vitest run src/media/useFilmstrip.test.ts`

Expected: FAIL because `resolveFilmstripRequest` does not exist.

- [ ] **Step 3: Move the local asset URL parser to shared media code**

Create `parseNomiLocalAssetUrl(url)` in `src/media/nomiLocalAssetUrl.ts`; preserve decoding, query/hash stripping, and malformed-input behavior from `assetLibrarySources.ts`. Update delete-plan imports/tests and remove the old implementation so there is one parser.

- [ ] **Step 4: Implement the resolver and hook fallback order**

Add this contract to `useFilmstrip.ts` and let the hook accept an optional explicit project ID:

```ts
export function resolveFilmstripRequest(
  videoUrl: string | null | undefined,
  project: { explicitProjectId?: string | null; activeProjectId?: string | null },
): { videoUrl: string; projectId: string; key: string } | null

export function useFilmstrip(
  videoUrl: string | null | undefined,
  explicitProjectId?: string | null,
): FilmstripEntry | null
```

Resolution order must be URL project ID → explicit project ID → active project ID. `AssetVideoCover` supplies `asset.origin.projectId` for project assets.

- [ ] **Step 5: Run filmstrip and asset-source tests and observe GREEN**

Run: `pnpm vitest run src/media/useFilmstrip.test.ts src/workbench/assets/assetLibrarySources.test.ts`

Expected: both files pass.

### Task 2: Replace the audio-only asset clip builder with a generic builder

**Files:**
- Modify: `src/workbench/timeline/buildClipFromAssetRef.ts`
- Modify: `src/workbench/timeline/buildClipFromAssetRef.test.ts`

- [ ] **Step 1: Replace the old tests with failing three-kind behavior tests**

Require `buildClipFromAssetRef` to produce:

```ts
expect(buildClipFromAssetRef(image, { fps: 30, startFrame: 0 })?.frameCount).toBe(90)
expect(buildClipFromAssetRef(video, { fps: 30, startFrame: 30, durationSeconds: 8 })?.frameCount).toBe(240)
expect(buildClipFromAssetRef(video, { fps: 30, startFrame: 0, durationSeconds: null })?.frameCount).toBe(150)
expect(buildClipFromAssetRef(audio, { fps: 30, startFrame: 0, durationSeconds: null })?.frameCount).toBe(300)
expect(buildClipFromAssetRef({ ...image, renderUrl: '' }, { fps: 30, startFrame: 0 })).toBeNull()
```

Also assert type, URL, label, stable `sourceNodeId`, defensive FPS/start clamping, and thumbnail preservation for images.

- [ ] **Step 2: Run the focused test and observe RED**

Run: `pnpm vitest run src/workbench/timeline/buildClipFromAssetRef.test.ts`

Expected: FAIL because only `buildAudioClipFromAssetRef` exists and non-audio assets are rejected.

- [ ] **Step 3: Implement one generic builder and delete the old export**

Use defaults image=3 seconds, video=5 seconds, audio=10 seconds. Only a positive probed duration overrides the video/audio default. Keep the existing stable ID/source contract and return `null` for an empty URL or unsupported kind.

- [ ] **Step 4: Run the focused test and observe GREEN**

Run: `pnpm vitest run src/workbench/timeline/buildClipFromAssetRef.test.ts`

Expected: PASS.

### Task 3: Replace the audio-only drop path with a generic timeline asset action

**Files:**
- Create: `src/workbench/timeline/addAssetToTimeline.ts`
- Create: `src/workbench/timeline/addAssetToTimeline.test.ts`
- Delete: `src/workbench/timeline/dropAudioAssetToTimeline.ts`
- Modify: `src/workbench/timeline/TimelineTrack.tsx`
- Modify: `src/workbench/timeline/TimelineSecondaryAddRow.tsx`

- [ ] **Step 1: Write failing action tests**

Test conversion of image/video/audio drag payloads to `AssetRef`, rejection of wrong target tracks, duration probe selection (video probe only for video, audio probe only for audio), and append targets derived from the matching track end:

```ts
expect(assetRefFromDragPayload(imagePayload)?.kind).toBe('image')
expect(assetRefFromDragPayload(videoPayload)?.kind).toBe('video')
expect(assetRefFromDragPayload(audioPayload)?.kind).toBe('audio')
expect(resolveAssetDrop(videoPayload, 'image')).toEqual({ status: 'reject', expectedTrack: 'video' })
expect(findAssetAppendFrame(timeline, 'video')).toBe(240)
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `pnpm vitest run src/workbench/timeline/addAssetToTimeline.test.ts`

Expected: FAIL because the generic action module does not exist.

- [ ] **Step 3: Implement the generic action module**

Export:

```ts
export function assetRefFromDragPayload(payload: AssetLibraryDragPayload): AssetRef | null
export function resolveAssetDrop(payload: AssetLibraryDragPayload, trackType: TimelineTrackType):
  | { status: 'accept'; asset: AssetRef }
  | { status: 'reject'; expectedTrack: TimelineTrackType }
export async function buildAssetTimelineClip(asset: AssetRef, opts: { fps: number; startFrame: number }): Promise<TimelineClip | null>
export function addAssetToTimeline(asset: AssetRef, opts: { fps: number; startFrame: number }): void
export async function addAssetToTimelineEnd(asset: AssetRef): Promise<void>
export function tryAddAssetFromDragData(raw: string | null | undefined, opts: {
  fps: number
  startFrame: number
  targetTrackType: TimelineTrackType
}): AssetKind | 'reject' | null
```

Use `readVideoDurationSeconds` for videos, `readAudioDurationSeconds` for audio, no probe for images, and the generic clip builder for all three.

- [ ] **Step 4: Wire all three asset kinds into `TimelineTrack`**

Accept `ASSET_LIBRARY_DRAG_MIME` on all three tracks. Asset drags use the pointer frame directly; generation-node drags retain the existing append/Option behavior. Reject a mismatched kind with the existing `timelineEditor.track.wrongType` message. Keep `TimelineSecondaryAddRow` audio-only at the UI boundary while routing it through the generic action.

- [ ] **Step 5: Run focused timeline tests and observe GREEN**

Run: `pnpm vitest run src/workbench/timeline/addAssetToTimeline.test.ts src/workbench/timeline/buildClipFromAssetRef.test.ts src/workbench/timeline/timelineDropFeedback.test.ts`

Expected: all files pass.

### Task 4: Give the asset library explicit canvas/timeline semantics

**Files:**
- Modify: `src/workbench/assets/AssetLibraryPanel.tsx`
- Modify: `src/workbench/assets/AssetLibraryPanelParts.tsx`
- Modify: `src/workbench/preview/PreviewSourcePanel.tsx`
- Create: `src/workbench/assets/assetLibraryUsage.ts`
- Create: `src/workbench/assets/assetLibraryUsage.test.ts`

- [ ] **Step 1: Write failing usage-context tests**

Test one primary action per context/source:

```ts
expect(resolveAssetLibraryItemAction('canvas', 'all')).toBe('preview')
expect(resolveAssetLibraryItemAction('canvas', 'project')).toBe('select')
expect(resolveAssetLibraryItemAction('timeline', 'all')).toBe('append')
expect(resolveAssetLibraryItemAction('timeline', 'project')).toBe('append')
expect(canManageAssetFolders('timeline')).toBe(false)
expect(canManageAssetFolders('canvas')).toBe(true)
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `pnpm vitest run src/workbench/assets/assetLibraryUsage.test.ts`

Expected: FAIL because explicit usage context does not exist.

- [ ] **Step 3: Implement context policy and component props**

Add `usageContext?: 'canvas' | 'timeline'` to `AssetLibraryContent` with default `canvas`. `AssetGridCell` must support activation independently from selection visuals. In timeline context, a single click appends through `addAssetToTimelineEnd`, every asset drag uses the timeline MIME, and double-click preview is disabled to prevent duplicate appends. In canvas context, All assets single-click previews; Project assets retain selection, deletion, folder assignment, and double-click preview.

- [ ] **Step 4: Keep project folders browseable but not mutable on Preview**

Allow opening/back navigation in timeline context, while hiding delete/new-folder controls and disabling folder assignment drops. `PreviewSourcePanel` passes `usageContext="timeline"` and reuses the existing `timelineEditor.dragToTimeline` hint.

- [ ] **Step 5: Run focused context tests and observe GREEN**

Run: `pnpm vitest run src/workbench/assets/assetLibraryUsage.test.ts src/workbench/assets/assetLibraryDrag.test.ts src/workbench/assets/AssetTile.test.ts`

Expected: all files pass.

### Task 5: Verify, package, install, and inspect the real user journey

**Files:**
- Modify: `tests/ux/asset-preview-interaction.walk.mjs`
- Generated but not committed: `tests/ux/shots/asset-preview-interaction/*`

- [ ] **Step 1: Add a real-app walkthrough**

Seed two projects with visually different videos, open project B → All assets, wait for both video cards to show non-placeholder backgrounds, then open Preview → Assets and exercise image/video/audio click-to-append plus matching/mismatched track drops. Capture dark- and light-mode screenshots.

- [ ] **Step 2: Run all repository gates**

Run: `pnpm run check:filesize && pnpm run check:tokens && pnpm run check:i18n && pnpm run lint:ci && pnpm run typecheck && pnpm run test && pnpm run build`

Expected: every command exits 0.

- [ ] **Step 3: Run the real-app walkthrough and inspect screenshots**

Run the packaged/development Electron walkthrough, open each produced screenshot with an image viewer, and compare against the approved invariants: same card geometry/density, real distinct video frames, no new buttons, timeline clips appear on their matching tracks.

- [ ] **Step 4: Commit and push the isolated result to `main`**

Stage only source, tests, and plan files. Commit one cohesive fix, rebase/cherry-pick on the latest `origin/main` if it moved, rerun relevant gates, then push `HEAD:main`.

- [ ] **Step 5: Build and install the new macOS app**

Package the new version, replace `/Applications/Nomi.app`, launch it, and repeat the user-visible video-card check against the real existing asset library. Do not claim completion until the installed app screenshot has been personally inspected.
