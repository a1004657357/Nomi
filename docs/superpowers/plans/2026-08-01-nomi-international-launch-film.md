# Nomi International Launch Film Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, verify, and export an editable Chinese-first Nomi launch film in ChatCut, then derive English, vertical, and silent-web variants from the approved master.

**Architecture:** ChatCut remains the canonical editable project. Real Nomi footage sits on V1, replacements and crops on V2, direct-authored brand Motion Graphics on V3, and narration/music/SFX on separate role-based audio tracks. The Chinese 16:9 timeline is the source master; language and aspect-ratio variants are duplicated only after its structure and visual QA pass.

**Tech Stack:** ChatCut MCP, ChatCut local media import helper, ChatCut direct-authored Motion Graphics, Doubao/ElevenLabs TTS, ChatCut captions, ChatCut cloud export, local `ffprobe`/`ffmpeg` only for read-only source and final-delivery inspection.

---

## File and project map

- Design source: `docs/superpowers/specs/2026-08-01-nomi-international-launch-film-design.md`
- Implementation trace: `docs/marketing/2026-08-01-nomi-launch-film-production-trace.md`
- Final scripts: `docs/marketing/2026-08-01-nomi-launch-film-scripts.md`
- ChatCut project: `Nomi International Launch Film`
- ChatCut project ID: `e972cb0b-b0bf-4c14-98ab-25093c2d0475`
- Initial timeline ID: `c995e3a0-b174-4736-b7aa-e86b3aa72b58`
- User-facing editor: `https://app.chatcut.io/zh/editor/e972cb0b-b0bf-4c14-98ab-25093c2d0475`
- Local source: `/Users/aoqimin/Documents/FocuSee/Nomi 2026-07-30 02-25-31.mp4`
- Supporting media: `marketing/assets/demo.mp4`, `marketing/assets/screen-3d.png`, `marketing/assets/screen-timeline.png`, `marketing/assets/nomi-logo.svg`

## Task 1: Finish source ingestion and record provenance

**Files:**
- Create: `docs/marketing/2026-08-01-nomi-launch-film-production-trace.md`

- [ ] **Step 1: Read the import-helper result**

Poll the existing foreground helper session once. Expected: one JSON result containing asset IDs for the source recording, demo, 3D still, and logo. If the large upload is still non-terminal, keep the registered asset IDs and continue with source mapping; do not start a duplicate upload.

- [ ] **Step 2: Verify media-pool state**

Call:

```json
{"projectId":"e972cb0b-b0bf-4c14-98ab-25093c2d0475","limit":20}
```

through `mcp__chatcut__browse_assets`.

Expected: four imported assets with the original filenames; the demo, 3D still, and logo are `ready`; the large source is either `processing` or `ready` and has a known asset ID.

- [ ] **Step 3: Check transcription and upload only for the large source**

Call `mcp__chatcut__track_progress` twice at most:

```json
{"action":"status","target":"transcription","assetIds":"68fc31c8-ca76-4448-bbe6-d51439a33680","projectId":"e972cb0b-b0bf-4c14-98ab-25093c2d0475"}
```

```json
{"action":"status","target":"upload","assetIds":"68fc31c8-ca76-4448-bbe6-d51439a33680","projectId":"e972cb0b-b0bf-4c14-98ab-25093c2d0475"}
```

Expected: transcription may finish before the full video upload. Do not busy-poll; follow the returned `checkBackAfterSeconds` once only when a dependent step is blocked.

- [ ] **Step 4: Write the trace header with exact IDs and source paths**

The trace must include project/timeline IDs, asset IDs, local source paths, acquisition method `ChatCut import helper`, upload/transcription states, and the original file facts: 3444×2160, 30 fps, 705.236 seconds, H.264 + AAC.

- [ ] **Step 5: Commit the trace**

```bash
git add docs/marketing/2026-08-01-nomi-launch-film-production-trace.md
git commit -m "docs(marketing): trace Nomi launch film sources"
```

## Task 2: Lock the brand style and timeline structure

