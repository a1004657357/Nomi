# SHUO backlog 剩余五项 — 执行方案

> **✅ 五项已全部落 main（2026-08-02）**：
> 组端口 `cd7ba39a` · 按镜头拆 `03bc89d3` · @引用扩展 `83db80d2` ·
> 联系表 `4f8d400b` · 全局截图 `1e0d0200`。每项各自五门 EXIT=0 + 真机走查截图人眼验过。
> **其中「整组运行」加过又删**（本来就有，见 §2a）——用户当场指出页面上重复了。
> 走查脚本留在 `tests/ux/`：`group-ports` / `shot-cuts` / `mention-scope` / `contact-sheet` / `screenshot-hotkey`。
>
> **走查抓到、单测抓不到的三个真 bug**（都已根治，值得记住这类）：
> ① 组端口第一版只挂 `onClick`——拖着线松手走的是 `pointerup`、压根不产生 click，
>    最自然的手势会掉进「空白处新建节点」菜单（根治点在 `useDragToConnect` 的落点判定）。
> ② 联系表的 i18n 键写进了 `node.` 段、调用处按顶层取，按钮上直接显示原始键字符串——
>    **五门全绿也照样红**（i18n 门岗查的是「有没有硬编码文案」，查不出「键取不到」）。
> ③ 我自己写的第一版走查落点是猜的坐标，正好压在节点上 → 只连了 1 根，
>    差点被我误判成组端口的 bug（实际是「落在节点上就连那一个」的正确行为）。**断言的落点要算，不要猜。**
>
> **剩余待办（本轮明确没做）**：@ 引用的**文本类**（提示词库 / 文本节点 → 发送时展开成实际文字）——
> 需要 `promptMentions` 支持第二种按 nodeId 锚定的 mention kind，与「编号一致性」这条唯一真相源有交互，
> 单独一轮做。另：全局热键**真按下去那一下**没法在走查里验（Playwright 发不出 OS 级按键），留真机。

> 2026-08-02。开工文档见 `docs/plan/2026-08-02-shuo-backlog-remaining.md`（现状 + file:line 起手点）。
> 本文档是**执行方案**：每项的范围 / 不动项 / 数据结构 / 回滚 / 验收门。
> 第 1 项（任务中心）已落 `bea95577`；第 4 项（人物替换）用户已决定暂缓。

## 开工前实查到的、和开工文档不一致或它没说的事实

写方案前先把地基摸了一遍，有几处和开工文档的假设不同，**方案按实测的来**：

1. **「整组运行」比文档说的更接近完成**：点组框**已经会选中全部成员**
   （`components/useCanvasSelectionDrag.ts:182-194` → `selectNodes(memberIds)`），选择浮条随即显示
   「生成 N 个」。所以缺的不是机制，是**一步直达的入口 + 可发现性**。范围因此收窄成「组标签上加一个运行钮」。
2. **@ mention 的文件不在 `generationCanvas/assets/`，在 `src/workbench/assets/`**
   （`promptMentions.ts` / `AssetMentionSuggestion.ts` / `AssetMentionNode.tsx` / `AssetMentionSuggestionList.tsx` /
   `AssetMentionChip.tsx` / `PromptEditor.tsx`）。开工文档写的路径是错的。
3. **切镜检测可以「一趟 ffmpeg + 前端滑杆」**：`select='gt(scene,T)',metadata=print:file=-` 除了切点
   **还吐 `lavfi.scene_score`**。实测（ffmpeg 4.4，本仓 `@ffmpeg-installer`）：
   ```
   frame:0  pts_time:2   lavfi.scene_score=0.673689
   ```
   → **用低阈值跑一趟拿到 (秒, 分数) 全集，滑杆在前端过滤**，不必每动一次滑杆重跑 ffmpeg。
   滑杆瞬时响应，且只花一次解码。输出走 **stdout**（实测 stderr 无内容），别抄 `technicalCheck.ts` 读 stderr 的写法。
