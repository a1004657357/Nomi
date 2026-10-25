# 限定过期测试与模拟契约对齐

基点 `09221429ea0c94955334b7c66c72b6620bb7b001`，复用干净 sibling `Nomi-r5-resident-display-20261025`；新分支 `codex/stale-fixtures-contracts-20261025`，保留旧 `codex/r5-resident-tool-display-20261025`，不 reset。

## 设计卡

| 格 | 决定 |
| --- | --- |
| ★1 流程 | 仅修用户列明 11 文件的陈旧断言/模拟。读真实 owner 后修测试，不为全测变绿改生产语义。真实问题另报。 |
| ★2 Owner | lane/Host、窗口角色、供应商错误、MCP 声明/租约、canonical 六状态、媒体重试策略和 UI callback 都由现有生产实现说了算。此批只改对应测试结构，无生产写口迁移。 |
| ★3 复用 | 复用真实 VendorRequestError/role、Node EventEmitter、真实 HMAC lease authority + 临时 store、实际 lane singleShot adapter 和现有 React SSR。模拟执行/网络边缘，不模拟掉被检验的保护。 |
| ★4 状态 | cancelled 保持独立终态，unknown 保持在途；只有 text 的传输错误是安全重试阳性。媒体未知/可找回/阶段超时/取消不自动重发。MCP 退役名、缺租约拒绝和 singleShot 工具禁用继续是负例。 |
| ★9 验收 | 三组 old/new 小切片，全部 maxWorkers=1，保存 JSON 和逐项负例；不调超时、不增删 skip、不碰预算/冻结/PNG。只交本地独立 commit，不 push、不全套、不 App/Provider；作者不承担最终独立 review。 |

## 有限对齐表

| 测试 | 真实依据与保留/新增的正反例 |
| --- | --- |
| laneDesktopStructure | 文件名保留不等于 chatV2 复活；验证旧 runner 仅 type、真实 adapter 到 lane.singleShot、Host tools=[]/项目绑定，以及无工具回调/无附件授权不能穿透。旧 IPC/退役 controller 禁止断言保留。 |
| customCallFalQueueFixture | partial mock 只替换请求执行，保留真实 VendorRequestError 与 vendorRequestRole。原 submit/status/result/auth 五调用阳性保留；结构错误身份、redaction、单次提交负例。 |
| higgsfieldContract | 共享词表 cancelled，不复制供应商状态集合；原 nsfw 本表/移表反例保留，取消不变失败，陌生状态不变成功/失败。 |
| jimengWeb/ipc | BrowserWindow mock 用 EventEmitter 支持 on/once，真实窗口角色登记保留；复用、关闭注销、不同信任角色和 session 配置断言。状态探测也模拟，禁止访问实际本地服务。 |
| mcpSurfaceCollapse | 精确保留两个既有 MCP-only 工具，校验声明/路由/租约/付费注解；原全部退休名拒绝、顺序及映射断言保留，不把 actual 当 expected。 |
| nomiMcpElicitation | 真 authority/store 签发 fixture leaseHandle；正确 project/scope 才让模拟本地动作执行，缺/错租约必须红。其它创意/预算门断言不变，不绕过 schema。 |
| taskApi.terminalOnly | 精确六状态/三在途/三终态；保留 unknown/陌生状态不完成，提交/轮询到终态才完成一次。 |
| generationPhaseDeadline | TypeError 阳性明确 kind=text；image/video/未声明 kind 反例，以及已有 timeout/recoverable/cancel 排除。 |
| runProjectDelivery.background | 删除后重试用 text 夹具，证明重试重读图且不复活；独立媒体 unknown/no-retry 及普通未删除 text 第二次成功阳性。其它跨项目/不可变身份负例不动。 |
| NodeResultDownloadButton | 精确既有 compact labels，中英 SSR；正确 tooltip/可访问名称/有效结果显示与隐藏反例，不改 callback。 |
| CanvasSkillNodeBody | 短标签与长 aria/title 分开断言；保留 missing/ready，增加错类型与 readOnly 不能启用。 |

## 旧证据

清单按完整文件名读取：`/Volumes/S7/AiWork/Projects/CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/vitest-integrated-full-01.failure-inventory.json`；原日志同目录 `vitest-integrated-full-01.log`，属于 209f 的历史全测，不作为本基点复验。

