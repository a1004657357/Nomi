# CI 视频悬停断线诊断

隔离基点 `e10258014c13521b4ff95801cef48a1b3d6c5c35`，分支 `codex/video-hover-diagnosis-20261025`，worktree `Nomi-i18n-display-align-20261025`。协调树只读，不在它写入/切分支/运行命令服务。此时协调线 315 截图在跑，本批禁止 App、浏览器、截图、全套、Provider；不碰 outbound 或 C 的 resident。

## 已证明与未知

日志：`/Volumes/S7/AiWork/Projects/CLIProxy-Tabbit-unification-20261024/runs/main-blockers-fix-20261025/ci-e102-core-empty-23.log` 的 1490–1538。empty 核心 4/4、手势 72 通过；76 节点中 32 视频、32 封面与 32 缩略图齐全。hoverToPlay 整阶段持续 19 秒（目标 gen-v2-video-020 的首次与重进各 holdMs=4000，并非单次悬停 19 秒），最高挂载 video=0，played/replayed=false；四条阳性对照因此正确失败。

**纯源码缺陷已证明，不把它猜成性能、权限或唯一 CI 根因：**

1. `BaseGenerationNode` 已有 `useNodeVideoPreviewIntent`，article 的 pointer enter/leave 更新 `videoPreview.requested`。
2. 壳调用 `GenerationNodePreviewBody` 时完全未传 requested；body 的 Props 也没有该通道。
3. body 把 `selected` 同时作为 Guard 的 `previewRequested` 与 `engaged`，混淆悬停试播和选中挂载。
4. Guard 本地 pointerInside 只显示 controls，不参与 wantsPlayer；它用调用方 previewRequested/engaged 的稳定意图决定挂载。封面/尺寸齐全、未选中/未聚焦/非主动播放时，即使命中 hover，丢掉的意图也使 wantsPlayer 为 false。
5. 因此这是先于网络请求/解码/自动播放权限的可复现阻断。增加等待、放宽视频计数或跳过阳性对照都不能修复它。

日志摘要没有目标 pointerover/命中栈、当前 dragging/focus/selection 与网络拒绝详情；**不能据此排除遮挡、hover 未命中或其他并发问题**。本批没有运行真实环境，不能宣称四条 CI 阳性对照已通过。

夹具 `tests/ux/canvas-follow-hand/fixture.mjs` 的视频构造已设置 `meta.videoWidth/Height`，封面原本为空、启动后由原落盘边界补齐；日志已证明 32 个 thumbnail 齐全。上述“已测+有封面”的守卫分支并非凭空假设。e102 与先前 59ee 的 Base/body/resolver 文件内容相同，不能归因于最新 metadata 或白板/音频保护改动；本批不追猜最初引入提交。

## 最小方案与设计卡

| 格 | 决定 |
| --- | --- |
| ★1 流程 | 原整卡 hover 意图经 body 到既有 Guard；悬停试播与 selected 挂载分离，离开/重进仍由原守卫处理。 |
| ★2 Owner | Hook 只记录指针意图，Base/body 只传递；是否挂载、120ms dwell/800ms grace/拖动抑制仍归原 Guard，播放/互斥仍归 nodeVideoPlayback。 |
| ★3 复用 | 仅补一个必填 boolean prop 贯通两个现有文件，不加播放器/规则/本地 hover 状态或新依赖；类型边界防止再次静默漏传。 |
| ★4 状态 | hover 与 selected 的四种组合、readOnly 两态均独立验证。选中只挂载，不冒充 hover；键盘聚焦/主动播放规则不改。 |
| 5 花钱 | 不改权限/费用/出站，不运行任何 Provider、上传、生成或自愈请求。 |
| 6 中断 | 不改拖动/离开宽限/暂停/唯一播放者等事件处理器。 |
| 7 数据 | 不改 node/meta/url/poster/尺寸与持久化。实际测量 callback 保留。 |
| 8 兼容 | 保留 renderKind 及白板/音频功能保护，图片/其他 body 入口不变；不改变 deferred/resident 或播放策略。 |
| ★9 验收 | 先红后绿：Node 内实际调用 body，检查真实 Guard React element 的意图 props；TypeScript AST 核对实际壳 hook/事件/传参接线。只测接线，绝不伪造 playing 事件或媒体解码通过；原四条 structural 阳性对照/阈值/场景不改。 |

## 协调线串行验收建议

315 结束且集成后再运行**原样** structural 场景。先确认 pointerover 命中目标，意图通道成立且拖动标志未滞留，再看 video 是否实际挂载。若有 video 但不起播，才进一步取 play rejection、媒体加载/格式与权限证据；若仍没有，记录命中元素/遮挡/意图与守卫状态，不增加等待或改计数。必须保持空闲 0、起播阳性、最多 1 个在播、离开卸载与重进再播全部原断言。

## 本轮小测试与交接

证据目录：`/Volumes/S7/AiWork/Projects/Nomi-i18n-display-align-20261025/.tmp/video-hover-wiring/`。

- `red-complete.log`：只加测试、未改生产，接线 11 用例中 5 失败/6 通过。hover=true/selected=false 两种只读态均断线，selected=true/hover=false 两态均冒充悬停，实际壳没有传参的 AST 断言也失败。
- `green.log`：3 文件 51/51，接线 11 + 原 nodeVideoPlayback 7 + 原 resolver 功能保护 33。使用 `--maxWorkers=1 --no-file-parallelism --cache=false`，无浏览器/App/截图/播放/网络/Provider。
- `lint.log`：两个生产 TSX 和一个新测试定向 ESLint exit 0、无输出；diff 检查通过。没有跑生产类型全扫或全套。
- `contracts.log`：以真实 e102 为 base，v3 门岗单元 55/55、实际 diff/schema 检查 exit 0。草拟合同时生产尚未改导致预期差异检查拒绝，不把该红计入业务红测；实际接线后再验。
- 唯一生产 δ：Base 增加一条 prop；body 增加必填 boolean、解构并转给 Guard，保留 selected 的 engaged 职责。没有改 resident/deferred、播放守卫策略、media source、模型/权限/出站、冻结、白板/音频 resolver 或任何 structural 场景/阈值/阳性断言。

**状态：源码断线已实现未推送；CI 四个阳性对照仍待协调线串行真实验收。** 本测试不挂载任何播放器、也不替换 Guard 来回报播放成功；实际调用 body 得到原 Guard React element 并检查其真实 props。现有播放策略单测的 fakeVideo 只作原单元回归，不充当 CI 播放证据。报告不能把 Node 绿测写成 played/replayed=true。
