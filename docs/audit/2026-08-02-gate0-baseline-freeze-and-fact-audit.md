# Gate 0 — 基线冻结与事实审计

日期：2026-08-02
审计范围：`/Users/huawuer/Projects/Nomi-codex-director-upgrade` @ `95c6f915`（v0.18.1，AGPL-3.0-only）
对应目标架构：`docs/architecture/nomi-cinematic-agent-platform-target-architecture-2026-08-02.md` §27 Gate 0
状态：**Gate 0 交付物**（基线清单 + 重复/未验证声明清单 + 许可证 BOM 初稿 + 性能/内存基线）

> 本文严格遵守目标架构 §27 Gate 0 通过标准：「事实均有代码、真实 UI 或运行证据；未知项明确标记。禁止把 README、mock、历史测试或旧报告当现状。」
> 每条事实都标 `file:line` 证据。运行类证据带本次实际命令输出。docs/plans 与 docs/audits 只在「计划 vs 已实现」对比中被引用，不作为现状凭据。

---

## 0. 本次实际运行证据（新鲜，2026-08-02）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm run typecheck`（`tsc -p tsconfig.app.json && tsc -p electron/tsconfig.json`） | **PASS**（无输出，exit 0） |
| 单元测试 | `pnpm run test`（`vitest run`） | **4057 passed / 5 skipped，472 test files passed / 2 skipped**，耗时 155s |
| 测试文件计数 | `find electron -name '*.test.ts'` / `find src -name '*.test.ts*'` / `find tests/ux -name '*.mjs'` | 190 / 270 / 94 |
| HEAD | `git rev-parse --short HEAD` | `95c6f915`（merge: sync upstream and add Dreamina Seedance 2.5） |

注：`tests/ux/*.mjs`（Playwright `_electron` e2e）与真实 Provider smoke（`scripts/smoke-capability-recipes-real.mjs`，需 `NOMI_ALLOW_PAID_EVAL=1`）本次**未运行**——前者需打包应用，后者需真实凭据与计费授权。其最近一次有据可查的运行记录见 §5.4。

---

## 1. 系统现状清单（按目标架构领域逐项）

每行：领域 → 现状（PRESENT / PARTIAL / ABSENT）→ 关键证据 → 与目标架构的缺口。

### 1.1 Skill Runtime（§4.1, §7.3, §11）— **PRESENT**

| 能力 | 现状 | 证据 | 缺口 |
| --- | --- | --- | --- |
| Skill manifest schema | PRESENT | `electron/skills/skillManifestSchema.ts:98-128`：`name/version/description/tools[]/requiredProviders[]/permissions[]/inputs[]/examples[]/canvas{recipeIds,defaultRecipeId}/stages[]/author/label` | 目标 §11.2 的 read_*/propose_*/apply_*/付费 工具命名空间未对齐（见 1.3） |
| 阶段(stage) + 允许工具过滤 | PRESENT | `electron/ai/agentSkillRuntime.ts:73-122` `resolveAgentSkillExecution` 按 `manifest.stages` 当前阶段收窄 `allowedTools`；`filterAgentTools` ts:115-122 与注册工具集求交；`orderPlaybookStages` 做拓扑排序 | —— |
| 知识注入(SKILL.md→system prompt) | PRESENT | `electron/ai/agentSkillRuntime.ts:48-71`：skill body + 阶段硬约束块（`stage: i/total`、`goal`、`allowedTools`、"完成当前阶段后必须停止"）拼进 system | 目标 §11.1 还要求"结构化上下文(Film Bible/ShotSpec 读取)"与"验收器"——当前 ABSENT（Film Bible/ShotSpec 域对象不存在） |
| Skill 加载 + builtin 库 | PRESENT | `electron/skills/skillStore.ts:64-94` 扫 builtin+user root 读 SKILL.md+skill.json；16 个 builtin skill（`skills/*/skill.json`） | —— |
| 能力闸(missingProviders/Tools) | PRESENT | `electron/skills/skillCapability.ts:50-64` `reportSkillCapability` → `missingProviders/missingTools/satisfied` | —— |
| Skill 级 run state 持久化 | **ABSENT** | run state 仅在 Canvas 节点层与 backend PlaybookRun 层分别存在（见 1.2），Skill 自身不持久化 run | 需统一持久 run 记录（目标 P5 长任务是持久 job） |

### 1.2 Canvas Skill 节点（§8.2, §8.3）— **PARTIAL**

| 能力 | 现状 | 证据 | 缺口 |
| --- | --- | --- | --- |
| 节点模型字段 | PARTIAL | `src/workbench/generationCanvas/skills/canvasSkillModel.ts:21-38` `CanvasSkillNodeState`：`inputs[]/stages[]/neededProviders/recipeIds/defaultRecipeId/outputNodeIds/runStatus/currentStageIndex/lastRunError` | 与目标 §8.2 基本对齐 |
| run 状态机 | PRESENT | `canvasSkillModel.ts:138-191`：`beginCanvasSkillStage→running`、`completeCanvasSkillStage→done/awaiting-confirm/ready`、`failCanvasSkillStage→error`；陈旧阶段守卫 ts:169 | **存在两套并行状态机**（backend `PlaybookRun` `electron/skills/playbookOrchestrator.ts:103-164` + client 节点层），未统一 |
| ShotSpec 绑定 | **ABSENT** | 全仓 grep `ShotSpec` 仅命中目标架构文档；节点按 `recipeIds`/`outputNodeIds`（裸 canvas 节点 id）绑定，无 shot 维度 | 目标 §8.2/§9.1 的镜头中心化未实现 |
| 结构化 ReferenceBinding | **ABSENT** | 仅有边 `mode` 集合（`electron/capabilityCore/canvasGraph.ts:64-71`）与 archetype slot（§1.4），无 `ReferenceBinding{assetId,revisionId,role,strength,required}` | 目标 §9.2 未实现 |

