# 时间轴体验包（SHUO 对标走查后的一揽子修复）

> 背景：docs/research/2026-08-01-shuo-canvas-benchmark.md 补充节。P0（裁剪渲染绑错字段）已先行落 main（c2fa668a）。本包收剩余体验债，用户已拍板方向（含两处取舍：拖放默认贴尾+⌥自由落点；生成页盲剪用右下浮动迷你预览窗）。

## 范围（按依赖序）

| # | 改动 | 落点 |
|---|---|---|
| L0-a | 节点「拖拽到时间轴」死按钮 → 点击=追加到轨尾（保留拖拽），文案改「加入时间轴」 | BaseGenerationNode + buildGenerationNodeTimelineClip + findAppendFrame |
| L0-b | 拖放重叠不再拒收：与移动同款「滑入最近合法位」；预览幽灵条显示真实落点 | timelineEdit.resolveLegalInsertStart（从 resolveLegalStartFrame 抽共核）+ addClipAtFrame + timelineDropFeedback |
| L0-c | 播放头落空隙时预览不再显示全局空态文案 → 「空隙 · 导出为黑场」（已核实导出=color=black 底） | TimelinePreview 空态分流 + i18n |
| L2-a | 点 clip 播放头落点击处（原：跳 clip 头） | TimelineClip onClick |
| L2-b | hover 幽灵播放头（半透明竖线，拖动/剪刀模式隐藏） | TimelinePanel tracks 容器 |
| L2-c | trim 手柄热区 12→16px | TimelineClip handleClasses |
| L1-a | 胶片条抽取 IPC：ffmpeg 一次出 16 帧横向拼条 jpg 落项目素材，会话内缓存 | electron/video/extractVideoFrame.ts 同模块扩展 + main.ts 4 行 handler + preload |
| L1-b | 视频 clip 全员真帧胶片（background 按 frameCount/offset 映射，裁剪即所见）；删「仅单选挂 video」旧机制（P1） | TimelineClip + timelineClipPreview 重构 + useTimelineFilmstrip hook |
| L1-c | 生成页时间轴展开时右下浮动迷你预览（跟播放头，视频/图片/空隙三态，可收起成小签） | TimelineMiniPreview + GenerationWorkspace 挂载 |
| L3 | 拖放默认贴尾（含素材库音频），按 ⌥ 自由落点；拖中给「将落位」时码 | TimelineTrack altKey 分流 |

## 不动项

- 波纹模型不整体引入（自由摆放保留，追加/滑入已覆盖高频路径）；预览页播放器结构不动；不做剪辑节点（并行版红线）；音频波形/变速/转场仍超范围。

## 验收门（R13 真机断言）

1. 点节点「加入时间轴」→ clip 出现在轨尾零空隙、时间轴自动可见；2. 拖放落到已占区 → 不拒收、滑入最近空位且预览条显示真实落点；3. ⌥ 拖放 → 自由落点吸附；4. 未选中视频 clip 显示整条真帧胶片，trim 后胶片窗口同步（所见帧=真实帧段）；5. 点 clip 中部 → 播放头即落该处；6. tracks 区 hover 出幽灵线；7. 播放头进空隙 → 迷你预览与预览页均显示「空隙 · 导出为黑场」而非拖入引导；8. 迷你预览跟随播放头显示当前帧，可收起/展开。

## 回滚

单 commit 包（或按 L0/L2/L1/L3 分 commit），revert 对应 commit 即可；胶片缓存为项目素材 kind=generated,source=filmstrip，可安全清理。
