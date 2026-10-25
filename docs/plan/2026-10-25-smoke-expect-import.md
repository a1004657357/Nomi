# Standalone smoke 断言导入

基点 `6334117050d288d8eb048e64561ad46339eec3a9`，独立分支 `codex/smoke-expect-import-20261025`，保留 hover 分支。只改 smoke 导入、直接结构单测和本设计/v3，不碰协调树、启动 App/浏览器、截图、Provider 或大类型检查。

依据 `ci-e102-e2e-25.log:1649–1658`：启动和四条基础检查已过，首次 `expect(primaryCard)` 因本地 ESM 模块未导入 expect 而失败。这不是产品 UI 不可见或 Playwright 超时；standalone 没有 Vitest runner 自动注入。

| 格 | 决定 |
| --- | --- |
| ★1 流程 | 原三个 expect 调用继续使用原断言，不改场景和通过计数，只让模块绑定到正确 owner。 |
| ★2 Owner | 从现有 `./_assert.mjs` 显式导入 expect；该 owner 已包装 native Playwright expect 的 collecting 机制，不绕过它直引 runner。 |
| ★3 复用 | 结构回归用已有 TypeScript AST/Vitest，读取源码而不 import 或运行 standalone；不增加新库、通用 checker、package gate、全局 ESLint 或全局 expect。 |
| ★4 阴性 | 从真实脚本虚拟删除 canonical 导入必须拒绝；同名全局赋值、错误 owner、注释导入均不能通过。另检查真实 core-smoke-spend-confirm standalone 的正/阴性，避免空洞样例。 |
| 5 花钱 | 不启动 loopback/Provider 或调用付费流程；只静态读取另一 standalone。 |
| 6 中断 | 不改 app close/timeout 等处理器。 |
| 7 数据 | 不打开真实项目或写媒体/用户数据。 |
| 8 兼容 | hover/功能卡片/冻结/出站/resident 全不变。 |
| ★9 验收 | 真实 smoke 缺导入先红，补一行导入后绿；全部新负例始终断言拒绝。新 `.test.mjs` 自动由既有 Vitest include 收集，不加平行 gate。不宣称 E2E/UI 已验收。 |

门表：最初 CLI 默认排除 tests，生成 0 门；随后确认已有 include-tests 支持与公开 mapDoors API，复用后者限定两个实际 standalone 文件（而非修改工具或扫描全仓）。before 从 Git 6334 原文读取、after 从当前文件读取，真实 expect 调用门表写入合同与 doors-scoped.json，不手写入口。实际 ESM 绑定由新 AST 回归检查。

## 范围外、已报告

同一基点及已提交 f5a9c5c4b 的 smoke 中，screenshotDir/screenshotSettled 以及关闭失败兜底 electronProcess 也缺本地定义/导入。这可能在 expect 问题解除后继续阻断；按用户“仅修 expect 导入”不擅自补截图参数、关闭逻辑或删除原步骤。不将本修复写成 E2E 已全绿，留给协调者处理。

## 本轮结果

日志目录：`/Volumes/S7/AiWork/Projects/Nomi-i18n-display-align-20261025/.tmp/smoke-expect-import/`。

- `red.log`：只加结构回归、未补导入时 2 失败/4 通过；真实 smoke 缺 binding，移除导入阴性对照的“真实正确基线先存在”前提也因此失败，不把该前提失败误算成已跑 UI。
- `green.log`：同一文件 6/6，通过实际 smoke 和 core-smoke-spend-confirm 的 owner 检查及各自的移除导入对照；七个坏绑定虚拟输入与无断言输入均被拒绝。使用 maxWorkers=1/no-file-parallelism/cache=false，仅 Node 解析源码，不 import standalone。
- smoke 的源 diff **只有一行** `import { expect } from "./_assert.mjs";`。原三处 expect、所有步骤/计数/等待/关闭/截图逻辑都未变。
- `node --check` 两个修改/新建 mjs 均 exit 0；diff 检查通过。
- 新 `.test.mjs` 已匹配现有 Vitest `tests/**/*.test.mjs`，无需 package 接线或平行 gate。
- `check:root-cause-contracts` 单元 55/55；使用原 mapDoors 公开 API 得到 before=after=3 的真实门表；更新门表后的实际 diff/schema exit 0。仍有 **1 条未清零告警**：其路径分类把 tests/ 下的可执行 smoke 入口也当作纯测试，从而认为没有 changed structural prevention。真实修复是可执行入口的 ESM binding，不增加伪 src 文件、不改 scope/checker 或降为 one_off 来避告警。

没有真实 E2E 重跑，也不据 Node 绿测推断其他 9 条 journeys、MCP 或后续 screenshot/close 分支全绿。范围外三个未绑定符号已单列交接，未改；无 App/浏览器/截图/Provider/全套/大类型检查，未改协调树。