### 1.3 Agent Harness（§11）— **PARTIAL**

| 能力 | 现状 | 证据 | 缺口 |
| --- | --- | --- | --- |
| 真实 tool-calling harness | PRESENT | `electron/ai/agentChatV2.ts:209-252` `makeAgentTool`（tool-call→awaitToolConfirmation→tool-result/error）；`electron/ai/agentLoop.ts:52-102` `runAgentLoop`（Vercel AI SDK streamText/generateText，maxSteps、maxRetries:3、单次 createToolCallRepair 自愈、Anthropic ephemeral cache、history 截断/压缩） | —— |
| 权限矩阵(propose/apply/paid) | PARTIAL | `src/workbench/generationCanvas/agent/gate.ts:30-61` `TOOL_META`：每工具标 `{writes,destructive?,costy?}`；`evaluateGate` ts:67-87 三步（policy→invariant→ask） | 无批量授权覆盖多镜付费、无审计里的预估/实际费用字段、无 per-revision select/archive 闸（目标 §11.3） |
| 审计 trace | PRESENT | `electron/events/agentChatTrace.ts`：`tool.proposed/completed/error`、`proposal.approved/rejected`（带 `effectiveArgs/overridesDelta/proposalId/txnId`）、`gate.denied`，causal 链 | 审计缺费用字段 |
| §11.2 目标工具集对齐 | **大部分 ABSENT** | 现有工具为 canvas 变更导向（`read_canvas_state/propose_storyboard_plan/update_storyboard_shot/create_canvas_nodes/connect_canvas_edges/set_node_prompt/run_generation_batch/...`，`electron/ai/canvasTools.ts:430-599`） | `read_project_summary/read_film_bible/read_storyboard/read_shot_spec/read_asset_registry/read_task_status/read_evaluation_report`、`propose_film_bible_patch/propose_shot_patch/propose_generation_plan/propose_timeline_assembly`、`apply_film_bible_patch/apply_storyboard_patch/create_asset_records/select_asset_revision/archive_asset_revision/place_assets_on_timeline`、`submit_generation_intent/cancel_provider_task/download_provider_result/run_optional_gpu_evaluation` —— 全部 ABSENT（仅命中目标文档） |

### 1.4 Provider 接入层（§12）— **PARTIAL**（命名与目标不同；能力对象 ABSENT）

> 关键事实：目标架构 §9.4 的 `ProviderCapabilities`、§9.5 的 `GenerationIntent`/`CompiledProviderRequest`、§12.2 的 `ProviderAdapter{compile/submit/query/cancel/download}` 接口在**源码中不存在**（grep 全仓零命中）。实际是一套**声明式模板/catalog 引擎**。

| 子系统 | 现状 | 证据 | 缺口 |
| --- | --- | --- | --- |
| Provider Catalog | PARTIAL | `electron/catalog/types.ts:139-443`：`Vendor/Model/Mapping/HttpOperation`；seed `electron/catalog/seedBuiltins.ts`；持久 `model-catalog.json`（当前空 `{"version":8,"vendors":[]}`） | 无 §9.4 能力对象（modes/referenceRoles/maxReferences/maxOutputs/aspectRatios/resolutions/durationsSeconds/supportsSeed/supportsNegativePrompt/source/verifiedAt 全 ABSENT 或散落 `Model.meta`+archetype+Mapping）；**无真实 API 探测**——能力来自硬编码 + onboarding-agent 从文档摘录 |
| Provider Compiler | **ABSENT** | 无 `compile(intent,capabilities)`；`GenerateIntent`(`electron/capabilityCore/core.ts:30`) 只是粗粒度 `'image'|'video'|'text'|'audio'` 路由；请求构造=模板渲染 `electron/ai/requestPipeline.ts` `buildHttpRequest` + `{{}}` 占位符 | 目标 P2 意图与执行分离未实现 |
| Adapters | PARTIAL | 一个通用 profile 引擎 `electron/tasks/profileTaskExecution.ts`；约 14 个 provider：Codex Img2(local CLI, `electron/catalog/codexImagegen.ts`+`runtime.ts:222`)、即梦Web/Dreamina(browser-bridge, `electron/jimengWeb/seedanceBridge.ts`)、AGNES、Volcengine、ComfyUI、RunningHub、Kie、APIMART(relay)、ModelScope、Replicate、Dreamina-CLI、Doubao TTS | **无** 智谱/Kimi/MiniMax/Veo/Sora/Luma/Vidu 专用 adapter（仅经 APIMART relay）；**cancel 仅 Codex+ComfyUI**（`electron/main.ts:589-599` 非 codex 直接返回 `{cancelled:false}`） |
| Task Router/Job Manager | PRESENT | `electron/runtime.ts:209` `runTask` 中央分发；renderer 调度器 `src/workbench/generationCanvas/runner/generationProviderScheduler.ts`：global max 8、默认 per-provider 4、Codex/jimeng 2；主进程限流 `electron/vendorSubmissionRateLimiter.ts`（持久 `provider-submission-rate-limits.json`，agnes:video 60s/image 6s） | 目标 §16.2 "默认并发上限 2" 与实际不符（实际全局 8 / 默认 4） |
| 预算闸 | PARTIAL | `electron/spendGrant.ts` token-grant：`assertAndConsumeSpendGrant` 每次 vendor 提交前硬闸（`runtime.ts:229/298/348/363/429`），`DEFAULT_MAX_ATTEMPTS_PER_NODE=3` TTL 30min；任务准入 `electron/tasks/taskAdmission.ts` 24h LRU | **无** `maxCostCny`/`maxSubmissions` 批量预算上限——200 节点批可发 200 次提交；批量只受并发约束不受成本约束 |
| 参考图语义角色 | PARTIAL | 边 mode `canvasGraph.ts:64`(`reference/first_frame/last_frame/style_ref/character_ref/composition_ref`)；archetype slot `src/config/modelArchetypes/types.ts:14`(`first_frame/last_frame/image_ref/video_ref/audio_ref/source_video`)；匹配器 `src/workbench/generationCanvas/agent/referenceEdgeCapability.ts` | 缺 `identity/scene/prop/costume/motion` 角色；无 `strength/required/revisionId` |
| 模型下拉过滤 | PARTIAL | `src/config/modelCatalogCache.ts` `getEnabledVendorKeys:75`（enabled 且 (authType none 或 hasApiKey)）→ 防 ghost；`filterHiddenOptionsByKind:32`；健康层 `src/config/modelCatalogStatus.ts:31` | 无 region 过滤、无 mode 过滤、无参考数量/参数过滤（参数在选模型后按 archetype 反应式出现） |
| Provider 任务状态机 | PARTIAL | `electron/tasks/responseParsing.ts:9` `TaskStatus = "queued"|"running"|"succeeded"|"failed"` | 缺 `created-local/awaiting-confirmation/submitting/downloading/cancelled/unknown`；cancelled 折叠进 failed；`downloading` 无独立态 |

