# ComfyUI Tier-1 根治：/object_info 对账 + 首跑必炸 + 报错人话

> 背景：微信 ComfyUI 专项梳理（docs/feedback/2026-08-01-comfyui-reconcile.md）+ 开源六仓调研
> （Krita AI Diffusion / SwarmUI / StabilityMatrix / ViewComfy / comfyui-deploy / ComfyUI server.py）。
> 「缺节点/缺模型」是 ComfyUI 接入第一死因（#2921「没任何反应」、#3473「还是没法接入」、#4173 全族），
> 此前只能等运行期 execution_error 再猜。本轮把它治在**导入时**和**提交时**两道闸上。

## Scope（三件事）

1. **`/object_info` 能力索引**（`electron/comfyuiObjectInfo.ts`，新）
   - `parseObjectInfoIndex`：class 集合 + combo 枚举（纯函数）；60s TTL 缓存；连不上返回 null（= 不可核对，绝不误报「全缺」）。
   - 形状证据：ComfyUI server.py:800（/object_info）、:813（/object_info/{class}，StabilityMatrix IComfyApi.cs:42-46 同款轻量探测）。

2. **导入时缺件对账**（Krita 清单对账思路的 generic 版）
   - `reconcileComfyWorkflow`（comfyuiWorkflowImport.ts，纯函数）：缺节点类 → `unknownNodeTypes`；标量输入值 ∉ 本机 combo 枚举 → `missingEnumValues`（= 作者机器的模型文件名，本机没有）。
   - 新 IPC `comfyui:reconcile-workflow`（异步 handle，analyze 保持同步纯解析不动）；ComfyUI IPC 全族搬进 `electron/comfyuiIpc.ts`（main.ts 减 7 行，800 行门腾空间）。
   - 导入面板：分析成功后异步补两条红警示（danger-soft 复用现有样式）+ 未连接时一行灰字「已跳过检查」（不阻断导入）。

3. **提交闸两件**
   - **首跑必炸根治**：内置文生图 ckpt_name 默认从写死 `v1-5-pruned-emaonly.safetensors` 改为**留空 = 提交时从本机 derive 第一个 checkpoint**。机制 = 新的声明式**请求变换**层（`electron/tasks/requestTransforms.ts`，与 responseTransforms 对称；op 声明 `request_transform: "comfyui-prompt"`；runtime 只按名查表 P4）。用户手填的名字**绝不静默纠正**。
   - **/prompt 400 人话**：`pickUpstreamMessage` 学会 ComfyUI 校验错误形状（server.py:1124-1136）——`node_errors` 按节点摊平（前 2 条 + 总数）、`error.message — details` 拼接。此前用户只能看到笼统的 "Prompt outputs failed validation"。

## Non-goals（Tier-2，另出样张拍板）

- websocket 进度 / 活预览帧、取消（/interrupt）与队列、预置 WAN2.2（S5）、参数面板的 combo 真实选项下拉、多 ComfyUI 实例。

## 不动项

- analyze/import/update 的同步 IPC 语义、curated mapping 结构、findOutputAssets/comfyui-history 变换、SSRF 信任边界（仍仅 curated ComfyUI vendor 的自身 origin）。

## 验收（全过）

- 单测/集成测 8 文件 100 例全绿；集成测升级为「空 ckpt → 假服务器 /object_info/CheckpointLoaderSimple → derive 第一个 checkpoint 真发出」端到端。
- R13 真机走查 `scripts/comfyui-reconcile-walkthrough.mjs`（dist 构建 + mock ComfyUI）四截图人眼核过：缺件双红框 / 全齐零警示 / 离线灰字不阻断；零 console error。
- 五门全过后落 main。

## 回滚

各件独立可回滚：请求变换层未声明即 no-op；reconcile 是独立 IPC + 面板增量块；ckpt 默认值改回即回旧行为。

---

## Tier-2（同日样张拍板后落地：取消=A 遮罩位 · WAN 模板带缺件闸）

**W 轨 · WAN2.2 预置模板**：`electron/catalog/comfyuiPresets.ts`（官方 `03_video_wan2_2_14B_i2v_subgraphed.json` 逐线转 API 图，字段名逐类核 ComfyUI 源码 INPUT_TYPES；6 个模型文件清单带官方 HF 链 + 目录）→ `ComfyuiPresetSection.tsx`（缺件红 chip/逐文件 ✓✗/复制名/下载链/重检；缺件不给启用；启用走既有 import 链）。测试含「清单↔图不漂移」不变量。**走查逼出的根治**：对账路径必须 `bustComfyObjectInfoCache`（用户刚装完模型点重检，60s 缓存会说谎）。

**P 轨 · ws 进度/活预览/遮罩取消/队列**：`electron/comfyuiProgressSocket.ts`（undici WebSocket 主进程长连 `/ws?clientId=nomi`——CSP 拦渲染层直连；prompt_id→node 注册表；executing/progress/execution_cached 事件 → 整体百分比；二进制 `>II` 预览帧节流 450ms/1.5MB 上限；/queue 位次节流探测；重连+TTL 清理）→ IPC watch/unwatch/interrupt → `comfyuiProgressBridge.ts`（narrate 注册表出人话，taskId 必须随补丁带回——setNodeProgress 是整体替换）→ `GeneratingOverlay` 升级（determinate 圆环复用 RemoveBackgroundProgressMark + 预览 img + pointer-events-auto 取消 pill；props 全缺省=旧遮罩逐像素一致，云任务零变化）。取消=/interrupt{prompt_id}+/queue delete 双发 best-effort + 轮询即刻停 + **controller 收口兜竞态**（点取消瞬间轮询拉回 interrupted 终态会盖成红卡——cancelRequested 登记在 catch 里优先判，走查实锤后修）。`execution_interrupted` → 「已取消」人话（外部打断时不吓人）。

**验收**：单测 8+ 新文件全绿；三条真机走查（`comfyui-preset-walkthrough.mjs` 缺→装→启用三景、`comfyui-progress-walkthrough.mjs` 进度环/节点人话/取消 pill→idle、`comfyui-reconcile-walkthrough.mjs` 回归）截图全部人眼核过；五门全过落 main。
