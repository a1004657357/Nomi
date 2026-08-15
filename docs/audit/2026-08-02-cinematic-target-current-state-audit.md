# Nomi 电影 Agent 目标架构当前状态审计

日期：2026-08-02 17:55 CST  
仓库：`/Users/huawuer/Projects/Nomi-codex-director-upgrade`  
分支：`codex/nomi-codex-director-upgrade-20260705`  
HEAD：`95c6f915`  
审计对象：当前未提交工作树，而不是 HEAD、README、历史报告或旧 renderer bundle。

## 1. 结论

当前不是“Gate 0–7 已完成、只差 Gate 8/9”，而是：

- 目标架构、资源研究、领域类型和多个独立模块已经写出。
- Agent Skill 的 manifest、阶段白名单和部分画布阶段流已实际接入。
- 17 个新增模块专项测试通过，当前全量 Vitest 通过。
- 但 Provider Compiler、质量门、OTIO、ShotSpec→Blender、200 节点性能和 Gate 8 harness 多数仍是旁路模块或脚手架。
- 当前 `gates`、lint、production build 和隔离 UI smoke 均失败。
- 跨重启幂等未初始化，当前用户数据目录没有 `tasks/ledger.jsonl`。
- 当前存在 7 个同仓库 Electron 主进程和 9 个 helper，共约 736 MB RSS。

按目标架构 §27 的通过标准，**Gate 0–7 没有任何一个可以在当前工作树上判定为完整通过**。最准确的阶段是：

> Gate 0/1/2 有实质实现，Gate 3–7 有部分代码骨架；正式验收仍停在 Gate 0 收尾，Gate 8/9 未进入。

## 2. 本轮新鲜验证

| 检查 | 本轮结果 | 判定 |
| --- | --- | --- |
| 新模块专项单测 | 17 files / 234 tests passed | PASS，仅证明模块内部逻辑 |
| 全量单测 | 491 files passed、2 skipped；4316 tests passed、5 skipped | PASS |
| TypeScript | `pnpm run typecheck` exit 0 | PASS |
| `pnpm run gates` | 在文件体积门失败 | FAIL |
| 文件体积门 | `CreationAiPanel.tsx` 837 > 800；`CanvasAssistantPanel.tsx` 887 > 基线 848 | FAIL |
| lint | 523 problems：425 errors、98 warnings | FAIL |
| production build | renderer build 失败：`src/i18n/index.js` 没有 default export | FAIL |
| 隔离 Goal UI smoke | 4 项通过后，等待“添加图像对比节点”30s 超时 | FAIL，而且使用旧 renderer |
| secrets | 扫 2534 个 tracked 文件，无匹配 | PASS |
| third-party assets | 3 records，0 release blockers | PASS |
| archetype defaults | 同步 | PASS |
| design tokens | 0/0/0/0；无悬空 token | PASS |

不能把 `typecheck + unit` 通过等价成 release gate 通过。当前 production build 和 E2E 都不可用。

## 3. P0/P1 Findings

### P0-1：跨重启幂等没有在应用启动时初始化

`electron/tasks/idempotencyStore.ts:142-150` 声称由 `main.ts` 初始化全局 store，但全仓只有测试调用 `initGlobalIdempotencyStore`。生产 `main.ts:575-580` 只调用 `runTaskWithIdempotency`，没有初始化持久台账。

当前运行时证据：`~/Library/Application Support/nomi` 下 `ledger.jsonl` 数量为 0。

影响：

- 进程内同 key 去重仍有效。
- 应用重启后同 key 不再受新增持久层保护。
- 这与“跨重启绝不重复付费提交”的完成声明冲突。
- 即使初始化，`SubmissionReplayError` 目前也没有上层 query-only 恢复处理。

### P0-2：当前源码无法完成生产构建

工作树有 138 个未跟踪 `.js/.js.map` 产物落在 `src/`。Vite 解析 `../i18n` 时命中 CommonJS 的 `src/i18n/index.js`，而不是 TS 源，导致 default export 缺失。

影响：

- 最新 renderer 无法打包。
- lint 产生 425 个 error。
- 当前 app/E2E 只能继续消费旧 `dist/`，无法证明最新 UI。

