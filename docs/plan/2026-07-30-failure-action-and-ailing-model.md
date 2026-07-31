# 失败后有明确下一步 + 病模型沉底 + Imagen 4 退役

日期：2026-07-30 · 样张已拍板（全做 + 病模型沉底灰掉仍可选）

## 为什么

用户真机撞 apimart Imagen 4（上游 Google 确定性 404）。上一个 commit（14c804a3）已让失败**说出真原因**，
但暴露了三个仍在的问题：

1. **不管什么错，卡上最显眼的按钮永远是「重试」。** 确定性失败（模型上游没这个模型 / Key 无效）重试
   一万次也是同样结果——按钮在骗用户。分类器已能分 15 类错误，却没有一类说得出「该干嘛」。
2. **只把 Imagen 4 删掉会把坑换成另一个坑。** 老节点已存 `modelKey=imagen-4.0-apimart`，模型记录一删，
   `findExecutableModel` 抛 `Model is not enabled: …` → 落 unknown 桶 → 用户看到英文技术报错 + 误导的
   「稍等重试」。删和兜底必须同一次上。
3. **手工删坏模型治不了这一类。** 实测 apimart 并没有下架 Imagen 4（还挂在 274 个在售模型里）——
   「在售」≠「能用」。今天坏的是 Imagen，明天可能是那 274 个里的另一个。要让「哪个现在真能用」
   由本地实测经验决定，不靠我人工维护名单。

## 范围

| # | 改动 | 落点 |
|---|---|---|
| A | 每类错误声明自己的主动作（retry / switch-model / open-model-access）| `observability/narrate.ts` |
| B | 新错误类 `model-retired`：模型记录已不存在/被停用 → 换个模型 | `observability/classifyError.ts`、`electron/catalog/executableModel.ts` |
| C | 错误卡按 action 渲染主/次按钮（主动作居首，重试降为次要小字）| `nodes/NodeErrorReport.tsx` |
| D | 病模型（近 24h 连败≥2）在模型下拉沉底 + 灰化 + 右侧标注；多家供应商时**全部**病了才算病 | `common/useDedupedModelSelect.ts`、`design/NomiSelect.tsx` |
| E | `resolveBestProvider` 避开病供应商（换家优先于换模型）| `config/modelIdentity.ts` |
| F | Imagen 4 走 `pruneRetiredModels` 退役（对已装机生效）| `electron/catalog/apimartImages.ts`、`seedBuiltins.ts` |

## 关键设计

- **A 的映射是穷举 Record**（`GenerationErrorKind → GenerationErrorAction`），新增错误类不补动作直接
  typecheck 红——沿用 narrate 既有的「结构性防失语」纪律。
- **C 不新增 props**：`switch-model` 用 `closest('[data-node-id]')` 找本节点、nudge 那个**已经在屏幕上**的
  模型下拉（错误卡下方 composer 里的模型芯片）。不在卡里内联第二个 picker——那会复制
  `handleModelChange` 的参数重置/档案解析逻辑（P1 并行版）。`open-model-access` 复用已有全局事件
  `nomi-open-model-catalog`（AssistantErrorCard 同一条，不造第二套）。
- **不给「改提示词」按钮**：提示词框本来就在错误卡正下方、一直可编辑，加按钮是多余（R2 好产品
  不靠按钮解释）。content-policy / input 的主动作给 retry（改完就是要重试）。
- **D 的判定不是模型级而是供应商级**：下拉是去重后的「模型」，一个模型可能 2-4 家供应商。
  只有**所有**供应商都在避让期才沉底，否则 E 会自动换到健康那家（避免 Nano Banana「3 家」里
  一家病了就误伤整条）。

## 不动项

- `modelHealthMemory` 的记账口径（连败≥2 / 24h 过期 / 成功清零）不改——只是多两个消费点。
- 手动选择永不拦：沉底/灰化只是**排序与视觉**，病模型仍可点（用户拍板）。
- `BaseGenerationNode.tsx` 零增长（740/740 巨壳无余量）——C 不加 props 就是为它。
- 付费链路、重试语义（`retry-must-not-wrap-paid-submit`）一行不碰。

## 回滚

单 commit，`git revert` 即可。F 的退役是数据迁移：回滚后 `reconcileModels` 会把 Imagen 4 重新插回
（curated 条目恢复），用户 catalog 自愈，无残留。

## 验收门

1. 五门 `pnpm run gates` 全过，亲见 `✅ 全门通过` + `EXIT=0`。
2. 单测：A 的映射穷举、B 的两种 miss 文案、D 的「一家病不算病 / 全病才沉底」。
3. R13 真机走查（复用 `scripts/failure-message-walkthrough.mjs` 扩两条）：
   - 撞上游 404 → 主按钮是「换个模型」，点了模型下拉真打开；
   - 老节点引用已退役模型 → 卡上是中文「这个模型已经下线了」，不是英文 `Model is not enabled`；
   - 下拉里病模型在最后一条且灰着。
   截图自己 Read 亲眼核对（眼见链）。
