# Creative Capability Product Gaps Implementation Plan

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> **For Codex:** Use the implementation-builder and Executing Plans skills to implement this plan task by task while the project remains at Gate 8.

**Goal:** Turn the existing creative-recipe technical slice into a visible, honest, provider-verified, visually measurable, and recoverable product workflow without advancing to Gate 9.

**Architecture:** Keep `CapabilityRecipe` as the provider-independent contract shared by the canvas and Agent. Add runtime exposure, media-specific contracts, deterministic quality analyzers, and evidence records around that contract instead of adding provider branches to the UI. Blender remains a consumer of serialized director and model state; provider calls remain spend-confirmed and rate-limited.

**Tech Stack:** Electron, React 18, Zustand, TypeScript, Vitest, Playwright Electron, Sharp/browser canvas, Three.js, Blender Python, provider adapters.

---

## Gate Boundary

- Current gate: Gate 8, AI capability integration.
- Allowed: model calls, prompts, eval cases, cost checks, safety checks, provider smoke tests, Blender smoke tests.
- Forbidden: unreviewed production launch, release publication, Gate 9 advancement, bypassing spend confirmation.
- Required artifact: an updated AI Capability Slice audit with repeatable evidence.
- Completion rule: passing TypeScript or unit tests alone is not product acceptance.

## Progress Snapshot - 2026-07-17

- Tasks 1-5, 7-9 的本地产品底座已落地并有单元、构建、Electron 或 Blender 证据。
- Task 6 的零费用 smoke、脱敏报告、费用上限、频率控制和失败诊断已完成；新的付费 Provider 输出仍需用户逐批批准。
- `image.style.transfer` 已补齐源图/结果图/风格参考图的本地质量报告，覆盖画幅、内容结构和风格移动代理。
- `image.multiview.custom` 已补齐机位槽位、图片完整性、空图、尺寸、重复视角和独立单帧封装报告。
- 文件体积门禁已从仅扫描 tracked 文件改为扫描 tracked 加 untracked、排除 ignored，防止新源码绕过 800 行限制。
- 模型目录已修复空连接集合误放行全部内置模型的问题；缺 KIE/RunningHub 时配方仍可选择，并显示 HappyHorse `video-edit` 或 Enterprise-Shared 图生 3D 接入指引，保存供应商后抽屉原位刷新。
- 生成画布 Agent 已补齐统一配方工具的选择规则、图片/视频/3D 类型边界、资源许可和 GLB 回交规则；分镜表每行可直接选择“基于图片”或“基于视频”打开对应节点的创作能力。
- 批量设置、框选批量生成、分镜批量生成和 Agent `run_generation_batch` 已统一为非破坏版本分叉；确认前不创建版本，确认后 V2/V3 继承输入并重接版本链，旧结果、旧参数和旧下游不覆盖。
- 最终本地门禁：360 files passed、2 skipped；3120 tests passed、4 skipped；Renderer/Electron build 通过。
- 最终创作能力 Electron E2E：67 assertions，无 pageerror；证据在 `evals/runs/2026-07-16T19-19-13Z-capability-agent-storyboard-versioning-e2e/`。
- 内置 Skill 已补成第一类画布组件：技能库点击/拖放创建 `SkillNode`，素材端口可真实拖线到技能输入，配方与来源自动预选，输出追加回写且保留旧结果，Canvas Agent 路由复用现有能力执行链；补充 Electron E2E 为 75/75 assertions、无 pageerror。
- 最终当前模型目录零付费复核：8 项配方找到兼容模型，v2v 2 项与图生 3D 1 项给出结构化阻塞；`providerCalls=0/0`，证据在 `evals/runs/2026-07-16T19-22-22Z-capability-recipes-final-zero-spend/`。
- real-smoke CLI 同时支持 `--key=value` 和标准 `--key value`，避免 `--run-dir` 被误解析成布尔值；策略回归测试 10/10 通过。
- 仍阻塞：新的付费视觉样本、已连接的 `source_video` v2v 模型、已连接的真实 image-to-3D Provider。零费用诊断已分别给出 KIE HappyHorse 和 RunningHub 3D 候选；项目继续停留在 Gate 8。
- 多视角视觉复核不再被本地模型识别阻塞：当前 Doubao Seed 2.0 Lite/Pro 已进入候选，下一个外部步骤是经用户确认执行一次真实批量复核并保留身份、几何和 token 证据。
- 即梦 CLI/Web 参考素材边界已拆清：CLI 保留图/视频/音频，全能参考；Web 使用独立受限档案并类型化传输图/视频，音频在提交前引导到 CLI。混合参考不会再静默丢视频，但参考视频仍不等同 `source_video` 视频编辑。跨层回归 283/283、隔离 Electron 91/91，0 Provider 调用。
- VIBING Director 的真实 Blender 视觉复核发现并关闭一个空间关系假通过：旧 `offset` 只保存位置差，角色执行 `facing` 后两把椅子仍各偏 38.66°，但报告错误显示通过。现在关系保存完整相对位姿、`facing` 先于 `offset`，位置和朝向分别设阈值并写入结构化报告；最终 `.blend` 读回两项误差均为 0。真实 Blender 3/3、聚焦测试 57 passed/1 skipped、隔离 Electron 26/26 通过，证据在 `evals/runs/2026-07-17T12-26-00Z-vibing-director-real-relative-transform-final/` 与 `evals/runs/2026-07-17T12-40-00Z-vibing-director-relative-transform-e2e/`。
- 外部 Agent 接入已收口到当前改造版：MCP 状态按 command、app args 和 stdio 环境精确匹配，旧 checkout 显示“需更新”，一键更新保留其它 server；Codex 与 Claude Code 本机配置已迁移并备份。能力核广告按 owner PID 清理，后台 stdio transport 不再被误判为第二个 GUI。
- 迁移后当前目录零费用复核仍为 8 项可检查、v2v 2 项和图生 3D 1 项结构化阻断，0/0 Provider 调用；隔离 Electron 正常退出且无残留。证据：`evals/runs/2026-07-17T12-47-45Z-capability-recipes-live-single-instance/`。
- 自动质量报告新增独立人工视觉验收记录：通过/拒绝与 500 字备注进入项目持久化和撤销历史，不覆盖自动状态、检查项或其它 collection；旧项目兼容。聚焦质量链 52/52、全量 Vitest 3201 项、隔离 Electron 96/96 通过，0 Provider 调用。证据：`evals/runs/2026-07-17T13-12-10Z-capability-human-review-e2e/`。

