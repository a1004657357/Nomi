# 四簇生产 Owner 阻断

最初基点 `09221429ea0c94955334b7c66c72b6620bb7b001`，原分支 `codex/production-owner-blockers-fix-20261025` 保留。优先 P1 已单独提交后，本批从 `504d1bdfc97ce06369e61b9b84c037f71139f4e7` 新建 `codex/production-owner-blockers-resume-20261025`，恢复 stash `c7265c98732202fb0a0ce8d3f8c87c091c5cc4cb` 而不删除原 stash；相关生产文件和展示 fixture/Node 测试在两基点间无变化。禁止 reset、push、Provider、日常 App、全套、媒体或截图基线变更。库存来自协调线 `vitest-integrated-full-01.failure-inventory.json`，仅处理本批四簇。

| 格 | 约束 |
| --- | --- |
| ★1 用户流程 | 既有假人/动画仍用原模型；显式有效 renderKind 不被默认值顶掉；失败/取消提示只说已知事实；首次规划及修订都收到既有屏幕可见性规则。 |
| ★2 Owner | 地址唯一归 director/scene/character/mannequinAssets；分发只改 resolveRenderKind；提示文案改实际 locale owner；规划规则引用已有 compiler/shot-prompts owner，不复制规则。 |
| ★3 复用 | 保留旧导出名与调用入口；不新增依赖、whitelist、检测器或 baseline；不动费用计算、权限、确认、重试、冻结、最终镜头出站规则。 |
| ★4 状态 | 区分 Nomi 模型/locomotion GLB 与 UE4 模型，不换资源。硬工作区/分镜表语义保护不变；只消除显式覆盖前的冗余默认返回。双语失败文案不许从取消/失败推导账单。规划与修订只加宿主规则，不重写原故事/plan JSON/用户 prompt。 |
| 5 花钱 | 不调用 Provider，不承诺未扣费，也不改变任何付费/权限分支。 |
| 6 中断 | 不动取消/重试处理器、请求参数或调度，只改可见文案。 |
| 7 数据与并发 | URL 仅 three loader 渲染，不写入项目；node/plan 输入不得被修改，持久数据不迁移。 |
| 8 兼容 | scene3d/ueSpike 继续经原模块重导出地址；既有优先级中的 asset/editor/agent-artifact 和 storyboard 标记不放松。 |
| ★9 验收 | 每簇独立 red→green，maxWorkers=1/no-file-parallelism；保留原失败断言、白名单、费用检测。新增真实 owner 执行回归；每簇独立 v3，最后定向 lint/合同/diff。没有 App/真 GLB 渲染或真实生成验收，不以单测替代。 |

## Red / Green

日志目录：`/Volumes/S7/AiWork/Projects/Nomi-i18n-display-align-20261025/.tmp/production-owner-blockers/`。前三簇的 red 在 P1 中断前真实执行，相关源文件在 092→504d 间相同；恢复后重新执行全部 green，不冒充重新执行过 red。

| 簇 | 先红 | 本轮绿与精确变更 |
| --- | --- | --- |
| GLB owner | `assets/red.log` 原守卫 1 失败/2；`red-owner.log` 新导出身份回归 2 失败/3。 | 原守卫 + 真实导入身份回归 5/5。`mannequinAssets.ts` 单一构造，`scene3dConstants.ts` 和 `ue4MannequinRig.ts` 保留重导出；三种原 URL 完全一致，不替换模型/动画，不扩大四路径白名单。 |
| 显式渲染 | `render-kind/red-class.log` 5 失败/31（原显式断言 + 四种 intrinsic-card kind）；保护分支仍绿。 | resolver + artifactMeta 37/37。只移除显式分支前的重复 intrinsic 返回，保留后面的默认决策、素材/编辑器/Agent 产物/分镜表硬约束；无数据写回。 |
| 真实费用文案 | `claims/red.log` 原两个词典检测 3 失败/28；`red-copy.log` 新双语显示/原值隔离 2 失败；`red-display-contract.log` 精确 fixture δ 1 失败。 | 原检测 + 新双语回归 30/30；独立 Node 43/43。只改三个实际 locale owner 和一个对应 fixture 值，Node 明确核对这一个新值并恢复旧值后再验原哈希。原 475 keys/37 files/111 bindings、21 个已批准动作短名、所有 class/binding 哈希保留，未改 PNG。 |
| 规划屏幕规则 | 原 `prompt/red.log` 2 失败/10；本轮 `red-resumed-two-files.log` 8 失败/16（原 2 + 新六种模式/修订边界）。 | storyboard + launcher language 16/16。`storyboardLauncher.ts` 仅新增共享常量 import 及两个宿主引用。完整规则各出现一次且位于用户正文/当前 JSON 之外，原故事/JSON/已选模型/参数/修改要求不改写。共享规则及最终 compiler 不改。 |

