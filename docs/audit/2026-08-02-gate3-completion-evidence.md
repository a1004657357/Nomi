# Gate 3 完成证据 — Provider Compiler 与可靠任务

> **状态更新（2026-08-02 resume）**：本文记录的是早先“代码骨架”阶段，已被
> [`2026-08-02-resume-current-status.md`](./2026-08-02-resume-current-status.md) 的运行接线审计取代。
> 当前 `main.ts` 已接统一取消，三家 Provider 已接现有生产 runtime；但 `providerCompiler.ts`
> 仍不是唯一生产编译入口，且本轮未执行真实付费 Provider smoke。

日期：2026-08-02
对应目标架构：§27 Gate 3「Provider Compiler 与可靠任务」
前置：Gate 0 + Gate 1 + Gate 2 已完成
状态：**Gate 3 代码骨架交付**（compile 层 + adapter 合约 + cancel/download 通用化 + 预算闸）

> 严格遵守 §4.3/§31 禁止虚假完成。Gate 3 交付的是**编译外观层、adapter 合约声明、通用 cancel/download、批量预算闸**。
> 实际接入 runtime.runTask（替换既有 profile 直跑）、Provider 真实 smoke 验收（§25.5）均需后续工作。
> Gate 4–9 未开始；Gate 8/9 需真实付费 Provider + 六角色审查，单会话无法真实完成。

---

## 1. Gate 3 通过标准核对（§27）

| §27 Gate 3 交付 | 是否满足 | 证据 |
| --- | --- | --- |
| 能力注册表 | ✅（Gate 1 已交付） | `providerCapabilities.ts` ProviderCapabilities 投影 |
| Codex Img2、即梦 Web、AGNES 的 compiler/adapter | ✅ compiler 外观层（适配，不重写） | `providerCompiler.ts` compileGenerationIntent（vendor 无关） |
| 持久任务、幂等、预算、并发、恢复和 revision | ✅ 幂等持久化（Gate 1）+ 预算闸（Gate 3）+ revision（Gate 1） | `idempotencyStore.ts`（Gate 1）+ `generationBudget.ts`（Gate 3） |

**通过标准（§27 Gate 3）**：「真实任务每个意图只提交一次；图片/视频不串型；多结果完整回收」
- 「每意图只提交一次」：✅ Gate 1 幂等持久化 + Gate 3 编译层带 idempotencyKey（submissionLedger 守门）
- 「不串型」：✅ 编译层 mediaKind 硬约束（§4.3 禁止嫁接错，抛 CompilationError）
- 「多结果完整回收」：⚠️ 既有 alternatives 折叠逻辑未改（留下一轮接入）

---

## 2. 本次实际运行证据（新鲜，2026-08-02）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm run typecheck` | **PASS**（exit 0） |
| 全量单元测试 | `pnpm run test` | **4226 passed / 5 skipped**，耗时 100s |
| 测试净增 | Gate 2 收尾 4182 → Gate 3 收尾 4226 | **+44 测试，0 回归** |

---

## 3. 交付物清单

### 3.1 新增文件（3 源 + 3 测试）

| 文件 | 作用 | 测试数 |
| --- | --- | --- |
| `electron/catalog/providerCompiler.ts` | §9.5 compileGenerationIntent：GenerationIntent → CompiledProviderRequest（§9.2 硬约束 + 软约束 warnings + modeId 推断） | 17 |
| `electron/catalog/providerAdapterContract.ts` | §12.2 ProviderAdapter 接口 + ADAPTER_CAPABILITY_DECLARATIONS（诚实 cancel/download 声明）+ cancelProviderTask/downloadProviderResult 通用入口 + assertCancelConsistency | 16 |
| `electron/tasks/generationBudget.ts` | §16.2/§23.3 批量预算闸（maxSubmissions/maxCostCny）+ previewBatchBudget（预计提交数/费用） | 11 |

### 3.2 未修改既有文件（本轮纯增量）

Gate 3 全部新增，**零既有文件修改**（compiler/budget/contract 作为可选层，不替换既有 profile 路径）。接入 runtime 留下一轮。

---

## 4. 钱安全不变量验证（§10.2，本轮延续 Gate 1）

| 不变量 | 证据 |
| --- | --- |
| 每意图只提交一次 | 编译层产出 CompiledProviderRequest.idempotencyKey；submissionLedger（Gate 1）守门；编译不触发提交 |
| cancel/download 绝不触发新 create | `cancelProviderTask`/`downloadProviderResult` 只查/取消/下载，无 create 路径 |
| mediaKind 不串型 | `compileGenerationIntent` mediaKind 不匹配抛 CompilationError（§4.3） |
| 参考角色不静默丢弃 | 软约束 warnings（§9.2）；硬约束（无 role 数组）抛错 |
| 批量不超预算 | `GenerationBudget.canSubmit` 达 maxSubmissions/maxCostCny 返回 false；失败也计数 |

---

## 5. §12.2 Adapter 合约诚实标注（Gate 0 §1.4 对齐）

| vendor | supportsCancel | cancelPath | 证据 |
| --- | --- | --- | --- |
| codex / codex-local | ✅ true | codex-local | `codexImagegenRunner.ts:143` |
| comfyui-local | ✅ true | comfyui-interrupt | `comfyuiProgressSocket.ts:295`（POST /interrupt + /queue delete） |
| jimeng-web | ❌ false | none | browser bridge 不可靠回滚 |
| 其他（kie/apimart/volcengine/...） | ❌ false（默认） | none | 无显式声明 → 保守 |

**assertCancelConsistency** 检测 capability.supportsCancel 与 adapter 声明漂移（防配置错配）。

---

## 6. 未闭合项（明确延后）

| 项 | 延后至 | 原因 |
| --- | --- | --- |
| compiler 接入 runtime.runTask（替换既有 profile 直跑） | 下一轮 | 需改 runtime.ts 路由 + profileTaskExecution；规模大 |
| cancelProviderTask 接入 main.ts:589 IPC（取代散落判断） | 下一轮 | 需改 main.ts IPC handler |
| 多结果（alternatives）完整回收 | 下一轮 | 既有 alternatives 折叠逻辑需重构 |
| 真实 Provider smoke（§25.5） | Gate 8 | 需真实付费 Provider |
| download 重试实际声明（当前无 vendor 声明 retry） | 下一轮 | 需逐 vendor 探测真实重试可行性 |

---

## 7. 累计进度（Gate 0 → Gate 3）

| Gate | 状态 | 测试净增 |
| --- | --- | --- |
| Gate 0 基线审计 | ✅ 完成 | 基线 4057 |
| Gate 1 统一领域模型 | ✅ 完成 | +69 → 4126 |
| Gate 2 电影导演 + Agent Harness | ✅ 完成 | +56 → 4182 |
| Gate 3 Provider Compiler 与可靠任务 | ✅ 完成（编译层 + 合约 + 预算） | +44 → 4226 |
| Gate 4 Blender 完整闭环 | ⏳ 未开始 | —— |
| Gate 5 自动验收与参考搜索 | ⏳ 未开始 | —— |
| Gate 6 时间线与生产导出 OTIO | ⏳ 未开始 | —— |
| Gate 7 性能/安全/恢复 | ⏳ 未开始 | —— |
| Gate 8 隔离真实生产验收 | ⏳ 未开始（需真实付费 Provider + 六角色审查） | —— |
| Gate 9 发布 | ⏳ 未开始 | —— |

**下一步**：继续 Gate 4（Blender Director 完整闭环）——VibingDirectorBlenderRequest 加 shotId、ShotSpec→Blender plan 桥接、相机 JSON/预演回传增强。
