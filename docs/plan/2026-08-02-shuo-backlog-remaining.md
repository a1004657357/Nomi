# SHUO 对标 backlog 剩余项 — 交接与开工文档

> 2026-08-02。来源：`docs/research/2026-08-01-shuo-canvas-benchmark.md`。
> 第 1 项（任务中心/队列面板）已落 main `bea95577`，方案见 `docs/plan/2026-08-02-task-center-queue.md`。
> 本文档给**剩余五项**（2/3/5/6/7）铺现状与最短路径；第 4 项（人物替换）用户 2026-08-02 决定**暂缓**，分析保留在 §人物替换。

## 立场（先读，决定什么该做什么不该做）

Nomi = 本地优先 AI 视频创作工作台，单人开发，用户是**原创短剧创作者**。

- **不做「广度打法」**：把供应商能力一个个包成按钮（去字幕/对口型/抠像/人声分离/超清放大/换脸…）明确不做。要接就按「模型身份 + 通用槽」通用接入（P4），不为单个模型写专属 UI。
- **不抄竞品的页面形态**：SHUO 是线性流水线架构，我们是自由画布。他们的「××工作室」独立页面是他们架构的产物，硬搬会和画布语义打架。
- **诚实交付优于功能数**：缺口明着标（P3/D4）。宁可少一个按钮，不要一个会撒谎的按钮。

## 已经落地、别重复造的地基

第 1 项刚落的东西，后面几项会直接用到：

- **生成队列 store**（`src/workbench/generationCanvas/runner/generationQueueStore.ts`）：整批（含后续波次）一次登记，可读、可取消、有刹车。与 `node.status` **零重叠**——队列管「已调度但没跑起来」，`node.status` 管「跑起来之后」。加新的批量入口时，走 `runGenerationNodesByPlan` 就自动进任务面板，**别另起调度**。
- **任务面板**（`src/workbench/taskCenter/`）：顶栏入口 + 右上浮卡。新的批量能力（如「整组运行」）不需要自己做进度 UI。
- **根层 `--nomi-danger`**：Portal 浮层的错误色用它。⚠️ `--workbench-*` 只定义在 `.workbench-shell` 作用域，**Portal 到 body 的浮层够不到、会静默退回继承色**。运行时 token 真源是 `tailwind.config.ts` 的 `addBase`，不是 `src/theme/nomi-tokens.css`——两处都要写。
- **走查脚本样板**：`tests/ux/task-center.walk.mjs`（真 UI 加节点 + 裁近了看 + computed color 对账 + 几何断言）。新做的面板照这个写。

---

## 2. 动态组端口 + 整组运行（高，先做）

**用户那一刻卡在哪**：同一个角色定妆图要喂给一整场戏的十几个镜头 —— 现在得连十几根线。把画布按「第 1 场 / 第 2 场」分组组织好之后，想按场出片，每次还要重新框选一遍。

**现状（实查）**：
- `NodeGroup` 定义 `src/workbench/generationCanvas/model/generationCanvasTypes.ts:181-191`：`id / name / categoryId / nodeIds / color? / frameBounds? / collapsed? / createdAt / updatedAt`。
- 成员关系**双向冗余存**：`group.nodeIds` + 节点上的 `node.groupId`（`generationCanvasTypes.ts:147`）。`groupSelectedNodes` 写入时两边同步（`store/canvasGraphActions.ts:183-224`），保证一个节点只属一个组。
- 组的 action 全在 `CanvasGraphActions`（`store/canvasStoreTypes.ts:66-76`）：`createGroup / groupSelectedNodes / renameGroup / setGroupColor / ungroup / ungroupGroups / deleteGroup / moveNodeToGroup / removeNodeFromGroup / reorderGroup / moveGroupNodes`。
- **组没有任何端口/连线语义**。边 `GenerationCanvasEdge`（`generationCanvasTypes.ts:193-206`）的 `source`/`target` 恒为 node id；`connectNodes(sourceNodeId, targetNodeId)` 签名即 node→node。全仓没有 group 当边端点的用法。
- 「生成选中」实际叫 **`handleBatchGenerate`，`components/GenerationCanvas.tsx:361-367`**：`const ids = [...selectedNodeIds]` → `buildDependencyWaves` → `confirmAndRunPlan`。**它完全不认识 group**。

**最短路径**：

1. **先做「整组运行」——几乎免费。** 组的右键/头部加一个动作，把 `group.nodeIds` 喂给现成的 `buildDependencyWaves` + `confirmAndRunPlan`。有了队列面板，进度/排队/取消白捡。半天的活，先落它。
2. **再做「组端口」。这里有个架构岔路，建议走展开式：**