### P1-1：核心 Gate 模块没有接入生产路径

生产代码引用检查结果：

- `providerCompiler.ts`、`providerAdapterContract.ts`、`qualityGates.ts`、`otioAdapter.ts`、`shotBlenderBridge.ts`、`perfFixtureSpec.ts`、`isolatedProductionAcceptanceHarness.ts` 没有进入实际任务/UI/导出路径。
- `main.ts:589-598` 仍保留旧的 Codex-only cancel 路由，没有使用通用 `cancelProviderTask`。
- `providerCompiler` 仍依赖调用方注入 provider-specific reference 翻译，但 Codex/即梦/AGNES adapter 没有落地。
- `GenerationBudget` 只被 Gate 8 脚手架使用，没有约束实际批量调度器。

对应 Gate 3 文档自己也在 `docs/audit/2026-08-02-gate3-completion-evidence.md:49-51,80-88` 记录“零既有文件修改、runtime 接入留下一轮”。

### P1-2：Gate 8 harness 可以在没有真实资产和提交时返回 passed

`Gate8AcceptanceRun.markStepPassed` 只接受任意字符串；`buildReport` 只检查 9 个 boolean 和 credential flag。其测试在没有任何真实 Provider submission、资产路径、Blender 输出或 MP4 校验时，用 `evidence for ...` 把 9 步全部标记后断言 `passed`。

影响：该 harness 不能作为“防伪造”验收器，只能作为人工 checklist 数据结构。

### P1-3：最新 UI E2E 实际使用旧 renderer bundle

`tests/ux/helpers/electronFixture.mjs:15` 设置 `NOMI_SOURCE_RUN=1`，但 `electron/main.ts:233-236` 在没有 renderer URL 时仍加载 `dist/index.html`。本轮文件时间：

- `dist/index.html`：2026-08-02 08:30
- 当前源码和审计改动：下午
- `dist-electron/main.js`：17:49（由 electron TypeScript 编译刷新）

因此本轮 smoke 是“新 main + 旧 renderer”，不能验证当前画布 UI。

### P1-4：多实例/孤儿进程污染性能和状态

本轮快照：7 个 Electron 主进程、9 个 helper，RSS 合计约 736 MB；其中 6 个额外主进程长期存活，只带 network helper。所有进程指向同一仓库，且多项使用默认 Nomi user-data。

影响：

- 卡顿和内存占用不能归因到单实例应用。
- 共享 profile/settings/project 可能产生锁和状态串扰。
- Gate 7 的“退出无孤儿进程”当前不满足。

### P1-5：安全与性能“测试”主要验证写死声明，不是实测

- `runSecurityAudit()` 只是统计 `KNOWN_SECURITY_RISKS` 内预先写死的 pass/warn/fail；测试再次断言这些常量为 pass。
- `TARGET_PERF_FIXTURE_SPEC` 只声明 200/400，实际 `tests/ux/fixtures/gen-perf-fixture.mjs` 仍是旧 fixture 生成方式。
- 没有本轮 200 节点交互 p95、heap snapshot、30 次循环内存增长、Chrome/Blender/Codex 清理时延报告。

### P1-6：审计文档存在互相矛盾的完成声明

同一批文档一边明确写“代码骨架、runtime 接入留下一轮”，另一边又写：

- `gate8-9-execution-handoff.md:5`：代码/审计层 100% 完成。
- `gate8-9-execution-handoff.md:32`：所有代码/审计层阻塞项 100% 清除。
- `final-delivery-and-gate8-9-status.md:146`：Agent 工具、compiler、200 节点 fixture 仍待接入。

应删除“Gate 0–7 完成”和“100%”表述，统一为 implementation slice / partial / blocked。

### P1-7：工作树尚未形成可恢复交付

当前有 43 个 tracked 文件修改、199 个 untracked 文件；所有 Gate 模块、架构和审计文档都未进入 Git commit。`git diff --stat` 为 8635 additions / 103 deletions，其中 `model-catalog.json` 占大头。

影响：无法稳定回滚、复现、代码审查或发布；当前 HEAD 并不包含这些“已完成”能力。

