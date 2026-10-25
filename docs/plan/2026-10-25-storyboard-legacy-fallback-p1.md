# 混合旧分镜 P1

基点 `7b52f6529520b6bd52a5bd1ca6c65ab204a86593`，分支 `codex/storyboard-legacy-fallback-p1-20261025`。四簇未提交工作已完整 stash `c7265c98732202fb0a0ce8d3f8c87c091c5cc4cb`，原分支保留，不混入本提交。复用依赖与 worktree，不新建重型环境。

依据新独立审查 `independent-review-7b52f6529-fresh-20261025.md`：a773 只分别测 single/map，没有覆盖“旧 map + 有效单方案”。旧 map 对象存在并不代表活动文档的数据已迁移；删除旧投影后，该缺口变成保存成功但活动载荷丢失。本批不恢复双 owner，而是修正唯一 normalizer 的迁移完备性。

| 格 | 决定 |
| --- | --- |
| ★1 流程 | 无 canonical 时，验证旧 map 后，用有效单方案补缺失的活动文档；空旧 map 与缺活动项的 partial map 都不得遮蔽单方案。 |
| ★2 Owner | canonical map（包括显式空 map）仍完全优先。没有 canonical 时，既有有效 map 文档不被单方案覆盖；只补空缺，不猜改既有设计。 |
| ★3 复用 | 唯一生产改动 `projectNormalize.ts`，复用已有 plan schema、诊断与原迁移设计构造。session/schema、保存队列、模型、费用和其他 owner 不改。 |
| ★4 损坏状态 | 非 canonical 覆盖的 malformed map/条目/plan/commit flag 或单方案必须拒绝，不能 warning 后成功保存并裁剪原数据。null 单方案仍是空态。显式 canonical 覆盖的旧投影保持既有忽略语义。 |
| 5 花钱 | 无 Provider/网络/媒体重提，仅合成 URL 和内存 Storage；不解释任何费用结果。 |
| 6 中断 | 原异步保存 receipt、项目切换、dispose 与失败传播逻辑完全不改；保留原九例。 |
| 7 数据 | 两篇文档、方案/锚/参数/原 prompt、表格 source document/design、图片与视频 result、引用、Film Bible、分类及 false/0 都经真实保存/JSON 重载核对。损坏数据实际 save 必须拒绝并保持原存储字节。 |
| 8 迁移 | 不开日常项目，不批量改盘，不恢复旧投影写入；仍由现有 load/save 路径懒迁移。旧 map 从“存在性优先”改为“逐文档覆盖”，不覆盖已有文档。 |
| ★9 验收 | 改 roundTrip 与 projectNormalize 相关回归，先 red 后 green；empty/partial 的断言放在真实 writer/save/reload 后，不能只测解析函数。maxWorkers=1/no-file-parallelism/cache=false。定向 lint/v3/diff；不跑全仓、App、Provider 或 PNG。 |

原不可读 map 测试把“warning 后无 owner”当通过，本批按用户要求收紧为抛错，同时保留 document/path 诊断断言，不放宽检测。损坏旧 map 即使有有效单方案也拒绝，避免猜测坏条目是否还含独有数据；不会宣称已修复残缺内容本身。

## 实际验证

证据目录：`/Volumes/S7/AiWork/Projects/Nomi-i18n-display-align-20261025/.tmp/storyboard-legacy-fallback-p1/`，均为本轮执行，日志不纳入提交。

| 阶段 | 真实结果 |
| --- | --- |
| Red：只改回归、未改生产 | `red-write-reload.log`：roundTrip + projectNormalize，46 用例中 11 失败、35 通过。empty/partial 的缺计划断言在真实 writer/save/JSON reload 之后失败；混合坏输入仍被接受的回归同样失败。 |
| Green：有限生产修复 | `green.log`：5 文件 64/64。roundTrip 25、projectNormalize 21，以及 persistence、saveReceipt、projectionInvariant；原九例异步收据/切换/失败传播全保留。 |
| 数据与优先级 | 两文档、既有 map 文档、fallback 单方案、已存在 canonical 三设计、image/video result、Film Bible、原 prompt/引用/表格 source/user meta/false/0；空 canonical 删除意图不复活。损坏数据的实际 save 拒绝，旧存储字节不变。 |
| 静态检查 | 三个修改 TS 文件定向 ESLint：exit 0、无输出。`git diff --check`：exit 0。 |
| v3 | `ROOT_CAUSE_BASE_REF=7b52f6529520b6bd52a5bd1ca6c65ab204a86593 pnpm run check:root-cause-contracts`：门岗单元 55/55，真实 diff/schema 检查 exit 0。门岗未把 normalizer 自动归为高风险路径，但新合同仍接受其 schema 校验；未新增豁免。 |

定向测试均用 `--maxWorkers=1 --no-file-parallelism --cache=false`。本批没有修改 session/schema、其他 baseline、checker 或公开 API。未跑全仓、生产类型全扫、Electron 文件系统/App/Provider、真实媒体或 PNG 验收；不宣称已恢复损坏内容或验证备份恢复。其他四簇留在原分支/stash，未包含本提交。
