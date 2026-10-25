# 媒体提交结果与等待预算设计卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

实现线：nomi-media-outcomes-20261024。类别：花钱 / 长跑 / 可打断；不新增界面。

| 格 | 结论与证据 |
|---|---|
| 1 用户怎么用 | 选择媒体模型 → 确认生成 → 等待有界响应 → 成功落资产或看到准确失败 → 结果未知先查后台/任务中心 → 核对后经既有确认再重生。真实任务形态：同步 JSON 生图、multipart 编辑、同步音频；本轮禁止真实生成，三者均 unverified。不碰 Go、代理配置、密钥、日常实例。 |
| 2 谁说了算 | 发送证据 owner 为 outboundDispatchEvidence；HTTP 错误与预算 owner 为 vendorHttp；错误动作 owner 为 narrate；持久提交 owner 为 submissionOutbox / submissionLedger。门表：door-map 对 requestJson/requestMultipart/requestBinary/vendorHttpTimeoutMs/isRetryableGenerationError/outboundRequestWasNeverWritten/isTransportLevelFailure 扫得 11 门。 |
| 3 一致与复用 | 复用未写出证据、submission-unknown、IPC 信封、release-regenerate 二次确认；不按供应商特判、不引入重试流程。 |
| 3 补充 | 原有单节点真人生成可免弹窗；对保存了未知结果的节点，在共享 spendConfirm 强制重复风险确认（zh/en），所有既有单发/变体/重生入口同源。 |
| 4 全状态 | 空/成功保持原样；加载等待角色预算；失败保留明确 HTTP 分类；未知结果双语说明不重复提交；部分成功沿现有任务状态；取消中沿调用者 signal；过期不推断计费。证据：class regression + zh/en 分类。 |
| 5 中途表 | 见下表。 |
| 6 外部数据与失败 | 代理提供 generation_outcome_unknown，按稳定 code/type 识别而非英文文本猜测；仅无明确 4xx 拒绝时采纳。401/400 原分类；断流/超时无未建连证据则未知。内部合同决定安全策略，不改变网络库版本。 |
| 7 性能预算 | 媒体提交 600000ms，配置/查询 120000ms；保留环境覆盖；响应体仍有限额，等待覆盖读体。非性能基准；真实耗时/内存 unverified。 |
| 8 真实条件 | 独立安装已完成；真实付费、Windows、英文窗口、最小窗口、真规模、键盘全程和截图均 unverified。本轮不启动日常 Nomi、不真实生成。 |
| 9 验收与回滚 | RED/GREEN、相关回归、typecheck、合同检查；不跑完整 build。主线独立线审 diff 并补本地 UI 双语验收；合并前独立验收报告待主线提供，不能自签。回滚 revert 本任务限定文件提交。 |

## 中途表

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 发送前 | signal 阻止发送，未计费证据在出站边界 | 原有持久层恢复规则 | 明确建连失败可证明未发送 | 原有账本恢复 | 节点排他/账本拒重复 |
| 等响应 | 取消仍有效，计费未知，留原调用错误 | 可能已提交，账本保守未知 | 无未建连证据则未知，不重提 | outbox/账本保留未知 | 未知结果不得自动重提 |
| 已完成/明确拒绝 | 不撤销上游事实，回执保留 | 回执保留 | 不改历史结果 | 按回执恢复 | 正常新付费确认 |
| 结果未知 | 不承诺退款/未扣费，核对原笔 | 不抹未知记录 | 不重提 | 仍需核对 | 只核对或二次确认释放再走付费确认 |

## 排查事实

- base 4b837f79137d7182dbe764ec116651487a4a008d，任务分支符合指定。
- delivery:preflight 仅运行一次：transport_failed，127.0.0.1:7897 不可连接，未重试。
- 安装首次沙箱 DNS ENOTFOUND；正常权限以同一指定命令成功，独立 node_modules。
- 核心 generate 提交只调用一次；轮询重试是查询，不是付费重提。生成重试策略仍需尊重结构化不可重试与未知证据。

## 先查别人

2026-10-25 同步时补充可核对的既有实现来源，不声称这是原实施前新增的外部调研。

- 仓库已有：`electron/outboundDispatchEvidence.ts:83` 的 outboundRequestWasNeverWritten 已统一判断未写出证据，继续复用它，不按供应商新增盲重提判据。
- 仓库已有：`electron/vendor/vendorHttp.ts:52` 的 vendorHttpTimeoutMs 以及 `electron/vendor/vendorHttp.ts:421` 的 requestJson 已拥有请求预算和传输边界，媒体与配置使用角色参数，而不是第二套 HTTP 客户端。
- 仓库已有：`electron/productionRun/submissionOutbox.ts:103` 的 createSubmissionOutbox 是持久提交与有界重试的现有 owner，未知结果保留原笔并查询，不再生成第二笔。
- 展示复用：`src/workbench/observability/narrate.ts:192` 的 narrateGenerationError 和同文件动作投影保持结构化错误到文案的共享路径，不把等待超时冒称额度不足。
- 结论：复用已有状态机、错误信封和传输，不引入新框架。该内部不变量由真实提交次数和持久化回读验证，自媒体经验不能替代证据，本轮未编造额外检索记录。
