# 任务中心 / 队列面板 + 完成通知

> 2026-08-02。来源：`docs/research/2026-08-01-shuo-canvas-benchmark.md` backlog 第 1 项（最大缺口）。
> 样张已拍板（2026-08-02），两个岔路用户选定：**外化队列做真取消** + **连续失败 3 个暂停并问**。

## 1. 为什么做（用户那一刻卡在哪）

框选 12 个镜头点「生成」，然后去泡咖啡。回来是这样的：

- 画布上有的出图了、有的还在转、有的红了 —— **得挨个节点找谁挂了**，没有聚合视图。
- 第 2 波那几个镜头**看着像压根没被选中** —— 因为它们在 store 里确实还是 `idle`（见 §2）。
- 切去创作页写下一场戏的本子 —— **彻底断了消息**，只有画布上才有节点在转。
- 切去微信回条消息 —— 回来发现 5 分钟前就跑完了，白等。
- 发现选错了想停 —— **停不了**，眼睁睁看着额度烧完。
- 上游模型整体挂了（apimart Imagen 404 那种必死场景）—— **12 个镜头一个接一个全烧掉**。

## 2. 根因：队列这个对象根本不存在

不是"没画 UI"，是**没有可读的调度状态**。

`runGenerationNodesBatch`（`src/workbench/generationCanvas/runner/generationRunController.ts:283-313`）的队列是函数闭包里的
`const queue` + `let cursor`，N 个 async worker 抢游标，`Promise.all` 一收工，调度状态即刻蒸发。

后果是三件事同时不成立：

| 想要的 | 为什么现在不成立 |
|---|---|
| 看见"谁在排队" | 等 worker 空位的节点 store 里还是 `idle`，第 2 波的节点连碰都没碰过 |
| 取消 | 没有"待提交列表"这个对象可以拦；`AbortController` 全仓与生成任务无关 |
| 波次可见 | `plan.waves` 只活在 `runGenerationNodesByPlan` 的栈上 |

主进程侧也指望不上：`electron/tasks/taskAdmission.ts` 只是个"曾受理 taskId"的 TTL 账本（38 行），没有状态机、没有实时列表。

**所以本方案的核心不是加面板，是把调度器从"跑完即忘的临时函数"外化成 store 里的常驻队列对象。** 面板是它的视图。

## 3. 取消的真实边界（诚实交付，不做假按钮）

实查 `comfyuiTaskControl.ts` + 全仓 AbortController 后确认：

| 任务状态 | 能不能停 | 花不花钱 | UI 给什么 |
|---|---|---|---|
| 排队中（还没提交厂商） | ✅ 真能停 | **零费用** | 「取消」+ 绿字「取消不产生费用」 |
| 进行中 · ComfyUI 本地 | ✅ 真中断（`/interrupt` + 出队） | 本地无费用 | 「中断」 |
| 进行中 · 云端 | ❌ 提交即不可撤 | 钱已花，硬停只是丢结果 | **不给按钮**，灰字「已提交厂商，无法中止（费用已产生）」 |

抄竞品给每个任务配「取消」会撒谎 —— 云端那个按钮一分钱省不了，还骗用户丢掉已付费的结果。

## 4. 架构：两个真相源零重叠

这是本方案最要紧的一条纪律（P1：不许出并行版）。

```
generationQueueStore   ←→   node.status
「已调度但还没跑起来」        「跑起来之后」
queued / cancelled           running / success / error / recoverable
```

- **队列 store 独占「调度」语义**：谁被登记了、在第几波、用户有没有取消它、批次有没有被刹车。
- **`node.status` 完全不动**：不给排队节点写 `status='queued'`。

为什么不写 `node.status='queued'`（曾经的直觉方案）：`setNodeStatus` 会把非终态的 `runs[0]` 一并 merge
（`canvasRunActions.ts:44-45`），而 `recoverable` 不在终态白名单里 —— 一个「可找回」的旧 run 会被取消动作
**clobber 成 cancelled，丢掉续查用的 taskId**。零重叠方案连这个 edge case 都不存在。

画布节点显示「排队中」= 节点组件订阅一个 `isQueued(nodeId)` 极小 selector，取消即消失，无迁移、无脏数据。

## 5. 改动清单

### 5.1 新增：队列 store（核心）