**Files:**
- Modify: `docs/marketing/2026-08-01-nomi-launch-film-production-trace.md`

- [ ] **Step 1: Inspect the current ChatCut project**

Call `mcp__chatcut__read_project` with the project ID and default orientation, then `view:"timeline"` for the active timeline.

Expected: 1920×1080, 30 fps, one empty active timeline, and no unintended clips.

- [ ] **Step 2: Create and apply a Nomi design style**

Call `mcp__chatcut__manage_design_style` with `action:"create"`, name `Nomi · Warm Editorial`, and this exact design spec:

```json
{
  "colors": [
    {"role":"background","value":"#F3EEE6"},
    {"role":"text","value":"#292522"},
    {"role":"accent","value":"#E7795F"},
    {"role":"secondary","value":"#EFA95A"},
    {"role":"dark frame","value":"#242425"}
  ],
  "fonts": [
    {"role":"heading","family":"Fraunces"},
    {"role":"body","family":"DM Sans"}
  ],
  "styleGuide":"Warm editorial product craft: calm, tactile, precise, and human."
}
```

Expected: a new style is created and applied only to this project.

- [ ] **Step 3: Confirm cloud-renderable font names**

Call `mcp__chatcut__search_fonts` for `Fraunces` and `DM Sans`. Record the canonical names. If either is unavailable, use `Source Serif 4` for headings or `Inter` for body only after the search proves the preferred font unavailable.

- [ ] **Step 4: Rename the active timeline**

Use `mcp__chatcut__manage_timelines` `action:"rename"` on timeline `c995e3a0-b174-4736-b7aa-e86b3aa72b58` with name `01-CN-Master-16x9`.

Expected: the active timeline keeps its ID and reports the new name.

- [ ] **Step 5: Create role-based tracks**

Use `mcp__chatcut__edit_track` to create V2, V3, A1, A2, and A3. Set A1 role `anchor` and A2 role `follower`; leave A3 un-ducked for sparse UI/transition sounds.

Expected: V1/V2/V3 and A1/A2/A3 exist, with one clear responsibility per track.

- [ ] **Step 6: Read back the active style and track topology**

Use `manage_design_style action:"get"` and staged `read_project` calls. Append the style ID, canonical fonts, and actual track IDs to the trace.

- [ ] **Step 7: Commit the updated trace**

```bash
git add docs/marketing/2026-08-01-nomi-launch-film-production-trace.md
git commit -m "docs(marketing): lock Nomi launch film visual system"
```

## Task 3: Author the final Chinese and English scripts

**Files:**
- Create: `docs/marketing/2026-08-01-nomi-launch-film-scripts.md`
- Modify: `docs/marketing/2026-08-01-nomi-launch-film-production-trace.md`

- [ ] **Step 1: Write the Chinese 60-second script to the seven approved beats**

The script must use this exact structure and factual boundaries:

```text
00–04  你知道镜头该是什么样，但模型只能猜。
04–12  Nomi 把故事、分镜和生成放进同一个上下文。
12–24  先固定人物、场景、道具和风格，再让每个镜头继承同一套世界。
24–35  在画布上组织镜头，让助手写提示词、放素材、调用生成。
35–43  看到合适的参考，直接采集、反推并复用。
43–50  接入你自己的模型、ComfyUI 工作流和 AI 助手。
50–55  从意图到时间线，终于是一条连续的导演流程。
55–60  下载开源版 Nomi。需要定制、集成或贴牌，就把你的真实流程带来。
```

Polish cadence without adding new claims. Target 165–190 Chinese characters excluding punctuation.

- [ ] **Step 2: Write the English adaptation**

Start from this approved hook and CTA:

```text
You know the shot. The model guesses.
Nomi keeps the story, storyboard, and generation context connected.
Lock characters, locations, props, and style first, so every shot inherits the same world.
Build on a visual canvas. Let the assistant draft prompts, place media, and call generation tools.
Found the right reference? Capture it, reverse the prompt, and reuse it without leaving your workspace.
Connect your own models, ComfyUI workflows, and AI coding assistants.
From intent to timeline, directing finally becomes one continuous workflow.
Download the open-source Nomi. Need it tailored, integrated, or white-labeled? Bring us your real workflow.
```

