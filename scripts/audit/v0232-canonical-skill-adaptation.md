# v0.23.2 技能真实执行适配（二轮）

工作树：`/Volumes/S7/AiWork/Projects/Nomi-upstream-v021-20260912`。

## 裁决与范围

- 不恢复旧 Agent 内核，不在技能层桥接旧 executor，不绕过统一任务执行、审批、rateLimit 或 provider probe。
- 本轮编辑 `scripts/check-gates-chain.mjs`、其新增测试、`electron/skills/creativeCapabilitySkills.test.ts`、新增 `canonicalSkillExecution.test.ts`、9 个自定义技能 SKILL.md 与交接文档。
- 随共享层新增无参 Creative 工具，又修复 `scripts/check-skill-tool-binding.ts`、`scripts/skill-tool-binding-lib.mjs`、`scripts/check-skill-tool-binding.node-test.mjs`：从真实空对象 schema 派生无参状态，删除只认一个名字的硬编码豁免；未知 / 非对象 / 有字段的 schema 不得混过空转防线。
- package.json 仅编辑 scripts：删除已无目标文件的 check:archetype-sources、check:handbook、build:handbook、check:audit；将仍有效的 check:archetype-defaults、check:third-party 接回 gates:contracts。
- 编辑前后对非 scripts 顶层字段做 SHA-256 对比，一致；未改依赖、锁文件、共享模型枚举、backend 或 frontend。
- 全程未暂存、提交或结束合并；未跑全量 gates。

## 门禁链修复

103 个 check:* 全部可达。没有新增豁免：

1. sitemap 由官方 `scripts/check-site.mjs` 的真实 `SITE_STEPS` 执行。可达性检查读取该导出的执行清单，不把注释或源码提及当作执行。
2. 对 SITE_STEPS 每个子命令独立比对目标文件和 flags，不能从其他子命令借 flag；仅在真实 node 入口命令下展开，echo 提及不算。
3. 已删除的四个 package script 目标均不存在；其余 package scripts 中的 scripts/ 文件目标扫描无缺失。
4. third-party 普通审核实际接链；发布专用检查保留第一轮已有的 release profile 语义。

## 31 个旧工具名的具体差异

对比基线：custom snapshot `19a130dca` 中 9 个自定义技能的 skill.json。原工具并集 31 个；本轮这 9 个技能的工具并集改为 13 个：

`look_at_canvas`、`look_at_media`、`list_models`、`read_script`、`write_script`、`make_artifact`、`draft_shots`、`generate`、`check_job`、`cancel_job`、`stage_shot`、`read_timeline`、`edit_timeline`。