### 1.5 提交幂等与任务可靠性（§10.2, §16）— **PARTIAL**

| 不变量 | 现状 | 证据 | 缺口 |
| --- | --- | --- | --- |
| 进程内幂等台账 | PRESENT | `electron/submissionLedger.ts:35` `dedupeSubmission(key,fn,{ttlMs})`；`submissionLedger.ts:69` 进程级 `Map`；`submissionLedger.ts:80` `runTaskWithIdempotency` 读 `payload.request.extras.idempotencyKey`；IPC 闸 `electron/main.ts:577-582`（query 路径 `:583` 故意不裹）；TTL 5min after settle，上限 1000 | —— |
| create 与 poll 严格分离 | **PRESENT**（铁律守住） | create=`runTask`(`runtime.ts:209`)；poll=`waitForCatalogTaskResult`(`src/workbench/generationCanvas/runner/catalogTaskActions.ts:377`) + `fetchTaskResult`(`electron/tasks/taskResultQuery.ts:188`)，均只查；poll 失败/超时只抛 `RecoverableTimeoutError/AbortError`→映射 `recoverable` 态（**不重试**）；重试循环复用同一 `run.id`→台账回放同一 Promise | 钱安全注释 `catalogTaskActions.ts:398-401` 明确"轮询只查不提交" |
| 幂等跨重启持久化 | **ABSENT** | 台账是 `Map`，进程退出即空；全仓 `find . -name "ledger.jsonl"` 零命中；`taskCache`(`runtime.ts:171`) 注释"重启即空"；spend grant 同样是 `Map`(`spendGrant.ts:24`) | 目标 §20 `tasks/ledger.jsonl` 未实现；§21.5 SLO"重启后 10s 内恢复 submitted/queued/running/unknown 任务"未实现 |
| 节点级结果恢复 | PARTIAL | `src/workbench/generationCanvas/runner/recoverTaskActions.ts:21` `buildRecoverPayload` 从 `node.runs[0].taskId` 重建 query（**只查不提交**，无 spend grant、无确认）；`taskResultQuery.ts:34` `rebuildCachedTaskFromPayload` 从 4 字段重建 → "重启后仍可拉回"（注释 `:44`） | 仅用户手动点"取回"触发；submitted/queued/running 跨崩溃**不自动恢复** |
| unknown 态不自动重发 | PARTIAL | 无 `submission-unknown` 专用分支；保证来自"poll 不创建 + 台账"的涌现属性；`taskResultQuery.ts:204-216` `classifyTaskCacheMiss` 区分"准入后被驱逐"vs"真未知 id"，只返回诊断态不调 runTask；`recoverTaskActions.ts:50` 无 taskId 时置 `error/recoverable.missingTask` 而非重生成 | 无显式 receipt-lost 处理；5min 台账 TTL 后同 key 重试会再执行 fn（潜在二次扣费窗口，虽 controller maxAttempts 默认 3 在 ~2s 内） |
| 下载失败只重试下载 | **ABSENT** | 输出下载无重试：`electron/assets/downloadAsset.ts:31` 单次 `net.fetch`；`electron/assets/projectAssetStore.ts:202` `hardenedFetch`（60s/200MB，无重试逻辑）；临时 URL 过期无刷新（仅输入参考图有 `assetLocalization.ts:22` 48h 刷新） | 目标 §24 download 类"只重试下载不重生成"未实现 |
| cancel | PARTIAL | 见 §1.4（仅 Codex+ComfyUI） | 其余 provider `remoteCancelled:false` 硬编码 |

### 1.6 Storyboard 与领域模型（§8.2, §9.1）— **PARTIAL**

