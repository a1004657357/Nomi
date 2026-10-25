# 功能卡片分发保护

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

基点 `f7f3834293424fde9fb9135a6f394d3da25e556d`，新分支 `codex/functional-card-render-protection-20261025`；原分支保留。协调线已将 f7 集成为 297e8bfbf，本批只修 resolver 功能保留，不触碰其 metadata、冻结模型、PNG 或旧四簇其他 owner。

| 格 | 决定 |
| --- | --- |
| ★1 流程 | 历史 whiteboard/audio + shot-frame 仍有打开画板/上传/播放/转写功能；角色和场景继续允许已有合法显式选择。 |
| ★2 Owner | 既有 resolveNodeRenderKind 区分“功能本体 card”与“可选择的展示 card”。画板/音频优先专属 body；角色/场景先显式再默认，分类兜底不变。 |
| ★3 复用 | 复用原 RENDER_KIND_BY_NODE_KIND 和真实 NodeCardBody/尺寸消费者。只修一个生产文件，不加第二套 resolver 或持久化迁移，不新增依赖。 |
| ★4 边界 | 保护白板/音频全部不兼容显式展示值，不仅特判 shot-frame；不能让另一分类的 card 值再次藏掉功能。既有素材/技能/导演工作区/Agent 产物/分镜表保护不变。 |
| 5 花钱 | 不运行生成、上传、音频播放或 Provider；不改费用/权限/重试。 |
| 6 中断 | 不改长跑/异步处理器。 |
| 7 数据 | 输入 node、原 renderKind、meta、图像/音频 result 保持；只决定渲染，不写回、删字段或重排布局。 |
| 8 兼容 | V51→V60 迁移现仅防止新污染，已持久化 shot-frame 不会自动被清除；resolver 必须按功能所有权自愈而不是删旧项目或取消角色/场景选择。 |
| ★9 验收 | 原反例/类级矩阵 + 实际 NodeCardBody 渲染 + 真实尺寸消费者先红后绿。仅 maxWorkers1/no-file-parallelism；不跑重型/App/Provider/PNG。 |

## 真实消费者证据

- `registry.ts` 的 whiteboard/audio 均挂 `loadBaseGenerationNode`，并写明 whiteboard-card/audio-strip 是其功能 body。
- `BaseGenerationNode.tsx` 调 `resolveNodeRenderKind`/`isCardRenderKind`，只在 card 判定为真时挂 `NodeCardBody`，否则媒体 preview 显示。
- `render/NodeCardBody.tsx` 仅按 whiteboard-card 挂真实 `WhiteboardCardBody`、audio-strip 挂真实 `AudioStripNode`；没有 kind 旁路兜底。
- `WhiteboardCardBody.tsx` 内才有 `whiteboard-empty-action` 打开按钮；`AudioStripNode.tsx` 内才有文件输入、音频/进度/播放与转写按钮。
- `nodeSizing.resolveNodeVisualSize` 同样依赖 resolver，音频 card 固定 420×80；不能只改壳的 if 而留下尺寸/端口不一致。

上轮显式矩阵误把 whiteboard/audio 视为可任意换 body 的展示卡；本轮把其断言变为强制功能 card 矩阵，而非删除覆盖。角色/场景显式矩阵保留。

## 本轮验证

日志目录：`/Volumes/S7/AiWork/Projects/Nomi-i18n-display-align-20261025/.tmp/functional-card-render-protection/`。

| 阶段 | 结果 |
| --- | --- |
| Red，未改生产 | `red-complete.log`：3 文件 57 用例，13 失败/44 通过。精确脏值 2、所有展示值功能矩阵 2、音频实际尺寸 1、双语真实 body 8 失败；角色/场景显式矩阵及原保护分支保留。 |
| Green，有限修复 | `green.log`：5 文件 72/72。resolver 33、visualSize 16、真实 body 8，加原 aspectRatio 9、artifactMeta 6；全部 `--maxWorkers=1 --no-file-parallelism --cache=false`。 |
| 真实 body | 使用原 NodeCardBody，并等待 React.lazy 的真实 WhiteboardCardBody 完成流式 SSR；实际 AudioStripNode 的上传/播放/进度/转写/复制/字幕控件也执行双语渲染。只 mock 未打开的 WhiteboardModal；若其被挂载即抛错，不以 stub 按钮代替真实功能 body。 |
| 数据/尺寸 | frozen node 的原 renderKind、title、meta false/0、原音频 URL 与转写 result JSON 保持不变；音频污染前后仍为 420×80，画板尺寸与 clean 节点一致。不写回存储、不改变其他组件样式。 |
| 静态 | 四个修改 TS 文件定向 ESLint exit 0、无输出；`git diff --check` exit 0。唯一生产文件是 resolveRenderKind.ts。 |
| v3 | `ROOT_CAUSE_BASE_REF=f7f3834293424fde9fb9135a6f394d3da25e556d pnpm run check:root-cause-contracts`：门岗单元 55/55，实际 diff/schema exit 0，保留 1 条 owner-definition 不在调用门表的覆盖告警。门表来自实际工具，不手写假入口/自调用，不改 checker、scope 或豁免。 |

生产补接之前的草拟合同检查因所列待移除行为文件尚未改变而拒绝，补接后已过；该草拟红不计入业务 13 条红测。

没有重启 App、真实交互/画布绘制/音频解码、网络或 Provider、冻结模型/metadata/PNG/截图基线变更，也没有全仓/重型类型检查。流式 SSR 不证明实际指针打开或媒体播放，留给协调线隔离 UI 验收。此前代理失败的 delivery:preflight 未复跑，不冒充完成。