| 旧工具 | 当前工作流与等价边界 |
|---|---|
| read_canvas_state | look_at_canvas，读取当前画布的真实节点身份。 |
| create_canvas_nodes | 生成类内容改为 draft_shots；手写文本 / 表格改为 make_artifact，不做无条件名字替换。 |
| set_node_prompt | 修改已有生成草稿时用 draft_shots + operationId / shotId；不是任意旧节点 prompt 写入口。 |
| list_capability_recipes | list_models 只覆盖模型、模式与参数查询，不冒充配方 / CreativeResource 目录。 |
| apply_capability_recipe | 独立图像编辑、九机位、5 / 25 情绪图、新图生视频可经 draft_shots → generate → check_job；不等价于裁图、联系表拆分、3D 重建或已有视频再编辑。 |
| save_creative_resource | make_artifact 仅保存可读来源 / 身份 / 风格说明；不是资源库注册，保留用户控件路径。 |
| handoff_model3d | 不等价；当前技能不宣称自动向 Blender / Scene3D 导入，保留模型来源与交接资料。 |
| create_staging_reference | stage_shot 的 staging 分支，必须绑定真实镜头；不是创建或编辑任意既有 Blender 场景。 |
| arrange_storyboard_to_timeline | read_timeline → edit_timeline，使用实际生成素材身份和当前修订。 |
| read_project_summary | read_script + look_at_canvas + look_at_media 读取相应事实，不冒充旧导演内核的聚合状态对象。 |
| read_film_bible | read_script 读取文稿中的 Film Bible；不能声称读了旧结构化 store。 |
| read_storyboard | read_script / look_at_canvas 读取当前文稿和镜头，再沿用真实草稿身份。 |
| read_shot_spec | 当前镜头原始创作字段与提示词；不伪装旧 ShotSpec API。 |
| read_asset_registry | look_at_media 查询真实项目素材；没有旧导演 revision 选择 / 归档语义。 |
| read_provider_capabilities | list_models，使用目录实际返回的模式与参考槽。 |
| read_task_status | check_job，任务域与 jobId 必须来自实际 taskRef。 |
| propose_film_bible_patch | 先给可读修改建议；用户要求落实再 write_script。不是旧结构化提案协议。 |
| propose_storyboard_plan | draft_shots 的镜头和 storyboard 字段，得到真实可编辑草稿。 |
| propose_shot_patch | draft_shots 修订已有草稿，沿用操作与镜头身份，只传待改字段。 |
| propose_generation_plan | draft_shots 建立生成草稿，不能把草稿保存当作已生成。 |
| propose_timeline_assembly | read_timeline 后规划，再通过 edit_timeline 在 Host 审批下执行。 |
| apply_film_bible_patch | write_script 修改当前创作文档，不修改旧导演 Film Bible store。 |
| apply_storyboard_patch | draft_shots 修改当前分镜草稿，不冒充旧 store 的补丁 API。 |
| create_asset_records | 真实生成的产物由统一 materializer 登记；技能不编造或手写旧资产注册表。 |
| select_asset_revision | 没有精确等价；引用用户选定的真实素材不等于变更旧 revision 选择。 |
| archive_asset_revision | 没有精确等价；不以删除节点 / 素材替代归档。 |
| place_assets_on_timeline | read_timeline → edit_timeline，保留真实素材与修订校验。 |
| submit_generation_intent | generate 作用于真实草稿；是否开始、拒绝或仍待决定取决于回执，不直接调用 provider。 |
| cancel_provider_task | cancel_job，沿用任务返回的 domain / jobId，不从节点猜任务身份。 |
| read_vibing_director | 暂不依赖正在整合的 Creative 组件；look_at_canvas 与用户提供的场景资料不是内部对象库读取的替代品。 |
| apply_vibing_director_plan | stage_shot 只覆盖镜头站位 / 运镜参考，make_artifact 只保存计划；不等价于应用 Blender 对象编辑、渲染或保存工程。 |

## 保留的真实可用部分

- 九机位是 9 张显式图像编辑草稿，各自保留同一原图的素材身份，不声称自动拼成或拆开九宫格。
- 情绪矩阵是 1 / 5 / 25 张显式草稿，每张写坐标和同一人物参考，不把旧配方控件名当模型参数。
- 人像真实化与风格迁移通过实际图像编辑模式和参考槽；未授权改变项写入提示词，不伪造模型开关。
- 全景使用目录实际支持的画幅；精确裁成 2:1 和接缝验收不因提示词成立而自动通过。
- 视频支持当前真实图生视频路径；已有视频的时序再编辑不能自动降级成首帧动画。
- Cinematic 用文稿记录 Film Bible、以新草稿表达 ShotSpec，并查询任务与编辑时间轴；不写旧内核专属状态。
- Vibing 保存导演计划、生成站位 / 运镜参考；没有执行凭据就不说 Blender 已编辑或工程已保存。
- 所有原有 canvas recipeIds / inputs / 阶段方法继续保留，未把尚不能自动完成的步骤删出方法论或伪装为已完成。

## 执行验证的层级

`electron/skills/canonicalSkillExecution.test.ts` 不是工具名 / frontmatter 测试：