Target 115–135 spoken words. Translate intent, not sentence structure.

- [ ] **Step 3: Add the shot-source map**

For every beat, record the source ranges from the design spec and one fallback asset. Explicitly exclude source 09:55–10:06 and any visible generation failure near 10:36–11:05.

- [ ] **Step 4: Run the claim audit**

Search the scripts for absolute claims such as `全部`, `所有模型`, `最好`, `领先`, `any model`, and `all models`. Expected: no unsupported absolute claim remains.

- [ ] **Step 5: Commit scripts and trace**

```bash
git add docs/marketing/2026-08-01-nomi-launch-film-scripts.md docs/marketing/2026-08-01-nomi-launch-film-production-trace.md
git commit -m "docs(marketing): author Nomi launch film scripts"
```

## Task 4: Build and verify the Chinese visual rough cut

**Files:**
- Modify: `docs/marketing/2026-08-01-nomi-launch-film-production-trace.md`

- [ ] **Step 1: Add the eight source clips to V1 in one validated transaction**

Use `mcp__chatcut__edit_item` with `validateOnly:true`. Each add must include `type:"video"`, the source asset ID, exact `fromFrame`, `durationInFrames`, `sourceStartFromInSeconds`, `trackId:"V1"`, `fit:"contain"`, and `muted:true`. Build these master ranges at 30 fps:

```text
0–120     brand-hook placeholder or clean demo lead-in
120–360   source 00:24–01:10, select one 8-second action span
360–720   source 02:06–03:21, select one 12-second anchor span
720–1050  source 03:23–03:55, select one 11-second canvas span
1050–1290 source 06:27–08:59, select one 8-second collect/recreate span
1290–1500 source 09:06–09:47, select one 7-second integrations span
1500–1650 source 10:36–11:05 or clean timeline fallback, 5 seconds
1650–1800 brand-CTA placeholder
```

The `sourceStartFromInSeconds` values must be picked from inspected local frames, not from transcript text alone.

- [ ] **Step 2: Commit the validated source sequence**

Repeat the same `edit_item` call with `validateOnly:false`. Expected: eight contiguous 60-second spans on V1 with no gaps or overlaps.

- [ ] **Step 3: Apply clip-scoped zooms only where the UI is too small**

Use `browse_library category:"zoom"` and add a `builtin:zoom` track effect to the relevant clips. Keep magnification within 1.15–1.8 for normal UI. Do not animate crop fields frame by frame.

- [ ] **Step 4: Read back V1**

Use `read_project view:"track"` with the actual V1 ID. Verify item order, duration, source offsets, and that source audio is muted.

- [ ] **Step 5: Render representative timeline frames**

Call `view_timeline_frames` in one request for frames `30, 180, 480, 840, 1170, 1380, 1560, 1740`. Inspect every returned image pixel-by-pixel. Record pass/fail per frame in the trace.

- [ ] **Step 6: Fix framing failures and re-render only failed frames**

Adjust fit/zoom/placement with `edit_item`. Re-run `view_timeline_frames` for failed frame numbers. Expected: each frame has one obvious focal region and no error/waiting state.

- [ ] **Step 7: Commit the visual rough-cut trace**

```bash
git add docs/marketing/2026-08-01-nomi-launch-film-production-trace.md
git commit -m "docs(marketing): verify Nomi visual rough cut"
```

## Task 5: Add one representative brand Motion Graphic, then the batch

**Files:**
- Modify: `docs/marketing/2026-08-01-nomi-launch-film-production-trace.md`

- [ ] **Step 1: Read the target hook frame and active design style**

Use `view_timeline_frames` at frame 30 and `manage_design_style action:"get"`. Confirm the hook is a full-frame brand beat.

- [ ] **Step 2: Author one 120-frame full-screen hook Motion Graphic**

