# 分镜存档单 Owner

基点 `e83e30711f300b57c5a38f3766b01c56191ae4cd`；独立分支 `codex/storyboard-canonical-persistence-fix-20261025`，旧型号修复分支不动。生产范围仅 session/schema，另已说明必须触及真正读写归一化边界 `projectNormalize.ts`。

| 格 | 决定 |
| --- | --- |
| ★1 流程 | 旧单分镜/按稿分镜读取后迁入 `storyboardDesignsByDocumentId`；保存完整 owner，不再把当前选中方案的只读投影当第二份存档。 |
| ★2 Owner | `projectNormalize.normalizeRecord/normalizePayload` 负责只读兼容与归一化；document slice 继续管 canonical map；session 直接采样完整 map，不问选中投影。 |
| ★3 复用 | 保留现有 Zod、storyboardPlanSchema、hydrateStoryboardDesigns、真实 repository 的 read/save、保存队列/receipt。没有依赖、模型、UI、媒体、baseline 或 checker 改动。 |
| ★4 状态 | canonical（包括显式空 map）优先，不把旧投影复活成新方案。旧 version 1/2 record 及 flat record 必须从原始输入迁移；合法分镜、节点/关联、文档、Film Bible、用户参数和提示词保留。既有 schema 对未知废弃键/凭据的处理不放宽。 |
| 5 花钱 | 没有生成、Provider、付费调用或素材重提；用虚构 URL 字符串而非真实媒体。 |
| 6 中断 | 不改 debounce、dispose、异步保存完成/失败传播或 hydration epoch；原九个 receipt 断言和空 store mock 原样保留。 |
| 7 并发 | 原项目订阅只保存其捕获快照，切项目后不采样继任项目；真实 owner 测试覆盖完整多文档映射，不依赖 active selection。 |
| 8 数据 | 不访问日常项目。测试仅隔离 Node 内存 Storage；读取不改原始字节，显式保存才替换为 canonical 输出。没有不可逆批量迁移。 |
| ★9 验收 | 原 4 文件 11 失败/28 通过。先新增真实 legacy→owner→session writer→repository save→reload 测试跑红，再实现；定向 maxWorkers=1、不并行文件；补空 map、flat legacy、null legacy、双源优先级。定向 lint、v3 与 diff 检查；不跑全套/PNG/App/Provider。 |

## 证据与限制

- `workbenchProjectSession` 错把 selectActiveStoryboardDesign 的 plan/committed 写出，同时已经写了完整 canonical map。空 mock 因此提前崩在 selector，而非保存队列；移除投影后不得改 receipt 断言掩盖行为。
- `projectNormalize` 的读侧迁移已读取原始键，但返回对象又写出旧投影；生产 saveLocalProject 也调用它，故只改 session/schema 不足以收口。
- schema 只描述 canonical 输出；旧 plan 由 normalizer 的 raw-input 迁移独立验证。兼容输入的 deprecated TypeScript 字段保留，避免牵动选节点导出等非本批生产调用；这些调用保存时同样汇入 normalizer。
- 不把“只剩当前活动分镜”当内容保留；真实测试核对所有文档、所有设计的完整 plan、草稿/已提交/stale 状态以及原节点元数据、表格 source document/design 关联。
- 既有严格的关键画布校验、Film Bible 凭据剥离和方案 schema 策略不变。无效历史 plan 仍走既有诊断，不宣称修复损坏内容。
- 旧单方案/committed 的校验在 raw legacy 分支接住：无 owner 时损坏方案或非法 flag 继续硬失败，实际保存不覆盖原 JSON；null 方案视为“无方案”。有合法 canonical owner 时，坏的旧只读投影不再成为第二道 owner 校验。旧 map 的损坏条目维持原有诊断策略，不扩大本批为损坏内容恢复。
- 最终日常 App / Electron 文件系统及协调线完整套件由协调验收；本批不调用它们。

日志目录：本 worktree `.tmp/storyboard-canonical-persistence/`。

## 交付证据

- `red-existing.log`：原四文件 11 失败/28 通过；`red-roundtrip.log` 新七例全红。
- `red-content-before-cut.log`：先跑完整内容断言再验无投影；legacy single/map/current 均经过真实 store→repository save→reload，最终只在输出投影断言失败。此时尚未裁剪输出字段。
- `red-after-read-preservation.log`：先修 flat raw 输入保留与显式空 map 保留；七例内容断言全部通过后仍因旧投影写出而红，然后才裁剪 session/schema/normalizer 的输出。
- `red-legacy-validation.log` / `red-legacy-flags.log`：证明无 owner 时旧单方案/flag 需要保留硬拒绝，null 需要合法空态，再由同一 raw 迁移分支修复；不把校验缺席当绿灯。
- `green-final.log`：定向八文件 61/61 通过（原四、新往返、hydration、rename、selected-node payload），maxWorkers=1 且不并行文件。新往返共十三例，覆盖 single/map/canonical/flat/v2 五条实际保存链，以及 canonical 空态、损坏单方案/flag 不覆盖原存档、null 和陈旧投影。
- 定向 ESLint 零错误/零警告；`check:root-cause-contracts` 55 个 Node 用例通过并按真实任务基点核验本批 diff；最终脚本结果另记 `contracts-final.log`。所有旧失败断言与 saveReceipt 空 mock 均保留，无原测试文件修改。
- 实际执行的是 renderer Web Storage 保存腿，存储为 Node 测试独享的内存 Storage；并非 Electron 文件系统/日常项目/Provider 验收，不以此替代协调线的完整验收。
