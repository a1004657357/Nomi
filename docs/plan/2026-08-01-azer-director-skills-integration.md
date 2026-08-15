# 阿泽导演技能集成进 Nomi — 方案

> 2026-08-01。来源：阿泽导演台 forge v2.4.2（开源 github.com/feicaiclub/forge）。
> **授权**：用户 2026-08-01 已取得阿泽本人授权，可使用其技能内容。落地用 Nomi 自己的结构重整，不照搬 EP/S 目录 + DeepSeek 调优 + 手动生成工作流。

## 一句话目标

把阿泽 28 个电影级技能（21k 行方法论）整过来，做成 Nomi 原生能力：**既让 Nomi 拆镜头/写提示词的质量立刻变好（脑变强），又让 AI 能经 MCP 脊柱调用「脑（技能）+ 手（生产）」在画布上直接拼出可播初稿。**

## 核心架构：MCP 脊柱 = 手 + 脑

Nomi 已有「手」（MCP 生产工具：建节点/设提示词/生成/读画布，`electron/capabilityCore/mcpProtocol.ts`）。这次把「脑」（导演技能）挂到同一根 MCP 脊柱上。两个受众共用一套脑：

- **应用内 AI**（大多数用户的统一体验）：Nomi 自己的创作 AI 拉技能规划 → 调生产工具在画布真生成 → 用户全程不出 Nomi。
- **外部 MCP agent**（生态红利，几乎白送）：Claude Code/桌面等连上 Nomi，拉同一套技能驱动生成。

**为什么是 MCP 而不是把技能焊死在 UI**：技能上了脊柱，内外两头共用，写一次两头通（P4 通用第一）。符合 2026「Skills over MCP」标准方向（SEP-2076 / AgentSkills-MCP 渐进披露）。

## 技能清单 + 移植策略（28 个）

分三类落地：

| 类 | 阿泽技能 | 价值 | Nomi 落点 |
|---|---|---|---|
| **A 质量守卫（自动·无感）** | seedance-kling-capabilities（演时换算/硬软约束/污染词）、consistency（五维/状态表/handoff） | 治拆镜头低估、提示词抽象、跨镜漂移 | **折进** `workbench-storyboard-planner` skill + 新守卫逻辑 |
| **B 创作招式（用户选/AI 按需调）** | cinematography(+deakins)、storyboard 运镜翻译、long-take、action-choreography、performance、staging、art-design、otomo-wright、guzhuang-xingzhi、sound-design | 给镜头套导演手艺 | Nomi 原生 `director-*` 内置技能进 `skills/`，挂 MCP 脊柱渐进披露 |
| **C 上游剧本系统（编剧）** | 剧本系统 13 skill（Truby/Mamet/Kasdan/宋方金/施拉德/即兴…） | 从想法→剧本的前置链 | Nomi 原生 `writer-*` 内置技能进 `skills/`，服务创作 AI 写故事/剧本 |

## 分期（进度 2026-08-01）

- **✅ P1 · 拆镜头方法论上桌**（commit e756d83a）：`skills/workbench-storyboard-planner/SKILL.md` 加 §演时换算法 + §硬/软约束 + §一致性 + prompt 物理化。纯内容、立即生效。
- **✅ P2 · 全库整过来**（e756d83a + b6c8d8b6 + 25d6edb3）：**23 个 Nomi 原生内置技能**——12 `director-*`（摄影/一致性/运镜翻译/转场/动作/表演/调度/服化道/审图/声音/大友×赖特/古装）+ 11 `writer-*`（结构 Truby/对白 Mamet/编剧 Kasdan×Gilroy 含格式包/宋方金/施拉德/行为心理/改编/小说消化/创意孵化/即兴/剧本自审）。授权已获、Nomi 原生重写、剥净 EP/S 双 agent 编排；并行 subagent 移植 + leakage-grep + spot-read 验收。阿泽 `screenplay`/`director(极速)`/`review` 等工作流编排壳有意不搬=Nomi 机制。
- **⏳ P3 · 挂上 MCP 脊柱**（后端·无 UI 门）：`mcpProtocol.ts`（现只 `capabilities:{tools}`）补 **prompts + resources** 原语 + 渐进披露（`tools/list` 只列元数据、`resources/read` 按需返 SKILL.md）；让内外 agent 能发现/加载技能。同时让 Nomi 自己的创作 AI / storyboard planner 按任务**按需引用**相关技能（不是一次性全塞窗口）。
- **⏳ P4 · 分步确认出初稿**（用户可见·**必过设计流程**）：`rendererBridge` 确认桥从「只确认花钱」推广到方案门/参考图门/生成门；应用内 AI 编排「拆镜头→出参考图→逐镜生成→排时间轴」，每门弹卡确认（复用 `AgentPlanCard`/付费卡）；`isAppOpen` 决定应用内卡 vs 外部 elicitation。**外部宿主反馈按下节路由**。

