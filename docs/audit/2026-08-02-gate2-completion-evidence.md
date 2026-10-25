# Gate 2 完成证据 — 电影导演组件与 Agent Harness

日期：2026-08-02
对应目标架构：§27 Gate 2「电影导演组件与 Agent Harness」
前置：Gate 0（基线审计）+ Gate 1（统一领域模型）已完成
状态：**Gate 2 代码骨架交付**（§11.2 语义工具别名层 + 双状态机统一 + ShotSpec 读取器 + §11.3 权限矩阵扩展）

> 本文严格遵守 §4.3/§31 禁止虚假完成。Gate 2 是「电影导演组件与 Agent Harness」——
> 本文交付的是**语义工具映射层、状态机同步函数、领域读取器、权限矩阵扩展**，
> 并**不**宣称 §11 完整 Harness 改造全部完成。Agent 工具实际注册（改 agentChatV2 tool 注册表）、
> 电影导演 Canvas 组件 UI、分阶段 Skill manifest 接入均需后续工作（见 §3 未闭合项）。
> Gate 3–9 全部未开始（Gate 8/9 需真实付费 Provider 验收 + 六角色审查，单会话无法真实完成）。

---

## 1. Gate 2 通过标准核对（§27）

| §27 Gate 2 交付 | 是否满足 | 证据 |
| --- | --- | --- |
| 画布电影导演组件 | ⚠️ 部分（既有 VibingDirectorEditor 组件 + Gate 2 领域读取器；新「电影导演组件」UI 未做） | 既有 `VibingDirectorEditor.tsx`；本 Gate 新增 `shotSpecReaders.ts` 供 Agent 读领域视图 |
| 分阶段 Skill manifest | ✅ 既有（Gate 0 §1.1 确认：16 builtin skill，含 stages） | `electron/skills/skillManifestSchema.ts:82` stages 字段；`agentSkillRuntime.ts:73` 阶段过滤 |
| 只读、提案、本地修改和付费工具权限 | ✅ 满足（§11.3 矩阵扩展） | `gate.ts` 新增 `evaluateSemanticToolGate` + `gateDecisionForCategory`；`semanticAgentTools.ts` 四类分类 |
| 结构化 patch 和确认流程 | ✅ 既有 + 增强（propose_storyboard_plan 既有；Gate 2 加语义 patch 工具别名） | `semanticAgentTools.ts` propose_shot_patch/propose_film_bible_patch 映射 |

**通过标准（§27 Gate 2）**：「Agent 可填写/修改分镜但不能绕过工具直接写画布或付费」—— ✅ 满足：
- 既有 gate.ts 守门（写/付费 = ask）未回归（28 gate 测试全绿）。
- 新增 §11.2 语义工具按 §11.3 矩阵判定（read/propose=allow，apply/paid=ask）。
- 提案工具（propose_*）映射到既有 propose_storyboard_plan/update_storyboard_shot，不直接写画布。

---

## 2. 本次实际运行证据（新鲜，2026-08-02）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm run typecheck` | **PASS**（无输出，exit 0） |
| 全量单元测试 | `pnpm run test` | **4182 passed / 5 skipped，482 test files passed / 2 skipped**，耗时 146s |
| 测试净增 | Gate 1 收尾 4126 → Gate 2 收尾 4182 | **+56 测试，0 回归** |

---

## 3. 交付物清单（代码）

### 3.1 新增文件（4 源 + 4 测试）

| 文件 | 作用 | 测试数 |
| --- | --- | --- |
| `src/workbench/domain/semanticAgentTools.ts` | §11.2 工具别名层：25 语义名 → 既有 canvas 工具映射 + 四类分类（read/propose/apply/paid）+ 覆盖率统计 | 18 |
| `src/workbench/generationCanvas/skills/playbookStateSync.ts` | 统一双状态机：syncCanvasSkillFromPlaybook（backend 权威投影）+ detectPlaybookDrift | 11 |
| `src/workbench/domain/shotSpecReaders.ts` | §11.2 read_* 运行时支撑：readStoryboardAsShotSpecs/readShotSpec/readFilmBibleView/readProjectSummary（只读投影） | 15 |
| `src/workbench/generationCanvas/agent/gateSemantic.test.ts` | §11.3 权限矩阵语义入口测试 | 12 |

### 3.2 修改文件（1 个，向后兼容）

| 文件 | 修改 | 兼容性 |
| --- | --- | --- |
| `src/workbench/generationCanvas/agent/gate.ts` | 新增 `gateDecisionForCategory` + `evaluateSemanticToolGate`（§11.3 矩阵语义入口） | 既有 `evaluateGate` 不变（16 既有测试全绿） |

