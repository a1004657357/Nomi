# Renderer Batch 独立测试修复

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

固定基点 `460b68d77e822f28b3f6a9069768ef535673fd25`，分支 `codex/renderer-batch-compatibility-20261025`。按协调者最新要求单独交付，不依赖 WebBridge journey，不复制协调树工作区；旧 98e6 分支保留。

## 设计卡

| 格 | 决定 |
| --- | --- |
| ★1 流程 | 只修 rendererBatchCompatibility.test.ts 的过期 owner/fixture；生产不动。 |
| ★2 Owner | 真 projectSessionTestHarness 签发上下文；真实 confirmAndRunPlan/spendConfirm；semantic binding 拒绝仍在真实 main customLocalCanvasDispatcher，不复制到 renderer。 |
| ★3 复用 | 沿用 batchPlanPreview.confirm.test 模式；只替换 quote/mint/runner/日志边缘，真实确认 store 的 pending/queue 不 mock。 |
| ★4 状态 | 等确认时拒重复请求；重复决议不重发；取消、未打开/错项目、A→B 与 A→B→A 不 mint/execute。原始节点 prompt/图不改写。 |
| ★9 验收 | maxWorkers=1 小切片、代码 hash/范围及本 v3 校验；不 Provider/App/全套/基线/忽略/skip/超时/push。作者不承担最终独立 review。 |

## 证据

原完整失败清单同协调目录 `vitest-integrated-full-01.failure-inventory.json`；固定基点 old 的本文件三例均失败。旧测试 mock 已退休的 active-project getter 与 applyCanvasToolCall，真实项目 coordinator 没打开，根本未走到要测的保护。

新的七例通过：semantic firewall 在 main ingress 的实际 owner 前置拒绝（renderer/lease/quote/mint/execute 均零）；真实确认一次、去重 nodeIds、quoteId 透传、mint/runner 各一次；换项目/ABA/取消/未打开/错项目都不执行。firewall 不是 renderer adapter 的责任，拒绝断言迁到真实入口，而非删除或放宽。

命令：`node node_modules/vitest/vitest.mjs run electron/capabilityCore/rendererBatchCompatibility.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=.tmp/renderer-batch-ui-460b68d77/renderer-split.json`。

持久证据：`/Volumes/S7/AiWork/Projects/CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/renderer-batch-web-bridge-460b68d77/`，保留 old.json、renderer-split.json 和交付 receipt；源测试与已通过的联合候选逐字一致。单文件默认 lint 无 error/warning；同源 TS 定向诊断为 0，不声称全仓 tsc。本 v3 只校验当前合同，不跑历史全量门。

边界：quote/mint/执行端口是隔离 fixture，只证明 renderer 确认与项目授权链，不冒充真实扣费/生成、完整 Host 认证或 main GO。仅一测试与两文档，全部生产文件、guard、冻结/PNG/预算/计数基线不变。未重装/fetch，不处理 1cae813d2 的工具登记或新版 UI，不写全局记忆，不 push。
