# 剪辑页素材来源左栏（用户拍板方案 B 修正版）

> 起因：用户实测「剪辑页没有素材库」。真机确认剪辑页只有播放器 + 时间轴两行，左侧全空——
> 既够不着素材库（导入素材/配乐），也够不着画布（生成的镜头）。而叠加层却写着「拖音频到此当配乐」，
> 是一条无源的死提示。用户否掉了我最初的轻量弹层方案（A），理由成立：剪片高频动作是**比较和挑选**，
> 不是"取一个"；且主流剪辑软件都是左侧素材区，肌肉记忆是真实成本。折叠即可兼顾播放器。

## 范围

| # | 改动 | 落点 |
|---|---|---|
| S1 | 画布镜头派生纯函数 `selectCanvasShotSources`（筛有产物节点 + 镜号 + 缩略图） | `src/workbench/preview/canvasShotSources.ts` + 单测 |
| S2 | 左栏组件 `PreviewSourcePanel`：「镜头 / 素材」两页签 + 收起条 + 折叠态窄柄 | `src/workbench/preview/PreviewSourcePanel.tsx` |
| S3 | 镜头格子：draggable 发 `TIMELINE_GENERATION_NODE_DRAG_MIME`（复用 `encodeTimelineGenerationNodeDragPayload`）；点击走 `addGenerationNodeToTimelineEnd` | 同 S2 |
| S4 | 素材页签复用 `AssetLibraryContent compact showHeader={false}`（与生成页侧栏同款）；**新增 `includeAudio` 参数**放开音频，救活「拖音频当配乐」 | `AssetLibraryPanel.tsx` 参数化 |
| S5 | 预览页布局 2 行 → `[左栏 \| (播放器/时间轴)]`，折叠态存 store + localStorage | `PreviewWorkspace.tsx` + `workbenchStore` |
| S6 | 叠加层补「＋ 配乐」按钮（与「＋ 字幕」对称），点开 AssetPicker(accept:audio) 落播放头 | `TimelineSecondaryAddRow.tsx` |

## 不动项（守边界）

- **时间轴侧零改动**：左栏发的是生成页节点把手同一条拖拽消息，`TimelineTrack` 的 drop 原样接住。
- 生成页布局、`ProjectExplorerSidebar` 的素材库挂载不动；`filterImageVideoAssets` 默认行为不变（只加参数）。
- 不做剪辑节点（P1 并行版红线）；不动 `TimelinePreview` / `TimelinePanel` 内部。

## 验收门（R13 真机断言，逐条亲读截图）

1. 左栏「镜头」列出画布已出片镜头，带镜号；拖进视频轨落在光标处。
2. 点击镜头格子 → 贴到片尾、零空隙，时间轴段数 +1。
3. 左栏「素材」页签能看到音频素材（includeAudio 生效）；拖进叠加层成配乐、音频轨出现 clip。
4. 收起左栏 → 播放器变宽；重开 App 后折叠态还在。
5. 空画布时「镜头」页签给空态而非空白。

## 回滚

单 commit；revert 即回到两行布局。`includeAudio` 默认 false，回滚不影响生成页。
