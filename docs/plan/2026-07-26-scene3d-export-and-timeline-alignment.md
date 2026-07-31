# 3D 导演台出片链路：对齐剪辑软件的既成心智

> 日期：2026-07-26 · 状态：**方案**（用户已认可「拍片主线」思路 + 拍板 P2「主视口一键切成片预览」形态；本文按 R4 固化全盘，分期出小样张落地）
> 起因（用户原话摘要）：「整完轨迹不知道怎么生成参考视频」「按钮太多不会用」「时间轴只能拖那个球，点空白不过去」「拖的时候预览不动、是相机在动，不知道合不合理」「贴近市面上剪辑软件的交互，不然跟用户被训练出的习惯很不一致」「整个输出没补上这些东西，需要补 + 调整」。
> 方法：两轮 Explore + 亲读真实代码，根因全部钉在 file:line（下）。绝不凭印象。

## 0. 根因（真实代码，非推测）

**A. 出片终点被藏 + 引导说谎**
- 出片入口是顶栏一颗「变脸 CTA」：只有任务切到「运镜参考」它才叫「生成参考视频」（[scene3dTaskMode.ts:15](../../src/workbench/generationCanvas/nodes/scene3d/scene3dTaskMode.ts:15)），默认任务是 compose（[useScene3DTaskFlow.ts:65](../../src/workbench/generationCanvas/nodes/scene3d/useScene3DTaskFlow.ts:65)）。
- 多处提示仍指向已删除的「出片」按钮（说谎）：`export.moveReady`（[useScene3DFullscreenActions.ts:672](../../src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:672)）、`moveHub.ready`（[scene3dMoveHub.tsx:75](../../src/workbench/generationCanvas/nodes/scene3d/scene3dMoveHub.tsx:75)）、`fullscreen.inspectorJourneyHint`（[scene3dInspector.tsx:687](../../src/workbench/generationCanvas/nodes/scene3d/scene3dInspector.tsx:687)）。
- 静默失败：没就绪点生成只弹一句 `cameraMoveRequired`（[useScene3DFullscreenActions.ts:698](../../src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:698)），无向导、无补救。
- 出片面板已删但一整套 i18n 死文案残留（`scene3dJourney.ts` export.title/subtitle/referenceVideo/recommended/readySummary… + coach.exportStep），grep 确认 0 消费点。

**B. 时间轴/播放/预览与剪辑软件四处背离**
- **点空白不 seek**：「点哪跳哪」的 `setPlayheadFromClientX`（[TrajectoryTimeline.tsx:78](../../src/workbench/generationCanvas/nodes/scene3d/trajectory/TrajectoryTimeline.tsx:78)）写好了，但只绑在 16px 播放头球上（`TimelinePlayhead` onPointerDown），轨道 lane 容器没接点击。
- **拖动时"相机在飞、画面不变"**：主 Canvas 恒用固定 editor 相机（[Scene3DFullscreen.tsx:587](../../src/workbench/generationCanvas/nodes/scene3d/Scene3DFullscreen.tsx:587)），scrub 只驱动场景里相机对象沿轨迹位移；镜头成片只活在右上角 260px 小窗 `CameraPreview`（需先选中相机）/`PlaybackCameraMonitor`（仅播放时）。主视口从不切成镜头画面。「输出画面」模式（`handleToggleOutputView`）是进入即冻结的手动取景、不读 playhead，≠成片预览。
- **无空格播放**：键盘监听（[useScene3DFullscreenActions.ts:330](../../src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:330)）无 play/pause 键（空格被操控态跳跃/相机上升占用）。无循环。
- **时间轴长度是"UI 尺子"不是成片长度**：`totalDuration` 默认 10s，是各 binding endTime 的派生值、无处直接编辑；导出还要专门裁掉定格尾巴（[useScene3DFullscreenActions.ts:704](../../src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:704)）。

**C. 前置条件对用户不透明**：`isCameraMoveReady = 有轨迹(≥2点) 且 有绑定绑相机`（[scene3dPlayback.ts:45](../../src/workbench/generationCanvas/nodes/scene3d/scene3dPlayback.ts:45)）。预设自动绑、手画要手动绑、录 take 不经此判定——三条路前置不同，界面从不明说。

## 1. 目标与不变量

**目标**：把「出片」这条链，从「藏起来 + 各自为政」变成「终点永远显式 + 缺步一键补 + 时间轴/预览是大家用惯的剪辑软件那套」。