| 能力 | 现状 | 证据 | 缺口 |
| --- | --- | --- | --- |
| 提案→确认流程 | PRESENT | `src/workbench/generationCanvas/agent/runStoryboardPlanner.ts:16-66`：仅允许 `read_canvas_state`+`propose_storyboard_plan`，写/破坏/付费工具被拒（`evaluateGate:58-62`）；确认后 `storyboardPlanToCreateNodesArgs`(`storyboardPlan.ts:550-652`) 转 `create_canvas_nodes` | 整批 plan 一把出，无 per-shot `propose_shot_patch` 增量 |
| ShotSpec v1 字段（§9.1 逐项） | **~30% PRESENT** | `PlanShot`(`storyboardPlan.ts:39-96`) + LLM schema(`canvasTools.ts:118-148`) | **ABSENT**：`id/projectId/sceneId/version`、`narrative{intent,beat,conflict,informationRevealed}`、`time.startState/endState`、结构化 `subjects{assetId,role,performance,dialogue}`、`environment{sceneAssetId,propAssetIds,costumeAssetIds,spatialRelations}`、`cinematography{lensMm,apertureIntent,composition,blocking,screenDirection,lighting,color}`、`actionChain[]`、`sound{sfx[],ambience,musicIntent}`、`continuity[]`、`acceptanceCriteria[]`、`selectedImageRevisionId/selectedVideoRevisionId`、`status`。<br>**PRESENT**：`index/durationSec/characters/performance/dialogue/scene/props/shotSize/cameraAngle/cameraMove(自由文本)/sound/notes` + per-shot `modelKey/variantId/modeId/params` |
| Film Bible / Asset Registry / Task Ledger / Evaluation Report / GenerationIntent 域对象 | **全 ABSENT** | 全仓 grep（src/electron）零源码命中 | 目标 §7.2/§11.4 真相源未建；最接近 Film Bible 的是扁平 `facts` 块注入 system prompt(`agentChatV2.ts:606-612`) |

### 1.7 Asset Revision / Registry（§17, §20）— **ABSENT**

- 无 `AssetRevision` 类型、无 `selectedImageRevisionId/selectedVideoRevisionId` 指针、无 `registry.json`。
- 唯一"revision"概念是节点级历史指针 `rollbackNodeHistory`(`src/workbench/generationCanvas/model/graphOps.ts:147`，按 `resultId` key)，**非** per-asset revision 模型（无 compare/select/rollback/archive 操作）。
- 目标 §17 非破坏 revision 与 §20 `revisions/<asset-id>/<revision-id>/` 结构未实现。

### 1.8 Blender Director（§14）— **PARTIAL（rich）**

| 能力 | 现状 | 证据 | 缺口 |
| --- | --- | --- | --- |
| 声明式 plan schema（受约束 action，非任意 Python） | PRESENT | agent 侧 Zod 区分联合 `electron/ai/vibingDirectorTools.ts:12-85` `canonicalActionSchema`（`set_stage/set_blocking_layout/place_asset/add_marker/move_object/remove_object/set_relation/remove_relation/set_camera/set_camera_path/set_beat`，上限 24）；标识符正则显式阻 URL/文件路径(`:10`)；Python 侧 `integrations/blender/agent-harness/cli_anything/blender/core/manifest.py:16-23` 固定枚举 + 数值边界，原子持久化带 undo/redo(上限 30) | —— |
| Runner/sidecar + 生命周期清理 | PRESENT（3 个 runner） | VIBING `electron/blender/vibingDirectorRunner.ts:349` `runVibingDirectorBlenderPlan`（`--background --disable-autoexec --python-exit-code 1`，超时钳 1s–10min 强杀，输出上限 64KB）；legacy `directorCli.ts:177`、`blenderRunner.ts`；`cancelAllVibingDirectorBlenderPlans:454`+`cancelAllDirectorBlenderRenders:287` 接 `before-quit`(`main.ts:751-772`) SIGTERM→3s→SIGKILL | —— |
| 输出回传 | PARTIAL | `VibingDirectorBlenderResult`(`vibingDirectorRunner.ts:65-84`)：preview.png + scene.blend + scene.glb(经 `inspectGlb` 校验) + `previewCamera`(position/lookAt/fov/aspectRatio/framing/targetRef) + `spatialReport`(facing/distance/support/offset/line_of_sight 实测 vs 期望) + `objectTransforms` | **无** camera.json 文件、**无** focal length/sensor 字段、**无** 相机路径/关键帧回传（路径是输入 action 非输出）、**无** 预演视频（仅单帧 still）、**无** asset provenance 文件（仅 Kenney 资产有 catalogAssetId/sha256） |
| ShotSpec 闭环 | **ABSENT** | `VibingDirectorBlenderRequest`(`vibingDirectorRunner.ts:54-63`) 仅 `directorNodeId/plan/assets`，无 `shotId`；闭环是 **directorNode→plan→Blender→回 directorNode**，非 shot 粒度 | 目标 §14.2/§14.3 的 ShotSpec→Blender 闭环未实现 |
| 人工修改后增量继续 | PARTIAL | `VibingDirectorEditor.tsx:160` 接 `existingBlendRelativePath` 复用已有 .blend；Blender runner 不覆盖人工变更（重读工程摘要） | 无 ShotSpec 维度的"镜头级"增量 |

### 1.9 Timeline（§19）— **PARTIAL**

- `src/workbench/timeline/timelineTypes.ts:7-23` `TimelineClip`：`id/type/sourceNodeId/label/startFrame/endFrame/...`，**无 `shotId`、无 `revisionId`**（clip 绑的是生成画布节点，非 shot/revision）。
- 三轨 image/video/audio（`:4`）；text overlay 是独立 `TimelineTextClip` 层（`:35-47`）非轨。
- 放置逻辑 `timelineEdit.ts`；shot↔timeline 桥仅"把生成节点当前结果 URL 推上时间线"(`sendGenerationNodeToTimeline.ts`/`sendStoryboardToTimeline.ts`)，不盖 shotId/revisionId。
- `renderManifest.ts:44` 自陈缺口："Timeline model only exposes image/video clips; audio/text/overlay/effect/keyframe entities are not first-class timeline tracks yet."

### 1.10 导出（§19.3）— **PRESENT（mature）**