## 宿主适配（P4·实查 R5·2026-08-01）

Nomi 反馈往外部 agent 界面送，按宿主能力路由（都由同一 MCP 脊柱驱动）：

| 宿主 | 确认 | 活生成反馈 |
|---|---|---|
| **GUI 宿主**（claude.ai 网页/Claude 桌面/IDE/ChatGPT/**WorkBuddy 桌面**） | elicitation 表单 | **MCP Apps 内嵌活 widget**（`_meta.ui.resourceUri`+`ui://` 自包含 HTML 装沙箱 iframe·确认卡+活生成面板·一窗全看·可复用 Nomi 画布预览组件） |
| **纯终端 CLI**（Claude Code/Codex 终端/**CodeBuddy CLI**） | elicitation 表单（Claude Code 2.1.76+/Codex PR#17043） | 文字状态 + 深链一键跳 Nomi 窗口看图（终端渲不了 widget；Claude Code 进度还有折叠 bug #51713） |
| **Nomi 应用窗口** | 应用内确认卡（`isAppOpen`） | 画布活生长=视觉真相兜底 |

- **WorkBuddy/CodeBuddy**（腾讯·MCP 客户端·面向中文非技术创作者·对 Nomi 受众对味）：CodeBuddy 支持 tools/resources/**prompts** 且 MCP prompts 自动转 slash 命令=技能挂 prompt 现成；WorkBuddy 桌面 GUI 归 GUI 档（是否渲 MCP Apps widget 待核）。
- 防御：Claude Code 进度折叠、Codex elicitation 挂起（#11816）都是已知坑 → Nomi 侧 fail-fast + isAppOpen 兜底。

## 完成流程门（用户要求·不留余留）

推到底、但用户可见的部分必须过我们的流程：
- **P3**：后端代码，走五门（`pnpm run gates`）+ 单测；无 UI 样张门。
- **P4**：① 先读 `docs/design/nomi-design-system.md` + 看画布真实截图（禁脑补）② 出忠实样张（in-Claude widget / 终端降级 / Nomi 窗口协同）③ 用户拍板 ④ 实现后与样张逐项对账 + R13 真机走查（旅程：剧本→初稿，每门可拦可改；外部 Claude Code/WorkBuddy 驱动同链路可用）⑤ 五门 + push。

## 需要样张拍板的（R8）

- P4 的三道确认门 UI（方案确认卡 / 参考图审阅 / 生成确认）——画前先读设计系统 + 看画布真实截图，不脑补。
- P2 技能库里 `director-*` 技能卡的呈现（是否做成 playbook 走 `ActiveSkillChip` picker）。

## 验收门

- P1：拆镜头对同一段戏，时长按演时换算给出（不再一律 5s）；提示词无污染词、物理化；`pnpm run gates` 全过。
- P2：新技能 `skillStore` 扫得到、技能库显示、缺 provider 标注正确。
- P4：真机走查 J（剧本→初稿）跑通，每门确认可拦可改；外部 Claude Code 驱动同链路可用。

## 不动项 / 回滚

- 不碰阿泽的 EP/S 目录约定、DeepSeek 省 token 规则、手动生成工作流——那些是他的工作流不是 Nomi 的。
- 不逐字打包阿泽 SKILL.md 原文（授权虽有，但 Nomi 结构不同、且要挂脊柱）——按方法论重整为 Nomi 原生。
- P1 是单文件内容改动，回滚 = 还原 SKILL.md。

## 剩余执行计划（2026-08-01·自主推进·不停下拍板）

核心机制已 R16 端到端验证（外部 agent 经 MCP 真出图 + 规划方法论真生效）。剩余：
- **Phase A · 应用内完整闭环**：走查驱动生成侧 agent「剧本→拆镜头→落画布→逐镜出图→排时间轴」，截图眼见链验+修全问题。主体验。
- **Phase B · 确认门 surfacing**：rendererBridge 从「只确认花钱」推广到 方案/参考图/生成 三门（应用内卡），走查验。
- **Phase C · MCP Apps 活生成 widget**：GUI 宿主内嵌 Nomi 面板。⚠️需支持该扩展的宿主才能真验（本机无）→建好+验能验的(HTML独立渲染+协议层serving单测)，渲染在 Claude/WorkBuddy 侧诚实标注待宿主验，不假报完成。
- **Phase D · 落 main**：13+commit 正经合并（main 已并行分叉）→五门→push。

## ✅ Phase A/B/C 已完成（2026-08-02·真机走查眼见链验）

- **Phase A ✅ 应用内闭环端到端跑通并眼见链验**（`tests/ux/draft-loop.walk.mjs`，NOMI_R16_GEN=1 花真图额度）：真 GUI + 真文本大脑 + 真图片模型走完整旅程——创作区「拆成镜头·落画布」→ 规划师出 7–8 镜方案（物理化 prompt + 演时换算）→「确认落画布」落 10 节点（3 参考卡 + 7 镜，带参考边）→ 选中浮条付费确认 → 依赖波次真出图（参考先→镜头后，9 真资产，真电影级镜头）→ 时间轴「AI 拼片」按镜序排 8 镜 → 预览可播初稿 / 导出 MP4。**发现皆非 Nomi bug**：走查工具时序（已修）+ 供应商偶发超时（外部；应用侧「上游未生成」级联提示 + 重试都健全，真实用户点重试即恢复，走查已复现）。观察：「AI 拼片」是时间轴工具条纯图标按钮，可探索性可再打磨（未在本轮改，属独立打磨项）。
- **Phase B ✅ 确认门 surfacing 推广 + 眼见链验**（`tests/ux/plan-gate.walk.mjs`，零额度）：确认桥从「只 spend.confirm」推广到 **方案门/参考图门/生成门**，全走全仓唯一漏斗 `useSpendConfirmStore`+`SpendConfirmDialog`（不建并行卡，遵 §3.5）。
  - `SpendConfirmRequest.kind`（generation/reference/plan）→ 对话框图标/副标按门类派生（方案=分镜 IconMovie、参考图=相机 IconPhoto、生成=机器人/金币）。
  - **方案门**：外部 MCP agent 批量落节点（≥2）时，`core.addProjectNodes` 经 `gateway.confirmPlan` → `requestRenderer('plan.confirm')` 弹应用内卡（app 开着；headless 免费可撤直放行，付费门/方案门按「可逆性」分级）。真机走查证实：外部 stdio agent → GUI 弹方案卡 → 点「落到画布」→ 3 节点真落。**走查抓出并修**：方案卡副标误用付费文案「需你确认花费」与「不花额度」自相矛盾 → 新增 `agentNoticePlan`「需你确认落画布」。
  - **参考图门 vs 生成门**：`confirmSpendForAgent` 按 `node.meta.referenceSheet` 派生 kind（相机图标+「生成参考图」措辞 vs 机器人+「生成镜头」）。旧 spend 确认零回归（kind 缺省 → 原图标/文案不变）。
  - 单测：`core.test.ts` 方案门（批准落/拒绝回 cancelled 零副作用/单节点不弹）。
- **Phase C ✅ 建好 + 验能验的（渲染在宿主侧诚实标注待验）**：MCP Apps 扩展 `io.modelcontextprotocol/ui`（Stable 2026-01-26，R5 实查 ext-apps `specification/2026-01-26/apps.mdx`）。
  - `electron/capabilityCore/mcpAppWidget.ts`：自包含活生成 widget HTML（Nomi 调色板光/暗双模 + 逐镜缩略图/状态点 + 视图↔宿主 postMessage 握手 `ui/initialize`/`ui/notifications/tool-result`/`ui/open-link`）。
  - `mcpProtocol.ts`：initialize 捕获客户端 UI 扩展；`nomi_generate` 挂 `_meta.ui.resourceUri`；`resources/list` 列 `ui://`、`resources/read` 回 `text/html;profile=mcp-app` widget；结果带 `structuredContent.nomiDraft`。**全部 gated on 客户端声明扩展**——纯终端客户端零 widget 字段、原文本结果零回归。
  - **验**：协议层 serving 8 单测（`nomiMcpApps.test.ts`）+ widget 独立浏览器渲染截图（light/dark/empty，本人 Read 亲眼看，Nomi 风格正确）。
  - **诚实缺口**：在真 GUI 宿主（claude.ai 需域名签名 / Claude 桌面 / WorkBuddy）里的**内嵌渲染效果本机无法验**（无支持该扩展的宿主）→ 待宿主验，不假报「渲染在 Claude 里通了」。确认仍走 elicitation（已有）；widget = 活生成反馈面板那一半（对齐宿主适配表）。