## Baseline Truth Table

| Capability | Contract exists | Stable UI | Real provider evidence | Visual acceptance | Product status |
| --- | --- | --- | --- | --- | --- |
| Nine-view grid | Yes | Experimental | No paid grid run | Split/order only | Incomplete |
| Custom cameras | Yes | Experimental | One Codex image run | Single-frame check | Partial |
| Image to 3D | Yes | Experimental | No full GLB loop | No editable-scene check | Incomplete |
| 2:1 panorama | Yes | Experimental | No retained smoke | Center crop only | Incomplete |
| Portrait realism | Yes | Experimental | No retained smoke | Prompt controls only | Incomplete |
| 5x5 mood | Yes | Experimental | No retained smoke | Prompt controls only | Incomplete |
| Image style | Yes | Experimental | No retained smoke | Resource readiness only | Incomplete |
| Video look | Image-to-video wrapper | Experimental | No retained smoke | No temporal check | Mislabelled/incomplete |
| Video effect reference | Image-to-video wrapper | Experimental | No retained smoke | No temporal check | Mislabelled/incomplete |
| VIBING Director | Separate state and Blender bridge exist | Visible node | Focused tests exist | Spatial reliability unproven | Partial |

## Acceptance Matrix

Every recipe must satisfy all applicable columns before the Gate 8 product audit can pass.

| Recipe | Input contract | Provider smoke | Output contract | Quality checks | Failure evidence | Cost/rate evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `image.multiview.grid9` | One identity/object source | One real supported model | Nine ordered views | identity, view diversity, no duplicate panels | retained report and contact sheet | one request plus local split |
| `image.multiview.custom` | Source plus explicit cameras | At least two camera definitions | One frame per requested camera | framing, requested azimuth/elevation, no collage | retained report | bounded parallel fan-out |
| `image.multiview.reconstruct3d` | Source image | Real 3D provider | valid GLB | parseable mesh, non-empty bounds, preview | provider and import diagnostics | one confirmed 3D request |
| `scene.panorama.2to1` | Image or prompt source | Real panorama-capable path | exact 2:1 equirectangular image | seam, poles, projection ratio | quality overlay/report | one confirmed request |
| `portrait.refine` | Portrait with detectable face | Real image model | non-destructive new version | identity similarity, skin texture, artifact checks | before/after report | one confirmed request |
| `portrait.mood` | Portrait plus mood coordinate | Real image model | labelled mood result | identity similarity, expression distinction | matrix report | controlled subset before 25-cell run |
| `image.style.transfer` | Image plus style/palette resource | Real image model | new image version | content retention, style adherence | before/after report | one confirmed request |
| `video.look.apply` | Source image plus style resource | Real compatible image-to-video model | playable video | duration, dimensions, motion continuity, look adherence | media probe/report | provider frequency control |
| `video.effect.reference` | Source image plus effect resource | Real compatible image-to-video model | playable video | temporal effect presence, continuity, no frozen output | media probe/report | provider frequency control |
| `video.edit.look` | Source video plus style resource | Real mode with `source_video` | playable edited video | source timing/motion retention, look adherence | media probe/report | provider frequency control |
| `video.edit.effect` | Source video plus effect resource | Real mode with `source_video` | playable edited video | source timing/motion retention, temporal effect presence | media probe/report | provider frequency control |

