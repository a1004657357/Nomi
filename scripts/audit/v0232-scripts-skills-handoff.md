# v0.23.2 Scripts / Skills 合并交接

> 本文件是第一轮快照。第二轮 canonical 适配、package scripts 清理、31 个旧工具差异及最新验证见 `scripts/audit/v0232-canonical-skill-adaptation.md`。以下失败数和接线缺口不代表最新状态。

- 工作树：`/Volumes/S7/AiWork/Projects/Nomi-upstream-v021-20260912`
- 状态：已实现未推送；跨范围整合未完成，不能视为全绿或发布验收。
- 仅写 scripts、skills、electron/skills 和指定 guide；未改 catalog 的两个排除文件、backend、frontend、package.json 或索引。
- 未执行共享工作树的 git add、commit、abort，也未运行全量 gates。
- 本范围原有 19 个冲突路径已处理内容；未暂存，所以 Git 的 unmerged index 条目仍保留。

## 合并裁决

- 保留上游 frontmatter 唯一清单、统一 capability 授权与 Agentlane 工具契约；不恢复旧权限枚举、旧 playbook 运行器或裸 bearer 画布写入。
- 15 份 skill.json 的仍有效字段迁入 SKILL.md 后删除第二清单；保留 9 个自定义技能、配方绑定、结构化输入、阶段说明和示例。9 个自定义技能均显式允许在工作台选择。
- 旧工具名仅在语义对应时改用新动词；自定义配方 / Director 工具未伪装成其他工具，缺失注册继续报红。
- 保留角色 / 场景 / 关键道具提取；参考板通过当前 draft_shots 的 anchor / storyboard 结构表达。
- 保留上游严格 i18n 门禁与 type baseline，不恢复旧可见文案宽松基线，不增加体积白名单。
- 体积检查保留自定义未跟踪源码覆盖，结合上游 NUL 路径解析、mts/cts 支持与 locale 排除；补了含中文、空格、换行路径和未跟踪超长文件测试。
- 修复体积 CLI 在 macOS 临时目录符号链接路径下静默不执行的入口判断；801 行 mts/cts 必须真实返回失败。
- release 测试同时保留第三方资产许可检查与上游 canvas-full。发布专用豁免沿用 custom 既有语义；普通 check:third-party 缺链继续红。
- 用户技能迁移仍备份旧 JSON；额外保留既有 frontmatter、canvas 与 inputs，不从这些元数据派生授权。

## 文件清单

共 49 个实现 / 测试 / 技能路径，外加本交接文件。

### Scripts（8）

- scripts/check-file-sizes.mjs
- scripts/check-file-sizes.test.mjs
- scripts/check-gates-chain.mjs
- scripts/check-i18n-visible-text.mjs
- scripts/nomi.mjs
- scripts/nomi.test.mjs（新增）
- scripts/test-system.test.mjs
- scripts/test-types-baseline.json

### Electron Skills（10）

- electron/skills/builtinSkills.test.ts
- electron/skills/creativeCapabilitySkills.test.ts
- electron/skills/skillCapability.test.ts
- electron/skills/skillCuration.test.ts
- electron/skills/skillIpc.ts
- electron/skills/skillIpc.test.ts
- electron/skills/skillManifestSchema.ts
- electron/skills/skillManifestSchema.test.ts
- electron/skills/skillManifestMigration.ts
- electron/skills/skillManifestMigration.test.ts

### Skill Packages（30 个路径）

以下每个目录均修改 SKILL.md、删除迁移后的 skill.json：

- skills/brand-promo
- skills/creation-edit
- skills/creative-mood-identity
- skills/creative-multiview
- skills/creative-panorama
- skills/creative-portrait-realism
- skills/creative-style-resource
- skills/creative-video-deconstruction
- skills/creative-video-look-effect
- skills/workbench-cinematic-director
- skills/workbench-creation
- skills/workbench-fixation-planner
- skills/workbench-generation
- skills/workbench-storyboard-planner
- skills/workbench-vibing-director

### Guide（1）

- docs/guide/capability-core-cli-mcp.md

## 本轮验证