4. **`connectNodes` 这个名字有两层**：store action（`store/canvasGraphActions.ts:88`，不做能力校验）
   和纯 op（`model/graphOps.ts:80`，按 `source+target+mode` 去重、`order` 递增）。**能力校验只在
   `connectToNode` 手动连线路径上**。组端口/＠建边必须自己显式过 `validateReferenceEdge`，不能指望底层。
5. **本 worktree 的 dev Electron 被 XProtect 删过**（`dist/` 里只剩 `version`），
   `ensure-electron-signature.mjs` 只处理 `revoked` 判定、对「文件已不存在」无感。已从主仓复制补回。

---

## 2. 动态组端口 + 整组运行

### 2a 整组运行 —— ❌ 加过又删（2026-08-02，用户当场指出重复）

**结论：本来就有，不该做。已回退。**

我加了个 ▶ 在组标签上。但**点组框本来就会选中全部成员**
（`useCanvasSelectionDrag.handleGroupFramePointerDown`），选择浮条随即显示「生成 N 个」——
整组运行早就存在。于是同屏出现两个一模一样的动作（实测相距约 600px 同时可见），是并行版（违 P1）。

我在开工时其实**已经发现**「点组框会全选、缺的只是可发现性」，却还是把它做成了一个新按钮——
**「可发现性不足」不等于「功能缺失」，前者的解法不是再加一个入口。**

防复发：`GroupFrame.tsx` 顶部留了注释说明为什么这里不放运行钮；
`tests/ux/group-ports.walk.mjs` 加了反并行版断言——组被选中时全屏「生成」动作**必须只有一个**。

### 2b 组端口（展开式）

**语义（一句话）**：把一根线连到组上 = ①给组内现有成员各连一根真边 ②**记下这条「组入参」，以后新进组的成员自动补一根**。

- **数据**：`NodeGroup` 加 `inputLinks?: { sourceNodeId: string; mode?: GenerationCanvasEdgeMode }[]`。
  这是**声明**，真边仍是普通 node→node 边，图结构不变（不引入 group 端点，不违 P1）。
- **物化时机（只有两处，刻意不做持续 re-sweep）**：
  1. 建立组入参时 → 给当时所有成员补边；
  2. 成员**加入**组时 → 按现有 `inputLinks` 补边；成员**移出**组时 → 撤掉由该组入参给它连的边。
  > 不做持续对账是**故意**的：用户手删了其中一条展开出来的边，就该一直保持删掉，
  > 不能被系统悄悄加回来（那才是静默 bug）。代价是「手删的边在成员变动时不会复活」——可接受且可预期。
- **能力校验不绕**：每条展开边先过 `validateReferenceEdge`，不过的**跳过并计数**，
  一条人话 toast：「已连 9 个，3 个跳过：这些模型不吃角色参考」。绝不静默丢。
- **交互**：拖连线时组框高亮为可落点；落在组框空白区 = 连到组。
- **回滚**：`inputLinks` 是可选字段，删掉该字段即退化为「一次性批量连线」，已建的真边不受影响。

### 验收门（2）
- 单测：物化纯函数（现有成员/新成员/移出/能力不匹配跳过/重复不重连）。
- 走查：组标签运行钮点下去进任务面板；连到组后边数正确、跳过时有 toast。

---

## 3. 按切镜提取关键帧

- **主进程新模块** `electron/video/detectShotCuts.ts`：
  `detectShotCuts({ videoUrl, projectId }): Promise<{ cuts: { seconds: number; score: number }[]; duration: number }>`
  —— 固定用**低阈值 0.1** 跑一趟，返回全集带分数；复用 `resolveVideoLocalPath` 的同款逻辑
  （远端 URL 先落本地）、`resolveFfmpegPath` + `ensureExecutable` + `probeMediaMetadata`。
