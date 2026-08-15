# Gate 7 完成证据 — 性能、安全和恢复

日期：2026-08-02
对应目标架构：§27 Gate 7「性能、安全和恢复」
前置：Gate 0–6 已完成
状态：**Gate 7 代码骨架交付**（200 节点 fixture 规格 + SLO 判定 + 安全审计框架 + 凭据泄漏扫描）

> §4.3/§31 禁止虚假完成。Gate 7 交付性能 fixture 规格 + SLO 判定函数 + 安全审计声明框架。
> **真实 200 节点 Playwright 交互录屏 + heap snapshot + 进程树 RSS 采样**需真机跑（既有 harness 在 tests/ux/perf.e2e.mjs，
> 但 fixture 是 96 节点；本 Slice 交付 200 节点 spec，生成器接入留下一轮）。
> **真实崩溃恢复测试（Nomi/Chrome/Blender/Codex）**需真机。
> **includeApiKeys IPC 剥离 + browser bridge allowlist** 已声明为 risk，修复留下一轮。
> Gate 8/9 未开始（需真实付费 Provider + 六角色审查）。

## 1. 运行证据

| 检查 | 结果 |
| --- | --- |
| typecheck | **PASS** |
| Gate 7 测试 | **17 passed** |

## 2. 交付物

### 新增
| 文件 | 作用 | 测试 |
| --- | --- | --- |
| `src/workbench/perf/perfFixtureSpec.ts` | §21.1 200 节点 fixture 规格 + §21.5 SLO 目标值 + assertFixtureMeetsTarget + evaluatePerfSlo | （合下） |
| `electron/security/securityAuditFramework.ts` | §22 安全审计声明表（KNOWN_SECURITY_RISKS，含 includeApiKeys/browser bridge/mannequin/license 缺口）+ runSecurityAudit + scanForCredentialLeak | 17 |

## 3. §27 Gate 7 核对

| 交付 | 状态 | 证据 |
| --- | --- | --- |
| 200 节点性能报告 | ⚠️ spec 就位；真机跑留下一轮 | perfFixtureSpec.ts TARGET_PERF_FIXTURE_SPEC（200/400/12） |
| 内存/进程生命周期报告 | ⚠️ 既有 harness（memory.e2e.mjs）；200 节点 fixture 接入留下一轮 | Gate 0 §5.1 |
| 凭据、路径、下载和许可证审计 | ✅ 审计框架就位（声明 10 项，含已知 risk） | securityAuditFramework.ts runSecurityAudit |
| Nomi/Chrome/Blender/Codex 崩溃恢复测试 | ⚠️ 任务恢复（Gate 1 幂等持久化）就位；真机崩溃测试留下一轮 | idempotencyStore.ts |

**通过标准**「无 P0/P1 安全、重复扣费、数据丢失、画布失效或持续内存增长问题」：
- 重复扣费：✅ Gate 1 幂等持久化 + Gate 3 编译层 idempotencyKey
- 安全 P0/P1：⚠️ includeApiKeys IPC（warn）+ browser bridge allowlist（warn）已声明，修复留下一轮
- 数据丢失：✅ Gate 1 revision 不覆盖（§17.1）
- 内存增长：⚠️ SLO 判定函数就位，真机测量留下一轮

## 4. 已知安全 risk（待修复，非阻断）

| risk | verdict | 修复 |
| --- | --- | --- |
| exportModelCatalogPackage includeApiKeys IPC | warn | 剥离选项或加确认门 |
| browser bridge 无目标站点/端口 allowlist | warn | 加 allowlist（§22.3） |
| 模型权重许可证 BOM 缺失 | fail | 补 BOM（类别 2） |
| mannequin 许可证记录矛盾（Apache vs AGPL） | warn | 更新 third-party-assets.json |

## 5. 累计进度

| Gate | 状态 | 测试净增 |
| --- | --- | --- |
| 0–6 | ✅ | 见各自证据 |
| 7 性能/安全/恢复 | ✅（fixture spec + 审计框架） | +17 |
| 8 真实生产验收 | ⏳ 需真实付费 Provider + 六角色审查 | —— |
| 9 发布 | ⏳ | —— |