1. `pnpm exec vitest run scripts/nomi.test.mjs scripts/check-file-sizes.test.mjs scripts/test-system.test.mjs scripts/check-i18n-visible-text.test.ts electron/skills/skillIpc.test.ts electron/skills/skillManifestMigration.test.ts --maxWorkers=1`：6 文件、42 测试通过。
2. `node --test scripts/check-skills-format.node-test.mjs scripts/check-skill-tool-binding.node-test.mjs scripts/check-skill-ipc-coverage.node-test.mjs`：34 测试通过。
3. `node scripts/check-skills-format.mjs`：skills 97/97、agent-skills 3/3 经真实 pi 加载器通过。
4. `node --import tsx scripts/check-skill-tool-binding.ts`：97 技能正文通过。
5. `node scripts/check-skill-ipc-coverage.mjs`：4 通道全部匹配同步 / 异步协议。
6. `pnpm exec vitest run electron/skills --maxWorkers=1`：13 文件，299 测试通过、13 失败。7 个失败指向 model3d 枚举；6 个失败证明自定义创作工具未接入新 lane。未跳过或削弱这些检查。
7. 7 个相关 JavaScript 模块语法检查与 test-types JSON 解析通过；范围内 diff --check 通过，冲突标记扫描无命中。
8. `node scripts/check-gates-chain.mjs`：失败，6 个检查未接链，见下。
9. `node scripts/check-file-sizes.mjs`：失败，11 个 backend / frontend 文件超限，见下；未提高基线。
10. `node --import tsx scripts/check-mcp-tool-references.ts`：未完成，入口在加载 laneCodingTools.mts 时因 laneToolContract.js 的 laneToolModelDescription 导出解析失败。不是工具名检查已通过。

本机 tsx CLI 曾因沙箱不允许创建 IPC pipe 退出；后续使用 node --import tsx 避开 CLI 的额外 pipe。未修改 provider、模型或用户配置。

## 主线程需要整合

### Shared Provider

`electron/shared/skillProvider.ts` 的共享枚举缺少 model3d。技能 schema 已引用该唯一 owner，未另造本地枚举；creative-multiview 的真实加载因而 fail closed。需要在共享 owner 及其消费者完整补齐。

### 自定义工具接线

以下声明当前不在真实 LANE_MODEL_TOOL_CATALOG / LANE_DEFERRED_TOOL_CATALOG 中。需要接统一 CapabilityContract、动词声明、Host ceiling、执行端口及确认策略，不能只加名字或把 skill.tools 当授权。创作回归测试已切到真实新目录并保持红灯。

- 配方 / 资源：list_capability_recipes、apply_capability_recipe、save_creative_resource、handoff_model3d、create_staging_reference。
- Cinematic 读取：read_project_summary、read_film_bible、read_storyboard、read_shot_spec、read_asset_registry、read_provider_capabilities、read_task_status。
- Cinematic 提案：propose_film_bible_patch、propose_shot_patch、propose_generation_plan、propose_timeline_assembly。
- Cinematic 应用：apply_film_bible_patch、apply_storyboard_patch、create_asset_records、select_asset_revision、archive_asset_revision、place_assets_on_timeline、submit_generation_intent、cancel_provider_task。
- Vibing：read_vibing_director、apply_vibing_director_plan。

`nomi_render_director` 的自定义 MCP 入口与受约束参数说明保留在 guide；未恢复同名裸 bearer CLI 写路径。

### Package Gates

缺链：check:sitemap、check:handbook、check:archetype-defaults、check:archetype-sources、check:third-party、check:audit。其中部分目标脚本已被 upstream 删除；需要主线程和 catalog 负责人按新 ownership 处理 package 命令，不应在 check-gates-chain 增加免责来消红。

### 体积门禁快照

并行工作树持续变化，以下是本轮执行时的快照，不是最终整合后的计数：

- electron/assets/projectAssetStore.ts：843 > 800
- electron/capabilityCore/core.ts：803 > 800
- electron/capabilityCore/dispatcher.ts：803 > 800
- electron/main.ts：702 > 684
- electron/runtime.ts：498 > 485
- src/ui/onboarding/OnboardingDrawer.tsx：810 > 795
- src/workbench/capability/capabilityApplyHandler.ts：882 > 800
- src/workbench/generationCanvas/components/CapabilityRecipeInspector.tsx：802 > 800
- src/workbench/generationCanvas/nodes/scene3d/Scene3DFullscreen.tsx：849 > 800
- src/workbench/generationCanvas/runner/generationRunController.ts：813 > 800
- src/workbench/workbenchStore.ts：809 > 800

另有 vitest.config.ts 的重复 hookTimeout 警告，未越界编辑。

## 收尾边界

- 内容已可供主线程继续整合；索引未标记 resolved。
- 排除的 gen-archetype-wire-defaults.ts / archetype-sources-baseline.json 未修改。
- 未做真实 GUI / provider / Blender 运行验收；不能把格式通过、元数据保留或 focused 单测当作这些能力端到端可用。
