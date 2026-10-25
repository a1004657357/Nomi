# Standalone smoke 断言导入

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

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

## 后续授权：完整运行时绑定

本后续基于 6492f0fdc0039f5bef2b8e292231984525c2943f，新分支 codex/smoke-runtime-bindings-20261025。用户已扩大范围，以上“未改三个符号”只记录上批历史；本批统一收口，仍仅 smoke、本结构回归、设计/v3。

根因关系：expect 和 screenshotSettled 都是复制进入独立 ESM 的调用而未接 canonical owner；screenshotDir 则引用了本脚本不存在的目录名，实际已创建的目录是 evidenceDir；electronProcess 是 finally 的五秒关闭失败兜底漏接 launch 返回 app 的真实子进程。后两阶段分别在首个截图分支及关闭超时分支才触发，容易被前面的 expect 错误遮住。它们不是三个不同产品功能缺陷，而是同一 standalone 模块接线/生命周期绑定遗漏。

本批直接复用 path.resolve("outputs/canvas-smoke") + mkdirSync 的 evidenceDir，不新造 shotsDir/screenshotDir 别名或空目录；从 _assert 导入 screenshotSettled；从启动返回的 app.process() 取得真实 electronProcess，保留原 close race/kill 行为。

作用域回归使用既有 ESLint Linter（不读全局配置）与 no-undef：模块仅有 globals.node；实际 evaluate/evaluateAll/waitForFunction 序列化回调用隔离函数表达式和 globals.browser 检查。Node 层不授予 browser globals，renderer 不授予 Node/外层闭包变量；Electron app.evaluate 不被误当 renderer。所有变量绑定/局部遮蔽判定由 ESLint 语义作用域负责，AST 只定位运行环境边界。关闭 inline config，不能靠 global 注释/disable 掩盖漏绑定；旧 expect 错 owner/全局伪装阴性仍保留。

仍不启动 App/浏览器/截图，不宣称真实媒体/UI或强制关闭分支已执行。本轮日志 `.tmp/smoke-runtime-bindings/`，先 red 后 green，最终结果随后补齐。

### 后续批次实际结果

- `red-final.log`：生产未改前 4 失败/17 通过（21 用例）。完整 smoke 的语义检查同时报出三类共 11 个 no-undef 引用，截图/进程绑定的负例前提与真实 owner 检查也拒绝缺绑定现状。另一真实 standalone 的整体语义检查已通过。
- `green.log`：补齐真实来源后 21/21。整份 smoke 和 core-smoke-spend-confirm 的 Node/renderer no-undef 均为零；旧 canonical expect/错误 owner/全局伪装对照全保留。
- 逐一虚拟移除 expect、screenshotSettled、evidenceDir、electronProcess 的真实绑定都会触发对应 no-undef。renderer 内的 Node process、Node 外层捕获、即便在 Node 正确导入的 expect 也必须被拒绝；browser globals 在 Node 顶层、main app.evaluate 或拼错名称时不能放行。局部参数遮蔽/局部变量由 ESLint 作用域正确判定。
- 结构 owner 检查确认 screenshotSettled 为 canonical 同名导入、electronProcess=app.process()、原 evidenceDir 的 path.resolve/mkdirSync，以及 library.png/canvas.png/director.png 三个原截图点全部保留。没有另造目录、假 process 或全局变量。
- 两个 mjs 的 `node --check` 和 `git diff --check` 均通过。测试仅运行该文件，maxWorkers=1/no-file-parallelism/cache=false；新 Linter 不加载或修改仓库全局 ESLint 配置，仍由现有 Vitest 自动收集。
- `contracts.log`：base=6492f0fdc0039f5bef2b8e292231984525c2943f，合同单元 55/55、真实 diff/schema exit 0。现有 mapDoors 的真实门表 8→7，仅移除 obsolete screenshotDir 入口；保留原 tests 路径归类造成的 1 条 structural-prevention 告警，不改 checker/豁免/recurrence 来抹掉它。

本后续只写 smoke、本结构单测及本设计/v3 四文件。不启动 App/浏览器/截图/Provider，不跑真实 smoke、全仓或大类型检查；真实截图落盘权限及关闭超时/强杀分支仍由协调线实际 smoke 验收。