| 能力 | 现状 | 证据 | 缺口 |
| --- | --- | --- | --- |
| immutable render manifest | PRESENT | `electron/export/exportManifest.ts:5-18` `NomiRenderManifestV1`；校验 `assertValidManifest:221-255`（含资产引用完整性、偶数尺寸、绝对路径要求）；renderer 侧 builder `src/workbench/export/renderManifest.ts`；每 job 快照进 job 目录 | —— |
| 离开 React render loop | PRESENT | 全在 Electron main：`electron/export/exportJobs.ts:198` `startExportJob→planExport→ExportJobManager.createJob`；IPC `nomi:exports:start-job`；renderer 只发 manifest+可选 WebM 临时块 | —— |
| 原子 MP4 + FFmpeg runner | PRESENT | `electron/export/ffmpegRunner.ts`（进度/abort/`-progress` 解析、`.partial.mp4`→rename）；`ffmpegCommandBuilder.ts`、`ffmpegFiltergraph.ts`(366 行)、`mediaProbe.ts`(ffprobe) | —— |
| 退出清理 + 孤儿回收 | PRESENT | `abortAllActiveExports`(`exportJobs.ts:256`) 接 `before-quit`；崩溃遗留 active job 在 hydrate 时回收为 failed(`exportJobManager.ts:256-276`) | —— |
| planner 策略 | PARTIAL | `exportPlanner.ts:3-8`：`ffmpeg-direct/ffmpeg-filtergraph/ffmpeg-webm-transcode/remotion-frame-render/webm-fallback` | `remotion-frame-render` 仅路由名，后端未实现（headless/offscreen frame renderer 文件不存在） |

### 1.11 OpenTimelineIO（§19.2）— **ABSENT**

- 全仓（src/electron/package.json）grep `otio`/`OpenTimelineIO`/`opentimelineio` 零命中。无依赖、无 import/export round-trip。timeline 互操作面仅内部 `NomiRenderManifestV1`。

### 1.12 自动验收（§18）— **ABSENT（按 Gate A/B/C/D 分类） / PARTIAL（按既有 5 层 eval）**

- 无 Gate A/B/C/D（pre-request/technical/semantic/continuity）模型，该分类源码零命中。
- 既有的是 `docs/plan/2026-06-11-eval-system-master-plan.md` 的 **5 层 eval 系统**（L0 确定性 vitest / L1 agent 端态 / L3a 技术自检），实现于 `evals/loop/`(`loop.ts/driver.ts/scorers.ts/...`)+`evals/lib/`(`grading.mjs/judge.mjs/vbenchRubric.mjs/...`)；命令 `eval:run/score/diff/baseline/view/judge-calibrate/journey` 齐(`package.json:52-62`)。
- LLM-judge 校准代码在(`evals/lib/judge.mjs`)，但 `evals/judge.config.json` **磁盘不存在**（对应文档"待用户填便宜档 key"）→ judge 校准评分**未生效**。
- master plan 自标"v3（已施工完毕）"，除 S3 校准（待 key + ≥10 标注）外 S0–S6 done。

---

## 2. 重复实现 / 平行真相源 / 隐藏 fallback / 巨壳模块（目标 §4.3, §26.1）

| 项 | 证据 | 风险 |
| --- | --- | --- |
| **两套 Skill 状态机** | backend `PlaybookRun`(`electron/skills/playbookOrchestrator.ts:103-164`) 与 client 节点 `CanvasSkillNodeState`(`canvasSkillModel.ts:138-191`) 并行 | 状态漂移、陈旧推进 |
| **三个 Blender runner** | `vibingDirectorRunner.ts`(主)、`directorCli.ts`(legacy Python harness)、`blenderRunner.ts`(legacy scene 渲染) | 三套 IPC(`nomi:scene3d:render-blender/render-director-blender` + `nomi:vibing-director:apply-blender-plan`)、三套清理路径，维护面大 |
| **能力声明散落三处** | `Model.meta`(`catalog/types.ts:161`) + archetype(`src/config/modelArchetypes/*`) + `Mapping`(`types.ts:332`) | 无单一能力真相源；下拉过滤/编译/校验各读不同处 |
| **能力/参考角色两套** | 边 mode(`canvasGraph.ts:64`) 6 种 vs archetype slot(`modelArchetypes/types.ts:14`) 6 种，命名不同（`character_ref` vs `image_ref`） | 角色映射易错 |
| **任务状态两套** | 后端归一化 `TaskStatus`(`responseParsing.ts:9`) 4 态 vs 前端节点 `idle/queued/running/success/error`(`capabilityCore/core.ts:165,480,498`) | cancelled/downloading/unknown 在两套里都不存在或折叠 |
| **timeline clip 双重身份** | clip 绑 `sourceNodeId`（生成节点）而非 shot/revision；shot↔timeline 桥只推当前 URL | 目标 §19.1"clip 带 shotId+revisionId"未实现 |
| **export planner 幽灵后端** | `remotion-frame-render` 仅路由名，无实现 | UI/manifest 暗示能力但无后端 |

---

## 3. 未验证声明清单（目标 §27 Gate 0 禁止项：把 README/mock/历史日志当现状）

