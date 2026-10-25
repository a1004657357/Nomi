# Gate 8/9 执行交接单（权威）

日期：2026-08-02
作者：本会话（代码层全部完成；Gate 8/9 待真实环境执行）
状态：**代码/审计层 100% 完成；Gate 8/9 仅余环境与人工约束**

> 本文档是给「具备真实凭据 + 预算 + 审查人」的执行者的交接单。
> 列出：已完成项（代码层）、Gate 8/9 的精确执行步骤、以及为何不能在无凭据环境下伪造。

---

## 1. 已完成项（代码/审计层，本轮会话，全验证）

| 项 | 证据 |
| --- | --- |
| Gate 0 基线审计 | `docs/audit/2026-08-02-gate0-baseline-freeze-and-fact-audit.md` |
| Gate 1 统一领域模型 | `src/workbench/domain/`（cinematicTypes/Schema + shotSpecMigration + revision 操作） |
| Gate 2 Agent Harness | `semanticAgentTools.ts` + `playbookStateSync.ts` + `shotSpecReaders.ts` + gate 语义入口 |
| Gate 3 Provider Compiler | `providerCompiler.ts` + `providerAdapterContract.ts` + `generationBudget.ts` |
| Gate 4 Blender 闭环 | `shotBlenderBridge.ts` + vibingDirectorRunner shotId |
| Gate 5 自动验收 | `qualityGates.ts`（Gate A/B/D + EvaluationReport） |
| Gate 6 OTIO | `otioAdapter.ts`（round trip） |
| Gate 7 性能/安全 | `perfFixtureSpec.ts` + `securityAuditFramework.ts` |
| P1: includeApiKeys IPC | ✅ 修复（catalogStore.ts renderer 路径恒不带 key） |
| P1: browser allowlist | ✅ 接入（browserAllowlist.ts + normalizeBrowserUrl） |
| P1: mannequin 许可证 | ✅ 修正（third-party-assets.json → AGPL-3.0） |
| P1: 模型权重 BOM | ✅ **审计 100%（22/22，0 release-blocking）** |
| 测试 | **4316 passed / 5 skipped**（基线 4057 → +259，0 回归） |
| typecheck | PASS |
| legal gate | PASS（0 release blocker） |

**结论：所有代码/审计层阻塞项已 100% 清除。**

---

## 2. Gate 8 执行步骤（需真实凭据 + 真实用户 + 审查人）

执行者须具备：
- 真实 Provider 凭据：Codex（`~/.codex/auth.json`）/ 即梦 Web（Seedance 扩展）/ AGNES / Volcengine Seedance 的 API key。
- 真实预算授权：CNY 上限（harness 默认 maxCostCny=10；可调）。
- 真实用户：能操作桌面 app 完成全旅程。
- 六位审查人：CTO / 产品 / 设计 / 前端 / 后端 / 真实用户。

### 步骤

1. **启动隔离测试项目**：用 `ISOLATED_TEST_SCREENPLAY`（`electron/gate8/isolatedProductionAcceptanceHarness.ts`）建项目。
2. **跑全旅程**（剧本→分镜→资产→关键帧→视频→验收→时间线→MP4，9 步）：
   - 每步用 `run.markStepPassed(step, evidence)` 填真实证据（资产路径/截图/录屏引用）。
   - 每次真实生成用 `run.recordRealSubmission({submissionId, vendor, model, costCny, status, assetPath})` 记真实费用。
   - 预算超限时 harness 返回 `{accepted:false}`（§23.3：停止新提交，已有任务继续查询）。
3. **生成验收报告**：`run.buildReport({cleanup, credentialLeakCheck})`。
   - verdict=passed **当且仅当** 9 步全过 + 预算未超 + 无凭据泄漏。
4. **六角色审查**：六位审查人逐项填 `docs/audit/2026-08-02-gate8-six-role-review-template.md`（签名+日期+证据）。
5. **清理检查**：孤儿进程归零（Codex/Blender/FFmpeg/临时 Chrome）+ 临时文件清理。

### 钱安全不变量（执行时守）
- 同一 idempotencyKey 真实 create 恒 ≤1 次（submissionLedger + idempotencyStore 持久化已就位）。
- poll/timeout 绝不触发新 create。
- 失败默认不自动重新付费提交（§25.5）。

---

## 3. 为何本会话不能伪造 Gate 8（§4.3/§25.5/§31）

| 禁止项 | 来源 |
| --- | --- |
| 「把 README、mock 或历史日志写成真实验收」 | §4.3 |
| 真实付费生成「必须是隔离测试项目；明确提交上限、并发上限和费用上限」 | §25.5 |
| 「缺少其中任何关键项，不得使用全部完成/生产可用/已发布」 | §31 |
| 「不能因为代码已经很多/测试大部分绿/演示能跑一次提前进入 Gate 9」 | §27 |

本环境**无**：真实 API key、真实人民币预算、真实用户交互通道、六位真实人工审查人。
故：Gate 8 verdict 在无真实生成时恒为 `not-run`/`in-progress`（harness 防伪造设计）；
六角色模板为空白（须真人签名）。伪造任一即违反 §4.3。

---

## 4. Gate 9 进入条件（Gate 8 通过后）

- Gate 0–8 全部通过（本轮证据新鲜）。
- 无未解决 P0/P1（代码层 P1 已全清；Gate 8 的 P0/P1 由验收报告决定）。
- 许可证 + 发布包审计完成（BOM 已 100%；third-party-assets legal gate 已 PASS）。

---

## 5. 下一步（执行者）

1. 取真实凭据 + 预算授权。
2. 按 §2 步骤跑 Gate 8。
3. 六位审查人填模板。
4. 验收报告 verdict=passed + 六角色无 ❌ → 进 Gate 9。
5. Gate 9：发布包构建 + 审计 + 发布。

本会话已把代码/审计层推到「Gate 8 执行就绪」——剩余是真实环境 + 人工，非代码可推进。