本基点独立 old 切片（bundled Node 24.19.0 / Vitest 4.1.8）：A 六文件 52 通过/6 失败/1 原有 skip；B 三文件 40 通过/3 失败；C 两文件 1 通过/2 失败。合计 105 项，93 通过/11 失败/1 原有 skip。均已读回；JSON 在本 worktree `.tmp/stale-fixtures-contracts-20261025/old-{a,b,c}.json`。C9 的原有 skip 原样保留，不据此声称覆盖。

## 最终小切片证据

| 组 | 原序测试范围（见同名 v3 合同 regression_tests） | old | new |
| --- | --- | --- | --- |
| A | 第 1–6 个：lane / fal / higgsfield / jimeng / MCP surface / elicitation | 52 pass / 6 fail / 1 原有 skip | 67 pass / 0 fail / 1 原有 skip |
| B | 第 7–9 个：terminalOnly / deadline / background | 40 pass / 3 fail | 57 pass / 0 fail |
| C | 第 10–11 个：download / skill body | 1 pass / 2 fail | 10 pass / 0 fail |

最终共 135 项，134 pass / 0 fail / 1 原有 skip。比 old 增加 30 项；旧 11 个失败均为对照已变化 owner 后的过期测试/模拟契约，本切片未发现必须改生产实现的问题。未把 C9 算作通过，也不是全仓或合并 GO 结论。

实际每组使用 bundled Node `/Users/huawuer/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` 调用 `node_modules/vitest/vitest.mjs run <本组完整测试路径> --maxWorkers=1 --reporter=default --reporter=json --outputFile=.tmp/stale-fixtures-contracts-20261025/{old,new}-{a,b,c}.json`，三组顺序执行，未争用全量测试锁。

持久证据目录：`/Volumes/S7/AiWork/Projects/CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/stale-fixtures-contracts-09221429e/`。包含六份 old/new JSON、逐个正反例名称/状态的 `coverage-receipt.json`、11 文件 SHA256/白名单与 skip/超时 AST 对照的 `scope-audit.json`、`typescript-validation.json`、`eslint-validation.json`、`contract-validation.json`。读回总数一致；本 worktree `.tmp/stale-fixtures-contracts-20261025/` 留有同份原始证据。

新增负例包括：未认领附件与禁止工具循环；结构化未知提交的单次 runner 请求与密钥遮盖；cancelled 不等于 failed；退役 MCP 名继续禁止且批量付费注解保留；缺失/伪造/跨项目/错 scope 租约不能执行 Director 动作；unknown 不完成、三终态轮询只完成一次；媒体/未声明 kind 的网络错误不重提；删除后不复活、媒体 unknown 不重提；无结果/未选择/错结果类型的 toolbar 隐藏；错输入类型或 readOnly 不启用配方。对应阳性是实际 lane adapter、真实错误类/role、真实 authority/store 签发有效租约、保留节点的 text 第二次执行成功、中英既有 compact 显示。英文内置配方显示名来自现有 getter；节点原始字段序列化前后相等。

11 个修改测试的定向 ESLint 为 0 error / 0 warning；只对这 11 个根文件求 TypeScript 语法/语义诊断为 0，不声称全项目 tsc。`git diff --check` 通过。仅本 v3 合同的 `validateRootCauseChange` 返回 `ok:true, errors:[], triggeredFiles:[]`，无生产高风险文件变化，不声称历史合同全量门通过。

## 过程限制

保留中间失败 `intermediate-a1.json`（新 beforeEach 意外返回 mock 被当 cleanup）、`intermediate-c1.json`（新增断言误把内置显示名当原始值）、`intermediate-a2.json`（收尾非空校验识别到错误字符串截取边界）。均为本次新测试自身的问题，已分别修正 void hook、区分显示/源值、用 TS AST 精确定位唯一 singleShot 属性；最终 JSON 已重跑后读回，不拿早期绿灯覆盖后续失败。

旧 Jimeng 夹具没有隔离真实健康探测函数，因此 old 运行不能充当零网络证据；没有启动 App/runner 或执行 Provider 生成。新夹具显式模拟 probe、窗口加载和 runner 边缘，并以 global fetch tripwire 的零调用作补充。真实 lease fixture 只在专属临时目录写隔离 store，并自动清理；它验证协议 schema + 真实 authority，不冒充完整 Host/实际项目/客户端认证端到端证明。UI 仅 SSR，不声称点击 callback 端到端验收。

共享依赖已存在，未重装；固定基点任务不运行会 fetch 的 delivery:preflight。未运行真实 Provider、App、全套、PNG、冻结或计数预算门；这些未通过本批获得放行。无生产源码/回调/Host/capability/付费边界/用户项目修改，不写全局记忆，不改原独立报告，不 push。旧分支保留；作者不承担最终独立 review。
