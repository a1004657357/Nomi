# 独立审查后的工作流边界修复

## 范围

在 209f 审查 NO-GO 后，按真实输入、选择和进程出口修 R1/R2/R4，不把旧测试改绿当作产品修复。

- 机位名称输入回到原始 label，字段标题与景别选项仍可本地化。真实编辑回调分别验证中文追加、用户明确英文输入，不做反向翻译。
- Inspector 透传 selectedTarget.vendorKey；真实请求表达式经过既有 schema 和 selector，双供应商同名模型选中 kie 后仍走 kie，缺供应商仍拒绝。
- Director 的 pending/error/close/persist 四条取消生产路径都附既有 operation-cancelled；历史记录只认中英文完整句，引用/超时负例不误认。
- 正式 Node 展示回归按实际的一个 cancelled flag 校验两种通知分支，真实触发输入事件。475 keys、37 组件、111 bindings 原封保留。此处替代旧测试合同中“英文输入值应为 View 1”和两个中文 includes 的错误假设，不修改 PNG 或模型面冻结表。

## 实测

- reviewed-boundaries-red-01：新交互/进程用例 13 失败、4 通过；修复目标已真实复现。
- reviewed-boundaries-green-03：4 文件 115/115；包含真实 runner 四取消出口 × 中英、历史负例、实际请求参数、真实 selector、默认源值/几何/prompt 保留。
- display-after-review-04：正式 Node 展示 43/43，包含实际输入事件与通知 AST。
- AST 门表：实际 2971 个生产源，9e087893a → 工作树，四 owner 的引用 12 → 12，无新增外部生成入口。

## 未决

这只是三项局部修复，不代表全仓通过。完整单测 58 文件/102 用例仍有失败待逐类分诊；R5 resident 显示与型号兼容在另一补丁；冻结表人工批准、视觉基线、CI 和 main 合并回执均未完成。不启动日常 App，不改日常项目，不调用真实 Provider。