1. 读取实际技能声明，构造其受支持流程的 1 / 9 / 25 张草稿。
2. 通过真实 VERB_DECLARATIONS schema 和 verbToTransportCall。
3. 进入 createPiGenerationTransportAdapter、createGenerationPlanningHandler 与 ProductionRun service。
4. 使用真实生产 repository 写入临时项目，再重新打开 repository 读回。
5. 核对输出数量、模型身份、提示词、参考素材 contentHash / version，并确认草稿阶段没有 provider jobs。
6. 后续加入未知素材拒绝及 generate 的待确认检查；最终结果以最新测试输出为准。

该层使用隔离模型目录和 Host 已验证租约的测试输入，验证真实传输与持久化代码，不验证网络 provider、真人 GUI 确认或 Blender。不能把它称为付费生成 / Blender 端到端验收。

## 跨 agent 依赖

- 主线程已在 `electron/shared/skillProvider.ts` 的 `skillProviderKindSchema` 加入 model3d，本 agent 未扩 scope 修改它。
- 并行新增的 Creative 组件位于 `creativeComponent.ts` / `creativeComponentSchemas.ts` / `verbs/creativeVerbs.ts`、`laneCreativeTools.ts`，并通过 `laneDesktopTools.ts` 装配。这不是恢复旧 Agent 内核。
- 新组件协议明确要求 generationStarted=false、autoResubmit=false；配方动作只能返回 planned / awaiting_paid_confirmation / cancelled。
- 观察时 renderer `src/workbench/capability/creativeToolExecute.ts` 仍返回旧原始结果，且其配方路径尚未使用新 policy 禁止直接生成。必须由对应 agent 对齐 request policy 与 result envelope 后再依赖它，不能只因 6 个名字进目录就宣布能力可用。
- 并行装配曾因 apply_capability_recipe 的 outputs[].shotSize.description 含中文触发 assertEnglish，来源为新的 creativeComponentSchemas；后续该描述已改为英文，但最终是否还有其他装配不变量需重新验收。

## 本轮验证记录

- 第一轮复现：技能测试仍为 299 通过 / 13 失败；model3d 当时尚未被测试进程读到。
- 共享枚举修复及 canonical 工作流适配后：技能 + 门禁链测试 315 / 315 通过（当时未包含新持久化测试）。
- 新增持久化测试首次暴露 fixture 的素材解析函数误收一个参数，修正为真实 `(projectId, assetId)` 签名后 6 / 6 通过。
- 随后加上未知素材拒绝 / generate 待确认检查时，共享注册表正在并行更新，测试在 import 阶段被上述英文描述不变量中断；该次不是执行断言失败，也不算最终通过。
- 门禁链命令保持 103 个 check 全部可达；package scripts 本地文件目标无缺失。

## 最新稳定快照

- `pnpm exec vitest run electron/skills scripts/check-gates-chain.test.mjs --maxWorkers=1`：15 文件、325 测试通过，0 失败、0 跳过。包含新增 6 个真实传输 / 持久化测试的所有后续断言。
- 原有 13 失败已消除：共享 model3d 接入已由主线程修复，6 个技能的旧工具依赖已改为实际 canonical 工作流。
- 上述 6 个测试均验证 unknown asset 被拒绝（涉及参考图的流程）、重新读盘的输出数量与参考身份，以及 generate 返回 await_user 时 provider jobs 仍为空。
- scoped node 门禁判据初轮 34 测试通过；新增无参 schema 的两个正反例后再验收，最终统计见下。
- 门禁链 103 个 check 全部可达。package.json 非 scripts 字段再次校验与本轮编辑前一致。
- 范围内冲突标记无命中，diff --check 通过。未运行全量 gates、真实付费 provider 或 Blender GUI 验收。
- Creative 组件的共享层英文描述装配问题在这次稳定测试前已由对应 agent 修复；renderer result / policy 对齐仍属于跨范围整合，不因本轮 325 项绿灯而自动验收。
- MCP 工具引用检查通过源码 tsx loader 运行时仍被 `laneCodingTools.mts` → `laneToolContract.js` 的 `laneToolModelDescription` ESM/CJS 导出问题阻断；没有声称该全仓门禁通过，未越界改 native 装配。
