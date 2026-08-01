# 顶尖开源产品的 ComfyUI 接入模式（六仓实读 · 2026-08-01）

> 读码对象（克隆 HEAD 日期）：ComfyUI 本体 2026-08-01 · SwarmUI 2026-08-01 · StabilityMatrix 2026-07-25 · krita-ai-diffusion 2026-06-30 · ViewComfy 2026-03-19 · comfyui-deploy 2025-11-12。file:line 均指当日 HEAD。服务 Nomi ComfyUI 迭代（Tier-1 已落：docs/plan/2026-08-01-comfyui-tier1-objectinfo-reconcile.md）。

## 参数化三流派（核心结论）

| 流派 | 谁在用 | 机制 | 优 | 劣 |
|---|---|---|---|---|
| 占位符模板 | SwarmUI（`${tag:default}` + `%%_COMFYFIXME_%%` 数字合法性 hack） | 图存成带占位字符串的文本，提交前填充 | 实现最快 | 无类型保证；图与参数耦合在文本层 |
| 专用输入节点 | krita（ETN_*）、SwarmUI（SwarmInput*）、ComfyDeploy（External*，`input_id`=API 参数名） | 服务器装节点包，作者在图里插参数节点，客户端扫 class_type 出表单/契约 | 契约显式类型化（min/max/分组/描述），随图分发 | 要求装节点包 + 作者改图 |
| 图内省自动推导 | ViewComfy（全量扫）、SwarmUI（无节点时启发式兜底）、**Nomi 现状** | 标量输入→字段、数组=边跳过；class/输入名启发式定控件；object_info 补枚举 | 零门槛零改动即插即用 | 启发式会猜错；字段爆炸要基础/高级分层 |

关键杂交（krita）：Parameter 节点的 choice 选项**沿出边找下游节点，问 object_info 拿真实枚举**（`model/custom_workflow.py:375-379`）——专用节点派+内省派合体。

## 各家最值得抄的一招

- **krita**：连接时「声明式需求清单（哨兵节点 + 按架构模型搜索路径）vs /object_info」一次对账（`backend/comfy_client.py:183-186,689-700`、`backend/resources.py:27-61`，含 pinned commit）——能不能用、缺什么、去哪补，生成前说清。UI 格式 workflow 客户端本地转 API 格式（`comfy_workflow.py:1440-1493`，用户丢哪种 json 都能吃）。
- **SwarmUI**：参数化双层——有 SwarmInput 节点用节点，没有就启发式（seed/width/denoise/cfg/steps 各配控件，js:763-819）；双模式共存天花板（Generate 简单页 ↔ iframe 内嵌原生 Comfy `/ComfyBackendDirect` 反代 ↔「Use As Generation Parameters」互转）。
- **StabilityMatrix**：节点构建层声明 `RequiredExtensions`（semver），出图前 diff 已装扩展 → 弹「装并重启」一键闭环（`InferenceGenerationViewModelBase.cs:657-793`）；`/object_info/{nodeType}` 轻量单类探测（`IComfyApi.cs:42-46`）。
- **ComfyDeploy**：workflow 版本 × 环境快照（comfyui commit + 每个自定义节点 commit，取自 Manager `/snapshot/get_current`，`schema.ts:229-238`）——「昨天能跑今天不能」的结构性答案；monkeypatch `prompt_server.send_json` 拦全部 ws 事件转 webhook/队列 + 记每节点耗时/VRAM。
- **ViewComfy**：零改动导入（先跑起来再精修）；`_meta.title` 前缀约定（`VC_BASIC/VC_ADV`）强制归类改名；POST /prompt 的 **200 响应也检查 node_errors**（`comfyui-api-service.ts:206-212`）；`executed` 输出泛读所有 key 只滤 `type=="temp"`。

## ComfyUI 本体 API 要点（server.py，2026-08-01 HEAD）

- 路由：/ws(:269) /system_stats(:686 含 comfyui_version) **/features(:739 旗标)** /object_info(:800) **/object_info/{class}(:813)** **/api/jobs 家族(:821+，官方 Cloud 文档已把 history-v2 标 deprecated)** /history /queue /prompt /interrupt /free /upload/image /upload/mask /view /models /workflow_templates。
- POST /prompt：客户端可自带 UUID `prompt_id`（:1090-1104，≥0.3.45——重启找回任务的钥匙）；`partial_execution_targets`（:1106）；校验失败返回结构化 error + 按节点 node_errors（:1124-1136）。
- /interrupt 支持 prompt_id 定向（:1167-1188）；新 `/api/jobs/{id}/cancel` 状态无关幂等（:944-987）。
- ws：`progress_state` 一条消息带全部节点各自进度（`comfy_execution/progress.py:181-184`）；二进制帧 `>II` 头，`PREVIEW_IMAGE_WITH_METADATA=4` 带 node_id json（多任务并发预览不串卡），但要先在 ws 首消息 feature_flags 声明 `supports_preview_metadata`（:302-316）。
- 生态时效（2025H2-2026，来源见文末）：API Nodes 内置付费模型节点（node_info 带 `api_node` 旗标）；comfy-cli + Comfy Cloud jobs；Registry 成节点分发标准（pyproject `[tool.comfy]`、装盘目录用 registry 规范名）；官方 MCP 2026-06-30 公测（cloud.comfy.org/mcp）。「workflow→API」无统一新标准：External-节点派与内省派并存。

## Nomi 采纳排序（对齐微信反馈池）

1. ws 进度 + 活预览帧（治 20 分钟黑盒，#2680 画像）→ Tier-2 样张已出
2. 缺节点/缺模型对账（✅ Tier-1 已落：generic 全图对账版）
3. 任意 workflow → 参数面板（✅ 7 月已落 ViewComfy 式；Tier-2 补 combo 真实选项下拉）
4. 定向取消 + 队列位次（/interrupt+prompt_id；新服务器走 jobs cancel，/features 判代际）→ Tier-2
5. 客户端自生成 prompt_id（重启找回，接「视频超时不丢」传统）→ Tier-2 顺手
6. WAN2.2 预置模板 + 缺件闸（S5 拍板欠账，缺件时不给启用）→ Tier-2 样张已出
7. 结果绑环境指纹（comfyui_version + 哨兵包进 result.meta）→ Tier-3 低成本
8. 缺件「一键装」（仅本机可写实例；远程只报不装，SSRF/权限边界）→ Tier-3
9. 多实例配置 → 单独拍板（vendor 身份模型岔路）

**明确不抄**：SwarmUI ws 二进制产物直传、krita 自家 HTTP 图缓存 API——都要求用户服务器装我们的节点包；/history→/view + byte-range 已够。若未来做「Nomi 输入节点」，走 ComfyDeploy 的 `input_id` 轻契约，不搬整套 tooling-nodes。

## Sources（时效层）

[Comfy-Org/comfy-cli](https://github.com/Comfy-Org/comfy-cli) · [Registry 规范](https://docs.comfy.org/registry/specifications) · [agent-tools/MCP](https://docs.comfy.org/agent-tools) · [Comfy MCP 发布 2026-06-30](https://comfyui-wiki.com/en/news/2026-06-30-comfy-mcp-agent-integration) · [API Nodes 报道](https://comfyui.org/en/comfy-gets-major-boost-with-new-api-nodes) · [jobs API 取代 history v2](https://docs.comfy.org/api-reference/cloud/job/get-execution-history-v2)
