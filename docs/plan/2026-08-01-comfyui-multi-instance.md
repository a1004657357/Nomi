# 多实例 ComfyUI（方案 A：每台一张卡）

> 来源：微信 #4005①（叶囧「接入多个 comfyui 的配置」）。2026-08-01 用户拍板 **A · 每台一张卡**
> （否掉 B「一张卡切地址」——切换是全局的，同一时刻只能用一台，批量不能分散，且各机器装的东西不同、
> 共享工作流列表会让缺件对账打架）。

## 用户看到什么

- 模型接入页：ComfyUI 卡底部多一个「**+ 再接一台**」。点开填地址 + 起个名（如「工作站」）。
- 每台一张独立卡：自己的地址、自己的连接状态、自己的工作流列表、自己的缺件对账。
- 画布选模型：模型名带机器标识——「WAN 图生视频 (工作站)」「本地·文生图 (本机)」。
  **选模型 = 选机器**，这是自然心智；两台机器可同时在跑（本机出图 + 工作站跑视频）。

## 核心设计：vendor key 前缀 = 实例身份（零迁移）

vendor 本就按 `key` 唯一、`baseUrlHint` 是 vendor 级地址——「一个 vendor = 一个后端端点」是既有语义，
多实例天然贴合它。不新建并行概念（P1）：

- 第一台沿用 `comfyui-local`（**存量用户零迁移**，所有既有工作流/模型原样归它）
- 第 2+ 台 `comfyui-local-{slug}`（slug 由用户起的名派生）
- 判据 `isComfyuiVendor(vendor)`：`key === 'comfyui-local' || key.startsWith('comfyui-local-')`
  （用 key 而非 meta 标记：key 是稳定身份、不会被 upsert 覆盖，且前缀方案不需要数据迁移）

## 23 处单实例硬编码的分类处置（已实查）

| 类 | 处置 | 位置 |
|---|---|---|
| **① 按实例取地址/删数据** | 加 vendorKey 参数，调用方传当前实例 | `comfyuiProgressSocket:106,282`（ws 地址/mapping 查找）、`comfyuiWorkflowImportStore:43,102`（reconcile 地址/删 mapping）、`ComfyuiLocalCard:114,127,141,156`（启停/改址/删模型——卡自己知道是哪台） |
| **② 只需判「是不是 ComfyUI 类」** | 换 `isComfyuiVendor(vendor)`，逻辑本就按 vendor 自身走 | `assetLocalization:37`（SSRF 信任**自身** origin——天然按实例正确）、`assetLocalization:425`（首帧上传通道）、`OnboardingDrawer:239`（排除通用卡） |
| **③ 按实例分组渲染** | 遍历所有 comfy vendor，各渲染一张卡 | `OnboardingDrawer:96,244,247` |
| **④ 定义/种子** | 常量保留 = 第一台；种子只种第一台 | `types:137`、`comfyuiLocal:228` |

## 不动项（重要）

- 既有 curated 文生图、导入链、缺件对账、ws 进度/取消、预置模板——全部**按实例复用同一套代码**，
  不为多实例复制任何逻辑（P1 无并行版）。
- SSRF 信任边界不放宽：仍是「只信这个 vendor 自己配置的 origin」，多一台就多一个受信 origin，
  判据从「key 相等」变「是 comfy 类」，**信任范围不变**（仍是用户亲手填的地址）。
- ws 连接池已按 baseUrl 分（`socketsByBase`），多实例天然各连各的、零改动。

## 分期

- **S1 后端解耦**（不可见，无需样张）：`isComfyuiVendor` 判据 + 上述 ①②④ 参数化；单测覆盖
  「两个实例的工作流互不串台」「删 A 台不影响 B 台」。
- **S2 UI**（用户可见，**需样张拍板**）：多卡渲染 + 「+ 再接一台」+ 起名 + 画布模型名带机器标识。
- **S3 走查**：两台 mock ComfyUI（不同端口、装不同"模型"）→ 各自导入 → 缺件对账各报各的 →
  同时生成互不干扰 → 删一台另一台完好。

## 回滚

前缀判据是纯增量：没有第 2 台时行为与今天逐字节一致（`isComfyuiVendor` 对单实例恒等于旧判据）。