Use `mcp__chatcut__create_motion_graphic_from_code` with 1920×1080, 120 frames, transparent background disabled, exact Chinese hook text as editable properties, Nomi colors, and canonical fonts. The memorable mechanism is a coral directing line that turns the word “猜” into a framed shot; no glow or glass card.

- [ ] **Step 3: Place the hook on V3 and verify three states**

Add the asset at frame 0 on V3. Render frames `8, 60, 108` and inspect entrance, settled state, and exit.

Expected: text has no overlap or clipping; the settled frame reads at phone scale; the motion completes before frame 108.

- [ ] **Step 4: Create the remaining two full-frame MGs only after the representative passes**

Create:

- a 45-frame section bridge around frame 1290: `Bring your own stack / 接入你的工作流`;
- a 150-frame CTA at frame 1650: `下载开源版` as primary and `团队定制 · 集成 · 贴牌` as secondary.

Use the same palette, fonts, coral directing line, and hard editorial timing. Do not reuse an identical card layout.

- [ ] **Step 5: Verify the MG batch as composed frames**

Render frames `1320, 1710, 1780`. Compare with hook frame 60. Expected: one coherent visual family with different compositions matching each editorial job.

- [ ] **Step 6: Record asset/item IDs and frame-review findings**

Append all MG asset IDs, item IDs, editable property keys, and screenshot verdicts to the trace.

## Task 6: Generate approved narration, music, captions, and restrained SFX

**Files:**
- Modify: `docs/marketing/2026-08-01-nomi-launch-film-production-trace.md`

- [ ] **Step 1: Present Chinese and English voice auditions**

Read the ChatCut voice catalog, show 2–4 Chinese Doubao voices and 2–4 English ElevenLabs voices through `mcp__chatcut__ask_followup_questions`, and wait for concrete `voiceId` selections. Do not generate TTS before selection.

- [ ] **Step 2: Generate Chinese narration as beat-level assets**

Call `submit_voice` once per approved beat group using the chosen Doubao voice. Use a restrained documentary/product delivery, approximately 0.96–1.02 speed. Wait on the returned generation job IDs once, then record the audio asset IDs.

- [ ] **Step 3: Place narration on A1**

Add each audio asset on A1 at its matching beat start. Use short audio fades only when joins click. Read back A1 and verify no overlap.

- [ ] **Step 4: Generate one music bed**

Call `submit_music` exactly once with:

```text
Minimal warm electronic pulse for a crafted software product film, tactile organic percussion, confident forward motion, no vocals, no trailer boom, unobtrusive under narration, clean ending at about 60 seconds.
```

Place the completed asset on A2, trim to 60 seconds, add a 1.2-second fade-out, and rely on A1 `anchor` / A2 `follower` roles for ducking.

- [ ] **Step 5: Add only three library SFX categories**

Use `browse_library category:"sound-effects"` for a short paper/line reveal, a subtle UI confirmation, and a soft final resolve. Place at hook, integration bridge, and CTA only. Do not generate custom SFX unless the library lacks a suitable sound.

- [ ] **Step 6: Enable and style captions from A1**

Use `edit_captions action:"enable"`, then scope to A1 with `source_set`. Apply:

```json
{
  "font":"DM Sans",
  "sizePx":58,
  "color":"#FFFDF9",
  "highlightColor":"#E7795F",
  "highlightUnit":"off",
  "shadowStrength":42,
  "maxLines":2,
  "maxCharactersPerLine":14,
  "pacing":"auto",
  "displayMode":"single"
}
```

Place at bottom-center with safe offset. Use semantic page breaks only after reading `read_captions` pages.

- [ ] **Step 7: Verify audio-dependent visuals and captions**

Read A1/A2/A3 and caption pages. Render frames around every caption page boundary and each SFX event. Expected: captions never cover the focal UI; music is ducked under narration; no duplicated caption source.

## Task 7: Complete Chinese master QA and export

**Files:**
- Modify: `docs/marketing/2026-08-01-nomi-launch-film-production-trace.md`

- [ ] **Step 1: Structural timeline audit**