`green-resumed.log`：9 文件 88/88；所有 Vitest 均用 `--maxWorkers=1 --no-file-parallelism --cache=false`。`claims/display-green-resumed.log`：Node 43/43，自包含现有 TSX/app 配置，无全局 React 或生产无用导入。`lint-resumed.log`：12 个修改 TS 文件定向 ESLint exit 0、无输出。原 bundle/noChargeClaims/outcomeText 检测文件、P1 项目存档文件、canonical sourceDefaults、共享屏幕规则以及冻结模型面均未改。

补跑 `nodeSizing.aspectRatio.test.ts` 和 `nodeSizing.visualSize.test.ts` 两个真实 resolver 下游消费者回归：2 文件 23/23，见 `render-kind/sizing-green-resumed.log`。合计定向 Vitest 11 文件 111/111（分两次），并非全仓执行。修改的 Node 文件已被现有 `test:eng-system` 串入，新增 TS 测试沿用现有 Vitest 自动收集，不新增平行 gate 或 package 脚本。

英文 network hint 原本是费用不确定性的免责声明，并非“未扣费”保证；本批让错误提示只谈请求与网络/代理下一步。`free composition` 指“自由构图”，不是明确免单，单列为英文歧义，改成 `unrestricted composition`；中文、canonical rationale、存储和出站 prompt 均不变。不把这两处描述成已经发生的扣费缺陷。

## 兼容与合同

本地 `origin/main=182666a9888ebadc8d45991e507e440064dfc5d3` 树仅有 director 的 mannequinAssets，未列出这两个 Scene3D/UE4 模块。这里只证明树中缺失，不推断删除历史；当前 fork 仍有真实 Scene3D/locomotion/UE4 消费者，不能按官方树删自定义功能。本批保留全部路径、公开导出、rig 数学、编辑器与原始资产，只合并地址构造 owner。

四份独立 v3：`2026-10-25-bundle-glb-single-owner`、`2026-10-25-explicit-render-kind`、`2026-10-25-truthful-outcome-copy`、`2026-10-25-planner-screen-visibility`。门表全部来自实际 door-map；规划修复新增一个必要的共享规则读取点，2→3 扇，未新增业务入口或规则副本。

`ROOT_CAUSE_BASE_REF=504d1bdfc97ce06369e61b9b84c037f71139f4e7 pnpm run check:root-cause-contracts`：55/55 门岗单元通过、真实 diff/schema exit 0，但**仍有 6 条覆盖告警，未清零**：资产三文件、resolver 一文件、locale 两文件。工具只数调用/读引用，不把纯定义和重导出算门；已在对应 v3 的 residual_risks 单列，保留实际生成消费者门表和真实共享边界，不手写假入口、不缩 scope、不加别名/自调用、不改 checker/豁免。草拟时刻在生产补接前的合同检查曾按真实 diff 因“待删 legacy 路径尚未修改”而失败；补接后已通过，不以该草拟红冒充业务红测。

## 未验收

未启动日常 App、Provider 或网络生成，无真实媒体提交、GLB 实际渲染、PNG/视觉基线、全仓或生产类型全扫。真实 UI/Three loader 与生成物屏幕物理可见性由协调线隔离验收；不宣称单位测试证明实际画面合规。未复跑此前代理环境失败的 delivery:preflight，不改代理，也不将该阶段记成功。原分支和 stash 保留，不 push/merge。