| 声明来源 | 声明 | 实际（代码/运行证据） | 结论 |
| --- | --- | --- | --- |
| `docs/plan/2026-07-10-codex-blender-director-bridge.md` | "implemented and locally verified" | 代码确在（manifest.py/blender_cli.py/directorCli.ts），但**真实 Blender 回传质量**未在本次验收（`vibingDirectorRunner.real.test.ts` 3 test **skipped**） | **代码存在，真机质量未验** |
| `docs/plan/2026-07-11-vibing-director-agent-workspace.md` Task 4 | Agent 工具组 `read_vibing_director/apply_vibing_director_plan` | 代码在(`vibingDirectorTools.ts:178`) | 已实现 |
| `docs/audit/2026-07-18-gate8-real-provider-acceptance.md` | 17/18 授权、16 确认远程提交、CNY 0.00 | 是 2026-07-18 旧记录；本次未重跑（需凭据+付费授权） | **历史记录，非本轮证据**——不可当现状引用为"已验收" |
| `docs/audit/2026-07-14-comprehensive-test-system.md` | Vitest 2612 passed | 本次实测 **4057 passed**（代码增长后） | 旧数已过时，以本次 4057 为准 |
| `docs/audit/perf/01..06`（2026-06-22） | 性能"基线" | 文档自陈"只读源码追真相源 + 机制推演，本文未做真机量测"(`06:4`)；真机 harness(`tests/ux/perf.e2e.mjs`/`memory.e2e.mjs`) 存在但 **fixture 是 96 节点/156 边/20 clip，非 200/400**；结果 JSON 文件 mtime 同步为 Jul 5 | **非可引用的性能基线**；200 节点 SLO 无证据 |
| `model-catalog.json` | catalog 内容 | 当前 `{"version":8,"vendors":[]}` 空——seed 在运行时 reconcile | 静态文件不代表运行态 |
| `docs/architecture/nomi-production-video-export-architecture-2026-05-24.md` Milestone A `[ ]` 项 | 未完成 | 实际 `ExportJobManager/ffmpegRunner/exportManifest.ts` **已实现** | **文档陈旧**——代码已超前文档 |
| `docs/legal/third-party-assets.json:26,30` | mannequin = "Apache License 2.0"，url 指向 repo LICENSE | repo `package.json:5`/`LICENSE` 已是 **AGPL-3.0-only**（2026-08-01 切换） | **许可证记录过期且矛盾**，发布前必修 |

---

## 4. 许可证 BOM 初稿（目标 §22.4 六类）

当前 repo license：**AGPL-3.0-only**（`package.json:5` + `LICENSE` 头；来源 `docs/audit/2026-08-01-upstream-45-compatibility-license-audit.md` 确认 45-commit upstream 范围内由 Apache-2.0 切换；历史 v0.18.1 及更早仍 Apache-2.0）。

| # | 类别 | 状态 | 证据 / 缺口 |
| --- | --- | --- | --- |
| 1 | 源代码许可证 | **PRESENT** | AGPL-3.0-only；依赖扫描（MIT/Apache/BSD/ISC；ffmpeg LGPL/GPL 独立可执行；`@imgly/background-removal`=Unknown；`socks@2.8.9` MIT）见 `docs/audit/2026-08-01-...md` |
| 2 | 模型权重许可证 | **ABSENT** | catalog(`electron/catalog/*.ts`) 列 vendor/model 但**无权重许可条款**记录；审计文档未覆盖 |
| 3 | 训练/评测数据许可证 | **ABSENT** | `evals/datasets`/`evals/fixtures` 无数据许可声明（仅 fixture 图，无 license 头） |
| 4 | 生成内容平台条款 | **PARTIAL** | `docs/legal/THIRD_PARTY_ASSETS.md` 提及 Seedance 扩展"无声明/用户责任"、Poly Haven API 非商用；**无** 按 OpenAI/火山/即梦/RunningHub/Kenney 等平台 ToS 汇总 BOM |
| 5 | 电影帧/音频/字体版权 | **ABSENT** | 无 BOM 类目；字体来自 `@fontsource-variable/inter`+`fraunces`(OFL，`package.json:31-32`) 但未在 legal 文档枚举；无电影帧/音频清权 |
| 6 | 3D 资产许可证（§22.4） | **PARTIAL** | `docs/legal/third-party-assets.json` 3 项：`scene3d-nomi-mannequin`(bundled，**标 Apache-2.0 但 repo 已 AGPL——矛盾**)、`seedance2-chrome-extension`(external，无声明)、`kenney-furniture-kit-1.0`(CC0，SHA-256 pin，8MB 上限，GLB 提取 allowlist)；Poly Haven/Quaternius/BlenderKit 显式延后人工导入 |
| 闸 | release 阻断闸 | PRESENT | `scripts/check-third-party-assets.mjs`（`check:third-party`/`:release`，接 `dist`），`releasePolicy:"blocked"` 时失败；当前 0 阻断 |

**发布前必修**：mannequin 许可证记录与 repo AGPL-3.0 矛盾；类别 2/3/5 全空。

---

## 5. 性能与内存基线（目标 §21）

### 5.1 既有 harness（PRESENT，但 fixture 规模不达目标）

| harness | 文件 | 实测能力 | 缺口 |
| --- | --- | --- | --- |
| 性能 harness | `tests/ux/perf.e2e.mjs` | 注入探针测 `fps/longTasks/longTaskMs/maxFrameGapMs`（三场景 canvas-pan/zoom/timeline-play，`PerformanceObserver`+rAF） | —— |
| 内存 harness | `tests/ux/memory.e2e.mjs` | 进程树 RSS（`readProcessTreeWorkingSet:32-55`，**仅 Windows**，用 PowerShell `Get-CimInstance Win32_Process`）+ CDP `Performance.getMetrics`(jsHeapUsed/Total) + DOM 节点/图片/视频计数 + 资产资源；`killProcessTree:237` | **macOS/Linux 无 RSS**(`!==win32` return null)；heap 是点采样非 `.heapsnapshot` |
| fixture 生成 | `tests/ux/fixtures/gen-perf-fixture.mjs` | `TARGET_NODES=96` + `EXTRA_CROSS_EDGES=40` + `TIMELINE_CLIPS=20`（≈156 边） | **目标 §21.1 是 200 节点/400 边——fixture 不达标** |
| 结果归档 | `tests/ux/perf-results/*.json` | ~45 份快照（`memory-final-default-heavy.json` 等）；mtime 同步为 Jul 5 | 非本轮新鲜 |
| 孤儿进程检查 | PRESENT | `kill:zombies`(`pkill -f electron`)；`terminateAllCodexImagegenProcesses`(`codexImagegenRunner.ts:135`，接 `before-quit main.ts:757`)；`abortAllActiveExports`(`main.ts:766`)；export job hydrate 回收孤儿(`exportJobManager.ts:256-276`) | —— |