`src/workbench/generationCanvas/runner/generationQueueStore.ts`

```ts
type QueueEntryState = 'queued' | 'running' | 'success' | 'error' | 'cancelled'
type GenerationQueueEntry = {
  id: string            // `${batchId}:${nodeId}` 复合主键（同一节点可跨批次出现）
  batchId: string
  nodeId: string
  waveIndex: number     // 0-based，驱动「第 2 波 · 等上游参考」文案
  state: QueueEntryState
  enqueuedAt: number
  startedAt?: number    // 真正开跑的时刻 —— 排队时长 = startedAt - enqueuedAt（现在算不出来）
  endedAt?: number
  error?: string
}
type GenerationQueueBatch = {
  id: string; createdAt: number; total: number
  cancelRequested: boolean
  paused: boolean; consecutiveFailures: number   // 刹车
}
```

**内存态，不持久化。** 理由：进行中的调度天然瞬态（重启后本就在终态收敛，`canvasRunActions.ts:29-31`），
历史留痕已经在 `node.runs[]` 里持久化着。面板「已完成」只显示本次会话 —— 不另立第二份历史真相源。

### 5.2 改：runner 接入队列（付费路径隔壁，最需要小心）

`generationRunController.ts`

1. `runGenerationNodesByPlan` 开头 `enqueueBatch(batchId, plan.waves)` —— **整个计划含后续波次一次登记**，
   这是"排队可见"的全部秘密。
2. `runGenerationNodesBatch` 的 worker 循环，取任务前加两道闸：
   - `await waitForQueueGate(batchId)` —— 刹车暂停时挂起，恢复/取消时放行或跳出（不传 batchId 时是 no-op）。
   - `isEntryCancelled(batchId, nodeId)` —— 命中则 `markSettled(...,'cancelled')` 后 `continue`，**零 vendor 调用**。
3. `runGenerationNode` 无 batchId 时自建单节点批次 —— 单发生成也进面板，否则面板对单发是瞎的。
4. 刹车计数：**只有真执行失败才计数**；`failNode()` 那条「上游本批失败 → 下游显式失败」路径不计
   （那是连带，不是模型挂了）。任一成功即清零。达到 3 → `paused = true` + toast。

**不变量（配回归测试）**：取消/暂停绝不裹住已提交的付费调用；被取消的条目 vendor 调用数 = 0；
grant 覆盖了但没跑的节点不产生扣费（令牌是授权不是扣款，`electron/spendGrant.ts`）。

### 5.3 新增：面板 UI

| 文件 | 职责 |
|---|---|
| `src/workbench/taskCenter/taskCenterEntries.ts` | 纯函数：queue store + nodes → 展示行（分组/排序/可取消性判定）。**可单测，逻辑全在这** |
| `src/workbench/taskCenter/TaskCenterPanel.tsx` | 右上浮卡，照 `OnboardingFloatingPanel` 模式（不遮画布、不 dim、ESC/点外关） |
| `src/workbench/taskCenter/TaskCenterButton.tsx` | 顶栏按钮 + 计数徽章 + 状态色，自带面板开关态 |
| `src/workbench/taskCenter/taskCenterSettings.ts` | 声音/通知开关（localStorage `nomi:taskCenter:v1`）+ WebAudio 提示音 |

挂载点：`NomiAppBar.tsx` 右栏（唯一跨三个工作区常驻的 chrome —— 这正是"切到创作页看不见"的解药）。
按钮解剖抄同栏设置按钮（`NomiAppBar.tsx:234-251`）：`h-[30px]`、`rounded-[var(--nomi-radius-sm)]`、图标 15/1.8。

**顶栏按钮本身就是进度指示器**：有任务时显示 accent 底 + 数字，跑完有失败转 danger 色，闲时是安静的 ghost 图标。
不用点开就知道还有几个在跑。

点任意一行 → 切到生成区 + 选中该画布节点。

### 5.4 新增：完成提醒

`src/workbench/taskCenter/taskCenterSettings.ts` + `electron/notificationIpc.ts`

规则：**窗口失焦时才打扰**（`document.hasFocus()`），窗口开着走现有 toast，不重复轰炸。

- 提示音：WebAudio 合成两声短音（照 `SplashIntro.tsx:95-100` 的懒建 AudioContext 写法）。
  **不打包音频文件** —— 避开 `bundle-asset-url-must-not-persist` 那个坑，也不增加产物体积。
