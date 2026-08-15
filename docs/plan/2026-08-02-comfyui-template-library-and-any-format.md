# ComfyUI：任意格式都吃 + 493 官方模板库（T 轨）· 多实例 UI（M 轨）

> 2026-08-02 用户拍板「两个一起做」，四幕样张过。价值论述见样张：
> ①我能用什么 ②贴我自己的 ③生成中 ④多台机器。

## 用户视角的目标（先价值）

| 现在用户卡在哪 | 做完他会经历什么 |
|---|---|
| 装完 ComfyUI 打开 Nomi 只看到一个写死的「本地·文生图」，不知道自己这台机器还能干什么 | 打开就看到**他自己 ComfyUI 里的 493 个官方模板**（分类/描述/缺件状态），挑一个点「启用」就进画布 |
| 从网上下的工作流贴进来被拒「请导出 API 格式」——而 ComfyUI 分享的默认就是界面格式 | **贴什么格式都吃**，界面格式自动转 |
| 有两台机器只能接一台，换机器要改地址、改完之前的工作流全乱 | 每台一张卡，**选模型 = 选机器**，两台能同时跑 |

## T 轨：任意格式 + 模板库

### T1 格式转换（借 ComfyUI 自己的前端）

- 新 `electron/comfyuiGraphConvert.ts`：隐藏 `BrowserWindow` 加载 `{baseUrl}` → 等 `window.app.graphToPrompt` 就绪 → `loadGraphData(ui,true,false)` → `graphToPrompt()` → 取 `output`。
- **为什么不自己写转换器**：实测手写只对 2/14（ComfyUI 自定义 widget 类型无穷无尽，白名单追不完），借官方前端 **14/14**（subgraph 自动展开）。这是 Electron 独有优势。
- 窗口复用（同 baseUrl 一个、闲置 60s 关）、超时 45s、失败**回落到既有的「请导出 API 格式」提示**（不是死路）。
- 接入点：`parseComfyApiWorkflow` 抛「界面格式」错时，导入面板自动试一次转换；成功则继续既有分析链。
- ⚠️ 安全：隐藏窗口只加载**用户自己配置的 ComfyUI 地址**，`nodeIntegration:false`、`contextIsolation:true`、不注入 preload。

### T2 模板库

- 新 `electron/comfyuiTemplates.ts`：`GET {baseUrl}/templates/index.json`（分组+标题+描述+分类+标签）；`GET {baseUrl}/templates/{name}.json` 取本体。60s 缓存，连不上返 null（UI 说「未连接」不报错）。
- UI：`ComfyuiPresetSection` 从「1 个硬编码 WAN」升级为「模板库」——分类 chip + 列表 + 逐条缺件状态 + 启用。**内置 WAN2.2 预置保留**（离线也有一条能用的路）。
- 缺件复用既有 `reconcileComfyWorkflow`（打 /object_info，100% 覆盖），`properties.models` 有就给下载直链（实测仅 17% 有，故只作补充）。
- 启用链复用既有 `importComfyWorkflowToCatalog`（零新持久化）。

## M 轨：多实例 UI（后端 S1 已落 ce67f433）

- `OnboardingDrawer`：遍历所有 comfy vendor（`isComfyuiVendor`）各渲染一张 `ComfyuiLocalCard`；卡片可折叠。
- `ComfyuiLocalCard` 参数化 `vendorKey`（现在硬编码常量）；新增「+ 再接一台」（起名 + 地址）与「移除这台」（第一台不可移除）。
- 画布模型名带机器标识：`labelZh (机器名)`——**在导入/启用时写进 model.labelZh**（不在渲染层拼，避免多处漂移）。

## 不动项

- 既有导入链、缺件对账、ws 进度/取消、combo 下拉、SSRF 边界（仍「每台只信自己 origin」）——全部复用，不为新功能复制逻辑（P1）。
- 内置文生图与 WAN2.2 预置不删（离线兜底）。

## 验收门

1. 单测：转换器纯函数部分 + 模板索引解析 + 多实例卡分组；不回归既有 48 例。
2. **真 ComfyUI 实测**（`scripts/comfyui-real-server-verify.mjs` 扩展）：真拉 493 模板索引、真转 UI 格式、转出的图提交 /prompt 校验结构。
3. R13 走查（截图人眼核）：模板库三态（就绪/缺件/云端）、贴界面格式自动转、两台机器各管各的。
4. 五门全过 + landing 树干净 install 复验。
