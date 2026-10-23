# CLIProxy Agent 真实验收设计卡

实施线：独立 CLIProxy harness；类别：花钱、长跑、可打断。状态：已实现未推送；真实模型闭环与零网络落盘复验通过，独立审查待用户安排。

| 格 | 结论与证据 |
| --- | --- |
| 1 用户场景 | 验证当前 Agent 能读取隔离文稿、依据工具结果续答、下一轮保留上下文。步骤：创建独立 run → 持久化合成文稿 → 内存加载本机 client key → 生产 openLane → 要求读取文稿并回答 → 下一轮询问前轮内容 → 关闭 lane 并读回报告。两项真实模型任务是首次读稿续答及下一轮上下文回答；文稿明确为合成验收素材，不冒充用户作品。不做图片、批量、桌面 UI 或日常版合入验收。 |
| 2 唯一 owner | Pi/openLane 拥有循环与 session；生产 createDocumentLaneTools 拥有工具协议；harness 的磁盘 DocumentLanePort 仅拥有新建隔离文稿；注入 fetch 拥有外发硬限制与计时。证据：electron/agentLane/laneHost.mts、laneDocumentTools.ts、laneRuntimePort.ts。无生产概念变更，不修改其入口。 |
| 3 复用 | 直接复用 openLane、createDocumentLaneTools、原生 session/usage/projection，不用 agentChatV2、singleShot 或假模型替代真实验收。仅新增 tests/agent-runtime/cliproxy-real.*；先离线验证请求闸门和证据判定。 |
| 4 全状态 | 空：未开始；加载：受限请求进行中；成功：读工具/回传/续答/下一轮及持久化证据全部成立；失败：明确失败且不自动换模型重跑；部分：仅部分断言成立；取消中：中止请求并关闭 lane；过期：超时保留 unknown，不声明成功。CLI 无新增 UI/i18n。 |
| 5 中途表 | 未开始时 stop/关闭/断网/重启/重复启动均不发模型请求；进行中 stop/信号/超时会 abort 并关闭 lane，已发费用未知；断网/HTTP 错误锁死后续网络，不盲重试；进程被强杀可能仅有增量收据，不能声明通过；重启只开新 run，不恢复或重提旧 run；独立 run 目录排他创建，拒绝覆盖。正常完成后再次启动不会复用旧成功。 |
| 6 外部数据 | 只允许 http://127.0.0.1:8317 的固定模型端点与 gpt-6-sol；redirect 禁止；本机配置只在进程内解析，不记录 key/headers/原始配置。依据当前安装 Pi provider 与生产协议源码检查 wire；真实失败只报告状态码/分类，不输出私有原文，不归咎凭据。工具内容为本轮合成文稿。 |
| 7 预算与性能 | 全 run 硬上限 8 次实际模型 HTTP 请求，lane 另设同上限；固定模型，无 fallback。单请求与总 run 均有时限；记录每次请求开始/响应头/流结束耗时及 native token usage。价格未核实，金额始终 unknown，不将框架零价格视为免费。 |
| 8 真实条件 | 本轮计划实跑 macOS + 已有本机 CLIProxy + gpt-6-sol + 真 Pi 工具循环 + 磁盘隔离文稿。Windows、桌面 renderer/IPC/Undo、英文 UI、干净安装、图片尺寸、批量和日常版发布均 unverified。离线安全测试单独计数。 |
| 9 验收回滚 | 实跑报告写至外部 handoff reports 下独立 run，汇总到 cliproxy-agent-route-review-20261023.md；须证明真实 read_script、对应 call ID 的工具结果回传、续答及第二轮含前轮上下文，session/文稿落盘读回，模型请求不超过 8、无 key 落盘。用户另行安排独立审查，实施线不自称独立验收。回滚只移除本轮新增 harness/设计卡，保留 run 收据；不改生产代码，不提交/合并。 |

## 执行记录

- 新增 `tests/agent-runtime/cliproxy-real.mts` 与 `cliproxy-real.test.mts`，无生产代码变更。文稿端口读取隔离项目中的真实文件，仅暴露生产 `read_script`。
- fresh run：`20261023-cliproxy-agent-01`，真实 3 POST，均 200；第一次请求产生 read_script，第二次携工具结果续答，第三次是下一轮上下文回答，没有再次读文稿。全部 7 项 wire/回答断言成立。
- 原始 run 的最终收据错误地把派生 trace.jsonl 当作第二条 native session，故原始 report 保留 failed、退出 1。已补同目录 native/trace 反例先红后绿；修正只在 harness 的 native session 文件选择边界。
- 禁止网络的同 run 只读复验得到 passed，新增 POST=0、networkCalls=0；未重跑模型，未覆盖原始报告。原生 session 与文稿 SHA、tool call ID、两个 user turn、两轮回答均已读回。
- 离线 17/17 通过；类型检查与最终证据见外部报告。累计 input=2433、output=75、total=2508 tokens，金额 unknown；lane 已关闭，原 run 进程已退出。
- 本轮原始报告：`/Volumes/S7/AiWork/Projects/Nomi-zcode-handoff-20261020/real-runs/20261023-cliproxy-agent-01/report.json`。
- 只读复验：同目录 `verification.json`；汇总：`/Volumes/S7/AiWork/Projects/Nomi-zcode-handoff-20261020/reports/cliproxy-agent-route-review-20261023.md`。
- 实施线不自称独立审查通过；不据此宣布桌面 UI、其他渠道、图片、批量或日常版发布全部通过。