| | A. 展开式（推荐） | B. 真组端点 |
|---|---|---|
| 怎么实现 | 「连到组」在落边那一刻展开成 N 条真实 node→node 边；组只是输入手势的语法糖，图结构不变 | 让 `edge.source/target` 可以是 group id |
| 要改多少 | 只改连线落边处 + 组成员变化时补/撤边 | `resolveReferenceSlots` / `dependencyWaves` / `referenceEdgeCapability` / 持久化 schema 全链都要认第二种端点 |
| 风险 | 组内节点多时边会变多（视觉可折叠） | **引入平行的图语义**，违反 P1；每个读边的地方都要记得处理组，漏一处就是静默 bug |

  推荐 A。「动态」的真正含义落在：**组成员新增时自动补上同款边**（`moveNodeToGroup` / `groupSelectedNodes` 里挂钩），成员移出时撤掉。这才是「连到组上的入参自动共享给组内所有节点」。
3. **出参聚合**（组的输出自动汇总组内素材）：优先级低于前两项，且要先想清楚"聚合成什么"——如果只是"把这组的产物一起拖进时间轴"，那更像时间轴侧的能力，不一定要做成端口。

**注意**：能力校验不能绕。展开出来的每条边仍要过 `validateReferenceEdge`（`agent/referenceEdgeCapability.ts`）——组里混了不吃这类参考的模型时，要人话告诉用户"这 3 个跳过了，因为…"，别静默丢。

---

## 3. 按切镜提取关键帧（高）

**用户那一刻卡在哪**：拆解参考成片是高频动作——「这条爆款怎么分镜的」。现在只能抽首帧和尾帧，两帧远远不够。

**现状（实查）**：
- 抽帧完整链路：`nodes/NodeVideoFrameToolbar.tsx:32` → `nodes/extractVideoFrameToNode.ts:13` → bridge `video.extractFrame` → preload 通道 `nomi:video:extract-frame`（`electron/preload.ts:210`）→ `electron/main.ts:578-580` → **`extractVideoFrameToAsset`（`electron/video/extractVideoFrame.ts:105`）**。
- **`VideoFrameWhich = 'first' | 'last' | number`（`extractVideoFrame.ts:20`）——已经支持抽任意秒**。seek 基建（输入端粗 seek + 输出端精 seek，`:127-136`）现成。
- ffmpeg 路径解析 `resolveFfmpegPath`（`electron/export/ffmpegRunner.ts:197-210`），执行位靠 `ensureExecutable`（历史坑：缺执行位会静默丢音频，见记忆 `ffprobe-exec-bit-packaging-trap`）。
- 已有胶片条抽帧用了 `fps=…,scale=-2:H,tile=16x1`（`extractVideoFrame.ts:196`），缩略图那套可复用。
- **全仓没有任何 shot detection**（`scdet` / scene change / PySceneDetect 全零命中）。注意别和 LLM「拆镜头」（`electron/ai/canvasTools.ts:76,295` 的 `propose_storyboard_plan`）搞混——那是把剧本文本拆成分镜方案，不是对视频做画面级切分。

**最短路径**：
1. 主进程加 `detectShotCuts(videoPath, { threshold })`：ffmpeg `-vf "select='gt(scene,0.4)',showinfo" -f null -` 解析 `showinfo` 的 `pts_time` → 返回秒数数组。纯新增模块，放 `electron/video/`。
2. 每个切点复用 `extractVideoFrameToAsset(path, seconds)` 抽图 → 批量建 image 节点（`extractVideoFrameToNode.ts:50-65` 已有建节点的写法）。
3. **UI 千万别一键往画布糊 30 个节点**。先出预览：胶片条 + 「检测到 N 个镜头」+ 阈值可调滑杆 + 可勾选，确认后才落画布。这是用户可见改动，**先出样张拍板（R8）**。

**注意**：阈值是玄学，不同片子差很多。给可调滑杆并实时更新预览数量，比给一个"智能"默认值诚实。检测很慢的话进任务面板（走队列）。

---

## 5. @引用范围扩展（中，最需要想清楚再动）

**用户那一刻卡在哪**：写提示词时想引一段脚本、或者某个素材、或者视频里某一帧，现在得手动复制。用户 2026-08-02 原话：「主要是艾特的话，能艾特到很多东西」。

