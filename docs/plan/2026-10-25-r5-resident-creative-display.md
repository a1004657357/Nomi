# R5 Resident 创意操作显示修复

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

固定基点 `209f3f2d0765b1e8abb79a4567f7528b82e76965`；独立 sibling `Nomi-r5-resident-display-20261025`，分支 `codex/r5-resident-tool-display-20261025`。

## 设计卡

| 格 | 决定与证据 |
| --- | --- |
| ★1 用户流程 | Agent 请求读取配方/导演、准备派生计划、保存资源、GLB 交接或场景修改时，用户应从现有工具行和审阅摘要认出具体操作、来源、目标与边界，再决定是否批准。典型已有工作流：多机位配方计划、保存自有结果及授权信息、将已有 GLB 交给导演台并审阅场景编辑。仅修显示；真实项目/App/Provider 走查 unverified。 |
| ★2 Owner | 真实能力、alias、operation 和参数归现有 registry/schema/声明；显示归 residentToolDisplay，所有名称/摘要/字段共享同一投影，文案归 agentResident 双语资源。初始五显示导出为 98 文件/6 门；补齐 target 与两 locale 导出后，138 文件/10 门，原消费者与资源绑定保留。全 src/electron 搜索交叉核对。没有新能力/效应集合，不改 Host 或授权规则。 |
| ★3 复用 | 使用真实 toSemanticInput/aliasBoundInput 及 creative/localCanvas schemas；Director 模式使用现有 canonical parser 和 materializeVibingDirectorPlan，避免漏掉布局会替换场景的语义。复用 ResidentApprovalDetail/proposal 字段与现有 V4 消费路径，不改卡片布局。 |
| ★4 状态 | 名称与摘要描述请求意图，不用输入假称已执行。缺参数显示待确认；读操作说明不改项目；配方只准备计划、生成需单独付费确认；GLB 可下载/复制已有资源；本地 Blender 会写预览节点；批量只是请求原生确认，模型网络请求/费用尚未获批。完成/失败/取消仍由原 Host 生命周期决定。 |
| 5 打断 | 显示函数不调执行器、不写项目、不发请求、不安排重试；停/关窗/断网/重启/连点的执行与计费行为不变。不得将显示成功当成任何授权或执行收据。 |
| 6 外部数据 | 仅读取参数中的既有 schema 字段；敏感传输字段、凭据、URL、未声明嵌套字段不回显。保留用户标签/提示片段/授权事实/数值原文，不翻译源输入、不回写。无外部 API/依赖行为变更。 |
| 7 性能 | 每次对单次工具参数作有界 schema 投影（Director 最多 24 动作、batch 最多 24 ID），不查项目/模型/网络。性能真机未测，不改预算。 |
| 8 真实条件 | 仅允许 Node 离线、maxWorkers=1；真实中英组件 SSR 不等于 App/浏览器/PNG/Windows 验收，以上均 unverified。不启动 App、不调用 Provider。 |
| ★9 验收回滚 | 先原 registry 覆盖 17/19（2 红），再加 class 回归后红，再修实现并重跑限定切片与定向 lint/合同验证。只交独立 commit、未推送。原独立 209f 报告保留；本实现者不能最终独立审查自己补丁，协调者另派新审查者。回滚以该独立 commit 的 revert 为界。 |

## 范围与不动项

只改 residentToolDisplay.ts、residentToolDisplay.test.ts、src/i18n/locales/agentResident.ts 与本设计/v3 合同。不改 registry、Host、能力 schema、付费边界、fallback、R1/R2/R4、Node 旧取消断言、任何 PNG/冻结/计数基线。逐 registry 覆盖不减少、不复制一份公开工具清单来假放行。

delivery:preflight 会 fetch，故本轮按用户固定基点与离线限制不运行该远端入口；用本地 clean worktree、命名分支、固定 parent 和最终限定 diff 核验，不能声称远端 freshness 已通过。依赖从现有缓存 offline/frozen/ignore-scripts 安装，无下载、无 lockfile 变更；安装阶段结束前的模块启动失败不计为红测。

## 验证证据

- 原 209f：residentToolDisplay 19 项，17 通过/2 失败，失败为六工具及 creative.component.read/write、director.render 缺少人话名；2026-10-25 07:48:30，Vitest 4.1.8 / bundled Node 24.19.0 / maxWorkers=1。
- 扩展第一轮：33 项，17 通过/16 失败；新增真实双语、alias/canonical 一致、敏感字段、源值和 mode owner 测例在修复前均命中缺口。先运行后修改生产实现。
- 真实卡片补强：40 项中 3 红，明确证明只保留四个参数/独立详情投影会让实际卡片看不到 matrix5x5、CC0、actor-A。随后让实际 summary 带上全部 schema-approved 审阅字段，不用字段截断掩盖具体操作。未知字段/凭据仍不参与投影。
- 最终限定回归：2026-10-25 08:00:34，3 文件 / **77 通过、0 失败**，8.31 秒；residentToolDisplay 40、V4 intervention 33、residentExceptionProjections 4。命令：`node node_modules/vitest/vitest.mjs run src/workbench/ai/resident/residentToolDisplay.test.ts src/workbench/ai/resident/residentExceptionProjections.test.ts src/workbench/ai/v4/agentPanelV4Intervention.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=.tmp/r5-resident-display/green.json`，使用 bundled Node 24.19.0。实际 JSON 已读回 success=true、77/77、三个文件路径/结果；保存在本 worktree `.tmp/r5-resident-display/green.json`，不提交生成日志。
- 三个允许源文件的定向 ESLint：退出 0，无 errors/warnings；`git diff --check` 退出 0。
- 定向 TypeScript：以真实 tsconfig.app.json 创建 program，只取上述三个允许文件的 syntactic/semantic diagnostics，结果 targetFiles=3、diagnostics=0。不是全仓 typecheck 通过声明。
- v3：直接调用现有 validateRootCauseChange，只传本合同/本轮 changedFiles/真实文件内容。首次定位 locale 门遗漏后补齐真实 door-map，复验 ok=true、errors=[]；没有用只看 schema 或“警告不阻断”的包装结果冒充完整通过。不是全历史根因合同验收。
- 副作用：真实 V4 卡片中英 SSR、registry 全覆盖、canonical/alias、参数缺失/非法 operation、布局强制 replace、资源下载/复制提醒、模型网络/费用确认、源值 JSON/几何保持、凭据/租约/未知字段不展示、store/bridge/persist/fetch tripwire 全部在限定回归中验证。没有启动 App、浏览器、Blender 或 Provider，没有更新 PNG/冻结/计数基线。

## 独立验收

原独立报告 `/Volumes/S7/AiWork/Projects/CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/independent-review-209f3f2d0.md` 原样保留，不以本实现替换其 NO-GO 结论。本线现为 R5 补丁作者，**不能担任本补丁最终独立审查者**；协调者将另派新的独立审查。当前状态为已实现未推送，未合并，最终独立验收待定。