## 4. Gate 状态矩阵

| Gate | 已有实质 | 未满足的通过标准 | 当前状态 |
| --- | --- | --- | --- |
| 0 基线 | 架构清单、许可证检查、静态事实审计 | 最新 UI、性能/内存、进程、Provider 证据不完整 | PARTIAL |
| 1 领域模型 | FilmBible/ShotSpec/Reference/Intent/Revision 类型、zod、迁移纯函数、单测 | 旧项目真实迁移、持久化接入、删除平行真相源 | PARTIAL |
| 2 Agent Harness | manifest、阶段工具白名单、部分画布阶段流、确认 gate | 25 个语义工具多数 projected/deferred；电影导演组件与结构化 patch 未闭环；最新 UI 未验 | PARTIAL |
| 3 Provider | capabilities/compiler/contract/budget 纯模块 | runtime 接入、三家专用 adapter、持久幂等启动、恢复、多结果完整回收、真实 smoke | BLOCKED |
| 4 Blender | 既有 VIBING Director；shotId 类型和投影函数 | 新 ShotSpec bridge 未调用；无本轮真实 Blender 可编辑/保存/清理证据 | PARTIAL |
| 5 质量验收 | Gate A/B/D 纯规则和报告类型 | 未接生成链；Gate C/VLM、参考搜索、标注集 precision/recall 缺失 | PARTIAL |
| 6 时间线/导出 | 既有 timeline/export；OTIO 纯 adapter | OTIO 未接 UI/IPC；无本轮 6–12 镜真实 MP4 三次导出 | PARTIAL |
| 7 性能/安全/恢复 | 目标规格、静态审计表、旧 harness | build/lint 失败；200 节点/heap/崩溃恢复缺失；当前多实例泄漏 | FAIL |
| 8 隔离生产验收 | fixture/checklist 脚手架 | 无本轮隔离项目、真实资产、费用/耗时/清理和六角色记录 | NOT RUN |
| 9 发布 | 无 | Gate 0–8 未通过，build 失败 | NOT ENTERED |

## 5. 已经可以保留的成果

以下不是“无效工作”，应保留并继续接入：

1. 目标架构和电影/AI 视频资源图谱。
2. ShotSpec 等领域类型、zod schema、round-trip 迁移与 revision 操作。
3. Skill manifest、Playbook stage、后端工具硬白名单和 trace 配置事件。
4. Provider capability/compiler/adapter contract 的纯函数设计。
5. Gate A/B/D、OTIO、Blender ShotSpec 投影的独立模块与单测。
6. 已有 Nomi 画布、即梦 Web、Codex Img2、AGNES、时间线、FFmpeg、VIBING Director 的旧生产底座。
7. secrets、third-party asset、design token、archetype default 检查当前通过。

## 6. 严格下一步顺序

1. **恢复可构建基线**：移出 138 个源码目录编译产物；拆分两个超限面板；修复 lint/build；让 E2E 启动当前 renderer。
2. **修钱安全 P0**：初始化项目/全局持久 ledger；记录 submitted/unknown 而不只 settled；把 replay 接到 query-only 恢复；做真实重启测试。
3. **完成 Gate 1/2 接入**：把 ShotSpec/FilmBible/revision 落入项目 schema；注册真实语义工具；删除旧平行读写路径；用当前 UI 做结构化 patch/确认 E2E。
4. **完成 Gate 3**：把 compiler/capability/adapter/budget 接入 `runtime.runTask`；分别实现 Codex Img2、即梦 Web、AGNES adapter；验证单次 create、多结果和媒体不串型。
5. **再做 Gate 4–6**：接 ShotSpec→Blender；接质量门；接 OTIO；用隔离 6–12 镜项目产出真实 MP4。
6. **Gate 7 真测**：清掉多实例后跑 200/400 fixture、heap、30 循环、崩溃恢复和子进程清理。
7. **最后 Gate 8/9**：受预算控制的真实 Provider 全旅程和人工审查；通过后才讨论发布。

当前不应继续堆新组件。先把 1–4 做成一条真实、可构建、可恢复、不会重复扣费的纵向路径。