- 系统通知：主进程 `Notification`（点击 → `show()` + `focus()`）。IPC 走 `registerNotificationIpc(registerSyncIpc)`
  单文件，**main.ts 只加 2 行**（775/800 行，照 `comfyuiIpc` 的 `main.ts:458-460` 模式）。
- 两个开关默认都开，面板底部可关。

## 6. 用户会看到什么变化

1. 顶栏多一个「任务」按钮。闲时安静；一跑起来变 accent 底 + 显示「8」；跑完有失败转红。
2. 点开是右上角浮卡（不遮画布、可继续操作）：进行中带进度条和已跑时长 / 排队中带「第 2 波 · 等阿蓝定妆图」/ 已完成。
3. 汇总行一个「取消排队的 5 个」—— 点了明确告诉你「一分钱没花」，进行中的继续跑完。
4. 画布上第 2 波的节点现在**显式标「排队中 · 等参考图」**，不再看着像没被选中。
5. 连续 3 个失败 → 队列暂停 + 横幅「上游可能挂了」+ [继续] [换模型] [全部取消]。
6. 切去别的 App 跑完了 → 系统通知 + 一声提示音，点通知回到 Nomi。

## 7. 不动项

- 不碰时间轴 / 剪辑页（那条线 2026-08-01 已补完）。
- 不碰云端任务的轮询与超时语义（`recoverableTimeout` 那套照旧）。
- 不改 `node.status` 枚举、不改 `GenerationNodeRunRecord` 结构（排队时长由队列 store 的 `enqueuedAt/startedAt` 算）。
- 不做跨会话任务历史（已在 `node.runs` 里）。
- 不做队列拖拽重排 / 优先级（没证据说短剧场景需要）。

## 8. 回滚

全部新增文件可整体删除；runner 侧改动集中在 `generationRunController.ts` 的 worker 循环两道闸 +
一次 `enqueueBatch`，`batchId` 全程可选 —— 不传即退化回今天的行为。

## 9. 走查实际抓到的（单测全绿也照样漏的三个，P3 的活教材）

`tests/ux/task-center.walk.mjs`，15 条单测全绿的前提下仍抓出：

1. **失败行根本不是红的**（走查读 computed color = `rgb(201,201,201)` 灰）。根因是**整类** bug：
   `--workbench-*` 只定义在 `.workbench-shell` 作用域里，而本面板走 `<Portal>` 渲染到 `document.body`，
   够不到那些变量 → `text-workbench-danger` 静默退回继承色。**任何 Portal 浮层用 `workbench-*` 颜色都会中招**
   （与 `token-alpha-modifier-silent-drop` 同一个「静默 no-op」家族）。
   修：根层补 `--nomi-danger`（光/暗两版），Portal 浮层一律用它。
   ⚠️ 运行时 token 真源是 `tailwind.config.ts` 的 `addBase`，不是 `src/theme/nomi-tokens.css` ——
   只改后者不生效（两处都改了，前者才是真起作用的）。
2. **顶栏任务按钮和「上手」用了同一个 `IconListCheck`**，同一条工具栏隔两个位置重复、语义撞车。
   换成 `IconProgress`（虚线进度圈），与清单图标一眼可分。
3. **永远空的进度槽被读成分隔线**：很多厂商不报进度，`percent ?? 0` 会画一条 0% 的横槽，
   视觉上就是条分隔线，还等于在假装知道进度。改成**没数就不画**，靠区段标题 + 已跑时长表达「在跑」。

走查过程本身踩的坑（记给下次）：跑 dist 的走查**改完码必先 `pnpm run build`**（第一次白跑，装的是旧包）；
`[data-node-id]` 裁图会撞上小地图浮层，要按角标自身定位并躲开顶栏/时间轴。

## 10. 验收门

- 五门全过（`pnpm run gates`，亲验 EXIT=0）。
- 单测：`taskCenterEntries` 分组/可取消性判定；队列 store 的取消/刹车状态机；**取消条目 vendor 调用数 = 0** 的不变量测试。
- R13 真机走查：批量跑 → 面板看得见排队 → 取消排队 → 确认零调用 → 切走收到通知。截图亲眼 Read。