Use staged `read_project` calls for timeline, every track, caption source, and each MG item. Verify exactly 1800 frames, no unintended gaps/overlaps, correct role routing, and no source audio leak.

- [ ] **Step 2: Full visual contact-sheet audit**

Call `view_timeline_frames` for at least two frames per beat plus every transition boundary. Inspect every returned image. Record P0/P1/P2 findings; fix all P0/P1 issues before export.

- [ ] **Step 3: User-visible playback checkpoint**

Keep the ChatCut editor open on `01-CN-Master-16x9` and tell the user to press Play. This is the one approval checkpoint before variant production and export.

- [ ] **Step 4: Submit the Chinese master export after approval**

Call:

```json
{
  "format":"video",
  "codec":"h264",
  "resolution":"1080p",
  "fps":30,
  "name":"Nomi-Launch-Film-CN-16x9",
  "timelineId":"c995e3a0-b174-4736-b7aa-e86b3aa72b58",
  "projectId":"e972cb0b-b0bf-4c14-98ab-25093c2d0475"
}
```

through `submit_export`, then use `track_export` after the returned wait interval.

- [ ] **Step 5: Download and inspect the exported MP4**

Save collision-safely to `/Users/aoqimin/Downloads`. Use `ffprobe` to verify H.264, 1920×1080, 30 fps, about 60 seconds, and one audible audio stream. Extract a final contact sheet for read-only inspection and record the export render ID and local path.

- [ ] **Step 6: Commit the completed QA trace**

```bash
git add docs/marketing/2026-08-01-nomi-launch-film-production-trace.md
git commit -m "docs(marketing): verify Chinese Nomi launch master"
```

## Task 8: Derive English, vertical, silent-web, and subtitle deliverables

**Files:**
- Modify: `docs/marketing/2026-08-01-nomi-launch-film-production-trace.md`

- [ ] **Step 1: Duplicate the approved Chinese master**

Use `manage_timelines action:"duplicate"` four times to create:

```text
02-EN-Master-16x9
03-CN-Social-9x16
04-EN-Social-9x16
05-Web-Hero-Silent
```

- [ ] **Step 2: Replace Chinese narration and captions in the English master**

Generate beat-level English TTS using the selected ElevenLabs voice. Replace A1 assets atomically, switch captions to the English source, and update editable MG copy. Do not change product claims or visual evidence.

- [ ] **Step 3: Recompose both 9:16 timelines**

Change each vertical timeline to 1080×1920 through `manage_timelines`. Reframe every product clip individually with contain/crop/zoom based on target-frame screenshots. Re-layout MGs and captions for vertical safe areas; do not center-crop the 16:9 master.

- [ ] **Step 4: Build the 12–15 second silent website loop**

Keep script→anchors→canvas→timeline proof only. Remove all audio and captions. Use no CTA longer than the final 1.5 seconds. Ensure the first and last frames can loop without a flash.

- [ ] **Step 5: Verify each variant independently**

Use `read_project` with explicit timeline IDs and `view_timeline_frames` for every variant. Check text language, aspect ratio, caption safety, focal UI, and timeline duration.

- [ ] **Step 6: Export all approved variants and subtitle files**

Export H.264 1080p video for the four video variants. Export Chinese and English SRT from their respective timelines. Download every completed file collision-safely to `/Users/aoqimin/Downloads` and verify metadata.

- [ ] **Step 7: Final trace and commit**

Record every timeline ID, render ID, file path, duration, resolution, and final screenshot verdict.

```bash
git add docs/marketing/2026-08-01-nomi-launch-film-production-trace.md
git commit -m "docs(marketing): deliver Nomi launch film variants"
```

## Plan self-review result

- Spec coverage: all 12 spec sections map to Tasks 1–8; website and README remain deliberately excluded.
- Placeholder scan: clean; every implementation value is concrete or produced by a named prior tool step.
- Type consistency: ChatCut project ID, initial timeline ID, frame rate, 1800-frame duration, track roles, caption tool boundary, and export settings remain consistent throughout.