---

## 4. §11.2 工具集覆盖率（诚实标注）

`semanticToolCoverage()` 实测：
- **total: 25**（§11.2 完整集合）
- **implemented: 9**（既有工具已支撑，语义层换名）
- **projected: 12**（Gate 1 类型/迁移已就位，运行时接入待 harness 改造）
- **deferred: 4**（明确延后：cancel/download → Gate 3，read_evaluation_report/run_optional_gpu_evaluation → Gate 5）

按分类：
| 分类 | implemented | projected | deferred |
| --- | --- | --- | --- |
| read | 1 | 7 | 1 |
| propose | 3 | 2 | 0 |
| apply | 4 | 3 | 0 |
| paid | 1 | 0 | 3 |

**关键映射（implemented）**：
- `submit_generation_intent` → `run_generation_batch`（付费生成 = intent 提交）
- `propose_shot_patch` → `update_storyboard_shot`（改分镜 = shot patch）
- `read_provider_capabilities` → `list_capability_recipes`
- `propose_storyboard_plan` → 既有同名
- `apply_vibing_director_plan` / `read_vibing_director_state` → 既有同名

---

## 5. 双状态机统一（§10.3）

Gate 0 §1.2 缺口：backend `PlaybookRun`（running/awaiting-confirm/done）与 frontend `CanvasSkillNodeState.runStatus`（ready/running/awaiting-confirm/done/error）独立计算，会漂移。

本 Gate 交付 `syncCanvasSkillFromPlaybook`（backend 权威投影）：
- backend done → frontend done（覆盖任何前态）
- backend awaiting-confirm → frontend awaiting-confirm（消除"backend 暂停但 frontend 显示 ready"漂移）
- backend running + index 变化 → frontend running + index 跟进
- frontend error 是渲染层瞬时故障，backend running/awaiting 不覆盖（保留 error）；backend done 清 error
- 无变更返回原引用（避免无谓重渲染）

`detectPlaybookDrift` 提供漂移诊断（用于日志/调试）。

**未闭合**：实际接入 harness 事件流（改 canvasSkillEvents.ts 运行回路）—— 需改既有运行回路，留下一轮（与 §11.2 工具实际注册一并做）。

---

## 6. 未闭合项（明确延后，非 Gate 2 范围或需更大改造）

| 项 | 延后至 | 原因 |
| --- | --- | --- |
| §11.2 工具实际注册到 agentChatV2（harness 改造） | 下一轮 | 需改 agentChatV2.ts tool 注册表 + canvasTools.ts；规模大，本轮先交付映射层 |
| 状态机同步接入 canvasSkillEvents 运行回路 | 下一轮 | 同上 |
| 12 projected 工具的运行时实现（Film Bible 持久化字段接入 projectRecordSchema 等） | 下一轮 / Gate 3 | 需扩 projectRecordSchema + UI |
| 4 deferred 工具 | Gate 3/5 | cancel/download 需 Provider Compiler；evaluation 需验收门 |
| 电影导演 Canvas 组件 UI（§8.3） | 下一轮 | 需 React 组件 + 画布节点注册 |
| ShotSpec 投影替换既有消费者直读 PlanShot | 下一轮 | 与工具注册一并做，避免冲突 |
| Gate 3–9 | 各自 Gate | 见 §27 |

---

## 7. 累计进度（Gate 0 → Gate 2）

| Gate | 状态 | 测试净增 |
| --- | --- | --- |
| Gate 0 基线审计 | ✅ 完成 | 基线 4057 |
| Gate 1 统一领域模型 | ✅ 完成（骨架） | +69 → 4126 |
| Gate 2 电影导演 + Agent Harness | ✅ 完成（映射层 + 同步 + 读取器 + 矩阵） | +56 → 4182 |
| Gate 3 Provider Compiler 与可靠任务 | ⏳ 未开始 | —— |
| Gate 4 Blender 完整闭环 | ⏳ 未开始 | —— |
| Gate 5 自动验收与参考搜索 | ⏳ 未开始 | —— |
| Gate 6 时间线与生产导出 OTIO | ⏳ 未开始 | —— |
| Gate 7 性能/安全/恢复 | ⏳ 未开始 | —— |
| Gate 8 隔离真实生产验收 | ⏳ 未开始（需真实付费 Provider + 六角色审查） | —— |
| Gate 9 发布 | ⏳ 未开始 | —— |

**下一步**：继续 Gate 3（Provider Compiler 与可靠任务）——按 §12 实现 compile(intent, capabilities)→request 层 + cancel/download 通用化 + projected 工具运行时接入。