### 5.2 静态性能审计（`docs/audit/perf/01..06`，2026-06-22）

**只读源码推演，非量测**（文档自陈）。识别的 P0/P1 机制：
- pan/zoom 经 React state（`useCanvasViewport.ts:26`）
- playhead 每帧重建 timeline 对象（`timelineEdit.ts:476`）
- 未 memo 的 `CanvasEdgeLayer`/`CanvasMinimap`
- `Scene3DFullscreen.tsx:671` `frameloop="always"`
- 静态产物尺寸：`three-vendor` 688KB/~177KB gzip、`r3f-vendor` 464KB/~150KB gzip、catalog JSON 105KB、CSS 295KB/45KB gzip

### 5.3 目标 §21.5 SLO 达成情况

| SLO | 证据状态 |
| --- | --- |
| 画布交互 p95≤50ms（200 节点/400 边） | **无证据**——fixture 仅 96 节点 |
| 长任务连续 60s 主线程 >100ms long task 为 0 | harness 可测，**无本轮新鲜结果** |
| 内存回收 30 次循环后 heap ≤+20% | harness 可测，**无本轮新鲜结果** |
| 付费幂等同一 key create 恒为 1 | 单测覆盖（`submissionLedger.test.ts`），**非 200 节点压测** |
| 任务恢复重启 10s 内恢复 | **未实现**（§1.5） |
| 技术验收损坏/空文件检出率 100% | **Gate B 未实现**（§1.12） |
| 导出 12 镜 9:16 1080p 连续 3 次可播放 | export harness 在，**无本轮新鲜结果** |

### 5.4 既有最近真机/Provider 证据（**历史，非本轮**，仅作存在性参考）

- `docs/audit/2026-07-18-gate8-real-provider-acceptance.md`（2026-07-18）：17/18 授权、16 远程提交、CNY 0.00、无凭据打印。
- `docs/audit/2026-07-14-comprehensive-test-system.md`：Vitest 当时 2612 passed；cold-start 8/8；export 32/32；journey J2/J4/J3/J5 2/2；J6 真实生成 passed。**本次重测为 4057 passed（已增长）。**

---

## 6. Gate 0 通过判定（对照 §27 Gate 0）

| 通过标准 | 是否满足 |
| --- | --- |
| 当前架构/功能/Provider/任务/画布/Blender/导出清单 | **✅ 满足**（本文 §1，全 file:line 证据） |
| 旧入口、重复实现、未验证声明清单 | **✅ 满足**（本文 §2、§3） |
| 许可证 BOM 初稿 | **✅ 满足**（本文 §4，六类逐项 + 矛盾标记） |
| 性能与内存基线 | **✅ 满足**（本文 §5，含本轮 typecheck/test 实测 + 既有 harness 清单 + SLO 缺口） |
| 事实均有代码/真实 UI/运行证据；未知项明确标记 | **✅ 满足** |
| 禁止把 README/mock/历史测试/旧报告当现状 | **✅ 满足**（§3 逐条标注历史 vs 本轮） |

**Gate 0 交付完成。** 本文即为目标架构 §27 Gate 0 的四项交付物合订。

---

## 7. 进入 Gate 1 的最高优先级缺口（为后续 plan 铺路，非 Gate 0 范围）

按目标架构 P1–P10 原则与 §3.3 缺口表，Gate 1「统一领域模型」需先解决：

1. **建立域对象**：`FilmBible`/`ShotSpec`/`ReferenceBinding`/`GenerationIntent`/`AssetRevision`/`ProviderTask`/`EvaluationReport`/`TimelineManifest`（当前全 ABSENT）。`PlanShot` 是迁移起点。
2. **单一 selected revision 指针**（§17）：从节点级 `rollbackNodeHistory` 升级为 per-asset revision + compare/select/rollback/archive。
3. **Provider 能力统一**（§9.4）：把散落 `Model.meta`+archetype+`Mapping` 收敛为单一 `ProviderCapabilities`，并补 `verifiedAt`/`source`（区分硬编码 vs 文档摘录 vs 真实探测）。
4. **两套状态机统一**：Skill 的 backend `PlaybookRun` 与 client 节点 `CanvasSkillNodeState` 合一。
5. **任务状态机扩展**（§10.2）：补 `created-local/awaiting-confirmation/submitting/downloading/cancelled/unknown`，cancelled 不再折叠进 failed。
6. **幂等持久化**（§20 `tasks/ledger.jsonl`）：台账从 `Map` 落盘，支撑重启恢复 + unknown 不重发。
7. **ShotSpec↔Blender 闭环**（§14.2）：`VibingDirectorBlenderRequest` 加 `shotId`，把 directorNode 闭环升级为 shot 闭环。
8. **timeline clip 加 `shotId`+`revisionId`**（§19.1）。
9. **安全缺口**：`exportModelCatalogPackage({includeApiKeys:true})` IPC 剥离/加闸（§1.x security）；browser bridge 加目标站点/端口 allowlist（§22.3）。
10. **许可证 BOM 补全**（§4 类别 2/3/5）+ 修 mannequin 矛盾。