## Task 1: Source Runtime Exposure And Stable Entry

**Files:**
- Modify: `scripts/start-electron.mjs`
- Modify: `electron/preload.ts`
- Modify: `src/desktop/bridge.ts`
- Modify: `src/config/featureFlags.ts`
- Create: `src/config/featureFlags.test.ts`
- Modify: `src/workbench/generationCanvas/components/CanvasToolbar.tsx`
- Modify: `src/workbench/generationCanvas/components/GenerationCanvas.tsx`
- Modify: `src/workbench/generationCanvas/components/CapabilityRecipeInspector.tsx`
- Modify: `tests/ux/helpers/electronFixture.mjs`
- Modify: `tests/ux/helpers/electronFixture.test.mjs`
- Modify: `tests/ux/capability-recipes.e2e.mjs`

1. Add a pure feature-flag resolver and failing tests for build override, local override, source-run default, development default, and packaged default.
2. Mark repository `pnpm start` and isolated Electron tests as `NOMI_SOURCE_RUN=1`.
3. Expose only `{ sourceRun: boolean }` through preload; do not expose arbitrary environment variables.
4. Keep packaged builds default-off unless an explicit build or local override enables the slice.
5. Move the trigger into the stable left canvas toolbar and retain a disabled state when no source node is selected.
6. Remove the E2E localStorage enable call and assert that source runtime exposure is the reason the trigger appears.
7. Run focused unit tests, renderer/electron typecheck, build, and capability Electron E2E.

## Task 2: Honest Video Contracts

**Files:**
- Modify: `src/config/capabilityRecipes/index.ts`
- Modify: `src/config/capabilityRecipes/types.ts`
- Modify: `src/config/modelArchetypes/types.ts`
- Modify: `src/workbench/generationCanvas/agent/capabilityRecipeAgent.ts`
- Modify: `src/workbench/generationCanvas/runner/capabilityRecipePrompt.ts`
- Modify: `src/workbench/generationCanvas/components/CapabilityRecipeInspector.tsx`
- Test: focused recipe, compatibility, prompt, and Electron tests.

1. Write failing cases that reject a source video for an image-only mode and reject an image for a video-edit-only mode.
2. Represent mode intent and required source slots without inventing a provider transport that no adapter supports.
3. Rename image-to-video recipes in the UI so they do not imply video-to-video.
4. Expose video-edit variants only for archetype modes that declare `source_video` and edit intent.
5. Verify provider-specific request schemas against official provider documentation before adapter changes.

## Task 3: Nine-View Consistency Diagnostics

**Files:**
- Create: `src/workbench/generationCanvas/quality/multiviewQuality.ts`
- Create: `src/workbench/generationCanvas/quality/multiviewQuality.test.ts`
- Modify: `src/workbench/generationCanvas/runner/capabilityRecipePostprocess.ts`
- Modify: `src/workbench/generationCanvas/nodes/CapabilityResultCollection.tsx`

1. Validate exact panel count, dimensions, ordering labels, and non-empty panels.
2. Compute duplicate/similarity warnings using deterministic image fingerprints.
3. Record per-panel quality metrics and surface warnings without deleting outputs.
4. Add a visual evidence layout showing the source beside all nine labelled views.

## Task 4: Panorama Quality Diagnostics

**Files:**
- Create: `src/workbench/generationCanvas/quality/panoramaQuality.ts`
- Create: `src/workbench/generationCanvas/quality/panoramaQuality.test.ts`
- Modify: `src/workbench/generationCanvas/runner/capabilityRecipePostprocess.ts`
- Modify: panorama preview components.

