# Gate 1 完成证据 — 统一领域模型

日期：2026-08-02
对应目标架构：§27 Gate 1「统一领域模型」
前置：Gate 0 基线已完成（`docs/audit/2026-08-02-gate0-baseline-freeze-and-fact-audit.md`）
实施计划：已批准（见会话 ExitPlanMode）
状态：**Gate 1 代码骨架交付**（域类型 + 迁移 + revision + 能力投影 + 状态机 + 幂等持久 + timeline 字段）

> 本文严格遵守目标架构 §27 Gate 1 通过标准与 §4.3/§31 禁止虚假完成声明。
> Gate 1 是「统一领域模型」——本文交付的是**类型骨架 + 迁移函数 + 钱安全持久化 + 状态机扩展**，
> 并**不**宣称目标架构 §1–§31 全部完成。ShotSpec↔Blender 闭环（Gate 4）、OTIO（Gate 6）、
> 验收门（Gate 5）、200 节点性能（Gate 7）、真实生产验收（Gate 8）、发布（Gate 9）均**未开始**。

---

## 1. Gate 1 通过标准核对（§27）

| §27 Gate 1 通过标准 | 是否满足 | 证据 |
| --- | --- | --- |
| FilmBible、ShotSpec、ReferenceBinding、GenerationIntent、AssetRevision schema | ✅ 满足 | `src/workbench/domain/cinematicTypes.ts` + `cinematicSchema.ts`（zod + 编译期 drift guard） |
| 当前分镜/节点数据迁移 | ✅ 满足（迁移函数就位） | `shotSpecMigration.ts` `planShotToShotSpec` / `migrateStoryboardPlanShots`；旧扁平字段→ShotSpec 子对象双向映射 |
| 单一 selected revision 指针 | ✅ 满足 | `graphOps.ts` `selectRevision`/`archiveRevision`/`rejectRevision`（复用 history[]，§17.1 不覆盖） |
| 旧项目可无损打开 | ✅ 满足 | 迁移函数全 optional 字段；既有 `projectNormalize.test.ts` 旧项目用例（无 storyboardPlan→null 不报错）仍绿；PlanShot 旧字段全保留为别名 |
| round-trip 不丢字段 | ✅ 满足 | `shotSpecMigration.test.ts` `mergeShotSpecIntoPlanShot` 往返守恒用例（9 用例）；`cinematicTypes.test.ts` zod parse golden case（17 用例） |
| 新旧平行真相源已删除 | ⚠️ 部分（类型骨架已统一；既有消费者改读 ShotSpec 投影留待 Gate 2 工具集重命名时一并做） | Slice 7 计划项「删除 deprecated 旧读路径」标为延后——因 §11.2 工具集重命名是 Gate 2 范围，强行先改会与 Gate 2 冲突 |

---

## 2. 本次实际运行证据（新鲜，2026-08-02）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm run typecheck` | **PASS**（无输出，exit 0） |
| 全量单元测试 | `pnpm run test`（vitest run） | **4126 passed / 5 skipped，478 test files passed / 2 skipped**，耗时 131s |
| 测试净增 | Gate 0 基线 4057 → Gate 1 收尾 4126 | **+69 测试，0 回归** |
| 受影响区域回归 | generationCanvas+project+domain 1867 测试 / electron 1650 测试 | 全绿 |

---

## 3. 交付物清单（代码）

### 3.1 新增文件（8 个源 + 6 个测试）

| 文件 | 作用 | 测试数 |
| --- | --- | --- |
| `src/workbench/domain/cinematicTypes.ts` | §9 域类型 v1（FilmBible/ShotSpec/ReferenceBinding/GenerationStrategy/GenerationIntent/AssetRevision/ContinuityConstraint/ShotStatus） | —— |
| `src/workbench/domain/cinematicSchema.ts` | zod schema + 编译期 drift guard（沿用 storyboardPlan.ts:187 模式） | —— |
| `src/workbench/domain/shotSpecMigration.ts` | PlanShot↔ShotSpec 双向映射 + 批量迁移 | 12 |
| `electron/catalog/providerCapabilities.ts` | §9.4 ProviderCapabilities 只读投影（适配 catalog+archetype，不重写） | 15 |
| `electron/tasks/idempotencyStore.ts` | §20 tasks/ledger.jsonl 持久幂等 + SubmissionReplayError | 9 |
| `src/workbench/domain/cinematicTypes.test.ts` | zod golden case + 类型编译 + 安全边界（FilmBible 无凭据字段） | 17 |
| `src/workbench/generationCanvas/model/graphOpsRevision.test.ts` | §17 revision 生命周期（select/archive/reject + 不覆盖） | 9 |
| `src/workbench/timeline/timelineClipShotRevision.test.ts` | §19.1 clip shotId+revisionId 向后兼容 | 2 |
| `electron/catalog/providerCapabilities.test.ts` | source 分类 + cancel 准确性 + 不伪造能力 | （含上 15） |
| `electron/tasks/idempotencyStore.test.ts` | 重启钱安全 fixture + TTL + 损坏 jsonl 容错 | （含上 9） |