**不变量（守住不破）**：
- 三任务共用同一套编辑器状态，无并行版（P1）。
- 「成片预览」与「工作视图」是**同一场景的两个渲染视角**，不是两套编辑器（P1）——复用现有 `cameraWithPlaybackPosition` / `playbackCameraAtPlayhead` / `CameraPreview` 渲染逻辑。
- 单一 seek 真相源：`setScene3DPlayheadSeconds`（[trajectoryRuntimeStore.ts](../../src/workbench/generationCanvas/nodes/scene3d/trajectory/trajectoryRuntimeStore.ts)），点击/拖动/播放共用。
- 视觉走设计系统真色（墨黑主按钮 / 蓝紫 accent / 绿成功；无琥珀 warning）。
- **交互按模式拆分，不做全局抢夺**（用户 2026-07-26 洞察，升为通用原则）：键位 / 区域按「当前在哪个模式」（编辑 / 飞行 / 操控 / 预览）路由，模式互斥 → 天然不冲突；反面是让不同功能在全局层面抢同一个键或同一块区域。空格即三态拆分：**操控→跳跃、飞行→上升、其余（静止/看回放）→播放/暂停**；「工作视图 vs 成片预览」是同一逻辑的另一处体现。落地时飞行/操控/取景三态用 `hasPossessTarget` + `keyboardNavigation` 回调 + `cameraViewEditId` 判定，右键自由视角边界一并暴露覆盖。

## 2. 分期（每期独立五门 + R13 走查，可独立回滚）

### 第 0 期 · 止血（无设计悬念，直接做）
1. 改 3 处说谎文案 → 指真实入口（「运镜参考 · 右上角生成参考视频」）。
2. `cameraMoveRequired` 静默失败 → 分情况「一键补」：差轨迹→toast 带「打开运镜预设」；差绑定→toast 带「一键绑定相机并生成」（整张可点，走 showUndoToast 同款可点 toast）。
3. 删死码：`coach.exportStep*` + `export.*` 出片面板残留（逐个复核 0 消费点再删，P1 加新删旧）。
- 验收：走查触发未就绪出片 → 见可点补救 toast；grep 确认无残留死 key。

### 第 1 期 · 剪辑软件基础手势（无设计悬念，直接做）
1. **点轨道空白 → seek**：把现成的 `setPlayheadFromClientX` 挂到 lane 容器 onPointerDown（[TrajectoryTimeline.tsx:435](../../src/workbench/generationCanvas/nodes/scene3d/trajectory/TrajectoryTimeline.tsx:435)），与拖动共用真相源。✅ 已落码。
- 验收：走查点标尺任意处播放头跳过去。
- **空格播放已挪到第 2 期**（见下）：默认主视口是「工作视图（fly）」，`freeLook=!viewLocked` 时空格本就是 3D 导航（上升）——不该在工作视图抢它。空格的自然家是「成片预览模式」，跟第 2 期一起做才是干净拆分（对齐「按模式拆分」原则）。

### 第 2 期 · 成片预览主画面（program monitor）——用户已拍板形态，**出样张再落**
- 主视口新增「成片预览」只读模式：渲染相机 = `playbackCameraAtPlayhead` 的位姿（[scene3dPlayback.ts:216](../../src/workbench/generationCanvas/nodes/scene3d/scene3dPlayback.ts:216)），live 跟随 playheadSeconds；拖时间轴 = 主画面实时刷成片。
- 一键切换：工作视图（第三人称，摆运镜用）⇄ 成片预览（镜头画面，确认用）。复用 CameraPreview 的镜头渲染逻辑，搬进主 Canvas。
- 与现有 `cameraViewEdit`（手动取景、写回机位）明确区分：成片预览是**只读跟随**，不写回、不接管 fly 控制。
- 退出回工作视图，保持选中/播放头不变。
- 验收：走查切成片预览→拖时间轴→主画面镜头内容随之变；退出回第三人称。

### 第 3 期 · 时间轴 = 成片长度
- 让总时长所见即所得：要么显式可编辑，要么自动 = 真实运动终点（去掉 10s UI 尺子与导出裁尾巴的错位，根治 [useScene3DFullscreenActions.ts:704](../../src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:704) 的补丁）。
- 验收：时间轴显示长度 = 导出 mp4 时长（走查逐帧核对）。

> 关联但另线：出片终点「拍片进度主线 + 渐进披露」（上一轮用户认可的「拍片主线」思路）——待第 0-2 期把交互地基铺好后，再单独出样张推进，避免一次动太多。

## 3. 有意取舍
- 成片预览是「切换」不是「分屏」（用户拍板；密度优先，小屏两块都不够大）。
- 空格情境绑定（操控态让给跳跃/上升，不强抢）。
- 第三人称工作视图**保留**——3D 运镜设计必须从上帝视角看路径与空间关系，不是要废掉它，是补另一半（成片预览）。

## 4. 不做
- 不引入 React Flow / 第三方时间轴库（自研时间轴够用；避免并行版）。
- 不做 J/K/L、入/出点、时间轴缩放等进阶剪辑手势（等真实反馈再说）。
- 不改 3D 视口手势（WASD / orbit / 双击加点语义不动）。

## 5. 验收门（每期）
`pnpm run gates` 五门全过 + R13 真机走查（Playwright 进导演台，真截图人眼判断改动区）；每期出小样张经用户拍板后再落码（第 0/1 期无设计悬念，样张=改动说明即可）。