**现状（实查）**：
- 候选源注入自 `nodes/NodeGenerationComposer.tsx:292-295`：取当前节点当前模式下的 `image_ref` 槽（`resolveReferenceSlots`），把有序 `fills` 的 url 拍平。`AssetMentionSuggestion.ts:37-38` 只负责把这个数组映射成候选项，**query 不参与过滤**（参考是图、无人名可搜）。
- @ 插入的是 Tiptap inline atom `assetMention`（`AssetMentionNode.tsx:18-67`），属性 `url`（持久化）+ `index`（仅显示）。
- 持久化形态：`@[asset:<encodeURIComponent(url)>]` 存进 `node.prompt`（`assets/promptMentions.ts:10,17`）。
- **发送投影**：`projectPromptForSend`（`promptMentions.ts:48-59`）把标记按 url 在有序参考数组里的下标换成 `@imageN`，**编号严格对齐 `reference_image` 数组顺序**；找不到就删标记。

**这一项的关键约束（别抄坏）**：SHUO 那套「语言化引用」依赖模型自觉、静默失败；我们的强项正是**结构化连线 + 能力校验 + 拒发闸**。所以扩展候选源时，**@ 的东西必须落到真实结构化引用，不能只是文本里的一句话**。

**两类候选，语义不同，别混成一锅**：

| 类别 | 候选源 | @ 之后应该发生什么 |
|---|---|---|
| **图类** | 素材库（`useAllProjectAssets()`，见 `AssetLibraryPanel.tsx:166`）、画布上任意出图节点（`useGenerationCanvasStore` 的 `state.nodes`，配 `providesImageReference` 筛）、视频某一帧 | **自动建立参考连线并落槽**，然后照常走 `@imageN`。编号一致性不破。视频帧要先抽帧（复用第 3 项基建） |
| **文本类** | 提示词库（`fetchUserPrompts()`，`api/promptLibraryApi.ts:80`）、文本节点内容（`node.prompt`） | 不是参考图，是**文本注入**——发送时展开成实际文字，不能走 `@imageN`。需要 `promptMentions` 支持第二种 mention kind |

**最短路径**：先做图类（自动建边这条链是新的，但语义干净），文本类第二步。**做之前先把「@ 一个还没生成的节点会怎样」想清楚**——那时它没有 url，要么禁止 @、要么建边后由依赖波次保证先跑上游（后者更好，`buildDependencyWaves` 已支持）。

**注意**：能力校验闸不能绕。@ 建的边同样要过 `validateReferenceEdge`；目标模型不吃这类参考时要当场人话拒绝，不能让它悄悄消失（记忆 `relay-native-wire-profiles-shipped` 里那类"静默丢参数"的坑不要再犯）。

---

## 6. 宫格节点（中，**先出样张问清楚要哪种**）

**背景**：我们有「切图」（一张图切九宫格）——`hooks/useNodeImageEditing.ts:201-260`，纯前端 canvas `drawImage` + `toDataURL`（`:118-138`），格子几何在 `render/cropGridGeometry`。SHUO 的是**反向**：把多张图组织进格子，做分镜台本顺手。

**现状（实查）**：
- 全仓**没有**「多图拼成一张」的通用能力。
- 最接近的是**白板**：`whiteboardCanvasExport.ts:22-63` 的 `exportViewportWithoutEditorOverlays` 用 Leafer 把整个视口（多图/涂鸦/文字）扁平导出成一张 PNG/File，`WhiteboardModal.tsx:132` 落成节点主图。这是"场景扁平化导出"，不是"N 张图按格子排版"，但事实上已经能把多张图合成一张。
- 新增节点 kind 的注册点：`nodes/registry.ts`（`GENERATION_NODE_PLUGINS`）为主，另需看 `model/generationNodeKinds.ts`、`model/generationCanvasSchema.ts:3-5,96`、**渲染分发 `nodes/BaseGenerationNode.tsx:185-187` + `nodes/resolveRenderKind.ts`（主要的非自动注册点）**，按需还有 `model/shotNumbering.ts:19`、`model/buildClipFromGenerationNode.ts`、`model/timelineDragAffordance.ts:10`、agent 侧 `agent/generationCanvasAgentClient.ts` / `agent/referenceEdgeCapability.ts`。

**建议：先别急着新增节点 kind。** 「宫格」至少有两种可能，做法完全不同：
- (a) **联系表 / 分镜台本**：把 N 张成图按格子排版导出成一张，用来给客户看整场戏 → **白板已经能做 80%**，差的是"自动按格子对齐 + 一键把选中节点塞进去"。这更像白板的一个布局动作，不是新 kind。
- (b) **多图输入容器**：把 N 张图组织进格子当作一个整体喂给模型 → 那是参考槽语义，可能和第 2 项的「组端口」是同一件事的两种外形。