### 3.2 修改文件（7 个，全部向后兼容）

| 文件 | 修改 | 兼容性 |
| --- | --- | --- |
| `src/workbench/generationCanvas/model/generationCanvasTypes.ts` | GenerationNodeResult 加 revisionStatus/parentRevisionId/sha256/costCny 等（全 optional） | 既有条目无此字段按 candidate 处理 |
| `src/workbench/generationCanvas/model/graphOps.ts` | 新增 selectRevision/archiveRevision/rejectRevision（保留 rollbackNodeHistory） | rollback 行为不变 |
| `electron/tasks/responseParsing.ts` | TaskStatus 加 cancelled/unknown + isTerminalStatus/isFailureStatus；canceled→cancelled 独立；默认→unknown | 旧 4 态是子集；create+taskId→queued 细化 |
| `electron/runtime.ts` | TaskResult.status 同步扩展（加 cancelled/unknown） | 旧消费者读字符串不破 |
| `electron/tasks/profileTaskExecution.ts` | unknown + taskId → queued 细化（create 受理 ≠ 真 unknown） | 既有 fixture 用例仍绿 |
| `electron/submissionLedger.ts` | runTaskWithIdempotency 接持久台账（重启同 key 抛 SubmissionReplayError，绝不重执行） | 无 key 路径完全不介入 |
| `src/workbench/timeline/timelineTypes.ts` | TimelineClip 加 shotId?/revisionId? | 既有 clip 无此字段仍合法 |

---

## 4. 钱安全不变量验证（§10.2，本轮重点）

Gate 0 §1.5 确认的「create 与 poll 严格分离」铁律本轮**未触动**，并新增「跨重启不重发」：

| 不变量 | 证据 |
| --- | --- |
| create 与 poll 严格分离 | 既有 `catalogTaskActions.ts:398-401` 注释不变；Slice 5 加 `unknown` 态只查询不重发；回归测试 1650 electron 测试全绿 |
| 同一 idempotencyKey create at-most-once（进程内） | `submissionLedger.test.ts` 10 用例仍绿（含同键 fn 调用 1 次、TTL 重跑） |
| **跨重启同 key 不重发（本轮新增）** | `idempotencyStore.test.ts` 「重启 fixture」用例：会话1提交→会话2（新进程+新 store 读盘）同 key → fn 调用次数 0 + 抛 SubmissionReplayError |
| unknown 不触发新 create | `responseParsing.test.ts` isTerminalStatus('unknown')===false；taskResultQuery 持续查询 |

---

## 5. 未闭合项（明确延后，非 Gate 1 范围）

| 项 | 延后至 | 原因 |
| --- | --- | --- |
| §11.2 Agent 工具集重命名（read_film_bible/propose_shot_patch/submit_generation_intent...） | Gate 2 | 工具集重构是 Gate 2「电影导演组件与 Agent Harness」的核心 |
| ShotSpec 投影替换既有消费者直读 | Gate 2 | 同上，避免与工具集重命名冲突 |
| 两套状态机统一（PlaybookRun ↔ CanvasSkillNodeState） | Gate 2 | 同上 |
| ShotSpec↔Blender shot 闭环 | Gate 4 | 需 Blender runner 加 shotId |
| OTIO adapter | Gate 6 | 独立交换层 |
| Gate A/B/C/D 验收 | Gate 5 | 需评测体系 |
| 200 节点性能 fixture | Gate 7 | 需真机基准 |
| includeApiKeys IPC 剥离 / browser bridge allowlist | Gate 7 | 安全审计 |
| 许可证 BOM 类别 2/3/5 + mannequin 矛盾 | Gate 7/9 | 需逐项审计 |

---

## 6. 结论

**Gate 1「统一领域模型」代码骨架交付完成。** §27 Gate 1 三项通过标准中：
- ✅ schema（FilmBible/ShotSpec/ReferenceBinding/GenerationIntent/AssetRevision）—— 完整
- ✅ 当前数据迁移（PlanShot→ShotSpec 双向 + 批量）—— 完整
- ✅ 单一 selected revision 指针（复用 history，新增 select/archive/reject）—— 完整
- ✅ round-trip 不丢字段 —— 测试覆盖
- ✅ 旧项目无损打开 —— optional 字段 + 既有 normalize 测试绿
- ⚠️ 新旧平行真相源删除 —— 部分延后至 Gate 2（与工具集重命名一并做，避免冲突）

**额外完成（超出 Gate 1 字面范围，但强化了钱安全与能力统一）**：
- 任务状态机扩展（cancelled/unknown + 不重发守卫）
- 提交幂等跨重启持久化（tasks/ledger.jsonl + SubmissionReplayError）
- ProviderCapabilities 只读投影（消除能力散落，适配既有 catalog 引擎）
- timeline clip shotId/revisionId

下一步：进入 Gate 2「电影导演组件与 Agent Harness」（§11.2 工具集重命名 + 状态机统一 + ShotSpec 投影接入 UI）。