> 这些是 Gate 1+ 的输入，**不属于 Gate 0 交付**。Gate 0 到此为止。

---

## 8. Gate 1 进度回写（2026-08-02，Gate 1 实施中）

Gate 1 实施计划已批准并执行中。以下 §7 缺口项的状态更新（含本轮代码证据）：

| §7 缺口项 | Gate 1 后状态 | 证据（本轮新增/修改） |
| --- | --- | --- |
| 1. 域对象建立 | **部分闭合**（类型骨架就位；迁移函数就位；尚未接入 UI/工具） | `src/workbench/domain/cinematicTypes.ts`（FilmBible/ShotSpec/ReferenceBinding/GenerationStrategy/GenerationIntent/AssetRevision/ContinuityConstraint 全 v1 类型）；`cinematicSchema.ts`（zod + drift guard）；`shotSpecMigration.ts`（planShotToShotSpec 双向映射 + migrateStoryboardPlanShots） |
| 2. 单一 selected revision 指针 | **闭合**（复用 history[]，新增 select/archive/reject） | `generationCanvasTypes.ts` GenerationNodeResult 加 revisionStatus/parentRevisionId/sha256/costCny 等；`graphOps.ts` 新增 selectRevision/archiveRevision/rejectRevision（§17.1 不覆盖：旧 revision 不删） |
| 3. Provider 能力统一 | **部分闭合**（只读投影就位；尚未替换下拉/编译的直读） | `electron/catalog/providerCapabilities.ts` projectCapabilities 从 catalog+archetype 聚合 §9.4 形状；source/verifiedAt 诚实标注（verifiedAt 恒 null） |
| 4. 两套状态机统一 | **未闭合**（延后至 Slice 7 收尾或 Gate 2） | —— |
| 5. 任务状态机扩展 | **闭合**（cancelled 独立；unknown 加入 + 不重发守卫） | `responseParsing.ts` TaskStatus 加 cancelled/unknown + isTerminalStatus/isFailureStatus；`runtime.ts` TaskResult.status 同步扩展；`profileTaskExecution.ts` unknown+taskId→queued 细化 |
| 6. 幂等持久化 | **闭合**（ledger.jsonl + 重启不重发） | `electron/tasks/idempotencyStore.ts`（IdempotencyStore + 24h TTL + SubmissionReplayError）；`submissionLedger.ts` runTaskWithIdempotency 接持久台账（重启同 key 拒绝重执行） |
| 7. ShotSpec↔Blender 闭环 | **未闭合**（延后至 Gate 4） | —— |
| 8. timeline clip shotId+revisionId | **闭合**（optional 字段，向后兼容） | `timelineTypes.ts` TimelineClip 加 shotId?/revisionId? |
| 9. 安全缺口 | **未闭合**（延后至 Gate 7） | —— |
| 10. 许可证 BOM 补全 | **未闭合**（延后至 Gate 7/9） | —— |

**Gate 1 本轮代码净增/修改**（截至本节写入时）：
- 新增：`src/workbench/domain/{cinematicTypes,cinematicSchema,shotSpecMigration}.ts`（+测试）、`electron/catalog/providerCapabilities.ts`（+测试）、`electron/tasks/idempotencyStore.ts`（+测试）、`src/workbench/timeline/timelineClipShotRevision.test.ts`、`src/workbench/generationCanvas/model/graphOpsRevision.test.ts`。
- 修改：`generationCanvasTypes.ts`（GenerationNodeResult 扩展）、`graphOps.ts`（revision 操作）、`responseParsing.ts`+`responseParsing.test.ts`（TaskStatus 扩展）、`runtime.ts`（TaskResult.status）、`profileTaskExecution.ts`（unknown 细化）、`submissionLedger.ts`（持久台账接入）、`timelineTypes.ts`（clip 字段）。

**测试**：本轮 Gate 1 新增 62 个测试（domain 29 + providerCapabilities 15 + responseParsing 新 6 + idempotencyStore 9 + graphOpsRevision 9 + timelineClip 2，去重后），全部通过；既有 1867 generationCanvas/project + 1650 electron 测试无回归。

---

## 9. Gate 2 进度回写（2026-08-02，Gate 2 实施完成）

Gate 2「电影导演组件与 Agent Harness」代码骨架交付完成（见 `docs/audit/2026-08-02-gate2-completion-evidence.md`）。

§7 缺口项状态更新：

| §7 缺口项 | Gate 2 后状态 | 证据 |
| --- | --- | --- |
| 1. 域对象建立 | **闭合**（类型骨架 + 迁移 + 读取器就位） | Gate 1 类型 + Gate 2 `shotSpecReaders.ts`（readStoryboardAsShotSpecs/readShotSpec/readFilmBibleView/readProjectSummary） |
| 3. Provider 能力统一 | **闭合**（投影就位） | Gate 1 `providerCapabilities.ts`（§9.4 投影） |
| 4. 两套状态机统一 | **闭合**（同步函数就位；接入运行回路留下一轮） | Gate 2 `playbookStateSync.ts` syncCanvasSkillFromPlaybook + detectPlaybookDrift |
| §11.2 工具集重命名 | **部分闭合**（映射层 + 分类就位；harness 注册留下一轮） | Gate 2 `semanticAgentTools.ts`（25 语义名 → 既有工具映射，9 implemented / 12 projected / 4 deferred） |
| §11.3 权限矩阵 | **闭合**（语义入口就位） | Gate 2 `gate.ts` evaluateSemanticToolGate + gateDecisionForCategory |

**Gate 2 测试净增**：+56（4182 总，0 回归）。typecheck 通过。