**先出可交互样张问用户要哪种**（R8）。选 (a) 的话工作量小一个数量级。

---

## 7. 全局截图进画布（中）

**用户那一刻卡在哪**：找参考时「截屏幕任意区域 → 直接进画布」很高频；现在得截图→存文件→再拖进来。

**现状（实查）**：
- 3D 编辑器截图：`captureScene`（`nodes/scene3d/scene3dMath.ts:488-535`），WebGLRenderTarget + readRenderTargetPixels → `toDataURL`。
- 浏览器节点截图：**主进程** `webContents.capturePage(rect)`（`electron/browser/media/browserViewMedia.ts:600`、`browserMediaVisualCapture.ts:120,184`），选区逻辑 `browserPromptScreenshotSelection.ts`（**做全屏选区可直接参考它**）。
- **`desktopCapturer` 和 `globalShortcut` 全仓零命中**。现有快捷键都是**窗口级**（`electron/windowZoomShortcuts.ts`、`electron/windowInput.ts` / `mainWindowInteractions.ts` 的 `before-input-event`），系统级全局热键**无先例可抄**。

**最短路径**：主进程 `globalShortcut.register` → `desktopCapturer.getSources` 拿屏幕 → 透明全屏 BrowserWindow 做选区（抄 `browserPromptScreenshotSelection.ts` 的交互）→ 裁剪 → 走既有 `writeAsset` 落项目资产 → 落画布 image 节点。

**注意（这项坑最多）**：
- macOS 需要**「屏幕录制」系统权限**，首次会弹授权；未授权时必须给人话提示 + 指路系统设置，不能静默失败。
- `globalShortcut` 抢占全局按键：**必须可关闭、可改键**，且 app 退出/失焦时正确 `unregister`，否则会影响用户用别的软件。默认键要避开常用组合。
- 新引入 Electron API，按 R5 **先 Context7 拉官方文档**再写（`desktopCapturer` 在较新 Electron 有权限与 API 变化）。

---

## 人物替换（第 4 项）— 用户 2026-08-02 决定暂缓

分析留档，别丢：

- **现状**：角色卡就是一个 `character` 节点（`nodes/registry.ts:73-86`），本质是张图（身份就是 `node.result.url`），`CharacterMeta`（`model/nodeMetaFields.ts:34-43`）只有 `tagline` + `tags`，**没有项目级角色实体**。跨镜复用 = 一张卡 → N 条 `character_ref` 边 → N 个镜头。
- **反查已有**：`hooks/useNodeRelationships.ts` 的 `buildUsageMap` / `countShotUsage` 已经能算「哪些镜头引用了这张卡」（角色卡上的使用数徽标就是它）。
- **批量执行已有**：`buildDependencyWaves` + `runGenerationNodesByPlan`。但 `buildDependencyWaves` 只在**给定选择集内部**分波，不会从一个上游自动展开所有后代——缺一个 `collectDownstream(nodeId, edges)` 的 BFS。
- **所以缺的只有两个薄纯函数**：`replaceReferenceSource(oldId, newId)`（把所有 `source===A` 的边批量改指向 B）+ `collectDownstream`。
- **路线取舍**：A = 换引用 + 重生成整镜（我们地基直接支撑，构图会变，必须在 UI 上明写）；B = 锁住原画面只换脸（SHUO 那种，需 faceswap 模型 = 供应商转售按钮 + 深伪风险，**建议不做**）。
- 另有独立缺口：3D 假人 `Scene3DObject`（`scene3dTypes.ts:13-48`）**没有任何 `characterCardId` 字段**，3D 摆拍与角色身份完全解耦。

---

## 工作纪律（每一项都适用）

- 用户可见改动**先出可交互样张 + 用户拍板**（R8）；改/扩现有 UI 先看它真实样子（读完整外壳组件或真实截图），样张 = 真实布局 + 改动，禁脑补。
- 多文件改动**先写 `docs/plan`**（R4）。
- 碰第三方库/新 Electron API **先 Context7 查官方文档**（R5），别凭记忆。
- push 前 `pnpm run gates` **亲验 EXIT=0**（别用管道，退出码会被 `tail` 吞掉）。
- 报完成前**真机走查 + 自己 Read 截图**（R13/P3）。整窗截图缩太小看不清字 = 等于没验，要另裁一张只含目标区域的。
- 修 bug 挖根因（P2）；加新必删旧、无并行版（P1）。