- **IPC**：`nomi:video:detect-shot-cuts`，preload `video.detectShotCuts`，`bridge.ts` 补类型。
- **前端**：视频节点浮条加「按镜头拆」→ 打开面板：
  - 「检测到 N 个镜头」+ **灵敏度滑杆（前端过滤分数，瞬时）**
  - 缩略图网格（每格 = 该切点抽的帧 + 时间戳 + 勾选框）
  - 底部「加入画布（已选 N）」——确认后才落节点。**绝不一键糊 30 个节点。**
  - **落点（用户 2026-08-02 拍板）**：拆出来的帧**自动成一组**（组名「拆自 <文件名>」），
    直接接上第 2 项的组能力（整组运行 / 连到组一次喂参考）。
- **抽帧复用** `extractVideoFrameToAsset(videoUrl, seconds)`（已支持任意秒），逐个抽、并发有上限。
- **⚠️ Portal 浮层用 `--nomi-*` 不用 `--workbench-*`**（后者只在 `.workbench-shell` 作用域内有定义）。

### 验收门（3）
- 单测：stderr/stdout 解析纯函数（含 0 切点、分数过滤边界）。
- 走查：真视频跑一遍，滑杆改数量，勾选后落画布节点数对得上。

---

## 5. @引用范围扩展（先做图类）

- **候选源**从「当前 image_ref fills」扩到三组：**当前参考** / **画布出图节点** / **素材库**，query 参与过滤。
- **选中一个还不是参考的**：先 `validateReferenceEdge`，过 → `connectNodes` 建真边 → 它自然进
  `image_ref.fills` → 照常 `@imageN`；不过 → 当场人话拒绝，不插 chip。
- **编号一致性不破**：仍然只有一条真相源（有序 fills）。`PromptEditor` 的实时重编号（`:86-101`）白捡。
- **@ 还没生成的节点**：允许——建边即可，`buildDependencyWaves` 保证先跑上游。chip 显示为
  「待生成」态（url 为 null 的 fill 已有 `status: 'pending-generation'`）。
- **文本类（提示词库/文本节点）第二步做**，需要 `promptMentions` 支持第二种 mention kind，本轮不动。

### 验收门（5）
- 单测：候选聚合 + 过滤 + 「选中未连接项 → 应建边」的决策纯函数。
- 走查：@ 一个素材库图 → 画布上真出现一条边 + chip 编号正确。

---

## 6. 宫格节点 = 联系表排版（用户 2026-08-02 拍板 a）

把选中的成图按格子排成一张导出，给客户/团队看整场戏。**不新增节点 kind**——白板的多图扁平导出
（`whiteboardCanvasExport.ts:22-63`）已经能做 80%，差的是「自动按格子对齐 + 一键把选中节点塞进去」。
(b) 多图输入容器**明确不做**：那是参考槽语义，和 2b 组端口是同一件事的两种外形，做了就是并行版（违 P1）。

---

## 7. 全局截图进画布

- **先 Context7 拉 Electron `desktopCapturer` / `globalShortcut` 官方文档**再写（R5，新 API）。
- 主进程：`globalShortcut.register` → `desktopCapturer.getSources({ types: ['screen'] })` →
  透明全屏 `BrowserWindow` 选区（抄 `browser/media/browserPromptScreenshotSelection.ts` 的交互）→
  裁剪 → `writeAsset` → 落画布 image 节点。
- **必须**：可关 / 可改键（设置项）；退出与失焦时 `unregister`；macOS 未授权屏幕录制时给**人话提示 +
  指路系统设置**，不静默失败。

### 验收门（7）
- 走查：真按快捷键 → 真选区 → 真落节点；关掉开关后热键真的不再响应。

---

## 明确不做（写下来防止手滑）

对象存储、去字幕、对口型、抠像、人声分离、超清放大、换脸 —— 供应商能力包按钮的广度打法，不做。
也不抄「××工作室」独立页面形态（他们是线性流水线，我们是自由画布）。

## 全局纪律

每项：五门 `pnpm run gates` 亲验 EXIT=0 → 真机走查 + 自己 Read 截图 → 落 main，**做完一项推一项**。