1. Reject outputs that cannot produce an exact 2:1 image without destructive ambiguity.
2. Measure left/right seam difference over multiple vertical bands.
3. Measure pole concentration and obvious stretching at top/bottom bands.
4. Store a quality report and add seam/pole overlays to the panorama preview.
5. Keep the original provider output alongside any normalized derivative.

## Task 5: Portrait And Mood Identity Evaluation

**Files:**
- Create: `src/workbench/generationCanvas/quality/portraitIdentityQuality.ts`
- Create: `src/workbench/generationCanvas/quality/portraitIdentityQuality.test.ts`
- Add: before/after and mood-matrix preview components.

1. Add a local, optional face-region comparison contract with explicit unavailable state.
2. Display source/result side by side with synchronized zoom.
3. Record identity, skin-texture, and artifact warnings separately.
4. Run a small spend-confirmed mood subset before any 25-cell batch.
5. Mark results as unverified when identity metrics cannot run; never present prompt controls as proof.

## Task 6: Provider Smoke Harness And Evidence

**Files:**
- Modify: `scripts/smoke-capability-recipes-real.mjs`
- Add: sanitized reports under `evals/runs/`
- Modify: `scripts/eval-capability-recipes.ts`

1. Add recipe selection, dry-run, maximum spend attempts, cooldown, retry ceiling, and resumable evidence state.
2. Never log API keys, cookies, raw provider configuration, or account identifiers.
3. Persist dimensions, duration, provider/model identifiers, latency stages, attempts, cleanup status, and quality results.
4. Require explicit spend confirmation before each paid batch.
5. Run recipes in low-cost order and stop on frequency-limit signals instead of retry storms.
6. Accept both conventional space-separated CLI option values and `--key=value`; keep a zero-spend current-catalog report as the final blocker proof.
7. Treat `-h/--help` as a side-effect-free path before evidence directories, temporary profiles, media fixtures, or Electron are created.

## Task 7: Image To 3D Editable Loop

**Files:**
- Modify: `src/workbench/generationCanvas/agent/model3dHandoff.ts`
- Modify: Scene3D model import and preview code.
- Modify: Blender handoff IPC and runner code as required.
- Add: GLB validation and real Blender smoke tests.

1. Validate GLB magic, parseability, mesh count, bounds, materials, and texture references.
2. Import the GLB into Scene3D as an editable object with stable transform state.
3. Send the same asset and transform state to Blender.
4. Save a `.blend`, render a preview, return both artifacts, and reopen the editable project.
5. Verify process cancellation and cleanup on success, timeout, and user cancel.

## Task 8: Independent Conversational VIBING Director

**Files:**
- Audit and modify: `src/workbench/generationCanvas/nodes/vibingDirector/`
- Audit and modify: `electron/blender/vibingDirectorRunner.ts`
- Audit and modify: `electron/ai/agentChatV2.ts`
- Add: deterministic spatial-relation tests and real Blender smoke evidence.

1. Keep the director document as the source of truth and Blender as an editable preview/export target.
2. Require the Agent to inspect current state, explain a typed patch, and wait for confirmation.
3. Add relation constraints such as facing, distance, support/contact, line of sight, and camera target.
4. Resolve missing camera/object references before execution and report exact unresolved ids.
5. Support iterative chat changes against the same `.blend` rather than rebuilding from unrelated defaults.
6. Verify camera framing and object relations from returned preview evidence.

## Task 9: Integration, Performance, Recovery, And Audit

**Files:**
- Modify canvas, storyboard, Agent, persistence, and process-lifecycle modules only where evidence identifies a gap.
- Create: `docs/audit/2026-07-xx-creative-capabilities-product-acceptance.md`

1. Verify old projects load without migrations deleting nodes or results.
2. Verify every generation appends a version and supports selecting an earlier result.
3. Profile canvas render cost with result collections, panorama viewers, and 3D previews.
4. Confirm hidden/collapsed storyboard connections do not create unnecessary live media or Three.js contexts.
5. Verify all Codex, provider polling, Chrome extension, and Blender child processes clean up.
6. Run focused tests, full Vitest, lint, typecheck, builds, base Electron E2E, capability E2E, real provider smokes, and real Blender smoke.
7. Perform cost, safety, secret, license, and provenance review.
8. Produce a pass/blocked matrix. Do not advance Gate 9 without explicit user approval and stage-gate review.
